import { View, Scroll, signal, openUrl, platform } from "nsh";
import { Input } from "nsh/base";
import * as a from "../account";
import * as nav from "../navigation";
import * as player from "../playback";
import { isTrack, type CatalogItem, type Collection } from "../model";
import { Label, Pill, Chip, Tool, Field, Art, Section, SectionTitle, CommandMenu, Empty, Modal, Toggle, Press, palette as c, narrow, action, say, type CommandItem } from "../ui";
import { Icon } from "../icons";

const musicUrl = "https://music.youtube.com";
const libraryTypes: { type: a.CloudType; title: string; icon: string }[] = [
  { type: "playlists", title: "歌单", icon: "queue" }, { type: "liked", title: "喜欢的歌曲", icon: "heart" },
  { type: "songs", title: "歌曲", icon: "music" }, { type: "albums", title: "专辑", icon: "album" },
  { type: "artists", title: "已订阅歌手", icon: "artist" },
];
const sessionLabels = { none: "尚未登录", saved: "本机已保存会话", verifying: "正在验证会话…", connected: "已连接 YouTube Music", error: "会话需要重新验证" };
type AccountDialog = "import" | "add" | "create" | "rename" | "delete" | "logout" | null;

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
  const close = () => { dialog.set(null); sessionText.set(""); showSession.set(false); };
  const importText = async () => { await a.importSession(sessionText()); close(); };
  const importFile = async () => { const profile = await a.importSessionFile(); if (profile) close(); };
  const login = async () => { await a.loginNative(); close(); };
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
  return <View testID="page-account" style={{ gap: 28 }}>
    <If when={a.currentAccount()} else={<View style={{ backgroundColor: c().card, borderRadius: 28, padding: narrow() ? 24 : 36, gap: 24 }}>
      <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: c().selected, alignItems: "center", justifyContent: "center" }}><Icon name="artist" size={36} color={c().accent} /></View>
      <View style={{ gap: 12 }}><Label size={28} weight="600">让音乐库跟着你</Label><Label size={15} color={c().sub} style={{ maxWidth: 620, lineHeight: 24 }}>连接你的 YouTube Music 账号，访问喜欢的歌曲、订阅的歌手和云端歌单。登录后的收藏和歌单操作会同步到同一账号。</Label></View>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <If when={a.nativeLoginAvailable()}><Pill testID="account-native-login" label={a.busy() ? "正在登录…" : "使用 Google 账号登录"} icon="artist" primary disabled={a.busy()} onPress={() => void action(login)} /></If>
        <Pill testID="account-import" label="导入本人会话" primary={!a.nativeLoginAvailable()} icon="upload" disabled={a.busy()} onPress={() => dialog.set("import")} />
        <Pill label="打开 YouTube Music" icon="link" onPress={() => void action(() => openUrl(musicUrl))} />
      </View>
      <Label size={12} color={c().faint} style={{ lineHeight: 19 }}>{a.nativeLoginAvailable() ? "在应用内打开 Google 页面，完成登录后点击「完成」。账号信息会由 YouTube Music 实际验证。" : "此平台通过导入你本人已登录的 YouTube Music 会话连接账号；这属于会话登录，不是 OAuth 授权。"}</Label>
    </View>}>
      {account => <View style={{ backgroundColor: c().card, borderRadius: 28, padding: narrow() ? 24 : 32, gap: 22 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}><Art src={account().avatar} size={narrow() ? 72 : 88} radius={48} icon="artist" /><View style={{ flex: 1, minWidth: 0, gap: 8 }}><Label testID="account-name" size={narrow() ? 24 : 30} weight="600" lines={2}>{account().name}</Label><If when={account().channelHandle}><Label color={c().accent} size={14}>{account().channelHandle}</Label></If><If when={account().email}><Label size={13} color={c().sub} lines={1}>{account().email}</Label></If></View><Tool icon="refresh" label="验证当前会话" disabled={a.sessionStatus() === "verifying"} onPress={() => void action(a.refreshAccount)} /></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}><View style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: a.sessionStatus() === "connected" ? c().good : c().faint }} /><Label size={13} color={a.sessionStatus() === "error" ? c().danger : c().sub}>{sessionLabels[a.sessionStatus()]}</Label></View>
        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}><Pill testID="account-sync" primary label={a.syncing() ? "正在同步音乐库…" : "同步云端音乐库"} icon="refresh" disabled={a.syncing() || a.busy()} onPress={() => void action(a.syncLibrary)} /><Pill label="切换频道" icon="users" disabled={a.busy()} onPress={() => { showChannels.set(true); void action(a.loadChannels); }} /><Pill label="添加账号" icon="plus" disabled={a.busy()} onPress={() => dialog.set("add")} /><Pill label="退出此账号" onPress={() => logout()} /></View>
      </View>}
    </If>

    <If when={a.error()}><View testID="account-error" style={{ backgroundColor: c().card, borderRadius: 16, padding: 16, gap: 12, flexDirection: "row", alignItems: "center" }}><Label size={14} color={c().danger} style={{ flex: 1, minWidth: 0, lineHeight: 22 }}>{a.error()}</Label><Tool icon="close" label="关闭账号提示" onPress={a.clearAccountError} /></View></If>
    <If when={a.status() || a.syncProgress()}><Label testID="account-status" size={13} color={c().sub}>{a.syncing() ? `正在同步 · ${a.syncProgress()}` : a.status()}</Label></If>

    <If when={a.signedIn()}>
      <If when={showChannels()}><Section title="YouTube 账号与频道"><View style={{ flexDirection: "row", alignItems: "center" }}><Label size={13} color={c().sub} style={{ flex: 1 }}>切换同一 Google 会话中的账号或品牌频道。</Label><Tool icon="close" label="关闭频道列表" onPress={() => showChannels.set(false)} /></View><If when={a.busy()}><Label size={13} color={c().sub}>正在读取频道…</Label></If><Each of={a.channels()}>{channel => <Press label={`切换到 ${channel().name}`} disabled={a.busy()} selected={channel().selected} onPress={() => void action(async () => { await a.selectChannel(channel()); showChannels.set(false); })} style={{ flexDirection: "row", gap: 16, padding: 12, alignItems: "center" }}><Art src={channel().avatar} size={48} radius={24} icon="artist" /><View style={{ flex: 1, minWidth: 0, gap: 5 }}><Label weight="600">{channel().name}</Label><Label size={12} color={c().sub}>{channel().channelHandle || channel().email || `账号 ${Number(channel().authUser) + 1}`}</Label></View><If when={channel().selected}><Icon name="check" color={c().accent} /></If></Press>}</Each><If when={!a.busy() && a.channels().length === 0}><Label size={13} color={c().sub}>没有读取到可切换频道，可重新验证当前会话后再试。</Label></If></Section></If>

      <Section title="账号偏好"><Toggle testID="account-use-browse" label="使用账号浏览音乐" description="首页与音乐目录携带当前会话，使用该账号的推荐与访问权限。" value={a.useAccountForBrowse()} onChange={a.setUseAccountForBrowse} /><Toggle testID="account-auto-sync" label="登录后同步音乐库" description="将云端收藏、歌单和订阅缓存在此设备，按账号分别保存。" value={a.syncEnabled()} onChange={a.setSyncEnabled} /><Label size={12} color={c().faint}>{a.lastSynced() ? `上次完整同步：${new Date(a.lastSynced()).toLocaleString()}` : "尚未完成一次完整音乐库同步"}</Label></Section>

      <View style={{ gap: 16 }}><SectionTitle title="YouTube Music 音乐库" subtitle="当前账号的云端内容" action="新建云端歌单" icon="plus" onPress={create} disabled={!!a.mutation()} /><Scroll horizontal scrollbar={false} style={{ flexShrink: 0 }} contentStyle={{ gap: 10 }}><Each of={libraryTypes}>{item => <Chip label={`${item().title} · ${a.cloudLibrary()[item().type].length}`} icon={item().icon} selected={a.cloudType() === item().type} onPress={() => chooseType(item().type)} />}</Each></Scroll>
        <If when={a.cloudLoading()}><Label color={c().sub} size={13}>正在读取云端{libraryTypes.find(item => item.type === a.cloudType())?.title}…</Label></If>
        <If when={a.cloudItems().length > 0} else={<Empty icon={libraryTypes.find(item => item.type === a.cloudType())?.icon || "library"} title={a.syncing() || a.cloudLoading() ? "正在加载音乐库" : "此分类暂时没有内容"} description={a.lastSynced() ? "在 YouTube Music 收藏内容，或在这里搜索歌曲并添加到云端音乐库。" : "点按同步音乐库，读取当前账号的收藏与歌单。"}><Pill label="刷新此分类" icon="refresh" disabled={a.cloudLoading()} onPress={() => void action(() => a.loadCloudLibrary())} /></Empty>}>
          <View style={{ gap: 4 }}><Each of={a.cloudItems().slice(0, visibleCount())}>{item => <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Press label={item().title} onPress={() => openItem(item())} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 14, padding: 10 }}><Art src={item().artwork} size={52} radius={(item() as Collection).type === "artist" ? 28 : 8} icon={(item() as Collection).type || "music"} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label weight="600" lines={1}>{item().title}</Label><Label size={12} color={c().sub} lines={1}>{isTrack(item()) ? (item() as a.CloudTrack).artist : (item() as Collection).subtitle}</Label></View></Press><CommandMenu label={`${item().title} 云端操作`} items={menu(item())} /></View>}</Each></View>
          <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}><If when={a.cloudItems().length > visibleCount()}><Pill label={`显示更多 · 已缓存 ${a.cloudItems().length} 项`} onPress={() => visibleCount.update(value => value + 30)} /></If><If when={a.cloudContinuation()}><Pill label={a.cloudLoading() ? "正在读取…" : "加载云端下一页"} disabled={a.cloudLoading()} onPress={() => void action(a.loadMoreCloudLibrary)} /></If></View>
        </If>
      </View>
    </If>

    <If when={a.accounts().length > 0}><Section title="此设备上的账号"><Each of={a.accounts()}>{account => <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><Press label={`使用 ${account().name}`} selected={account().id === a.activeId()} disabled={a.busy()} onPress={() => void action(() => a.activateAccount(account().id))} style={{ padding: 12, flex: 1, flexDirection: "row", gap: 14, alignItems: "center" }}><Art src={account().avatar} size={44} radius={24} icon="artist" /><View style={{ flex: 1, minWidth: 0, gap: 5 }}><Label lines={1}>{account().name}</Label><Label size={12} color={c().sub}>{account().id === a.activeId() ? "正在使用" : account().channelHandle || account().email || "已保存会话"}</Label></View><If when={account().id === a.activeId()}><Icon name="check" color={c().accent} /></If></Press><Tool icon="trash" label={`移除此设备上的 ${account().name}`} onPress={() => logout(account().id)} /></View>}</Each></Section></If>

    <Modal open={dialog() === "add"} title="添加 YouTube Music 账号" close={close}><Label size={14} color={c().sub} style={{ lineHeight: 22 }}>连接另一个账号后，可在此页面随时切换。</Label><If when={a.nativeLoginAvailable()}><Pill label="使用 Google 账号登录" primary disabled={a.busy()} onPress={() => void action(login)} /></If><Pill label="导入本人会话" icon="upload" disabled={a.busy()} onPress={() => dialog.set("import")} /></Modal>
    <Modal open={dialog() === "import"} title="导入本人 YouTube 会话" close={close}><Label size={14} color={c().sub} style={{ lineHeight: 22 }}>先在浏览器中登录自己的 YouTube Music，再选择本人的会话文件或粘贴会话文本。应用会向 YouTube Music 验证账号并保存到此设备。</Label><View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}><Pill label="打开 YouTube Music" icon="link" onPress={() => void action(() => openUrl(musicUrl))} /><Pill label="选择会话文件" icon="upload" disabled={a.busy()} onPress={() => void action(importFile)} /></View><Input testID="account-session-input" accessibilityLabel="本人 YouTube Music 会话" value={sessionText()} onChange={({ value }) => sessionText.set(value)} placeholder="粘贴会话 JSON、Metrolist 登录文本或 Cookie" masked={!showSession()} multiline autoComplete="off" autoCapitalize="none" autoCorrect={false} style={{ minHeight: 112, color: c().text, fontSize: 14, backgroundColor: c().card, borderWidth: 1, borderColor: c().line, borderRadius: 16, padding: 16, placeholderColor: c().faint, caretColor: c().accent }} /><Toggle label="显示导入的会话文本" value={showSession()} onChange={showSession.set} /><Pill testID="account-verify-import" label={a.busy() ? "正在验证会话…" : "验证并连接账号"} primary disabled={!sessionText().trim() || a.busy()} onPress={() => void action(importText)} /><Press label="查看会话导入说明" onPress={() => showImportGuide.update(value => !value)} style={{ paddingVertical: 8 }}><Label size={13} color={c().accent}>{showImportGuide() ? "收起导入说明" : "如何取得自己的会话？"}</Label></Press><If when={showImportGuide()}><View style={{ gap: 12 }}><Label size={13} color={c().sub} style={{ lineHeight: 21 }}>电脑浏览器：登录 music.youtube.com，打开开发者工具的 Network（网络）面板，刷新页面，在发给 music.youtube.com 的请求中复制 Request Headers 下的 Cookie 值，再粘贴到上方。</Label><Label size={13} color={c().sub} style={{ lineHeight: 21 }}>也支持原版 Metrolist「账号 → 高级登录」文本、Netscape cookies.txt，以及含 cookie、visitorData、dataSyncId、authUser 字段的 JSON。仅有 Cookie 时，会从当前会话读取账号资料；多账号可在连接后切换频道。</Label><Label size={12} color={c().faint} style={{ lineHeight: 20 }}>{platform.os === "web" ? "网页无法直接读取另一个网站的登录会话，因此需要由你本人导入。" : "此路径用于导入你本人已有的 YouTube 会话。"}这是会话登录，不是 OAuth。请把会话填在本应用，不要发到聊天中。</Label></View></If><If when={a.error()}><Label size={13} color={c().danger}>{a.error()}</Label></If></Modal>
    <Modal open={dialog() === "create" || dialog() === "rename"} title={dialog() === "create" ? "新建云端歌单" : "重命名云端歌单"} close={close}><Field testID="account-playlist-title" value={title()} onChange={title.set} placeholder="歌单名称" autoFocus /><If when={dialog() === "create"}><Field value={description()} onChange={description.set} placeholder="歌单简介（可选）" multiline /><Label size={13} color={c().sub}>可见性</Label><View style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}><Each of={[{ id: "PRIVATE", title: "私享" }, { id: "UNLISTED", title: "不公开" }, { id: "PUBLIC", title: "公开" }]}>{option => <Chip label={option().title} selected={privacy() === option().id} onPress={() => privacy.set(option().id)} />}</Each></View></If><Pill primary label={a.mutation() ? "正在保存…" : "保存到 YouTube Music"} disabled={!title().trim() || !!a.mutation()} onPress={() => void action(async () => { if (dialog() === "create") await a.createCloudPlaylist(title().trim(), privacy(), description().trim()); else await a.renameCloudPlaylist(playlistId(selectedPlaylist()!), title().trim()); close(); say("云端歌单已保存"); })} /></Modal>
    <Modal open={dialog() === "delete"} title="删除云端歌单" close={close}><Label color={c().sub} style={{ lineHeight: 23 }}>从 YouTube Music 账号中删除「{selectedPlaylist()?.title}」。这会同步到使用同一账号的设备。</Label><Pill label="删除此云端歌单" danger icon="trash" disabled={!!a.mutation()} onPress={() => void action(async () => { await a.deleteCloudPlaylist(playlistId(selectedPlaylist()!)); close(); say("云端歌单已删除"); })} /></Modal>
    <Modal open={dialog() === "logout"} title="从此应用退出账号" close={close}><Label color={c().sub} style={{ lineHeight: 23 }}>移除此设备保存的「{a.accounts().find(item => item.id === logoutId())?.name}」会话与云端缓存，本地音乐库保留。YouTube Music 账号及其云端内容仍然保留。</Label><Pill label="退出并移除本机会话" icon="artist" onPress={() => void action(async () => { await a.logoutAccount(logoutId()); close(); })} /></Modal>
  </View>;
}
