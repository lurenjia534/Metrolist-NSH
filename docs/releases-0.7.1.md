# 0.7.1：手机触摸操作与 Web 同步

应用版本 `0.7.1`，构建号 `9`。

## 手机操作

- Spotify 卡片播放按钮在手机布局中直接显示，消除依赖鼠标悬停的不可见播放热点。
- 手机迷你播放器的播放按钮使用至少 44px 的触摸区域。
- 全屏播放器的内容避开左右安全区域，横屏时关闭键和控制按钮不贴近刘海边缘。
- 服务切换、Spotify 底部导航、音乐库与全屏播放器继续使用独立的手机布局。

## Spotify 播放现状

Web、Android、iOS 仍使用 `DemoBackend`，显示“Spotify 预览 · 示例数据”。
模拟播放进度与动画不代表真实音频播放。这次触摸修复没有实现手机 Spotify 播放。
桌面 Rust / Chromium / CDP 路径与 YouTube Music 原有播放路径保持原有实现。

手机浏览器的真实播放可使用 Spotify 官方
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)。
该 SDK 支持移动浏览器，要求 Premium 播放账号、开发者应用 Client ID、已登记的回调地址及 OAuth 授权；
iOS 还需通过用户手势激活播放。接入时可以保留 NSH 界面，将 SDK 和 PKCE 授权放在现有 Web Host 中。
当前版本尚未实现这些接口，也未通过真实账号出声验证。

Android 与 iOS 原生端可以采用官方
[Android SDK](https://developer.spotify.com/documentation/android) /
[iOS SDK](https://developer.spotify.com/documentation/ios)，
控制手机上已安装的 Spotify 应用。它们与桌面后台 Chromium 不是同一条播放链路。

## Web 发布

应用站点使用既有网址：
[Metrolist NSH](https://metrolist-nsh-miku.lurenjia534.chatgpt.site)。
GitHub 合并与 Site 发布是独立步骤。发布时同步合并后的源码、构建 Web 包、发布到既有 Site，
并检查线上版本号及服务切换界面；仅合并 PR 不代表站点已经更新。
