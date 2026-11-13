import { Image, Text, View, Scroll, signal, windowSize, reduceMotion, colorScheme, createMotion, token, type JSX, type ViewStyle, type MotionSpec } from "nsh";
import { Button, Input, Switch, Tab, Menu, MenuItem, MenuSeparator, Dialog } from "nsh/base";
import { settings } from "./store";
import { Icon, glyph } from "./icons";
import { localArtwork } from "../assets/local-artwork";
import type { Track } from "./model";
import { motion } from "./motion";
import { phone } from "./layout";
import { BarSlider, focusRing, Hint, IconButton, popupSurface, menuItem, SectionTitle as SpotishSectionTitle } from "./spotish/components/ui/controls";
import { menuPopupHidden, menuPopupLeaving, menuPopupStyle } from "./spotish/components/ui/menu";
import { alpha } from "./spotish/state/tint";

// The YouTube Music workspace's controls, made of the Spotify workspace's
// (src/spotish/components/ui): the same shapes, layers and motion, in this
// workspace's theme (theme.json, YouTube red as the small accent). Pages
// compose these; colours are theme tokens.

export const narrow = phone;
export const touch = () => phone();
export const spacious = () => !narrow() && windowSize().width >= 1240;
export const pageGutter = () => 12;
export const light = () => settings().theme === "light" || settings().theme === "system" && colorScheme() === "light";
const tok = (name: string) => String(token(name as never));
/** The theme's roles as colours, for the few places that need a value. */
export const palette = () => ({
  bg: tok("sidebar"), panel: tok("card"), card: tok("card"), secondary: tok("secondary"), raised: tok("muted"), line: tok("border"),
  text: tok("foreground"), sub: tok("muted-foreground"), faint: alpha(tok("muted-foreground"), 0.75), accent: tok("primary"), onAccent: tok("primary-foreground"), accentWash: alpha(tok("primary"), 0.15),
  selected: tok("secondary"), hover: tok("row-hover"), wash: alpha(tok("foreground"), 0.08), popover: tok("popover"), player: tok("player"), control: tok("foreground"), onControl: tok("background"),
  track: alpha(tok("foreground"), 0.12), fill: alpha(tok("foreground"), 0.55), liked: tok("liked"), danger: tok("destructive"), good: light() ? "#14833b" : "#3dd68c",
  scrim: alpha(tok("shell"), 0.8), shadow: light() ? "0 16px 48px #0e101226" : "0 16px 48px #00000080",
});
export { motion } from "./motion";
export const toast = signal("");
let toastTimer: ReturnType<typeof setTimeout>;
export function say(message: string) { toast.set(message); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.set(""), 3600); }
export async function action(work: () => unknown | Promise<unknown>, message?: string) {
  try { await work(); if (message) say(message); } catch (error) { say(error instanceof Error ? error.message : String(error)); }
}
export const time = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "直播";
export const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
export const greeting = () => { const hour = new Date().getHours(); return hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好"; };

/** How a control presses in and settles back, and how a wash comes and goes
 * (spotish's PRESS, PRESSED and WASH). */
export const PRESS = "transition duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
export const PRESSED = "active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100";
export const WASH = "transition duration-120 ease-out motion-reduce:transition-none";
/** A row of a list or a panel: the row hover, pressed a hair smaller. */
export const ROW = `transition duration-150 ease-out hover:bg-row-hover active:bg-muted active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 ${focusRing}`;

export function Label(props: { children?: JSX.Element; size?: number; color?: string; weight?: string; lines?: number; style?: any; testID?: string }) {
  return <Text testID={props.testID} style={{ minWidth: 0, numberOfLines: props.lines, color: props.color || palette().text, fontSize: props.size || (narrow() ? 15 : 14), fontWeight: (props.weight || "400") as any, ...props.style }}>{props.children}</Text>;
}
export function Press(props: { children?: JSX.Element; label?: string; onPress: () => void; style?: ViewStyle; selected?: boolean; disabled?: boolean; testID?: string; onLongPress?: () => void }) {
  return <View testID={props.testID} role="button" accessibilityLabel={props.label} accessibilityState={{ selected: !!props.selected, disabled: !!props.disabled }} onPress={props.onPress} onLongPress={props.onLongPress} disabled={props.disabled}
    style={{ minWidth: 0, ...props.style }} class={`rounded-(--radius) ${props.selected ? "bg-secondary" : ""} ${ROW} disabled:opacity-40`}>{props.children}</View>;
}
/** A borderless icon button (spotish `IconButton`): the glyph dims at rest
 * and moves once as the pointer comes; a toggle that is on takes the accent,
 * Like turns red. */
export function Tool(props: { icon: string; label: string; onPress: () => void; active?: boolean; size?: number; large?: boolean; testID?: string; disabled?: boolean }) {
  const like = () => props.icon === "heart";
  return <IconButton testID={props.testID} name={like() ? "heartFilled" : glyph(props.icon)} label={props.label} size={props.size ?? (props.large ? 24 : touch() ? 22 : 18)} pressed={props.active} pressedColor={like() ? "liked" : undefined} disabled={props.disabled} hint={!touch()} onPress={props.onPress} />;
}
/** A labelled button (spotish `ActionButton`, with a glyph): `primary` is
 * the area's one commitment, in the foreground colour; the rest are quiet
 * outlined capsules. */
export function Pill(props: { label: string; icon?: string; active?: boolean; onPress: () => void; primary?: boolean; testID?: string; disabled?: boolean; danger?: boolean }) {
  const ink = () => props.primary ? "background" : props.danger ? "destructive" : "foreground";
  return <Button testID={props.testID} accessibilityLabel={props.label} onPress={props.onPress} disabled={props.disabled}
    class={`group ${touch() ? "h-11" : "h-9"} max-w-full shrink-0 flex-row items-center justify-center gap-2 overflow-hidden rounded-full ${props.icon ? "pl-4 pr-5" : "px-5"} ${PRESS} ${PRESSED} disabled:opacity-40 ${focusRing} ${
      props.primary ? "bg-foreground shadow-sm hover:shadow-md" : props.active ? "border border-foreground bg-secondary" : "border border-border bg-secondary hover:border-muted-foreground"}`}>
    <View class={`absolute inset-0 rounded-full opacity-0 ${WASH} group-hover:opacity-10 group-active:opacity-15 group-disabled:opacity-0 ${props.primary ? "bg-background" : "bg-foreground"}`} />
    <If when={props.icon}><Icon name={props.icon!} size={16} color={ink()} /></If>
    <Text class={`shrink text-center text-sm font-bold ${props.primary ? "text-background" : props.danger ? "text-destructive" : "text-foreground"}`}>{props.label}</Text>
  </Button>;
}
/** A filter capsule: grey at rest, the foreground colour once chosen. */
export function Chip(props: { label: string; selected: boolean; onPress: () => void; icon?: string; testID?: string }) {
  return <Tab testID={props.testID} selected={props.selected} onPress={props.onPress} accessibilityLabel={props.label}
    class={`${touch() ? "h-10" : "h-8"} shrink-0 flex-row items-center justify-center gap-1.5 rounded-full px-3.5 ${WASH} active:opacity-70 ${focusRing} ${props.selected ? "bg-foreground" : "bg-secondary hover:bg-muted"}`}>
    <If when={props.icon}><Icon name={props.icon!} size={14} color={props.selected ? "background" : "foreground"} /></If>
    <Text class={`text-sm ${props.selected ? "font-semibold text-background" : "font-normal text-foreground"}`}>{props.label}</Text>
  </Tab>;
}
export function Toggle(props: { label: string; value: boolean; onChange: (value: boolean) => void; description?: string; testID?: string }) {
  return <View class="min-h-14 flex-row items-center gap-5">
    <View class="min-w-0 flex-1 gap-1"><Text class="text-sm font-medium text-foreground">{props.label}</Text><If when={props.description}><Text class="text-xs text-muted-foreground">{props.description}</Text></If></View>
    <Switch testID={props.testID} accessibilityLabel={props.label} checked={props.value} onChange={({ checked }) => props.onChange(checked)} class="h-11 w-11 shrink-0 justify-center"
      trackClass={`h-6 w-11 rounded-full p-[3px] ${WASH} ${props.value ? "bg-foreground" : "bg-muted"}`}
      thumbClass={`size-[18px] rounded-full transition-transform duration-180 ease-out motion-reduce:transition-none ${props.value ? "translate-x-5 bg-background" : "translate-x-0 bg-muted-foreground"}`} />
  </View>;
}
export function Art(props: { track?: Track; src?: any; size?: number; radius?: number; style?: ViewStyle; icon?: string }) {
  const size = () => props.size || 48;
  return <View class="shrink-0 items-center justify-center overflow-hidden bg-secondary" style={{ width: size(), height: size(), borderRadius: props.radius ?? 6, ...props.style }}>
    <Icon name={props.icon || "music"} size={Math.max(16, size() * 0.4)} color="muted-foreground" />
    <If when={props.src || props.track?.artwork}>
      <Image src={props.src || (props.track ? localArtwork[props.track.id] || props.track.artwork : "")} accessibilityElementsHidden class="absolute inset-0 object-cover" style={{ width: "100%", height: "100%" }} />
    </If>
  </View>;
}
/** A text field: the search field's pill (a box when `multiline`). */
export function Field(props: { value: string; onChange: (value: string) => void; placeholder: string; onSubmit?: () => void; testID?: string; autoFocus?: boolean; multiline?: boolean; icon?: string }) {
  return <View class={`min-w-0 flex-1 flex-row items-center gap-3 border border-secondary bg-secondary px-4 transition duration-150 ease-out focus-within:border-muted-foreground motion-reduce:transition-none ${props.multiline ? "min-h-24 items-start rounded-(--radius-card) py-3" : `${touch() ? "h-12" : "h-10"} rounded-full`}`}>
    <If when={props.icon}><Icon name={props.icon!} size={18} color="muted-foreground" /></If>
    <Input testID={props.testID} accessibilityLabel={props.placeholder} value={props.value} onChange={({ value }) => props.onChange(value)} onSubmit={props.onSubmit} placeholder={props.placeholder} autoFocus={props.autoFocus} multiline={props.multiline} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
      class={`min-w-0 flex-1 ${narrow() ? "text-base" : "text-sm"} text-foreground`} style={{ placeholderColor: tok("muted-foreground"), caretColor: tok("foreground") }} />
  </View>;
}
/** A thin bar slider (spotish `BarSlider`): the bar is the control. */
export function Rail(props: { value: number; max?: number; bufferedValue?: number; onChange: (value: number) => void; onChangeEnd?: (value: number) => void; label: string; large?: boolean; testID?: string; disabled?: boolean }) {
  return <View class="min-w-0 flex-1 justify-center" style={{ height: touch() ? 44 : props.large ? 32 : 24 }}>
    <BarSlider testID={props.testID} label={props.label} value={props.value} max={props.max || 100} disabled={props.disabled} tinted quiet={!props.large} class="flex-1" onChange={props.onChange} onChangeEnd={(value) => props.onChangeEnd?.(value)} />
  </View>;
}
/** A quiet text action beside a section's title (“显示全部”, “清空”). */
export function TextAction(props: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return <Button testID={props.testID} accessibilityLabel={props.label} onPress={props.onPress} disabled={props.disabled} class={`group shrink-0 justify-center rounded-sm px-1 ${touch() ? "min-h-11" : "min-h-8"} ${PRESS} ${PRESSED} active:opacity-70 disabled:opacity-40 ${focusRing}`}>
    <Text class="text-sm font-bold text-muted-foreground group-hover:text-foreground group-hover:underline">{props.label}</Text>
  </Button>;
}
/** A section's title (spotish `SectionTitle`: `text-xl` bold), what it is
 * over it, and its action at the end. */
export function SectionTitle(props: { title: string; subtitle?: string; action?: string; onPress?: () => void; icon?: string; disabled?: boolean }) {
  return <View class="mb-2 flex-row flex-wrap items-end justify-between gap-3">
    <View class="min-w-0 grow basis-40 gap-0.5"><If when={props.subtitle}><Text class="text-xs font-medium text-muted-foreground">{props.subtitle}</Text></If><SpotishSectionTitle>{props.title}</SpotishSectionTitle></View>
    <If when={props.action}><If when={props.icon === "play" || props.icon === "shuffle"} else={<TextAction disabled={props.disabled} label={props.action!} onPress={() => props.onPress?.()} />}><Pill disabled={props.disabled} label={props.action!} icon={props.icon} onPress={() => props.onPress?.()} /></If></If>
  </View>;
}
export function PageTitle(props: { title: string; subtitle?: string; children?: JSX.Element }) {
  return <View class="mb-2 flex-row items-end gap-4"><View class="min-w-0 flex-1 gap-2"><Text role="header" class={`${narrow() ? "text-3xl" : "text-4xl"} font-extrabold text-foreground`}>{props.title}</Text><If when={props.subtitle}><Text class="text-sm text-muted-foreground">{props.subtitle}</Text></If></View>{props.children}</View>;
}
/** A page's empty state (spotish `EmptyState`): a short title, what to do. */
export function Empty(props: { icon: string; title: string; description: string; children?: JSX.Element }) {
  return <View class="items-center gap-2 px-6 py-16">
    <Text class="text-center text-lg font-bold text-foreground">{props.title}</Text>
    <Text class="max-w-md text-center text-sm text-muted-foreground">{props.description}</Text>
    <If when={props.children}><View class="mt-2 flex-row flex-wrap justify-center gap-2">{props.children}</View></If>
  </View>;
}
/** A group of settings: an overline and a panel. */
export function Section(props: { title?: string; children?: JSX.Element }) {
  return <View class="gap-2"><If when={props.title}><Text class="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{props.title}</Text></If><View class="gap-3 rounded-(--radius-panel) border border-border bg-card p-4">{props.children}</View></View>;
}
export interface CommandItem { label: string; icon?: string; run: () => void; active?: boolean; disabled?: boolean; danger?: boolean; separator?: boolean; testID?: string }
/** A menu behind a “⋯” button: spotish's popup, growing out of the
 * trigger's corner (the dropdown morph). */
export function CommandMenu(props: { label: string; icon?: string; items: CommandItem[]; testID?: string }) {
  return <Menu placement="bottom" align="end" offset={4} popupClass={popupSurface}
    popupStyle={{ ...menuPopupStyle("bottom", "end"), minWidth: 220, maxWidth: Math.min(320, windowSize().width - 24) }} popupStartingStyle={menuPopupHidden("bottom", "end")} popupEndingStyle={menuPopupLeaving("bottom", "end")}
    trigger={<Button testID={props.testID} accessibilityLabel={props.label} class={`group relative ${touch() ? "size-11" : "size-8"} shrink-0 items-center justify-center rounded-full ${focusRing}`}>
      <View class={`absolute inset-0 scale-[0.9] rounded-full bg-foreground/10 opacity-0 ${PRESS} group-hover:scale-100 group-hover:opacity-100 group-active:scale-[0.95]`} />
      <View class={`opacity-70 ${PRESS} group-hover:opacity-100 group-active:scale-[0.95]`}><Icon name={props.icon || "more"} size={18} color="foreground" /></View>
    </Button>}>
    <Each of={props.items}>{(item) => <><If when={item().separator}><MenuSeparator class="-mx-1 my-1 h-px bg-border" /></If>
      <MenuItem testID={item().testID} onSelect={() => item().run()} disabled={item().disabled} class={`${menuItem} ${touch() ? "h-11" : ""} gap-2.5`}>
        <View class="w-5 items-center"><Icon name={item().icon || "music"} size={16} color={item().danger ? "destructive" : "muted-foreground"} /></View>
        <Text class={`flex-1 text-sm ${item().danger ? "text-destructive" : "text-popover-foreground"}`}>{item().label}</Text>
        <If when={item().active}><Icon name="check" size={14} color="popover-foreground" /></If>
      </MenuItem></>}</Each>
  </Menu>;
}
/** A dialog's entrance (spotish `AppDialog`): up a little from slightly
 * smaller as the scrim fades. */
const RISE: MotionSpec = { keyframes: { opacity: [0, 1], scale: [0.97, 1], translateY: [10, 0] }, duration: 240, easing: "easeOut" };
export function Modal(props: { title: string; close: () => void; open?: boolean; children?: JSX.Element }) {
  return <Dialog testID="app-dialog" open={props.open ?? true} animation={reduceMotion() ? "none" : "fade"} onOpenChange={({ open }) => { if (!open) props.close(); }} backdropClass="bg-shell/80"
    class={`m-auto w-full max-w-md overflow-hidden rounded-(--radius-panel) border border-border bg-popover shadow-2xl ${narrow() ? "mx-3" : ""}`} style={{ maxHeight: windowSize().height - 40, marginBottom: "env(keyboard-inset-height)" }}>
    <View class="min-h-0 shrink" style={reduceMotion() ? undefined : createMotion({ enter: RISE }).style}>
      <View class="shrink-0 flex-row items-center gap-3 pb-2 pl-6 pr-3 pt-4"><Text class="flex-1 text-xl font-bold text-popover-foreground">{props.title}</Text><Tool icon="close" label="关闭" onPress={props.close} /></View>
      <Scroll class="min-h-0 shrink" style={{ maxHeight: windowSize().height - 140 }} contentClass="gap-4 px-6 pb-6" keyboardShouldPersistTaps="handled">{props.children}</Scroll>
    </View>
  </Dialog>;
}
export { Hint };
