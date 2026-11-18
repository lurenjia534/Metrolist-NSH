import { View, Scroll, signal } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as account from "../account";
import * as cloud from "../cloudActions";
import type { Track } from "../model";
import { enter } from "../spotish/components/ui/motion";
import { Label, Tool, Pill, CommandMenu, palette as c, action, say } from "../ui";

export function createSelection(visibleKeys: () => string[]) {
  const active = signal(false);
  const keys = signal<string[]>([]);
  let anchor: string | undefined;
  const clear = () => { keys.set([]); anchor = undefined; };
  const finish = () => { active.set(false); clear(); };
  const toggle = (key: string) => {
    keys.update(values => values.includes(key) ? values.filter(value => value !== key) : [...values, key]);
    anchor = key;
  };
  const extend = (key: string) => {
    if (!active()) { active.set(true); keys.set([key]); }
    else {
      const visible = visibleKeys();
      const target = visible.indexOf(key);
      const previous = visible.indexOf(anchor || key);
      const start = previous < 0 ? target : previous;
      keys.update(values => [...new Set([...values, ...visible.slice(Math.min(start, target), Math.max(start, target) + 1)])]);
    }
    anchor = key;
  };
  return { active, keys, clear, finish, toggle, extend,
    begin: () => { active.set(true); clear(); },
    all: () => keys.update(values => [...new Set([...values, ...visibleKeys()])]),
  };
}

export function downloadTracks(tracks: Track[]) {
  const unique = [...new Map(tracks.map(track => [track.id, track])).values()];
  for (const track of unique) void s.downloadTrack(track).catch(s.showError);
  say(`已将 ${unique.length} 首歌曲加入下载`);
}

export function SelectionActions(props: {
  tracks: Track[]; title: string; visibleCount: number; selectedVisibleCount: number;
  onAll: () => void; onClear: () => void; onDone: () => void;
  queueMode?: boolean; onPlaySelection?: () => void; onMoveSelection?: (edge: "start" | "end") => void; removeLabel: string; onRemove: () => void;
}) {
  const empty = () => props.tracks.length === 0;
  const allLiked = () => props.tracks.every(track => s.isLiked(track.id));
  const setLikes = () => {
    const liked = !allLiked();
    const tracks = [...new Map(props.tracks.map(track => [track.id, track])).values()];
    void action(async () => {
      for (const track of tracks) {
        if (s.isLiked(track.id) === liked) continue;
        await s.setTrackLiked(track, liked);
      }
      props.onClear();
    }, liked ? "已喜欢所选歌曲" : "已取消喜欢所选歌曲");
  };
  return <View testID="song-selection" class="mx-3 gap-2 rounded-(--radius-panel) border border-border bg-card p-3" style={enter("fadeInUp")}>
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Label weight="600" testID="selection-count">已选择 {props.tracks.length} 首</Label>
        <Label size={11} color={c().sub}>{Math.floor(props.tracks.reduce((sum, track) => sum + track.duration, 0) / 60)} 分钟{props.tracks.length > props.selectedVisibleCount ? ` · 筛选外 ${props.tracks.length - props.selectedVisibleCount} 首` : " · 长按可连续选择"}</Label>
      </View>
      <Tool testID="selection-all" icon="checkCircle" label="全选当前结果" active={props.visibleCount > 0 && props.selectedVisibleCount === props.visibleCount} disabled={!props.visibleCount} onPress={props.onAll} />
      <Tool testID="selection-done" icon="close" label="完成选择" onPress={props.onDone} />
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Scroll horizontal scrollbar={false} class="h-11 min-w-0 flex-1 shrink-0" contentClass="flex-row items-center gap-2">
        <Pill testID="selection-play" label="播放" icon="play" primary disabled={empty() || p.remoteControlled()} onPress={() => props.onPlaySelection ? props.onPlaySelection() : void action(() => p.playList(props.tracks, 0, props.title))} />
        <If when={!props.queueMode}>
          <Pill testID="selection-next" label="下一首播放" icon="next" disabled={empty() || p.remoteControlled()} onPress={() => { p.playNextTracks(props.tracks); say(`已将 ${props.tracks.length} 首歌曲放到下一首`); }} />
          <Pill testID="selection-queue" label="加入队列" icon="queue" disabled={empty() || p.remoteControlled()} onPress={() => { p.addTracksToQueue(props.tracks); say(`已将 ${props.tracks.length} 首歌曲加入队列`); }} />
        </If>
        <Pill testID="selection-playlist" label="加入歌单" icon="plus" disabled={empty()} onPress={() => nav.addToPlaylist(props.tracks)} />
        <Pill testID="selection-download" label="下载" icon="download" disabled={empty()} onPress={() => downloadTracks(props.tracks)} />
      </Scroll>
      <CommandMenu testID="selection-actions" label="所选歌曲操作" items={[
        { testID: "selection-clear", label: "取消全选", icon: "checkCircle", disabled: empty(), run: props.onClear },
        { testID: "selection-like", label: allLiked() && !empty() ? "取消喜欢" : "喜欢所选歌曲", icon: "heart", disabled: empty(), run: setLikes },
        ...(account.signedIn() ? [{ label: "加入 YouTube Music 歌单", icon: "plus", disabled: !props.tracks.some(track => track.source === "youtube"), run: () => cloud.addToCloudPlaylist(props.tracks) }] : []),
        ...(props.onMoveSelection ? [
          { testID: "selection-move-start", label: "移到队首", icon: "up", disabled: empty() || p.remoteControlled(), run: () => props.onMoveSelection!("start") },
          { testID: "selection-move-end", label: "移到队尾", icon: "down", disabled: empty() || p.remoteControlled(), run: () => props.onMoveSelection!("end") },
        ] : []),
        { testID: "selection-remove", label: props.removeLabel, icon: "trash", danger: true, separator: true, disabled: empty() || (!!props.queueMode && p.remoteControlled()), run: props.onRemove },
      ]} />
    </View>
  </View>;
}
