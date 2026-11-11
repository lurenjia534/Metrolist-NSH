import { View, Scroll, signal } from "nsh";
import * as account from "../account";
import * as cloud from "../cloudActions";
import * as nav from "../navigation";
import * as s from "../store";
import * as p from "../playback";
import { isTrack, type Collection, type Track } from "../model";
import { TrackRow, MusicCard } from "./Music";
import { Label, Pill, Chip, Tool, Art, Press, Field, Empty, CommandMenu, Modal, palette as c, narrow, action, say } from "../ui";

const types: { id: account.CloudType; name: string; icon: string }[] = [
  { id: "playlists", name: "歌单", icon: "queue" }, { id: "liked", name: "喜欢", icon: "heart" },
  { id: "songs", name: "歌曲", icon: "music" }, { id: "albums", name: "专辑", icon: "album" }, { id: "artists", name: "订阅", icon: "artist" },
];

export function CloudLibrary() {
  const query = signal("");
  const items = () => account.cloudItems().filter(item => `${item.title} ${isTrack(item) ? item.artist : item.subtitle}`.toLowerCase().includes(query().toLowerCase()));
  const tracks = () => items().filter(isTrack);
  const grid = () => s.settings().libraryView === "grid";
  return <View testID="cloud-library" style={{ gap: 20 }}>
    <If when={account.signedIn()} else={<Empty icon="artist" title="让音乐库跟着你" description="登录 YouTube Music，读取你的歌单、喜欢、专辑和关注的歌手。"><Pill testID="cloud-sign-in" label="登录账号" primary icon="artist" onPress={() => nav.navigate("account")} /></Empty>}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 20, backgroundColor: c().card }}>
        <Art src={account.currentAccount()?.avatar} size={44} radius={24} icon="artist" />
        <Press label="管理账号" onPress={() => nav.navigate("account")} style={{ flex: 1, minWidth: 0, gap: 6 }}><Label weight="600">{account.currentAccount()?.name}</Label><Label size={12} color={c().sub}>{account.syncing() ? account.syncProgress() : account.lastSynced() ? `上次同步 ${new Date(account.lastSynced()).toLocaleString()}` : "YouTube Music 音乐库"}</Label></Press>
        <Tool testID="cloud-sync" icon="refresh" label="同步全部音乐库" disabled={account.syncing()} onPress={() => void action(account.syncLibrary, "云端音乐库已同步")} />
      </View>
      <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={types}>{type => <Chip testID={`cloud-type-${type().id}`} label={type().name} icon={type().icon} selected={account.cloudType() === type().id} onPress={() => void action(() => account.loadCloudLibrary(type().id))} />}</Each></Scroll>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Field testID="cloud-search" value={query()} onChange={query.set} placeholder="在云端音乐库中查找" /><Tool icon={grid() ? "list" : "grid"} label="切换显示方式" onPress={() => s.updateSettings({ libraryView: grid() ? "list" : "grid" })} /><If when={account.cloudType() === "playlists"}><Tool testID="cloud-create" icon="plus" label="新建云端歌单" onPress={() => cloud.createCloudPlaylist()} /></If></View>
      <If when={account.error()}><View style={{ gap: 12, padding: 16, borderRadius: 14, backgroundColor: c().selected }}><Label size={13} color={c().danger}>{account.error()}</Label><Pill label="重新加载" icon="refresh" onPress={() => void action(() => account.loadCloudLibrary())} /></View></If>
      <If when={account.cloudLoading()}><Label size={13} color={c().accent}>正在读取 YouTube Music…</Label></If>
      <If when={tracks().length > 0}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Pill label={`播放 · ${tracks().length}`} primary icon="play" disabled={p.remoteControlled()} onPress={() => void action(() => p.playList(tracks(), 0, types.find(type => type.id === account.cloudType())!.name))} /><Pill label="加入本机歌单" icon="plus" onPress={() => nav.addToPlaylist(tracks())} /></View><Each of={tracks()}>{(track, index) => <TrackRow track={track()} list={tracks()} index={index()} />}</Each></If>
      <View style={{ flexDirection: grid() ? "row" : "column", flexWrap: grid() ? "wrap" : "nowrap", gap: grid() ? 16 : 4 }}><Each of={items().filter(item => !isTrack(item)) as Collection[]}>{item => <View style={{ gap: 4 }}><If when={grid()} else={<Press label={item().title} onPress={() => nav.browse(item())} style={{ flexDirection: "row", minHeight: 76, alignItems: "center", gap: 14 }}><Art src={item().artwork} size={56} radius={item().type === "artist" ? 32 : 8} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label lines={1} weight="600">{item().title}</Label><Label size={12} color={c().sub}>{item().subtitle}</Label></View></Press>}><MusicCard item={item()} /></If><If when={item().type === "playlist" && item().editable}><CommandMenu label={`管理 ${item().title}`} icon="more" items={[{ label: "重命名云端歌单", icon: "edit", run: () => cloud.renameCloudPlaylist(item()) }, { label: "删除云端歌单", icon: "trash", danger: true, run: () => void action(() => account.deleteCloudPlaylist(cloud.playlistId(item())), "云端歌单已删除") }]} /></If></View>}</Each></View>
      <If when={!account.cloudLoading() && !items().length && !account.error()}><Empty icon={account.cloudType() === "artists" ? "artist" : "library"} title={query() ? "没有匹配的内容" : "这里还没有内容"} description={query() ? "试试歌曲、歌手或歌单的其他关键词。" : "在搜索中找到喜欢的音乐，将它保存到 YouTube Music。"}><If when={account.cloudType() === "playlists"}><Pill label="新建云端歌单" icon="plus" onPress={() => cloud.createCloudPlaylist()} /></If></Empty></If>
      <If when={account.cloudContinuation()}><Pill label={account.cloudLoading() ? "加载中…" : "加载更多"} disabled={account.cloudLoading()} onPress={() => void action(account.loadMoreCloudLibrary)} /></If>
    </If>
  </View>;
}

export function CloudCollectionActions(props: { item: Collection }) {
  const followed = () => props.item.type === "artist" ? account.isCloudSubscribed(props.item.id) : account.cloudLibrary()[props.item.type === "album" ? "albums" : "playlists"].some(item => item.id === props.item.id);
  const toggle = async () => {
    if (props.item.type === "artist") await account.setSubscription(props.item.browseId, !followed(), props.item.params);
    else {
      await account.setLike(cloud.playlistId(props.item), !followed(), "playlist");
      if (props.item.type === "album") await account.loadCloudLibrary("albums");
    }
  };
  return <If when={account.signedIn()}><Pill testID="cloud-save-collection" label={props.item.type === "artist" ? followed() ? "已订阅" : "订阅歌手" : followed() ? "已存到云端" : "存到云端"} icon={followed() ? "check" : "plus"} active={followed()} disabled={!!account.mutation()} onPress={() => void action(toggle, "云端音乐库已更新")} /><If when={props.item.type === "playlist" && props.item.editable}><Tool icon="edit" label="重命名云端歌单" onPress={() => cloud.renameCloudPlaylist(props.item)} /></If></If>;
}

export function CloudTrackControls(props: { item: Collection; track: Track; index: number; tracks: Track[] }) {
  const update = async (work: () => Promise<unknown>) => { await work(); await s.openCollection(props.item); };
  return <If when={account.signedIn() && props.item.editable && props.track.setVideoId}><CommandMenu label="云端歌曲操作" icon="edit" items={[
    { label: "上移", icon: "up", disabled: props.index === 0 || !!account.mutation(), run: () => void action(() => update(() => account.moveInCloudPlaylist(cloud.playlistId(props.item), props.track.setVideoId!, props.tracks[props.index - 1].setVideoId))) },
    { label: "下移", icon: "down", disabled: props.index === props.tracks.length - 1 || !!account.mutation(), run: () => void action(() => update(() => account.moveInCloudPlaylist(cloud.playlistId(props.item), props.track.setVideoId!, props.tracks[props.index + 2]?.setVideoId))) },
    { label: "从云端歌单移除", icon: "close", disabled: !!account.mutation(), run: () => void action(() => update(() => account.removeFromCloudPlaylist(cloud.playlistId(props.item), props.track.id, props.track.setVideoId!)), "已从云端歌单移除") },
  ]} /></If>;
}

export function CloudDialogs() {
  const close = () => cloud.cloudDialog.set(null);
  const saving = signal(false);
  const save = () => action(async () => {
    saving.set(true);
    try {
      if (cloud.cloudDialog() === "rename") {
        const item = cloud.cloudTarget()!;
        await account.renameCloudPlaylist(cloud.playlistId(item), cloud.cloudDraft());
        if (s.activeCollection()?.id === item.id) await s.openCollection({ ...item, title: cloud.cloudDraft() });
      } else {
        const result = await account.createCloudPlaylist(cloud.cloudDraft(), cloud.cloudPrivacy(), cloud.cloudDescription());
        if (cloud.cloudSelection().length) await account.addToCloudPlaylist(result.playlistId, cloud.cloudSelection().map(track => track.id));
      }
      close(); say("云端歌单已保存");
    } finally { saving.set(false); }
  });
  return <>
    <Modal open={cloud.cloudDialog() === "create" || cloud.cloudDialog() === "rename"} title={cloud.cloudDialog() === "rename" ? "重命名云端歌单" : "新建 YouTube Music 歌单"} close={close}><Field testID="cloud-playlist-name" autoFocus value={cloud.cloudDraft()} onChange={cloud.cloudDraft.set} placeholder="歌单名称" onSubmit={() => void save()} /><If when={cloud.cloudDialog() === "create"}><Field value={cloud.cloudDescription()} onChange={cloud.cloudDescription.set} placeholder="简介（可选）" /><View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Each of={[{ id: "PRIVATE", name: "私密" }, { id: "UNLISTED", name: "不公开列出" }, { id: "PUBLIC", name: "公开" }]}>{privacy => <Chip label={privacy().name} selected={cloud.cloudPrivacy() === privacy().id} onPress={() => cloud.cloudPrivacy.set(privacy().id)} />}</Each></View><If when={cloud.cloudSelection().length}><Label size={13} color={c().sub}>同时添加 {cloud.cloudSelection().length} 首歌曲</Label></If></If><Pill testID="cloud-save-playlist" primary icon="check" label={saving() ? "正在保存…" : "保存到 YouTube Music"} disabled={saving() || !cloud.cloudDraft().trim()} onPress={() => void save()} /></Modal>
    <Modal open={cloud.cloudDialog() === "add"} title="加入 YouTube Music 歌单" close={close}><Label size={13} color={c().sub}>{cloud.cloudSelection().length} 首歌曲 · {account.currentAccount()?.name}</Label><If when={account.cloudLoading()}><Label color={c().accent}>正在读取歌单…</Label></If><Each of={account.cloudLibrary().playlists.filter(item => !isTrack(item) && item.editable) as Collection[]}>{playlist => <Press label={playlist().title} disabled={!!account.mutation()} onPress={() => void action(async () => { await account.addToCloudPlaylist(cloud.playlistId(playlist()), cloud.cloudSelection().map(track => track.id)); close(); }, "已加入云端歌单")} style={{ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 14 }}><Art src={playlist().artwork} size={48} /><Label style={{ flex: 1 }} lines={2}>{playlist().title}</Label></Press>}</Each><If when={account.cloudContinuation()}><Pill label="加载更多歌单" disabled={account.cloudLoading()} onPress={() => void action(account.loadMoreCloudLibrary)} /></If><Pill label="新建歌单并加入" primary icon="plus" onPress={() => cloud.createCloudPlaylist(cloud.cloudSelection())} /></Modal>
  </>;
}
