import { View, Scroll, List, Clipboard, Text, signal, untracked, windowSize, type JSX } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import * as account from "../account";
import * as cloud from "../cloudActions";
import { Icon } from "../icons";
import { Art, Tool, CommandMenu, ROW, SectionTitle, narrow, touch, action, say, time, type CommandItem } from "../ui";
import { wideTracks } from "../layout";
import { pageWave } from "./Page";
import { Cover, focusRing, keyRing, LAYER, PlayButton, terminal } from "../spotish/components/ui/controls";
import { Digits } from "../spotish/components/ui/digits";
import { PlayingBars } from "../spotish/components/ui/playing";
import { listItemEntrance, waveDelay, type ListWave, WAVE } from "../spotish/components/ui/motion";
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
/** The header row over a track list (spotish `TrackHeader`): a TITLE
 * (and ALBUM) overline from the covers' edge, a clock over the lengths. */
export function TrackHeader(props: { numbered?: boolean }) {
  return <View class="mb-1 h-8 flex-row items-center gap-3 border-b border-border/60 px-3">
    <If when={props.numbered ?? true}><View class="w-6" /></If>
    <Text class="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground" style={{ flexBasis: 48 }}>标题</Text>
    <If when={wideTracks()}><Text class="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">专辑</Text></If>
    <View class="w-[34px]" />
    <View class="w-12 items-end"><Icon name="clock" size={14} color="muted-foreground" /></View>
    <View class={touch() ? "w-11" : "w-8"} />
  </View>;
}

/** A track (spotish `TrackRow`): the number (a play glyph on hover, the
 * playing bars on the current track), a 36pt cover, title and artists,
 * the album where there is room, Like, the length and its menu. With the
 * page's `wave` it slides in from the right, its cover flipping open. */
export function TrackRow(props: { track: Track; list?: Track[]; index?: number; compact?: boolean; active?: boolean; menu?: boolean; playLabel?: string; selected?: boolean; selecting?: boolean; onSelect?: () => void; onLongPress?: () => void; onPlay?: () => void; trailing?: JSX.Element; actionsBelow?: boolean; rank?: number; numbered?: boolean; wave?: ListWave }) {
  const { style: entrance, cover: coverIn, text: textIn } = untracked(() => listItemEntrance({ wave: props.wave, key: () => props.track.id, index: () => props.index ?? 0, axis: "translateX", turns: WAVE.rows }));
  const current = () => props.active ?? p.currentTrack()?.id === props.track.id;
  const liked = () => s.isLiked(props.track.id);
  const numbered = () => !props.compact && !props.selecting && (props.numbered ?? props.index !== undefined);
  const wide = () => !props.compact && wideTracks();
  const play = () => props.selecting ? props.onSelect?.() : together.isGuest() ? action(() => together.suggestTrack(props.track), "点歌请求已发送") : props.onPlay ? props.onPlay() : action(() => props.list && props.index !== undefined ? p.playList(props.list, props.index) : p.playTrack(props.track, props.list));
  return <View testID={`track-${props.track.id}`} style={entrance} class={`group min-w-0 rounded-(--radius) ${props.selected ? "bg-secondary" : current() ? "bg-row-hover" : ""} transition-colors duration-150 hover:bg-row-hover motion-reduce:transition-none`}>
    <View class={`min-w-0 flex-row items-center gap-1 pr-1 ${props.compact ? "h-14" : "h-14"}`}>
      <If when={props.selecting}><View class="pl-2"><Tool icon={props.selected ? "checkCircle" : "circle"} label={`${props.selected ? "取消选择" : "选择"} ${props.track.title}`} active={props.selected} onPress={() => props.onSelect?.()} /></View></If>
      <View role="button" testID={`play-track-${props.track.id}`} accessibilityLabel={props.selecting ? `${props.selected ? "取消选择" : "选择"} ${props.track.title}` : props.playLabel || `播放 ${props.track.title}`} onPress={play} onLongPress={props.onLongPress}
        class={`min-w-0 flex-1 flex-row items-center gap-3 self-stretch rounded-(--radius) pl-3 active:opacity-70 ${focusRing}`}>
        <If when={numbered() || props.rank !== undefined}><View class="w-6 items-end">
          <If when={current()} else={<View class="relative items-end justify-center">
            <Digits class={`text-xs text-muted-foreground ${LAYER} group-hover:-translate-y-1 group-hover:opacity-0`}>{String(props.rank ?? (props.index ?? 0) + 1)}</Digits>
            <View class={`absolute right-0 scale-50 opacity-0 ${LAYER} group-hover:scale-100 group-hover:opacity-100 group-active:scale-90`}><Icon name="play" size={12} color="foreground" /></View>
          </View>}><PlayingBars playing={p.playing()} /></If>
        </View></If>
        <View style={coverIn} class="relative">
          <Art track={props.track} size={props.compact ? 40 : 36} radius={4} />
          <If when={!numbered() && props.rank === undefined}><View class={`absolute inset-0 items-center justify-center rounded-sm ${current() ? "bg-black/55 opacity-100" : "bg-black/45 opacity-0 group-hover:opacity-100"} ${LAYER}`}>
            <If when={current()} else={<Icon name="play" size={14} color="#ffffff" />}><PlayingBars playing={p.playing()} size={12} /></If>
          </View></If>
        </View>
        <View class="min-w-0 flex-1 gap-0.5" style={textIn}>
          <Text class={`line-clamp-1 text-sm text-foreground ${current() ? "font-semibold" : "font-medium"}`}>{props.track.title}</Text>
          <View class="flex-row items-center gap-1.5">
            <If when={s.downloads().some((t) => t.id === props.track.id)}><Icon name="download" size={12} color="primary" /></If>
            <Text class="line-clamp-1 flex-1 text-xs text-muted-foreground">{props.track.artist}{props.compact && props.track.duration ? ` · ${time(props.track.duration)}` : ""}</Text>
          </View>
        </View>
        <If when={wide()}><Text class="line-clamp-1 min-w-0 flex-1 text-xs text-muted-foreground">{props.track.album}</Text></If>
      </View>
      <If when={!narrow() && !props.compact}><View class={liked() ? "" : `opacity-0 ${LAYER} group-hover:opacity-100`}><Tool icon="heart" label={liked() ? "取消喜欢" : "喜欢这首歌"} active={liked()} size={16} onPress={() => s.toggleLike(props.track)} /></View>
        <Digits class="w-12 text-right text-xs text-muted-foreground">{props.track.duration ? time(props.track.duration) : ""}</Digits></If>
      <If when={!props.actionsBelow}>{props.trailing}</If>
      <If when={!props.selecting && props.menu !== false}><View class={touch() ? "" : `opacity-60 ${LAYER} group-hover:opacity-100`}><SongMenu track={props.track} /></View></If>
    </View>
    <If when={props.actionsBelow}><View testID={`track-actions-${props.track.id}`} class="flex-row justify-end gap-2 pb-1">{props.trailing}</View></If>
  </View>;
}
/** A short list of tracks (a search's songs): every row, no recycling. */
export function TrackList(props: { tracks: Track[]; compact?: boolean; title?: string; wave?: ListWave; header?: boolean }) {
  const wave = untracked(() => props.wave ?? pageWave());
  return <View>
    <If when={props.header ?? !props.compact}><TrackHeader /></If>
    <Each of={props.tracks} key={(track) => track.id}>{(track, index) => <View class="pb-1"><TrackRow track={track()} list={props.tracks} index={index()} compact={props.compact} wave={wave} onPlay={() => action(() => p.playList(props.tracks, index(), props.title))} /></View>}</Each>
  </View>;
}

const PHI = (1 + Math.sqrt(5)) / 2;
/** A card's width in a row, pt (spotish `CARD_WIDTH`). */
export const CARD_WIDTH = 160;
const playSize = (card: number) => Math.round((card - 2 * 10) / PHI ** 3);
const playInset = (card: number) => Math.round(playSize(card) / PHI ** 2);
export const cardSize = () => narrow() ? 148 : CARD_WIDTH;

/** A card (spotish `Card`): picture, name, and what it is. A wash comes in
 * on hover, the cover grows a hair and the play button rises over it (shown
 * on phones and while it plays). With its row's `wave` it rises in, its
 * cover flipping open. */
export function Card(props: { label: string; onPress: () => void; onPlay?: () => void; playing?: boolean; cover: JSX.Element; title: string; subtitle: string; width?: number; fill?: boolean; wave?: ListWave; index?: number; itemKey: string; testID?: string }) {
  const width = () => props.width ?? cardSize();
  const buttonSize = () => touch() ? Math.max(40, playSize(width())) : Math.max(36, playSize(width()));
  const { style: rise, cover: coverIn, text: textIn } = untracked(() => listItemEntrance({ wave: props.wave, key: () => props.itemKey, index: () => props.index ?? 0, axis: "translateY", turns: WAVE.cards, coverTurn: "any" }));
  return <View testID={props.testID} role="button" accessibilityLabel={props.label} onPress={props.onPress} style={props.fill ? rise : { ...rise, width: width() }}
    class={`group shrink-0 gap-2 rounded-(--radius-card) p-2.5 transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${focusRing}`}>
    <View class="relative">
      <View class="transition duration-300 ease-out group-hover:scale-[1.01] motion-reduce:transition-none motion-reduce:group-hover:scale-100"><View style={coverIn}>{props.cover}</View></View>
      <If when={props.onPlay}><View style={{ right: playInset(width()), bottom: playInset(width()) }} class={`absolute transition duration-200 ease-out group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 motion-reduce:transition-none ${touch() || props.playing ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-75 opacity-0"}`}>
        <PlayButton labels={["播放", "暂停"]} playing={!!props.playing} size={buttonSize()} onPress={() => props.onPlay?.()} />
      </View></If>
    </View>
    <View class="gap-1" style={textIn}>
      <Text class="line-clamp-1 text-sm font-semibold text-foreground">{props.title}</Text>
      <Text class="line-clamp-2 text-xs text-muted-foreground">{props.subtitle}</Text>
    </View>
  </View>;
}
const kindName = { album: "专辑", artist: "歌手", playlist: "歌单" } as const;
export function MusicCard(props: { item: CatalogItem; list?: Track[]; width?: number; fill?: boolean; wave?: ListWave; index?: number }) {
  const artist = () => !isTrack(props.item) && props.item.type === "artist";
  const open = () => isTrack(props.item) ? together.isGuest() ? action(() => together.suggestTrack(props.item as Track), "点歌请求已发送") : action(() => p.playTrack(props.item as Track, props.list)) : nav.browse(props.item as Collection);
  const playing = () => isTrack(props.item) ? p.currentTrack()?.id === props.item.id && p.playing() : p.queueTitle() === props.item.title && p.playing();
  const play = () => playing() ? action(p.togglePlay) : isTrack(props.item) ? open() : action(() => s.playCollection(props.item as Collection));
  return <Card label={props.item.title} itemKey={props.item.id} onPress={open} onPlay={artist() || together.isGuest() && !isTrack(props.item) ? undefined : play} playing={playing()} width={props.width} fill={props.fill} wave={props.wave} index={props.index} title={props.item.title}
    subtitle={isTrack(props.item) ? props.item.artist : props.item.subtitle || kindName[props.item.type]}
    cover={<Cover src={props.item.artwork} round={artist()} fallback={artist() ? "user" : "disc"} class="shadow-md" />} />;
}
/** A titled row of cards that scrolls sideways (spotish `CardRow`), 216
 * tall, running out to the page's edges. Not a virtualized `List`: nested
 * in the page's own scroller, a horizontal List renders no cells in release
 * builds on Linux; a shelf holds a couple of dozen cards at most. */
export function CardRow(props: { items: CatalogItem[]; wave?: ListWave; delay?: number; title?: string; class?: string; testID?: string }) {
  const wave = untracked(() => (props.wave ?? pageWave()).child(props.delay ?? 0));
  const songs = () => props.items.filter(isTrack);
  return <View class={`gap-2 ${props.class ?? ""}`}>
    <If when={props.title}><SectionTitle title={props.title!} /></If>
    <Scroll testID={props.testID} horizontal scrollbar={false} class="-mx-3" style={{ height: cardSize() + 72 }} contentClass="flex-row px-1 pt-1">
      <Each of={props.items} key={(item) => item.id}>{(item, index) => <MusicCard item={item()} list={songs()} wave={wave} index={index()} />}</Each>
    </Scroll>
  </View>;
}
/** Cards that fill their rows (spotish `CardGrid`): as many columns as fit. */
export function CardGrid(props: { items: CatalogItem[]; wave?: ListWave; delay?: number }) {
  const wave = untracked(() => (props.wave ?? pageWave()).child(props.delay ?? 0));
  const room = signal(0);
  const width = () => { const w = room(); return w > 0 ? w / Math.max(1, Math.floor(w / cardSize())) : cardSize(); };
  return <View class="-mx-3 flex-row flex-wrap" onLayout={(event) => room.set(event.bounds.size.width)}>
    <Each of={props.items} key={(item) => item.id}>{(item, index) => <MusicCard item={item()} width={Math.floor(width())} wave={wave} index={index()} list={props.items.filter(isTrack)} />}</Each>
  </View>;
}
export function ItemRail(props: { items: CatalogItem[]; all?: boolean; wave?: ListWave }) {
  return <CardRow items={props.items} wave={props.wave} />;
}
/** An album, artist or playlist as a row: a cover (round for an artist), the
 * name and what it is, and saving it. */
export function CollectionRow(props: { item: Collection; wave?: ListWave; index?: number }) {
  const { style: entrance, cover: coverIn, text: textIn } = untracked(() => listItemEntrance({ wave: props.wave, key: () => props.item.id, index: () => props.index ?? 0, axis: "translateX", turns: WAVE.rows }));
  const artist = () => props.item.type === "artist";
  return <View style={entrance} class="group min-w-0 flex-row items-center gap-1 rounded-(--radius) pr-1 transition-colors duration-150 hover:bg-row-hover motion-reduce:transition-none">
    <View role="button" accessibilityLabel={props.item.title} onPress={() => nav.browse(props.item)} class={`h-14 min-w-0 flex-1 flex-row items-center gap-3 rounded-(--radius) pl-3 active:opacity-70 ${focusRing}`}>
      <View style={coverIn}><Cover src={props.item.artwork} size={40} round={artist()} fallback={artist() ? "user" : "disc"} class={artist() ? "" : "rounded-sm"} /></View>
      <View class="min-w-0 flex-1 gap-0.5" style={textIn}><Text class="line-clamp-1 text-sm font-medium text-foreground">{props.item.title}</Text><Text class="line-clamp-1 text-xs text-muted-foreground">{props.item.subtitle || kindName[props.item.type]}</Text></View>
    </View>
    <Tool icon={artist() ? "checkCircle" : "bookmark"} label={s.isCollectionSaved(props.item.id) ? "移除收藏" : "收藏"} active={s.isCollectionSaved(props.item.id)} onPress={() => s.toggleCollectionSaved(props.item)} />
  </View>;
}
/** A playlist's cover: its first four covers, or the first. */
export function PlaylistCover(props: { playlist: Playlist; size?: number; class?: string }) {
  return <View class={`overflow-hidden rounded-md bg-secondary ${props.size ? "" : "aspect-square w-full"} ${props.class ?? ""}`} style={props.size ? { width: props.size, height: props.size } : undefined}>
    <If when={props.playlist.tracks.length >= 4} else={<Cover src={props.playlist.tracks[0]?.artwork ?? ""} size={props.size} fallback="playlist" />}>
      <View class="flex-1 flex-row flex-wrap"><Each of={props.playlist.tracks.slice(0, 4)}>{(track) => <View class="h-1/2 w-1/2"><Cover src={track().artwork} fallback="music" class="rounded-none" /></View>}</Each></View>
    </If>
  </View>;
}
export function PlaylistCard(props: { playlist: Playlist; grid?: boolean; wave?: ListWave; index?: number; width?: number }) {
  return <If when={props.grid} else={<View role="button" accessibilityLabel={props.playlist.name} onPress={() => nav.openPlaylist(props.playlist.id)} class={`h-14 flex-row items-center gap-3 rounded-(--radius) px-3 ${ROW}`}><PlaylistCover playlist={props.playlist} size={40} /><View class="min-w-0 flex-1 gap-0.5"><Text class="line-clamp-1 text-sm font-medium text-foreground">{props.playlist.name}</Text><Text class="text-xs text-muted-foreground">歌单 · {props.playlist.tracks.length} 首歌曲</Text></View></View>}>
    <Card label={props.playlist.name} itemKey={props.playlist.id} width={props.width} wave={props.wave} index={props.index} onPress={() => nav.openPlaylist(props.playlist.id)} onPlay={props.playlist.tracks.length ? () => action(() => p.playList(props.playlist.tracks, 0, props.playlist.name)) : undefined} playing={p.queueTitle() === props.playlist.name && p.playing()} title={props.playlist.name} subtitle={`歌单 · ${props.playlist.tracks.length} 首歌曲`} cover={<PlaylistCover playlist={props.playlist} class="shadow-md" />} />
  </If>;
}
