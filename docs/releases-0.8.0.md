# 0.8.0：Spotify 真实 Web 与手机接入

0.7 / 0.7.1 将上游的 Web、Android、iOS 演示分支一并移植了。这个版本将三者的
普通入口改为真实播放器与真实账号数据，保留桌面的 Rust/CDP 引擎和 NSH 原生 UI。

## 实现

- Web：OAuth PKCE、授权回跳、访问令牌刷新、官方 Web Playback SDK、本机浏览器
  Spotify Connect 设备、真实播放状态、播放 / 暂停 / 切歌 / 定位 / 随机 / 循环与收藏。
- Android：官方 App Remote 0.8.0、浏览器 PKCE、Intent 回调、实际 Spotify 应用
  连接、手机本机设备选择、队列索引、音量、生命周期重连及真实状态订阅。
- iOS：Rust 导出与 Objective-C 桥、ASWebAuthenticationSession PKCE、Keychain
  会话、官方 Spotify iOS SDK 5.0.1、真实曲目 / 进度事件与上下文队列播放。
  构建脚本处理 SDK 固定下载、动态框架嵌入、运行时路径及签名。
- 共享数据：真实首页、搜索、账号、收藏、歌单、专辑、艺人发行，2026 API 端点，
  LRCLIB 同步 / 普通歌词和真实封面取色。正常路径没有虚构账号和虚构曲库。
- 工作区：YouTube Music / Spotify 独立账号、导航、缓存与播放器；切换等待已有
  播放指令完成后暂停离开的服务。Web 登录回跳恢复 Spotify 工作区。
- 原界面：14 种音乐灯光、分层全屏播放器、封面翻转、歌词、列表入场、图标与喜欢
  动画继续使用 NSH。显式演示启动参数只用于可复现的交互和动画压力测试。

## 首次连接

打开 Spotify 工作区，按连接页面配置自己的公开 Client ID 与回调地址，然后授权。
Web 音频要求 Premium；原生手机需要安装 Spotify，并登记真实应用标识和 Android
签名。配置步骤在 [Spotify 说明](spotify.md)，无需向项目提交 Client Secret。

## 验证记录

| 检查 | 本次结果 |
| --- | --- |
| `nsh check` / TypeScript / 原生导出 | 本地通过 |
| Web 发行构建 | WASM runtime 与部署包构建通过，版本 0.8.0 / build 10 |
| Web SDK / PKCE / API / 歌词协议 | 24 / 24 通过 |
| 正常 HostBackend 连接与实际响应映射 | Web、Android、iOS 共 3 / 3 通过 |
| 工作区交接 / 恢复 / Android 媒体控制 | 6 / 6 通过 |
| 完整 NSH 回归 | 240 项：229 通过、0 失败、11 项按条件跳过（原生截图、压力场景等） |
| Android 官方 SDK | 全部 Java 宿主编译、D8、PKCE 与真实 SDK 模型 / 取色测试通过 |
| Rust 真实封面调色板 | 新增单元测试通过 |
| macOS / iOS / Windows / Linux 发行构建 | 以 [PR #7 的平台 checks](https://github.com/lurenjia534/Metrolist-NSH/pull/7/checks) 为准；Linux 本地检查不代替 Apple SDK 编译 |

连接用例使用明确标识的 Host 协议夹具，测试生产 HostBackend、Spotify HTTP 请求
与数据映射，不走 DemoBackend。它们检查未登录没有虚构曲库、真实形状的账号数据、
收藏成功的空 200 响应、授权后工作区恢复、切换后状态订阅，以及手机歌单前有
非歌曲条目时仍将正确原始索引交给 SDK。

另外逐目录核对了上游的 34 个 shell/page/component 生产文件，未发现意外漏移植。
自动更新归 Metrolist 发布流程，未启用会更新到独立 Spotish 的上游 updater；
手机 / Web 的音乐灯光保留上游时间驱动模式，尚无真实音频频谱采样。iOS 音量
使用设备音量键。这些平台差异没有伪装成已完成的能力。

没有可供本次验证的 Spotify Developer 应用 / 已授权账号，也没有连接真实手机。
协议与 UI 测试验证代码请求、回调和状态交接；它们不证明实际账号、DRM 音频输出、
物理设备后台行为或 GPU 动画帧率。真实账号与真机验收尚未完成。
