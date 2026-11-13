// The sidebar, as the Spotify workspace's (src/spotish/components/library/
// sidebar.tsx): three rounded panels on the window's ground. The pages, each
// row 44 high with its glyph in a 30pt column; the library, one line per
// entry with a round cover, which waves in and fades out at the panel's
// bottom edge; the account at the foot. One selection per panel slides to
// the chosen row. Narrow, a rail of glyphs and covers with tooltips.

import { type AnimatedValue, createAnimatedValue, createMotion, effect, List, reduceMotion, Text, untracked, View } from "nsh";
import { Button } from "nsh/base";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as account from "../account";
import * as together from "../together";
import { Icon } from "../icons";
import { Cover, focusRing, Hint, IconButton, LAYER } from "../spotish/components/ui/controls";
import { iconMotion, type IconName } from "../spotish/components/ui/icons";
import { PlayingBars } from "../spotish/components/ui/playing";
import { createListWave, listItemEntrance, WAVE } from "../spotish/components/ui/motion";
import { DURATION, EASING } from "../spotish/components/ui/tokens";
import { glyph } from "../icons";

/** Rows are 48pt apart: 44 high, 4 between. */
const ROW_STEP = 44 + 4;

/** A panel's selection (transitions.dev "Tabs sliding"): one background
 * that slides to the selected row, fading away with none; in a list it
 * follows the scroll natively. */
function SlidingSelection(props: { index: () => number; top: number; scroll?: AnimatedValue }) {
  const motion = createMotion({ initial: { opacity: 0 } });
  let at: number | undefined;
  effect(() => {
    const i = props.index();
    untracked(() => {
      const from = at;
      at = i;
      if (from === i) return;
      const y = props.top + i * ROW_STEP;
      if (from === undefined || reduceMotion()) {
        if (i >= 0) motion.translateY.set(y);
        motion.opacity.set(i >= 0 ? 1 : 0);
        return;
      }
      const timing = { duration: DURATION.base, easing: EASING.inOut };
      if (i < 0) { void motion.opacity.timing(0, timing); return; }
      if (from < 0) motion.translateY.set(y);
      else void motion.translateY.timing(y, timing);
      void motion.opacity.timing(1, timing);
    });
  });
  const y = props.scroll ? motion.translateY.sub(props.scroll) : motion.translateY;
  return <View class="pointer-events-none absolute left-2 right-2 top-0 h-11 rounded-(--radius-inset) bg-secondary" style={{ opacity: motion.opacity, transform: [{ translateY: y }] }} />;
}

const pages = [{ page: "home", label: "首页", icon: "home" }, { page: "search", label: "搜索", icon: "search" }, { page: "library", label: "音乐库", icon: "library" }] as const;

function NavItem(props: { page: nav.Page; label: string; icon: IconName; compact: boolean }) {
  const selected = () => nav.activeTab() === props.page;
  const hover = iconMotion();
  return <View onMouseEnter={() => hover.play(props.icon)}>
    <Button testID={`nav-${props.page}`} accessibilityLabel={props.label} selected={selected()} onPress={() => nav.navigate(props.page, true)} tooltip={props.compact ? <Hint label={props.label} /> : undefined}
      class={`group h-11 flex-row items-center gap-3 rounded-(--radius-inset) transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] motion-reduce:transition-none ${focusRing} ${props.compact ? "justify-center" : "px-2"}`}>
      <View class={`w-[30px] items-center ${LAYER} group-active:scale-90`}><View style={hover.style}><Icon name={props.icon} size={22} color={selected() ? "foreground" : "muted-foreground"} /></View></View>
      <If when={!props.compact}><Text class={`text-base ${LAYER} group-hover:translate-x-0.5 ${selected() ? "font-semibold text-foreground" : "font-normal text-muted-foreground group-hover:text-foreground"}`}>{props.label}</Text></If>
    </Button>
  </View>;
}

/** One library entry: a page of yours, or a playlist. */
interface Entry { key: string; label: string; testID?: string; icon?: string; liked?: boolean; image?: string; open: () => void; selected: () => boolean; playing?: () => boolean }

function entries(): Entry[] {
  return [
    { key: "create", label: "新建歌单", testID: "create-playlist", icon: "plus", open: nav.newPlaylist, selected: () => false },
    { key: "liked", label: "喜欢的音乐", testID: "nav-liked", liked: true, open: () => nav.navigate("liked", true), selected: () => nav.page() === "liked" },
    { key: "downloads", label: s.downloading().length ? `下载 · ${s.downloading().length}` : "下载", testID: "nav-downloads", icon: "download", open: () => nav.navigate("downloads", true), selected: () => nav.page() === "downloads" },
    { key: "history", label: "最近播放", testID: "nav-history", icon: "clock", open: () => nav.navigate("history", true), selected: () => nav.page() === "history" },
    { key: "stats", label: "聆听统计", testID: "nav-stats", icon: "stats", open: () => nav.navigate("stats", true), selected: () => nav.page() === "stats" },
    { key: "together", label: together.room() ? `一起听 · ${together.room()!.roomCode}` : "一起听", testID: "nav-together", icon: "users", open: () => nav.navigate("together", true), selected: () => nav.page() === "together" },
    ...s.playlists().map((playlist): Entry => ({
      key: playlist.id, label: playlist.name, image: playlist.tracks[0]?.artwork, icon: "queue",
      open: () => nav.openPlaylist(playlist.id), selected: () => nav.page() === "playlist" && nav.selectedPlaylist() === playlist.id,
      playing: () => p.queueTitle() === playlist.name,
    })),
  ];
}

function LibraryRow(props: { item: Entry | undefined; index: number; compact: boolean; wave: ReturnType<typeof createListWave> }) {
  const { style: entrance, cover: coverIn, text: textIn } = untracked(() => listItemEntrance({ wave: props.wave, key: () => props.item?.key ?? "", index: () => props.index, axis: "translateX", turns: WAVE.rows }));
  const current = () => props.item?.playing?.() ?? false;
  return <Button testID={props.item?.testID} accessibilityLabel={props.item?.label ?? ""} selected={props.item?.selected() ?? false} onPress={() => props.item?.open()} tooltip={props.compact ? <Hint label={props.item?.label ?? ""} /> : undefined} style={entrance}
    class={`group h-11 flex-row items-center gap-3 rounded-(--radius-inset) px-2 transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] active:bg-muted motion-reduce:transition-none ${focusRing} ${props.compact ? "justify-center" : ""}`}>
    <View style={coverIn}>
      <If when={props.item?.image} else={<View class={`${props.compact ? "size-9" : "size-[30px]"} items-center justify-center rounded-full ${props.item?.liked ? "bg-liked" : "bg-secondary"} ${LAYER} group-hover:scale-110 group-active:scale-95`}><Icon name={props.item?.liked ? "heart" : props.item?.icon ?? "music"} filled={props.item?.liked} size={props.compact ? 16 : 14} color={props.item?.liked ? "liked-foreground" : "foreground"} /></View>}>
        <Cover src={props.item?.image ?? ""} size={props.compact ? 36 : 30} round fallback={glyph(props.item?.icon ?? "music")} class={`${LAYER} group-hover:scale-110 group-active:scale-95`} />
      </If>
    </View>
    <If when={!props.compact}>
      <View class="min-w-0 flex-1" style={textIn}><Text class={`line-clamp-1 text-sm font-medium ${current() ? "text-primary" : "text-foreground"}`}>{props.item?.label ?? ""}</Text></View>
      <If when={current()}><PlayingBars playing={p.playing()} size={12} /></If>
    </If>
  </Button>;
}

function LibraryPanel(props: { compact: boolean }) {
  const scroll = createAnimatedValue(0);
  const wave = createListWave({ isTop: () => true });
  const selectedIndex = () => entries().findIndex((entry) => entry.selected());
  return <View accessibilityLabel="你的音乐" class="relative min-h-0 flex-1 overflow-hidden rounded-(--radius-panel) border border-border bg-card">
    <SlidingSelection index={selectedIndex} top={8} scroll={scroll} />
    <List each={entries()} keyExtractor={(entry) => entry.key} estimatedItemSize={48} snapToInterval={48} snapToAlignment="start" scrollValue={scroll} contentClass="px-2 pt-2 pb-6" class="flex-1">
      {(entry, index) => <View class="pb-1"><LibraryRow item={entry()} index={index()} compact={props.compact} wave={wave} /></View>}
    </List>
    <View class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent" />
  </View>;
}

/** The account at the sidebar's foot (its page), and the settings. */
function AccountPanel(props: { compact: boolean }) {
  const name = () => account.currentAccount()?.name || "登录 YouTube Music";
  return <View class={`gap-1 rounded-(--radius-panel) border border-border bg-card p-2 ${props.compact ? "items-center" : "flex-row items-center"}`}>
    <Button testID="header-account" accessibilityLabel={name()} selected={nav.page() === "account"} onPress={() => nav.navigate("account", true)} tooltip={props.compact ? <Hint label={name()} /> : undefined}
      class={`group h-11 min-w-0 flex-row items-center gap-3 rounded-(--radius-inset) transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] selected:bg-secondary motion-reduce:transition-none ${focusRing} ${props.compact ? "w-11 justify-center" : "flex-1 px-2"}`}>
      <Cover src={account.currentAccount()?.avatar ?? ""} size={30} round fallback="user" class={LAYER} />
      <If when={!props.compact}><Text class="line-clamp-1 flex-1 text-sm font-semibold text-foreground">{name()}</Text></If>
    </Button>
    <IconButton testID="nav-settings" name="settings" label="设置" hint pressed={nav.page() === "settings"} onPress={() => nav.navigate("settings", true)} />
  </View>;
}

export function Sidebar(props: { compact: boolean }) {
  const index = () => pages.findIndex((item) => item.page === nav.activeTab());
  return <View testID="desktop-sidebar" role="navigation" class="min-h-0 flex-1 gap-2">
    <View class="relative gap-1 rounded-(--radius-panel) border border-border bg-card p-2">
      <SlidingSelection index={index} top={8} />
      <Each of={pages}>{(item) => <NavItem page={item().page} label={item().label} icon={glyph(item().icon)} compact={props.compact} />}</Each>
    </View>
    <LibraryPanel compact={props.compact} />
    <AccountPanel compact={props.compact} />
  </View>;
}
