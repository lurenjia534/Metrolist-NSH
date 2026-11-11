# Metrolist NSH 0.4.0 移植状态

本文件区分原版功能、移植实现和设备验证。原版依据是 Metrolist 提交 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe`；NSH 工程的版本号是 0.4.0，没有修改原版项目版本。

## 界面与功能对应

详细的原版文件、结构与交互见 [upstream-map.md](upstream-map.md)。原版截图位于其 `fastlane/metadata/android/en-US/images/screenshots/`；六张图分别为 Home、艺人、识曲、Together、Player、歌词。没有截图覆盖的页面以实际 Kotlin 源码为依据。

| 原版范围 | 0.4.0 移植 | 本版边界 |
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
| Downloads | 解析/下载/完成/失败/取消、真实字节进度、重试、删除、导出、离线播放 | Android 文件在应用私有目录；浏览器在 IndexedDB；桌面文件在 Node gateway 所在电脑 |
| History / Stats | 最近收听、播放事件/实际时长；7/30/365日/全部；每日、歌曲和艺人统计 | 不是原版完整周/月/年日历与年度回顾；尚无专辑排行 |
| Together | 真实 Metroserver WebSocket/Protobuf、审批、成员、点歌、主持人移交、播放/队列同步 | 已验证公共服务协议；未测两台实体设备扬声器同步精度 |
| Settings | 主题、音质/自动电台、歌词、记录开关、服务地址、导入导出与关于 | 不提供尚未实现的 DSP、Cast、AI、Android Auto 等空开关 |

个人音频上传、完整播客业务、识曲、均衡器、交叉淡化和无缝播放不在本版已完成功能中。Google 会话登录和云端音乐库已实现，详见 [ACCOUNT.md](ACCOUNT.md)。

## 纯音频路径

`src/playback.ts` 在 Android 调用持久 Media3 服务，在其余平台使用 NSH AudioPlayer。0.4 对照与验证见 [播放和动画修订](playback-and-motion-0.4.md)。音乐目录与播放地址由 `src/api.ts` 请求服务，`web/host.js` 仅处理浏览器文件、下载、MediaSession 和安装相关能力。

| 部署 | 默认解析 | 音频读取 | 下载存储 |
| --- | --- | --- | --- |
| Android 默认 | 在 NSH 内直接运行共享音乐模块；账号 WEB_REMIX + 匿名 VISIONOS | Media3 + OkHttp + 1 GiB LRU，读取携带请求头的 CDN 地址 | Java 流式写入应用私有目录，直接 file URL 播放 |
| 托管 Web / Worker | `server/streaming.mjs` 的纯 JavaScript VISIONOS + visitorData | 同源 `/api/audio` 转发，支持 Range/HEAD | 浏览器 IndexedDB |
| 本机 Web / Node | 同一纯 JavaScript 解析 | Node `/api/audio` | 网页下载仍在 IndexedDB；Node 另提供磁盘下载 API |
| 原生 + Node | 同一纯 JavaScript 解析；请求兼容 MP4 音频容器 | NSH AudioPlayer 读取 gateway 音频地址 | Node 流式写入 `Music/Metrolist`，通过 `/api/offline` 读取 |

因此 Android 与托管网站的访问者无需运行 Node；本机网页和桌面配套服务需要 Node.js 24。默认路径无需 Python，只有显式选择 `STREAM_RESOLVER=yt-dlp` 时才使用可选解析器。

服务端已验证真实歌曲的音频解析响应；执行环境访问 googlevideo 返回了网页而非媒体字节。这一环境限制使实际声音输出尚未得到验证，不能用成功解析 URL 代替出声结果。源格式、Range/HEAD、9 MiB 以上文件下载及持久化的测试边界记录在 [VERIFICATION.md](VERIFICATION.md)。

## 数据持久化

- NSH Storage：设置、明确收藏、曲库、歌单、搜索历史、播放队列、收听事件、下载记录，以及按账号保存的会话与云端缓存。
- Android 私有目录：Java 流式导入和下载的音频；系统选择器负责导入与另存，不受 JS 写入大小限制。
- 浏览器 IndexedDB：导入和下载的真实音频 Blob；清除站点数据会移除这些文件。
- Node gateway：音频文件与下载清单 `library.json`，默认路径是用户目录下 `Music/Metrolist`，可用 `DOWNLOAD_DIR` 改变。
- 桌面原生 Picker 导入：保存到 NSH 应用数据目录，当前 `fs.writeFile` 单次 8 MiB 限制仍适用；Node 磁盘下载不经过这个接口。
- JSON 备份：包含曲库及相关元数据，不嵌入音频文件；本机备份不包含账号会话；云端操作单独调用账号接口。

桌面原生下载完成后可以不访问外网，但本机 gateway 仍需运行，以便向 AudioPlayer 提供本地文件。手机连接电脑 gateway 时，文件保存在电脑，手机必须能访问那台电脑。

## 平台要求与设备测试

使用的工具链为 `nsh 0.4.0 (c5214aa nightly)`，预编译 Linux/Windows runtime 来自同一版本。[NSH 上游平台说明](https://github.com/longbridge/nsh#platforms) 给出原生最低要求；不同系统的音频解码能力也受系统媒体组件影响。

| 目标 | 要求 | 本环境结论 |
| --- | --- | --- |
| Web | 现代浏览器、WebAssembly、音频解码、网络 | 可构建和部署；受私有站点登录阻挡的云浏览器检查不记为视觉/声音通过 |
| Linux x64 | glibc 2.39、GTK 4.14+、WebKitGTK 6.0、GStreamer | 可打包；容器没有所需 GUI 运行库，未启动原生窗口 |
| Windows x64 | Windows 10 1809+ | 可跨平台打包；未在 Windows 设备运行 |
| macOS | macOS 14+ | 提供源码/命令/CI；没有 Mac 构建与运行结果 |
| Android | Android 8 / API 26+；开发需 SDK/JDK/runtime | 已构建并签名三 ABI APK，检查 DEX、Manifest、ZIP/ELF 16 KiB 对齐；无真机登录/出声结果 |
| iOS | iOS 15+；开发需 macOS/Xcode/runtime | 当前环境无 Xcode，没有 IPA，没有实机结果 |

Android 已实现 MediaSession、媒体通知、mediaPlayback 前台服务及播放时唤醒锁，见 [Android 构建](android-build.md)。编译和归档检查不等于设备运行；真实 Google 登录、后台存活、系统控制和设备音频输出仍待真机验证。iOS 这些原生能力尚未实现。

## 验证与交付文档

- [README](../README.md)：托管网站、便携版、源码启动、手机连接、系统要求与打包命令。
- [原版映射](upstream-map.md)：页面结构与原文件定位。
- [Together 实测](together-verification.md)：实际公共服务的双客户端测试与声音验证边界。
- [服务验证](VERIFICATION.md)：目录、音频解析、下载与测试结果。

增强便携包从 `scripts/portable/` 复制启动器，并带上运行所需服务源码、README、COPYING、NOTICE 与 NSH 许可证。Web ZIP 必须从最终 `dist/client` 组装，原生归档从同一最终源码重新编译。
