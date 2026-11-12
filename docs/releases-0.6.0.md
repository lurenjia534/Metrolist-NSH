# Metrolist NSH 0.6.0 — Native First

桌面应用不再捆绑或启动 Node.js。NSH 原生可执行文件直接加载 TSX / QuickJS 业务代码；系统文件和音频传输通过静态链接的 `metrolist/native` Rust 模块完成。

## 原生架构

- Linux / macOS / Windows 的默认音乐连接改为 NSH 原生 `fetch`，共享目录、账号、曲库、搜索和音源解析代码在 QuickJS 内执行。
- 桌面包移除 Node 二进制、gateway 目录、固定 8787 端口启动器、Windows C# 包装启动器及对应 Node 工具链锁。桌面和 iOS 构建命令直接调用 NSH。
- `NativeFiles` 使用 Rust / reqwest / Tokio 将音频分块写入文件，提供进度、取消、重试、原生文件复制。桌面导入音乐不再把整个文件读入 JS。
- 通用 `AudioPlayer` 无法接收 HTTP 请求头，因此 `NativeMedia` 在应用进程内提供按需启动的 loopback 音频转发，保留源站请求头、Range、HEAD、状态和响应长度。它不处理账号和曲库 API，没有独立服务进程。播放器释放时同步释放源句柄。
- iOS / macOS 包声明本地网络及 127.0.0.1 的 ATS 例外，使系统音频播放器能够访问进程内转发接口。参见 [Apple NSAllowsLocalNetworking 文档](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)。
- Android 保留 Media3 原生播放、原生文件 Host，并补齐下载源请求头。Web 保留浏览器 Host 和独立 Worker API；Node 仅用于可选 Web 开发服务器、Web 构建脚本和服务器测试。

## 使用体验

- 下载中心增加歌曲 / 歌手 / 专辑 / 文件名搜索、分类数量、传输总进度、当前筛选结果播放和批量取消 / 重试 / 清理。
- 桌面已下载音乐可通过系统保存窗口导出，或直接在文件管理器中定位。
- 连接设置展示实际保存的连接方式，提供自定义服务和一键恢复默认直连。
- 旧版桌面自动填写的 `http://127.0.0.1:8787` 在首次升级时迁回原生直连；用户之后主动填写的相同地址及其他自定义服务保持有效。
- 旧版已完成的本机 gateway 下载复制到应用数据目录，保留源文件；离线播放不再请求 `/api/offline`。
- 下载记录保存在设备上，独立于音乐服务地址。下载失败或取消不会丢失被替换的已有离线歌曲；重新下载成功后才切换到新文件。
- 长 URL 标识符和中文标题保留在元数据中，磁盘文件使用短名称，避免正常音乐文件超出系统文件名长度。

## 验证

本地已完成：NSH 完整套件 **91 / 91**，新增替换下载回归验证通过；Rust 的真实 HTTP / 文件系统测试 **7 / 7**；Rust 模块的 WebAssembly 编译检查通过。原共享服务器测试 **55 / 55** 通过，服务器实现本次未改变。类型检查使用 NSH 自带的 TypeScript 7 原生编译器。

Rust 测试覆盖超过 9 MiB 音频的完整写入与复制、长 URL / Unicode 文件名、开始工作前取消、传输中取消及清理、同一首歌曲立即重试、HTTP 401、请求头传递、Range / HEAD、释放源后 404，以及上游尚未结束时即可转发首段音频。

CI 从提交重新构建 Linux、Windows、macOS ARM64 / x64、iOS Simulator / device 和 Web。桌面包检查可执行文件格式、应用字节码、版本及不存在 Node / gateway，并实际启动产物。Linux / Windows 检查窗口存在；macOS 检查进程存活。Android 发布继续使用已有 Preview 签名配置。

各平台的构建和启动结果以本次 PR / main Actions 记录为准；脚本存在不表示对应构建已通过。没有在用户真机上测量音频输出、启动耗时、内存差值或帧率。

## 平台说明

- iOS 新增原生本机下载与离线播放；导出音频到“文件”尚未实现，界面不提供桌面专用保存/定位动作。
- 原生文件请求目前由 NSH 桌面平台提供；iOS 音乐导入仍使用其现有 Picker 路径。
- 本次应用版本 0.6.0 / build 7；NSH 固定为 0.4.0 / `c5214aa`，Rust 工具链为 1.99.1。
