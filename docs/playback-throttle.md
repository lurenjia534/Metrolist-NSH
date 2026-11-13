# 播放限速：googlevideo 的 10 MiB 分段规则

Web、Linux 与 Android 上都出现过同一个现象：无论是否登录，播放经常卡顿、缓冲很慢。原因不在登录状态，也不在解析出的地址本身，而在**读取音频字节的方式**。

## 实测

2026-11-13，用本仓库 `resolveWorkerAudio` 解析出的 VISIONOS_0_1 地址（itag 140），在同一出口、同一个签名地址上比较不同请求方式：

| 请求 | 文件 | 结果 |
| --- | --- | --- |
| 不带 `Range` 头 | 4.5 MB | HTTP 200，从第一秒起约 **32 KB/s** |
| 不带 `Range`，UA 为 `okhttp/4.12.0` | 4.5 MB | 同上，约 32 KB/s |
| `Range: bytes=0-` | 4.5 MB | HTTP 206，2.6 s 读完，约 1.75 MB/s |
| `Range: bytes=0-` | 59 MB | HTTP 206，约 **30 KB/s** |
| `bytes=0-10485759`（10 MiB） | 59 MB | 2.6 MB/s |
| `bytes=0-12582911`（12 MiB） | 59 MB | 约 30 KB/s |
| `bytes=40000000-`（剩余 19 MB） | 59 MB | 约 30 KB/s |

规则：**一次请求不带 Range，或请求超过约 10 MiB，就被限到约 30 KB/s。** 128 kbps 的 AAC 每秒约 16 KB，Opus 约 20 KB，限速后只有实时速率的 1.5–2 倍，网络稍有波动就会卡住；拖动到后面也要从这个速度重新开始。yt-dlp 读取 YouTube 媒体时使用 10 MiB 的 `http_chunk_size`，InnerTubeX 的媒体验证工具（`harness/Media.kt`）也只发有界的 `Range: bytes=a-b`，每段不超过 1 MiB；有界媒体范围的客户端分段为 512 KiB 至 1 MiB。

各平台播放器的默认行为正好落进限速：

- **Linux 桌面**：GTK / GStreamer 从 0 开始时不发 Range；VISIONOS 地址没有请求头，过去直接交给播放器，绕过了 Rust 中转。
- **Android**：Media3 `OkHttpDataSource` 在位置 0、长度未知时不发 Range（`HttpUtil.buildRangeRequestHeader` 返回 null）。
- **Web**：浏览器发 `bytes=0-`，短歌正常；超过 10 MiB 的长曲目和拖动后的请求被限速。
- **iOS**：AVPlayer 先探测 `bytes=0-1`，随后请求开放范围，长曲目同样被限速。
- **下载**：Rust、Android 与 Node 网关的下载都是一次不带 Range 的 GET，一首歌要下载与播放时长相当的时间。

## 修复

所有读取 googlevideo 字节的路径改为**连续的有界范围请求，每段不超过 10 MiB**，对播放器仍然表现为一个完整的 200 / 206 响应：

| 平台 | 播放 | 下载 |
| --- | --- | --- |
| Linux / Windows / macOS | 所有远程音频经 Rust 中转（`native/src/ranges.rs`、`media.rs`） | `files.rs` 分段 |
| iOS | 同一个 Rust 中转 | `files.rs` 分段 |
| Android | `MetrolistAudio.RangeChunkDataSource` 位于缓存与 OkHttp 之间 | `MetrolistHost` 分段 |
| Web / Node 网关 | `/api/audio` 的 `fetchRanges`（`server/streaming.mjs`） | `server/downloads.mjs` 分段 |

不带 Range 的请求得到 200 和完整长度；`bytes=a-` / `bytes=a-b` 得到 206 和正确的 `Content-Range`。不支持 Range 的音源、HEAD 与其它 Range 形式原样转发。

## Linux：gvfs 让 qtdemux 反复跳读

只分段还不够。Linux 上 NSH 用 `Gtk.MediaFile` 播放，GTK 通过 **gvfs**（`User-Agent: gvfs/1.62.0`）把 http 地址打开成可跳读的 GIO 流（`giostreamsrc`）。qtdemux 因此以随机访问方式读取：准备阶段在文件开头、结尾、中间之间来回跳，播放中每隔约 10 秒（一个分片）再跳一次。每次跳读都是一次新的 HTTP 请求；经中转或直连 googlevideo，每次都要 0.3–1 s 往返。

真实 GTK 主机实测（同一首 4.0 MB 的 itag 140 歌曲）：

| | 起播（解析完成到开始播放） | 播放中 |
| --- | --- | --- |
| 只分段的中转 | **17 s**，期间 8 次以上往返 | 第 10 s、20 s 处 PulseAudio 断流（underflow） |
| 中转下载一次并在内存中回答 | **约 3 s** | 61 s 内 0 次断流；29 次读取中 27 次由内存回答 |

现在中转在登记音源时就从开头按 10 MiB 分段下载整首歌，并保存在内存里。播放器的读取和跳读直接用这份数据回答，数据还没到时等它到达，与 Android 上 Media3 的缓存同理。只有超出下载进度 2 MiB 以上的读取才直接请求音源，例如拖动到长曲目后段。切歌释放音源时停止下载并释放内存。

## 登录后的解析顺序

原版 InnerTubeX 无论是否登录，都先用会话访客身份请求 VISIONOS_0_1（`loginSupported=false`，不带 Google 凭据）；只有明确需要账号的内容才先用 cookie。过去本项目登录后先发一次带 cookie 的 WEB_REMIX player 请求：普通歌曲只返回需要解密的格式，于是每首歌多一次请求；这次请求若遇到 429 或机器人验证，会直接报错，不再尝试 VISIONOS。

现在登录后也先请求 VISIONOS（使用账号自己的 visitorData，不带 cookie）；只有它无法播放时（例如私有上传），才用账号自己的 player 作为后备。

## 验证

| 验证 | 结果 |
| --- | --- |
| Rust 中转对真实 googlevideo，59 MB 曲目，无 Range | 13.7 s 读完，**4250 KB/s**（修复前约 30 KB/s） |
| Rust 中转对真实 googlevideo，`bytes=20000000-` | 6.4 s 读完剩余 39 MB，**6036 KB/s** |
| Web / Node `/api/audio` 对真实 googlevideo，同一 59 MB 曲目 | 无 Range：HTTP 200，40 s 内 390 KB/s；`bytes=20000000-`：HTTP 206，917 KB/s。当时出口带宽波动（同一个 10 MiB 分段，curl 512 KB/s、Node 2.1 MB/s），但已不再是 30 KB/s 的限速 |
| 真实 Linux GTK 主机（`nsh run`，实际解析、播放控制、Rust 中转、GStreamer） | 起播约 3 s（修复前 17 s）；61 s 播放 0 次断流 |
| Rust 测试 | 79 通过（新增：整文件、拖动、416、下载均按 10 MiB 分段，逐字节一致；跳到结尾、开头、中间不再请求音源） |
| Node 服务端测试 | 70 通过（新增：Worker 代理分段、登录后单次 VISIONOS、VISIONOS 429 后回落到账号） |
| Android Java | `MetrolistAudio` 与 `MetrolistHost` 对固定的 Media3 1.10.1 编译通过 |
| 真实解析 | 修改后匿名解析仍返回 VISIONOS_0_1 直链 |

中转把整首歌保存在内存里，直到切歌；几百 MB 的超长混音会占用同样大小的内存。

**尚未验证**：Android 真机、Windows、macOS、iOS 上的实际播放（与 Linux 共用 Rust 中转代码，但没有在这些系统上运行）；Cloudflare Worker 线上部署；带真实账号的登录态解析（测试使用请求夹具）。YouTube 若调整阈值，`CHUNK_BYTES` / `RANGE_CHUNK_BYTES` 是唯一需要改的常量。

## 源码依据

- [Metrolist `e6fea3b` MusicService / StreamUrlCache](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/StreamUrlCache.kt)
- [InnerTubeX `767e157` InnerTubeExtractor：有界媒体范围与分段大小](https://github.com/MetrolistGroup/innertubex/blob/767e157fb376a999a6e10725b7fd8b9a4d91e3d9/src/commonMain/kotlin/com/metrolist/innertubex/extraction/InnerTubeExtractor.kt)
- [InnerTubeX `767e157` PlayerClientDirector：VISIONOS_0_1 访客优先](https://github.com/MetrolistGroup/innertubex/blob/767e157fb376a999a6e10725b7fd8b9a4d91e3d9/src/commonMain/kotlin/com/metrolist/innertubex/extraction/PlayerClientDirector.kt)
- [InnerTubeX harness Media.kt：有界 Range 读取](https://github.com/MetrolistGroup/innertubex/blob/767e157fb376a999a6e10725b7fd8b9a4d91e3d9/harness/src/main/kotlin/com/metrolist/innertubex/harness/Media.kt)
