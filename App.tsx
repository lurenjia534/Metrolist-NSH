import { mount, View, Image, Scroll, signal, platform, keymap, host, colorScheme, reduceMotion } from "nsh";
import { NavStack, NavPage, Tabs, Tab } from "nsh/base";
import * as s from "./src/store";
import * as p from "./src/playback";
import * as nav from "./src/navigation";
import * as together from "./src/together";
import * as account from "./src/account";
import { AccountPage } from "./src/pages/Account";
import { CloudDialogs } from "./src/components/CloudLibrary";
import { Icon } from "./src/icons";
import { Label, Tool, Pill, Art, Press, palette as c, narrow, spacious, pageGutter, action } from "./src/ui";
import { transition } from "./src/motion";
import { HomePage, SearchPage, ExplorePage } from "./src/pages/Discover";
import { LibraryPage, SongCollectionPage, CollectionPage } from "./src/pages/Library";
import { DownloadsPage, StatisticsPage } from "./src/pages/Activity";
import { SettingsPage } from "./src/pages/Settings";
import { TogetherPage } from "./src/pages/Together";
import { MiniPlayer, FullPlayer } from "./src/components/Player";
import { ToastHost } from "./src/components/Toasts";
import { Dialogs } from "./src/components/Dialogs";
import { TrackRow } from "./src/components/Music";
import logo from "./assets/metrolist-icon.png";

const sidePlayer = signal(true);
const systemHeader = platform.os === "ios" || platform.os === "android";
const primary = [{ page: "home", label: "首页", icon: "home" }, { page: "search", label: "搜索", icon: "search" }, { page: "library", label: "音乐库", icon: "library" }] as const;
const pageTitles: Record<nav.Page, string> = { home: "首页", search: "搜索", library: "音乐库", liked: "喜欢的音乐", history: "最近播放", collection: "", playlist: "歌单", downloads: "下载", stats: "聆听统计", settings: "设置", browse: "探索", together: "一起听", account: "账号" };
function NavItem(props: { page: nav.Page; label: string; icon: string; count?: number }) {
  return <Press testID={`nav-${props.page}`} label={props.label} selected={nav.page() === props.page} onPress={() => nav.navigate(props.page, true)} style={{ minHeight: 48, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 28 }}><Icon name={props.icon} size={22} color={nav.page() === props.page ? c().accent : c().sub} /><Label weight={nav.page() === props.page ? "600" : "400"} size={14} style={{ flex: 1 }}>{props.label}</Label><If when={props.count}><Label size={11} color={c().sub}>{props.count}</Label></If></Press>;
}
function Sidebar() {
  return <View testID="desktop-sidebar" style={{ width: 216, backgroundColor: c().panel, paddingHorizontal: 16, paddingTop: 28, paddingBottom: 16, borderRightWidth: 1, borderColor: c().line, gap: 20 }}>
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingHorizontal: 8, paddingBottom: 8 }}><Image src={logo} style={{ width: 38, height: 38, borderRadius: 12 }} /><View style={{ gap: 3 }}><Label size={22} weight="700">Metrolist</Label><Label size={10} color={c().faint}>NSH · 0.4</Label></View></View>
    <View style={{ gap: 5 }}><Each of={primary}>{item => <NavItem page={item().page} label={item().label} icon={item().icon} />}</Each></View>
    <View style={{ height: 1, backgroundColor: c().line, marginHorizontal: 12 }} />
    <View style={{ gap: 3 }}><NavItem page="liked" label="喜欢的音乐" icon="heart" count={s.likedIds().length} /><NavItem page="downloads" label="下载" icon="download" count={s.downloading().length} /><NavItem page="history" label="最近播放" icon="clock" /><NavItem page="stats" label="聆听统计" icon="stats" /><NavItem page="together" label="一起听" icon="users" /></View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}><Label size={12} color={c().sub} style={{ flex: 1 }}>我的歌单</Label><Tool testID="create-playlist" icon="plus" label="新建歌单" onPress={nav.newPlaylist} /></View>
    <Scroll style={{ flex: 1 }} scrollbar={false} contentStyle={{ gap: 4 }}><Each of={s.playlists()}>{playlist => <Press label={playlist().name} selected={nav.page() === "playlist" && nav.selectedPlaylist() === playlist().id} onPress={() => nav.openPlaylist(playlist().id)} style={{ flexDirection: "row", alignItems: "center", minHeight: 42, gap: 12, paddingHorizontal: 14, borderRadius: 12 }}><Icon name="queue" size={18} color={c().sub} /><Label size={13} lines={1} style={{ flex: 1 }}>{playlist().name}</Label></Press>}</Each></Scroll>
    <Pill label="导入音乐" icon="upload" onPress={nav.showImport} /><NavItem page="account" label={account.currentAccount()?.name || "登录账号"} icon="artist" /><NavItem page="settings" label="设置" icon="settings" />
  </View>;
}
function BottomNav() {
  const selected = (page: nav.Page) => nav.stack.routes()[0].page === page;
  return <View testID="mobile-tabs" style={{ flexShrink: 0, backgroundColor: c().panel, borderTopWidth: 1, borderColor: c().line, paddingTop: 8, paddingBottom: "calc(env(safe-area-inset-bottom) + 6px)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
    <Tabs style={{ flexDirection: "row", minHeight: 60 }} indicatorStyle={{ top: 0, height: 32, marginHorizontal: 20, borderRadius: 24, backgroundColor: c().selected }}>
      <Each of={primary}>{item => <Tab testID={`nav-mobile-${item().page}`} accessibilityLabel={item().label} selected={selected(item().page)} onPress={() => nav.navigate(item().page, true)} style={{ flex: 1, minWidth: 0, minHeight: 60, alignItems: "center", gap: 5, borderRadius: 24, ...transition("colors,opacity") }} activeStyle={{ opacity: 0.7 }}>
        <View style={{ height: 32, justifyContent: "center" }}><Icon name={item().icon} size={24} color={selected(item().page) ? c().accent : c().sub} /></View><Label size={12} weight={selected(item().page) ? "600" : "400"} color={selected(item().page) ? c().accent : c().sub}>{item().label}</Label>
      </Tab>}</Each>
    </Tabs>
  </View>;
}
function HeaderActions() {
  return <View style={{ flexDirection: "row", flexShrink: 0, alignItems: "center", gap: 2 }}><If when={!narrow()}><Tool testID="header-together" icon="users" label="一起听" active={!!together.room()} onPress={() => nav.navigate("together")} /></If><If when={!narrow() && (nav.page() === "home" || nav.page() === "library")}><Tool testID="header-history" icon="clock" label="最近播放" onPress={() => nav.navigate("history")} /><Tool testID="header-stats" icon="stats" label="聆听统计" onPress={() => nav.navigate("stats")} /></If><Tool testID="header-settings" icon="settings" label="设置" onPress={() => nav.navigate("settings")} /><Press testID="header-account" label={account.currentAccount()?.name || "登录 YouTube Music"} onPress={() => nav.navigate("account")} style={{ width: 48, height: 48, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 24 }}><Art src={account.currentAccount()?.avatar} size={32} radius={24} icon="artist" /></Press><If when={spacious() && p.currentTrack()}><Tool icon="queue" label={sidePlayer() ? "收起侧边播放器" : "展开侧边播放器"} active={sidePlayer()} onPress={() => sidePlayer.update(value => !value)} /></If></View>;
}
function Header(props: { route: nav.Route }) {
  return <View style={{ flexDirection: "row", gap: 8, alignItems: "center", height: narrow() ? 76 : 88, flexShrink: 0, paddingHorizontal: narrow() ? 16 : 30 }}><If when={nav.stack.routes().length > 1}><Tool icon="left" label="返回" testID="navigate-back" onPress={nav.goBack} /></If><Label size={narrow() ? 28 : 30} weight="600" lines={1} style={{ flex: 1 }}>{props.route.page === "browse" ? nav.browseTitle() : pageTitles[props.route.page]}</Label><HeaderActions /></View>;
}
function Screen(props: { route: nav.Route }) {
  switch (props.route.page) {
    case "home": return <HomePage />;
    case "search": return <SearchPage />;
    case "library": return <LibraryPage />;
    case "liked": case "history": case "playlist": return <SongCollectionPage kind={props.route.page} />;
    case "collection": return <CollectionPage />;
    case "browse": return <ExplorePage />;
    case "downloads": return <DownloadsPage />;
    case "stats": return <StatisticsPage />;
    case "settings": return <SettingsPage />;
    case "together": return <TogetherPage />;
    case "account": return <AccountPage />;
  }
}
function SidePlayer() {
  return <View style={{ width: 280, backgroundColor: c().panel, borderLeftWidth: 1, borderColor: c().line, padding: 20, paddingTop: 28, gap: 20 }}><View style={{ flexDirection: "row", alignItems: "center" }}><Label size={16} weight="600" style={{ flex: 1 }}>正在播放</Label><Tool icon="expand" label="打开播放器" onPress={() => nav.showPlayer()} /></View><Press label="打开封面" onPress={() => nav.showPlayer()}><Art track={p.currentTrack()} size={240} radius={16} /></Press><View style={{ gap: 8 }}><Label size={20} weight="600" lines={2}>{p.currentTrack()?.title}</Label><Label color={c().sub} size={14}>{p.currentTrack()?.artist}</Label></View><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Label size={13} color={c().sub}>接下来</Label><Tool icon="queue" label="完整队列" onPress={() => nav.showPlayer("queue")} /></View><Scroll style={{ flex: 1 }} scrollbar={false}><Each of={p.queue().slice(p.currentIndex() + 1, p.currentIndex() + 9)}>{(track, index) => <TrackRow compact track={track()} onPlay={() => action(() => p.playAt(p.currentIndex() + index() + 1))} />}</Each><If when={p.currentIndex() >= p.queue().length - 1}><Label size={12} color={c().faint}>{s.settings().autoRadio ? "播放结束后继续电台推荐" : "已到队列末尾"}</Label></If></Scroll><Pill label="歌词" icon="lyrics" onPress={() => nav.showPlayer("lyrics")} /></View>;
}
function App() {
  if (platform.os === "web") void host.call("app.start").catch(s.showError);
  account.setAccountHooks({ onChange: () => { void s.loadHome(); } });
  void s.initialize().then(() => account.initializeAccounts()).catch(s.showError);
  void together.initializeTogether().catch(s.showError);
  keymap.bind({ "space": () => { if (!p.remoteControlled()) void action(p.togglePlay); }, "mod+k": () => nav.navigate("search", true), "mod+right": () => { if (!p.remoteControlled()) void action(p.next); }, "mod+left": () => { if (!p.remoteControlled()) void action(p.previous); } });
  return <View testID="metrolist-app" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: c().bg, paddingBottom: narrow() ? 0 : "env(safe-area-inset-bottom)" }}>
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}><If when={!narrow()}><Sidebar /></If><View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <NavStack state={nav.stack} testID="main-navigation" style={{ flex: 1, minWidth: 0, minHeight: 0 }} onChange={({ routes }) => nav.onRoutesChanged(routes)}>{route => <NavPage title={route.page === "browse" ? nav.browseTitle() : pageTitles[route.page]} animation={reduceMotion() ? "none" : primary.some(item => item.page === route.page) ? "fade" : "slide"} headerVisible={systemHeader} headerRight={systemHeader ? <HeaderActions /> : undefined} headerStyle={{ backgroundColor: c().bg, color: c().text, tintColor: c().accent }} statusBar={{ foreground: s.settings().theme === "light" || s.settings().theme === "system" && colorScheme() === "light" ? "dark" : "light" }} style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: c().bg }}>
        <If when={!systemHeader}><Header route={route} /></If>
        <Scroll testID={`content-${route.page}`} style={{ flex: 1, minWidth: 0, minHeight: 0 }} contentStyle={{ paddingHorizontal: pageGutter(), paddingTop: 4, paddingBottom: 32 }} keyboardShouldPersistTaps="handled"><View style={{ width: "100%", minWidth: 0, maxWidth: 1440, alignSelf: "center", gap: 16 }}>
          <If when={s.error()}><View testID="app-error" style={{ flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: c().selected, borderRadius: 16, gap: 12 }}><Label size={12} color={c().accent} style={{ flex: 1 }} lines={3}>{s.error()}</Label><Tool icon="close" label="关闭提示" onPress={s.clearError} /></View></If>
          <Screen route={route} />
        </View></Scroll>
      </NavPage>}</NavStack>
    </View><If when={spacious() && sidePlayer() && p.currentTrack() && nav.page() !== "settings"}><SidePlayer /></If></View>
    <MiniPlayer /><If when={narrow()}><BottomNav /></If>
    <FullPlayer /><Dialogs /><CloudDialogs />
    <ToastHost />
  </View>;
}
mount(App);
