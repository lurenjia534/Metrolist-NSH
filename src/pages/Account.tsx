import { View, Scroll, signal, openUrl, platform } from "nsh";
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger, Input } from "nsh/base";
import * as a from "../account";
import * as nav from "../navigation";
import * as player from "../playback";
import * as cloud from "../cloudActions";
import { isTrack, type CatalogItem, type Collection } from "../model";
import { Label, Pill, Chip, Tool, Field, Art, Section, SectionTitle, CommandMenu, Empty, Modal, Toggle, Press, palette as c, narrow, action, say, type CommandItem } from "../ui";
import { Icon } from "../icons";

const musicUrl = "https://music.youtube.com";
const androidReleasesUrl = "https://github.com/lurenjia534/Metrolist-NSH/releases";
const libraryTypes: { type: a.CloudType; title: string; icon: string }[] = [
  { type: "playlists", title: "歌单", icon: "queue" }, { type: "liked", title: "喜欢的歌曲", icon: "heart" },
  { type: "songs", title: "歌曲", icon: "music" }, { type: "albums", title: "专辑", icon: "album" },
  { type: "artists", title: "已订阅歌手", icon: "artist" },
];
const sessionLabels = { none: "尚未登录", saved: "正在恢复账号连接", verifying: "正在检查账号连接…", connected: "已连接 YouTube Music", error: "账号连接需要更新" };
type AccountDialog = "import" | "add" | "create" | "rename" | "delete" | "logout" | null;

function LoginOptions(props: { login: () => Promise<unknown>; adding?: boolean }) {
  const loginLabel = () => !a.nativeLoginReady() ? "正在准备登录…" : a.busy() ? a.nativeLoginStage() === "verifying" ? "正在连接账号…" : "正在登录…" : props.adding ? "登录另一个 Google 账号" : "使用 Google 账号登录";
  return <If when={a.nativeLoginAvailable() || !a.nativeLoginReady()} else={
    <View testID="account-platform-login" style={{ gap: 14 }}>
      <View style={{ gap: 8, padding: 16, backgroundColor: c().selected, borderRadius: 16 }}>
        <Label size={15} weight="600">在 Android 版中直接登录</Label>
        <Label size={13} color={c().sub} style={{ lineHeight: 21 }}>{platform.os === "web" ? "网页版和 YouTube Music 是独立的网站。在 Google 页面登录，不会自动连接这个网页；Android 版可以在应用内完成登录并自动返回。" : "当前平台尚未提供应用内 Google 登录。Android 版可以直接登录；这个版本仍可使用下方的高级连接导入已有账号。"}</Label>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Pill testID="account-get-android" label="获取 Android 版" icon="download" primary onPress={() => void action(() => openUrl(androidReleasesUrl))} />
        <Pill testID="account-open-youtube" label="打开 YouTube Music" icon="link" onPress={() => void action(() => openUrl(musicUrl))} />
      </View>
    </View>
  }>
    <View style={{ gap: 12 }}>
      <Pill testID="account-native-login" label={loginLabel()} icon="artist" primary disabled={a.busy() || !a.nativeLoginReady()} onPress={() => void action(props.login)} />
      <Label size={13} color={c().sub} style={{ lineHeight: 21 }}>在 Google 页面完成验证后会自动返回。应用只读取 YouTube Music 登录会话。</Label>
    </View>
  </If>;
}

function AdvancedConnection(props: { onImport: () => void; prefix?: string }) {
  const expanded = signal<string[]>([]);
  const prefix = () => props.prefix || "account";
  return <Accordion value={expanded()} onChange={({ value }) => expanded.set(value)}>
    <AccordionItem value="connection" style={{ borderRadius: 18, borderWidth: 1, borderColor: c().line, overflow: "hidden" }}>
      <AccordionHeader><AccordionTrigger testID={`${prefix()}-advanced`} accessibilityLabel="高级连接" style={{ minHeight: 56, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 }} hoverStyle={{ backgroundColor: c().hover }}>
        <Icon name="settings" size={20} color={c().sub} /><View style={{ flex: 1, minWidth: 0, gap: 4 }}><Label size={14} weight="600">高级连接</Label><Label size={11} color={c().sub}>使用已有会话连接这台设备</Label></View><Icon name={expanded().length ? "up" : "down"} size={18} color={c().sub} />
      </AccordionTrigger></AccordionHeader>
      <AccordionPanel reveal accessibilityLabel="高级连接方式"><View style={{ padding: 16, paddingTop: 4, gap: 12 }}>
        <Label size={13} color={c().sub} style={{ lineHeight: 21 }}>已有 YouTube Music 会话文件或原版 Metrolist 登录文本时，可以导入并验证账号。连接后即可使用此设备上的云端音乐库。</Label>
        <Pill testID={`${prefix()}-import`} label="导入已有会话" icon="upload" disabled={a.busy()} onPress={props.onImport} />
      </View></AccordionPanel>
    </AccordionItem>
  </Accordion>;
}

function NativeLoginProgress() {
  const title = () => ({ idle: "", opening: "正在打开 Google 登录", waiting: "等待 Google 登录完成", verifying: "正在连接 YouTube Music", error: "需要继续完成登录" }[a.nativeLoginStage()]);
  return <If when={a.busy() && a.nativeLoginStage() !== "idle"}><View testID="account-login-progress" style={{ borderRadius: 18, padding: 16, backgroundColor: c().selected, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
    <Icon name={a.nativeLoginStage() === "error" ? "info" : "clock"} size={22} color={c().accent} />
    <View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label testID="account-login-stage" size={14} weight="600">{title()}</Label><Label size={13} color={c().sub} style={{ lineHeight: 21 }}>{a.nativeLoginMessage() || "连接完成后会自动返回这里。"}</Label></View>
  </View></If>;
}

export function AccountPage() {
  const dialog = signal<AccountDialog>(null);
  const sessionText = signal("");
  const showSession = signal(false);
  const showImportGuide = signal(false);
  const showChannels = signal(false);
  const title = signal("");
  const description = signal("");
  const privacy = signal("PRIVATE");
  const selectedPlaylist = signal<a.CloudPlaylist | undefined>();
  const logoutId = signal("");
  const visibleCount = signal(30);
  const close = () => { dialog.set(null); sessionText.set(""); showSession.set(false); showImportGuide.set(false); };
  const openImport = () => { a.clearAccountError(); dialog.set("import"); };
  const importText = async () => { await a.importSession(sessionText()); close(); };
  const importFile = async () => { const profile = await a.importSessionFile(); if (profile) close(); };
  const login = async () => { close(); await a.loginNative(); };
  const openLibrary = () => { cloud.libraryScope.set("cloud"); nav.navigate("library"); if (!a.syncing()) void action(() => a.loadCloudLibrary()); };
  const chooseType = (type: a.CloudType) => { visibleCount.set(30); void action(() => a.loadCloudLibrary(type)); };
  const create = () => { title.set(""); description.set(""); privacy.set("PRIVATE"); dialog.set("create"); };
  const playlistId = (item: a.CloudPlaylist) => item.playlistId || item.browseId.replace(/^VL/, "");
  const edit = (item: a.CloudPlaylist) => { selectedPlaylist.set(item); title.set(item.title); dialog.set("rename"); };
  const remove = (item: a.CloudPlaylist) => { selectedPlaylist.set(item); dialog.set("delete"); };
  const logout = (id = a.activeId()) => { logoutId.set(id); dialog.set("logout"); };
  const openItem = (item: CatalogItem) => isTrack(item) ? void action(() => player.playTrack(item)) : nav.browse(item);
  const menu = (item: CatalogItem): CommandItem[] => {
    const entries: CommandItem[] = [{ label: isTrack(item) ? "立即播放" : "打开详情", icon: isTrack(item) ? "play" : "right", run: () => openItem(item) }];
    if (isTrack(item)) {
      entries.push({ label: a.isCloudLiked(item.id) ? "从云端喜欢中移除" : "在 YouTube Music 喜欢", icon: "heart", active: a.isCloudLiked(item.id), disabled: !!a.mutation(), run: () => void action(() => a.setLike(item.id, !a.isCloudLiked(item.id))) });
      if (a.cloudType() === "songs") entries.push({ label: "从云端音乐库移除", icon: "bookmark", disabled: !!a.mutation(), run: () => void action(() => a.setSavedSong(item.id, false)) });
    } else if (item.type === "artist") entries.push({ label: "取消 YouTube Music 订阅", icon: "artist", disabled: !!a.mutation(), run: () => void action(() => a.setSubscription(item.browseId, false, item.params)) });
    else if (item.type === "playlist") {
      const playlist = item as a.CloudPlaylist;
      if (playlist.editable) entries.push({ label: "重命名云端歌单", icon: "edit", run: () => edit(playlist) }, { label: "删除云端歌单", icon: "trash", danger: true, run: () => remove(playlist) });
      else entries.push({ label: "取消收藏云端歌单", icon: "bookmark", disabled: !!a.mutation(), run: () => void action(() => a.setLike(playlistId(playlist), false, "playlist")) });
    }
    return entries;
  };
  return <View testID="page-account" style={{ gap: 22, minWidth: 0 }}>
    <If when={a.currentAccount()} else={<View testID="account-welcome" style={{ backgroundColor: c().card, borderRadius: 28, padding: narrow() ? 20 : 32, gap: 20, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: c().selected, alignItems: "center", justifyContent: "center" }}><Icon name="artist" size={26} color={c().accent} /></View><Label size={12} weight="600" color={c().accent}>YouTube Music</Label></View>
      <View style={{ gap: 10 }}><Label size={narrow() ? 26 : 32} weight="600">让音乐库跟着你</Label><Label size={14} color={c().sub} style={{ maxWidth: 620, lineHeight: 23 }}>登录后，喜欢的歌曲、歌单和订阅会出现在你的音乐库中。</Label></View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}><Each of={[{ icon: "heart", label: "喜欢" }, { icon: "queue", label: "歌单" }, { icon: "artist", label: "订阅" }]}>{item => <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name={item().icon} size={16} color={c().accent} /><Label size={12} color={c().sub}>{item().label}</Label></View>}</Each></View>
      <LoginOptions login={login} />
      <Press testID="account-listen-first" label="先听音乐" onPress={() => nav.goBack()} style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}><Label size={13} color={c().sub}>先听音乐</Label></Press>
    </View>}>
      {account => <View style={{ backgroundColor: c().card, borderRadius: 28, padding: narrow() ? 20 : 32, gap: 18, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}><Art src={account().avatar} size={narrow() ? 64 : 80} radius={44} icon="artist" /><View style={{ flex: 1, minWidth: 0, gap: 7 }}><Label testID="account-name" size={narrow() ? 23 : 30} weight="600" lines={2}>{account().name}</Label><If when={account().channelHandle}><Label color={c().accent} size={13} lines={1}>{account().channelHandle}</Label></If><If when={account().email}><Label size={12} color={c().sub} lines={1}>{account().email}</Label></If></View></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9, minWidth: 0 }}><View style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: a.sessionStatus() === "connected" ? c().good : a.sessionStatus() === "error" ? c().danger : c().accent }} /><Label testID="account-connection-state" size={12} color={a.sessionStatus() === "error" ? c().danger : c().sub} style={{ flex: 1 }}>{sessionLabels[a.sessionStatus()]}</Label><Tool testID="account-refresh" icon="refresh" label="检查账号连接" disabled={a.busy() || a.sessionStatus() === "verifying"} onPress={() => void action(a.refreshAccount)} /></View>
        <If when={a.sessionStatus() === "error"}><Pill testID="account-reconnect" label={a.nativeLoginAvailable() ? "重新登录 Google" : "更新账号连接"} icon="artist" disabled={a.busy()} onPress={() => a.nativeLoginAvailable() ? void action(login) : dialog.set("add")} /></If>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}><Pill testID="account-open-library" primary label="打开音乐库" icon="library" onPress={openLibrary} /><Pill testID="account-sync" label={a.syncing() ? "同步中…" : "同步"} icon="refresh" disabled={a.syncing() || a.busy()} onPress={() => void action(a.syncLibrary)} /></View>
        <View style={{ height: 1, backgroundColor: c().line }} />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Pill label="切换频道" icon="users" disabled={a.busy()} onPress={() => { showChannels.set(true); void action(a.loadChannels); }} /><Pill testID="account-add" label="添加账号" icon="plus" disabled={a.busy()} onPress={() => dialog.set("add")} /><Pill label="退出此账号" disabled={a.busy()} onPress={() => logout()} /></View>
      </View>}
    </If>

    <NativeLoginProgress />
    <If when={a.error()}><View testID="account-error" style={{ backgroundColor: c().card, borderRadius: 16, padding: 16, gap: 12, flexDirection: "row", alignItems: "center" }}><Label size={14} color={c().danger} style={{ flex: 1, minWidth: 0, lineHeight: 22 }}>{a.error()}</Label><Tool icon="close" label="关闭账号提示" onPress={a.clearAccountError} /></View></If>
    <If when={(a.status() || a.syncProgress()) && !(a.busy() && a.nativeLoginStage() !== "idle")}><Label testID="account-status" size={13} color={c().sub}>{a.syncing() ? `正在同步 · ${a.syncProgress()}` : a.status()}</Label></If>

    <If when={!a.signedIn()}><AdvancedConnection onImport={openImport} /></If>

    <If when={a.signedIn()}>
      <If when={showChannels()}><Section title="YouTube 账号与频道"><View style={{ flexDirection: "row", alignItems: "center" }}><Label size={13} color={c().sub} style={{ flex: 1 }}>切换同一 Google 会话中的账号或品牌频道。</Label><Tool icon="close" label="关闭频道列表" onPress={() => showChannels.set(false)} /></View><If when={a.busy()}><Label size={13} color={c().sub}>正在读取频道…</Label></If><Each of={a.channels()}>{channel => <Press label={`切换到 ${channel().name}`} disabled={a.busy()} selected={channel().selected} onPress={() => void action(async () => { await a.selectChannel(channel()); showChannels.set(false); })} style={{ flexDirection: "row", gap: 16, padding: 12, alignItems: "center" }}><Art src={channel().avatar} size={48} radius={24} icon="artist" /><View style={{ flex: 1, minWidth: 0, gap: 5 }}><Label weight="600">{channel().name}</Label><Label size={12} color={c().sub}>{channel().channelHandle || channel().email || `账号 ${Number(channel().authUser) + 1}`}</Label></View><If when={channel().selected}><Icon name="check" color={c().accent} /></If></Press>}</Each><If when={!a.busy() && a.channels().length === 0}><Label size={13} color={c().sub}>没有读取到可切换频道，可重新验证当前会话后再试。</Label></If></Section></If>

      <Section title="账号偏好"><Toggle testID="account-use-browse" label="使用账号浏览音乐" description="首页推荐与音乐目录使用当前 YouTube Music 账号。" value={a.useAccountForBrowse()} onChange={a.setUseAccountForBrowse} /><Toggle testID="account-auto-sync" label="登录后同步音乐库" description="登录后读取云端歌单、收藏和订阅，按账号保存在此设备。" value={a.syncEnabled()} onChange={a.setSyncEnabled} /><Label size={12} color={c().faint}>{a.lastSynced() ? `上次完整同步：${new Date(a.lastSynced()).toLocaleString()}` : "尚未完成一次完整音乐库同步"}</Label></Section>

      <View style={{ gap: 16 }}><SectionTitle title="YouTube Music 音乐库" subtitle="当前账号的云端内容" action="新建云端歌单" icon="plus" onPress={create} disabled={!!a.mutation()} /><Scroll horizontal scrollbar={false} style={{ flexShrink: 0 }} contentStyle={{ gap: 10 }}><Each of={libraryTypes}>{item => <Chip label={`${item().title} · ${a.cloudLibrary()[item().type].length}`} icon={item().icon} selected={a.cloudType() === item().type} onPress={() => chooseType(item().type)} />}</Each></Scroll>
        <If when={a.cloudLoading()}><Label color={c().sub} size={13}>正在读取云端{libraryTypes.find(item => item.type === a.cloudType())?.title}…</Label></If>
        <If when={a.cloudItems().length > 0} else={<Empty icon={libraryTypes.find(item => item.type === a.cloudType())?.icon || "library"} title={a.syncing() || a.cloudLoading() ? "正在加载音乐库" : "此分类暂时没有内容"} description={a.lastSynced() ? "在 YouTube Music 收藏内容，或在这里搜索歌曲并添加到云端音乐库。" : "点按同步音乐库，读取当前账号的收藏与歌单。"}><Pill label="刷新此分类" icon="refresh" disabled={a.cloudLoading()} onPress={() => void action(() => a.loadCloudLibrary())} /></Empty>}>
          <View style={{ gap: 4 }}><Each of={a.cloudItems().slice(0, visibleCount())}>{item => <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Press label={item().title} onPress={() => openItem(item())} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 14, padding: 10 }}><Art src={item().artwork} size={52} radius={(item() as Collection).type === "artist" ? 28 : 8} icon={(item() as Collection).type || "music"} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label weight="600" lines={1}>{item().title}</Label><Label size={12} color={c().sub} lines={1}>{isTrack(item()) ? (item() as a.CloudTrack).artist : (item() as Collection).subtitle}</Label></View></Press><CommandMenu label={`${item().title} 云端操作`} items={menu(item())} /></View>}</Each></View>
          <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}><If when={a.cloudItems().length > visibleCount()}><Pill label={`显示更多 · 已缓存 ${a.cloudItems().length} 项`} onPress={() => visibleCount.update(value => value + 30)} /></If><If when={a.cloudContinuation()}><Pill label={a.cloudLoading() ? "正在读取…" : "加载云端下一页"} disabled={a.cloudLoading()} onPress={() => void action(a.loadMoreCloudLibrary)} /></If></View>
        </If>
      </View>
    </If>

    <If when={a.accounts().length > 1 || !a.signedIn() && a.accounts().length > 0}><Section title="切换账号"><Each of={a.accounts()}>{account => <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><Press label={`使用 ${account().name}`} selected={account().id === a.activeId()} disabled={a.busy()} onPress={() => void action(() => a.activateAccount(account().id))} style={{ padding: 12, flex: 1, flexDirection: "row", gap: 14, alignItems: "center" }}><Art src={account().avatar} size={44} radius={24} icon="artist" /><View style={{ flex: 1, minWidth: 0, gap: 5 }}><Label lines={1}>{account().name}</Label><Label size={12} color={c().sub}>{account().id === a.activeId() ? "正在使用" : account().channelHandle || account().email || "已保存会话"}</Label></View><If when={account().id === a.activeId()}><Icon name="check" color={c().accent} /></If></Press><Tool icon="trash" label={`移除此设备上的 ${account().name}`} disabled={a.busy()} onPress={() => logout(account().id)} /></View>}</Each></Section></If>

    <If when={a.signedIn()}><AdvancedConnection onImport={openImport} /></If>

    <Modal open={dialog() === "add"} title="添加账号" close={close}>
      <Label size={14} color={c().sub} style={{ lineHeight: 22 }}>连接另一个 YouTube Music 账号后，可在此页面随时切换。</Label>
      <LoginOptions login={login} adding />
      <AdvancedConnection prefix="account-add" onImport={openImport} />
    </Modal>
    <Modal open={dialog() === "import"} title="连接已有会话" close={close}>
      <Label size={13} color={c().sub} style={{ lineHeight: 21 }}>选择自己的会话文件，或粘贴原版 Metrolist 登录文本。验证成功后，账号会连接到此设备。</Label>
      <Pill testID="account-import-file" label="选择会话文件" icon="upload" disabled={a.busy()} onPress={() => void action(importFile)} />
      <Input testID="account-session-input" accessibilityLabel="本人 YouTube Music 会话" value={sessionText()} onChange={({ value }) => sessionText.set(value)} placeholder="粘贴会话文本或 JSON" masked={!showSession()} multiline readonly={a.busy()} autoComplete="off" autoCapitalize="none" autoCorrect={false} style={{ minHeight: 96, maxHeight: 160, color: c().text, fontSize: 14, backgroundColor: c().card, borderWidth: 1, borderColor: c().line, borderRadius: 16, padding: 14, placeholderColor: c().faint, caretColor: c().accent }} />
      <Toggle testID="account-show-session" label="显示会话文本" value={showSession()} onChange={showSession.set} />
      <If when={a.error()}><Label testID="account-import-error" size={13} color={c().danger} style={{ lineHeight: 21 }}>{a.error()}</Label></If>
      <Pill testID="account-verify-import" label={a.busy() ? "正在验证账号…" : "验证并连接账号"} primary disabled={!sessionText().trim() || a.busy()} onPress={() => void action(importText)} />
      <Press testID="account-import-guide" label="查看会话导入说明" onPress={() => showImportGuide.update(value => !value)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 }}><Label size={13} color={c().accent} style={{ flex: 1 }}>{showImportGuide() ? "收起导入说明" : "支持哪些会话格式？"}</Label><Icon name={showImportGuide() ? "up" : "down"} size={18} color={c().accent} /></Press>
      <If when={showImportGuide()}><View style={{ gap: 12 }}>
        <Label size={13} color={c().sub} style={{ lineHeight: 21 }}>支持原版 Metrolist「账号 → 高级登录」文本、Netscape cookies.txt、浏览器导出的 Cookie JSON，以及含 cookie、visitorData、dataSyncId、authUser 字段的会话 JSON。</Label>
        <Label size={13} color={c().sub} style={{ lineHeight: 21 }}>电脑浏览器中登录 music.youtube.com，打开开发者工具的 Network（网络）面板并刷新页面。选择发给 music.youtube.com 的请求，复制 Request Headers 下的 Cookie 值，也可粘贴到上方。</Label>
        <Pill label="打开 YouTube Music" icon="link" onPress={() => void action(() => openUrl(musicUrl))} />
        <Label size={12} color={c().faint} style={{ lineHeight: 20 }}>这是已有登录会话的导入。请只使用自己的会话，并直接填在此应用中。</Label>
      </View></If>
    </Modal>
    <Modal open={dialog() === "create" || dialog() === "rename"} title={dialog() === "create" ? "新建云端歌单" : "重命名云端歌单"} close={close}><Field testID="account-playlist-title" value={title()} onChange={title.set} placeholder="歌单名称" autoFocus /><If when={dialog() === "create"}><Field value={description()} onChange={description.set} placeholder="歌单简介（可选）" multiline /><Label size={13} color={c().sub}>可见性</Label><View style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}><Each of={[{ id: "PRIVATE", title: "私享" }, { id: "UNLISTED", title: "不公开" }, { id: "PUBLIC", title: "公开" }]}>{option => <Chip label={option().title} selected={privacy() === option().id} onPress={() => privacy.set(option().id)} />}</Each></View></If><Pill primary label={a.mutation() ? "正在保存…" : "保存到 YouTube Music"} disabled={!title().trim() || !!a.mutation()} onPress={() => void action(async () => { if (dialog() === "create") await a.createCloudPlaylist(title().trim(), privacy(), description().trim()); else await a.renameCloudPlaylist(playlistId(selectedPlaylist()!), title().trim()); close(); say("云端歌单已保存"); })} /></Modal>
    <Modal open={dialog() === "delete"} title="删除云端歌单" close={close}><Label color={c().sub} style={{ lineHeight: 23 }}>从 YouTube Music 账号中删除「{selectedPlaylist()?.title}」。这会同步到使用同一账号的设备。</Label><Pill label="删除此云端歌单" danger icon="trash" disabled={!!a.mutation()} onPress={() => void action(async () => { await a.deleteCloudPlaylist(playlistId(selectedPlaylist()!)); close(); say("云端歌单已删除"); })} /></Modal>
    <Modal open={dialog() === "logout"} title="从此应用退出账号" close={close}><Label color={c().sub} style={{ lineHeight: 23 }}>移除此设备保存的「{a.accounts().find(item => item.id === logoutId())?.name}」会话与云端缓存，本地音乐库保留。YouTube Music 账号及其云端内容仍然保留。</Label><Pill label="退出并移除本机会话" icon="artist" onPress={() => void action(async () => { await a.logoutAccount(logoutId()); close(); })} /></Modal>
  </View>;
}
