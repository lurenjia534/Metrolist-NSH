# Metrolist NSH · macOS

将 **Metrolist.app** 拖到“应用程序”文件夹，然后双击打开。下载名称中的 `arm64` 对应 Apple Silicon，`x64` 对应 Intel Mac；需要 macOS 14 或更新版本。

应用直接启动 NSH 原生程序，包内包含 QuickJS 应用与 Rust 原生 Host，无需安装 Node、Python 或 NSH。音乐 API、账号和音源解析在应用内执行，HTTP 请求使用 NSH 原生网络能力。

当前应用采用 ad hoc 签名，尚未经过 Apple Developer ID 公证；发行文件名和构建报告不会把它标成已公证版本。

音乐服务地址默认留空，表示本机直连。下载由 Rust Host 流式写入应用数据目录，离线播放直接读取本机文件；没有独立的本机音乐网关，也不占用 8787 端口。需要额外请求头的在线音频由同一 Rust 进程内的媒体转发处理；自定义远程音乐服务仍可在设置中选择。

源码和许可证见 README、COPYING、NOTICE 与 licenses 目录。完整应用目录必须一起保留。
