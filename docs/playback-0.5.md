# 0.5：起播、429、下一首与播放器界面

本轮从公开仓库的 0.4.0 提交 `2945e46ec169baa4e83c0972351d8d0af94c25d6` 继续开发。应用版本为 **0.5.0 / build 5**。Android 沿用 Media3 ExoPlayer 1.10.1，NSH 固定为 **0.4.0 nightly / c5214aa**，没有把应用版本升级等同于运行时升级。

## 原版为什么能快速开始播放

本轮核对的 Metrolist 原版提交是 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe`。从代码可确认它把多种等待从点播路径中移走：

1. `App.kt` 在后台预热播放配置、cipher 与可选 PO token；启动预热不要求用户先点一首歌。
2. `MusicService` 优先检查下载缓存、流缓存与 `StreamUrlCache`，有可用音源时不重新走完整解析。
3. `StreamUrlCache` 保存签名 URL、请求头、客户端、到期时间等完整数据，而不只是一个地址。
4. 队列有 `preloadItem` 时先准备首曲，完整队列异步到达，不把整张歌单取完作为首曲起播的前提。
5. ExoPlayer 的首次播放阈值为 750 ms，重新缓冲后的阈值为 2,000 ms，常规最小/最大缓冲均为 50,000 ms。

这些是源码机制，不能直接推算某一台手机的起播耗时。尤其 **750 ms 是音频缓冲阈值，不是从点击到听见声音的保证**。原版依赖的 InnerTubeX 同样处理 429；它没有让 YouTube 的服务端限流消失。

本项目 0.4 已有 Media3、OkHttp、1 GiB 缓存和相同缓冲阈值，因此本轮没有重复宣称“换播放器解决问题”，而是修复解析和播放之间仍存在的重复工作。

## 修掉的请求与播放问题

### 访客信息和配置重复读取

旧播放配置只缓存完成值。多个不同歌曲在缓存尚未建立时同时进入，会分别请求 watch 页面。现在相同网络 transport 共用一个正在进行的配置请求，完成后使用三小时缓存。

匿名首页、搜索或浏览响应中的 `responseContext.visitorData` 也会写入同一个匿名访客缓存；已有有效信息时，第一首歌曲不再额外请求 watch 页面。账号响应不会写入匿名缓存，不同 transport 的信息不混用。

### 音源过期后重复刷新

旧实现把已完成的 Promise 留在 player 缓存中。多个调用者同时发现其中的 URL 已过期时，会各自继续发起刷新。现在完成结果与进行中的请求分别保存，过期后的并发调用只触发一次真正刷新。较早开始、较晚结束的旧请求不能覆盖新的刷新结果。

客户端缓存完整 `StreamInfo`，包含 URL、请求头、格式、到期时间和缓存标识。缓存身份包含服务地址、账号、品牌频道、访客信息、歌曲、音质与容器。切换服务地址、账号或音质后使用对应的新音源。距离到期不足一分钟的地址不作为可复用结果。

默认解析器和可选的 yt-dlp 解析器都合并相同的进行中任务。用户取消其中一个 yt-dlp 调用者时，不会终止其他调用者仍在等待的共享解析。

### 429 被丢失，以及多层重试

过去上游 429 可能在包装后变成泛化的 502，难以判断发生在播放配置、player API 还是音频数据阶段。现在 API 保留 HTTP 状态、错误码、阶段和 `Retry-After`，跨 Web / Node / Android 共享路径传到客户端。

播放配置与 player 解析仅在服务端明确给出 **不超过 5 秒**的 `Retry-After` 时自动再试一次；没有该信息，或要求更长等待时，直接返回实际错误。目录请求和账号写入没有添加自动重放。

Android Media3 默认的加载策略还会对 CDN 429 连续重试。本轮在 MediaSource 的错误策略中识别真实的 `InvalidResponseCodeException`，对 429 返回 `C.TIME_UNSET`，结束该次加载；其他错误保持原生策略。音频代理保留上游 429，不自动重放音频请求。

“重试”以及错误后的主播放按钮都使用 `refresh=1` 重新解析地址，避免一直拿旧的失效地址再打开。

这些改动减少由重复解析和连续重试造成的请求压力，并让剩余限流可定位。YouTube 对网络出口、账号或具体客户端的限制仍可能返回 429；这版没有承诺永久消除服务端限流。

## 下一首准备

当前歌曲由引擎报告开始播放后，应用解析**实际下一首**。随机播放使用实际 shuffle bag 的下一项；单曲循环不另开预取；一起听受控客户端不自行准备另一条时间线。

Android 当前歌曲前方缓冲达到 **12 秒**后，才使用 `CacheWriter` 将下一首最多 **256 KiB** 的开头写入正在使用的 `SimpleCache`。已知音频总长度更小时只读取该长度。HTTP 请求头、格式和缓存标识与实际播放一致；切到下一首可以复用该音源和缓存。

切歌发生在音源仍解析中时，会共用正在进行的请求。调整队列、切换账号/音质或切歌会结束过时的准备任务，旧结果不能把下一首卡片改回先前曲目。预取失败不会改变当前歌曲的播放错误，也不会对同一候选持续重试。暂停期间改队列后，恢复播放立即准备新的下一首。

Android 缓存由进程持有，避免服务重启与异步 CacheWriter 结束之间发生重复缓存锁。整个播放队列仍由 NSH 共享逻辑管理；本轮实现的是提前准备音源和开头字节，**没有宣称完整无缝播放或交叉淡化**。

## 功能与界面

- 播放器区分连接音源、缓冲、播放、暂停和失败；连接或缓冲时按钮可以暂停当前播放意图。
- 进度条显示已缓冲范围，缓冲轨使用原生 `scaleX` 更新，避免每次位置更新都修改布局宽度。
- 播放详情显示音源解析、引擎准备和总耗时；结束点为引擎实际报告开始播放，不是 `app.audio.open` 返回，也不是声音到达扬声器的测量。用户中途暂停不计入起播时间。
- 下一首卡片显示解析中、音源已准备、开头缓冲中、开头已缓冲。
- 340 px 手机的迷你播放器增加 48 dp 队列入口；矮横屏导航改为横排图标和文字。
- 队列按真实 occurrence 标记当前项，重复歌曲只高亮一个；点击当前行暂停/恢复，不重复打开音源。
- 新增回到当前、移除当前之后的歌曲、自动续播开关，以及空队列的搜索入口。随机模式不显示按数组下标计算出的虚假待播时长。
- 首页直接进入喜欢、下载、最近播放、一起听。
- 修复原生菜单仍存在时删除其所在行导致的 owner 已释放错误：先捕获命令，在原生 `onClose` 后的下一事件 tick 执行。该 NSH 版本在 Rust emit 内运行 microtask，因此单纯 `queueMicrotask` 仍然太早。

## 已执行的验证

| 验证 | 本轮结果 |
| --- | --- |
| NSH 类型检查 | 通过，固定 CLI `c5214aa` |
| 全部 NSH 状态 / 交互测试 | **58/58**，约 69 秒，日志无 Rust panic 或 binding failed |
| Node 服务端全部测试 | **55/55**，无失败、跳过或取消 |
| 实际 Android Java classpath | **55 个源文件编译通过**，含 NSH host、Media3 播放器、服务和生成资源 |
| Web 构建 | 成功，生成 client 资源和 Worker |
| 构建后 Worker | JS 语法检查通过；真实本地 HTTP `/api/health` 返回 200 与正确 JSON |
| Android 最终包 | 逐包记录在随附 `build-info.json` 与 SHA-256 文件，包含实际 commit、资源/DEX、签名和 16 KiB 对齐检查 |

有针对性的请求数量与行为检查如下。它们使用确定性的 HTTP fixture，不是用户手机的网络测速。

| 场景 | 修复后的验证结果 |
| --- | --- |
| 8 首不同歌曲冷并发解析 | 1 次 watch 配置请求，8 次不同歌曲的 player 请求仍可并行 |
| 首页已取得匿名 visitor，随后首曲 | 0 次额外 watch 配置请求 |
| 12 个调用者同时解析同一歌曲 | 1 次 player 请求 |
| 10 个调用者同时遇到同一过期音源 | 1 次刷新 |
| 同一歌曲切换音质或容器 | 复用 player 格式列表，再选择对应格式 |
| 下一首尚在解析时手动切歌 | 复用进行中的解析 |
| 下一首准备遇到 429 | 当前曲目继续；实际点播该曲时才呈现其错误 |
| 前方缓冲不足 / 达到 12 秒 | 不启动 / 启动一次 Android 开头预读 |
| 暂停期间改队列后恢复 | 立即准备实际下一首，不等十秒持久化周期 |
| 虚拟时钟的耗时统计 | 120 ms 解析 + 750 ms 引擎准备 = 870 ms；仅验证统计语义 |
| 菜单移动 / 删除 / 清空 | 原生生命周期正常，没有以吞日志方式掩盖错误 |

NSH 交互测试包括 340×640、800×360、800×1100 等布局与实际点击命中检查。当前执行环境没有可用 Android 真机；图形浏览器预览受环境限制，没有完成最终像素截图验收。因此尚未验证具体手机的点击到声音延迟、持续播放卡顿率、系统后台行为、FPS 或功耗。

## 安装与重建

本轮提供 `Metrolist-0.5.0-arm64.apk` 和 `Metrolist-0.5.0-universal.apk`，最低 Android 8。应用名为 **Metrolist NSH Preview**，包名为 `app.miku.metrolist.preview`。当前工作区没有旧 0.4 的签名密钥，不能覆盖旧签名应用；这个包与 `app.miku.metrolist.next` 并排安装。可以从旧应用导出曲库后导入，账号重新登录，音频文件另行迁移。

工具链版本、Media3 依赖和摘要均已固定。Web 构建不再要求未纳入仓库的可选 `.openai/hosting.json`；源码解压后也可构建。完整命令和签名说明见 [Android 构建](android-build.md) 与 [README](../README.md)。源码包与依赖包不包含签名密钥。

本轮 Web 构建通过不等于线上站点已更新；部署状态应以实际发布记录为准。

## 源码依据

- [原版 App.kt：后台预热](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/App.kt)
- [原版 MusicService：缓冲、队列、缓存与播放](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt)
- [原版音源 URL 缓存](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/StreamUrlCache.kt)
- [InnerTubeX 0.11.2](https://github.com/MetrolistGroup/innertubex/tree/c863ddf15be01a1abfa4630329bdc0a1e95f1531)
- [固定的 NSH 源码](https://github.com/longbridge/nsh/tree/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702)
- [Media3 CacheWriter](https://developer.android.com/reference/androidx/media3/datasource/cache/CacheWriter)

本项目主要改动文件：`server/catalog.mjs`、`server/streaming.mjs`、`server/resolve.mjs`、`src/api.ts`、`src/playback.ts`、`android/MetrolistAudio.java`、`src/components/Player.tsx`、`src/ui.tsx`。
