# Spotify 独立工作区

Metrolist NSH 0.7 将 [Spotish](https://github.com/huacnlee/spotish/tree/63d320103cf87e3731844b54e71df7f786724a90)
的原生界面、动画和 Rust 播放核心嵌入应用。顶部工作区切换器选择
YouTube Music 或 Spotify；两边各自拥有账号、曲库、导航和播放器。

## 平台能力

| 平台 | Spotify 工作区 | 播放方式 |
| --- | --- | --- |
| Linux、macOS、Windows | 实际账号、浏览和播放 | Rust 启动已安装的 Chromium 系浏览器，通过 CDP 操作 Spotify Web Player |
| Web | 明确标注的界面演示 | 虚构目录、模拟播放器状态，没有 Spotify 音频 |
| Android、iOS | 明确标注的界面演示 | 同一 TSX 的手机布局、虚构目录与动画，没有 Spotify 音频 |

桌面需要 Chrome、Chromium、Microsoft Edge 或 Brave，以及浏览器可用的
Widevine 模块和 Spotify 账号。应用不捆绑浏览器或 Widevine。
移动端和网页不能按桌面方式启动、持有和控制这个后台浏览器；桌面远程控制
也尚未实现。YouTube Music 在各平台继续使用其现有播放链路。

## 开始使用

1. 安装并运行 Metrolist 桌面包，在顶部选择 **Spotify**。
2. 在 Spotify 工作区点 **Log in**，使用打开的浏览器窗口完成 Spotify 登录。
3. 按登录界面的提示关闭登录窗口，返回原生工作区浏览和播放。

Spotify 登录保存在本应用独立的浏览器配置中，后续启动可继续使用。
账号菜单提供退出。免费账号按 Spotify 原播放器的规则播放，支持播放合集；
Premium 的逐曲播放能力也由原播放器提供。广告照常播放。

桌面应用不需要 Node.js。TSX 在 NSH 的 QuickJS 中运行，Rust 持有浏览器进程、
CDP WebSocket、会话与原生平台集成。浏览器只负责 Spotify 网页播放器，用户看到
的工作区由 NSH 原生组件绘制。

### 手动选择浏览器或配置目录

| 环境变量 | 用途 |
| --- | --- |
| `SPOTISH_BROWSER` | 使用指定的浏览器可执行文件 |
| `SPOTISH_PROFILE` | 从已有浏览器配置导入登录；导入前关闭该浏览器 |
| `SPOTISH_DATA_DIR` | 覆盖 Spotify 专用数据目录，用于独立运行实例或排查问题 |

例如 Linux：

```sh
SPOTISH_BROWSER=/usr/bin/chromium ./Metrolist
```

默认数据目录：

| 系统 | Spotify 数据目录 |
| --- | --- |
| Linux | `$XDG_DATA_HOME/metrolist/spotify`，未设置 XDG 时为 `~/.local/share/metrolist/spotify` |
| macOS | `~/Library/Application Support/app.miku.metrolist/spotify` |
| Windows | `%LOCALAPPDATA%\Metrolist\spotify` |

目录内的 `browser/` 保存 Spotify 配置，`logs/chromium.log` 保存浏览器日志。
该目录与独立 Spotish 程序及 YouTube Music 账号数据分开。

## 工作区切换行为

切换先暂停当前播放器，再显示另一套界面。返回时保留曲目、队列与导航页面，
不会自动恢复播放。顶部选择记入 `metrolist.provider`，下次打开恢复上次选择。
Spotify 的界面存储使用 `spotify:` 前缀，YouTube Music 使用原有 `metrolist.*`
记录；两边的收藏、登录、搜索和主题偏好各自使用自己的状态。

从 YouTube Music 切换到 Spotify 时，一起听房间会断开，防止房间消息随后在
后台启动 YouTube 播放。浏览器 / Android 发来的 YouTube 媒体控制命令只在
YouTube 工作区生效。Spotify 的系统媒体控制与桌面集成随工作区进入和离开
安装、释放。

## 界面与功能

| 区域 | 已接入内容 |
| --- | --- |
| 导航 | 首页、搜索、侧栏音乐库、后退 / 前进、页面栈；手机底部导航与音乐库抽屉 |
| 音乐内容 | 个人首页、搜索歌曲 / 专辑 / 艺人 / 歌单、合集详情、喜欢的歌曲与音乐库 |
| 曲目列表 | 虚拟化列表、标题 / 艺人 / 专辑 / 时长 / 添加时间排序、正反序、紧凑显示 |
| 播放器 | 播放 / 暂停、前后曲、进度、音量 / 静音、随机与循环、喜欢、悬浮播放器 |
| Now Playing | 分层进入的全屏播放器、封面、同步歌词、点击歌词定位和窄屏布局 |
| 桌面集成 | Linux MPRIS、Windows 系统媒体控制、macOS 媒体控制、托盘 / 窗口操作；可用时跟随系统主题 |
| 键盘 | 空格播放 / 暂停、区域导航、列表方向键与回车、快捷键说明 |

Spotify 的操作通过其网页播放器和页面使用的数据完成。上游网页的变更可能
需要更新 `src/spotish/bridge/bridge.js`；选择器与数据读取集中在这个桥接文件中。

## 动画与音乐灯光

播放器条和 Now Playing 使用同一灯光设置。保留上游的 14 种效果：

| 序号 | 效果 | 序号 | 效果 |
| --- | --- | --- | --- |
| 1 | Dots | 8 | Halo |
| 2 | Grid | 9 | Aurora |
| 3 | Wave | 10 | Mountains |
| 4 | Orb | 11 | Mesh |
| 5 | Spectrum | 12 | Particles |
| 6 | Bars | 13 | Strings |
| 7 | Ribbons | 14 | Current |

**Random** 在换曲时选择不同效果。颜色来自封面，偏好保存在
`spotify:visual:effect`。Linux 使用可用的 `parec` / PulseAudio 或 PipeWire
音频监测，macOS 14.2+ 使用 Core Audio 进程音频捕获；Windows 及无法采集音频
的场景保留灯光的基础动画，不声称具备实际频谱跟随。Linux 可安装
`pulseaudio-utils` 提供 `parec`。

界面同时保留按压 / 悬停反馈、图标变形、播放图标切换、喜欢粒子、列表波浪
入场、封面翻转、弹出菜单和分层全屏播放器。动画使用 NSH 动画值和着色器，
减少动态效果的系统设置会让它们静止或立即完成。播放暂停时音乐灯光也停止
推进。

集成没有宣称某个 FPS 或性能提升比例。真实性能需在目标设备以原生渲染器测量；
虚构目录的测试可以验证操作与动画代码，但不能代替真实账号出声和 GPU 帧时间。

## 代码入口

| 文件 / 目录 | 职责 |
| --- | --- |
| `App.tsx`、`src/providers.ts` | 应用壳、工作区恢复 / 切换、播放交接与主题 |
| `src/spotish/App.tsx` | 可挂载的 Spotify 工作区与平台集成生命周期 |
| `src/spotish/backend/` | Rust 引擎接口与显式演示后端 |
| `src/spotish/state/`、`data/` | Spotify 独立状态、会话与账号缓存 |
| `src/spotish/pages/`、`shells/`、`components/` | 页面、桌面 / 手机布局、动画和音乐灯光 |
| `src/spotish/bridge/bridge.js` | 注入 Spotify Web Player 的浏览器桥 |
| `native/src/spotish/` | Rust 引擎、浏览器进程、CDP、原生媒体控制与音频监测；统一通过 `metrolist/native` 导出 |
| `third-party/spotish/` | 上游许可、NOTICE、图标许可与移植来源 |

Spotify 工作区不使用上游 Spotish 自动更新器，整个应用仍由 Metrolist 的
版本与发布流程更新。

## 验证

完整检查使用 NSH 稳定版 `0.5.0 / f4d68f7` 与 Rust `1.99.1`。运行时、
各平台组件和源码的固定下载摘要记录在 `scripts/nsh-toolchain.json`：

```sh
python3 scripts/run-nsh.py check
python3 scripts/run-nsh.py build
python3 scripts/run-nsh.py test --web-host tests/native-login/host.js
SPOTISH_DEMO=1 python3 scripts/run-nsh.py test tests/spotify-native.test.tsx
cargo test --manifest-path native/Cargo.toml
node --check src/spotish/bridge/bridge.js
node --test src/spotish/bridge/tests/*.test.mjs
node src/spotish/bridge/gen-source.mjs --check
```

Node 只用于此处的构建期桥接测试和已有 Web 开发任务，不进入桌面发行包运行链路。
桥接源有修改时运行生成命令，不直接改生成文件：

```sh
node src/spotish/bridge/gen-source.mjs
```

`tests/spotify-ui.test.tsx` 在显式演示后端验证上游交互；
`tests/spotify-switching.test.tsx` 验证服务间暂停、导航恢复、存储隔离和移动端
演示标记。Rust 测试使用录制的响应与测试服务，着色器测试使用项目当前 NSH
编译全部导入的 WGSL。

`tests/spotify-native.test.tsx` 用 Rust 录制数据模式验证真实原生回调：
缓存账号重新加载和工作区卸载 / 重挂载后，播放器状态订阅继续接收 Rust 更新。
这里的 `SPOTISH_DEMO=1` 不需要启动 Chromium 或登录 Spotify；正常启动桌面应用
不设置该变量即可使用真实引擎。

原生截图（需要桌面显示环境）与可选性能场景：

```sh
python3 -c "from pathlib import Path; Path('dist/smoke').mkdir(parents=True, exist_ok=True)"
METROLIST_SPOTIFY_VISUAL=1 python3 scripts/run-nsh.py test --target linux tests/spotify-visual.test.tsx
SPOTISH_BENCH=1 python3 scripts/run-nsh.py test --target linux --fps -v tests/spotify-bench.test.tsx
```

截图写入 `dist/smoke/spotify-*.png`。Linux CI 在打包烟测后执行原生截图并上传。
基准涵盖播放静止页、首页与长歌单滚动、导航切换、反复打开 Now Playing，以及
多页访问后的静止状态；它们仅在显式启用时执行。

本次实际执行结果与尚未验证的项目见 [0.7 发布说明](releases-0.7.0.md)。
