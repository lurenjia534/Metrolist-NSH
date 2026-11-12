# 0.7.0：Spotify 独立工作区

应用版本 `0.7.0`，构建号 `8`。本版本从 Spotish 提交
[`63d320103cf87e3731844b54e71df7f786724a90`](https://github.com/huacnlee/spotish/tree/63d320103cf87e3731844b54e71df7f786724a90)
移植完整 NSH TSX 界面、动画和 Rust / CDP 播放核心。

## 变化

- 顶部切换 YouTube Music 与 Spotify，两边独立保存账号、音乐库、导航和播放状态。
- 切换前暂停当前播放器，返回时保留队列和页面；选择在重启后恢复。
- Spotify 桌面使用本机已有的 Chromium 系浏览器播放，Rust 管理进程、登录和 CDP；应用继续无需 Node 运行时。
- 集成首页、搜索、音乐库、合集、喜欢、排序、迷你 / 全屏播放器和同步歌词。
- 保留 14 种封面配色音乐灯光、每曲随机效果、按压反馈、图标变形、列表波浪与封面翻转。
- 系统媒体控制、托盘与主题跟随绑定在 Spotify 工作区生命周期内。
- Web、Android、iOS 的 Spotify 入口显示明确演示标记，虚构目录与模拟进度用于界面体验。
- 增加上游 UI、桥接、Rust 响应解析和 WGSL 编译测试，以及双工作区切换回归测试与 Linux 原生截图。
- NSH 更新为稳定版 `0.5.0 / f4d68f7`，修复菜单卸载时访问已释放响应式状态的问题；CLI、Rust、平台组件与源码归档使用同一版本。
- 340px 桌面窗口的 Spotify 搜索使用独立输入行，播放控制与音乐灯光菜单保持各自可点击；手机短横屏使用侧边服务切换栏。
- iOS 已导入和下载的本地音频复用 Rust 媒体通道，支持流式读取与 Range 定位；曲库继续保存原文件地址，暂停和恢复复用当前播放来源。

## 平台与账户

实际 Spotify 播放仅适用于 Linux、macOS、Windows，要求本机有支持 Widevine 的
Chrome、Chromium、Edge 或 Brave，并完成 Spotify 账号登录。Free / Premium
的能力和广告由 Spotify 原播放器决定。

Web 与手机平台没有实现真实 Spotify 播放或桌面远程控制。Windows 的音乐灯光
保留基础动画，上游音频频谱监测当前实现于 Linux 与 macOS。YouTube Music 的
各平台播放、下载与账号能力沿用项目原有实现。

Spotify 浏览器配置放在 Metrolist 专用目录，不复用独立 Spotish 的默认配置。
YouTube 一起听房间在切换到 Spotify 时断开；房间远端命令和旧工作区媒体键
不会在背后启动 YouTube。用户再次选择 YouTube Music 后可手动恢复播放或加入房间。

## 验证记录

在固定的 NSH `0.5.0 / f4d68f7` 上，应用 `nsh check` 与 `nsh build` 均通过，
产出约 880.1 KB JavaScript、2.8 MB NSH 字节码和 29 项资源。
Rust `cargo check --all-targets` 通过，单元测试 73 项通过、0 失败，3 项需要
实际设备的测试忽略；导入的 WGSL 全部通过该版本的着色器编译。
Spotify 浏览器桥 26 项测试全部通过，生成源与 `bridge.js` 一致。
新增的 Rust 本地音频测试实际读取 WAV 文件，验证完整读取、HEAD、206 Range、
中文与百分号文件名，以及释放播放来源后原文件仍保持完整。

原生状态回调回归 1 项、340px 桌面交互 2 项、迟到播放结束事件回归 1 项、
iOS 本地音频生命周期回归 1 项均通过。完整 NSH 交互套件、跨平台打包与
Linux 原生截图由 [GitHub Actions](https://github.com/lurenjia534/Metrolist-NSH/actions/workflows/build.yml)
执行；每次提交的结果和截图以对应运行记录及其工件为准。
本地已备齐 GTK / WebKitGTK 依赖，执行环境限制显示与本地套接字，原生窗口
截图使用 Linux CI 的显示环境。未使用真实 Spotify 账号完成登录或出声验证。
编译、演示测试或流水线配置不等于桌面账号登录和出声验证。

本版本的测试分层如下：

| 验证项 | 覆盖内容 |
| --- | --- |
| NSH check / build | Rust 导出、TSX 类型、组件与应用 bundle |
| Rust 单元测试 | CDP、会话、录制响应、浏览器路径、平台音频分析与 WGSL 编译 |
| Spotify bridge 测试 | DOM 控制、请求数据、播放器状态、广告期间操作与桥接生成源一致性 |
| NSH 演示交互测试 | Spotify 页面 / 播放器 / 歌词 / 排序 / 动画菜单，双工作区交接与状态独立 |
| Linux 原生截图 | 真实 NSH Linux 渲染器下的首页、合集、全屏和窄屏播放器 |
| 真实账号出声 | 需要安装含 Widevine 的浏览器、实际 Spotify 会话与音频设备；与上述演示测试分别记录 |

## 构建与来源

NSH 使用官方稳定版 [`v0.5.0`](https://github.com/longbridge/nsh/releases/tag/v0.5.0)，
完整 revision 为 `f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1`；Rust 编译器为 `1.99.1`。
固定版本由 `scripts/nsh-toolchain.json`、`native/Cargo.toml` 及发布工作流共同确定。
九份平台归档的摘要来自该官方发布，源码归档按完整 revision 下载并计算 SHA-256；
项目镜像使用独立 `nsh-runtime-f4d68f7` 标签。没有把上游应用自动更新器带入 Metrolist。
发布包附带 `third-party/spotish/` 的许可证、上游 NOTICE 和修改说明。

完整使用、架构、数据位置、动画清单和复现命令见 [Spotify 工作区](spotify.md)。
