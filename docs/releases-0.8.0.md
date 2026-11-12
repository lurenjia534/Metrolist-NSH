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

版本提交前填写本次实际执行的编译与测试结果。

没有可供本次验证的 Spotify Developer 应用 / 已授权账号，也没有连接真实手机。
协议与 UI 测试验证代码请求、回调和状态交接；它们不证明实际账号、DRM 音频输出、
物理设备后台行为或 GPU 动画帧率。真实账号与真机验收尚未完成。
