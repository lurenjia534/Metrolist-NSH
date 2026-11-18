import { Clipboard, View, computed, signal } from "nsh";
import type { Track } from "../model";
import * as p from "../playback";
import * as s from "../store";
import { Art, Chip, Label, Pill, bytes, time, palette as c, action } from "../ui";
import { shareTrack } from "./Music";

type Detail = { name: string; value: string };
export function SongDetails(props: { track: Track }) {
  const tab = signal<"song" | "listens" | "audio">("song");
  const current = () => p.currentTrack()?.id === props.track.id;
  const download = computed(() => s.downloadJobs().find(job => job.id === props.track.id && job.status === "completed"));
  const song = computed<Detail[]>(() => [
    { name: "歌名", value: props.track.title }, { name: "歌手", value: props.track.artist },
    { name: "专辑", value: props.track.album || "—" }, { name: "时长", value: time((current() && p.duration()) || props.track.duration) },
    { name: "来源", value: props.track.source === "youtube" ? "YouTube Music" : "音频文件" },
    { name: "歌曲 ID", value: props.track.id },
    { name: "本机音乐库", value: s.libraryIds().includes(props.track.id) ? "已加入" : "未加入" },
    { name: "离线副本", value: download() ? "已下载" : "未下载" },
  ]);
  const listens = computed<Detail[]>(() => {
    const events = s.listenEvents().filter(event => event.trackId === props.track.id);
    const result = [
      { name: "记录次数", value: String(events.length) },
      { name: "累计收听", value: time(events.reduce((total, event) => total + event.seconds, 0)) },
    ];
    if (events.length) {
      const first = events.reduce((min, event) => Math.min(min, event.startedAt), Infinity);
      const last = events.reduce((max, event) => Math.max(max, event.startedAt), -Infinity);
      result.push({ name: "首次记录", value: new Date(first).toLocaleString() }, { name: "最近记录", value: new Date(last).toLocaleString() });
    }
    return result;
  });
  const audio = computed<Detail[]>(() => {
    const stream = current() ? p.streamInfo() : null;
    const rows: Detail[] = [];
    if (stream?.client) rows.push({ name: "播放客户端", value: stream.client });
    if (stream?.formatId != null) rows.push({ name: "格式编号", value: String(stream.formatId) });
    if (stream?.mimeType) rows.push({ name: "媒体类型", value: stream.mimeType });
    if (stream?.codecs) rows.push({ name: "编码", value: stream.codecs });
    if (stream?.bitrate) rows.push({ name: "比特率", value: `${Math.round(stream.bitrate / 1000)} kbps` });
    if (stream?.sampleRate) rows.push({ name: "采样率", value: `${stream.sampleRate} Hz` });
    if (stream?.loudnessDb != null) rows.push({ name: "响度", value: `${stream.loudnessDb} dB` });
    if (stream?.contentLength) rows.push({ name: "音源大小", value: bytes(stream.contentLength) });
    if (download()) rows.push({ name: "离线文件大小", value: bytes(download()!.bytes) });
    return rows;
  });
  const visible = () => tab() === "song" ? song() : tab() === "audio" ? audio() : listens();
  const copy = () => action(() => Clipboard.writeText([...song(), ...listens(), ...audio()].map(row => `${row.name}：${row.value}`).join("\n")), "歌曲信息已复制");
  return <>
    <View class="flex-row items-center gap-3"><Art track={props.track} size={64} /><View class="min-w-0 flex-1"><Label weight="600">{props.track.title}</Label><Label size={13} color={c().sub}>{props.track.artist}</Label></View></View>
    <View class="flex-row flex-wrap gap-2">
      <Each of={[["song", "曲目"], ["listens", "收听记录"], ["audio", "音源"]] as const}>{entry =>
        <Chip testID={`details-${entry()[0]}`} label={entry()[1]} selected={tab() === entry()[0]} onPress={() => tab.set(entry()[0])} />}
      </Each>
    </View>
    <Each of={visible()}>{row => <View class="flex-row gap-3"><Label size={12} color={c().sub}>{row().name}</Label><Label style={{ flex: 1 }}>{row().value}</Label></View>}</Each>
    <If when={tab() === "audio" && !audio().length}><Label size={13} color={c().sub}>播放这首歌后可查看音源参数。</Label></If>
    <View class="flex-row flex-wrap gap-2">
      <Pill testID="details-copy" label="复制歌曲信息" icon="info" onPress={copy} />
      <Pill label="复制链接" icon="share" onPress={() => shareTrack(props.track)} />
      <If when={current() && props.track.source === "youtube"}><Pill testID="details-timestamp" label={`复制 ${time(p.position())} 的播放链接`} icon="clock" onPress={() => shareTrack(props.track, p.position())} /></If>
    </View>
  </>;
}
