import { Text, View, Scroll, List, Clipboard, signal, computed, effect, cleanup, createAnimatedValue, createMotion, windowSize, reduceMotion, colorScheme, type ListRef, type JSX, type Motion, type MotionSpec } from "nsh";
import { Button, Dialog, Tab, Tabs, Toolbar } from "nsh/base";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import { Icon } from "../icons";
import { SongMenu, TrackRow, shareTrack, songCommands } from "./Music";
import { SleepTimerButton } from "./SleepTimer";
import { Label, Tool, Pill, Art, Press, CommandMenu, Empty, palette as c, narrow, touch, spacious, action, say, time } from "../ui";
import { motion, motionDuration, transition } from "../motion";
import { barSize } from "../layout";
import { coverColorsQuery } from "../coverColors";
import { BarSlider, Cover, focusRing, IconButton, PlayButton } from "../spotish/components/ui/controls";
import { Digits } from "../spotish/components/ui/digits";
import { MusicLight, PlayerGlass } from "../spotish/components/ui/toolbar-fx";
import { LightMenu } from "../spotish/components/player/light-menu";
import { NEW_COVER } from "../spotish/components/player/parts";
import { lightEffect } from "../spotish/state/visual";
import { animateLayoutOn, enter, lazyMotion } from "../spotish/components/ui/motion";
import { DURATION, EASING, SCALE } from "../spotish/components/ui/tokens";
import type { IconName } from "../spotish/components/ui/icons";
import type { Track } from "../model";

// The player as the Spotify workspace draws it (src/spotish/components/
// player): the desktop's bar, a pill floating over the pages with the music
// light inside it; the phone's mini player; and Now Playing, the light
// rising from the bottom of the page. Made of the parts below.

const splitPlayer = () => windowSize().width >= 960 && windowSize().height >= 540;
const shortLandscape = () => windowSize().width >= 600 && windowSize().height < 540;
const waitingToPlay = () => p.playbackPhase() === "resolving" || p.playbackPhase() === "buffering";
const pauses = () => p.playing() || waitingToPlay();
const playbackLabel = () => ({ idle: "待播放", resolving: "正在连接音源…", buffering: "正在缓冲…", playing: "正在播放", paused: "已暂停", error: "播放失败" }[p.playbackPhase()]);
const nextLabel = () => {
  const next = p.nextPreparation();
  if (!next || next.trackId !== p.upNext()?.id) return "接下来";
  return next.state === "cached" ? "开头已缓冲" : next.state === "ready" ? "音源已准备" : "正在准备下一首…";
};

/** Shuffle, previous, play / pause, next and repeat (spotish
 * `TransportControls`). `quiet`: a faint play disc. */
function TransportControls(props: { large?: boolean; minimal?: boolean; quiet?: boolean; playTestID?: string }) {
  const icon = () => (props.large ? 22 : 18);
  const locked = () => p.remoteControlled();
  return <View class={`flex-row items-center ${props.large ? "gap-6" : "gap-4"}`} role="toolbar" accessibilityLabel="播放控制">
    <If when={!props.minimal}><IconButton name="shuffle" label="随机播放" size={18} pressed={p.shuffle()} tinted disabled={locked()} onPress={p.toggleShuffle} /></If>
    <IconButton name="skipBack" label="上一首" size={icon()} disabled={locked()} onPress={() => void action(p.previous)} />
    <PlayButton testID={props.playTestID} labels={["播放", "暂停"]} tinted quiet={props.quiet} playing={pauses()} size={props.large ? 56 : 36} disabled={locked()} onPress={() => void action(p.togglePlay)} />
    <IconButton name="skipForward" label="下一首" size={icon()} disabled={locked()} onPress={() => void action(p.next)} />
    <If when={!props.minimal}><IconButton name={p.repeat() === "one" ? "repeatOne" : "repeat"} label={p.repeat() === "off" ? "开启列表循环" : p.repeat() === "all" ? "开启单曲循环" : "关闭循环"} size={18} pressed={p.repeat() !== "off"} tinted disabled={locked()} onPress={p.cycleRepeat} /></If>
  </View>;
}

/** The position, 0..1, as a native value that runs on between the player's
 * ticks, so the bar moves every frame with no JS. */
function positionFill() {
  const fill = createAnimatedValue(0);
  let trackId = "";
  effect(() => {
    const id = p.currentTrack()?.id || "";
    const duration = p.duration() || p.currentTrack()?.duration || 0;
    const ratio = duration ? Math.min(1, p.position() / duration) : 0;
    const jump = id !== trackId;
    trackId = id;
    if (jump || !p.playing() || reduceMotion()) fill.set(ratio);
    else void fill.timing(ratio, { duration: motion.progress, easing: "linear" });
  });
  return fill;
}

/** The playback position (spotish `SeekBar`): the bar, the times beside it
 * (`inline`) or under it. Dragging previews; the player gets one seek as
 * it is let go. */
function SeekBar(props: { inline?: boolean; quiet?: boolean; testID?: string; status?: boolean }) {
  const draft = signal<number | undefined>();
  effect(() => { p.currentTrack()?.id; draft.set(undefined); });
  const fill = positionFill();
  const duration = () => p.duration() || p.currentTrack()?.duration || 1;
  const value = () => draft() ?? p.position();
  const times = `text-xs text-muted-foreground ${props.quiet ? "opacity-70" : ""}`;
  const slider = <View testID={props.testID} class="min-w-0 flex-1"><BarSlider label="播放进度" tinted quiet={props.quiet} value={value()} max={duration()} fill={fill} disabled={p.remoteControlled()} class="flex-1"
    onChange={(v) => { draft.set(v); fill.set(v / duration()); }} onChangeEnd={(v) => { void action(() => p.seek(v)); draft.set(undefined); }} /></View>;
  return <If when={props.inline} else={<View class="w-full gap-1">
    <View class="flex-row">{slider}</View>
    <View class="flex-row justify-between"><Digits class={times}>{time(value())}</Digits><Text testID={props.status ? "player-status" : undefined} class={`text-xs ${waitingToPlay() ? "text-foreground" : "font-mono tabular-nums text-muted-foreground"}`}>{waitingToPlay() ? playbackLabel() : time(duration())}</Text></View>
  </View>}>
    <View class="w-full flex-row items-center gap-2"><View class="min-w-10 items-end"><Digits class={`whitespace-nowrap ${times}`}>{time(value())}</Digits></View>{slider}<View class="min-w-10"><Digits class={`whitespace-nowrap ${times}`}>{time(p.duration() || p.currentTrack()?.duration || 0)}</Digits></View></View>
  </If>;
}

/** Mute and the volume (spotish `VolumeControl`). */
function VolumeControl(props: { quiet?: boolean }) {
  const icon = (): IconName => p.volume() <= 0 ? "volumeMute" : p.volume() < 0.5 ? "volumeLow" : "volume";
  return <View class="flex-row items-center">
    <IconButton name={icon()} label={p.volume() ? "静音" : "取消静音"} onPress={() => s.updateSettings({ volume: p.volume() ? 0 : 0.7 })} />
    <View class="w-24 pl-1 pr-3"><BarSlider tinted quiet={props.quiet} label="音量" value={p.volume()} max={1} class="w-full" onChange={(volume) => s.updateSettings({ volume })} onChangeEnd={(volume) => s.updateSettings({ volume })} /></View>
  </View>;
}

const LIKE_DOTS = 8;
const LIKE_SPRING: [number, number, number, number] = [0.34, 1.96, 0.64, 1];
const LIKE_POP: MotionSpec = { keyframes: [{ scale: 1 }, { scale: 0.82, offset: 0.3 }, { scale: 1 }], duration: DURATION.slow, easing: LIKE_SPRING };
const UNLIKE_DIP: MotionSpec = { keyframes: [{ scale: 1 }, { scale: SCALE.press }, { scale: 1 }], duration: DURATION.fast, easing: EASING.out };
function burst(i: number, k: number): MotionSpec {
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  const angle = (((360 / LIKE_DOTS) * i + rand(-16, 16)) * Math.PI) / 180;
  const reach = 20 * k * rand(0.68, 1.18);
  const x = Math.cos(angle) * reach, y = Math.sin(angle) * reach, size = rand(0.6, 1.4);
  return { keyframes: [{ opacity: 0, translateX: 0, translateY: 0, scale: 0.4 * size }, { opacity: 1, translateX: x * 0.25, translateY: y * 0.25, scale: size, offset: 0.2 }, { opacity: 0, translateX: x, translateY: y, scale: rand(0.35, 0.75) * size }], duration: Math.round(600 * rand(0.78, 1.22)), delay: Math.round(rand(0, 70)), easing: EASING.out };
}
/** Like (spotish `LikeButton`): liking pops the heart and sprays red dots;
 * unliking only dips it. Only the press plays it, never a track change. */
function LikeButton(props: { track: Track; size?: number }) {
  const pop = lazyMotion();
  let dots: Motion[] = [];
  const made = signal(false);
  const bursting = signal(false);
  let burstId = 0;
  const makeDots = () => { if (!dots.length) { dots = Array.from({ length: LIKE_DOTS }, () => createMotion({ initial: { opacity: 0 } })); made.set(true); } return dots; };
  cleanup(() => { pop.stop(); for (const d of dots) d.stop(); });
  const k = () => (props.size ?? 18) / 16;
  const liked = () => s.isLiked(props.track.id);
  const press = () => {
    const liking = !liked();
    s.toggleLike(props.track);
    if (reduceMotion()) return;
    const id = ++burstId;
    if (!liking) { for (const d of dots) d.stop(); bursting.set(false); void pop.play(UNLIKE_DIP); return; }
    void pop.play(LIKE_POP);
    const flying = makeDots();
    bursting.set(true);
    void Promise.all(flying.map((d, i) => d.play(burst(i, k())))).then(() => { if (id === burstId) bursting.set(false); });
  };
  return <View class="items-center justify-center">
    <View style={pop.style}><IconButton name="heartFilled" label={liked() ? "取消喜欢" : "喜欢"} size={props.size ?? 18} pressed={liked()} pressedColor="liked" onPress={press} /></View>
    <If when={bursting() && made()}>{makeDots().map((d) => <View class="pointer-events-none absolute rounded-full bg-liked" style={{ width: 2.5 * k(), height: 2.5 * k(), ...d.style }} />)}</If>
  </View>;
}

const NEW_WORDS: MotionSpec = { keyframes: [{ opacity: 0, translateY: 6 }, { opacity: 1, translateY: 0 }], duration: 320, delay: 80, easing: "easeOut" };
/** What plays (spotish `NowPlayingSummary`): the cover, which settles in
 * with a small overshoot when the track changes, and its words rising after
 * it; it opens the player. */
function NowPlayingSummary(props: { cover: number; round?: boolean; center?: boolean }) {
  const coverIn = lazyMotion();
  const wordsIn = lazyMotion();
  let shown = p.currentTrack()?.id;
  effect(() => {
    const now = p.currentTrack()?.id;
    if (now !== shown && now) { void coverIn.play(NEW_COVER); void wordsIn.play(NEW_WORDS); }
    shown = now;
  });
  cleanup(() => { coverIn.stop(); wordsIn.stop(); });
  const status = () => p.playbackError() ? "播放失败 · 点按查看" : waitingToPlay() ? playbackLabel() : p.currentTrack()?.artist ?? "";
  return <Button testID="open-player" accessibilityLabel="打开播放器" onPress={() => nav.showPlayer()} class={`group min-w-0 flex-1 flex-row items-center gap-3 rounded-full pr-2 active:scale-[0.98] motion-reduce:active:scale-100 ${focusRing}`}>
    <View class="transition duration-150 ease-out group-hover:opacity-85 motion-reduce:transition-none"><View style={coverIn.style}><Art track={p.currentTrack()} size={props.cover} radius={props.round ? props.cover / 2 : 6} /></View></View>
    <View class={`min-w-0 flex-1 gap-0.5 ${props.center ? "items-center" : ""}`} style={wordsIn.style}>
      <Text class={`line-clamp-1 text-sm font-semibold text-foreground ${props.center ? "text-center" : ""}`}>{p.currentTrack()?.title}</Text>
      <Text testID="mini-player-status" class={`line-clamp-1 text-xs ${p.playbackError() ? "text-destructive" : "text-muted-foreground"}`}>{status()}</Text>
    </View>
  </Button>;
}

/** The desktop's bar (spotish `PlayerBar`): a 72pt pill over the pages, the
 * music light inside it. Full: what plays and Like on the left quarter, the
 * transport over the position in the middle, lyrics, the queue, the volume
 * and the light's menu on the right. Compact: one row. Stacked: two. */
export function PlayerBar(props: { sidePlayer: boolean; onSidePlayer: () => void }) {
  const stacked = () => barSize() === "stacked";
  const tiny = () => windowSize().width < 560;
  const colors = coverColorsQuery(() => p.currentTrack()?.artwork ?? "");
  return <If when={p.currentTrack()}>{(track) => <View style={enter("fadeInUp", 120)}><View class={`shadow-xl ${stacked() ? "rounded-[36px]" : "rounded-full"}`}>
    <Toolbar accessibilityLabel="播放器">
      <PlayerGlass effect={lightEffect()} colors={colors()} playing={p.playing()} testID="mini-player" radius={stacked() ? 36 : undefined} class={stacked() ? "flex-1 gap-2 rounded-[36px] px-3.5 pb-2.5 pt-3.5" : "h-18 flex-1 flex-row items-center justify-between gap-4 rounded-full pl-3.5 pr-5"}>
        <If when={barSize() === "full"} else={<If when={stacked()} else={<>
          <View class="min-w-0 flex-1 flex-row items-center gap-2"><NowPlayingSummary cover={44} round /><LikeButton track={track()} /></View>
          <TransportControls quiet playTestID="mini-play-pause" />
          <IconButton testID="mini-queue" name="playlist" label="打开播放队列" onPress={() => nav.showPlayer("queue")} />
          <LightMenu placement="top" />
        </>}><>
          <View class="h-11 flex-row items-center gap-2"><NowPlayingSummary cover={44} round /><LikeButton track={track()} /></View>
          <View class="h-10 flex-row items-center justify-between"><IconButton testID="mini-queue" name="playlist" label="打开播放队列" onPress={() => nav.showPlayer("queue")} /><TransportControls quiet minimal={tiny()} playTestID="mini-play-pause" /><LightMenu placement="top" /></View>
        </></If>}>
          <View class="w-1/4 min-w-0 flex-row items-center gap-2"><NowPlayingSummary cover={44} round /><LikeButton track={track()} /></View>
          <View class="max-w-180 flex-1 items-center gap-1"><TransportControls quiet playTestID="mini-play-pause" /><SeekBar inline quiet /></View>
          <View class="w-1/4 flex-row items-center justify-end gap-1 pr-2">
            <IconButton name="microphone" label="歌词" hint onPress={() => nav.showPlayer("lyrics")} />
            <IconButton testID="mini-queue" name="playlist" label="打开播放队列" hint onPress={() => nav.showPlayer("queue")} />
            <If when={spacious()}><IconButton name="sidebarRight" label={props.sidePlayer ? "收起正在播放" : "显示正在播放"} hint pressed={props.sidePlayer} onPress={props.onSidePlayer} /></If>
            <VolumeControl quiet />
            <LightMenu placement="top" />
          </View>
        </If>
      </PlayerGlass>
    </Toolbar>
  </View></View>}</If>;
}

/** The phone's mini player over the tabs (spotish `MiniPlayer`): a card
 * that opens the player. */
export function MiniPlayer() {
  return <If when={p.currentTrack()}>{() => <View testID="mini-player" class="mx-2 mb-2 h-14 flex-row items-center gap-1 rounded-(--radius-card) border border-border bg-secondary pl-2 pr-1" style={enter("fadeInUp", 60)}>
    <NowPlayingSummary cover={40} />
    <PlayButton testID="mini-play-pause" labels={["播放", "暂停"]} tinted playing={pauses()} size={40} disabled={p.remoteControlled()} onPress={() => void action(p.togglePlay)} />
    <IconButton testID="mini-queue" name="playlist" label="打开播放队列" size={20} onPress={() => nav.showPlayer("queue")} />
  </View>}</If>;
}

export function LyricsView() {
  const ref = signal<ListRef | undefined>();
  const follow = signal(true);
  effect(() => { p.currentTrack()?.id; follow.set(true); });
  const text = () => s.lyrics()?.plainLyrics || s.lyrics()?.lines.map(line => line.text).join("\n") || "";
  const offset = () => s.settings().lyricsOffset / 1000;
  const active = computed(() => {
    const lines = s.lyrics()?.lines || [];
    let current = -1;
    for (let index = 0; index < lines.length; index++) if (lines[index].time + offset() <= p.position()) current = index; else break;
    return current;
  });
  effect(() => { const index = active(); if (follow() && index >= 0) ref()?.scrollToIndex({ index, viewPosition: 0.4, animated: !reduceMotion() }); });
  const size = () => s.settings().lyricFontSize === "small" ? 23 : s.settings().lyricFontSize === "large" ? 36 : 29;
  return <View testID="lyrics-panel" style={{ flex: 1, gap: 8, minWidth: 0, minHeight: 0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 0 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Label size={shortLandscape() ? 20 : 24} weight="600">歌词</Label><If when={!shortLandscape() && text()}><Label size={12} color={c().sub}>{s.lyrics()?.lines.length ? "逐行同步 · 点按歌词跳转" : "文本歌词"}</Label></If></View>
      <CommandMenu testID="lyrics-options" label="歌词设置" icon="settings" items={[
        { testID: "lyrics-copy", label: "复制歌词", icon: "share", disabled: !text(), run: () => void action(() => Clipboard.writeText(text()), "歌词已复制") },
        ...([{ value: "small", label: "小号字" }, { value: "medium", label: "标准字号" }, { value: "large", label: "大号字" }] as const).map((item, index) => ({ testID: `lyrics-size-${item.value}`, label: item.label, active: s.settings().lyricFontSize === item.value, separator: index === 0, run: () => s.updateSettings({ lyricFontSize: item.value }) })),
        { label: "居中对齐", active: s.settings().lyricAlignment === "center", separator: true, run: () => s.updateSettings({ lyricAlignment: "center" }) },
        { label: "左侧对齐", active: s.settings().lyricAlignment === "left", run: () => s.updateSettings({ lyricAlignment: "left" }) },
        { testID: "lyrics-reset-offset", label: "重置歌词偏移", icon: "refresh", disabled: s.settings().lyricsOffset === 0, separator: true, run: () => s.updateSettings({ lyricsOffset: 0 }) },
        { label: "重新获取歌词", icon: "refresh", disabled: s.lyricsLoading(), run: () => void s.loadLyrics(p.currentTrack()!) },
        { label: "睡眠定时器", icon: "moon", active: p.sleepActive(), separator: true, run: () => nav.dialog.set("sleep") },
      ]} />
    </View>
    <If when={s.lyricsLoading()}><Scroll style={{ flex: 1, minHeight: 0 }}><Empty icon="lyrics" title="正在获取歌词" description={p.currentTrack()?.title || ""} /></Scroll></If>
    <If when={s.lyricsError()}><Scroll style={{ flex: 1, minHeight: 0 }}><Empty icon="lyrics" title="歌词暂时无法加载" description={s.lyricsError()}><Pill label="重试" icon="refresh" onPress={() => p.currentTrack() && void s.loadLyrics(p.currentTrack()!)} /></Empty></Scroll></If>
    <If when={s.lyrics()?.lines.length} else={
      <If when={!s.lyricsLoading() && !s.lyricsError()}>
        <If when={s.lyrics()?.plainLyrics} else={<Scroll style={{ flex: 1, minHeight: 0 }}><Empty icon="lyrics" title={s.lyrics()?.instrumental ? "纯音乐" : "暂无歌词"} description={s.lyrics()?.instrumental ? "这首歌曲没有人声歌词。" : "可以继续欣赏音乐，或稍后重新获取。"} /></Scroll>}>
          <Scroll style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingHorizontal: 12, paddingVertical: 24 }}><Label size={size()} color={c().sub} style={{ lineHeight: size() * 1.65, textAlign: s.settings().lyricAlignment }}>{s.lyrics()?.plainLyrics}</Label></Scroll>
        </If>
      </If>
    }>
      <List ref={ref.set} each={s.lyrics()!.lines} estimatedItemSize={92} style={{ flex: 1, minHeight: 0 }} contentStyle={{ paddingTop: shortLandscape() ? 28 : 72, paddingBottom: shortLandscape() ? 60 : 120, paddingHorizontal: 4 }} scrollbar={false} onScrollDragStart={() => follow.set(false)} keyExtractor={(line, index) => `${line.time}-${index}`}>
        {(line, index) => <Press label={`${time(line().time)} ${line().text}`} disabled={p.remoteControlled()} onPress={() => { void action(() => p.seek(line().time + offset())); follow.set(true); }} style={{ paddingVertical: 14, minHeight: 68, paddingHorizontal: 8, alignItems: s.settings().lyricAlignment === "center" ? "center" : "flex-start" }}>
          <Label size={size()} weight="600" color={index() === active() ? c().text : c().faint} style={{ lineHeight: size() * 1.4, textAlign: s.settings().lyricAlignment, ...transition("color", motion.instant) }}>{line().text || "♪"}</Label>
        </Press>}
      </List>
      <If when={!follow()}><View style={{ flexDirection: "row", justifyContent: "center", flexShrink: 0 }}><Pill label="回到当前歌词" icon="lyrics" onPress={() => follow.set(true)} /></View></If>
    </If>
    <If when={s.lyrics()?.lines.length}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
      <Tool icon="left" label="歌词提前 100 毫秒" onPress={() => s.updateSettings({ lyricsOffset: s.settings().lyricsOffset - 100 })} />
      <Label size={11} color={c().faint}>{s.settings().lyricsOffset === 0 ? "歌词偏移" : `${s.settings().lyricsOffset} ms`}</Label>
      <Tool icon="right" label="歌词延后 100 毫秒" onPress={() => s.updateSettings({ lyricsOffset: s.settings().lyricsOffset + 100 })} />
    </View></If>
  </View>;
}

export function QueueView() {
  const editing = signal(false);
  const ref = signal<ListRef | undefined>();
  const upcoming = computed(() => p.queue().slice(p.currentIndex() + 1));
  const minutes = computed(() => Math.ceil(upcoming().reduce((sum, track) => sum + track.duration, 0) / 60));
  const revealCurrent = () => ref()?.scrollToIndex({ index: p.currentIndex(), viewPosition: 0.15, animated: !reduceMotion() });
  effect(() => { const index = p.currentIndex(); if (index >= 0 && !editing()) revealCurrent(); });
  return <View testID="queue-panel" style={{ flex: 1, gap: 12, minWidth: 0, minHeight: 0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, minWidth: 0 }}>
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}><Label size={shortLandscape() ? 20 : 24} weight="600">播放队列</Label><Label testID="queue-summary" size={12} color={c().sub} lines={1}>{p.shuffle() ? `随机播放 · ${p.queue().length} 首` : `第 ${p.currentIndex() + 1} / ${p.queue().length} 首 · 后续 ${upcoming().length} 首${minutes() ? `，约 ${minutes()} 分钟` : ""}`}</Label></View>
      <If when={editing()} else={<Tool testID="queue-current" icon="headphones" label="回到当前歌曲" onPress={revealCurrent} />}><Tool testID="queue-edit-done" icon="check" label="完成排序" active onPress={() => editing.set(false)} /></If>
      <CommandMenu testID="queue-actions" label="队列操作" items={[
        { label: editing() ? "完成排序" : "调整顺序", icon: "sort", disabled: p.remoteControlled(), run: () => editing.update(value => !value) },
        { label: "保存为歌单", icon: "plus", run: () => nav.addToPlaylist(p.queue()) },
        { label: "下载队列", icon: "download", run: () => { for (const track of p.queue()) void s.downloadTrack(track).catch(s.showError); say("已加入下载"); } },
        { label: "播放设置", icon: "settings", run: () => { nav.fullPlayer.set(false); nav.settingsSection.set("player"); nav.navigate("settings"); } },
        { testID: "queue-sleep", label: "睡眠定时器", icon: "moon", active: p.sleepActive(), run: () => nav.dialog.set("sleep") },
        { testID: "queue-clear-upcoming", label: p.shuffle() ? "移除当前之后的歌曲" : "清空待播", icon: "queue", disabled: p.remoteControlled() || !upcoming().length, separator: true, run: () => { p.clearUpcoming(); say("已移除当前之后的歌曲，保留当前歌曲"); } },
        { label: "清空队列", icon: "trash", danger: true, disabled: p.remoteControlled(), run: p.clearQueue },
      ]} />
    </View>
    <List testID="queue-list" ref={ref.set} each={p.queue()} style={{ flex: 1, minHeight: 0, minWidth: 0 }} estimatedItemSize={76} keyExtractor={(track, index) => `${track.id}-${index}`} contentStyle={{ paddingBottom: 16 }}>
      {(track, index) => <View testID={`queue-row-${index()}`} style={{ gap: 1, minWidth: 0 }}>
        <If when={index() === p.currentIndex()}><Label testID="queue-current-status" color={c().accent} size={11} style={{ marginTop: 12, marginBottom: 5 }}>{playbackLabel()}</Label></If>
        <If when={!p.shuffle() && index() === p.currentIndex() + 1}><Label color={c().faint} size={11} style={{ marginTop: 12, marginBottom: 5 }}>{nextLabel()}</Label></If>
        <TrackRow compact menu={false} active={index() === p.currentIndex()} track={track()} playLabel={`${index() === p.currentIndex() && (p.playing() || waitingToPlay()) ? "暂停" : "播放"} ${track().title}`} onPlay={() => { if (!p.remoteControlled()) void action(() => index() === p.currentIndex() ? p.togglePlay() : p.playAt(index())); }} trailing={
              <CommandMenu testID={`queue-song-menu-${index()}`} label={editing() ? "调整这首歌" : `队列操作 ${track().title}`} icon={editing() ? "sort" : "more"} items={[
                { testID: `queue-next-${index()}`, label: "移到下一首", icon: "next", disabled: p.remoteControlled() || index() === p.currentIndex(), run: () => { p.moveQueueNext(index()); say("已移到下一首"); } },
                { label: "上移", icon: "up", disabled: p.remoteControlled() || index() === 0, run: () => p.moveQueue(index(), index() - 1) },
                { label: "下移", icon: "down", disabled: p.remoteControlled() || index() === p.queue().length - 1, run: () => p.moveQueue(index(), index() + 1) },
                { label: "从队列移除", icon: "close", disabled: p.remoteControlled(), run: () => p.removeFromQueue(index()) },
                ...(!editing() ? songCommands(track()).map((item, at) => at === 0 ? { ...item, separator: true } : item) : []),
              ]} />
        } />
      </View>}
    </List>
    <If when={!shortLandscape()} else={<Label size={11} color={c().sub} lines={1}>{p.remoteControlled() ? "与主持人同步" : s.settings().autoRadio ? "队列结束后自动续播" : "自动续播已关闭"}</Label>}>
    <View style={{ padding: 14, borderRadius: 12, backgroundColor: c().wash, gap: 8, flexShrink: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Icon name="radio" size={20} color={c().accent} />
        <Label size={12} lines={2} style={{ flex: 1, minWidth: 0 }}>{p.remoteControlled() ? "与主持人的队列同步" : p.radioLoading() ? "正在获取电台推荐…" : s.settings().autoRadio ? "队列结束后自动续播" : "自动续播已关闭"}</Label>
        <If when={!p.remoteControlled()}><Tool testID="queue-autoplay" icon={s.settings().autoRadio ? "check" : "plus"} active={s.settings().autoRadio} label={s.settings().autoRadio ? "关闭自动续播" : "开启自动续播"} onPress={() => s.updateSettings({ autoRadio: !s.settings().autoRadio })} /></If>
      </View>
      <If when={p.radioError()}><Label size={12} color={c().danger}>{p.radioError()}</Label><Pill label="重试电台" onPress={() => void action(p.extendRadio)} /></If>
    </View></If>
  </View>;
}

/** Now Playing's words and controls (spotish's details): title and
 * artist with Like, the quiet position with its times, the transport with
 * a 56pt faint play disc, then the sleep timer. */
function Transport(props: { onHeight: (height: number) => void }) {
  const track = p.currentTrack;
  const artist = () => { nav.fullPlayer.set(false); if (track()?.artistId) nav.browse({ id: track()!.artistId!, browseId: track()!.artistId!, title: track()!.artist, subtitle: "", artwork: "", type: "artist" }); else nav.performSearch(track()?.artist || "", "artists"); };
  return <View onLayout={({ bounds }) => props.onHeight(bounds.size.height)} class="min-w-0 shrink-0 gap-6">
    <View class="min-w-0 flex-row items-center gap-3" style={enter("fadeInUp", 140)}>
      <View class="min-w-0 flex-1 gap-1" selectable>
        <Text class={`line-clamp-2 font-extrabold text-foreground ${shortLandscape() ? "text-2xl" : "text-3xl"}`}>{track()?.title}</Text>
        <Button accessibilityLabel="查看歌手" onPress={artist} class={`self-start rounded-sm active:opacity-70 ${focusRing}`}><Text class="line-clamp-1 text-base text-muted-foreground hover:text-foreground hover:underline">{track()?.artist}</Text></Button>
      </View>
      <IconButton name="share" label="分享歌曲" size={20} onPress={() => track() && shareTrack(track()!)} />
      <If when={track()}>{(current) => <LikeButton track={current()} size={24} />}</If>
    </View>
    <View style={enter("fadeInUp", 200)}><SeekBar quiet testID="player-seek" status /></View>
    <View class="items-center gap-2" style={enter("fadeInUp", 260)}>
      <TransportControls large quiet playTestID="player-play-pause" />
      <SleepTimerButton />
    </View>
    <If when={p.remoteControlled()}><Text class="text-center text-xs text-muted-foreground">由主持人控制 · {together.room()?.roomCode}</Text></If>
    <If when={p.playbackError()}><View role="alert" class="gap-2.5 rounded-(--radius-card) border border-border bg-card p-3"><Text class="line-clamp-4 text-xs text-destructive">{p.playbackError()}</Text><Pill label="重试播放" icon="refresh" onPress={() => void action(p.retryPlayback)} /></View></If>
  </View>;
}

/** The cover, which settles in with a small overshoot as the track changes
 * and zooms in as Now Playing opens. */
function CoverArt(props: { size: number }) {
  const change = createMotion();
  let id = p.currentTrack()?.id;
  effect(() => {
    const next = p.currentTrack()?.id;
    if (next !== id) { id = next; if (!reduceMotion()) void change.play(NEW_COVER); }
  });
  cleanup(() => change.stop());
  return <View class="shrink-0 items-center justify-center" style={enter("zoomIn", 60)}><View style={change.style}>
    <Art track={p.currentTrack()} size={props.size} radius={16} style={{ boxShadow: "0 20px 50px #00000073" }} />
  </View></View>;
}

function PanelFade(props: { children?: JSX.Element }) {
  const opacity = createAnimatedValue(1);
  let tab = nav.playerTab();
  effect(() => {
    const next = nav.playerTab();
    if (next !== tab) {
      tab = next;
      opacity.set(reduceMotion() ? 1 : 0.65);
      void opacity.timing(1, { duration: motionDuration(motion.fast), easing: "easeOut" });
    }
  });
  return <View style={{ flex: 1, minWidth: 0, minHeight: 0, opacity }}>{props.children}</View>;
}

/** Song, lyrics and queue: a capsule whose indicator slides. */
function PlayerTabs() {
  const tabs = [{ value: "cover", label: "歌曲", icon: "album" }, { value: "lyrics", label: "歌词", icon: "lyrics" }, { value: "queue", label: "播放队列", icon: "queue" }] as const;
  const selected = () => splitPlayer() && nav.playerTab() === "cover" ? "queue" : nav.playerTab();
  return <Tabs testID="player-tabs" class="flex-row gap-1 rounded-full border border-border bg-card p-1" indicatorClass="top-1 bottom-1 rounded-full bg-secondary transition-all duration-240 ease-in-out motion-reduce:transition-none">
    <Each of={splitPlayer() ? tabs.slice(1) : tabs} key={item => item.value}>{item =>
      <Tab testID={`player-tab-${item().value}`} accessibilityLabel={item().label} selected={selected() === item().value} onPress={() => nav.playerTab.set(item().value)}
        class={`group h-10 min-w-0 flex-1 flex-row items-center justify-center gap-2 rounded-full active:opacity-70 ${focusRing}`}>
        <Icon name={item().icon} size={16} color={selected() === item().value ? "foreground" : "muted-foreground"} />
        <Text class={`text-sm ${selected() === item().value ? "font-semibold text-foreground" : "font-normal text-muted-foreground group-hover:text-foreground"}`}>{item().value === "queue" ? "队列" : item().label}</Text>
      </Tab>
    }</Each>
  </Tabs>;
}

/** Under the lyrics or the queue on a narrow screen: what plays, play and
 * next, over the position. */
function CompactTransport() {
  return <View class="min-w-0 shrink-0 gap-1 pt-1.5">
    <View class="min-w-0 flex-row items-center gap-2">
      <Button accessibilityLabel="回到封面" onPress={() => nav.playerTab.set("cover")} class={`min-w-0 flex-1 flex-row items-center gap-3 rounded-(--radius) active:opacity-70 ${focusRing}`}>
        <Art track={p.currentTrack()} size={42} />
        <View class="min-w-0 flex-1 gap-0.5"><Text class="line-clamp-1 text-sm font-semibold text-foreground">{p.currentTrack()?.title}</Text><Text class="line-clamp-1 text-xs text-muted-foreground">{p.currentTrack()?.artist}</Text></View>
      </Button>
      <PlayButton testID="player-play-pause" labels={["播放", "暂停"]} tinted playing={pauses()} size={40} disabled={p.remoteControlled()} onPress={() => void action(p.togglePlay)} />
      <IconButton name="skipForward" label="下一首" disabled={p.remoteControlled()} onPress={() => void action(p.next)} />
    </View>
    <SeekBar quiet testID="player-panel-seek" />
  </View>;
}

function PlaybackDetails() {
  const expanded = signal(false);
  const quality = () => p.streamInfo()?.mimeType?.includes("opus") || p.streamInfo()?.mimeType?.includes("webm") ? "Opus" : p.streamInfo()?.mimeType?.includes("mp4") ? "AAC" : p.streamInfo()?.mimeType?.split(";")[0] || "音频";
  const latency = (milliseconds: number) => milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(2)} 秒`;
  return <View style={{ gap: 8, minWidth: 0 }}>
    <Press testID="playback-details-toggle" label={expanded() ? "收起播放详情" : "播放详情"} onPress={() => expanded.update(value => !value)} style={{ minHeight: touch() ? 48 : 36, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}>
      <Label size={11} color={c().faint} lines={1}>{p.streamInfo() ? `${quality()}${p.streamInfo()?.bitrate ? ` · ${Math.round(p.streamInfo()!.bitrate! / 1000)} kbps` : ""}${p.rate() !== 1 ? ` · ${p.rate()}×` : ""}` : playbackLabel()}</Label>
      <Icon name={expanded() ? "up" : "info"} size={14} color={c().faint} />
    </Press>
    <If when={expanded()}><View testID="playback-details" style={{ gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c().line, backgroundColor: c().card }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Label size={12} color={c().sub}>播放状态</Label><Label size={12} color={c().accent}>{playbackLabel()}</Label></View>
      <If when={p.bufferedPosition() > 0}><View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Label size={12} color={c().sub}>前方已缓冲</Label><Label testID="playback-buffered" size={12}>{Math.max(0, Math.floor(p.bufferedPosition() - p.position()))} 秒</Label></View></If>
      <If when={p.playbackTiming()}>{timing => <>
        <View style={{ height: 1, backgroundColor: c().line }} />
        <Label size={12} weight="600">本次起播{timing().prepared ? " · 已提前准备音源" : ""}</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 70, gap: 5 }}><Label size={11} color={c().sub}>连接音源</Label><Label size={14}>{latency(timing().resolveMs)}</Label></View>
          <View style={{ flex: 1, minWidth: 70, gap: 5 }}><Label size={11} color={c().sub}>播放准备</Label><Label size={14}>{latency(timing().readyMs)}</Label></View>
          <View style={{ flex: 1, minWidth: 70, gap: 5 }}><Label size={11} color={c().sub}>合计</Label><Label testID="playback-start-time" size={14} color={c().accent}>{latency(timing().totalMs)}</Label></View>
        </View>
        <Label size={10} color={c().faint}>从播放请求到引擎报告开始播放</Label>
      </>}</If>
    </View></If>
  </View>;
}

function NextTrack() {
  return <If when={p.repeat() !== "one" ? p.upNext() : undefined}>{track => <Press testID="player-up-next" label="查看接下来的歌曲" onPress={() => nav.playerTab.set("queue")} style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: c().line, backgroundColor: c().card }}>
    <Art track={track()} size={38} radius={6} />
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Label size={11} weight="600" color={c().sub}>下一首 · {nextLabel()}</Label><Label size={12} lines={1}>{track().title}</Label></View>
    <Icon name="queue" size={20} color={c().sub} />
  </Press>}</If>;
}

function PlayerCover(props: { size: number; width: number; onHeight: (height: number) => void }) {
  return <Scroll testID="player-cover-scroll" style={{ flex: 1, minWidth: 0, minHeight: 0 }} scrollbar={false} contentStyle={{ flexDirection: shortLandscape() ? "row" : "column", alignItems: shortLandscape() ? "center" : undefined, justifyContent: "center", flexGrow: 1, gap: shortLandscape() ? 32 : 28, paddingTop: 6, paddingBottom: 12 }}>
    <View style={{ width: shortLandscape() ? props.width : "100%", alignItems: "center", flexShrink: 0 }}><CoverArt size={props.size} /></View>
    <View style={{ flex: shortLandscape() ? 1 : undefined, minWidth: 0, width: shortLandscape() ? undefined : "100%", maxWidth: 600, alignSelf: "center", gap: 8 }}>
      <Transport onHeight={props.onHeight} />
      <PlaybackDetails />
      <If when={!shortLandscape()}><NextTrack /></If>
    </View>
  </Scroll>;
}

function PlayerContent() {
  const bodyHeight = signal(windowSize().height - 156);
  const bodyWidth = signal(windowSize().width - 32);
  const controlsHeight = signal(290);
  const padding = () => splitPlayer() ? 40 : 16;
  const coverWidth = () => splitPlayer() ? (bodyWidth() - 32) / 2.1 : shortLandscape() ? bodyWidth() * 0.36 : bodyWidth();
  const coverSize = () => Math.min(360, coverWidth(), Math.max(shortLandscape() ? 136 : 112, bodyHeight() - (shortLandscape() ? 24 : controlsHeight() + (touch() ? 100 : 88) + (p.repeat() !== "one" && p.upNext() ? 72 : 0))));
  const colors = coverColorsQuery(() => p.currentTrack()?.artwork ?? "");
  animateLayoutOn(() => `${splitPlayer()}|${shortLandscape()}`);
  return <View class="min-h-0 min-w-0 flex-1 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
    {/* The music's light rises from the bottom of the page. */}
    <MusicLight effect={lightEffect()} colors={colors()} playing={p.playing()} reach={windowSize().height * 0.45} />
    <View class="z-10 min-w-0 shrink-0 flex-row items-center gap-2" style={{ paddingHorizontal: padding() - 8, height: shortLandscape() ? 52 : 64 }}>
      <IconButton testID="close-player" name="chevronDown" label="收起播放器" size={24} onPress={() => nav.fullPlayer.set(false)} />
      <View class="min-w-0 flex-1 items-center gap-0.5"><Text class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">正在播放</Text><Text class="line-clamp-1 text-sm font-semibold text-foreground">{p.queueTitle() || "当前播放"}</Text></View>
      <If when={!touch()}><VolumeControl quiet /></If>
      <LightMenu placement="bottom" size={20} />
      <If when={p.currentTrack()}>{track => <SongMenu track={track()} />}</If>
    </View>
    <View testID="player-body" onLayout={({ bounds }) => { bodyHeight.set(bounds.size.height - 8); bodyWidth.set(bounds.size.width - padding() * 2); }} class="min-h-0 min-w-0 w-full max-w-[1400px] flex-1 flex-row gap-12 self-center pb-2" style={{ paddingHorizontal: padding() }}>
      <If when={splitPlayer()} else={
        <View class="min-h-0 min-w-0 flex-1">
          <PanelFade><If when={nav.playerTab() === "cover"} else={<If when={nav.playerTab() === "lyrics"} else={<QueueView />}><LyricsView /></If>}><PlayerCover size={coverSize()} width={coverWidth()} onHeight={controlsHeight.set} /></If></PanelFade>
          <If when={nav.playerTab() !== "cover"}><CompactTransport /></If>
        </View>
      }>
        <View class="min-h-0 min-w-0 flex-1"><PlayerCover size={coverSize()} width={coverWidth()} onHeight={controlsHeight.set} /></View>
        <View class="min-h-0 min-w-0 pt-2" style={{ flex: 1.1, ...enter("fadeInUp", 120) }}><PanelFade><If when={nav.playerTab() === "lyrics"} else={<QueueView />}><LyricsView /></If></PanelFade></View>
      </If>
    </View>
    <View class="z-10 w-full shrink-0 self-center pt-1" style={{ paddingHorizontal: padding(), paddingBottom: shortLandscape() ? 4 : 12, maxWidth: splitPlayer() ? 560 : undefined }}><PlayerTabs /></View>
  </View>;
}

/** Now Playing: the whole window, on the page's ground (spotish's sheet). */
export function FullPlayer() {
  return <Dialog testID="full-player" open={nav.fullPlayer()} presentation="fullScreen" animation={reduceMotion() ? "none" : "slide"} onOpenChange={({ open }) => nav.fullPlayer.set(open)} statusBar={{ foreground: s.settings().theme === "light" || s.settings().theme === "system" && colorScheme() === "light" ? "dark" : "light" }} class="min-h-0 min-w-0 flex-1 bg-sidebar">
    <If when={p.currentTrack()} else={<View class="min-w-0 flex-1 px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <View class="items-start pt-2"><IconButton testID="close-player" name="chevronDown" label="收起播放器" size={24} onPress={() => nav.fullPlayer.set(false)} /></View>
      <Scroll class="min-h-0 flex-1"><Empty icon="queue" title="队列已清空" description="挑选一首音乐，开始下一段聆听。"><Pill primary label="搜索音乐" icon="search" onPress={() => { nav.fullPlayer.set(false); nav.navigate("search"); }} /></Empty></Scroll>
    </View>}><PlayerContent /></If>
  </Dialog>;
}
