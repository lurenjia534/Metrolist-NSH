import { Clipboard, View, signal } from "nsh";
import type { LyricMatch, Track } from "../model";
import { searchLyrics } from "../api";
import * as s from "../store";
import { Label, Modal, Pill, Field, Press, action, time, palette as c } from "../ui";

export function LyricSearch(props: { track: Track; close: () => void }) {
  const title = signal(props.track.title), artist = signal(props.track.artist);
  const matches = signal<LyricMatch[] | null>(null), preview = signal<LyricMatch | null>(null);
  const loading = signal(false);
  const search = () => action(async () => {
    loading.set(true); preview.set(null); matches.set(null);
    try { matches.set(await searchLyrics(title().trim(), artist().trim(), props.track.duration)); }
    finally { loading.set(false); }
  });
  return <Modal title="查找歌词版本" close={props.close}>
    <Field testID="lyric-query-title" placeholder="歌名" value={title()} onChange={title.set} />
    <Field testID="lyric-query-artist" placeholder="歌手" value={artist()} onChange={artist.set} />
    <Pill testID="lyric-query-search" label={loading() ? "正在查找…" : "搜索版本"} disabled={loading() || !title().trim()} onPress={search} />
    <If when={matches()?.length === 0}><Label>没有找到匹配的版本</Label></If>
    <Each of={matches() || []}>{row => <Press testID={`lyric-match-${row().id}`} selected={preview()?.id === row().id}
      label={`${row().title} · ${row().artist}`} onPress={() => preview.set(row())} style={{ padding: 10, gap: 4 }}>
      <Label>{row().title} · {row().artist}</Label><Label size={12} color={c().sub}>{[row().album, time(row().duration), row().instrumental ? "纯音乐" : row().syncedLyrics ? "同步歌词" : "文本歌词"].filter(Boolean).join(" · ")}</Label>
    </Press>}</Each>
    <If when={preview()}>{row => <View style={{ gap: 8 }}>
      <Label lines={6}>{row().plainLyrics || row().syncedLyrics || "此版本没有歌词文本"}</Label>
      <Pill testID="lyric-use-match" label="使用此版本" primary disabled={!(row().syncedLyrics || row().plainLyrics)} onPress={() => void action(async () => {
        await s.saveLyricsEdit(props.track, row().syncedLyrics || row().plainLyrics); props.close();
      }, "歌词版本已保存到本机")} />
    </View>}</If>
  </Modal>;
}

export function SongLyricOffset(props: { track: Track; close: () => void }) {
  const value = signal(String(s.settings().songLyricOffsets[props.track.id] || 0));
  const save = () => {
    const offsets = { ...s.settings().songLyricOffsets };
    if (Number(value())) offsets[props.track.id] = Number(value());
    else delete offsets[props.track.id];
    s.updateSettings({ songLyricOffsets: offsets }); props.close();
  };
  return <Modal title="单曲歌词校时" close={props.close}>
    <Label>{props.track.title}</Label><Label size={13} color={c().sub}>正数延后，负数提前。此数值与全局偏移相加。</Label>
    <Field testID="song-offset-value" placeholder="毫秒" value={value()} onChange={value.set} />
    <View class="flex-row flex-wrap gap-2">
      <Pill label="提前 100 毫秒" onPress={() => value.set(String((parseInt(value(), 10) || 0) - 100))} />
      <Pill label="延后 100 毫秒" onPress={() => value.set(String((parseInt(value(), 10) || 0) + 100))} />
      <Pill label="归零" onPress={() => value.set("0")} />
      <Pill testID="song-offset-save" label="保存" primary disabled={!/^[+-]?\d+$/.test(value()) || !Number.isSafeInteger(Number(value()))} onPress={save} />
    </View>
  </Modal>;
}

export function LyricExcerpt(props: { track: Track; lines: string[]; close: () => void }) {
  const picked = signal<number[]>([]);
  const copy = () => action(async () => {
    const lines = props.lines.filter((_, index) => picked().includes(index));
    const link = props.track.source === "youtube" ? `https://music.youtube.com/watch?v=${props.track.id}` : "";
    await Clipboard.writeText([...lines, "", `${props.track.title} · ${props.track.artist}`, ...(link ? [link] : [])].join("\n"));
    props.close();
  }, "歌词摘录已复制");
  return <Modal title="摘录歌词" close={props.close}>
    <Pill testID="lyric-copy-excerpt" label={`复制选中的 ${picked().length} 行`} disabled={!picked().length} onPress={copy} />
    <Each of={props.lines}>{(line, index) => <Press testID={`excerpt-line-${index()}`} selected={picked().includes(index())} label={line()}
      onPress={() => picked.update(ids => ids.includes(index()) ? ids.filter(id => id !== index()) : [...ids, index()])} style={{ padding: 10 }}>
      <Label>{line()}</Label>
    </Press>}</Each>
  </Modal>;
}
