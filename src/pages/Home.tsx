import { Scroll, Text, View, computed, effect, untracked, windowSize } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import { CatalogShelf } from "../components/Discovery";
import { CardRow, TrackRow } from "../components/Music";
import { Heading, pageWave } from "../components/Page";
import { Icon } from "../icons";
import { Chip, Empty, Pill, SectionTitle, ROW, narrow, action } from "../ui";
import { pageEnd } from "../layout";
import { CardsSkeleton, Reveal } from "../spotish/components/ui/feedback";
import { IconButton } from "../spotish/components/ui/controls";
import { enter, waveDelay } from "../spotish/components/ui/motion";

// Home, as the Spotify workspace's (src/spotish/pages/home.tsx): the
// greeting, then the sections of the day as rows of cards; a skeleton
// shaped like them gives way to them, and they come in as a wave each time
// Home opens. YouTube Music adds its mood chips, lists of songs, and what
// is on this device after the online sections.

function Shortcuts() {
  const items = [
    { page: "liked", label: "喜欢的音乐", icon: "heart", detail: () => "喜欢过的歌曲", tint: "bg-liked" },
    { page: "downloads", label: "已下载", icon: "download", detail: () => `${s.downloads().length} 首离线音乐`, tint: "bg-secondary" },
    { page: "history", label: "最近播放", icon: "clock", detail: () => `${s.history().length} 首听过的歌`, tint: "bg-secondary" },
    { page: "together", label: "一起听", icon: "users", detail: () => together.room() ? `房间 ${together.room()!.roomCode}` : "与朋友同步聆听", tint: "bg-secondary" },
  ] as const;
  return <View testID="home-shortcuts" class="flex-row flex-wrap gap-2 px-3">
    <Each of={items}>{item => <View testID={`home-${item().page}`} role="button" accessibilityLabel={item().label} onPress={() => nav.navigate(item().page)} class={`h-14 min-w-0 grow basis-[46%] flex-row items-center gap-3 overflow-hidden rounded-(--radius) bg-secondary pr-2 ${ROW}`}>
      <View class={`size-14 items-center justify-center ${item().tint === "bg-liked" ? "bg-liked" : "bg-muted"}`}><Icon name={item().icon} filled={item().page === "liked"} size={20} color={item().page === "liked" ? "liked-foreground" : "foreground"} /></View>
      <View class="min-w-0 flex-1 gap-0.5"><Text class="line-clamp-1 text-sm font-bold text-foreground">{item().label}</Text><Text class="line-clamp-1 text-xs text-muted-foreground">{item().detail()}</Text></View>
    </View>}</Each>
  </View>;
}

const explore = [{ tab: "new", title: "新歌与新专辑", icon: "spark" }, { tab: "charts", title: "排行榜", icon: "stats" }, { tab: "moods", title: "心情与流派", icon: "compass" }] as const;

export function HomePage(props: { route: nav.Route }) {
  const picks = computed(() => [...new Map([...s.likedTracks(), ...s.libraryTracks()].map(track => [track.id, track])).values()].slice(0, 16));
  const columns = computed(() => Array.from({ length: Math.ceil(picks().length / 4) }, (_, index) => picks().slice(index * 4, index * 4 + 4)));
  const hasContent = () => s.home().sections.some(section => section.items.length || section.moods?.length);
  return <Scroll testID="content-home" class="min-h-0 min-w-0 flex-1" contentClass={`px-3 pt-1 ${pageEnd()}`} keyboardShouldPersistTaps="handled">
    <View testID="page-home" class="w-full min-w-0 max-w-[1600px] gap-8 self-center">
      <View class="gap-4">
        <View style={enter("fadeInUp")}><Heading route={props.route} inset /></View>
        <If when={s.home().chips?.length}><Scroll testID="home-chips" horizontal scrollbar={false} class="h-11 shrink-0" contentClass="flex-row items-center gap-2 px-3">
          <If when={s.selectedHomeChip()}><IconButton testID="home-filter-clear" name="close" label="清除分类" onPress={s.clearHomeFilter} /></If>
          <Each of={s.home().chips || []}>{(chip, index) => <Chip testID={`home-chip-${index()}`} label={chip().title} selected={s.selectedHomeChip()?.title === chip().title} onPress={() => void s.selectHomeChip(chip())} />}</Each>
        </Scroll></If>
      </View>
      <Reveal data={hasContent() ? s.home() : null} placeholder={
        <If when={!hasContent()} else={<CardsSkeleton />}><If when={s.homeLoading()} else={<View testID="home-empty"><Empty icon="compass" title={s.selectedHomeChip() ? `暂时没有${s.selectedHomeChip()!.title}推荐` : "暂时没有首页推荐"} description="可以刷新推荐，或从探索中发现音乐。"><If when={s.selectedHomeChip()}><Pill testID="home-empty-clear" label="查看全部推荐" icon="close" onPress={s.clearHomeFilter} /></If></Empty></View>}>
          <View testID="home-loading" accessibilityLabel={s.selectedHomeChip() ? `正在加载${s.selectedHomeChip()!.title}…` : "正在加载推荐…"}><CardsSkeleton /></View>
        </If></If>}>
        {(home, instant) => {
          // Each time Home (or a chip's selection) shows, its sections come
          // in as a wave, each a little after the one above.
          const wave = pageWave({ afterReveal: !instant });
          effect(() => { home().sections; untracked(() => wave.restart()); });
          return <View class="gap-8">
            <Each of={home().sections}>{(section, index) => <CatalogShelf section={section()} testID={`home-section-${index()}`} index={index()} wave={wave} />}</Each>
          </View>;
        }}
      </Reveal>
      <If when={s.home().continuation}><View class="items-center"><Pill testID="home-more" label={s.homeLoading() ? "正在加载…" : "加载更多推荐"} disabled={s.homeLoading()} onPress={() => void s.loadMoreHome()} /></View></If>
      <If when={!s.selectedHomeChip()}>
        <If when={s.history().length > 0}><View class="gap-2"><View class="px-3"><SectionTitle title="继续聆听" action="全部" onPress={() => nav.navigate("history")} /></View><CardRow items={s.history().slice(0, 12)} class="px-3" /></View></If>
        <If when={picks().length > 0}><View testID="home-local-picks" class="gap-2"><View class="px-3"><SectionTitle title="快速选歌" subtitle="从喜欢的歌曲和音乐库中继续" disabled={p.remoteControlled()} action="播放全部" icon="play" onPress={() => action(() => p.playList(picks(), 0, "快速选歌"))} /></View>
          <Scroll horizontal scrollbar={false} style={{ height: Math.min(4, picks().length) * 60 + 4 }} contentClass="flex-row gap-3"><Each of={columns()}>{(column, at) => <View style={{ width: narrow() ? Math.min(360, windowSize().width - 40) : 380 }}><Each of={column()}>{(track, row) => <View class="pb-1"><TrackRow track={track()} list={picks()} index={at() * 4 + row()} numbered={false} compact /></View>}</Each></View>}</Each></Scroll>
        </View></If>
        <If when={narrow()}><Shortcuts /></If>
        <View class="gap-2 px-3"><SectionTitle title="探索" /><View class="flex-row flex-wrap gap-3">
          <Each of={explore}>{(item, index) => <View role="button" accessibilityLabel={item().title} testID={`discover-${item().tab}`} onPress={() => nav.openExplore(item().tab, item().title)} style={enter("fadeInUp", waveDelay(index(), 3))}
            class={`group min-w-0 grow basis-56 flex-row items-center gap-4 overflow-hidden rounded-(--radius-card) border border-border bg-card p-4 transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] motion-reduce:transition-none ${narrow() ? "h-16" : "h-20"}`}>
            <View class="size-11 items-center justify-center rounded-full bg-secondary transition duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none"><Icon name={item().icon} size={20} color="foreground" /></View>
            <Text class="flex-1 text-base font-bold text-foreground">{item().title}</Text>
            <View class="opacity-0 transition duration-200 ease-out group-hover:translate-x-0.5 group-hover:opacity-100 motion-reduce:transition-none"><Icon name="right" size={18} color="muted-foreground" /></View>
          </View>}</Each>
        </View></View>
      </If>
      <View class="items-center"><Pill testID="home-refresh" label={s.homeLoading() ? "正在刷新…" : "刷新推荐"} icon="refresh" disabled={s.homeLoading()} onPress={() => void s.loadHome()} /></View>
    </View>
  </Scroll>;
}
