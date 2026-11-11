# Metrolist NSH 界面规范

原版依据：Metrolist e6fea3b 的 HomeScreen、LibraryScreen、Player、MiniPlayer、各曲库子页及 fastlane 六张截图。主任务是发现、保存与播放音乐。主导航：首页、搜索、音乐库；一起听、历史、统计、下载、设置是明确的子入口。首页直接展示快速选歌、继续聆听、在线推荐与发现分类。

## 基础

- 平台：桌面与网页共用侧栏布局，窄屏使用三项底栏。窄屏操作目标48，桌面图标按钮36。
- 颜色：深色/纯黑/浅色，通过 ui 的 palette 语义角色定义；紫灰选中面、薰衣草主色，照片保留原图。
- 字体：正文桌面14、手机16；辅助12；小标题20/24；页面标题28/32。标题最多两级。
- 间距：4/8/12/16/24/32；图片圆角8/12，大播放器封面24，Material选项chip为圆角胶囊。
- 共享控件由 src/ui.tsx 提供。按钮、菜单、Dialog、Switch、Slider、Tab使用NSH base的行为、键盘和无障碍语义。
- 列表由List虚拟化；首页横向架控制页内条目数。页面拥有自己的Scroll，输入与列表同一边距。
- 状态：收藏/保存显示状态，下载显示进度、取消/重试、离线播放。空白只在实际没有内容时显示。网络失败保留页面及重试入口。

## 页面与状态所有者

共享领域状态归store/playback；导航与全局编辑目标归navigation；页面搜索/排序草稿为页面signal。单一播放器跨导航保持。所有平台只播放音频，浏览器host只处理文件、MediaSession等浏览器能力。

## 动作与过渡清单（实现前）

| 范围 | 状态变化 | 表现 | 减少动态效果 |
| --- | --- | --- | --- |
| 全局控件 | 悬停/按下/焦点 | 120ms颜色、160ms轻缩放；键盘焦点描边 | 取消缩放与过渡 |
| 主导航/库筛选 | 当前项切换 | 选中填充与文字颜色120ms；语义selected | 即时 |
| 首页/搜索/详情 | 网络内容到达 | 单次短淡入；保留原内容刷新，不对每个进度tick重建 | 即时 |
| 歌曲/歌单菜单 | 打开/关闭 | NSH Menu popup，桌面锚定、手机sheet | 即时 |
| 创建/导入/排序 | Dialog打开/关闭 | NSH Dialog fade，输入获得焦点，Escape/返回关闭 | none |
| 播放器 | 展开/收起 | 全屏Dialog slide，播放状态持续 | none |
| 播放器 | 播放/暂停/缓存 | 控件图标和文本跟随真实状态，160ms按下反馈 | 即时 |
| 歌词 | 当前行改变 | 高亮120ms，Scroll/ List平滑定位；手动滚动后可回到当前行 | 即时定位 |
| 队列/歌单 | 移动/移除 | 按原位置更新列表，不重新播放其他条目 | 即时 |
| 下载 | 进度 | 真实字节与进度条；无额外循环装饰 | 相同 |
| 统计 | 区间切换 | 真实数据重算与图表更新 | 即时 |
| 一起听 | 连接/房间/参与者 | 文本与状态图标，实际WebSocket结果驱动 | 相同 |
| 提示 | 出现/消失 | ToastManager保留进入/停留/退出，原生Toast在160ms内淡入/淡出 | 即时 |

## 验证记录

构建、状态回归、实际浏览器与平台检查分别记录。未实际观察的外观、动效、屏幕阅读器与设备音频输出不得记为已通过。

## Android 布局与原生动效调整（0.4 实施清单）

依据 NSH `c5214aa` 的 Animation、Tabs、Slider、Safe area 文档，以及官方 Design/Coding Guides。
时长、距离与按压比例统一放在 `src/motion.ts`；保留现有 Material 音乐播放器视觉语言。
所有 animation values 在所属组件中创建一次，UI 线程执行插值；不创建 JavaScript 每帧循环。

| 变化 | 工具与动作 | 减少动态效果 |
| --- | --- | --- |
| 播放器打开/关闭 | 常驻 Dialog 的 open 状态交给 NSH 原生 modal 生命周期，关闭动画结束后释放内容 | animation none |
| 主导航 | NSH Tabs原生单个indicator随选中项移动；标签颜色120ms过渡；页面过渡由NavPage负责 | 即时 |
| 弹窗与菜单 | 受控Dialog/Menu保持挂载，由原生生命周期协调打开、关闭、焦点与退出卸载 | animation none |
| 播放/暂停 | 两枚稳定 glyph，单个 animated value 在160ms内交叉淡变与缩放 | 立即切换 |
| 歌曲/歌词/队列切换 | NSH Tabs 原生单个 indicator；内容在160ms内淡入，仅选择变化时执行 | 即时 |
| 更换歌曲封面 | 单个 retained motion，在240ms内轻微缩放与淡变；时间进度不触发 | 即时 |
| 控件按下 | 160ms原生颜色与transform过渡；按钮0.97、图标按钮0.95 | 不缩放、无过渡 |
| 迷你播放器进度 | animated value驱动scaleX，240ms线性插值；固定轨道不随时间重新布局 | 直接定位 |
| 拖动播放位置 | NSH Slider原生1:1跟手；onChange仅更新草稿，onChangeEnd才发送一次seek | 相同 |
| 歌词换行 | 行颜色120ms原生过渡；仅活动行变化时平滑定位，手动滚动关闭跟随 | 立即定位 |
| 队列增删/重排 | 列表保持稳定内容，直接更新；不对连续媒体tick做LayoutAnimation | 相同 |
| 通知 | 常驻ToastHost订阅现有message；ToastManager保留ending阶段160ms，ToastStack负责位置弹簧；文档规定的50ms计时只推进生命周期 | 无位移和渐变 |

播放器布局以可用区域而非固定设备型号计算：header/footer不收缩；中间一层Scroll/List拥有滚动。
短横屏使用左右分区，封面与控制区均可缩小；长标题可换行但不挤出播放、关闭和切换入口。
滑轨的触摸带在手机为48dp，绘制的轨道与触摸区域分离。需要校验340/360/390竖屏及短横屏。
本节是实施与验证清单，不代表已经在Android真机上观察通过。

官方实现依据均按构建所用NSH `c5214aa`核对：[原生动画](https://github.com/longbridge/nsh/blob/c5214aa/website/docs/animation.md)、[Dialog](https://github.com/longbridge/nsh/blob/c5214aa/website/elements/dialog.md)、[Tabs](https://github.com/longbridge/nsh/blob/c5214aa/website/elements/tabs.md)、[Slider](https://github.com/longbridge/nsh/blob/c5214aa/website/elements/slider.md)、[Toast](https://github.com/longbridge/nsh/blob/c5214aa/website/elements/toast.md)、[Safe area](https://github.com/longbridge/nsh/blob/c5214aa/website/elements/safe-area.md)、[Design Guides](https://github.com/longbridge/nsh/blob/c5214aa/skills/nsh-design-guides/references/design-guides.md)与[Coding Guides](https://github.com/longbridge/nsh/blob/c5214aa/skills/nsh/references/coding-guides.md)。Toast使用该版本已有API，不引入Web/CSS动画库。

### 已执行的交互回归

`tests/player-motion.test.tsx`的两个headless用例通过：360×740并带上下24px安全区，在普通/减少动态效果设置下，手指保持拖动时没有seek、释放后恰好一次seek；切换歌词/队列、关闭再打开播放器不会重新打开音源；旋转到740×360后仍可切换面板、滚动操作播放按钮并关闭播放器。

`tests/toast.test.tsx`的两个headless用例通过：普通/减少动态效果设置下，通知可以在退出过程中更新内容、超时退出、滑动关闭，并可再次显示同一条消息。

`tests/layout-interactions.test.tsx`的三个Android平台headless用例通过：340×640、800×360、800×1100，均带上下24px安全区。搜索提交/清空、音乐库筛选/排序/视图切换、新建弹窗关闭再打开、保存歌单、歌单上移/下移/移除、歌词偏移增减与重置均可完成；短屏先滚动到对应内容，平板在内容可完整容纳时直接操作。

上述回归验证输入、状态和生命周期，不证明Android真机的像素布局、帧率或实际音频输出。
