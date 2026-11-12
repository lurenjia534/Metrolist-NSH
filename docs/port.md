# Metrolist NSH 0.6.0 移植状态

本文件区分原版功能、移植实现和设备验证。原版依据是 Metrolist 提交 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe`；本应用的版本号是 0.6.0，没有修改原版项目版本。

## 界面与功能对应

详细的原版文件、结构与交互见 [upstream-map.md](upstream-map.md)。原版截图位于其 `fastlane/metadata/android/en-US/images/screenshots/`；六张图分别为 Home、艺人、识曲、Together、Player、歌词。没有截图覆盖的页面以实际 Kotlin 源码为依据。

| 原版范围 | 0.6.0 移植 | 本版边界 |
| --- | --- | --- |
| Google / YouTube 账号 | Android Google WebView + CookieManager；Web/桌面本人会话导入、资料验证、多账号与频道切换 | 账户接口与界面通过 fixture；尚未本人账号真机验收 |
| 云端音乐库 | 五分类完整分页同步；喜欢、保存歌曲、专辑收藏、订阅、歌单 CRUD 与条目移动 | 请求真实 YouTube 端点；测试不修改真实用户账号 |
| Home / Search / Library | 保持这三个主导航，桌面侧栏/手机底栏；Together、历史、统计、下载与设置提供独立入口 | 原版可配置把 Together 放底栏，本版使用次级入口 |
| Quick picks / Keep listening | 四行歌曲架、可直接播放、继续聆听、真实在线区块 | 初始种子明确为编辑精选；登录后可使用当前账号读取首页 |
| 发现 | 新发行、排行榜、心情与流派；按 browseId/params 打开真实结果 | 在线目录内容和地区可用性由上游决定 |
| 搜索 | 建议、搜索历史、分类、详情、分页 | 提供歌曲/专辑/艺人/歌单；没有移植视频、播客、个人资料分类 |
| Songs / Albums / Artists / Playlists | 歌曲、专辑、艺人、个人歌单分开保存；查询、排序和布局；喜欢与下载状态 | 本机库与账号库有独立入口和持久化；个人上传音频尚未实现 |
| 歌单编辑 | 创建/重命名/删除、添加/移除/移动曲目、排序、导入/导出 | 本机歌单在设备持久化；账号歌单通过真实接口写回；重复云曲目按 setVideoId 编辑 |
| Player | Android 服务持有 Media3 / ExoPlayer，其他平台 NSH AudioPlayer；共享迷你/全屏、暂停、切歌、seek、音量、倍速、循环、随机、睡眠 | Linux 当前 runtime 仅 1×；Android 已增加独立原生媒体服务，但待真机验证 |
| Lyrics | LRCLIB 普通/同步歌词、当前行、点击跳转、字号/对齐/偏移 | 尚未移植原版其他歌词提供者、逐字时间轴和编辑器 |
| Queue | 添加、下一首播放、移动、移除、清空、当前项、恢复；重复歌曲按位置编辑 | 使用同一共享队列；原版某些手势与批量菜单未逐项复刻 |
| Radio | 单曲电台、推荐续播、队列末端补充、失败提示 | 访客不会自行生成电台；主持人决定房间时间线 |
| Downloads | 解析/下载/完成/失败/取消、字节进度、重试、批量操作、搜索、分类和离线播放 | 桌面 / iOS 文件在本机应用数据目录；Android 在应用私有目录；浏览器在 IndexedDB。桌面 / Android / Web 支持音频导出；iOS 暂仅应用内离线播放 |
| History / Stats | 最近收听、播放事件/实际时长；7/30/365日/全部；每日、歌曲和艺人统计 | 不是原版完整周/月/年日历与年度回顾；尚无专辑排行 |
| Together | 真实 Metroserver WebSocket/Protobuf、审批、成员、点歌、主持人移交、播放/队列同步 | 已验证公共服务协议；未测两台实体设备扬声器同步精度 |
| Settings | 主题、音质/自动电台、歌词、记录开关、服务地址、导入导出与关于 | 不提供尚未实现的 DSP、Cast、AI、Android Auto 等空开关 |

个人音频上传、完整播客业务、识曲、均衡器、交叉淡化和无缝播放不在本版已完成功能中。Google 会话登录和云端音乐库已实现，详见 [ACCOUNT.md](ACCOUNT.md)。

## 纯音频路径

`src/playback.ts` 在 Android 调用持久 Media3 服务，在其余平台使用 NSH AudioPlayer。0.4 对照与验证见 [播放和动画修订](playback-and-motion-0.4.md)。音乐目录与播放地址由 `src/api.ts` 在原生 QuickJS 内直接调用共享业务，Web 或主动填写服务地址时使用远程 API，`web/host.js` 仅处理浏览器文件、下载、MediaSession 和安装相关能力。

| 部署 | 默认解析 | 音频读取 | 下载存储 |
| --- | --- | --- | --- |
| Android 默认 | 在 NSH 内直接运行共享音乐模块；账号 WEB_REMIX + 匿名 VISIONOS | Media3 + OkHttp + 1 GiB LRU，读取携带请求头的 CDN 地址 | Java 流式写入应用私有目录，直接 file URL 播放 |
| 托管 Web / Worker | `server/streaming.mjs` 的纯 JavaScript VISIONOS + visitorData | 同源 `/api/audio` 转发，支持 Range/HEAD | 浏览器 IndexedDB |
| 本机 Web / Node | 同一纯 JavaScript 解析 | Node `/api/audio` | 网页下载仍在 IndexedDB；Node 另提供磁盘下载 API |
| Linux / Windows / macOS | QuickJS 直接运行共享业务；请求兼容 MP4 音频容器 | NSH AudioPlayer；需要上游请求头时使用同进程 Rust 音频转发，支持 Range/HEAD | Rust 流式写入应用数据目录，离线播放直接读取 file URL |
| iOS | 同一 QuickJS 业务与 NSH 原生网络 | NSH AudioPlayer 与同进程 Rust 音频转发 | Rust 流式下载至应用数据目录；应用内离线播放 |

所有原生发行包都不需要 Node。Node 24 用于可选 Web 构建、业务测试及主动启动的本机 Web / 自建音乐服务。只有此自建服务显式设置 `STREAM_RESOLVER=yt-dlp` 时才使用 Python / yt-dlp。桌面与 iOS 的 Rust 媒体转发只处理音频字节，与应用同进程，不承担账号和音乐 API 服务。

服务端已验证真实歌曲的音频解析响应；执行环境访问 googlevideo 返回了网页而非媒体字节。这一环境限制使实际声音输出尚未得到验证，不能用成功解析 URL 代替出声结果。源格式、Range/HEAD、9 MiB 以上文件下载及持久化的测试边界记录在 [VERIFICATION.md](VERIFICATION.md)。

## 数据持久化

- NSH Storage：设置、明确收藏、曲库、歌单、搜索历史、播放队列、收听事件、下载记录，以及按账号保存的会话与云端缓存。
- Android 私有目录：Java 流式导入和下载的音频；系统选择器负责导入与另存，不受 JS 写入大小限制。
- 浏览器 IndexedDB：导入和下载的真实音频 Blob；清除站点数据会移除这些文件。
- 桌面 / iOS：Rust Host 将下载音频保存到 NSH 应用数据目录；字节不经过 QuickJS，任务状态使用应用 Storage。
- 桌面原生导入与导出：NSH 原生路径选择器和 Rust 文件复制，不再经过 JS `fs.writeFile` 的单次 8 MiB 写入路径；可在文件管理器显示已下载文件。iOS 暂未实现音频导出到 Files。
- 可选 Node Web / 自建服务：服务端音频文件与 `library.json`，默认路径是服务用户目录下的 `Music/Metrolist`，可用 `DOWNLOAD_DIR` 改变；不属于原生默认运行路径。
- JSON 备份：包含曲库及相关元数据，不嵌入音频文件；本机备份不包含账号会话；云端操作单独调用账号接口。

桌面与 iOS 下载完成后，NSH AudioPlayer 直接读取本机音频文件，离线播放不需要 HTTP 服务。旧版本 Node gateway 下载的外部文件保留原位置，可通过文件导入加入本机曲库。

## 平台要求与设备测试

使用的工具链为 `nsh 0.4.0 (c5214aa nightly)`，Rust 模块与生成的原生 Host 使用同一固定源码提交，CI 编译器固定为 Rust 1.99.1。[NSH 上游平台说明](https://github.com/longbridge/nsh#platforms) 给出原生最低要求；不同系统的音频解码能力也受系统媒体组件影响。

| 目标 | 要求 | 构建与验证路径 |
| --- | --- | --- |
| Web | 现代浏览器、WebAssembly、音频解码、网络 | 构建应用自带的 WebAssembly runtime 与 Worker；浏览器文件和下载由 Web host 负责 |
| Linux x64 | glibc 2.39、GTK 4.14+、WebKitGTK 6.0、GStreamer | 原生 Rust 构建；CI 直接启动包内二进制，在 Xvfb 检查进程和窗口 |
| Windows x64 | Windows 10 1809+；编译使用 Rust / MSVC | 原生 Rust 构建；CI 检查进程存活与原生窗口句柄 |
| macOS | macOS 14+；编译使用 Rust / Xcode 工具 | Apple Silicon / Intel 各自原生构建，CI 检查进程存活；单独记录界面和出声验证 |
| Android | Android 8 / API 26+；开发需 Rust、NDK、SDK、JDK | Rust Host 与 Java / Media3 构建；保留既有 preview 签名身份，检查实际 APK 内的原生库与 ZIP/ELF 对齐 |
| iOS | iOS 15+；开发需 Rust、macOS、Xcode | ARM64 模拟器、明确标记的 unsigned 真机工件及可选签名工件；CI 安装、启动并截取模拟器界面 |

具体执行结果和没有完成的设备验证记录在各版本发行说明及 CI 日志；存在构建步骤不代表该次运行已经通过。
Android 已实现 MediaSession、媒体通知、mediaPlayback 前台服务及播放时唤醒锁，见 [Android 构建](android-build.md)。编译和归档检查不等于设备运行；真实 Google 登录、后台存活、系统控制和设备音频输出仍待真机验证。iOS 这些原生能力尚未实现。

## 验证与交付文档

- [README](../README.md)：托管网站、便携版、源码启动、手机连接、系统要求与打包命令。
- [原版映射](upstream-map.md)：页面结构与原文件定位。
- [Together 实测](together-verification.md)：实际公共服务的双客户端测试与声音验证边界。
- [服务验证](VERIFICATION.md)：目录、音频解析、下载与测试结果。

原生发行包保留 `nsh package` 生成的可执行入口，附上 `scripts/portable/` 中的使用说明、README、COPYING、NOTICE 与 NSH 许可证；不再复制 Node、独立音乐服务或网关启动器。构建报告记录原生入口、字节码、Rust 编译器、NSH 源码与模块依赖锁的摘要。Web ZIP 从最终 `dist/client` 组装，原生归档从同一最终源码编译。
