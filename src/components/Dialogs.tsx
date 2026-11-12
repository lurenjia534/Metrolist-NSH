import { View, signal } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import { PlaylistCover, shareTrack } from "./Music";
import { SleepTimerOptions } from "./SleepTimer";
import { Modal, Label, Field, Pill, Tool, Art, Press, palette as c, action, say, time } from "../ui";

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
    <Modal open={nav.dialog() === "add-playlist"} title="加入歌单" close={close}><Label size={13} color={c().sub}>{nav.selectedTracks().length} 首歌曲</Label><Each of={s.playlists()}>{playlist => <Press label={playlist().name} onPress={() => { s.addTracksToPlaylist(playlist().id, nav.selectedTracks()); close(); say("已加入歌单"); }} style={{ flexDirection: "row", gap: 14, alignItems: "center", minHeight: 68 }}><PlaylistCover playlist={playlist()} size={48} /><View style={{ flex: 1, minWidth: 0, gap: 5 }}><Label>{playlist().name}</Label><Label size={12} color={c().sub}>{playlist().tracks.length} 首</Label></View></Press>}</Each><Field value={nav.draft()} onChange={nav.draft.set} placeholder="新歌单名称" /><Pill label="新建并加入" icon="plus" primary disabled={!nav.draft().trim()} onPress={() => { const playlist = s.createPlaylist(nav.draft()); s.addTracksToPlaylist(playlist.id, nav.selectedTracks()); close(); say("已创建并加入歌单"); }} /></Modal>
    <Modal open={nav.dialog() === "import"} title="导入音乐" close={close}><Label size={14} color={c().sub} style={{ lineHeight: 22 }}>粘贴 YouTube Music 歌曲、歌单链接或音频地址。</Label><Field testID="import-url" value={nav.draft()} onChange={nav.draft.set} placeholder="粘贴链接" onSubmit={() => void action(importLink)} /><Pill label={busy() ? "正在导入…" : "导入链接"} icon="link" primary disabled={busy() || !nav.draft().trim()} onPress={() => void action(importLink)} /><View style={{ height: 1, backgroundColor: c().line, marginVertical: 6 }} /><Pill label="选择本地音频" icon="upload" disabled={busy()} onPress={() => void action(async () => { const tracks = await s.importFiles(); close(); nav.libraryTab.set("songs"); nav.navigate("library", true); say(`已导入 ${tracks.length} 首音频`); })} /><Pill label="导入歌单／音乐库备份" icon="library" disabled={busy()} onPress={() => void action(async () => { await s.importLibrary(); close(); nav.navigate("library", true); say("音乐库已导入"); })} /></Modal>
    <Modal open={nav.dialog() === "sleep"} title="睡眠定时器" close={close}><SleepTimerOptions close={close} /></Modal>
    <Modal open={nav.dialog() === "song-info" && !!nav.selectedTracks()[0]} title="歌曲信息" close={close}><View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}><Art track={nav.selectedTracks()[0]} size={72} /><View style={{ flex: 1, minWidth: 0, gap: 8 }}><Label weight="600" lines={3}>{nav.selectedTracks()[0].title}</Label><Label color={c().sub} size={13}>{nav.selectedTracks()[0].artist}</Label></View></View><Each of={[{ name: "专辑", value: nav.selectedTracks()[0].album || "—" }, { name: "时长", value: time(nav.selectedTracks()[0].duration) }, { name: "来源", value: nav.selectedTracks()[0].source === "youtube" ? "YouTube Music" : "音频文件" }, { name: "歌曲 ID", value: nav.selectedTracks()[0].id }, ...(p.currentTrack()?.id === nav.selectedTracks()[0].id && p.streamInfo() ? [{ name: "格式", value: p.streamInfo()!.mimeType || "—" }, { name: "比特率", value: p.streamInfo()!.bitrate ? `${Math.round(p.streamInfo()!.bitrate! / 1000)} kbps` : "—" }, { name: "采样率", value: p.streamInfo()!.sampleRate ? `${p.streamInfo()!.sampleRate} Hz` : "—" }] : [])]}>{row => <View style={{ gap: 6, paddingVertical: 7 }}><Label size={12} color={c().faint}>{row().name}</Label><Label size={14}>{row().value}</Label></View>}</Each><Pill label="复制链接" icon="share" onPress={() => shareTrack(nav.selectedTracks()[0])} /></Modal>
  </>;
}
