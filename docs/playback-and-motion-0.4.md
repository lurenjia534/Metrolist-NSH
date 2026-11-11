# 0.4 播放链路、Android 布局与动画修订记录

## 播放审计的范围

本轮先读取了实际源码，再改播放实现。比较基线为本项目 `6d5f8dbaec6ec23d77195c137c0f5035146e81ee`（0.3.0），原版 Metrolist 为 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe`，原版依赖的 InnerTubeX 为 `v0.11.2` / `c863ddf15be01a1abfa4630329bdc0a1e95f1531`。NSH Android 音频实现和控件文档按 APK 所用的 `c5214aaf4bbdf33bc1d59e9595e009b6aa54d702` 阅读，没有拿当前主分支的新 API 代替锁定版本。

0.3.0 已经是解析纯音频 URL 后交给 NSH `AudioPlayer` 播放；基线 `src/playback.ts:128–162` 可见这一点。Android 上这个 `AudioPlayer` 最终对应系统 `android.media.MediaPlayer`。本轮修订的是音频传输、缓冲、生命周期和 UI 控制方式。

下文“确认”指可以从源码或自动化用例复现的行为。“可能影响”指机制上的推断；本轮没有取得用户设备的音频欠载、网络吞吐或帧耗时记录，因此不能给某一原因分配卡顿百分比，也不能把测试通过写成真机听感已经验证。

## 原版实际上做了什么

| 项目 | 原版源码证据 | 对当前工作的意义 |
| --- | --- | --- |
| 音频引擎 | [`gradle/libs.versions.toml:12,74–76`](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/gradle/libs.versions.toml#L12) 指定 Media3 1.10.1；[`MusicService.kt:1293–1343`](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt#L1293) 在 Service 中创建 ExoPlayer。 | 播放引擎由服务持有，UI 显示与解码不共用生命周期。 |
| 缓冲与网络唤醒 | `MusicService.kt:1321–1332` 设置 `50_000 / 50_000 / 750 / 2_000 ms`，分别对应最小、最大、首次起播、重新缓冲门槛，并使用 `WAKE_MODE_NETWORK`。 | 初次启动门槛与持续缓冲容量是两件事；不能只延长等待时间来解释“更顺”。 |
| 音频缓存 | [`AppModule.kt:68–95`](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/di/AppModule.kt#L68) 默认 1024 MiB 播放 LRU 缓存，下载缓存独立。[`MusicService.kt:3501–3532`](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt#L3501) 把下载缓存、播放缓存、OkHttp 数据源连接起来。 | 重听与已缓冲区域的定位可以利用已有字节，不必每次都依赖新的远程响应。 |
| URL 与请求头 | [`StreamUrlCache.kt:12–34,75–105`](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/StreamUrlCache.kt#L12) 一起保存 URL、请求头、客户端名称、过期时间及 Range 策略，并在 DataSpec 上应用。 | 只传一个 URL 并不等价于传递完整的解析结果。 |
| 客户端媒体头 | [`InnerTubeExtractor.kt:1736–1783`](https://github.com/MetrolistGroup/innertubex/blob/c863ddf15be01a1abfa4630329bdc0a1e95f1531/src/commonMain/kotlin/com/metrolist/innertubex/extraction/InnerTubeExtractor.kt#L1736) 给 WEB_REMIX 设置 User-Agent、Accept、语言、Music Origin/Referer；VISIONOS 的普通媒体请求刻意不加这些浏览器头。 | 请求头按实际选中的客户端传递。VISIONOS 的空 headers 是上游行为，不能把它本身诊断为错误。 |
| 有界 Range | `InnerTubeExtractor.kt:1864–1869` 仅对 ANDROID_VR、IOS、TVHTML5_SIMPLY 要求有界 Range；512 KiB 分块仅用于其中的 ANDROID_VR、TVHTML5_SIMPLY。 | 本项目当前采用的 VISIONOS / WEB_REMIX 不能照搬其他客户端的强制分块参数。 |
| 队列与预备曲目 | [`MusicService.kt:1810–1854`](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt#L1810) 可先 prepare `queue.preloadItem`，再把完整队列交给 ExoPlayer。 | 原版的完整队列属于原生服务。本轮的新引擎还没有移植这整套队列模型。源码里出现的 preloadItem 不能直接描述成“所有下一首都已下载”。 |

## 0.3.0 中确认的问题

### 拖动进度条不断执行真实 seek

基线 `src/components/Player.tsx:15,62,75` 的三个播放进度条都把 `onChange` 直接连到 `p.seek()`。NSH [`website/elements/slider.md`](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/website/elements/slider.md#L93) 明确区分连续的 `onChange` 与手势结束一次的 `onChangeEnd`，而且拖动中的 thumb / range 在原生侧同帧跟手。

因此一次连续拖动会发出多次解码器定位命令，这是源码确认的行为。定位可能触发缓冲区切换和网络读取，所以它能解释拖动过程中反复停顿；没有证据说它解释了所有“不操作界面时”的断续。本轮进度条以本地 draft 显示拖动位置，手势结束只调用一次 seek，播放中的进度事件也不会覆盖拖动 draft。

### 缓冲时暂停会销毁音源

基线 `src/playback.ts:219–223` 在 `loadingSource || buffering()` 时调用 `releaseSource()`，后者在 `104–111` dispose 音频对象。用户在卡顿时按暂停，再播放，会丢弃这个对象已取得的准备状态和缓冲，再次解析、创建音源。这不是 NSH 规定的暂停语义：其 Android `Audio.java` 自己有保留准备中请求的 pause / resume 逻辑。

本轮只在尚未取得音源时取消待播放的解析；已经交给引擎的音源用 pause 保留。清空队列、改变已暂停音源的配置等实际需要废弃音源的动作才执行 stop。

### 原生进度绕回 JS 后又更新系统媒体状态

NSH 锁定版本 [`Audio.java:38–39`](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/crates/nsh-platform-android/java/com/longbridge/nsh/Audio.java#L38) 使用 250 ms 进度周期。基线 `src/playback.ts:146–157` 在每次 progress 调用 `app.playback`，而 `android/MetrolistMediaService.java:94–100` 每次都重设 MediaMetadata 和 PlaybackState。

这确认了每秒约四次多余的 JS→Android 回传和 metadata 更新，可能加重低性能设备的主线程、桥接和系统媒体组件负担。旧通知已有 `notificationKey` 去重（`103–105`），所以不能说“通知每 250 ms 都重建”。NSH 运行时也没有在进度 tick 中反复 seek 或 reopen；这两种猜测都没有源码依据。

### 播放数据缺少完整传递

基线 `server/streaming.mjs:165` 对所有客户端都返回空媒体 headers；`177–185` 的 `streamMetadata()` 又把 headers 从 direct 响应剥离。NSH [`NshView.java:1177–1179`](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/crates/nsh-platform-android/java/com/longbridge/nsh/NshView.java#L1177) 的 AudioPlayer URL 路径本身也不接受这套 HTTP headers。

WEB_REMIX 的已登录媒体请求因而不能维持原版使用的请求 profile。这是接口信息丢失，可能影响 CDN 响应；本轮没有用户网络抓包，不能断言它必然导致限速。VISIONOS 原本就允许空媒体头，本轮继续保留。

另外，旧 `src/api.ts:47–48` 对所有平台指定 `container=mp4`。这限制了 Android 的可选音频格式，但“采用 AAC”本身不构成卡顿证明。新 Media3 路径可以选 Opus，所以 Android 不再强制 MP4，其余平台仍保持原有兼容选择。

### 引擎与 UI 生命周期耦合

锁定版 [`Audio.java:23–33,429–481`](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/crates/nsh-platform-android/java/com/longbridge/nsh/Audio.java#L429) 以每个 NSH engine 的 MediaPlayer 播放、prepareAsync，在 engine 释放时关闭播放器。它不是原版的 Service + ExoPlayer + CacheDataSource。通用 AudioPlayer 可以正常播音，但旧项目没有给 Android 实现原版具备的缓存、缓冲配置和独立播放所有权。

旧 `src/playback.ts:162–173` 在播放启动以后才恢复保存位置。本轮把起始位置直接给原生 open；其他平台则在 play 前提交 seek，让引擎使用自己的待准备定位机制。

## 当前播放路径

### Android

`src/api.ts` 选择音频格式 → 共享 `server/streaming.mjs` 解析 → `StreamInfo` 保存 URL、headers、expiresAt、formatId、cacheKey → `src/playback.ts` 调用 `app.audio.open` → `android/MetrolistAudio.java` 以 Media3 ExoPlayer 播放。

原生层的具体配置是 Media3 1.10.1、OkHttp 数据源、50 秒缓冲目标、750 ms 首播门槛、2 秒重新缓冲门槛、1 GiB LRU 音频缓存以及网络播放唤醒。cacheKey 由歌曲 id、实际音轨 formatId 与已知 contentLength 组成；签名 URL 更新不会凭空换一份缓存，同一首歌的不同格式也不会共用错误的字节。缓存位置在应用 cacheDir，系统仍可以按 Android 的缓存管理行为回收它。

`MetrolistMediaService` 持有引擎和系统 MediaSession。系统播放、暂停、seek 直接调用原生引擎。每 250 ms 的 `audio.state` 只把位置、缓冲与真实状态送给界面，不再回传 `app.playback` 或 `app.metadata`。系统 PlaybackState 使用自己的时间基准插值，只在引擎状态改变时更新；metadata 与通知各自按内容去重。

NSH 在 Android 的职责是界面、队列、歌词、曲库和业务控制。Web、iOS、桌面继续使用 NSH AudioPlayer。工程仍然以 NSH 编写；Android 播放通过它现有的 host 扩展点接入适合长时间流媒体的服务。

### 桥接契约

| 调用 / 事件 | 行为 |
| --- | --- |
| `app.audio.open` | 传入 requestId、track、URL、headers、mimeType、formatId、expiresAt、cacheKey、起始秒数、音量、速度与播放意图。替换 MediaItem，复用引擎。Promise 成功只表示音源已设置。 |
| `app.audio.play` / `pause` | 继续或暂停当前准备好的音源，不重复 open。是否真的发声以 native state 为准。 |
| `app.audio.seek` | 位置单位为秒；拖动 UI 在结束手势后调用。 |
| `app.audio.settings` | 更新音量、速度，以及一起听访客的系统控制状态。 |
| `app.audio.stop` | 真正停止并清除当前音源，用于清空队列等操作。系统 stop 后 TS 也会解除旧 source，之后播放保留队列可以重新 open。 |
| `app.audio.snapshot` | 无活动音源返回 null；有音源时返回当前轨道、源信息与实际播放位置。Activity 重建后以此恢复 UI，不重新播放或把旧存档位置写回引擎。 |
| `audio.state` | 带 requestId、state、playing、playWhenReady、buffering、position、duration、bufferedPosition。切歌后旧 requestId 的事件不会覆盖新曲目。系统 seek 的即时事件额外带 discontinuity，避免把跳过的时间计入收听统计。 |

暂停缓冲中的曲目、从系统控制暂停和切换 Activity 都保留已有音源。切歌直接 open 下一首；不先 stop 服务再 open。结束事件只推进队列一次。新 UI 从存档恢复队列以后才读取 snapshot，实际原生曲目与位置优先于更早的持久化位置。

原生生命周期审阅还修正了 stop 后快速 open 的竞态：Android 的 `stopService()` 与 `onDestroy()` 是异步关系，若新音源先进入同一个 singleton，旧 Service 随后的销毁就会释放正在使用的新源。现在 `MetrolistMediaService.open()` 统一决定所有权：首次启动和停止期间的 open 进入 pending，由新服务创建后应用；旧 engine 释放完成以后才启动承接下一次 open 的服务。pending 期间的暂停、播放、seek、音量和速度也更新待应用参数，替换或取消的旧调用会结束其 Promise。这是源码生命周期审阅结果，未声称已在实体手机上做竞争条件压力测试。

## 验证结果与限制

这部分记录播放改动完成时的验证；后续 UI / 动画章节可追加本轮最终整合结果。

- NSH 完整回归：38 / 38 通过，包含账号 6、Android 音频桥 6、云歌单界面 2、native gateway 5、播放与曲库 runtime 11、界面 8。覆盖 Android 340 px 界面以及 Web / iOS / Linux 的既有控制路径。
- 后续原生生命周期审阅又补了“系统 stop 后重新播放”用例，Android 音频桥专项 7 / 7 通过。新专项还验证 open 完成不伪报 playing、缓冲时暂停保留音源、系统 seek 不回声也不虚增听歌时间、切歌不 stop 服务、旧事件不覆盖新曲目、snapshot 不重新 open / seek、错误后替换音源。
- Node 解析器 / catalog / account 三组：23 / 23 通过。新增检查覆盖直接流的 headers / expiry / cacheKey、签名变化后的稳定缓存身份、WEB_REMIX 媒体头和浏览器代理 Range 传递。
- NSH native gateway 用真实 NSH JavaScript 运行共享解析器，确认请求头、格式与过期时间跨过序列化边界；网络和账号都是用例提供的人工数据，没有用真实 Google 登录冒充验证。
- `nsh check` 使用本地 TypeScript 编译器通过；`git diff --check` 对本轮播放与测试文件通过。

这些测试能证明控制流程、数据契约、界面可达性和状态恢复；它们没有在物理 Android 设备上解码、播放真实 YouTube 音源，不能证明所有机型都无音频断续，也没有测量冷启动、弱网卡顿率、功耗或实际动画 FPS。APK 编译与签名属于另一项可验证结果，也不能替代上述真机测量。

与原版仍有实质差别：本轮没有把完整播放队列、下一曲解析和推荐续播迁入 native service；它们仍由 NSH 业务层执行。Android Activity 被销毁而服务仍存在时，当前曲目可继续播放，UI 可重连；UI 不在时独立跨曲目的队列调度尚未与原版等同。原版还有更完整的客户端选择、URL 过期重新解析、SABR / cipher / 上传音频、音效与专用下载缓存实现，本轮没有把这些写成已经移植。当前解析器继续只返回可直接使用的纯音频格式，失败会显示真实错误。

## Android 布局与动画

### 布局修订

- 底部导航拥有自己的 bottom / left / right safe area，内容与错误提示进入 NavPage 的安全区域；导航和滚动容器明确设置 minWidth / minHeight，避免子元素的固有尺寸撑破可用区域。
- 手机短横屏继续使用移动导航。全屏播放器在短横屏中将封面与播放控制左右排列；封面依据实际剩余高度缩放，标题栏与页签不被压缩，中间区域只有一个滚动所有者。
- 所有原生手机和平板图标按钮与进度滑轨采用至少 48dp 的触摸区域，可见轨道仍为细线。中等宽度平板的迷你播放器保留紧凑布局，避免放入过多 48dp 按钮。
- 音乐库搜索框在窄屏独占一行，排序、显示模式和操作菜单放在下一行；搜索输入、长标题与账号资料可正确收缩，固定图标按钮不再被挤小。
- 歌单编辑的上移、下移、移除独立成行，包括有侧栏的 800px 平板；歌曲的额外专辑列只在足够宽的界面出现。播放队列编辑使用单个菜单，保留标题空间。
- 下载卡片分开排列曲目资料和状态 / 操作；下载总览的小屏播放按钮换行。探索入口、歌词字号和偏移、账号与云端音乐库操作也按内容可用宽度排列。
- 业务弹窗均以受控 open 常驻。键盘高度、安全区域、可滚动内容和固定关闭按钮由弹窗布局处理，关闭时不再立即通过外层 If 删除整个组件。

### 动画机制

依据锁定 NSH 运行时的 [animation](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/website/docs/animation.md)、[Dialog](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/website/elements/dialog.md)、[Tabs](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/website/elements/tabs.md)、[Slider](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/website/elements/slider.md) 与 [Toast](https://github.com/longbridge/nsh/blob/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702/website/elements/toast.md) 文档实现：

| 交互 | 0.4 实现 |
| --- | --- |
| 主导航 / 播放器页签 | 原生 Tabs 指示器在选中项之间移动，原生布局追踪位置，无 JS onLayout 逐帧推算。 |
| 播放 / 暂停 | 两个稳定图标使用原生 AnimatedValue 交叉淡变和缩放，进度事件不会重新创建动画实例。 |
| 迷你进度 | 固定轨道上插值 scaleX，避免每个进度事件修改 width 并触发布局。 |
| 拖动定位 | 手势期间本地 draft 直接跟手，松手一次 seek，时间回传不覆盖手指下的预览。 |
| 全屏 / 业务弹窗 | 原生 Dialog 的受控 open 管理进入与退出，退出结束后由组件生命周期移除。 |
| 封面 / 面板 / 歌词 | createMotion 在组件内稳定创建；切歌或切面板才触发，歌词只在当前行变化时跟随滚动。 |
| 提示消息 | ToastManager、ToastStack、Toast 保留 starting / present / ending，退出中更新消息和同文案再次显示都有测试。50ms 时钟仅推进生命周期，动画帧由原生组件执行。 |
| 减少动态效果 | 时长归零或即时切换，同时保留状态反馈和可操作性。 |

### 最终整合检查

2026-11-11：`nsh check` 与 `git diff --check` 通过；NSH 全套 **46 / 46** 通过（约 61 秒），Node 全套 **37 / 37** 通过。

新增界面用例覆盖 Android 340×640、800×360、800×1100，顶部和底部各 24px safe area；播放器覆盖 360×740 旋转到 740×360、普通与减少动态效果。实际执行搜索 / 清空、筛选 / 排序 / 视图切换、弹窗关闭重开 / 保存、歌单上下移动 / 移除、歌词偏移和队列操作。拖动用例使用 dragAndHold / drop，断言按住期间零次 seek，松手恰好一次；关闭重开播放器不重新 open 音源。

这些是 NSH headless 引擎的真实交互测试，包含布局和命中测试，不等于 Android 真机像素截图或 FPS 测量。本环境的 managed preview relay 不可用，本地浏览器预览没有完成。最终 APK 的构建信息、证书、ABI 与检查结果随发行包交付；新签名的并排安装说明见 `android-build.md`。
