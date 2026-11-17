import { View, signal } from "nsh";
import * as p from "../playback";
import * as nav from "../navigation";
import * as s from "../store";
import { Icon } from "../icons";
import { Label, Pill, Press, Tool, Field, Toggle, palette as c, say } from "../ui";

const remaining = () => `${Math.floor(p.sleepRemaining() / 60)}:${String(p.sleepRemaining() % 60).padStart(2, "0")}`;

export function SleepTimerButton() {
  return <If when={p.sleepActive()} else={<Tool testID="player-sleep" icon="clock" label="睡眠定时器" onPress={() => nav.dialog.set("sleep")} />}>
    <Press testID="player-sleep" label="睡眠定时器" onPress={() => nav.dialog.set("sleep")} style={{ minHeight: 36, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, backgroundColor: c().secondary }}>
      <Icon name="moon" size={16} color="foreground" />
      <Label testID="sleep-countdown" size={12} weight="600">{p.sleepAfterTrack() ? "本首结束" : remaining()}</Label>
    </Press>
  </If>;
}

export function SleepTimerOptions(props: { close: () => void }) {
  const custom = signal(String(s.settings().sleepMinutes));
  const valid = () => /^\d+$/.test(custom()) && Number(custom()) >= 1 && Number(custom()) <= 1439;
  const set = (minutes: number) => {
    s.updateSettings({ sleepMinutes: minutes });
    p.setSleepTimer(minutes, s.settings().sleepFinishSong);
    props.close();
    say(s.settings().sleepFinishSong ? `${minutes} 分钟后播完当时的歌曲再停止` : `${minutes} 分钟后暂停播放`);
  };
  return <View style={{ gap: 18 }}>
    <If when={p.sleepActive()} else={<Label color={c().sub} size={14}>选择播放时长，或听完当前这首再休息。</Label>}>
      <View testID="sleep-status" style={{ padding: 16, gap: 6, borderRadius: 12, borderWidth: 1, borderColor: c().line, backgroundColor: c().card }}>
        <Label size={24} weight="800">{p.sleepAfterTrack() ? "播完这首停止" : remaining()}</Label>
        <Label color={c().sub} size={13} lines={2}>{p.sleepAfterTrack() ? p.currentTrack()?.title : `倒计时结束于 ${new Date(p.sleepUntil()!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</Label>
      </View>
    </If>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Each of={[5, 15, 30, 45, 60, 90]}>{minutes => <Pill testID={`sleep-${minutes()}`} label={`${minutes()} 分钟`} icon="moon" onPress={() => set(minutes())} />}</Each>
    </View>
    <Toggle testID="sleep-finish-song" label="倒计时结束后听完本首" value={s.settings().sleepFinishSong} onChange={sleepFinishSong => s.updateSettings({ sleepFinishSong })} />
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <Field testID="sleep-custom-minutes" placeholder="1–1439 分钟" value={custom()} onChange={custom.set} onSubmit={() => { if (valid()) set(Number(custom())); }} />
      <Pill testID="sleep-custom-start" label="开始计时" disabled={!valid()} onPress={() => set(Number(custom()))} />
    </View>
    <Pill testID="sleep-end-of-track" label="播完这首停止" icon="music" active={p.sleepAfterTrack()} disabled={!p.currentTrack()} onPress={() => { p.setSleepAfterTrack(); props.close(); say("当前歌曲结束后暂停"); }} />
    <If when={p.sleepActive()}><Pill testID="sleep-cancel" label="取消定时" icon="close" onPress={() => { p.cancelSleepTimer(); props.close(); say("定时器已取消"); }} /></If>
  </View>;
}
