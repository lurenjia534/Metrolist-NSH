# Metrolist NSH · Windows 便携版

需要 Windows 10 1809 或更新版本。将 ZIP 完整解压到一个文件夹，双击 **Metrolist.exe**。

包内已经包含 Node.js 24、音乐 gateway 与 NSH 原生程序，无需安装 Node、Python 或 NSH。启动器自动开启本机音乐服务并打开原生窗口；关闭应用时结束本次服务。请保留解压后的完整目录。

音乐服务默认地址为 `http://127.0.0.1:8787`，下载默认写入当前用户的 `Music\Metrolist`。`DOWNLOAD_DIR` 可更改下载目录；如果改 `PORT`，同时在应用设置中修改音乐服务地址。代理读取系统环境变量。

这是便携版，不需要安装向导。每份发行包均包含构建来源和 gateway 检查结果；GUI、音频设备与网络的实际表现仍以本机运行为准。源码和许可证见 README、COPYING、NOTICE 与 licenses 目录。
