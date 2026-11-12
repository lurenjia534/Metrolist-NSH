import { View, Scroll, List, Clipboard, windowSize, type JSX } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import * as account from "../account";
import * as cloud from "../cloudActions";
import { Icon } from "../icons";
import { Art, Label, Press, Tool, CommandMenu, palette as c, narrow, pageGutter, action, say, time, type CommandItem } from "../ui";
import { isTrack, type Track, type Collection, type Playlist, type CatalogItem } from "../model";

export function shareTrack(track: Track) {
  action(async () => { await Clipboard.writeText(track.source === "youtube" ? `https://music.youtube.com/watch?v=${track.id}` : track.url || track.title); say("歌曲链接已复制"); });
}
export function songCommands(track: Track): CommandItem[] {
  const saved = s.libraryIds().includes(track.id);
  return [
    ...(together.isGuest() && track.source === "youtube" ? [{ label: "向主持人点歌", icon: "users", run: () => void action(() => together.suggestTrack(track), "点歌请求已发送") }] : []),
    { label: s.isLiked(track.id) ? "取消喜欢" : "喜欢", icon: "heart", run: () => s.toggleLike(track) },
    { label: "下一首播放", icon: "next", disabled: p.remoteControlled(), run: () => { p.playNext(track); say("已放到下一首"); } },
    { label: "加入播放队列", icon: "queue", disabled: p.remoteControlled(), run: () => { p.addToQueue(track); say("已加入队列"); } },
    { label: account.signedIn() ? "加入本机歌单…" : "加入歌单…", icon: "plus", run: () => nav.addToPlaylist([track]) },
    ...(account.signedIn() && track.source === "youtube" ? [
      { label: "加入 YouTube Music 歌单…", icon: "queue", run: () => cloud.addToCloudPlaylist([track]) },
      { label: account.cloudLibrary().songs.some(item => item.id === track.id) ? "从云端音乐库移除" : "加入云端音乐库", icon: "library", run: () => void action(() => account.setSavedSong(track.id, !account.cloudLibrary().songs.some(item => item.id === track.id)), "云端音乐库已更新") },
    ] : []),
    { label: saved ? "从音乐库移除" : "加入音乐库", icon: saved ? "bookmark" : "library", run: () => saved ? s.removeFromLibrary(track.id) : s.addToLibrary(track) },
    ...(track.source === "youtube" ? [{ label: "歌曲电台", icon: "radio", disabled: p.remoteControlled(), run: () => { void s.startRadio(track); } }] : []),
    { label: s.downloading().includes(track.id) ? "正在下载…" : "下载", icon: "download", disabled: s.downloading().includes(track.id), run: () => { void s.downloadTrack(track).catch(s.showError); say("已加入下载"); } },
    ...(track.artistId ? [{ label: "查看歌手", icon: "artist", run: () => { nav.fullPlayer.set(false); nav.browse({ id: track.artistId!, browseId: track.artistId!, title: track.artist, subtitle: "", artwork: "", type: "artist" }); } }] : []),
    ...(track.albumId ? [{ label: "查看专辑", icon: "album", run: () => { nav.fullPlayer.set(false); nav.browse({ id: track.albumId!, browseId: track.albumId!, title: track.album || "专辑", subtitle: track.artist, artwork: track.artwork, type: "album" }); } }] : []),
    { label: "分享链接", icon: "share", run: () => shareTrack(track), separator: true },
    { label: "歌曲信息…", icon: "info", run: () => { nav.selectedTracks.set([track]); nav.dialog.set("song-info"); } },
  ];
}
export function SongMenu(props: { track: Track }) { return <CommandMenu label={`更多 ${props.track.title}`} testID={`song-menu-${props.track.id}`} items={songCommands(props.track)} />; }
export function TrackRow(props: { track: Track; list?: Track[]; index?: number; compact?: boolean; active?: boolean; menu?: boolean; playLabel?: string; selected?: boolean; selecting?: boolean; onSelect?: () => void; onLongPress?: () => void; onPlay?: () => void; trailing?: JSX.Element; actionsBelow?: boolean; rank?: number }) {
  const active = () => props.active ?? p.currentTrack()?.id === props.track.id;
  return <View testID={`track-${props.track.id}`} style={{ minWidth: 0, borderRadius: 12, paddingHorizontal: 4, backgroundColor: active() || props.selected ? c().selected : "transparent" }}>
    <View style={{ flexDirection: "row", minWidth: 0, minHeight: props.compact ? 68 : 76, alignItems: "center", gap: 8 }}>
    <If when={props.selecting}><Tool icon={props.selected ? "checkCircle" : "album"} label={`${props.selected ? "取消选择" : "选择"} ${props.track.title}`} active={props.selected} onPress={() => props.onSelect?.()} /></If>
    <If when={props.rank !== undefined}><Label size={14} color={c().sub} style={{ width: 24, textAlign: "center" }}>{props.rank}</Label></If>
    <Press label={props.selecting ? `${props.selected ? "取消选择" : "选择"} ${props.track.title}` : props.playLabel || `播放 ${props.track.title}`} testID={`play-track-${props.track.id}`} onLongPress={props.onLongPress} onPress={() => props.selecting ? props.onSelect?.() : together.isGuest() ? action(() => together.suggestTrack(props.track), "点歌请求已发送") : props.onPlay ? props.onPlay() : action(() => props.list && props.index !== undefined ? p.playList(props.list, props.index) : p.playTrack(props.track, props.list))} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0, paddingVertical: 8 }}>
      <View style={{ width: props.compact ? 48 : 52, height: props.compact ? 48 : 52, flexShrink: 0 }}>
        <Art track={props.track} size={props.compact ? 48 : 52} radius={8} />
        <If when={active()}><View accessibilityElementsHidden style={{ position: "absolute", right: 2, bottom: 2, width: 22, height: 22, borderRadius: 7, backgroundColor: c().accent, alignItems: "center", justifyContent: "center" }}><Icon name={p.playbackPhase() === "resolving" || p.playbackPhase() === "buffering" ? "clock" : p.playing() ? "volume" : "pause"} size={14} color={c().onAccent} /></View></If>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}><Label lines={1} size={narrow() ? 15 : 14} weight="600" color={active() ? c().accent : c().text}>{props.track.title}</Label><View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><If when={s.isLiked(props.track.id)}><Icon name="heart" size={12} color={c().danger} filled /></If><If when={s.downloads().some(t => t.id === props.track.id)}><Icon name="download" size={12} color={c().good} /></If><Label lines={1} size={12} color={c().sub} style={{ flex: 1 }}>{props.track.artist}{props.track.duration ? ` · ${time(props.track.duration)}` : ""}</Label></View></View>
    </Press>
    <If when={!narrow() && windowSize().width >= 1100 && !props.compact}><Label lines={1} size={12} color={c().faint} style={{ width: 128 }}>{props.track.album}</Label><Tool icon="heart" label={s.isLiked(props.track.id) ? "取消喜欢" : "喜欢这首歌"} active={s.isLiked(props.track.id)} onPress={() => s.toggleLike(props.track)} /></If>
    <If when={!props.actionsBelow}>{props.trailing}</If><If when={!props.selecting && props.menu !== false}><SongMenu track={props.track} /></If>
    </View>
    <If when={props.actionsBelow}><View testID={`track-actions-${props.track.id}`} style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingBottom: 4 }}>{props.trailing}</View></If>
  </View>;
}
export function TrackList(props: { tracks: Track[]; compact?: boolean; title?: string }) {
  return <List each={props.tracks} viewport="parent" estimatedItemSize={props.compact ? 68 : 76} keyExtractor={(track, index) => `${track.id}-${index}`}>
    {(track, index) => <TrackRow track={track()} list={props.tracks} index={index()} compact={props.compact} onPlay={() => action(() => p.playList(props.tracks, index(), props.title))} />}
  </List>;
}
export const cardSize = () => narrow() ? Math.min(172, Math.floor((windowSize().width - pageGutter() * 2 - 16) / 2)) : 172;
export function MusicCard(props: { item: CatalogItem; list?: Track[]; size?: number }) {
  const size = () => props.size || cardSize();
  const coverHeight = () => (size() - 4) / (isTrack(props.item) ? props.item.thumbnailAspectRatio || 1 : 1);
  return <Press label={props.item.title} onPress={() => isTrack(props.item) ? together.isGuest() ? action(() => together.suggestTrack(props.item as Track), "点歌请求已发送") : action(() => p.playTrack(props.item as Track, props.list)) : nav.browse(props.item as Collection)} style={{ width: size(), flexShrink: 0, gap: 10, padding: 2 }}>
    <View style={{ width: size() - 4, height: coverHeight() }}><Art track={isTrack(props.item) ? props.item : undefined} src={isTrack(props.item) ? undefined : props.item.artwork} size={size() - 4} style={{ height: coverHeight() }} radius={!isTrack(props.item) && props.item.type === "artist" ? size() : 12} icon={!isTrack(props.item) && props.item.type === "artist" ? "artist" : "album"} /><If when={isTrack(props.item) || props.item.type !== "artist"}><View style={{ position: "absolute", bottom: 8, right: 8, width: 36, height: 36, borderRadius: 24, backgroundColor: c().scrim, alignItems: "center", justifyContent: "center" }}><Icon name="play" size={20} color={c().text} /></View></If></View>
    <View style={{ gap: 5 }}><Label lines={2} size={14} weight="600">{props.item.title}</Label><Label lines={1} size={12} color={c().sub}>{isTrack(props.item) ? props.item.artist : props.item.subtitle || ({ album: "专辑", artist: "歌手", playlist: "歌单" }[props.item.type])}</Label></View>
  </Press>;
}
export function ItemRail(props: { items: CatalogItem[]; all?: boolean }) {
  const coverHeight = () => Math.max(...props.items.map(item => (cardSize() - 4) / (isTrack(item) ? item.thumbnailAspectRatio || 1 : 1)), 0);
  return <Scroll horizontal scrollbar={false} style={{ height: coverHeight() + 100 }} contentStyle={{ flexDirection: "row", gap: 16, paddingBottom: 12 }}><Each of={props.items}>{(item) => <MusicCard item={item()} list={props.items.filter(isTrack)} />}</Each></Scroll>;
}
export function CollectionRow(props: { item: Collection }) {
  return <View style={{ minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}><Press label={props.item.title} onPress={() => nav.browse(props.item)} style={{ flex: 1, minWidth: 0, minHeight: 76, flexDirection: "row", alignItems: "center", gap: 16 }}><Art src={props.item.artwork} size={56} radius={props.item.type === "artist" ? 36 : 8} icon={props.item.type === "artist" ? "artist" : "album"} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label lines={1} weight="600">{props.item.title}</Label><Label lines={1} size={12} color={c().sub}>{props.item.subtitle}</Label></View></Press><Tool icon={props.item.type === "artist" ? "checkCircle" : "bookmark"} label={s.isCollectionSaved(props.item.id) ? "移除收藏" : "收藏"} active={s.isCollectionSaved(props.item.id)} onPress={() => s.toggleCollectionSaved(props.item)} /></View>;
}
export function PlaylistCover(props: { playlist: Playlist; size: number }) {
  return <View style={{ width: props.size, height: props.size, flexDirection: "row", flexWrap: "wrap", overflow: "hidden", borderRadius: 12, backgroundColor: c().selected }}><If when={props.playlist.tracks.length >= 4} else={<Art track={props.playlist.tracks[0]} size={props.size} radius={12} />}><Each of={props.playlist.tracks.slice(0, 4)}>{(track) => <Art track={track()} size={props.size / 2} radius={0} />}</Each></If></View>;
}
export function PlaylistCard(props: { playlist: Playlist; grid?: boolean }) {
  return <Press label={props.playlist.name} onPress={() => nav.openPlaylist(props.playlist.id)} style={{ width: props.grid ? cardSize() : undefined, flexDirection: props.grid ? "column" : "row", gap: 12, alignItems: props.grid ? "stretch" : "center", minHeight: props.grid ? undefined : 76, padding: 2 }}>
    <PlaylistCover playlist={props.playlist} size={props.grid ? cardSize() - 4 : 56} /><View style={{ flex: props.grid ? undefined : 1, minWidth: 0, gap: 6 }}><Label size={14} weight="600" lines={1}>{props.playlist.name}</Label><Label size={12} color={c().sub}>{props.playlist.tracks.length} 首歌曲</Label></View>
  </Press>;
}
