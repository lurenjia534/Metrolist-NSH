# 原版 Metrolist 界面与交互映射

本文件是 NSH 移植的实现依据，不代表下列 Android 功能都已移植。原版源码基准是 `MetrolistGroup/Metrolist` 的 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe`；对应 [GitHub 源码](https://github.com/MetrolistGroup/Metrolist/tree/e6fea3b36c68841bad21daa6252e1d69ecd3afbe)。本次阅读了原仓库 `AGENTS.md`，仅把原仓库作为参考，没有修改原版源码或版本。

下文路径除另有说明，都相对于原仓库的 `app/src/main/kotlin/com/metrolist/music/`。行号以该提交为准。下文标注 `0.2` 的优先级是早期规划记录；当前版本实现和验证见各版发布说明。

## 可直接核对的原版截图

原仓库 `fastlane/metadata/android/en-US/images/screenshots/` 中有六张实际截图。它们展示一种黑色与浅紫色主题，并不是所有设置组合的唯一外观。

| 文件 | 实际内容 | 对移植的直接启发 |
| --- | --- | --- |
| `screenshot_1.png` | Home：大标题、历史/统计/账号入口、心情 chips、四行 Quick picks 横向分页、Keep listening 封面、识曲/随机浮动按钮、底栏 | 首页主要空间给可直接播放的音乐；不需要宣传性大横幅。 |
| `screenshot_2.png` | 艺人页：大幅艺人图、名称、订阅/电台/随机播放、简介、热门歌曲 | 艺人页应有独立层次，不能仅把艺人名当搜索关键词。 |
| `screenshot_3.png` | 识曲：圆形麦克风、正在听、取消 | 识曲依赖真实音频识别服务；不提供空按钮。 |
| `screenshot_4.png` | 一起听：连接状态、连接按钮、昵称/房间号、创建/加入、设置卡片 | 房间操作与连接状态分开；成员和同步依赖原协议。 |
| `screenshot_5.png` | 播放器：来源标题、大方形封面、歌名/艺人、分享/喜欢、厚进度条、前一首/大播放按钮/后一首、底部工具栏 | 纯音频播放界面以封面为主，不嵌入 YouTube 视频播放器。 |
| `screenshot_6.png` | 歌词：大字号居中歌词、当前行浅紫、非当前行灰色；下方紧凑曲目信息与进度 | 歌词应跟播放时间同步，点击歌词能跳转到该句。 |

这组截图没有搜索、曲库、下载、统计或设置页；这些页面以下以源码为依据。原版品牌图位于 `assets/ic_launcher-playstore.png`。

## 导航与整体结构

`ui/screens/Screens.kt` 定义 Home (`home`)、Search (`search_input`)、Together (`listen_together`)、Library (`library`) 四个可用主导航项。`MainActivity.kt:742` 中 `ListenTogetherInTopBarKey` 默认值为 `true`：当前默认底栏隐藏 Together，把它放到顶栏。因此截图的四栏与当前默认的三栏都来自原版配置。

`ui/component/AppNavigation.kt` 分别实现窄屏 `NavigationBar`、宽屏 `NavigationRail`；使用 Material 3 的选中胶囊、填充/描边图标，标签可以由 slim navigation 设置隐藏。搜索结果路由仍归属于 Search。`ui/screens/NavigationBuilder.kt` 将历史、统计、心情与流派、新发行、排行榜、艺人、专辑、歌单、设置注册为次级页面。

**原版没有独立 Explore 主导航。** 新发行、排行榜、心情与流派、YouTube browse 都是从 Home 进入的发现页面。v0.1 NSH 的 Home / Explore / Search / Library 主栏与此不同；0.2 应将发现内容收回 Home，并让 Together 使用原版的主栏或顶栏位置。

## Home 与发现

主要实现：`ui/screens/HomeScreen.kt`，`ui/screens/NewReleaseScreen.kt`、`ChartsScreen.kt`、`MoodAndGenresScreen.kt`、`YouTubeBrowseScreen.kt`。

`HomeSection`（HomeScreen 约176行）明确区分 SpeedDial、QuickPicks、DailyDiscover、KeepListening、AccountPlaylists、ForgottenFavorites、FromTheCommunity、SimilarRecommendation、HomePageSection、MoodAndGenres。约1045行按本地数据、账号数据、在线首页响应构造区块；用户可调整顺序或启用随机顺序。选中在线首页 chip 时，原版不继续混入全部本地区块。

Quick picks（约1764行）是 **四行 `LazyHorizontalGrid`**，每行有封面、标题、副标题、播放状态和更多菜单，而非一排巨大卡片。标题旁的 Play all 把去重后的 quick picks 作为完整队列播放。点某一行：当前曲目切换暂停/继续；其他曲目根据自动电台设置播放电台或单曲队列。长按和更多按钮都打开 `SongMenu`。

Keep listening（约1984行）和在线 `HomePageSection`（约2259行）按内容类型呈现；纯歌曲区块用四行横向列表，专辑/艺人/歌单用封面卡片。在线 section 的“更多”应保留服务端 browse endpoint。心情与流派（约2439行）是四行彩色入口，点击真实 `browseId + params`；不应退化为一组静态搜索关键词。下拉刷新只更新数据；首次加载与分页的加载状态不同。

**0.2 优先：** 大标题及历史/统计/设置入口、在线 chips、四行 Quick picks、继续收听、真实首页 shelves、新发行/排行榜/心情与流派入口。编辑精选必须标识为编辑精选，不能称作用户的个性化推荐。账号歌单、私人历史同步在没有账号集成时不冒充完成。

## Search

入口：`ui/screens/search/SearchScreen.kt:76`；候选：`OnlineSearchScreen.kt:87`；结果：`OnlineSearchResult.kt`；本地：`LocalSearchScreen.kt`。

输入页包含搜索输入、清空、退出与在线/本地范围；输入后展示历史记录、在线建议、可直接操作的匹配条目。历史条目点击直接提交，删除按钮删除该项，填充箭头只把文本放回输入框（OnlineSearchScreen 约378–409行）。粘贴歌曲、专辑、艺人、歌单 URL 会解析为实际对象/路由（SearchScreen 约133–162行），不是把完整 URL 当歌名搜索。

结果页（OnlineSearchResult 约456行）提供 All、Songs、Videos、Albums、Artists、Community playlists、Featured playlists、Podcasts、Episodes、Profiles chips。All 使用分组标题与小列表；选择类型后使用该类型结果及 continuation。歌曲可播放/打开菜单，专辑/艺人/歌单进入详情页。隐藏视频设置会去掉视频筛选。

**0.2 优先：** 可编辑输入、清空、真实历史/建议、All / Songs / Albums / Artists / Playlists、真实详情导航与分页；纯音频版本无需复制视频分类。仅有搜索框和歌曲列表不能代表原版完整搜索流程。

## Library 总页与四类子页

`ui/screens/library/LibraryScreen.kt` 持久化顶层筛选，默认 `LIBRARY` 混合视图。顶部横向 chips 是 Playlists、Songs、Albums、Artists、Podcasts；再次点当前已选 chip 会取消筛选回到混合视图，不是不可取消的 tabs。专辑/艺人/混合页共用 grid/list 偏好，歌单有独立布局偏好。

| 页面与源码 | 具体结构与行为 | 0.2 实现依据 |
| --- | --- | --- |
| `LibraryMixScreen.kt` | 混合收藏；内建喜欢、离线等自动歌单；搜索、创建时间/名称/最近更新排序、顺序反转、网格/列表；进入对象详情 | 收藏歌曲、专辑、艺人、歌单必须区分在线浏览缓存与用户明确收藏。 |
| `LibrarySongsScreen.kt:332–501` | 可取消 Songs chip；Liked / Library / Uploaded / Downloaded 子筛选；搜索展开替代排序行；创建时间/名称/艺人/播放时长排序；显示歌曲数量；每行喜欢/下载/曲库标记和菜单；点击从当前筛选列表的指定位置开始播；浮动随机播放（Uploaded 下是上传） | 不应把全站搜索缓存称为个人曲库。喜欢、已加入曲库、已下载须有实际状态。上传依赖账号，不做虚假本地上传。 |
| `LibraryAlbumsScreen.kt:113–245` | Liked / Library / Uploaded 子筛选；名称或艺人搜索；创建时间/名称/艺人/年份/曲数/总时长/播放时长排序；数量、列表/网格；点击专辑详情 | 专辑收藏和详情是独立对象，不能只从歌曲 album 字符串拼凑出假 browseId。 |
| `LibraryArtistsScreen.kt:101–225` | Liked / Library 子筛选；搜索、创建时间/名称/曲数/播放时长排序；数量、列表/网格；点击艺人详情 | 艺人封面及真实 artistId 应来自在线结果或详情。 |
| `LibraryPlaylistsScreen.kt:156–545` | 自动歌单（喜欢、下载等）与用户歌单一起显示；搜索、排序、数量、网格/列表；加号创建歌单；歌单菜单提供更多操作 | 创建、重命名、加入/移除曲目、删除必须持久化；离线入口要显示真实已下载内容。 |

v0.1 的简化曲库与收藏/浏览记录混用不覆盖上述交互。0.2 的最小完整范围是四类收藏、可取消筛选、每类搜索与可用排序、网格/列表、歌单编辑，以及以实际文件状态构成的下载页。播客与 YouTube 私人上传是另一个业务范围。

## Player、歌词与队列

`ui/player/Player.kt` 的 `BottomSheetPlayer`（约209行）作为全局底部 sheet；折叠时 `MiniPlayer.kt` 保持当前曲目与播放控制，展开才显示大播放器。它读取同一播放器的曲目、进度、播放/缓冲、重复、随机、睡眠计时状态。

全屏主视图由曲目来源/队列标题、大方形封面、标题/艺人、分享/喜欢、进度条与时间、前一首/播放暂停/后一首、工具栏组成。进度在手势结束时调用实际 seek（约1437行）；主控制区约1661行。下方工具栏连到 Queue、sleep timer、shuffle、lyrics、repeat 和更多菜单，而不是一组装饰性图标。睡眠计时器（约645行）支持分钟、当前曲目结束、保存默认值；部分高级能力依赖 Android 后台播放服务。

`ui/component/Lyrics.kt` 选择原版/实验歌词视图；`OriginalLyrics.kt`、`ExperimentalLyrics.kt`、`LyricsLine.kt` 提供时间同步、高亮、滚动与点击跳转；`ui/menu/LyricsMenu.kt` 提供来源/重新获取/编辑等操作。截图中的歌词占据封面区域，下面仍能操作当前曲目和进度，不是离开播放器的另一个音乐会话。

`ui/player/Queue.kt` 提供队列来源与当前项、点击跳到某一位置、拖动排序（约682行）、划走移除及撤销（约791行）、更多菜单、长按多选/全选、相似内容。它使用队列项位置来处理重复曲目，不把相同 trackId 的两次入队都折叠为一个。

**0.2 优先：** 同一个纯音频引擎驱动迷你播放器/全屏/歌词/队列；上一首、下一首、暂停、seek、随机/循环、音量、倍速、睡眠、喜欢；同步歌词点击跳转；队列移动/删除/清空/跳转。整个 Web/native 路径移除 iframe 模式。后台存活、系统媒体服务、音频焦点、gapless/crossfade 不因画了控件就算实现。

## Downloads 与离线

原版主要以 `auto_playlist/downloaded` 进入 `ui/screens/playlist/AutoPlaylistScreen.kt`。标题在 liked/uploaded/offline 间变化（约149行）；顶部封面、数量与时长、随机/播放、更多；列表搜索和排序；长按选择、范围选择、全选与批量菜单。下载状态来自 Media3 `Download`，约356行区分完成/排队/下载中；删除下载按实际 DownloadService 执行（约375行），不是删除一个界面标记。

`CachePlaylistScreen.kt` 和 `settings/StorageSettings.kt` 管理缓存/存储，缓存不等同于用户下载。NSH 移植应保存真实音频文件/浏览器持久文件及元数据，支持下载后播放和删除；只调用浏览器“另存为”无法继续在应用内承诺离线曲库。下载正在进行时要显示实际进度/失败，失败项目不计入完成数。

## Stats 与 History

`ui/screens/StatsScreen.kt:303–593` 顶部是连续区间/周/月/年选择，再选择相应日期或连续 1周/1月/3月/6月/1年/全部。内容包括统计歌单、最多播放歌曲、艺人、专辑；标题显示数量，歌曲可 Play all；每项有真实累计播放指标，可进一步进入艺人/专辑详情。搜索/艺人选择可以缩小统计范围。

`ui/screens/HistoryScreen.kt` 是听歌事件历史，和 Stats 的聚合榜单不是同一页面。NSH 若只有去重后的最近曲目，不能声称具备按日/周统计。0.2 应记录真实开始与实际播放时长，提供时间范围、总收听时长、曲目数、歌曲/艺人/专辑排行；尚未积累的数据展示空状态。

## Settings

`ui/screens/settings/SettingsScreen.kt:78–242` 是分组的入口列表：界面；播放器与内容（含 AI）；隐私；存储与备份恢复；系统/更新/关于。每行进入实际设置页，不把所有高级开关塞在一个表格。

`PlayerSettings.kt` 包括音质、crossfade、gapless、跳过静音、响度规范、音频卸载、倍速、Cast、seek 步长、睡眠默认、队列持久化、自动电台/自动续播/避免重复等。`ContentSettings.kt` 包括语言/地区、隐藏显式内容、播放列表、代理、歌词来源与优先级、首页顺序。`AppearanceSettings.kt` / `ThemeScreen.kt` 管主题与布局。`PrivacySettings.kt`、`StorageSettings.kt`、`BackupAndRestore.kt` 分别管理历史/隐私、真实存储和数据库导入导出。

**0.2 优先：** 外观主题、音量/倍速/睡眠、实际 gateway 地址、一起听服务地址、歌词、真实文件/缓存、数据导入导出、关于与许可证。不可用的 Android 专属能力应写入功能矩阵，而不是放一个能切换却不影响行为的开关。

## Listen Together：真实协议边界

`listentogether/ListenTogetherServers.kt` 声明默认公共服务 `wss://metroserverx.meowery.eu/ws`（The Meowery，Poland，Nyx）。`ui/screens/ListenTogetherScreen.kt` 和 `settings/integrations/ListenTogetherSettings.kt` 对应用户流程与设置；业务与播放器桥接分别在 `ListenTogetherClient.kt`、`ListenTogetherManager.kt`。

协议定义位于 `app/src/main/proto/listentogether.proto`，是 **WebSocket 二进制 Protobuf Envelope**，不是 JSON 房间消息。Envelope 有 type / payload / compressed；track、room、join、playback、queue、时钟 ping/pong、缓冲同步都有具体字段。创建/加入用昵称，加入后需主持人 approve；room_created / join_approved 返回 userId 与 sessionToken。当前客户端没有要求 Google 账号的步骤；公共服务可用性仍须实际连接核对。不要生成一个随机“房间号”冒充成功。

`Protocol.kt` 给出 play/pause/seek/change_track/queue_add/queue_remove/queue_clear/sync_queue/set_volume。主持人发布状态，访客消费；队列更改与当前播放同步是两个相关消息。`ServerClock.kt` 用 ping/pong 修正服务端时间，位置按服务端采样时刻推算，协议时间和曲长单位是毫秒。来回同步必须避免把远端更新当本地操作再发送。

移植实现位于 `src/together.ts`，包括 Protobuf 编解码、gzip 接收、连接/断开、创建/加入/批准/拒绝/离房、成员列表、主持人移交、点歌审批、会话重连、时钟测量、真实播放状态和待播队列同步。同步队列不包括当前曲目；访客在本地映射为 `[currentTrack, ...upcomingQueue]`。访客自然播完不会自行生成电台或推进队列，等待主持人的下一条状态。房间仅分享 YouTube 曲目标识；本地文件没有上传到公共房间。

同时阅读了 [Metroserver `159861612e8b8a42cc1bc7c0cc0b46395720d46f`](https://github.com/MetrolistGroup/metroserver/tree/159861612e8b8a42cc1bc7c0cc0b46395720d46f) 的 `internal/server/playback.go`、`rooms.go`、`server.go`、`codec.go`，确认待播队列和已批准点歌的行为。服务端批准点歌会广播 `queue_add` 给主持人和成员，主持人也必须实际加入本地下一首，随后才能继续广播正确队列。

2026-11-11 使用两个客户端连接上述公共服务完成了创建、申请加入、主持人批准、当前曲与待播队列、播放/暂停/seek、移除待播曲、点歌/批准、主持人移交与退出测试；都收到真实服务端响应。测试运行同一份 `together.ts` 业务代码，播放器用替身记录实际命令，因而验证的是协议与状态同步，**不是两个设备扬声器的音频同步精度**。未登录 Google 账号、没有创建虚拟本地房间；测试房间已退出。

## 本轮实现顺序与验收

1. 统一原版导航、首页音乐密度、主色/间距/封面/底部播放器，让首屏结构与原截图可直接比较。
2. 纯音频播放器、歌词、队列同步；真实搜索与详情、四类曲库、下载、历史与统计；不能保留 iframe 回退模式。
3. 一起听协议客户端与真实房间 UI，展示连接/待审批/房间成员/主持人；真实服务不可达时显示服务错误与可填服务地址。
4. 根据实际功能更新 README/0.2.0 平台矩阵。检查构建、逻辑回归、网络结果、界面截图分别留证；打包成功与设备实际运行分开说明。

移动平台前台 UI 可用并不等于后台音乐服务已实现；原版 Android 的 MediaSession、下载服务、通知、音频焦点、后台存活不能直接靠 NSH 通用 UI 自动获得。最终交付报告应按实现与实测边界写明这些差别。


## 0.3 登录与 Android 扩展

在以上 0.2 页面研究的基础上，本轮补充读取原版 `LoginScreen.kt`、`MainActivity.kt`、InnertubeX 的 `InnerTube.kt`、`YouTubeAccount.kt`、`LibraryPage.kt` 和 `PlaylistPage.kt`。对应实现为 `src/account.ts`、`src/pages/Account.tsx`、`src/components/CloudLibrary.tsx` 与 `server/auth.mjs` / `account.mjs`。

登录采用原版会话认证，Android 读取完整 CookieManager 会话与网页上下文，资料验证后建立账号；云端修改使用原版 endpoint/action，歌单条目采用 setVideoId。新增 `android/MetrolistHost.java` 与 `MetrolistMediaService.java`，提供登录、文件、MediaSession 与媒体前台服务；这部分是显式实现的原生层，不是通用 UI 自动获得的功能。

账号 fixture、NSH 原生共享网关、手机/桌面云端交互的结果见 [账号说明](ACCOUNT.md) 和 [验证记录](VERIFICATION.md)，Android 实际构建及设备验证边界见 [构建说明](android-build.md)。


## 0.10 首页与发现链路修复

重新逐项核对 `HomeScreen.kt`、`HomeViewModel.kt`、`BrowseScreen.kt` 和 InnerTube 的 HomePage、renderer、YouTube.home/next。修复此前实际未贯通的首页 chip 参数、分类保留/清除、页面级分页、分区更多与播放、分组心情目录、播客单集识别和主导航选中状态。原版 HomePageSection 的“更多”进入通用 browse 路由，卡片本身进入对应专辑、艺人或歌单；NSH 现区分这两条路径。

纯歌曲分区按原版使用四行列表；播客单集与混合项目使用卡片；目录 grid 保持可纵向浏览。服务端缩略图的实际比例用于宽幅卡片，不声称与该 Kotlin 提交的所有图片比例完全一致。首页初始不再用内置目录替代在线推荐，分类结果也不混入本地历史。

完整修复范围、真实接口记录与回归状态见 [0.10 发布说明](releases-0.10.0.md)。
