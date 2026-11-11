# Metrolist NSH · Linux 便携版

解压后运行 `./Metrolist`，或双击 `start.sh`。包内已经包含 Node.js 24、音乐 gateway 和 NSH 原生程序，无需安装 Node、Python 或 NSH。

系统需要 glibc 2.39、GTK 4.14+、WebKitGTK 6.0 与 GStreamer，例如 Ubuntu 24.04。缺少这些系统运行库时可安装：

```sh
sudo apt-get update
sudo apt-get install -y libgtk-4-1 libwebkitgtk-6.0-4 \
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

启动器自动开启 `http://127.0.0.1:8787` 的音乐服务，再打开原生窗口；关闭应用时结束本次服务。请保留解压后的完整目录。

下载默认写入当前用户的 `Music/Metrolist`。`DOWNLOAD_DIR` 可更改目录；如果改 `PORT`，同时在应用设置中修改音乐服务地址。代理读取系统环境变量。

每份发行包均包含构建来源和 gateway 检查结果；GUI、音频设备与网络的实际表现仍以本机运行为准。源码和许可证见 README、COPYING、NOTICE 与 licenses 目录。
