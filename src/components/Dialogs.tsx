import { View, signal, computed } from "nsh";
import * as s from "../store";
import * as nav from "../navigation";
import { SongDetails } from "./SongDetails";
import { PlaylistCover } from "./Music";
import { SleepTimerOptions } from "./SleepTimer";
import { Modal, Label, Field, Pill, Toggle, Press, palette as c, action, say } from "../ui";

function PlaylistDestinations(props: { close: () => void }) {
  const query = signal("");
  const multiple = signal(false);
  const skipDuplicates = signal(false);
  const targets = signal<string[]>([]);
  const songs = computed(() => new Set(nav.selectedTracks().map(track => track.id)));
  const choices = computed(() => s.playlists()
    .filter(playlist => playlist.name.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase()))
    .map(playlist => ({
      playlist,
      present: new Set(playlist.tracks.filter(track => songs().has(track.id)).map(track => track.id)).size,
    })));
  const save = (ids: string[]) => {
    const added = s.addTracksToPlaylists(ids, nav.selectedTracks(), skipDuplicates());
    props.close();
    say(added ? `已添加 ${added} 个歌单条目` : "所选歌曲已在歌单中");
  };
  const choose = (id: string) => {
    if (!multiple()) { save([id]); return; }
    targets.update(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  };
  return <>
    <Label size={13} color={c().sub}>{nav.selectedTracks().length} 首歌曲</Label>
    <If when={s.playlists().length > 0}>
      <Field testID="playlist-destination-search" placeholder="查找目标歌单" value={query()} onChange={query.set} />
      <Toggle testID="playlist-multiple" label="同时加入多张歌单" value={multiple()} onChange={value => { multiple.set(value); targets.set([]); }} />
      <Toggle testID="playlist-skip-duplicates" label="跳过重复歌曲" value={skipDuplicates()} onChange={skipDuplicates.set} />
    </If>
    <Each of={choices()}>{choice => <Press label={choice().playlist.name} selected={targets().includes(choice().playlist.id)}
      onPress={() => choose(choice().playlist.id)} style={{ flexDirection: "row", gap: 14, alignItems: "center", minHeight: 68 }}>
      <PlaylistCover playlist={choice().playlist} size={48} />
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Label>{choice().playlist.name}</Label><Label size={12} color={c().sub}>{choice().playlist.tracks.length} 首{choice().present ? ` · 已有 ${choice().present}/${songs().size} 首所选歌曲` : ""}</Label>
      </View>
      <If when={multiple()}><Label color={c().accent}>{targets().includes(choice().playlist.id) ? "已选" : "选择"}</Label></If>
    </Press>}</Each>
    <If when={query().trim() && !choices().length}><Label size={13} color={c().sub}>没有匹配的歌单</Label></If>
    <If when={multiple()}><Pill testID="playlist-save-targets" label={`加入选中的 ${targets().length} 张歌单`} primary disabled={!targets().length} onPress={() => save(targets())} /></If>
    <Field value={nav.draft()} onChange={nav.draft.set} placeholder="新歌单名称" />
    <Pill label={multiple() ? "新建并选择" : "新建并加入"} icon="plus" disabled={!nav.draft().trim()} onPress={() => {
      const playlist = s.createPlaylist(nav.draft());
      nav.draft.set(""); query.set(""); choose(playlist.id);
    }} />
  </>;
}

export function Dialogs() {
  const busy = signal(false);
  const close = () => nav.dialog.set(null);
  const savePlaylist = () => {
    if (nav.dialog() === "rename") { s.renamePlaylist(nav.selectedPlaylist(), nav.draft()); close(); }
    else { const playlist = s.createPlaylist(nav.draft()); close(); nav.openPlaylist(playlist.id); }
    say("歌单已保存");
  };
  const importLink = async () => {
    busy.set(true);
    try { const result = await s.importUrl(nav.draft()); close(); if ("tracks" in result) { nav.openPlaylist(result.id); say(`已导入 ${result.tracks.length} 首歌曲`); } else { nav.libraryTab.set("songs"); nav.navigate("library", true); say("已加入音乐库"); } } finally { busy.set(false); }
  };
  return <>
    <Modal open={nav.dialog() === "create" || nav.dialog() === "rename"} title={nav.dialog() === "rename" ? "重命名歌单" : "新建歌单"} close={close}><Field testID="playlist-name" autoFocus value={nav.draft()} onChange={nav.draft.set} placeholder="歌单名称" onSubmit={savePlaylist} /><Pill label="保存" primary icon="check" disabled={!nav.draft().trim()} onPress={savePlaylist} testID="save-playlist" /></Modal>
    <Modal open={nav.dialog() === "add-playlist"} title="加入歌单" close={close}>
      <If when={nav.dialog() === "add-playlist"}><PlaylistDestinations close={close} /></If>
    </Modal>
    <Modal open={nav.dialog() === "import"} title="导入音乐" close={close}><Label size={14} color={c().sub} style={{ lineHeight: 22 }}>粘贴 YouTube Music 歌曲、歌单链接或音频地址。</Label><Field testID="import-url" value={nav.draft()} onChange={nav.draft.set} placeholder="粘贴链接" onSubmit={() => void action(importLink)} /><Pill label={busy() ? "正在导入…" : "导入链接"} icon="link" primary disabled={busy() || !nav.draft().trim()} onPress={() => void action(importLink)} /><View style={{ height: 1, backgroundColor: c().line, marginVertical: 6 }} /><Pill label="选择本地音频" icon="upload" disabled={busy()} onPress={() => void action(async () => { const tracks = await s.importFiles(); close(); nav.libraryTab.set("songs"); nav.navigate("library", true); say(`已导入 ${tracks.length} 首音频`); })} /><Pill label="导入歌单／音乐库备份" icon="library" disabled={busy()} onPress={() => void action(async () => { await s.importLibrary(); close(); nav.navigate("library", true); say("音乐库已导入"); })} /></Modal>
    <Modal open={nav.dialog() === "sleep"} title="睡眠定时器" close={close}><SleepTimerOptions close={close} /></Modal>
    <Modal open={nav.dialog() === "song-info"} title="歌曲信息" close={close}>
      <If when={nav.dialog() === "song-info" ? nav.selectedTracks()[0] : null}>{track => <SongDetails track={track()} />}</If>
    </Modal>
  </>;
}
