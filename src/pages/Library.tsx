import { View, Scroll, List, signal, computed, Clipboard } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as account from "../account";
import * as cloud from "../cloudActions";
import { CloudLibrary, CloudCollectionActions, CloudTrackControls } from "../components/CloudLibrary";
import { isTrack, type Track, type PlaylistSort, type LibrarySort, type Collection } from "../model";
import { Icon } from "../icons";
import { TrackList, TrackRow, MusicCard, CollectionRow, PlaylistCard, PlaylistCover, ItemRail } from "../components/Music";
import { Label, Tool, Pill, Chip, Field, SectionTitle, Empty, Press, CommandMenu, Art, palette as c, narrow, action, say, type CommandItem } from "../ui";
const sortNames = { recent: "最近添加", title: "名称", artist: "歌手", playTime: "聆听时长", songCount: "歌曲数量" };
const playlistSortNames = { custom: "自定义顺序", recent: "最近添加", title: "歌曲名称", artist: "歌手", playTime: "聆听时长", duration: "歌曲时长" };

function createSelection(visibleKeys: () => string[]) {
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

function downloadTracks(tracks: Track[]) {
  const unique = [...new Map(tracks.map(track => [track.id, track])).values()];
  for (const track of unique) void s.downloadTrack(track).catch(s.showError);
  say(`已将 ${unique.length} 首歌曲加入下载`);
}

function SelectionActions(props: {
  tracks: Track[]; title: string; visibleCount: number; selectedVisibleCount: number;
  onAll: () => void; onClear: () => void; onDone: () => void;
  removeLabel: string; onRemove: () => void;
}) {
  const empty = () => props.tracks.length === 0;
  const allLiked = () => props.tracks.every(track => s.isLiked(track.id));
  const setLikes = () => {
    const liked = !allLiked();
    for (const track of new Map(props.tracks.map(track => [track.id, track])).values()) {
      if (s.isLiked(track.id) !== liked) s.toggleLike(track);
    }
    say(liked ? "已喜欢所选歌曲" : "已取消喜欢所选歌曲");
  };
  return <View testID="song-selection" style={{ gap: 8, padding: 12, borderRadius: 18, backgroundColor: c().selected }}>
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Label weight="600" testID="selection-count">已选择 {props.tracks.length} 首</Label>
        <Label size={11} color={c().sub}>{Math.floor(props.tracks.reduce((sum, track) => sum + track.duration, 0) / 60)} 分钟{props.tracks.length > props.selectedVisibleCount ? ` · 筛选外 ${props.tracks.length - props.selectedVisibleCount} 首` : " · 长按可连续选择"}</Label>
      </View>
      <Tool testID="selection-all" icon="checkCircle" label="全选当前结果" active={props.visibleCount > 0 && props.selectedVisibleCount === props.visibleCount} disabled={!props.visibleCount} onPress={props.onAll} />
      <Tool testID="selection-done" icon="close" label="完成选择" onPress={props.onDone} />
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Scroll horizontal scrollbar={false} style={{ flex: 1, minWidth: 0, height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
        <Pill testID="selection-play" label="播放" icon="play" primary disabled={empty() || p.remoteControlled()} onPress={() => void action(() => p.playList(props.tracks, 0, props.title))} />
        <Pill testID="selection-next" label="下一首播放" icon="next" disabled={empty() || p.remoteControlled()} onPress={() => { p.playNextTracks(props.tracks); say(`已将 ${props.tracks.length} 首歌曲放到下一首`); }} />
        <Pill testID="selection-queue" label="加入队列" icon="queue" disabled={empty() || p.remoteControlled()} onPress={() => { p.addTracksToQueue(props.tracks); say(`已将 ${props.tracks.length} 首歌曲加入队列`); }} />
        <Pill testID="selection-playlist" label="加入歌单" icon="plus" disabled={empty()} onPress={() => nav.addToPlaylist(props.tracks)} />
        <Pill testID="selection-download" label="下载" icon="download" disabled={empty()} onPress={() => downloadTracks(props.tracks)} />
      </Scroll>
      <CommandMenu testID="selection-actions" label="所选歌曲操作" items={[
        { testID: "selection-clear", label: "取消全选", icon: "checkCircle", disabled: empty(), run: props.onClear },
        { testID: "selection-like", label: allLiked() && !empty() ? "取消喜欢" : "喜欢所选歌曲", icon: "heart", disabled: empty(), run: setLikes },
        ...(account.signedIn() ? [{ label: "加入 YouTube Music 歌单", icon: "plus", disabled: !props.tracks.some(track => track.source === "youtube"), run: () => cloud.addToCloudPlaylist(props.tracks) }] : []),
        { testID: "selection-remove", label: props.removeLabel, icon: "trash", danger: true, separator: true, disabled: empty(), run: props.onRemove },
      ]} />
    </View>
  </View>;
}


export function LibraryPage() {
  return <View style={{ gap: 20 }}><View style={{ flexDirection: "row", gap: 10 }}><Chip testID="library-device" label="本机" icon="library" selected={cloud.libraryScope() === "device"} onPress={() => cloud.libraryScope.set("device")} /><Chip testID="library-cloud" label="YouTube Music" icon="artist" selected={cloud.libraryScope() === "cloud"} onPress={() => { cloud.libraryScope.set("cloud"); if (account.signedIn()) void action(() => account.loadCloudLibrary()); }} /></View><If when={cloud.libraryScope() === "cloud"} else={<DeviceLibrary />}><CloudLibrary /></If></View>;
}
function DeviceLibrary() {
  const selection = createSelection(() => s.filteredTracks().map(track => track.id));
  const selectedRows = computed(() => s.sortTracks(s.libraryTracks(), s.librarySort(), s.libraryDescending()).filter(track => selection.keys().includes(track.id)));
  const selectedVisible = () => s.filteredTracks().filter(track => selection.keys().includes(track.id)).length;
  const beginSelection = () => { nav.libraryTab.set("songs"); selection.begin(); };
  const extendSelection = (id: string) => { nav.libraryTab.set("songs"); selection.extend(id); };
  const grid = () => s.settings().libraryView === "grid";
  const all = () => nav.libraryTab() === "all";
  const tab = (id: string) => all() || nav.libraryTab() === id;
  const onlinePlaylists = () => s.savedCollections().filter(item => item.type === "playlist" && item.title.toLowerCase().includes(s.libraryQuery().toLowerCase()));
  return <View testID="page-library" style={{ gap: 20 }}>
    <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={[{ id: "playlists", text: "歌单" }, { id: "songs", text: "歌曲" }, { id: "albums", text: "专辑" }, { id: "artists", text: "歌手" }]}>{item => <Chip testID={`library-${item().id}`} label={item().text} selected={nav.libraryTab() === item().id} onPress={() => { nav.libraryTab.set(nav.libraryTab() === item().id ? "all" : item().id); selection.finish(); }} />}</Each></Scroll>
    <View testID="library-toolbar" style={{ flexDirection: narrow() ? "column" : "row", gap: 8, alignItems: narrow() ? "stretch" : "center" }}><View style={{ flex: narrow() ? undefined : 1, minWidth: 0 }}><Field value={s.libraryQuery()} onChange={s.libraryQuery.set} placeholder="在音乐库中查找" testID="library-filter" /></View><View style={{ flexDirection: "row", alignSelf: narrow() ? "flex-end" : undefined, alignItems: "center", gap: 8 }}><CommandMenu label="排序" icon="sort" items={[...Object.entries(sortNames).map(([key, label]) => ({ label, active: s.librarySort() === key, run: () => s.librarySort.set(key as LibrarySort) })), { label: s.libraryDescending() ? "切换为升序" : "切换为降序", icon: s.libraryDescending() ? "up" : "down", separator: true, run: () => s.libraryDescending.update(value => !value) }]} /><Tool icon={grid() ? "list" : "grid"} label={grid() ? "切换列表" : "切换网格"} onPress={() => s.updateSettings({ libraryView: grid() ? "list" : "grid" })} /><CommandMenu label="音乐库操作" items={[{ label: "新建歌单", icon: "plus", run: nav.newPlaylist }, { label: "导入音乐", icon: "upload", run: nav.showImport }, { testID: "library-select", label: selection.active() ? "完成选择" : "选择歌曲", icon: "checkCircle", run: () => selection.active() ? selection.finish() : beginSelection() }, { label: "导出音乐库", icon: "download", run: () => void action(s.exportLibrary, "音乐库已导出") }]} /></View></View>
    <If when={all() && !s.libraryQuery()}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Each of={[{ id: "liked", icon: "heart", name: "喜欢的音乐", count: s.likedTracks().length }, { id: "downloads", icon: "download", name: "已下载", count: s.downloads().length }, { id: "history", icon: "clock", name: "最近播放", count: s.history().length }]}>{item => <Press label={item().name} onPress={() => nav.navigate(item().id as nav.Page)} style={{ flex: 1, minWidth: 140, padding: 20, backgroundColor: c().card, borderRadius: 20, gap: 12 }}><Icon name={item().icon} size={28} color={c().accent} /><Label weight="600">{item().name}</Label><Label size={12} color={c().sub}>{item().count} 首歌曲</Label></Press>}</Each></View></If>
    <If when={selection.active()}><SelectionActions tracks={selectedRows()} title="音乐库" visibleCount={s.filteredTracks().length} selectedVisibleCount={selectedVisible()} onAll={selection.all} onClear={selection.clear} onDone={selection.finish} removeLabel="从音乐库移除" onRemove={() => { for (const track of selectedRows()) s.removeFromLibrary(track.id); selection.clear(); say("已从音乐库移除所选歌曲"); }} /></If>
    <If when={tab("playlists")}><View style={{ gap: 12 }}><SectionTitle title="歌单" action="新建" icon="plus" onPress={nav.newPlaylist} />
      <If when={s.filteredPlaylists().length + onlinePlaylists().length > 0} else={<Empty icon="queue" title="创建你的第一张歌单" description="从歌曲菜单中选择“加入歌单”，也可以导入 YouTube Music 歌单。"><Pill label="导入歌单" icon="link" onPress={nav.showImport} /></Empty>}><View style={{ flexDirection: grid() ? "row" : "column", flexWrap: grid() ? "wrap" : "nowrap", gap: grid() ? narrow() ? 16 : 20 : 2 }}><Each of={s.filteredPlaylists()}>{item => <PlaylistCard playlist={item()} grid={grid()} />}</Each><Each of={onlinePlaylists()}>{item => <If when={grid()} else={<CollectionRow item={item()} />}><MusicCard item={item()} /></If>}</Each></View></If>
    </View></If>
    <If when={tab("songs")}><View>
      <SectionTitle title={`歌曲 · ${s.filteredTracks().length}`} disabled={p.remoteControlled() || !s.filteredTracks().length} action="随机播放" icon="shuffle" onPress={() => action(() => p.playList(shuffled(s.filteredTracks()), 0, "音乐库"))} />
      <If when={s.filteredTracks().length > 0} else={<Empty icon="music" title={s.libraryQuery() ? "没有匹配的歌曲" : "音乐库还没有歌曲"} description={s.libraryQuery() ? "换个关键词，或清除筛选查看全部音乐。" : "在歌曲菜单中加入音乐库，或者导入本地音频。"}><Pill label={s.libraryQuery() ? "清除筛选" : "导入音乐"} onPress={() => s.libraryQuery() ? s.libraryQuery.set("") : nav.showImport()} /></Empty>}>
        <List each={s.filteredTracks()} viewport="parent" estimatedItemSize={76} keyExtractor={track => track.id}>
          {(track, index) => <TrackRow track={track()} list={s.filteredTracks()} index={index()} selected={selection.keys().includes(track().id)} selecting={selection.active()} onSelect={() => selection.toggle(track().id)} onLongPress={() => extendSelection(track().id)} onPlay={() => action(() => p.playList(s.filteredTracks(), index(), "音乐库"))} />}
        </List>
      </If>
    </View></If>
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
  const descending = signal(false);
  const editing = signal(false);
  const playlist = nav.currentPlaylist;
  const title = () => props.kind === "liked" ? "喜欢的音乐" : props.kind === "history" ? "最近播放" : playlist()?.name || "歌单";
  const totalTracks = computed(() => props.kind === "playlist" ? playlist()?.tracks || []
    : props.kind === "history" ? s.history()
    : account.signedIn() ? [...account.cloudLibrary().liked.filter(isTrack), ...s.likedTracks().filter(track => track.source === "audio")] : s.likedTracks());
  const allEntries = computed(() => props.kind === "playlist" ? s.playlistEntries(nav.selectedPlaylist(), "", sort(), descending())
    : s.sortTracks(totalTracks(), sort(), descending()).map((track, index) => ({ track, index })));
  const entries = computed(() => {
    const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
    const terms = normalized(filter()).trim().split(/\s+/);
    return allEntries().filter(({ track }) => {
      const text = normalized(`${track.title} ${track.artist} ${track.album}`);
      return terms.every(term => text.includes(term));
    });
  });
  const key = (entry: { track: Track; index: number }) => props.kind === "playlist" ? String(entry.index) : entry.track.id;
  const selection = createSelection(() => entries().map(key));
  const tracks = computed(() => entries().map(entry => entry.track));
  const selectedEntries = computed(() => allEntries().filter(entry => selection.keys().includes(key(entry))));
  const selectedRows = computed(() => selectedEntries().map(entry => entry.track));
  const selectedVisible = () => entries().filter(entry => selection.keys().includes(key(entry))).length;
  const beginSelection = () => { editing.set(false); selection.begin(); };
  const extendSelection = (entry: { track: Track; index: number }) => { editing.set(false); selection.extend(key(entry)); };
  const removeLabel = () => props.kind === "playlist" ? "从歌单移除" : props.kind === "history" ? "从播放历史移除" : "取消喜欢";
  const removeSelected = () => {
    if (props.kind === "playlist") s.removePlaylistEntries(nav.selectedPlaylist(), selectedEntries().map(entry => entry.index));
    else if (props.kind === "history") s.removeHistory(selectedRows().map(track => track.id));
    else for (const track of selectedRows()) if (s.isLiked(track.id)) s.toggleLike(track);
    selection.clear();
    say(props.kind === "liked" ? "已取消喜欢所选歌曲" : "已移除所选歌曲");
  };
  const sortingNames = () => props.kind === "playlist" ? playlistSortNames : {
    ...playlistSortNames, custom: props.kind === "history" ? "最近播放" : "最近喜欢",
  };
  const options = (): CommandItem[] => [
    { testID: "collection-select-menu", label: selection.active() ? "完成选择" : "选择歌曲", icon: "checkCircle", run: () => selection.active() ? selection.finish() : beginSelection() },
    { label: "加入播放队列", icon: "queue", disabled: p.remoteControlled() || !tracks().length, run: () => { p.addTracksToQueue(tracks()); say(`已将 ${tracks().length} 首歌曲加入队列`); } },
    { label: "加入本机歌单", icon: "plus", disabled: !tracks().length, run: () => nav.addToPlaylist(tracks()) },
    ...(account.signedIn() ? [{ label: "加入 YouTube Music 歌单", icon: "plus", disabled: !tracks().length, run: () => cloud.addToCloudPlaylist(tracks()) }] : []),
    ...(props.kind === "playlist" ? [
      { label: "重命名", icon: "edit", separator: true, run: () => { nav.draft.set(title()); nav.dialog.set("rename"); } },
      { testID: "playlist-edit", label: editing() ? "完成编辑" : "调整歌曲顺序", icon: "sort", run: () => { selection.finish(); editing.update(value => !value); sort.set("custom"); filter.set(""); } },
      { label: "导出歌单", icon: "share", run: () => void action(() => s.exportPlaylist(nav.selectedPlaylist()), "歌单已导出") },
      { label: "删除歌单", icon: "trash", danger: true, run: () => { s.deletePlaylist(nav.selectedPlaylist()); nav.navigate("library", true); } },
    ] : props.kind === "history" ? [{ label: "清空播放历史", icon: "trash", danger: true, separator: true, run: () => { s.clearHistory(); selection.clear(); } }] : []),
  ];
  return <View testID={`page-${props.kind}`} style={{ gap: 24 }}>
    <View style={{ flexDirection: narrow() ? "column" : "row", gap: 28, alignItems: narrow() ? "center" : "flex-end" }}>
      <If when={props.kind === "playlist" && playlist()} else={<View style={{ width: narrow() ? 180 : 208, height: narrow() ? 180 : 208, alignItems: "center", justifyContent: "center", backgroundColor: c().selected, borderRadius: 20 }}><Icon name={props.kind === "liked" ? "heart" : "clock"} size={68} color={c().accent} filled={props.kind === "liked"} /></View>}>{() => <PlaylistCover playlist={playlist()!} size={narrow() ? 180 : 208} />}</If>
      <View style={{ flex: narrow() ? undefined : 1, gap: 14, alignItems: narrow() ? "center" : "flex-start", width: narrow() ? "100%" : undefined }}>
        <Label size={narrow() ? 28 : 36} weight="600" style={{ textAlign: narrow() ? "center" : "left" }}>{title()}</Label>
        <Label testID="collection-summary" color={c().sub} size={14}>{totalTracks().length} 首歌曲 · {Math.floor(totalTracks().reduce((total, track) => total + track.duration, 0) / 60)} 分钟</Label>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: narrow() ? "center" : "flex-start" }}>
          <Pill label="播放" icon="play" primary disabled={p.remoteControlled() || !tracks().length} onPress={() => action(() => p.playList(tracks(), 0, title()))} />
          <Pill label="随机" icon="shuffle" disabled={p.remoteControlled() || !tracks().length} onPress={() => action(() => p.playList(shuffled(tracks()), 0, title()))} />
          <Tool icon="download" label="下载全部" disabled={!tracks().length} onPress={() => downloadTracks(tracks())} />
          <CommandMenu label="歌单操作" items={options()} />
        </View>
      </View>
    </View>
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Field testID="song-collection-filter" value={filter()} onChange={filter.set} placeholder="查找歌曲、歌手、专辑" />
        <Tool testID="collection-select" icon="checkCircle" label={selection.active() ? "完成选择" : "选择歌曲"} active={selection.active()} onPress={() => selection.active() ? selection.finish() : beginSelection()} />
        <CommandMenu testID="collection-sort" label="歌曲排序" icon="sort" items={[
          ...Object.entries(sortingNames()).map(([value, label]) => ({ label, active: sort() === value, run: () => { sort.set(value as PlaylistSort); descending.set(value === "recent"); editing.set(false); } })),
          { testID: "collection-sort-direction", label: descending() ? "切换为升序" : "切换为降序", icon: descending() ? "up" : "down", disabled: sort() === "custom", separator: true, run: () => descending.update(value => !value) },
        ]} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Label size={12} color={c().sub}>{filter().trim() ? `找到 ${tracks().length} 首 · ` : ""}{sortingNames()[sort()]}{sort() === "custom" ? "" : descending() ? " ↓" : " ↑"}</Label>
        <If when={filter()}><Press testID="collection-clear-filter" label="清除筛选" onPress={() => filter.set("")} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 8 }}><Label size={12} color={c().accent}>清除筛选</Label></Press></If>
      </View>
    </View>
    <If when={selection.active()}><SelectionActions tracks={selectedRows()} title={title()} visibleCount={entries().length} selectedVisibleCount={selectedVisible()} onAll={selection.all} onClear={selection.clear} onDone={selection.finish} removeLabel={removeLabel()} onRemove={removeSelected} /></If>
    <If when={tracks().length > 0} else={<Empty icon="music" title={filter().trim() ? "没有匹配的歌曲" : "这里还没有歌曲"} description={filter().trim() ? "换个关键词，或清除筛选查看全部歌曲。" : props.kind === "history" ? "播放过的音乐会出现在这里。" : "在歌曲菜单中添加喜欢的音乐。"}><Pill label={filter().trim() ? "清除筛选" : "搜索音乐"} onPress={() => filter().trim() ? filter.set("") : nav.navigate("search")} /></Empty>}>
      <List each={entries()} viewport="parent" estimatedItemSize={editing() ? 128 : 76} keyExtractor={entry => `${entry.track.id}-${key(entry)}`}>
        {(entry, index) => <View testID={`collection-row-${key(entry())}`}><TrackRow track={entry().track} list={tracks()} index={index()} selected={selection.keys().includes(key(entry()))} selecting={selection.active()} onSelect={() => selection.toggle(key(entry()))} onLongPress={() => extendSelection(entry())} onPlay={() => action(() => p.playList(tracks(), index(), title()))} actionsBelow={editing()} trailing={<If when={editing() && props.kind === "playlist"}>
          <Tool testID={`playlist-up-${entry().index}`} icon="up" label="上移" disabled={entry().index === 0} onPress={() => s.movePlaylistTrack(nav.selectedPlaylist(), entry().index, entry().index - 1)} />
          <Tool testID={`playlist-down-${entry().index}`} icon="down" label="下移" disabled={entry().index >= totalTracks().length - 1} onPress={() => s.movePlaylistTrack(nav.selectedPlaylist(), entry().index, entry().index + 1)} />
          <Tool testID={`playlist-remove-${entry().index}`} icon="close" label="从歌单移除" onPress={() => s.removeFromPlaylist(nav.selectedPlaylist(), entry().track.id, entry().index)} />
        </If>} /></View>}
      </List>
    </If>
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
