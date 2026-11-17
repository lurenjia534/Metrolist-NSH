import { View, signal } from "nsh";
import { Input } from "nsh/base";
import type { Track } from "../model";
import * as p from "../playback";
import { saveLyricsEdit } from "../store";
import { Label, Modal, Pill, action, palette as c } from "../ui";

export function LyricsEditor(props: { track: Track; raw: string; close: () => void }) {
  const draft = signal(props.raw);
  const saving = signal(false);
  let caret = 0;

  function stampLine() {
    const text = draft();
    const start = text.slice(0, caret).lastIndexOf("\n") + 1;
    const hundredths = Math.floor(p.position() * 100);
    const minutes = String(Math.floor(hundredths / 6000)).padStart(2, "0");
    const seconds = String(Math.floor(hundredths / 100) % 60).padStart(2, "0");
    const fraction = String(hundredths % 100).padStart(2, "0");
    const stamp = `[${minutes}:${seconds}.${fraction}]`;
    const rest = text.slice(start).replace(/^\[\d+:\d{2}(?:\.\d+)?\]/, "");
    draft.set(text.slice(0, start) + stamp + rest);
    caret = start + stamp.length;
  }

  async function save() {
    saving.set(true);
    try {
      await saveLyricsEdit(props.track, draft());
      props.close();
    } finally {
      saving.set(false);
    }
  }

  return <Modal title="编辑歌词" close={props.close}>
    <Label weight="600" lines={2}>{props.track.title} · {props.track.artist}</Label>
    <Input testID="lyrics-editor-text" accessibilityLabel="歌词文本" multiline value={draft()}
      onChange={({ value }) => draft.set(value)} onSelectionChange={({ start }) => { caret = start; }}
      autoCapitalize="none" autoCorrect={false} placeholder="输入歌词，或粘贴带时间戳的 LRC"
      style={{ height: 176, padding: 12, borderRadius: 12, backgroundColor: c().card, color: c().text, placeholderColor: c().faint }} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Pill testID="lyrics-stamp" label="为当前行打时间戳" icon="clock" disabled={props.track.id !== p.currentTrack()?.id} onPress={stampLine} />
      <Pill testID="lyrics-save" label="保存到本机" primary disabled={saving() || !draft().trim()} onPress={() => void action(save)} />
    </View>
  </Modal>;
}
