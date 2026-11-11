# YouTube Music 账号与云端音乐库

本文对应 Metrolist NSH 0.3.0。账号功能沿用原版 Metrolist 的 YouTube Music 会话登录方式：用户完成 Google 登录后，应用取得该会话，向 YouTube Music 验证身份，再保存账号与音乐库。它不是 OAuth，也不另建一套 Metrolist 用户密码。

## 在应用中登录

从顶部头像或侧栏进入「账号」。成功连接后，页面显示 YouTube Music 实际返回的头像、名称、频道标识和可用的邮箱信息；不会从输入的会话文本中直接采信一个账号名称。

### Android

带有本项目 Android 登录桥的 APK 提供「使用 Google 账号登录」。按下按钮后，在应用内的 Google 登录页面完成登录，进入 YouTube Music，再按登录窗口中的「完成」。Google 密码在 Google 页面填写。

Java 登录桥通过 Android `CookieManager` 取得 `music.youtube.com` 的完整会话，并读取当前页面的 `VISITOR_DATA`、`DATASYNC_ID` 和 `SESSION_INDEX`。NSH 账号模块收到结果后，调用 YouTube Music 账号接口进行验证；验证成功才把会话加入本机账号列表。这个流程不依赖另一台电脑上的 Node 服务。

普通网页脚本的 `document.cookie` 不能代替这一步，因为它读不到 HttpOnly Cookie。项目因此使用 Android 宿主的 CookieManager，没有把一个仅能打开网页的按钮标成“登录已完成”。

### 网页及其他桌面平台

这些平台提供「导入本人会话」。网页不能直接读取另一个网站的登录态；桌面当前没有 Android CookieManager 登录桥。登录步骤如下：

1. 点击「打开 YouTube Music」，在浏览器中登录你自己的账号。
2. 在本人已登录的浏览器中取得 YouTube Music 会话，选择会话文件或粘贴到本应用的导入框。
3. 点击「验证并连接账号」，等待 YouTube Music 返回账号资料。
4. 需要切换同一会话下的 Google 账号或品牌频道时，点击「切换频道」。

桌面浏览器可在开发者工具的 Network（网络）面板刷新 `music.youtube.com`，选择发往该站点的请求，复制 Request Headers 中的 Cookie 值。把它粘贴在本应用的会话输入框中；不需要把会话、密码或 Cookie 发到聊天里。

导入框默认隐藏内容，可以自行打开「显示导入的会话文本」。它支持：

- 原版 Metrolist「账号 → 高级登录」的会话文本。
- 含 `cookie` 的 JSON 对象；可同时提供 `visitorData`、`dataSyncId`、`authUser`。
- 浏览器导出的 Cookie 数组或 `{ "cookies": [...] }` JSON；只采用 YouTube 域名的条目。
- Netscape `cookies.txt`，包括 `#HttpOnly_` 条目。
- Cookie 请求头的值，或以 `Cookie:` 开头的完整一行。

手动导入和 Android 登录最终使用同一个验证接口。会话过期或 Google 拒绝访问时，页面显示实际错误，账号不会因为点过按钮而自动变为已连接。

## 账号、频道与退出

「此设备上的账号」列出已保存且曾经验证成功的账号；切换时会重新验证目标会话。每个账号单独保存云端音乐库缓存、同步时间和会话信息。

「切换频道」读取 YouTube Music 的实际账号列表。选中频道后，以其 `authUser` 和 `dataSyncId` 重新验证身份。该列表可能包括同一 Google 会话中的其他账号及品牌频道；最终可访问的频道由 YouTube 返回的会话决定。

「退出此账号」移除本应用保存的选中账号及其云端缓存。本地音乐库保留，其他已保存账号保留。Android 同时清理本应用 WebView 的会话；这不是对 Google 账号执行全局注销，也不会删除云端歌曲或歌单。

重新打开应用时，保存的会话先显示为本机已保存，随后实际验证。已连接、正在验证和需要重新验证是不同状态。

## 云端音乐库与同步

账号页提供五个分类：歌单、喜欢的歌曲、歌曲、专辑、已订阅歌手。它们读取当前账号的 YouTube Music 音乐库；原有的本地歌单和本地收藏仍然由本地音乐库管理。

「同步云端音乐库」逐页读取所有五个分类，按账号保存到设备，并记录最后完成时间。「登录后同步音乐库」开启时，登录及启动后的会话验证成功会触发一次完整同步。它不是后台定时同步服务。

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
| `src/account.ts` | 会话解析、实际验证、账号和频道切换、本机持久化、完整分页同步、云端修改状态 |
| `src/pages/Account.tsx` | NSH 账号界面、Android 登录入口、导入会话界面、云端内容与歌单操作 |
| `src/api.ts` | 当前账号请求头、网页 HTTP 请求、原生直接调用服务模块 |
| `server/auth.mjs` | 从当前会话构建 YouTube Music 所需的认证请求上下文 |
| `server/account.mjs` | YouTube Music 账号资料、频道、音乐库与修改接口 |
| `server/index.mjs` | 同一套 `/api/account` 路由，供 Worker、Node 及原生直接调用 |
| `tests/account.test.tsx`、`tests/account-fixture.tsx` | NSH 账号状态与实际界面交互的隔离会话测试 |

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

Android 宿主协议为 `auth.available`、`auth.login({ url? })`、`auth.logout`。登录调用使用 `timeout: 0`，等待用户在 Google 页面完成操作；收到 Cookie 后仍须经过服务端身份验证。

## 已验证与尚未实测

专项命令：

```sh
nsh test tests/account.test.tsx
```

本轮已通过 6 个 NSH headless 测试：网页账号页导入、验证和退出；验证失败不显示登录成功；多账号与频道切换；完整分页缓存及喜欢失败回滚；Android 宿主登录／退出契约；原版 Metrolist 和 Netscape 会话导入。TypeScript 检查通过。

这些测试使用固定的虚构会话与 API fixture，不包含真实 Google Cookie，也不代表一次真实 Google 账号登录。Android Java 登录桥已通过 `javac` 和 D8 编译，并封装进基线 APK；该 APK 的 v2/v3 签名和 ZIP 16 KiB 对齐验证通过。最终发行包的完整构建记录以发行说明为准。

本环境未完成本人账号的 Android 真机登录验证。真实 Google 登录、品牌频道切换和账号云端写操作，需要用户在自己的设备与账号上完成；未在本环境借用用户账号测试。Google 接受嵌入登录页面与否、账号状态及地区可用性均以实际返回为准。

## 原版依据

实现参考 Metrolist 上游 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe` 的以下文件：

- `app/src/main/kotlin/com/metrolist/music/ui/screens/LoginScreen.kt`：Google 登录页面、CookieManager、页面配置和频道选择。
- `app/src/main/kotlin/com/metrolist/music/ui/screens/settings/AccountSettings.kt`：账号资料、登录导入文本、浏览登录态与同步选项。
- `app/src/main/kotlin/com/metrolist/music/ui/screens/AccountScreen.kt`：账号的云端音乐库分类与交互。
- `app/src/main/kotlin/com/metrolist/music/viewmodels/AccountSettingsViewModel.kt`：会话及账号状态管理。

这是本项目的 NSH 移植实现与版本号；没有修改或冒称上游 Metrolist 的版本。
