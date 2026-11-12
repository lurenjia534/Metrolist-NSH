import { View, Scroll, signal, computed, Clipboard } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as account from "../account";
import * as cloud from "../cloudActions";
import { CloudLibrary, CloudCollectionActions, CloudTrackControls } from "../components/CloudLibrary";
import { isTrack, type Track, type PlaylistSort, type LibrarySort, type Collection } from "../model";
import { Icon } from "../icons";
import { TrackList, TrackRow, MusicCard, CollectionRow, PlaylistCard, PlaylistCover, ItemRail } from "../components/Music";
import { Label, Tool, Pill, Chip, Field, SectionTitle, Empty, Press, CommandMenu, Art, palette as c, narrow, action, say, time, type CommandItem } from "../ui";
const sortNames = { recent: "最近添加", title: "名称", artist: "歌手", playTime: "聆听时长", songCount: "歌曲数量" };

export function LibraryPage() {
  return <View style={{ gap: 20 }}><View style={{ flexDirection: "row", gap: 10 }}><Chip testID="library-device" label="本机" icon="library" selected={cloud.libraryScope() === "device"} onPress={() => cloud.libraryScope.set("device")} /><Chip testID="library-cloud" label="YouTube Music" icon="artist" selected={cloud.libraryScope() === "cloud"} onPress={() => { cloud.libraryScope.set("cloud"); if (account.signedIn()) void action(() => account.loadCloudLibrary()); }} /></View><If when={cloud.libraryScope() === "cloud"} else={<DeviceLibrary />}><CloudLibrary /></If></View>;
}
function DeviceLibrary() {
  const selecting = signal(false);
  const selected = signal<string[]>([]);
  const selectedRows = () => s.libraryTracks().filter(track => selected().includes(track.id));
  const toggle = (id: string) => selected.update(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  const grid = () => s.settings().libraryView === "grid";
  const all = () => nav.libraryTab() === "all";
  const tab = (id: string) => all() || nav.libraryTab() === id;
  const onlinePlaylists = () => s.savedCollections().filter(item => item.type === "playlist" && item.title.toLowerCase().includes(s.libraryQuery().toLowerCase()));
  return <View testID="page-library" style={{ gap: 20 }}>
    <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={[{ id: "playlists", text: "歌单" }, { id: "songs", text: "歌曲" }, { id: "albums", text: "专辑" }, { id: "artists", text: "歌手" }]}>{item => <Chip testID={`library-${item().id}`} label={item().text} selected={nav.libraryTab() === item().id} onPress={() => { nav.libraryTab.set(nav.libraryTab() === item().id ? "all" : item().id); selecting.set(false); selected.set([]); }} />}</Each></Scroll>
    <View testID="library-toolbar" style={{ flexDirection: narrow() ? "column" : "row", gap: 8, alignItems: narrow() ? "stretch" : "center" }}><View style={{ flex: narrow() ? undefined : 1, minWidth: 0 }}><Field value={s.libraryQuery()} onChange={s.libraryQuery.set} placeholder="在音乐库中查找" testID="library-filter" /></View><View style={{ flexDirection: "row", alignSelf: narrow() ? "flex-end" : undefined, alignItems: "center", gap: 8 }}><CommandMenu label="排序" icon="sort" items={[...Object.entries(sortNames).map(([key, label]) => ({ label, active: s.librarySort() === key, run: () => s.librarySort.set(key as LibrarySort) })), { label: s.libraryDescending() ? "切换为升序" : "切换为降序", icon: s.libraryDescending() ? "up" : "down", separator: true, run: () => s.libraryDescending.update(value => !value) }]} /><Tool icon={grid() ? "list" : "grid"} label={grid() ? "切换列表" : "切换网格"} onPress={() => s.updateSettings({ libraryView: grid() ? "list" : "grid" })} /><CommandMenu label="音乐库操作" items={[{ label: "新建歌单", icon: "plus", run: nav.newPlaylist }, { label: "导入音乐", icon: "upload", run: nav.showImport }, { label: selecting() ? "完成选择" : "选择歌曲", icon: "checkCircle", run: () => { selecting.update(value => !value); nav.libraryTab.set("songs"); } }, { label: "导出音乐库", icon: "download", run: () => void action(s.exportLibrary, "音乐库已导出") }]} /></View></View>
    <If when={all() && !s.libraryQuery()}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Each of={[{ id: "liked", icon: "heart", name: "喜欢的音乐", count: s.likedTracks().length }, { id: "downloads", icon: "download", name: "已下载", count: s.downloads().length }, { id: "history", icon: "clock", name: "最近播放", count: s.history().length }]}>{item => <Press label={item().name} onPress={() => nav.navigate(item().id as nav.Page)} style={{ flex: 1, minWidth: 140, padding: 20, backgroundColor: c().card, borderRadius: 20, gap: 12 }}><Icon name={item().icon} size={28} color={c().accent} /><Label weight="600">{item().name}</Label><Label size={12} color={c().sub}>{item().count} 首歌曲</Label></Press>}</Each></View></If>
    <If when={selecting()}><View style={{ gap: 12, padding: 16, borderRadius: 16, backgroundColor: c().selected }}><Label>已选择 {selected().length} 首</Label><Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Pill label="全选" onPress={() => selected.set(s.filteredTracks().map(track => track.id))} /><Pill label="加入歌单" disabled={!selected().length} onPress={() => nav.addToPlaylist(selectedRows())} /><Pill label="下载" disabled={!selected().length} onPress={() => { for (const track of selectedRows()) void s.downloadTrack(track).catch(s.showError); say("已加入下载"); }} /><Pill label="移除" disabled={!selected().length} onPress={() => { for (const id of selected()) s.removeFromLibrary(id); selected.set([]); }} /></Scroll></View></If>
    <If when={tab("playlists")}><View style={{ gap: 12 }}><SectionTitle title="歌单" action="新建" icon="plus" onPress={nav.newPlaylist} />
      <If when={s.filteredPlaylists().length + onlinePlaylists().length > 0} else={<Empty icon="queue" title="创建你的第一张歌单" description="从歌曲菜单中选择“加入歌单”，也可以导入 YouTube Music 歌单。"><Pill label="导入歌单" icon="link" onPress={nav.showImport} /></Empty>}><View style={{ flexDirection: grid() ? "row" : "column", flexWrap: grid() ? "wrap" : "nowrap", gap: grid() ? narrow() ? 16 : 20 : 2 }}><Each of={s.filteredPlaylists()}>{item => <PlaylistCard playlist={item()} grid={grid()} />}</Each><Each of={onlinePlaylists()}>{item => <If when={grid()} else={<CollectionRow item={item()} />}><MusicCard item={item()} /></If>}</Each></View></If>
    </View></If>
    <If when={tab("songs")}><View><SectionTitle title={`歌曲 · ${s.filteredTracks().length}`} disabled={p.remoteControlled()} action="随机播放" icon="shuffle" onPress={() => action(() => p.playList(shuffled(s.filteredTracks()), 0, "音乐库"))} /><If when={s.filteredTracks().length > 0} else={<Empty icon="music" title="音乐库还没有歌曲" description="在歌曲菜单中加入音乐库，或者导入本地音频。"><Pill label="导入音乐" onPress={nav.showImport} /></Empty>}><If when={selecting()} else={<TrackList tracks={s.filteredTracks()} title="音乐库" />}><Each of={s.filteredTracks()}>{track => <TrackRow track={track()} selected={selected().includes(track().id)} selecting onSelect={() => toggle(track().id)} />}</Each></If></If></View></If>
    <If when={tab("albums")}><SavedCollections title="专辑" items={s.filteredAlbums()} grid={grid()} /></If>
    <If when={tab("artists")}><SavedCollections title="歌手" items={s.filteredArtists()} grid={grid()} /></If>
  </View>;
}
function SavedCollections(props: { title: string; items: Collection[]; grid: boolean }) {
  return <View><SectionTitle title={`${props.title} · ${props.items.length}`} /><If when={props.items.length} else={<Empty icon={props.title === "歌手" ? "artist" : "album"} title={`还没有收藏的${props.title}`} description={`在搜索结果中打开${props.title}，点按收藏即可加入音乐库。`} />}><View style={{ flexDirection: props.grid ? "row" : "column", flexWrap: props.grid ? "wrap" : "nowrap", gap: props.grid ? narrow() ? 16 : 24 : 4 }}><Each of={props.items}>{item => <If when={props.grid} else={<CollectionRow item={item()} />}><MusicCard item={item()} /></If>}</Each></View></If></View>;
}
export function shuffled(tracks: Track[]) { const list = [...tracks]; for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; }

export function SongCollectionPage(props: { kind: "liked" | "history" | "playlist" }) {
  const filter = signal("");
  const sort = signal<PlaylistSort>("custom");
  const editing = signal(false);
  const playlist = nav.currentPlaylist;
  const title = () => props.kind === "liked" ? "喜欢的音乐" : props.kind === "history" ? "最近播放" : playlist()?.name || "歌单";
  const entries = computed(() => props.kind === "playlist" ? s.playlistEntries(nav.selectedPlaylist(), filter(), sort()) : (props.kind === "liked" ? account.signedIn() ? [...account.cloudLibrary().liked.filter(isTrack), ...s.likedTracks().filter(track => track.source === "audio")] : s.likedTracks() : s.history()).filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(filter().toLowerCase())).map((track, index) => ({ track, index })));
  const tracks = computed(() => entries().map(entry => entry.track));
  const options = (): CommandItem[] => props.kind === "playlist" ? [
    ...(account.signedIn() ? [{ label: "加入 YouTube Music 歌单", icon: "plus", run: () => cloud.addToCloudPlaylist(tracks()) }] : []),
    { label: "重命名", icon: "edit", run: () => { nav.draft.set(title()); nav.dialog.set("rename"); } },
    { testID: "playlist-edit", label: editing() ? "完成编辑" : "调整歌曲顺序", icon: "sort", run: () => { editing.update(value => !value); sort.set("custom"); filter.set(""); } },
    { label: "导出歌单", icon: "share", run: () => void action(() => s.exportPlaylist(nav.selectedPlaylist()), "歌单已导出") },
    { label: "删除歌单", icon: "trash", danger: true, run: () => { s.deletePlaylist(nav.selectedPlaylist()); nav.navigate("library", true); } },
  ] : props.kind === "history" ? [{ label: "清空播放历史", icon: "trash", run: s.clearHistory }] : [];
  return <View testID={`page-${props.kind}`} style={{ gap: 24 }}>
    <View style={{ flexDirection: narrow() ? "column" : "row", gap: 28, alignItems: narrow() ? "center" : "flex-end" }}>
      <If when={props.kind === "playlist" && playlist()} else={<View style={{ width: narrow() ? 180 : 208, height: narrow() ? 180 : 208, alignItems: "center", justifyContent: "center", backgroundColor: c().selected, borderRadius: 20 }}><Icon name={props.kind === "liked" ? "heart" : "clock"} size={68} color={c().accent} filled={props.kind === "liked"} /></View>}>{() => <PlaylistCover playlist={playlist()!} size={narrow() ? 180 : 208} />}</If>
      <View style={{ flex: narrow() ? undefined : 1, gap: 14, alignItems: narrow() ? "center" : "flex-start", width: narrow() ? "100%" : undefined }}><Label size={narrow() ? 28 : 36} weight="600" style={{ textAlign: narrow() ? "center" : "left" }}>{title()}</Label><Label color={c().sub} size={14}>{tracks().length} 首歌曲 · {Math.floor(tracks().reduce((total, track) => total + track.duration, 0) / 60)} 分钟</Label><View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: narrow() ? "center" : "flex-start" }}><Pill label="播放" icon="play" primary disabled={p.remoteControlled() || !tracks().length} onPress={() => action(() => p.playList(tracks(), 0, title()))} /><Pill label="随机" icon="shuffle" disabled={p.remoteControlled() || !tracks().length} onPress={() => action(() => p.playList(shuffled(tracks()), 0, title()))} /><Tool icon="download" label="下载全部" onPress={() => { for (const track of tracks()) void s.downloadTrack(track).catch(s.showError); say("已加入下载"); }} /><If when={options().length > 0}><CommandMenu label="歌单操作" items={options()} /></If></View></View>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Field value={filter()} onChange={filter.set} placeholder="查找歌曲" /><If when={props.kind === "playlist"}><CommandMenu label="歌曲排序" icon="sort" items={Object.entries({ custom: "自定义顺序", recent: "最近添加", title: "歌曲名称", artist: "歌手", playTime: "聆听时长", duration: "歌曲时长" }).map(([key, label]) => ({ label, active: sort() === key, run: () => { sort.set(key as PlaylistSort); editing.set(false); } }))} /></If></View>
    <If when={tracks().length > 0} else={<Empty icon="music" title="这里还没有歌曲" description={props.kind === "history" ? "播放过的音乐会出现在这里。" : "在歌曲菜单中添加喜欢的音乐。"}><Pill label="搜索音乐" onPress={() => nav.navigate("search")} /></Empty>}><Each of={entries()}>{(entry, index) => <TrackRow track={entry().track} list={tracks()} index={index()} actionsBelow={editing()} trailing={<If when={editing() && props.kind === "playlist"}><Tool testID={`playlist-up-${entry().index}`} icon="up" label="上移" disabled={entry().index === 0} onPress={() => s.movePlaylistTrack(nav.selectedPlaylist(), entry().index, entry().index - 1)} /><Tool testID={`playlist-down-${entry().index}`} icon="down" label="下移" disabled={entry().index >= (playlist()?.tracks.length || 0) - 1} onPress={() => s.movePlaylistTrack(nav.selectedPlaylist(), entry().index, entry().index + 1)} /><Tool testID={`playlist-remove-${entry().index}`} icon="close" label="从歌单移除" onPress={() => s.removeFromPlaylist(nav.selectedPlaylist(), entry().track.id, entry().index)} /></If>} />}</Each></If>
  </View>;
}

export function CollectionPage() {
  const item = s.activeCollection;
  const details = s.collectionDetails;
  const expanded = signal(false);
  const cloudEditing = signal(false);
  const currentCollection = () => ({ ...item()!, ...details(), id: item()!.id, browseId: item()!.browseId, type: item()!.type });
  const artist = () => item()?.type === "artist";
  const title = () => details()?.title || item()?.title || "";
  const primaryShelf = computed(() => details()?.sections.find(section => section.items.some(isTrack)));
  const mainTracks = computed(() => artist() && primaryShelf()
    ? primaryShelf()!.items.filter(isTrack).map(track => s.collectionTracks().find(item => item.id === track.id) || track)
    : s.collectionTracks());
  const shelves = computed(() => {
    const displayed = new Set(mainTracks().map(track => track.id));
    return (details()?.sections || []).map(section => ({ ...section, items: section.items.filter(item => !isTrack(item) || !displayed.has(item.id)) })).filter(section => section.items.length > 0);
  });
  const share = () => action(async () => { await Clipboard.writeText(`https://music.youtube.com/browse/${item()!.browseId}`); say("链接已复制"); });
  return <View testID="page-collection" style={{ gap: 28 }}><If when={item()}>{collection => <>
    <View style={{ flexDirection: narrow() ? "column" : "row", gap: 28, alignItems: narrow() ? "center" : "flex-end" }}>
      <Art src={details()?.artwork || collection().artwork} size={narrow() ? 216 : 248} radius={artist() ? 160 : 18} icon={artist() ? "artist" : "album"} />
      <View style={{ flex: narrow() ? undefined : 1, gap: 14, alignItems: narrow() ? "center" : "flex-start", width: narrow() ? "100%" : undefined }}><Label size={narrow() ? 30 : 40} weight="600" style={{ textAlign: narrow() ? "center" : "left" }}>{title()}</Label><Label size={14} color={c().sub} style={{ textAlign: narrow() ? "center" : "left" }}>{details()?.subtitle || collection().subtitle}{details()?.year ? ` · ${details()!.year}` : ""}</Label><If when={details()?.subscriberCount}><Label color={c().sub} size={13}>{details()!.subscriberCount}</Label></If><If when={!artist()}><Label size={13} color={c().faint}>{s.collectionTracks().length} 首 · {Math.floor(s.collectionTracks().reduce((sum, track) => sum + track.duration, 0) / 60)} 分钟</Label></If>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: narrow() ? "center" : "flex-start" }}><Pill primary label={artist() ? "随机播放" : "播放"} icon={artist() ? "shuffle" : "play"} disabled={p.remoteControlled() || !mainTracks().length} onPress={() => action(() => p.playList(artist() ? shuffled(mainTracks()) : mainTracks(), 0, title()))} /><Pill label={s.isCollectionSaved(collection().id) ? "已存到本机" : "存到本机"} icon={s.isCollectionSaved(collection().id) ? "check" : "plus"} active={s.isCollectionSaved(collection().id)} onPress={() => s.toggleCollectionSaved({ ...collection(), ...details(), type: collection().type, id: collection().id, browseId: collection().browseId })} /><CloudCollectionActions item={currentCollection()} /><If when={account.signedIn() && currentCollection().editable}><Pill label={cloudEditing() ? "完成编辑" : "编辑云端歌曲"} icon="edit" active={cloudEditing()} onPress={() => cloudEditing.update(value => !value)} /></If><Tool icon="radio" label="歌曲电台" disabled={p.remoteControlled() || !mainTracks().length} onPress={() => void s.startRadio(mainTracks()[0])} /><CommandMenu label="更多操作" items={[...(account.signedIn() ? [{ label: "加入 YouTube Music 歌单", icon: "plus", run: () => cloud.addToCloudPlaylist(mainTracks()) }] : []), { label: "加入本地歌单", icon: "plus", run: () => nav.addToPlaylist(mainTracks()) }, { label: "下载全部", icon: "download", run: () => { for (const track of mainTracks()) void s.downloadTrack(track).catch(s.showError); say("已加入下载"); } }, { label: "分享链接", icon: "share", run: share }]} /></View></View>
    </View>
    <If when={details()?.description}><Press label={expanded() ? "收起简介" : "展开简介"} onPress={() => expanded.update(value => !value)} style={{ padding: 20, backgroundColor: c().card, borderRadius: 20, gap: 12 }}><Label size={16} weight="600">{artist() ? "关于" : "简介"}</Label><Label size={14} color={c().sub} lines={expanded() ? undefined : 3} style={{ lineHeight: 23 }}>{details()!.description}</Label><Label size={12} color={c().accent}>{expanded() ? "收起" : "展开"}</Label></Press></If>
    <If when={s.collectionLoading()}><Label color={c().accent}>正在加载…</Label></If>
    <If when={mainTracks().length > 0}><View><If when={artist()}><SectionTitle title={primaryShelf()?.title || "热门歌曲"} /></If><If when={cloudEditing()} else={<TrackList tracks={mainTracks()} title={title()} />}><Each of={mainTracks()}>{(track, index) => <TrackRow track={track()} list={mainTracks()} index={index()} trailing={<CloudTrackControls item={currentCollection()} track={track()} index={index()} tracks={mainTracks()} />} />}</Each></If></View></If>
    <If when={details()?.continuation}><Pill label="加载更多歌曲" disabled={s.collectionLoading()} onPress={() => void s.loadMoreCollection()} /></If>
    <Each of={shelves()}>{section => <If when={section().items.length > 0}><View><SectionTitle title={section().title} /><ItemRail items={section().items} all /></View></If>}</Each>
  </>}</If></View>;
}
