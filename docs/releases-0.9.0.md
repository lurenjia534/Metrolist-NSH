# 0.9.0：曲库批量操作、链接搜索与播放器细节

版本标识：**0.9.0 / build 11**。本轮主要完善 YouTube Music 工作区中整理音乐、选择歌曲、搜索与连续播放的操作流程。

实现与验证跟踪：[PR #8](https://github.com/lurenjia534/Metrolist-NSH/pull/8)。应用代码提交 `605d7a3938b859077989333d2a7bc342808ef3a0` 已通过完整验证，结果见下文；各平台发行工件以发布页列出的实际产物为准。

## 曲库与歌单

- 音乐库、喜欢、播放历史和本机歌单支持长按进入多选，再次长按可选择当前显示顺序中的连续区间。选择栏显示数量、时长，以及被当前筛选隐藏的已选数量。
- 所选歌曲可以播放、整批放到下一首、追加到队列、加入本机或 YouTube Music 歌单、下载、喜欢或移除。“全选当前结果”只补入可见筛选结果；切换筛选和排序后保留已有选择。
- 本机歌单按条目位置区分重复歌曲。选中某一次出现、排序后播放或批量移除时，其他相同歌曲的条目仍然保留。
- 喜欢、播放历史和歌单页提供名称、歌手、聆听时长、歌曲时长等排序与方向切换；查询同时匹配歌曲、歌手和专辑。筛选显示匹配数量，顶部保留整个集合的歌曲总数和总时长。
- 从播放历史移除所选歌曲只更新历史列表，已有喜欢、曲库归属和收听统计继续保留。
- 歌曲列表使用 NSH `List` 跟随父滚动视口渲染，选择和编辑操作共用同一列表。

## 搜索与发现

- 搜索框识别 YouTube / YouTube Music 歌曲、专辑、歌手和歌单链接。歌曲走现有音源解析与播放器；收藏类内容打开其 browse 详情。
- 歌曲链接支持 `watch`、`youtu.be`、`shorts`、`embed`、`live`，并读取秒数、`1m2s` 等分享起播时间。链接播放本身不执行导入音乐库操作。
- `browse/MPRE…` 打开专辑，`channel/…` 和 `browse/UC…` 打开歌手，`playlist?list=…` 与 `browse/VL…` 通过真实歌单 browse ID 加载内容。
- 一起听访客提交歌曲链接时，已有目录记录直接用于点歌；未知歌曲先获取标题、歌手、封面和时长，再提交点歌请求。
- 历史搜索和在线建议提供独立的“填入搜索词”按钮，便于继续编辑；点击文字执行搜索。输入内容后，历史按关键词筛选，建议去掉已显示的重复历史项。
- 综合结果按歌曲、歌手、专辑、歌单分组。歌曲可播放全部，其他组可进入相应类型的完整搜索；分页与详情返回状态继续保留。
- 空搜索页提供新发行、排行榜、心情与流派入口，使用现有在线发现接口。

## 队列、睡眠与歌词

- 批量追加队列和批量“下一首播放”保留所选顺序与重复条目；随机播放时，显式插入的下一批歌曲按用户选定顺序播放。
- 队列歌曲增加“移到下一首”，移动已有条目并保持当前音源和进度，支持移动当前歌曲前后的重复条目。
- 睡眠定时器显示剩余时间，支持 5、15、30、45、60、90 分钟，以及“播完这首停止”。后者在自然结束时停止该次播放，不触发单曲循环或自动续播；手动切歌后仍在之后的歌曲结束时生效。
- 定时器可从播放器、队列或歌词设置打开。替换、取消和清空队列会清除原来的计时；到达歌尾后重新播放从开头开始。
- 歌词页直接提供复制歌词、字号、对齐、重置偏移和重新获取。切换歌曲恢复自动跟随；普通文本歌词不显示同步偏移控制。

## 上游依据

本轮对照的原版为 [Metrolist `e6fea3b36c68841bad21daa6252e1d69ecd3afbe`](https://github.com/MetrolistGroup/Metrolist/tree/e6fea3b36c68841bad21daa6252e1d69ecd3afbe)。以下链接均固定到该源码版本。

| 行为 | 原版源码 | 本项目实现 |
| --- | --- | --- |
| 多选、范围选择、重复歌单条目 | [LocalPlaylistScreen.kt][up-playlist]、[SelectionSongsMenu.kt][up-selection] | `src/pages/Library.tsx`、`src/store.ts` |
| 音乐库查询与排序 | [LibrarySongsScreen.kt][up-library] | `src/pages/Library.tsx` |
| 链接搜索路由 | [SearchScreen.kt][up-search]、[YouTubeUrlParser.kt][up-links] | `src/musicLinks.ts`、`src/navigation.ts` |
| 历史与建议的独立填入 | [OnlineSearchScreen.kt][up-suggestions] | `src/pages/Discover.tsx` |
| 队列操作与睡眠定时 | [Queue.kt][up-queue] | `src/playback.ts`、`src/components/Player.tsx`、`src/components/SleepTimer.tsx` |
| 歌词复制与偏移设置 | [LyricsMenu.kt][up-lyrics] | `src/components/Player.tsx` |

UI 继续使用 NSH TSX；音乐播放沿用 Android Media3 和其他平台 NSH AudioPlayer。原生应用延续 QuickJS、NSH 网络与 Rust Host 的现有运行结构。

## 验证记录

应用代码的完整验证记录：[Actions #30](https://github.com/lurenjia534/Metrolist-NSH/actions/runs/43303118202)，对应提交 `605d7a3938b859077989333d2a7bc342808ef3a0`。以下结果来自实际执行；之后的发布说明更新不改变应用代码。

| 检查 | 本次结果 |
| --- | --- |
| NSH 类型检查、Rust Host 检查与原生 bundle 构建 | 通过 |
| 完整 NSH / Rust 回归 | **252 通过、0 失败、11 跳过**；跳过项需要性能、原生录音/系统总线或图形宿主等运行条件 |
| Spotify bridge / Web 接入 / 音乐服务端 | **26 / 24 / 55 项通过，均 0 失败** |
| Android Spotify SDK Host 编译及协议检查 | 通过 |
| Spotify 原生订阅重挂载专项 | 通过，使用 `SPOTISH_DEMO=1` 的协议测试环境 |
| `tests/library-selection.test.tsx` | **5/5 通过**：过滤/排序后选择、重复条目精确移除、批量下一首与歌单、历史移除、长按区间及云端喜欢串行同步 |
| `tests/search-discovery.test.tsx` | **5/5 通过**：链接与时间戳、原生播放请求、browse/返回状态、建议填入、分类钻取及手机发现入口 |
| `tests/sleep-queue.test.tsx` | **10/10 通过**：定时截止、自然结束/循环/电台、Android 音频事件、取消、批量队列及随机下一首 |
| `tests/player-experience.test.tsx` | **3/3 通过**：340px 定时器与队列操作、桌面歌词实际字号、对齐、偏移重置与剪贴板 |
| Web 生产构建 | 通过；沿用固定 NSH 与原始 Web 编译配置，生成 0.9.0 / build 11 客户端和音乐网关 |
| Android / Linux / Windows / macOS / iOS 发行工件 | main 发布流水线继续构建；具体平台、签名状态与校验和见 [GitHub Releases](https://github.com/lurenjia534/Metrolist-NSH/releases) |
| 真实设备登录、出声和后台持续播放 | 本轮未做设备试听验收；协议与交互测试不等同于真实音频输出验收 |

新增交互用例使用目录/音源协议夹具和可控时间，检查实际请求、状态变化、列表顺序、呈现字号与操作结果。Web 包在独立构建环境完成；线上版本可通过站点的 `/version.json` 核对。

可从源码运行这组集中检查：

```sh
python3 scripts/run-nsh.py check
python3 scripts/run-nsh.py test tests/library-selection.test.tsx --web-host tests/native-login/host.js
python3 scripts/run-nsh.py test tests/search-discovery.test.tsx --web-host tests/native-login/host.js
python3 scripts/run-nsh.py test tests/sleep-queue.test.tsx --web-host tests/native-login/host.js
python3 scripts/run-nsh.py test tests/player-experience.test.tsx --web-host tests/native-login/host.js
```

完整开发与平台构建命令见 [README](../README.md#从源码开发)；发布结果见 [PR #8 checks](https://github.com/lurenjia534/Metrolist-NSH/pull/8/checks) 和 [GitHub Releases](https://github.com/lurenjia534/Metrolist-NSH/releases)。

[up-playlist]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/screens/playlist/LocalPlaylistScreen.kt
[up-selection]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/menu/SelectionSongsMenu.kt
[up-library]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/screens/library/LibrarySongsScreen.kt
[up-search]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/screens/search/SearchScreen.kt
[up-links]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/innertube/src/main/kotlin/com/metrolist/innertube/utils/YouTubeUrlParser.kt
[up-suggestions]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/screens/search/OnlineSearchScreen.kt
[up-queue]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/player/Queue.kt
[up-lyrics]: https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/ui/menu/LyricsMenu.kt
