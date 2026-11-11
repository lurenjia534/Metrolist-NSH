import { View, Scroll, List, signal, computed, effect, createAnimatedValue, createMotion, windowSize, reduceMotion, colorScheme, type ListRef, type JSX } from "nsh";
import { Button, Dialog, Tab, Tabs } from "nsh/base";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import { Icon } from "../icons";
import { SongMenu, TrackRow, shareTrack, songCommands } from "./Music";
import { Label, Tool, Pill, Art, Rail, Press, CommandMenu, Empty, palette as c, narrow, touch, action, say, time } from "../ui";
import { motion, motionDuration, transition } from "../motion";
import type { Track } from "../model";

const compactMini = () => narrow() || windowSize().width < (touch() ? 1180 : 1000);
const splitPlayer = () => windowSize().width >= 960 && windowSize().height >= 540;
const shortLandscape = () => windowSize().width >= 600 && windowSize().height < 540;
const waitingToPlay = () => p.playbackPhase() === "resolving" || p.playbackPhase() === "buffering";
const playbackLabel = () => ({ idle: "待播放", resolving: "正在连接音源…", buffering: "正在缓冲…", playing: "正在播放", paused: "已暂停", error: "播放失败" }[p.playbackPhase()]);
const nextLabel = () => {
  const next = p.nextPreparation();
  if (!next || next.trackId !== p.upNext()?.id) return "接下来";
  return next.state === "cached" ? "开头已缓冲" : next.state === "ready" ? "音源已准备" : "正在准备下一首…";
};

// Dragging changes only this preview. The player receives one seek on release.
function SeekRail(props: { large?: boolean; testID?: string; showTime?: boolean }) {
  const draft = signal<number | undefined>();
  effect(() => { p.currentTrack()?.id; draft.set(undefined); });
  const value = () => draft() ?? p.position();
  const duration = () => p.duration() || p.currentTrack()?.duration || 1;
  const commit = (next: number) => {
    void action(() => p.seek(next));
    draft.set(undefined);
  };
  return <View style={{ flex: 1, minWidth: 0, minHeight: (touch() ? 48 : props.large ? 40 : 28) + (props.showTime ? 18 : 0) }}>
    <Rail testID={props.testID} large={props.large} label="播放进度" value={value()} max={duration()} bufferedValue={p.bufferedPosition() > 0 ? p.bufferedPosition() : undefined} disabled={p.remoteControlled()} onChange={draft.set} onChangeEnd={commit} />
    <If when={props.showTime}><View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Label testID="player-position" size={12} color={c().sub}>{time(value())}</Label>
      <Label testID="player-status" size={12} color={waitingToPlay() ? c().accent : c().sub}>{waitingToPlay() ? playbackLabel() : time(duration())}</Label>
    </View></If>
  </View>;
}

function MiniProgress() {
  const progress = createAnimatedValue(0);
  let trackId = "";
  effect(() => {
    const nextId = p.currentTrack()?.id || "";
    const ratio = Math.min(1, p.position() / (p.duration() || p.currentTrack()?.duration || 1));
    const newTrack = nextId !== trackId;
    trackId = nextId;
    if (newTrack || !p.playing() || reduceMotion()) progress.set(ratio);
    else void progress.timing(ratio, { duration: motion.progress, easing: "linear" });
  });
  return <View accessibilityElementsHidden style={{ height: 2, flexShrink: 0, backgroundColor: c().raised, overflow: "hidden" }}>
    <View style={{ height: 2, backgroundColor: c().accent, scale: [progress, 1], transformOrigin: "left" }} />
  </View>;
}

function MiniSurface(props: { track: Track }) {
  const entrance = createMotion({ enter: { duration: motion.enter, keyframes: [{ opacity: 0, translateY: motion.shift }, { opacity: 1, translateY: 0 }] } });
  return <View testID="mini-player" style={{ flexShrink: 0, minWidth: 0, backgroundColor: c().card, borderTopWidth: 1, borderColor: c().line, paddingHorizontal: compactMini() ? 12 : 24, paddingTop: 6, paddingBottom: compactMini() ? 2 : 8, gap: 4, ...entrance.style }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: compactMini() ? 6 : 20, minHeight: 58, minWidth: 0 }}>
      <Press testID="open-player" label="打开播放器" onPress={() => nav.showPlayer()} style={{ flex: compactMini() ? 1 : 0.8, flexDirection: "row", alignItems: "center", gap: compactMini() ? 10 : 14, minWidth: 0 }}>
        <Art track={props.track} size={compactMini() ? 46 : 54} radius={10} />
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          <Label size={14} weight="600" lines={1}>{props.track.title}</Label>
          <Label testID="mini-player-status" size={12} color={p.playbackError() ? c().danger : waitingToPlay() ? c().accent : c().sub} lines={1}>{p.playbackError() ? "播放失败 · 点按查看" : waitingToPlay() ? playbackLabel() : p.playbackPhase() === "paused" ? `已暂停 · ${props.track.artist}` : props.track.artist}</Label>
        </View>
      </Press>
      <If when={!compactMini()}>
        <View style={{ flex: 1.2, minWidth: 0, gap: 2, alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Tool icon="shuffle" label="随机播放" active={p.shuffle()} disabled={p.remoteControlled()} onPress={p.toggleShuffle} />
            <Tool icon="previous" label="上一首" disabled={p.remoteControlled()} onPress={() => action(p.previous)} />
            <PlayButton small />
            <Tool icon="next" label="下一首" disabled={p.remoteControlled()} onPress={() => action(p.next)} />
            <Tool icon={p.repeat() === "one" ? "repeatOne" : "repeat"} label="循环播放" active={p.repeat() !== "off"} disabled={p.remoteControlled()} onPress={p.cycleRepeat} />
          </View>
          <View style={{ flexDirection: "row", width: "100%", minWidth: 0, alignItems: "center", gap: 8, maxWidth: 520 }}>
            <Label size={10} color={c().sub}>{time(p.position())}</Label><SeekRail /><Label size={10} color={c().sub}>{time(p.duration() || props.track.duration)}</Label>
          </View>
        </View>
      </If>
      <If when={compactMini()} else={
        <View style={{ flex: 0.7, minWidth: 160, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
          <Tool icon="heart" label="喜欢" active={s.isLiked(props.track.id)} onPress={() => s.toggleLike(props.track)} />
          <Tool icon="lyrics" label="歌词" onPress={() => nav.showPlayer("lyrics")} />
          <Tool icon="queue" label="队列" onPress={() => nav.showPlayer("queue")} />
          <Tool icon={p.volume() ? "volume" : "mute"} label={p.volume() ? "静音" : "取消静音"} onPress={() => s.updateSettings({ volume: p.volume() ? 0 : 0.7 })} />
          <View style={{ width: 64 }}><Rail label="音量" value={p.volume() * 100} onChange={value => s.updateSettings({ volume: value / 100 })} /></View>
        </View>
      }><PlayButton small /><Tool icon="next" label="下一首" disabled={p.remoteControlled()} onPress={() => action(p.next)} /><Tool testID="mini-queue" icon="queue" label="打开播放队列" onPress={() => nav.showPlayer("queue")} /></If>
    </View>
    <If when={compactMini()}><MiniProgress /></If>
  </View>;
}

export function MiniPlayer() {
  return <If when={p.currentTrack()}>{track => <MiniSurface track={track()} />}</If>;
}

function PlayButton(props: { small?: boolean }) {
  const pauses = () => p.playing() || waitingToPlay();
  const state = createAnimatedValue(pauses() ? 1 : 0);
  effect(() => { void state.timing(pauses() ? 1 : 0, { duration: motionDuration(motion.fast), easing: "easeOut" }); });
  const playOpacity = state.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const playScale = state.interpolate({ inputRange: [0, 1], outputRange: [1, 0.65] });
  const pauseScale = state.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  return <Button testID={props.small ? "mini-play-pause" : "player-play-pause"} accessibilityLabel={pauses() ? "暂停" : "播放"} disabled={p.remoteControlled()} onPress={() => void action(p.togglePlay)}
    style={{ width: props.small ? 48 : 116, height: props.small ? 48 : 64, flexShrink: 0, borderRadius: props.small ? 24 : 28, backgroundColor: c().accent, alignItems: "center", justifyContent: "center", ...transition() }}
    activeStyle={{ scale: reduceMotion() ? 1 : motion.pressScale }} disabledStyle={{ opacity: 0.5 }} class="focus-visible:ring-2 focus-visible:ring-primary">
    <View accessibilityElementsHidden style={{ width: props.small ? 24 : 34, height: props.small ? 24 : 34 }}>
      <View style={{ position: "absolute", top: 0, left: 0, opacity: playOpacity, scale: playScale }}><Icon name="play" size={props.small ? 24 : 34} color={c().onAccent} /></View>
      <View style={{ position: "absolute", top: 0, left: 0, opacity: state, scale: pauseScale }}><Icon name="pause" size={props.small ? 24 : 34} color={c().onAccent} /></View>
    </View>
  </Button>;
}

export function LyricsView() {
  const ref = signal<ListRef | undefined>();
  const follow = signal(true);
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
          <Label size={size()} weight="600" color={index() === active() ? c().accent : c().faint} style={{ lineHeight: size() * 1.4, textAlign: s.settings().lyricAlignment, ...transition("color", motion.instant) }}>{line().text || "♪"}</Label>
        </Press>}
      </List>
      <If when={!follow()}><View style={{ flexDirection: "row", justifyContent: "center", flexShrink: 0 }}><Pill label="回到当前歌词" icon="lyrics" onPress={() => follow.set(true)} /></View></If>
    </If>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
      <Tool icon="left" label="歌词提前 100 毫秒" onPress={() => s.updateSettings({ lyricsOffset: s.settings().lyricsOffset - 100 })} />
      <Label size={11} color={c().faint}>{s.settings().lyricsOffset === 0 ? "歌词偏移" : `${s.settings().lyricsOffset} ms`}</Label>
      <Tool icon="right" label="歌词延后 100 毫秒" onPress={() => s.updateSettings({ lyricsOffset: s.settings().lyricsOffset + 100 })} />
    </View>
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
        { label: "下载队列", icon: "download", run: () => { if (!s.downloadAvailable()) { say(s.downloadSetupMessage); return; } for (const track of p.queue()) void s.downloadTrack(track).catch(s.showError); say("已加入下载"); } },
        { label: "播放设置", icon: "settings", run: () => { nav.fullPlayer.set(false); nav.settingsSection.set("player"); nav.navigate("settings"); } },
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
                { label: "上移", icon: "up", disabled: p.remoteControlled() || index() === 0, run: () => p.moveQueue(index(), index() - 1) },
                { label: "下移", icon: "down", disabled: p.remoteControlled() || index() === p.queue().length - 1, run: () => p.moveQueue(index(), index() + 1) },
                { label: "从队列移除", icon: "close", disabled: p.remoteControlled(), run: () => p.removeFromQueue(index()) },
                ...(!editing() ? songCommands(track()).map((item, at) => at === 0 ? { ...item, separator: true } : item) : []),
              ]} />
        } />
      </View>}
    </List>
    <If when={!shortLandscape()} else={<Label size={11} color={c().sub} lines={1}>{p.remoteControlled() ? "与主持人同步" : s.settings().autoRadio ? "队列结束后自动续播" : "自动续播已关闭"}</Label>}>
    <View style={{ padding: 14, borderRadius: 16, backgroundColor: c().card, gap: 8, flexShrink: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Icon name="radio" size={20} color={c().accent} />
        <Label size={12} lines={2} style={{ flex: 1, minWidth: 0 }}>{p.remoteControlled() ? "与主持人的队列同步" : p.radioLoading() ? "正在获取电台推荐…" : s.settings().autoRadio ? "队列结束后自动续播" : "自动续播已关闭"}</Label>
        <If when={!p.remoteControlled()}><Tool testID="queue-autoplay" icon={s.settings().autoRadio ? "check" : "plus"} active={s.settings().autoRadio} label={s.settings().autoRadio ? "关闭自动续播" : "开启自动续播"} onPress={() => s.updateSettings({ autoRadio: !s.settings().autoRadio })} /></If>
      </View>
      <If when={p.radioError()}><Label size={12} color={c().danger}>{p.radioError()}</Label><Pill label="重试电台" onPress={() => void action(p.extendRadio)} /></If>
    </View></If>
  </View>;
}

function Transport(props: { onHeight: (height: number) => void }) {
  const track = p.currentTrack;
  return <View onLayout={({ bounds }) => props.onHeight(bounds.size.height)} style={{ gap: 12, minWidth: 0, flexShrink: 0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
      <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
        <Label size={shortLandscape() ? 20 : 24} weight="600" lines={2}>{track()?.title}</Label>
        <Press label="查看歌手" onPress={() => { nav.fullPlayer.set(false); if (track()?.artistId) nav.browse({ id: track()!.artistId!, browseId: track()!.artistId!, title: track()!.artist, subtitle: "", artwork: "", type: "artist" }); else nav.performSearch(track()?.artist || "", "artists"); }}>
          <Label size={15} color={c().sub} lines={1}>{track()?.artist}</Label>
        </Press>
      </View>
      <Tool icon="share" label="分享歌曲" onPress={() => track() && shareTrack(track()!)} />
      <Tool icon="heart" label="喜欢" active={!!track() && s.isLiked(track()!.id)} onPress={() => track() && s.toggleLike(track()!)} />
    </View>
    <SeekRail testID="player-seek" large showTime />
    <View style={{ flexDirection: "row", justifyContent: "space-evenly", alignItems: "center", minWidth: 0 }}>
      <Tool icon="previous" label="上一首" large size={30} disabled={p.remoteControlled()} onPress={() => void action(p.previous)} />
      <PlayButton />
      <Tool icon="next" label="下一首" large size={30} disabled={p.remoteControlled()} onPress={() => void action(p.next)} />
    </View>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minWidth: 0 }}>
      <Tool icon="shuffle" label="随机播放" active={p.shuffle()} disabled={p.remoteControlled()} onPress={p.toggleShuffle} />
      <Tool icon="clock" label="睡眠定时器" active={!!p.sleepUntil()} onPress={() => nav.dialog.set("sleep")} />
      <Tool icon={p.repeat() === "one" ? "repeatOne" : "repeat"} label={p.repeat() === "off" ? "开启列表循环" : p.repeat() === "all" ? "开启单曲循环" : "关闭循环"} active={p.repeat() !== "off"} disabled={p.remoteControlled()} onPress={p.cycleRepeat} />
    </View>
    <If when={p.remoteControlled()}><Label color={c().accent} size={12} style={{ textAlign: "center" }}>由主持人控制 · {together.room()?.roomCode}</Label></If>
    <If when={p.playbackError()}><View style={{ padding: 12, borderRadius: 16, backgroundColor: c().card, gap: 10 }}><Label color={c().danger} size={12} lines={4}>{p.playbackError()}</Label><Pill label="重试播放" icon="refresh" onPress={() => void action(p.retryPlayback)} /></View></If>
  </View>;
}

function CoverArt(props: { size: number }) {
  const change = createMotion();
  let id = p.currentTrack()?.id;
  effect(() => {
    const next = p.currentTrack()?.id;
    if (next !== id) {
      id = next;
      void change.play({ duration: motion.base, keyframes: [{ opacity: 0.55, scale: 0.985 }, { opacity: 1, scale: 1 }] });
    }
  });
  return <View style={{ alignItems: "center", justifyContent: "center", flexShrink: 0, ...change.style }}>
    <Art track={p.currentTrack()} size={props.size} radius={20} style={{ boxShadow: c().shadow }} />
  </View>;
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

function PlayerTabs() {
  const tabs = [{ value: "cover", label: "歌曲", icon: "album" }, { value: "lyrics", label: "歌词", icon: "lyrics" }, { value: "queue", label: "播放队列", icon: "queue" }] as const;
  const selected = () => splitPlayer() && nav.playerTab() === "cover" ? "queue" : nav.playerTab();
  return <Tabs testID="player-tabs" style={{ flexDirection: "row", padding: 4, gap: 4, minWidth: 0, backgroundColor: c().panel, borderRadius: 22 }} indicatorStyle={{ top: 4, bottom: 4, borderRadius: 18, backgroundColor: c().selected }}>
    <Each of={splitPlayer() ? tabs.slice(1) : tabs} key={item => item.value}>{item =>
      <Tab testID={`player-tab-${item().value}`} accessibilityLabel={item().label} selected={selected() === item().value} onPress={() => nav.playerTab.set(item().value)}
        style={{ flex: 1, minWidth: 0, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 18, ...transition("colors,opacity", motion.instant) }}
        activeStyle={{ opacity: 0.7 }} class="focus-visible:ring-2 focus-visible:ring-primary">
        <Icon name={item().icon} size={18} color={selected() === item().value ? c().accent : c().sub} />
        <Label size={13} color={selected() === item().value ? c().accent : c().sub} weight={selected() === item().value ? "600" : "400"}>{item().value === "queue" ? "队列" : item().label}</Label>
      </Tab>
    }</Each>
  </Tabs>;
}

function CompactTransport() {
  return <View style={{ flexShrink: 0, minWidth: 0, gap: 2, paddingTop: 6 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
      <Art track={p.currentTrack()} size={42} />
      <Press label="回到封面" onPress={() => nav.playerTab.set("cover")} style={{ flex: 1, gap: 4, minWidth: 0 }}><Label size={14} weight="600" lines={1}>{p.currentTrack()?.title}</Label><Label size={11} color={c().sub} lines={1}>{p.currentTrack()?.artist}</Label></Press>
      <PlayButton small /><Tool icon="next" label="下一首" disabled={p.remoteControlled()} onPress={() => void action(p.next)} />
    </View>
    <If when={!shortLandscape()} else={<MiniProgress />}><SeekRail testID="player-panel-seek" /></If>
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
    <If when={expanded()}><View testID="playback-details" style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: c().card }}>
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
  return <If when={p.repeat() !== "one" ? p.upNext() : undefined}>{track => <Press testID="player-up-next" label="查看接下来的歌曲" onPress={() => nav.playerTab.set("queue")} style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: 10, padding: 12, borderRadius: 18, backgroundColor: c().card }}>
    <Art track={track()} size={38} radius={8} />
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Label size={10} color={c().accent}>下一首 · {nextLabel()}</Label><Label size={12} lines={1}>{track().title}</Label></View>
    <Icon name="queue" size={20} color={c().sub} />
  </Press>}</If>;
}

function PlayerCover(props: { size: number; width: number; onHeight: (height: number) => void }) {
  return <Scroll testID="player-cover-scroll" style={{ flex: 1, minWidth: 0, minHeight: 0 }} scrollbar={false} contentStyle={{ flexDirection: shortLandscape() ? "row" : "column", alignItems: shortLandscape() ? "center" : undefined, gap: shortLandscape() ? 24 : 22, paddingTop: 6, paddingBottom: 12 }}>
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
  const padding = () => splitPlayer() ? 36 : 16;
  const coverWidth = () => splitPlayer() ? (bodyWidth() - 32) / 2.1 : shortLandscape() ? bodyWidth() * 0.36 : bodyWidth();
  const coverSize = () => Math.min(420, coverWidth(), Math.max(shortLandscape() ? 136 : 112, bodyHeight() - (shortLandscape() ? 24 : controlsHeight() + (touch() ? 100 : 88) + (p.repeat() !== "one" && p.upNext() ? 72 : 0))));
  return <View style={{ flex: 1, minWidth: 0, minHeight: 0, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: padding(), height: shortLandscape() ? 52 : 60, flexShrink: 0, minWidth: 0 }}>
      <Tool testID="close-player" icon="down" label="收起播放器" onPress={() => nav.fullPlayer.set(false)} />
      <View style={{ flex: 1, gap: 3, alignItems: "center", minWidth: 0 }}><Label size={10} color={c().faint}>正在播放</Label><Label lines={1} size={13}>{p.queueTitle() || "当前播放"}</Label></View>
      <If when={p.currentTrack()}>{track => <SongMenu track={track()} />}</If>
    </View>
    <View testID="player-body" onLayout={({ bounds }) => { bodyHeight.set(bounds.size.height - 8); bodyWidth.set(bounds.size.width - padding() * 2); }} style={{ flex: 1, minHeight: 0, minWidth: 0, flexDirection: "row", gap: 32, paddingHorizontal: padding(), paddingBottom: 8, maxWidth: 1400, width: "100%", alignSelf: "center" }}>
      <If when={splitPlayer()} else={
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <PanelFade><If when={nav.playerTab() === "cover"} else={<If when={nav.playerTab() === "lyrics"} else={<QueueView />}><LyricsView /></If>}><PlayerCover size={coverSize()} width={coverWidth()} onHeight={controlsHeight.set} /></If></PanelFade>
          <If when={nav.playerTab() !== "cover"}><CompactTransport /></If>
        </View>
      }>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}><PlayerCover size={coverSize()} width={coverWidth()} onHeight={controlsHeight.set} /></View>
        <View style={{ flex: 1.1, minWidth: 0, minHeight: 0, paddingTop: 8 }}><PanelFade><If when={nav.playerTab() === "lyrics"} else={<QueueView />}><LyricsView /></If></PanelFade></View>
      </If>
    </View>
    <View style={{ flexShrink: 0, paddingHorizontal: padding(), paddingTop: 4, paddingBottom: shortLandscape() ? 4 : 10, maxWidth: splitPlayer() ? 600 : undefined, width: "100%", alignSelf: "center" }}><PlayerTabs /></View>
  </View>;
}

export function FullPlayer() {
  return <Dialog testID="full-player" open={nav.fullPlayer()} presentation="fullScreen" animation={reduceMotion() ? "none" : "slide"} onOpenChange={({ open }) => nav.fullPlayer.set(open)} statusBar={{ foreground: s.settings().theme === "light" || s.settings().theme === "system" && colorScheme() === "light" ? "dark" : "light" }} style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: c().bg }}>
    <If when={p.currentTrack()} else={<View style={{ flex: 1, minWidth: 0, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingHorizontal: 16 }}>
      <View style={{ alignItems: "flex-start" }}><Tool testID="close-player" icon="down" label="收起播放器" onPress={() => nav.fullPlayer.set(false)} /></View>
      <Scroll style={{ flex: 1, minHeight: 0 }}><Empty icon="queue" title="队列已清空" description="挑选一首音乐，开始下一段聆听。"><Pill primary label="搜索音乐" icon="search" onPress={() => { nav.fullPlayer.set(false); nav.navigate("search"); }} /></Empty></Scroll>
    </View>}><PlayerContent /></If>
  </Dialog>;
}
