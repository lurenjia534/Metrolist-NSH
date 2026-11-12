# 0.10.0：首页分类、推荐分区与发现导航

版本：**0.10.0 / build 12**。

## 本轮修复

用户截图中的“专注”等按钮应当改变首页推荐，旧实现却把固定英文词传给搜索，同时底部仍显示首页选中。这个缺陷涉及首页响应、接口参数、页面状态与主导航。本轮直接贯通这些层次。

| 交互 | 修复后的行为 |
| --- | --- |
| 首页顶部分类 | 解析原生 `chipCloudRenderer`，显示服务端标题；原样传递 `browseId` 与 `params`，留在首页 |
| 再次点击、清除、返回 | 恢复切换前的未筛选首页，不重跑搜索，不改搜索历史 |
| 刷新、连续切换 | 刷新当前分类；较早的请求不会覆盖后来选中的分类或取消操作 |
| 首页分页 | 使用页面级 section-list continuation，保持访客身份，追加分区并保留当前分类 |
| 分区标题 | 保留 strapline、头像、查看更多、播放全部；浏览与播放入口可以同时存在 |
| 分区内容 | 歌曲列表、横向卡片、目录网格、分组心情按钮分别呈现；卡片超过 14 项仍可访问 |
| 分类目录 | 心情与流派及通用分区打开真正的 browse 页面；不伪装为带空封面、零首歌曲的歌单 |
| 播客与视频 | 支持 immersive carousel 和 multi-row episode；从播放覆盖层读取单集 ID；封面比例来自 renderer 数据 |
| 分区播放 | 使用实际队列端点或当前分区歌曲；队列端点支持 playlist-only、params、index，保留重复条目与选中位置 |
| 导航与返回 | 手机和桌面使用最近的主标签路由；详情返回恢复发现标题、分类和已加载分页；重选主标签回到该标签根页面 |

首页初始状态为加载中的在线内容。个人快速选歌只从喜欢的歌曲和个人音乐库中组成；分类空结果展示明确空态与刷新、清除入口。

## 原版源码依据

对照版本：[Metrolist `e6fea3b36c68841bad21daa6252e1d69ecd3afbe`](https://github.com/MetrolistGroup/Metrolist/tree/e6fea3b36c68841bad21daa6252e1d69ecd3afbe)。

| 原版源码 | 对照重点 | 本仓库实现 |
| --- | --- | --- |
| `app/src/main/kotlin/com/metrolist/music/ui/screens/HomeScreen.kt` | 首页分类、分区更多/播放、歌曲列、混合卡片和单集播放 | `src/pages/Home.tsx`、`src/components/Discovery.tsx` |
| `app/src/main/kotlin/com/metrolist/music/viewmodels/HomeViewModel.kt` | 筛选参数、恢复未筛选首页、保留 chip 列表和加载下一页 | `src/store.ts`、`src/api.ts` |
| `innertube/src/main/kotlin/com/metrolist/innertube/pages/HomePage.kt` | 原生首页 chip 与分区元数据 | `server/catalog.mjs` |
| `innertube/src/main/kotlin/com/metrolist/innertube/YouTube.kt` | 首页 browse 请求、continuation、next 队列选中位置 | `server/catalog.mjs`、`server/index.mjs` |
| `innertube/src/main/kotlin/com/metrolist/innertube/models/renderer/MusicTwoRowItemRenderer.kt` | 播客单集与普通集合的类型判断 | `server/catalog.mjs` |
| `app/src/main/kotlin/com/metrolist/music/ui/screens/BrowseScreen.kt` | 分类目录和网格浏览 | `src/pages/Discover.tsx`、`src/navigation.ts` |

卡片保留实际缩略图比例，是依据真实 WEB_REMIX renderer 数据的呈现改进；不声称与上述 Kotlin 首页的每一处图片比例完全相同。

## 验证记录

- 服务端完整回归：**64 项通过**，包括首页参数、页面级分页、访客身份、分区动作、单集、图片比例与播放队列。
- Rust 扩展检查与构建、TypeScript 7.0.2 检查通过。
- 真实匿名首页返回 11 个本地化分类；“专注”返回“阅读和学习、心流状态、交响乐研究”，其 continuation 继续加载三个分区。
- 真实心情目录保留“心情和场景”和“流派”；“爵士乐”返回五个 browse 分区。
- 真实 playlist-only next 请求返回 50 个队列条目、实际选中位置和电台 continuation。
- 首页交互回归：**7 项通过**，覆盖 340 点 Android 布局、原生返回、分类请求、竞态、分页/刷新、目录网格、两种分区播放、第 16 张卡片与空态。
- 导航和完整界面回归、生产 Web 构建及发布结果在完成后补记。

本轮验证围绕首页与发现流程。手机原生触摸、系统返回和布局通过 NSH 平台测试覆盖；真机安装与音频出声应以实际设备验收记录为准。本轮没有把完整播客订阅、automix 队列续接或其他尚未移植的功能标为完成。
