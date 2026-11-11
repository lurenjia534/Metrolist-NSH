# 播放、音乐库与界面运行验证

## 本轮结果

2026-11-11，使用 NSH 0.4.0 nightly 的实际测试运行时执行最终完整 `nsh test`：**19 项通过，0 项失败，耗时 19.2 秒**，其中共享运行逻辑 11 项、整应用界面交互 8 项。整应用源码与测试使用 TypeScript 7 直接执行 `--noEmit -p tsconfig.json` 检查通过，NSH `check` 同样通过。

测试入口 `tests/runtime-fixture.tsx` 直接导入生产代码 `src/store.ts` 与 `src/playback.ts`，通过 NSH Button 事件操作实际 signals、Storage 和 AudioPlayer。它仅是测试控制面，没有复制播放器或音乐库的实现，也不会被生产 `App.tsx` 引用。

`tests/ui.test.tsx` 另外打开真实 `App.tsx`，执行手机与桌面页面交互。其结果覆盖 NSH headless 的布局、选择器与输入命中模型；实际设备播放与像素截图不是这类测试的结论。

## 播放路径

所有平台使用同一条 `AudioPlayer` 路径。YouTube 歌曲先请求 `/api/stream?id=…&quality=…`，再把响应中的音频 URL 交给 NSH。网页由 NSH 的浏览器音频后端播放；共享模块中已没有 iframe、`embed` 分支或 `playbackMode` 设置。

音质选项与原版一致，为 `auto`、`low`、`high`。响应中的 MIME、码率、采样率、格式编号及内容大小保留在 `streamInfo`，供歌曲信息界面展示。所有平台请求传 `container=mp4`，网关选择对应的 AAC 音频格式，以匹配 NSH 对跨平台音乐播放推荐的 AAC/MP3 路径。切音质会重新解析音源，同时保留当前播放位置和用户的播放或暂停意图。

依据原版源码：

- [AudioQuality 与排序枚举](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/constants/PreferenceKeys.kt)
- [MusicService 的音质切换、队列与听歌记录](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt)
- [SongEntity 的喜欢与加入音乐库行为](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/db/entities/SongEntity.kt)
- [LocalPlaylistViewModel 的自定义顺序与排序](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/viewmodels/LocalPlaylistViewModel.kt)

## 自动化用例

| 用例 | 实际操作与断言 |
| --- | --- |
| 纯音频与音质 | 打开 YouTube 歌曲，seek 到 21 秒，暂停，再切高音质。切换时不打开新播放器；再次播放只请求高音质源，并恢复到 21 秒。检查 AudioPlayer 的源 URL 与原生 `quality=high&container=mp4` 请求。 |
| 加载时暂停 | 将旧音源响应延迟 60 秒，在加载中暂停、切音质，然后推进虚拟时钟。旧请求完成后没有 AudioPlayer 打开；手动播放才打开新的高音质源。 |
| 重复队列、重排、删除、循环 | 队列包含同一首歌曲两次，移动第三行后当前行索引正确，已有音频实例没有重开。暂停删除当前行后仍暂停；恢复播放后单曲循环 seek 到零，清空队列关闭音频实例。 |
| 加载时直接切音质 | 旧请求尚未完成时切高音质，新请求继续原播放意图。旧请求随后完成，不产生第二个播放器，也不覆盖新源。 |
| 音乐目录与音乐库分离 | 搜索结果进入目录缓存，却不出现在 `libraryTracks`。主动保存后入库；喜欢歌曲入库，取消喜欢仍留在库。专辑、歌手及 browse params 正确持久化。 |
| 歌单搜索与重复行 | 歌单 `[Beta, Alpha, Beta]` 搜索 Beta 后返回原始行索引 `0` 和 `2`。只删除索引 `2` 的那一行；排序和移动后索引与实际歌单顺序一致。 |
| 累计听歌统计 | 从 50 秒 seek 到一首 60 秒音频的尾段，未达到 30 秒聆听阈值，不记播放事件。随后完整播放两首，统计为 2 次、120 秒、2 首不同歌曲。检查持久化事件与历史记录。 |
| 自动电台与一起听访客 | 电台返回当前歌曲与重复推荐时，仅追加不同的新歌曲。自然结束后进入下一首。访客受远端控制时，自然结束保持当前索引并暂停，等待主持人的轨道切换。 |
| 下载重试与原生离线 URL | 第一次下载失败，重试返回完成任务。客户端记录完整字节数，后续播放使用 `/api/offline`，没有再次发起 `/api/stream` 请求。移除后清空持久化任务。 |
| 网页离线音频桥 | 网页下载完成后保存 `local:` 引用，播放时通过 `files.resolve` 获取 blob URL 并交给 AudioPlayer。迟到的 progress 事件不会把已完成任务改回下载中，移除时调用对应的存储删除桥。 |
| 浏览器需要明确点击 | 在 AudioPlayer 边界注入一次 `not-allowed` 拒绝，播放器显示“点按播放以开始音频”。点击重试后复用已创建的 AudioPlayer，不再请求音源，清除错误，并执行之前尚未完成的媒体元数据与歌词初始化。 |

网页离线桥用例同时检查一起听访客收到系统媒体 `pause`、`next`、`seek` 命令时，主持人的队列、位置和播放状态保持不变。下载、导入、导出和安装等等待用户操作或长时间传输的 host 调用使用 NSH 的 `{ timeout: 0 }`，不受默认 30 秒调用时限影响。

## 整应用交互与布局

界面测试直接操作生产 `App.tsx`，只将网关响应、存储初值与浏览器 host 返回值设为受控数据：

| 场景 | 尺寸与平台环境 | 实际操作 |
| --- | --- | --- |
| 手机导航与完整播放器 | 340 × 740 Android、390 × 844 iOS、340 × 740 Web、390 × 844 Web | 首页、搜索、音乐库三导航；创建歌单并检查存储；搜索播放；打开全屏播放器、暂停、切歌词和队列、收起播放器；进入设置切浅色主题并返回首页。 |
| 桌面歌单编辑 | 1440 × 940 Linux | 新建歌单，通过歌曲菜单加入两首歌；按歌曲名排序；进入自定义顺序移动歌曲；只移除点击行。 |
| 设置与活动页 | 1440 × 940 Linux | 音质、歌词对齐持久化；下载页播放真实任务 URL；打开累计统计；一起听昵称与房间码表单可输入。 |
| 搜索分页返回 | 1440 × 940 Linux | 搜索专辑加载第二页，进入专辑再返回；查询、专辑类型和两页结果保留，继续请求第三页，不重复拉首屏。 |
| 合集分页、迟到响应与歌手专辑架 | 1440 × 940 Linux | 专辑加载第二页，进入一个延迟响应的歌手页后返回；推进 60 秒虚拟时钟，当前专辑仍保持两页且可请求第三页；再打开歌手专辑架并进入专辑，歌曲只显示一次。 |

验证中修正了当前 nightly 的两处导航栏整合问题：平台只创建适用的那套导航栏；网页与桌面将应用 Header 放进页面普通布局流，固定 76/88 点高且不收缩，正文不能覆盖返回按钮。iOS/Android 仍使用系统导航栏。NSH headless 会拒绝被其他视图遮挡的按压，这一返回路径经过实际 `app.press` 验证。

## 下载和统计的实际含义

网页下载由 `files.download` 将音频保存到 IndexedDB，完成后返回 `local:<id>`。客户端通过 `files.download.progress` 显示进度，并提供取消、重试、删除和另存操作。原生下载使用本地 Node 网关的任务 API，让网关将响应流写入磁盘；完成后使用支持 Range 的 `/api/offline`。它不再调用 NSH 的 `fs.writeFile` 保存下载，因此不受该 API 单次 8 MiB 写入限额影响。本地文件选择器的旧导入路径仍使用 `writeFile`，与网关下载是不同路径。

听歌统计取实际 AudioPlayer progress 的播放位置增量，扣除 seek 的跨越部分，并按播放速度换算聆听时间。一个播放会话累计达到 30 秒才写入记录；暂停、恢复、切音质不会把同一会话重复记为多个播放。统计、历史、库与歌单元数据使用 NSH Storage 持久化。`pauseHistory` 开启时不记录听歌事件。

## 重现

在应用根目录执行：

```sh
nsh test
nsh check
```

本次使用的本地工具位置：

```text
/workspace/scratch/5565b3b894dd/toolchain/nsh/bin/nsh
/workspace/scratch/5565b3b894dd/toolchain/typescript/package/lib/tsc
```

测试结果为：

```text
19 tests: 19 passed, 0 failed (19.2s)
```

## 验证边界

NSH headless 测试使用其官方模拟音频设备，记录 `open`、`resume`、`pause`、`seek`、`close` 等命令，并通过 `endAudio()` 提供结束和进度事件。上述统计测试验证了生产统计逻辑如何处理这些事件；它没有播放出真实声音。

首次播放限制用例只在测试 fixture 中让第一次 `AudioPlayer.play()` 返回 `not-allowed`，随后恢复 NSH 原始方法，检查生产恢复路径。它没有改变生产播放器实现，也没有模拟或宣称验证 Safari 的用户激活规则。NSH Web 后端每首使用一个 HTMLAudioElement，提流请求之后的首次 `play()` 可能被浏览器拒绝；应用保留播放器，提示用户明确点按播放后调用原实例的 `play()`。Safari 对逐曲自动播放的限制仍需真实设备验证，当前运行时没有预先解锁未来新建音频元素的能力。

像素截图步骤尝试使用官方 Linux 运行 host；它因缺少 `libwebkitgtk-6.0.so.4` 无法启动，环境也没有可用的图形 DISPLAY。未使用 shell 浏览器自动化替代。Headless 不绘制像素，文字宽度采用近似测量，故以上手机与桌面结果不能替代真机字体、图像解码、滚动动效和像素视觉验收。

网关 HTTP 和网页 host 返回值在这套客户端测试中使用受控响应。下载用例中的 9,437,307 字节是服务端返回的测试元数据，用于验证客户端不会再次写入 NSH 文件 API；真实大文件流写、Range、重启恢复和断网读取由 `server/downloads.test.mjs` 的网关测试覆盖。这套客户端测试也不宣称验证了真实 IndexedDB 或 CDN 音频解码。

当前执行环境对真实 googlevideo 字节请求返回非音频内容，故提流元数据成功不等于听音成功。真实设备上的 AAC 解码、连续播放、锁屏行为、外部网络离线恢复和整页视觉布局仍须在对应平台验证。
