import { Image, Text, View, Scroll, signal, effect, createAnimatedValue, windowSize, reduceMotion, colorScheme, platform, type JSX, type ViewStyle } from "nsh";
import { Button, Input, Slider, Switch, Tab, Menu, MenuItem, MenuSeparator, Dialog } from "nsh/base";
import { settings } from "./store";
import { Icon } from "./icons";
import { localArtwork } from "../assets/local-artwork";
import type { Track } from "./model";
import { motion, transition } from "./motion";

const mobile = platform.os === "android" || platform.os === "ios";
export const narrow = () => windowSize().width < 760 || mobile && windowSize().height < 600;
export const touch = () => mobile || narrow();
export const spacious = () => !narrow() && windowSize().width >= 1240;
export const pageGutter = () => narrow() ? 20 : 30;
export const palette = () => (settings().theme === "light" || settings().theme === "system" && colorScheme() === "light") ? {
  bg: "#faf8ff", panel: "#f2eff8", card: "#efecf5", raised: "#e6e2ee", line: "#d8d3e2",
  text: "#1c1b24", sub: "#625f71", faint: "#868193", accent: "#5c568c", onAccent: "#ffffff", selected: "#e3defb", hover: "#e9e5f1",
  danger: "#b32642", good: "#286c52", scrim: "#16121e80", shadow: "0 12px 40px #16121e30",
} : {
  bg: settings().theme === "black" ? "#000000" : "#0e0d12", panel: settings().theme === "black" ? "#09090c" : "#141319",
  card: "#1e1d25", raised: "#292733", line: "#393641", text: "#e9e6f2", sub: "#b8b3c5", faint: "#837d91",
  accent: "#c7c3f5", onAccent: "#302c54", selected: "#373349", hover: "#24212f", danger: "#ffb3c1", good: "#9ddab7", scrim: "#00000099", shadow: "0 12px 40px #00000050",
};
export { motion } from "./motion";
export const toast = signal("");
let toastTimer: ReturnType<typeof setTimeout>;
export function say(message: string) { toast.set(message); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.set(""), 3600); }
export async function action(work: () => unknown | Promise<unknown>, message?: string) {
  try { await work(); if (message) say(message); } catch (error) { say(error instanceof Error ? error.message : String(error)); }
}
export const time = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "直播";
export const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;

export function Label(props: { children?: JSX.Element; size?: number; color?: string; weight?: string; lines?: number; style?: any; testID?: string }) {
  return <Text testID={props.testID} style={{ minWidth: 0, numberOfLines: props.lines, color: props.color || palette().text, fontSize: props.size || (narrow() ? 16 : 14), fontWeight: (props.weight || "400") as any, ...props.style }}>{props.children}</Text>;
}
export function Press(props: { children?: JSX.Element; label?: string; onPress: () => void; style?: ViewStyle; selected?: boolean; disabled?: boolean; testID?: string; onLongPress?: () => void }) {
  return <Button testID={props.testID} accessibilityLabel={props.label} onPress={props.onPress} onLongPress={props.onLongPress} disabled={props.disabled}
    style={{ minWidth: 0, borderRadius: 12, backgroundColor: props.selected ? palette().selected : "transparent", ...props.style }}
    hoverStyle={{ backgroundColor: props.selected ? palette().selected : palette().hover }} activeStyle={{ opacity: 0.7 }} disabledStyle={{ opacity: 0.4 }}
    class="transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none">{props.children}</Button>;
}
export function Tool(props: { icon: string; label: string; onPress: () => void; active?: boolean; size?: number; large?: boolean; testID?: string; disabled?: boolean }) {
  return <Button testID={props.testID} accessibilityLabel={props.label} tooltip={narrow() ? undefined : props.label} onPress={props.onPress} disabled={props.disabled}
    style={{ width: props.large ? 56 : touch() ? 48 : 36, height: props.large ? 56 : touch() ? 48 : 36, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 50, backgroundColor: props.active ? palette().selected : "transparent", ...transition() }}
    hoverStyle={{ backgroundColor: palette().hover }} activeStyle={{ scale: reduceMotion() ? 1 : motion.iconPressScale, opacity: 0.8 }} disabledStyle={{ opacity: 0.35 }} class="focus-visible:ring-2 focus-visible:ring-primary">
    <Icon name={props.icon} color={props.active ? palette().accent : palette().sub} size={props.size || 22} filled={props.icon === "heart" && props.active} />
  </Button>;
}
export function Pill(props: { label: string; icon?: string; active?: boolean; onPress: () => void; primary?: boolean; testID?: string; disabled?: boolean; danger?: boolean }) {
  return <Button testID={props.testID} accessibilityLabel={props.label} onPress={props.onPress} disabled={props.disabled}
    style={{ minWidth: 0, maxWidth: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: narrow() ? 16 : 20, paddingVertical: 10, minHeight: touch() ? 48 : 40, flexShrink: 0, borderRadius: 28, backgroundColor: props.primary ? palette().accent : props.active ? palette().selected : "transparent", borderWidth: props.primary || props.active ? 0 : 1, borderColor: palette().line, ...transition() }}
    hoverStyle={{ opacity: 0.8 }} activeStyle={{ scale: reduceMotion() ? 1 : motion.pressScale }} disabledStyle={{ opacity: 0.4 }} class="focus-visible:ring-2 focus-visible:ring-primary">
    <If when={props.icon}><Icon name={props.icon!} size={20} color={props.primary ? palette().onAccent : props.danger ? palette().danger : palette().accent} /></If>
    <Label size={narrow() ? 14 : 13} weight="600" style={{ flexShrink: 1, textAlign: "center" }} color={props.primary ? palette().onAccent : props.danger ? palette().danger : palette().text}>{props.label}</Label>
  </Button>;
}
export function Chip(props: { label: string; selected: boolean; onPress: () => void; icon?: string; testID?: string }) {
  return <Tab testID={props.testID} selected={props.selected} onPress={props.onPress} accessibilityLabel={props.label}
    style={{ minHeight: touch() ? 48 : 36, flexShrink: 0, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 24, backgroundColor: props.selected ? palette().selected : palette().card }}
    hoverStyle={{ opacity: 0.85 }} activeStyle={{ opacity: 0.65 }} class="transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none">
    <If when={props.selected || props.icon}><Icon name={props.selected ? "check" : props.icon!} size={16} color={palette().accent} /></If><Label size={14} weight={props.selected ? "600" : "400"}>{props.label}</Label>
  </Tab>;
}
export function Toggle(props: { label: string; value: boolean; onChange: (value: boolean) => void; description?: string; testID?: string }) {
  return <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 20 }}>
    <View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label>{props.label}</Label><If when={props.description}><Label size={12} color={palette().sub} style={{ lineHeight: 19 }}>{props.description}</Label></If></View>
    <Switch testID={props.testID} accessibilityLabel={props.label} checked={props.value} onChange={({ checked }) => props.onChange(checked)} style={{ width: 52, minHeight: 48, flexShrink: 0, justifyContent: "center" }}
      trackStyle={{ width: 52, height: 30, borderRadius: 20, padding: 4, backgroundColor: props.value ? palette().accent : palette().raised, borderWidth: props.value ? 0 : 1, borderColor: palette().faint }}
      thumbStyle={{ width: 22, height: 22, borderRadius: 20, backgroundColor: props.value ? palette().onAccent : palette().sub, transform: [{ translateX: props.value ? 22 : 0 }] }} thumbClass="transition-transform duration-150 motion-reduce:transition-none" />
  </View>;
}
export function Art(props: { track?: Track; src?: any; size?: number; radius?: number; style?: ViewStyle; icon?: string }) {
  return <View style={{ width: props.size || 52, height: props.size || 52, borderRadius: props.radius ?? 8, overflow: "hidden", backgroundColor: palette().selected, flexShrink: 0, ...props.style }}>
    <If when={props.src || props.track?.artwork} else={<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Icon name={props.icon || "music"} size={(props.size || 52) * 0.4} color={palette().accent} /></View>}>
      <Image src={props.src || (props.track ? localArtwork[props.track.id] || props.track.artwork : "")} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
    </If>
  </View>;
}
export function Field(props: { value: string; onChange: (value: string) => void; placeholder: string; onSubmit?: () => void; testID?: string; autoFocus?: boolean; multiline?: boolean }) {
  return <Input testID={props.testID} accessibilityLabel={props.placeholder} value={props.value} onChange={({ value }) => props.onChange(value)} onSubmit={props.onSubmit} placeholder={props.placeholder} autoFocus={props.autoFocus} multiline={props.multiline} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
    style={{ minWidth: 0, minHeight: 48, color: palette().text, fontSize: narrow() ? 16 : 14, placeholderColor: palette().faint, caretColor: palette().accent, backgroundColor: palette().card, borderWidth: 1, borderColor: palette().line, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flex: 1 }} class="focus:border-primary" />;
}
function BufferedRail(props: { value: number; max: number; height: number; trackHeight: number }) {
  const buffered = createAnimatedValue(0);
  effect(() => buffered.set(Math.min(1, Math.max(0, props.value / props.max))));
  return <View accessibilityElementsHidden style={{ position: "absolute", left: 8, right: 8, top: (props.height - props.trackHeight) / 2, height: props.trackHeight, borderRadius: 8, overflow: "hidden", backgroundColor: palette().raised, pointerEvents: "none" }}>
    <View style={{ height: "100%", backgroundColor: palette().sub, opacity: 0.45, scale: [buffered, 1], transformOrigin: "left" }} />
  </View>;
}
export function Rail(props: { value: number; max?: number; bufferedValue?: number; onChange: (value: number) => void; onChangeEnd?: (value: number) => void; label: string; large?: boolean; testID?: string; disabled?: boolean }) {
  const hitSize = () => touch() ? 48 : props.large ? 40 : 28;
  return <View style={{ height: hitSize(), minWidth: 0, flex: 1 }}>
    <If when={props.bufferedValue !== undefined}><BufferedRail value={props.bufferedValue!} max={props.max || 100} height={hitSize()} trackHeight={props.large ? 6 : 4} /></If>
    <Slider disabled={props.disabled} testID={props.testID} value={props.value} min={0} max={props.max || 100} step={0} onChange={({ value }) => props.onChange(value as number)} onChangeEnd={({ value }) => props.onChangeEnd?.(value as number)} accessibilityLabel={props.label}
      style={{ height: hitSize(), minWidth: 0, justifyContent: "center", flex: 1 }} trackStyle={{ height: hitSize(), justifyContent: "center", paddingHorizontal: 8 }} indicatorStyle={{ height: props.large ? 6 : 4, backgroundColor: props.bufferedValue !== undefined ? "transparent" : palette().raised, borderRadius: 8 }} rangeStyle={{ backgroundColor: palette().accent, borderRadius: 8 }} thumbStyle={{ width: props.large ? 6 : 12, height: props.large ? 24 : 12, borderRadius: props.large ? 3 : 6, backgroundColor: palette().accent }} />
  </View>;
}
export function SectionTitle(props: { title: string; subtitle?: string; action?: string; onPress?: () => void; icon?: string; disabled?: boolean }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
    <View style={{ gap: 4, flexGrow: 1, flexBasis: 148, minWidth: 0 }}><If when={props.subtitle}><Label size={12} color={palette().sub}>{props.subtitle}</Label></If><Label size={24} weight="700">{props.title}</Label></View>
    <If when={props.action}><Pill disabled={props.disabled} label={props.action!} icon={props.icon} onPress={() => props.onPress?.()} /></If>
  </View>;
}
export function PageTitle(props: { title: string; subtitle?: string; children?: JSX.Element }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 }}><View style={{ flex: 1, minWidth: 0, gap: 8 }}><Label size={narrow() ? 28 : 32} weight="600">{props.title}</Label><If when={props.subtitle}><Label size={13} color={palette().sub}>{props.subtitle}</Label></If></View>{props.children}</View>;
}
export function Empty(props: { icon: string; title: string; description: string; children?: JSX.Element }) {
  return <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 24, gap: 16 }}>
    <Icon name={props.icon} size={48} color={palette().faint} /><Label size={20} weight="600" style={{ textAlign: "center" }}>{props.title}</Label><Label color={palette().sub} size={14} style={{ textAlign: "center", maxWidth: 340, lineHeight: 22 }}>{props.description}</Label>{props.children}
  </View>;
}
export function Section(props: { title?: string; children?: JSX.Element }) {
  return <View style={{ gap: 12 }}><If when={props.title}><Label size={14} color={palette().accent} weight="600">{props.title}</Label></If><View style={{ backgroundColor: palette().card, borderRadius: 20, padding: narrow() ? 16 : 24, gap: 12 }}>{props.children}</View></View>;
}
export interface CommandItem { label: string; icon?: string; run: () => void; active?: boolean; disabled?: boolean; danger?: boolean; separator?: boolean; testID?: string }
export function CommandMenu(props: { label: string; icon?: string; items: CommandItem[]; testID?: string }) {
  let selected: (() => void) | undefined;
  // Finish the native menu's exit before a command removes its row or page.
  const finish = () => { const run = selected; selected = undefined; if (run) setTimeout(run, 0); };
  return <Menu offset={6} onClose={finish} popupStyle={{ minWidth: 224, maxWidth: Math.min(340, windowSize().width - 24), borderRadius: 20, backgroundColor: palette().card, padding: 8, borderWidth: 1, borderColor: palette().line, boxShadow: palette().shadow, ...transition("opacity,transform") }} popupStartingStyle={{ opacity: 0, transform: [{ translateY: reduceMotion() ? 0 : -motion.shift }] }} popupEndingStyle={{ opacity: 0, transform: [{ translateY: reduceMotion() ? 0 : -motion.shift }] }} backdropStyle={{ backgroundColor: palette().scrim }}
    trigger={<View testID={props.testID} accessibilityLabel={props.label} style={{ width: touch() ? 48 : 36, height: touch() ? 48 : 36, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 24 }} hoverStyle={{ backgroundColor: palette().hover }}><Icon name={props.icon || "more"} size={22} color={palette().sub} /></View>}>
    <Each of={props.items}>{(item) => <><If when={item().separator}><MenuSeparator style={{ height: 1, backgroundColor: palette().line, marginVertical: 6 }} /></If><MenuItem testID={item().testID} onSelect={() => { selected = item().run; }} disabled={item().disabled} style={{ flexDirection: "row", gap: 14, alignItems: "center", minHeight: touch() ? 52 : 40, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: item().active ? palette().selected : "transparent" }} hoverStyle={{ backgroundColor: palette().hover }} activeStyle={{ opacity: 0.7 }} class="focus-visible:bg-accent"><Icon name={item().active ? "check" : item().icon || "music"} size={20} color={item().danger ? palette().danger : palette().sub} /><Label size={14} style={{ flex: 1 }} color={item().danger ? palette().danger : palette().text}>{item().label}</Label></MenuItem></>}</Each>
  </Menu>;
}
export function Modal(props: { title: string; close: () => void; open?: boolean; children?: JSX.Element }) {
  return <Dialog testID="app-dialog" open={props.open ?? true} animation={reduceMotion() ? "none" : narrow() ? "slide" : "fade"} onOpenChange={({ open }) => { if (!open) props.close(); }} backdropStyle={{ backgroundColor: palette().scrim }}
    style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: narrow() ? "flex-end" : "center", paddingTop: "calc(env(safe-area-inset-top) + 16px)", paddingBottom: "env(keyboard-inset-height)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
    <View style={{ width: "100%", maxWidth: narrow() ? 520 : 480, minHeight: 0, flexShrink: 1, maxHeight: windowSize().height - 40, backgroundColor: palette().panel, borderRadius: 28, padding: narrow() ? 20 : 24, paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)", gap: 16 }}>
      <View style={{ flexDirection: "row", flexShrink: 0, alignItems: "center", gap: 12 }}><Label size={24} weight="600" style={{ flex: 1 }}>{props.title}</Label><Tool icon="close" label="关闭" onPress={props.close} /></View>
      <Scroll style={{ flexShrink: 1, minWidth: 0, minHeight: 0, maxHeight: windowSize().height - 160 }} contentStyle={{ gap: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">{props.children}</Scroll>
    </View>
  </Dialog>;
}
