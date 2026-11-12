# Metrolist NSH · Linux 便携版

解压后运行 `./Metrolist`。这是直接启动的 NSH 原生程序，包内包含 QuickJS 应用与 Rust 原生 Host，无需安装 Node、Python 或 NSH。

系统需要 glibc 2.39、GTK 4.14+、WebKitGTK 6.0 与 GStreamer，例如 Ubuntu 24.04。缺少这些系统运行库时可安装：

```sh
sudo apt-get update
sudo apt-get install -y libgtk-4-1 libwebkitgtk-6.0-4 \
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

音乐 API、账号和音源解析在应用内执行，HTTP 请求使用 NSH 原生网络能力；没有独立的本机音乐网关，也不占用 8787 端口。请保留解压后的完整目录。

音乐服务地址默认留空，表示本机直连。下载由 Rust Host 流式写入应用数据目录，离线播放直接读取本机文件。需要额外请求头的在线音频由同一 Rust 进程内的媒体转发处理；自定义远程音乐服务仍可在设置中选择。

发行包旁的构建报告记录来源提交、原生可执行文件和应用字节码摘要，以及包结构检查结果。界面启动和音频设备验证单独记录。源码和许可证见 README、COPYING、NOTICE 与 licenses 目录。
