// A page of the YouTube Music workspace, as the Spotify workspace builds
// its own (src/spotish/components/page.tsx, header.tsx): an opaque page on
// the window's ground (NSH's Linux stack paints pages libadwaita grey, so
// every page covers it), the header row inside it on the desktops (the
// sidebar's toggle, Back and Forward; Search growing out of the corner), and
// the page's large title. Lists on a page come in as a wave when it opens.

import { Scroll, Text, View, context, createMotion, token, untracked, type JSX } from "nsh";
import { Button, Input, Toolbar } from "nsh/base";
import * as s from "../store";
import * as nav from "../navigation";
import * as account from "../account";
import { parseMusicLink } from "../musicLinks";
import { Icon } from "../icons";
import { Art, greeting, palette as c } from "../ui";
import { layout, narrowDesktopHeader, pageEnd, sidebarCollapsed, sidebarShown, systemHeader, toggleSidebar } from "../layout";
import { focusRing, IconButton } from "../spotish/components/ui/controls";
import { createListWave, type ListWave } from "../spotish/components/ui/motion";
import { DISTANCE, DURATION, EASING } from "../spotish/components/ui/tokens";

/** The route a page belongs to: its lists ask whether it is on top. */
export const RouteContext = context<{ key: number; page: nav.Page } | null>(null);

/** A wave for a list of this page: its items come in each time the page is
 * opened (spotish `createListWave`). */
export function pageWave(options: { afterReveal?: boolean } = {}): ListWave {
  const route = untracked(RouteContext);
  return createListWave({ isTop: () => !route || nav.currentKey() === route.key, reenter: nav.rootOpens, afterReveal: options.afterReveal });
}

const titles: Record<nav.Page, string> = { home: "首页", search: "搜索", library: "音乐库", liked: "喜欢的音乐", history: "最近播放", collection: "", playlist: "歌单", downloads: "下载", stats: "聆听统计", settings: "设置", browse: "探索", together: "一起听", account: "账号" };
export const routeTitle = (route: nav.Route) => route.title || route.collection?.title || titles[route.page];

let suggestTimer: ReturnType<typeof setTimeout> | undefined;
/** Typing in the search field: suggestions follow after a short pause. */
export function changeSearch(value: string) {
  nav.searchText.set(value);
  clearTimeout(suggestTimer);
  void s.loadSuggestions("");
  if (value.trim() && !parseMusicLink(value)) suggestTimer = setTimeout(() => void s.loadSuggestions(value), 180);
}
export function runSearch(value = nav.searchText(), type = nav.searchType()) {
  clearTimeout(suggestTimer);
  nav.performSearch(value, type);
}

/** The search field: a pill with the search glyph (which searches), the
 * text and Clear. In the header it grows out from the right as it opens. */
export function SearchInput(props: { header?: boolean }) {
  const grow = untracked(() => props.header ? createMotion({ enter: { keyframes: { opacity: [0, 1], scaleX: [0.7, 1], translateX: [DISTANCE.large, 0] }, duration: DURATION.base, easing: EASING.out } }).style : undefined);
  return <View style={grow} class={`flex-row items-center gap-2 rounded-full border border-secondary bg-secondary pl-1.5 pr-1.5 transition duration-150 ease-out focus-within:border-muted-foreground motion-reduce:transition-none ${props.header ? "h-9 w-80" : "h-12 max-w-[560px] flex-1"}`}>
    <Button testID="search-submit" accessibilityLabel="搜索" onPress={() => runSearch()} class={`size-7 items-center justify-center rounded-full hover:bg-foreground/10 ${focusRing}`}><Icon name="search" size={16} color="muted-foreground" /></Button>
    <SearchText header={props.header} />
    <If when={nav.searchText()}><IconButton name="close" label="清空输入" size={14} onPress={() => changeSearch("")} /></If>
  </View>;
}
function SearchText(props: { header?: boolean }) {
  return <Input testID="search-input" value={nav.searchText()} onChange={({ value }) => changeSearch(value)} onSubmit={() => runSearch()} placeholder="搜索音乐或粘贴 YouTube Music 链接" accessibilityLabel="搜索音乐或粘贴 YouTube Music 链接" returnKeyType="search" submitBehavior="submit" autoFocus autoCapitalize="none" autoCorrect={false}
    class={`min-w-0 flex-1 ${props.header ? "text-sm" : "text-base"} text-foreground`} style={{ placeholderColor: String(token("muted-foreground")), caretColor: String(token("foreground")) }} />;
}

/** The account's round picture: the account page. */
export function Avatar(props: { testID?: string }) {
  return <Button testID={props.testID ?? "header-account"} accessibilityLabel={account.currentAccount()?.name || "登录 YouTube Music"} onPress={() => nav.navigate("account")} class={`size-9 shrink-0 items-center justify-center rounded-full ${focusRing} active:scale-95`}>
    <Art src={account.currentAccount()?.avatar} size={28} radius={14} icon="artist" />
  </Button>;
}

/** iOS and Android: the stack's header carries these. */
export function HeaderActions() {
  return <View class="shrink-0 flex-row items-center gap-1"><If when={nav.page() !== "search"}><IconButton testID="header-search" name="search" label="搜索音乐" size={20} onPress={() => nav.navigate("search")} /></If><IconButton testID="header-settings" name="settings" label="设置" size={20} onPress={() => nav.navigate("settings")} /><Avatar /></View>;
}

/** The header of a page on the desktops and the web: the sidebar's toggle,
 * Back and Forward; Search (the field itself on the search page); with no
 * sidebar, settings and the account. */
export function PageHeader(props: { route: nav.Route }) {
  const desktop = () => layout() === "desktop";
  const searchHere = () => props.route.page === "search";
  return <Toolbar testID="page-toolbar" accessibilityLabel="页眉" class={narrowDesktopHeader() || !desktop() ? "min-h-14 items-center gap-1 px-2" : "min-h-14 items-center gap-2 px-3"}>
    <If when={desktop()}><IconButton name={sidebarCollapsed() ? "sidebarExpand" : "sidebarCollapse"} label={sidebarCollapsed() ? "展开侧边栏" : "收起侧边栏"} hint onPress={toggleSidebar} /></If>
    <IconButton testID="navigate-back" name="chevronLeft" label="返回" disabled={!nav.canGoBack()} onPress={nav.goBack} />
    <If when={desktop()}><IconButton testID="navigate-forward" name="chevronRight" label="前进" disabled={!nav.canGoForward()} onPress={nav.goForward} /></If>
    <View class="flex-1" />
    <If when={searchHere() && desktop() && !narrowDesktopHeader()} else={<If when={!searchHere()}><IconButton testID="header-search" name="search" label="搜索音乐" hint onPress={() => nav.navigate("search")} /></If>}><SearchInput header /></If>
    <If when={!sidebarShown()}><IconButton testID="header-settings" name="settings" label="设置" hint onPress={() => nav.navigate("settings")} /><Avatar /></If>
  </Toolbar>;
}

/** The page's large title (Home greets). */
export function Heading(props: { route: nav.Route; inset?: boolean }) {
  return <View testID="page-header" class={`pb-2 pt-1 ${props.inset ? "px-3" : ""}`}><Text testID="page-title" role="header" class={`line-clamp-2 font-extrabold text-foreground ${layout() === "phone" ? "text-3xl" : "text-4xl"}`}>{props.route.page === "home" ? greeting() : routeTitle(props.route)}</Text></View>;
}

/** A failure the page can't show itself, over the content until closed. */
export function ErrorBanner() {
  return <If when={s.error()}><View testID="app-error" role="alert" class="mx-3 mb-2 flex-row items-center gap-3 rounded-(--radius-card) border border-border bg-card py-2 pl-4 pr-2">
    <Icon name="alert" size={18} color="destructive" /><Text class="line-clamp-3 flex-1 text-sm text-foreground">{s.error()}</Text><IconButton name="close" label="关闭提示" onPress={s.clearError} />
  </View></If>;
}

/** A page's scrolling body: its title (unless the stack's header shows it)
 * and content, ending clear of the floating player. `inset`: text content
 * keeps the page's 24pt gutter; lists (`inset={false}`) bring their own. */
export function PageBody(props: { route: nav.Route; heading?: boolean; inset?: boolean; children?: JSX.Element }) {
  const inset = () => props.inset ?? true;
  return <Scroll testID={`content-${props.route.page}`} class="min-h-0 min-w-0 flex-1" contentClass={`${inset() ? "px-6" : "px-3"} pt-1 ${pageEnd()}`} keyboardShouldPersistTaps="handled">
    <View class="w-full min-w-0 max-w-[1600px] gap-4 self-center">
      <If when={props.heading ?? !systemHeader}><Heading route={props.route} inset={!inset()} /></If>
      {props.children}
    </View>
  </Scroll>;
}

export { c as palette };
