# Metrolist NSH · macOS

将 **Metrolist.app** 拖到“应用程序”文件夹，然后双击打开。下载名称中的 `arm64` 对应 Apple Silicon，`x64` 对应 Intel Mac；需要 macOS 14 或更新版本。

应用内已经包含 Node.js 24、音乐 gateway 和 NSH 原生程序，无需安装 Node、Python 或 NSH。打开应用时自动启动本机音乐服务，关闭原生窗口后服务随之结束。

当前应用采用 ad hoc 签名，尚未经过 Apple Developer ID 公证；发行文件名和构建报告不会把它标成已公证版本。

音乐服务默认地址为 `http://127.0.0.1:8787`，下载默认写入当前用户的 `Music/Metrolist`。代理读取启动应用时的环境变量。

源码和许可证见 README、COPYING、NOTICE 与 licenses 目录。完整应用目录必须一起保留。
