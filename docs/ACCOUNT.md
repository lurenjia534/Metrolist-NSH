# YouTube Music 账号与云端音乐库

本文对应 Metrolist NSH 0.5.1。账号功能沿用原版 Metrolist 的 YouTube Music 会话登录方式：用户完成 Google 登录后，应用取得该会话，向 YouTube Music 验证身份，再保存账号与音乐库。Google 页面负责密码与二次验证；本应用只读取登录后的 YouTube Music 会话。

## 在应用中登录

从顶部头像或侧栏进入「账号」。成功连接后，页面显示 YouTube Music 实际返回的头像、名称、频道标识和可用的邮箱信息；不会从输入的会话文本中直接采信一个账号名称。

### Android

带有本项目 Android 登录桥的 APK 提供「使用 Google 账号登录」。按下按钮后，在 Google 页面完成登录及二次验证，应用会自动识别 YouTube Music 会话、验证账号并返回。无需寻找或点击「完成」。

登录页采用独立的原生界面：顶栏显示当前页面的实际域名，提供返回和关闭按钮；细进度条显示页面加载，底部显示当前步骤。状态栏、手势区和键盘使用系统边距。Google 表单本身由 Google 提供，应用不会重画密码输入框、读取表单内容或替换浏览器标识来伪装其他客户端。

实际流程如下：

1. 如果本应用 WebView 已有 Google 会话，先进入 YouTube Music 自动验证，省去再次打开 Google 登录表单。
2. 没有会话时打开 Google 登录；从已连接账号选择「添加账号」时打开 Google 账号选择页。
3. 仅在确切的 `https://music.youtube.com` 页面读取 `VISITOR_DATA`、`DATASYNC_ID`、`SESSION_INDEX`，并通过 Android `CookieManager` 取得该站点完整 Cookie。
4. NSH 账号模块调用已有的 `POST /api/account/login`，等待 YouTube Music 返回实际账号资料。验证期间原生页显示「正在连接账号」。
5. 当前登录窗口接受验证结果后自动关闭，账号模块才保存会话并开始所选的音乐库同步。一个会话候选重复到达时只验证一次；用户点「重新验证」会发起新一次验证。

验证失败会留在登录页，显示实际原因，并提供重新验证或重新登录 Google。自动复用的旧会话遇到 401／403 会切回 Google 账号选择页；网络加载失败不会直接清除账号。Google 拒绝应用内登录、返回 HTTP 错误或无法打开额外验证应用时，会有具体提示；已有会话可返回账号页，通过「高级连接 → 导入已有会话」连接。

返回键可回到上一个 Google 页面，关闭按钮取消整个登录。取消是普通操作，不显示“登录失败”的红色错误，也不替换当前账号；取消后迟到的网络验证结果会被丢弃。这个流程默认在 Android 本机直接调用同一套服务模块，不依赖另一台电脑上的 Node 服务。

普通网页脚本的 `document.cookie` 不能代替这一步，因为它读不到 HttpOnly Cookie。项目因此使用 Android 宿主的 CookieManager，没有把一个仅能打开网页的按钮标成“登录已完成”。

### 会话保留与升级

普通登录、返回和取消不清除 WebView Cookie 或站点数据。读取会话及完成验证时调用 [`CookieManager.flush()`](https://developer.android.com/reference/android/webkit/CookieManager#flush())，将 Cookie 写入持久存储；账号信息另存于本机 NSH Storage。再次启动会验证已保存的账号。只有显式退出当前账号才清理本应用 WebView 的会话。

覆盖升级保持相同的 Android application ID 和签名，沿用该安装的数据；签名更新规则参见 [Android 应用签名说明](https://developer.android.com/studio/publish/app-signing)。清除应用数据、卸载重装或改装另一个包名会产生不同的数据环境；不能据此承诺沿用旧会话。Google 仍可以使会话过期，应用会按实际验证结果显示状态。

### 网页版、桌面与其他平台

网页版账号页先说明它与 YouTube Music 的浏览器会话相互独立。在 Google 页面登录后，当前网页不会自动变为已连接。主入口「获取 Android 版」打开本项目的发布页，供希望在应用内完成 Google 登录的用户下载；「打开 YouTube Music」打开其网站。桌面和其他尚未提供应用内登录的平台也会显示对应说明。

已有会话的用户可使用默认折叠的「高级连接」：

1. 展开「高级连接」，选择「导入已有会话」，打开「连接已有会话」弹窗。
2. 点击「选择会话文件」，或在输入框中粘贴本人已登录的 YouTube Music 会话。
3. 点击「验证并连接账号」，等待 YouTube Music 返回账号资料。成功后弹窗自动关闭，页面显示该账号。
4. 验证失败时，错误显示在提交按钮上方，输入内容保留；修改后可直接重试。

账号页和弹窗均可纵向滚动，窄屏按钮自动换行。需要先听音乐时，未登录账号卡片中的「先听音乐」返回之前的页面。

桌面浏览器可在开发者工具的 Network（网络）面板刷新 `music.youtube.com`，选择发往该站点的请求，复制 Request Headers 中的 Cookie 值。把它粘贴在本应用的会话输入框中；不需要把会话、密码或 Cookie 发到聊天里。

导入框默认隐藏内容，可以自行打开「显示会话文本」；「支持哪些会话格式？」展开具体说明。支持：

- 原版 Metrolist「账号 → 高级登录」的会话文本。
- 含 `cookie` 的 JSON 对象；可同时提供 `visitorData`、`dataSyncId`、`authUser`。
- 浏览器导出的 Cookie 数组或 `{ "cookies": [...] }` JSON；只采用 YouTube 域名的条目。
- Netscape `cookies.txt`，包括 `#HttpOnly_` 条目。
- Cookie 请求头的值，或以 `Cookie:` 开头的完整一行。

手动导入和 Android 登录最终使用同一个验证接口。会话过期或 Google 拒绝访问时，页面显示实际错误，账号不会因为点过按钮而自动变为已连接。

## 为什么没有改成系统浏览器 OAuth

系统浏览器适合官方 OAuth 流程，但不能只替换登录窗口，就让当前 YouTube Music 私人音乐库接口继续工作。这里有三个不同的结果：

| 路径 | 应用实际能得到什么 | 与当前音乐库实现的关系 |
| --- | --- | --- |
| Sign in with Google／OpenID Connect | 用于识别 Google 用户的 ID token；访问其他 API 要另行申请相应授权 | 识别用户不等于取得 YouTube Music 会话 |
| 自有 OAuth 客户端 + YouTube Data API | 按获准 scope 访问 YouTube 频道、播放列表、视频、订阅等官方资源，包括受支持的私人播放列表 | 可以作为另一套官方 API 产品实现，但没有文档保证与当前 Music 私库分类、推荐、播放解析和修改接口等价 |
| 当前 Google／YouTube Music 会话登录 | WebView 中本人登录后产生的站点 Cookie 与 Music 页面上下文，随后由 Music 账号接口验证 | 与现有 `FEmusic_liked_albums`、`FEmusic_library_corpus_artists` 等接口保持一致 |

Google 的 [OpenID Connect 文档](https://developers.google.com/identity/openid-connect/openid-connect)区分了身份认证和访问其他 Google API 所需的授权；[YouTube Data API 参考](https://developers.google.com/youtube/data/reference/rest)与[播放列表授权示例](https://developers.google.com/youtube/data/guides/implementation/playlists)说明其已公开的资源与权限。本项目的 Music 私库接口不在这套公开资源契约中。由此可以判断：拿到 ID token 或 `youtube.readonly`，不能直接宣称已经替代当前 Music 会话。这里没有借用其他应用的 OAuth client ID。

[Google OAuth 政策](https://developers.google.com/identity/protocols/oauth2/policies)要求 OAuth 使用合适的已注册客户端，并明确不允许把 OAuth 授权请求放进开发者可控制的嵌入浏览器。当前实现沿用原版的站点会话登录方式，不把它称作官方 OAuth，也不保证 Google 始终接受嵌入式登录。

Custom Tabs 可以使用浏览器已有的登录状态，但那份 Cookie 仍属于浏览器。Chromium 的 [Custom Tabs Security FAQ](https://chromium.googlesource.com/chromium/src/+/main/docs/security/custom-tabs-faq.md)明确把 Cookie、密码、完整 DOM 和任意脚本注入列为宿主应用不能访问的内容。因此“打开 Chrome 登录，再由本应用读取 Chrome Cookie”不是可实现的正常 Custom Tabs 契约。打开浏览器和完成本项目账号连接是两件分别需要验证的动作。

## 账号、频道与退出

「添加账号」打开连接入口；选择 Google 登录时，先关闭应用内弹窗，再打开原生登录页。取消后保留当前账号。设备保存多个账号时，页面的「切换账号」区域列出已保存且曾经验证成功的账号；切换时会重新验证目标会话。每个账号单独保存云端音乐库缓存、同步时间和会话信息。

「切换频道」读取 YouTube Music 的实际账号列表。选中频道后，以其 `authUser` 和 `dataSyncId` 重新验证身份。该列表可能包括同一 Google 会话中的其他账号及品牌频道；最终可访问的频道由 YouTube 返回的会话决定。

「退出此账号」移除本应用保存的选中账号及其云端缓存。本地音乐库保留，其他已保存账号保留。Android 同时清理本应用 WebView 的会话；这不是对 Google 账号执行全局注销，也不会删除云端歌曲或歌单。

重新打开应用时，保存的会话先显示「正在恢复账号连接」，随后显示「正在检查账号连接…」。实际验证成功后显示「已连接 YouTube Music」；需要更新时显示「账号连接需要更新」，并提供重新登录或更新连接的入口。连接状态旁的刷新按钮可重新检查当前账号。

## 云端音乐库与同步

账号页提供五个分类：歌单、喜欢的歌曲、歌曲、专辑、已订阅歌手。它们读取当前账号的 YouTube Music 音乐库；原有的本地歌单和本地收藏仍然由本地音乐库管理。

账号卡片的「打开音乐库」进入音乐库的云端视图并读取当前分类。「同步」逐页读取所有五个分类，按账号保存到设备，并记录最后完成时间。「登录后同步音乐库」开启时，登录及启动后的会话验证成功会触发一次完整同步。它不是后台定时同步服务。

单个分类可以刷新和加载下一页。收藏操作后刷新第一页时，会保留先前完整同步得到的后续页面；明确取消的那一项从缓存中移除。完整同步则以此次服务端返回的全部内容更新缓存。

「使用账号浏览音乐」决定首页、目录与播放请求是否携带当前会话。专门的账号验证、云端音乐库及云端修改始终使用当前选中的账号。

### 云端操作

| 操作 | 实际请求与结果 |
| --- | --- |
| 喜欢、取消喜欢歌曲 | 调用 YouTube Music like 接口，更新账号的喜欢列表 |
| 收藏、取消收藏歌单 | 使用 playlistId 调用歌单 like 接口 |
| 订阅、取消订阅歌手 | 使用频道 id 调用订阅接口 |
| 保存、移除云端歌曲 | 读取歌曲当前 feedback token，再调用音乐库反馈接口 |
| 新建歌单 | 将名称、简介和私享／不公开／公开选项发送到 YouTube Music |
| 重命名、删除自建歌单 | 对服务端标记为可编辑的歌单显示相应操作 |
| 加歌、移除、重排 | 歌单条目使用 `setVideoId` 识别同一歌曲的不同出现位置 |

云端变更会影响使用同一账号的 YouTube Music。账号页在删除云端歌单前明确显示目标名称及影响。喜欢与订阅状态即时反映点按结果；服务端拒绝修改时恢复先前状态并显示错误。

## 实现位置与接口

| 文件 | 职责 |
| --- | --- |
| `android/MetrolistLogin.java` | Google 页面、原生顶栏和进度、自动会话识别、验证反馈、取消和 Cookie 持久化 |
| `android/MetrolistHost.java` | 注册 `auth.*` 宿主协议与显式退出 |
| `src/account.ts` | 会话解析、实际验证、账号和频道切换、本机持久化、完整分页同步、云端修改状态 |
| `src/pages/Account.tsx` | NSH 账号界面、Android 登录入口、导入会话界面、云端内容与歌单操作 |
| `src/api.ts` | 当前账号请求头、网页 HTTP 请求、原生直接调用服务模块 |
| `server/auth.mjs` | 从当前会话构建 YouTube Music 所需的认证请求上下文 |
| `server/account.mjs` | YouTube Music 账号资料、频道、音乐库与修改接口 |
| `server/index.mjs` | 同一套 `/api/account` 路由，供 Worker、Node 及原生直接调用 |
| `tests/account.test.tsx`、`tests/account-fixture.tsx`、`tests/native-login/` | 账号验证、独立宿主握手、取消与重试的虚构会话测试 |
| `tests/account-login-ui.test.tsx`、`tests/account-native-ui-fixture.tsx` | 完整应用中的登录进度、添加账号取消、窄屏与横屏高级导入交互 |

会话形状为 `{ cookie, visitorData?, dataSyncId?, authUser? }`。账号模块把会话保存在本机 NSH Storage。网页访问配置的音乐服务时，通过 `X-Metrolist-Account` 请求头发送百分号编码后的 JSON；原生默认在本机直接调用同一服务模块。凭据没有放进 URL。服务端不使用一份全局 Cookie，也没有依赖未配置的共享会话数据库。

| 应用接口 | 返回或用途 |
| --- | --- |
| `POST /api/account/login` | 验证会话，返回 `{ account, session }`；返回的 session 不重复包含 Cookie |
| `GET /api/account` | 当前选中账号的实际资料 |
| `GET /api/account/channels` | 可切换账号／频道及其会话标识 |
| `GET /api/account/library?type=…&continuation=…` | 分类内容及下一页 token |
| `POST /api/account/like` | 歌曲或歌单的喜欢状态 |
| `POST /api/account/subscribe` | 歌手订阅状态 |
| `POST /api/account/song` | 云端歌曲保存状态 |
| `POST /api/account/playlist` | 创建、重命名、删除、加歌、移除或重排 |

Android 宿主协议：

| 调用／事件 | 契约 |
| --- | --- |
| `auth.available` | 返回 `{ available, method: "webview" }` |
| `auth.login({ requestId, selectAccount })` | 使用 `timeout: 0` 等待完整流程；返回 `{ completed: true, attemptId }` 或 `{ cancelled: true }` |
| `auth.progress` 事件 | `{ requestId, stage, message }`；阶段为 `opening`、`waiting`、`reading`、`verifying`、`error` |
| `auth.session` 事件 | `{ requestId, attemptId, credentials }`，触发共享账号模块的真实验证 |
| `auth.complete({ attemptId, ok, name?, message?, status? })` | 原生页仅接受当前候选的结果；成功关闭，失败显示重试；返回 `{ accepted }` |
| `auth.logout` | 显式清理本应用 WebView Cookie 和站点数据 |

网络验证先得到资料，当前原生窗口接受结果后才保存账号。`requestId` 隔离连续打开的窗口，`attemptId` 区分同一窗口内的重试；旧窗口事件或取消后的响应不进入新账号状态。

## 已验证与尚未实测

专项命令：

```sh
node scripts/run-nsh.mjs check
npm test -- tests/account.test.tsx
npm test -- tests/account-login-ui.test.tsx
```

账号专项 12 项通过，覆盖网页导入与退出、多账号与频道切换、完整分页缓存与喜欢失败回滚、原版 Metrolist 和 Netscape 导入，以及自动登录验证、验证失败后重试、重复候选、验证期间取消、旧窗口事件隔离、添加账号的选择页契约，以及启动后台验证结束后取消登录仍保留正确连接状态。

UI 专项 3 项通过：340dp Android 页面显示等待与验证阶段，验证前不显示已连接账号，成功后可进入云端音乐库；340dp 切到 740×360 横屏后添加账号并取消，当前账号保留且原生返回正常；网页版确认平台说明、两个外链和高级入口折叠，并验证失败保留输入、横屏重试成功后关闭弹窗。

`npm test` 为 headless 测试指定 `tests/native-login/host.js`：该独立宿主保留未完成的 `auth.login`，并在真实验证回调后回复。测试事件从宿主自己的 `hostEvent` 发出，以匹配 Android 宿主的双向调用；不会把待完成的交互改成一份立即成功的静态结果。

这些测试使用固定的虚构会话与 API fixture，不包含真实 Google Cookie，也不代表一次真实 Google 账号登录。原生登录控制器另通过 Android SDK 的 `javac` 编译检查；整包 D8、签名和 ZIP 对齐的最终记录以发行说明与构建报告为准。

本环境未完成本人账号的 Android 真机登录验证。真实 Google 登录、品牌频道切换和账号云端写操作，需要用户在自己的设备与账号上完成；未在本环境借用用户账号测试。Google 接受嵌入登录页面与否、账号状态及地区可用性均以实际返回为准。

## 原版依据

实现参考 Metrolist 上游 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe` 的以下文件：

- [LoginScreen.kt](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/screens/LoginScreen.kt)：Google 登录页面、CookieManager、Music 页面完成后自动提取会话、验证账号与频道选择。
- `app/src/main/kotlin/com/metrolist/music/ui/screens/settings/AccountSettings.kt`：账号资料、登录导入文本、浏览登录态与同步选项。
- `app/src/main/kotlin/com/metrolist/music/ui/screens/AccountScreen.kt`：账号的云端音乐库分类与交互。
- `app/src/main/kotlin/com/metrolist/music/viewmodels/AccountSettingsViewModel.kt`：会话及账号状态管理。

这是本项目的 NSH 移植实现与版本号；没有修改或冒称上游 Metrolist 的版本。
