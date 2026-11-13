import { mount, View, Scroll, Text, signal, effect, platform, keymap, host, colorScheme, reduceMotion } from "nsh";
import { NavStack, NavPage, Tabs, Tab } from "nsh/base";
import * as s from "./src/store";
import * as p from "./src/playback";
import * as nav from "./src/navigation";
import * as together from "./src/together";
import * as account from "./src/account";
import { AccountPage } from "./src/pages/Account";
import { CloudDialogs } from "./src/components/CloudLibrary";
import { Icon } from "./src/icons";
import { Tool, Art, palette as c, spacious, action } from "./src/ui";
import { HomePage, SearchPage, ExplorePage } from "./src/pages/Discover";
import { LibraryPage, SongCollectionPage, CollectionPage } from "./src/pages/Library";
import { DownloadsPage, StatisticsPage } from "./src/pages/Activity";
import { SettingsPage } from "./src/pages/Settings";
import { TogetherPage } from "./src/pages/Together";
import { MiniPlayer, PlayerBar, FullPlayer } from "./src/components/Player";
import { ToastHost } from "./src/components/Toasts";
import { Dialogs } from "./src/components/Dialogs";
import { TrackRow } from "./src/components/Music";
import { Sidebar } from "./src/components/Sidebar";
import { ErrorBanner, HeaderActions, PageBody, PageHeader, RouteContext, routeTitle } from "./src/components/Page";
import { barSize, layout, railSidebar, sidebarShown, sidebarWidth, systemHeader } from "./src/layout";
import { ProviderSwitcher, providerRail } from "./src/components/ProviderSwitcher";
import { activeProvider, applyWorkspaceTheme, initializeProviders, providerError, providersReady, selectProvider, switchingProvider } from "./src/providers";
import { SpotifyWorkspace } from "./src/spotish/App";
import { IconButton, focusRing } from "./src/spotish/components/ui/controls";
import { animateLayoutOn } from "./src/spotish/components/ui/motion";

// The YouTube Music workspace in the Spotify workspace's shells
// (src/spotish/shells): on the desktops the sidebar down the left and the
// pages on the window's ground, the player floating over their bottom; on
// phones one column, the mini player and tabs.
const sidePlayer = signal(false);
const primary = [{ page: "home", label: "首页", icon: "home" }, { page: "search", label: "搜索", icon: "search" }, { page: "library", label: "音乐库", icon: "library" }] as const;

function Screen(props: { route: nav.Route }) {
  switch (props.route.page) {
    case "home": return <HomePage route={props.route} />;
    case "search": return <SearchPage route={props.route} />;
    case "library": return <LibraryPage route={props.route} />;
    case "liked": case "history": case "playlist": return <SongCollectionPage kind={props.route.page} route={props.route} />;
    case "collection": return <CollectionPage route={props.route} />;
    case "browse": return <PageBody route={props.route} inset={false}><ExplorePage /></PageBody>;
    case "downloads": return <PageBody route={props.route}><DownloadsPage /></PageBody>;
    case "stats": return <PageBody route={props.route}><StatisticsPage /></PageBody>;
    case "settings": return <PageBody route={props.route}><SettingsPage /></PageBody>;
    case "together": return <PageBody route={props.route}><TogetherPage /></PageBody>;
    case "account": return <PageBody route={props.route}><AccountPage /></PageBody>;
  }
}

/** The stack of pages; each covers the stack's own background. */
function Pages() {
  return <NavStack state={nav.stack} testID="main-navigation" class="min-h-0 min-w-0 flex-1" onChange={({ routes }) => nav.onRoutesChanged(routes)}>{route => <NavPage title={routeTitle(route)} animation={reduceMotion() ? "none" : primary.some(item => item.page === route.page) ? "fade" : "slide"} popOnBack={!nav.handlesBack(route)} onBackPress={() => { if (nav.handlesBack(route)) nav.goBack(); }}
    headerVisible={systemHeader} headerLeft={systemHeader && nav.handlesBack(route) ? <IconButton testID="navigate-back" name="chevronLeft" label="返回" size={22} onPress={nav.goBack} /> : undefined} headerRight={systemHeader ? <HeaderActions /> : undefined}
    headerStyle={{ backgroundColor: c().bg, color: c().text, tintColor: c().text }} statusBar={{ foreground: s.settings().theme === "light" || s.settings().theme === "system" && colorScheme() === "light" ? "dark" : "light" }}>
    <RouteContext.Provider value={{ key: route.key, page: route.page }}>
      <View class={systemHeader ? "min-h-0 flex-1 bg-sidebar" : "absolute inset-0 bg-sidebar"}>
        <If when={!systemHeader}><PageHeader route={route} /></If>
        <ErrorBanner />
        <Screen route={route} />
      </View>
    </RouteContext.Provider>
  </NavPage>}</NavStack>;
}

/** The Now Playing view beside the pages, a panel of its own. */
function SidePlayer() {
  return <View testID="side-player" class="w-80 shrink-0 gap-4 rounded-(--radius-panel) border border-border bg-card p-4">
    <View class="flex-row items-center gap-1"><Text class="line-clamp-1 flex-1 text-base font-bold text-foreground">{p.queueTitle() || "正在播放"}</Text><IconButton name="maximize" label="打开播放器" hint onPress={() => nav.showPlayer()} /><IconButton name="close" label="收起正在播放" hint onPress={() => sidePlayer.set(false)} /></View>
    <View role="button" accessibilityLabel="打开封面" onPress={() => nav.showPlayer()} class={`rounded-(--radius-card) active:scale-[0.98] ${focusRing}`}><Art track={p.currentTrack()} size={286} radius={12} style={{ boxShadow: c().shadow }} /></View>
    <View class="gap-1"><Text class="line-clamp-2 text-2xl font-extrabold text-foreground">{p.currentTrack()?.title}</Text><Text class="line-clamp-1 text-sm text-muted-foreground">{p.currentTrack()?.artist}</Text></View>
    <View class="min-h-0 flex-1 rounded-(--radius-card) bg-secondary pt-2">
      <View class="flex-row items-center pl-3 pr-1"><Text class="flex-1 text-sm font-bold text-foreground">接下来</Text><IconButton name="playlist" label="完整队列" onPress={() => nav.showPlayer("queue")} /></View>
      <Scroll class="flex-1" scrollbar={false} contentClass="px-1 pb-2"><Each of={p.queue().slice(p.currentIndex() + 1, p.currentIndex() + 9)}>{(track, index) => <TrackRow compact menu={false} track={track()} onPlay={() => action(() => p.playAt(p.currentIndex() + index() + 1))} />}</Each>
        <If when={p.currentIndex() >= p.queue().length - 1}><Text class="p-3 text-xs text-muted-foreground">{s.settings().autoRadio ? "播放结束后继续电台推荐" : "已到队列末尾"}</Text></If></Scroll>
    </View>
  </View>;
}

function DesktopShell() {
  // Crossing a breakpoint, the sidebar and the player bar glide to their
  // new arrangement.
  animateLayoutOn(() => `${sidebarWidth()}|${barSize()}|${sidePlayer()}`);
  return <View class="min-h-0 flex-1 flex-row gap-2 px-2 pb-2" style={{ paddingTop: systemHeader ? 8 : 0, paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}>
    <If when={sidebarShown()}><View class="shrink-0" style={{ width: sidebarWidth() }}><Sidebar compact={railSidebar()} /></View></If>
    <View class="relative min-h-0 min-w-0 flex-1">
      <Pages />
      <If when={p.currentTrack() && !nav.fullPlayer()}><View class="absolute inset-x-3 bottom-1"><PlayerBar sidePlayer={sidePlayer()} onSidePlayer={() => sidePlayer.set(!sidePlayer())} /></View></If>
    </View>
    <If when={spacious() && sidePlayer() && p.currentTrack() && nav.page() !== "settings"}><SidePlayer /></If>
  </View>;
}

/** The phone's tabs (spotish `AppTabs`), on the player's surface. */
function AppTabs() {
  const selected = (page: nav.Page) => nav.activeTab() === page;
  return <View testID="mobile-tabs" class="shrink-0 border-t border-border bg-player px-2 pt-1 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
    <Tabs class="flex-row items-stretch" indicatorClass="hidden">
      <Each of={primary}>{item => <Tab testID={`nav-mobile-${item().page}`} accessibilityLabel={item().label} selected={selected(item().page)} onPress={() => nav.navigate(item().page, true)} class={`group min-h-12 flex-1 items-center justify-center gap-1 rounded-(--radius) py-1.5 active:opacity-60 ${focusRing}`}>
        <Icon name={item().icon} size={24} color={selected(item().page) ? "foreground" : "muted-foreground"} />
        <Text class={`text-xs ${selected(item().page) ? "font-semibold text-foreground" : "font-normal text-muted-foreground"}`}>{item().label}</Text>
      </Tab>}</Each>
    </Tabs>
  </View>;
}

function PhoneShell() {
  return <View class="min-h-0 flex-1">
    <View class="min-h-0 flex-1"><Pages /></View>
    <MiniPlayer />
    <AppTabs />
  </View>;
}

function YouTubeWorkspace() {
  keymap.bind({ "space": () => { if (!p.remoteControlled()) void action(p.togglePlay); }, "mod+k": () => nav.navigate("search", true), "mod+right": () => { if (!p.remoteControlled()) void action(p.next); }, "mod+left": () => { if (!p.remoteControlled()) void action(p.previous); } });
  // Pure black is a theme of its own: the same roles, every surface darker.
  effect(() => applyWorkspaceTheme(s.settings().theme));
  return <View testID="metrolist-app" class="min-h-0 min-w-0 flex-1 bg-sidebar">
    <If when={layout() === "desktop"} else={<PhoneShell />}><DesktopShell /></If>
    <FullPlayer /><Dialogs /><CloudDialogs />
    <ToastHost />
  </View>;
}

function App() {
  if (platform.os === "web") void host.call("app.start").catch(s.showError);
  account.setAccountHooks({ onChange: () => { p.invalidatePreparation(); void s.resetHome(); } });
  // Host subscriptions live with the application, so switching workspaces does
  // not detach Android playback events or progress from background downloads.
  void s.initialize().then(async () => {
    await initializeProviders();
    await account.initializeAccounts();
  }).catch(s.showError);
  void together.initializeTogether().catch(s.showError);
  keymap.bind("mod+shift+1", () => void selectProvider("youtube"));
  keymap.bind("mod+shift+2", () => void selectProvider("spotify"));
  return <View testID="metrolist-shell" class="min-h-0 min-w-0 flex-1 bg-sidebar" style={{ flexDirection: providerRail() ? "row" : "column" }}>
    <ProviderSwitcher />

    <View class="min-h-0 min-w-0 flex-1" style={{ pointerEvents: switchingProvider() ? "none" : "auto" }}>
      <If when={providerError()}><View testID="provider-error" class="flex-row items-center gap-3 bg-secondary px-4 py-2"><Text class="flex-1 text-sm text-foreground">{providerError()}</Text><Tool icon="close" label="关闭切换提示" onPress={() => providerError.set("")} /></View></If>
      <If when={providersReady()}>
        <If when={activeProvider() === "youtube"}><YouTubeWorkspace /></If>
        <If when={activeProvider() === "spotify"}><SpotifyWorkspace /></If>
      </If>
    </View>
  </View>;
}
mount(App);
