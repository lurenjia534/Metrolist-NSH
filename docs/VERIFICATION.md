# 0.4.0 整合验证 · 2026-11-11

- NSH 运行时与组件固定 `c5214aa`，本地 TypeScript 7 检查通过。
- NSH 全套 46 / 46 通过；Node 全套 37 / 37 通过；`git diff --check` 通过。
- 新增 Android 原生音频桥、暂停保留缓冲、系统 stop 后恢复、系统 seek 的统计、Activity snapshot 重接、拖动松手单次 seek、Toast 出退场、三组 Android 小屏 / 横屏 / 平板操作测试。
- 原生构建改为 Media3 / ExoPlayer、OkHttp 与 1 GiB LRU；最终 APK 资源、DEX、Manifest、签名、ZIP / ELF 16 KiB 对齐的结果以发行包 build-info 为准。
- 未完成物理 Android 设备的真实音频输出、弱网卡顿率和动画 FPS 测量。本地可视预览因 managed preview relay 不可用而未完成，headless 交互通过不计为真机画面验收。

详细证据、原版源码链接、问题归因与实现边界见 [0.4 播放 / 布局 / 动画记录](playback-and-motion-0.4.md)。

---

## 以下保留 0.3 历史验证记录

# 0.3.0 整合验证 · 2026-11-11

- TypeScript 检查：`nsh check --tsc <TypeScript 7>` 通过。
- NSH 官方运行器：**32 / 32** 通过；其中 11 个播放器/状态测试、8 个原界面流程、6 个账号测试、2 个完整云端库 UI 流程、5 个原生共享网关测试。
- Node：`node --test server/*.test.mjs` **36 / 36** 通过。
- Web：`scripts/build.mjs` 通过；应用 214.3 KB JavaScript、288.4 KB bytecode、24 个部署资源与纯 Web API Worker。
- Android：Java host、媒体服务、Manifest、三 ABI 基线、签名与 16 KiB ZIP/ELF 检查已通过；最终 0.3.0 APK 信息见 `android-build.md` 和发布包 `build-info.json`。
- 公开知识库已发布；在浏览器实际查看首页，搜索 CookieManager 正确只保留登录与架构两章，清空搜索恢复全文。
- 应用视觉/声音真机验收：NSH headless 验证了行为而非像素；未将账号 fixture 或音频替身测试声称为真实 Google 登录或设备出声。
- 托管预览 relay 在此环境不可用，未另起替代预览基础设施。公开文档通过已发布站点完成页面检查。

下列记录保留了具体源码核对、真实匿名网络结果和测试范围。

# 验证记录

## 服务端、纯音频解析与离线文件 · 2026-11-11

此节记录音乐 gateway 的验证结果。它不代表浏览器、Linux、Windows、Android
或 iOS 上的实际出声验证。

### 已执行的自动检查

```sh
node --test server/*.test.mjs
node --check scripts/build.mjs
node --check web/sw.js
```

Node.js 24.22.1 的最新测试运行器报告 **36 个测试通过，0 个失败**，覆盖：

- 曲目身份、歌手和专辑归属、时长、封面、分页 visitor 上下文及 LRC 时间标签。
- 原音轨与配音轨的选择、AAC / Opus 音质选择、拒绝将只有视频的响应当作音频。
- `/api/stream` 返回同源的绝对音频 URL；LAN Host 和 `PUBLIC_ORIGIN` 的地址正确。
- 音频代理向源站转发实际 headers 和 Range，返回准确的部分字节；HEAD 不返回正文。
- CORS 预检不触发音频解析；静态及离线文件支持尾部 Range 和不可满足范围的 416。
- **9 MiB + 123 字节**的本地 HTTP 文件流式写盘，进度、字节数、名称与时间戳正确。
- 下载 POST 中的 `quality` 与 `container` 保持传入解析器；AAC 响应保存为 `.m4a`，
  离线读取保留 `audio/mp4` 类型。
- 取消下载会终止传输并移除 `.part` 文件；重启 gateway 后能恢复 manifest，并在
  测试源服务器已关闭时通过 `/api/offline` 读取保存的字节。删除会移除实际文件。
- SAPISIDHASH、两账号并发的 Cookie / visitor / channel 隔离、频道切换身份、
  账号库分类与分页、点赞/订阅/歌单增删改序的原版请求形状、重复歌曲的 setVideoId，
  以及新建歌单后使用新 playlistId 保存输入的简介。
- 保存歌曲前重新获取真实形状的 feedback token，忽略无关置顶菜单；账号失效返回 401。
- 账号音频解析按身份分别缓存；原生直接返回签名源；Web 已签发音频引用无需再带
  Google 凭据或重新解析。私有曲目只有 cipher 时不假装匿名路径可以播放。
- Node 正确转发账号 POST 正文；下载时使用当前账号，但任务响应与 manifest 不存 Cookie。

离线测试使用明确的本地测试字节，验证传输和磁盘行为；它不是 YouTube 音频解码或
扬声器出声测试。原生下载经过 Node 的文件流，不再受 NSH 单次 `fs.writeFile`
8 MiB 上限影响。

另已通过 Python AST 检查 `scripts/package-portable.py`。将
`auth.mjs → catalog.mjs → streaming.mjs → account.mjs → index.mjs` 按实际构建规则
组合后，共享模块语法检查与导入执行通过，
没有 Node imports、`process`、`Buffer` 或 `require` 依赖，组合后的 Worker
`/api/health` 返回 200，`audioEngine` 为 `innertube-visionos`。
组合后的匿名 `/api/account` 返回 401。
这次服务端验证没有生成最终发布包。

### NSH 原生共享 API 验证

```sh
nsh test tests/gateway-native.test.tsx
nsh check
```

`gateway-native.test.tsx` 的 **5 个 NSH headless 测试全部通过**。测试以 Android
平台标记运行真实 NSH JavaScript 引擎，通过 `src/api.ts` 导入共享服务端模块，
没有使用 Node 来代替应用内部逻辑。已确认：

- `crypto.subtle.digest('SHA-1', ...)` 计算出已知正确的 SAPISIDHASH；Request / Headers
  包含 Cookie、AuthUser 与原版 onBehalfOfUser 上下文。
- 不设置 gateway 地址时，账号请求直接进入共享 dispatcher，测试请求记录中没有
  localhost、127.0.0.1 或 metrolist.local 的外部网络请求。
- 两账号同曲返回各自的签名 AAC URL；crypto 随机 cpn、编码、码率、采样率等字段正确。
- 浏览器音频引用的 source 直接转发 Range；仅解析一次，不转发 Google Cookie。
- 匿名账户请求直接返回 401，不发起外部账号请求。

测试使用 NSH 的网络 fixtures，所有请求都在测试引擎内结束。它确认了共享模块
与原生运行时的兼容性，不代表 Android 设备上登录或出声已经通过。当前源码的
`nsh check` 也已通过。

### Google 账号功能的验证边界

账号实现依据原版 `LoginScreen.kt`、InnertubeX `InnerTube.kt` 的认证与云端修改请求，
以及 `LibraryPage.kt`、`PlaylistPage.kt` 和 `YouTubeAccount.kt` 的解析方式。
上述账号测试使用明确的人工 Cookie 字符串、截减 renderer 与注入的上游 fixture，
没有调用真实 Google 登录、账号库、点赞、订阅或歌单修改。没有用户凭据，因此尚未
验证真实账号登录后的 Google 响应、品牌频道切换、私有曲目播放与云端实际变更。

`WEB_REMIX` 为账号请求携带 Cookie / SAPISIDHASH、`X-Goog-AuthUser` 及
`context.user.onBehalfOfUser`。原版明确将 `VISIONOS_0_1` 标为不支持登录，故它只
承担已验证的公开曲目路径。Web 的 `/api/stream` 已签发包含解析后 CDN 签名地址
的同源 `/api/audio?source=...`；该引用没有 Google Cookie，也不依赖播放器发送
账号请求头。原生可用 `{directStreams:true}` 直接取得 CDN 地址。

### 跨平台容器适配核对

已读取 NSH 的实际 `AudioPlayer` 实现。它使用各系统的媒体解码器，没有在所有
平台内置同一个 Opus 解码器。NSH 的
[audio-design.md](https://github.com/longbridge/nsh/blob/main/docs/dev/audio-design.md)
明确推荐长音频使用 AAC 或 MP3，并说明 iOS / Safari / Windows 的 Opus 支持
不能作为通用前提。

| 平台 | 实际后端 | NSH 源码路径 |
| --- | --- | --- |
| macOS、iOS | AVFoundation `AVPlayer` | `crates/nsh-platform-apple/src/audio.rs` |
| Windows | Media Foundation `IMFMediaEngine`，audio-only 模式 | `crates/nsh-platform-windows/src/audio.rs` |
| Android | `android.media.MediaPlayer` | `crates/nsh-platform-android/java/com/longbridge/nsh/Audio.java` |
| Linux | GTK `MediaFile`，由 GStreamer 解码 | `crates/nsh-platform-linux/src/audio.rs` |
| Web | `HTMLAudioElement`，即 `new Audio()` | `crates/nsh-platform-web/web/nsh.js` |

客户端现统一为在线播放和下载传 `container=mp4`，选择 MP4 容器内的 AAC；Web
也使用相同选择，因此旧 Safari 不会收到默认的 WebM Opus。Linux 仍使用安装说明中
列出的 GStreamer good / bad / libav 插件。服务端保留显式 `container=webm` 与
不限定容器的 API 能力，但不会覆盖客户端的选择。此核对依据源码，未增加实机
播放已经通过的声明。

### 真实网络：纯 JavaScript 播放解析

对照 Metrolist 的 `InnerTubeXPlayer.kt`、`MusicService.kt` 与 InnertubeX 的
`YouTubeClient.kt`、`FormatSelectors.kt`、`PlaybackClientCatalog.kt`，实现了
带真实 watch-page visitorData 的 `VISIONOS` 0.1 直接音频路径。
Worker 与默认 Node gateway 都使用此路径；`STREAM_RESOLVER=yt-dlp` 是显式可选项。
当前路径不使用 iframe，也不依赖用户另外启动 Node 才能为托管网页解析音频。

以下是真实 `/player`、`/api/stream` 响应中的结果，三个曲目的元数据解析均为 200：

| 曲目 | YouTube id | 实际格式 | 时长 |
| --- | --- | --- | --- |
| Miku · Anamanaguchi | `G2PDJTkFiA8` | AAC 139：50,270 bps；AAC 140：131,021 bps；Opus 251：146,959 bps | 223 秒 |
| Tell Your World · livetune | `4n94ukt15qg` | AAC 140：131,111 bps | 255 秒 |
| From The Start · Laufey | `h8DeZSB2o-c` | AAC 140：131,146 bps | 170 秒 |

Miku 的 AAC 140 响应还返回采样率 44,100 Hz、长度 3,613,429 字节、
`loudnessDb=5.3500004`、`perceptualLoudnessDb=-8.65`。默认 Node gateway 的真实
`/api/stream?id=G2PDJTkFiA8&quality=high&container=mp4` 也返回 200，`client`
为 `VISIONOS_0_1`，播放地址是本机同源 `/api/audio`。

Node 实测命令使用 `--max-http-header-size=65536 --use-env-proxy`。64 KiB 配置解决
本环境 watch-page 响应头超过 Node 默认上限的问题，已加入启动脚本。
先前可选的 yt-dlp 2026.10.26 也成功解析过 Miku 的 M4A 元数据和签名 URL。

### 明确未通过的网络部分

**本执行环境没有取得真实 googlevideo 音频字节，也没有验证实际出声。**
对已成功解析的签名音频 URL 发出 Range 请求后，环境返回了 195 字节、
`Content-Type: text/html` 的 `Site Unavailable / Unable to access this site`
页面。即使该响应带有 206，也不是音频；gateway 将其作为错误返回 502。

因此，可以确认真实曲目解析、音质元数据、纯 Worker 兼容代码及本地 HTTP/文件
传输语义，不能据此宣称该环境中的 YouTube 音频播放或下载已经成功。需要在能
实际访问该 CDN 的运行节点验证音频正文和设备解码。

### 真实网络：目录、发现与歌词

以下是本次请求时的真实结果快照，返回数量会随 YouTube Music 内容变化：

| 功能 | 观察到的结果 |
| --- | --- |
| 首页与分页 | 首屏 sections 成功；保留 visitor 上下文后得到后续 sections |
| 综合搜索 | 33 项，混合歌曲、歌手、专辑和歌单 |
| 分类搜索与歌曲分页 | 歌曲、专辑、歌手、歌单各返回 20 项；歌曲第二页 20 项与首屏不同 |
| 搜索建议 | 真实返回 `hatsune miku`、`hatsune miku world is mine` 等建议 |
| 发现首页 | 3 个栏目，24 / 20 / 24 项；40 个情绪/风格入口 |
| 新发行 | gridRenderer 返回 144 张专辑 |
| 榜单 | 视频、风格、专辑、歌手与播客栏目分别返回 4 / 8 / 50 / 40 / 50 项 |
| 歌手详情 | 初音未来详情返回中文描述、`474万位订阅者` 和 8 个内容栏目 |
| 专辑和歌单 | 已验证一个 12 首专辑与一个 14 首歌单 |
| 专辑云端收藏标识 | `CRAYON`（`MPREb_yjyEEUvYNf3`）返回 8 首与真实 canonical playlistId `OLAK5uy_l28iFyFUgXnMv0zbLSiWjCdvTmuSokQcg` |
| 电台队列 | `/api/next` 返回 50 首 |
| LRCLIB | 一首曲目返回 33 行带时间轴的歌词 |

歌手/专辑/歌单详情保留 browse `params`；情绪和风格入口可把其 `browseId` 与
`params` 继续传给 `/api/browse`。服务不使用虚构歌曲来填充失败的 API 响应。
