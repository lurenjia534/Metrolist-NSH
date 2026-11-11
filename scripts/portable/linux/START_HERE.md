# Metrolist NSH 0.2.0 · Linux x64 便携版

本目录包含原生程序、NSH runtime、界面、Node 音乐 gateway 与启动器。运行时无需 NSH CLI，也无需重新编译。默认使用纯 JavaScript 获取纯音频，不需要 Python 或 yt-dlp。

## 准备

安装 **Node.js 24**。系统需要 **glibc 2.39、GTK 4.14+、WebKitGTK 6.0 与 GStreamer**，例如 Ubuntu 24.04。Ubuntu 运行库：

```sh
sudo apt-get update
sudo apt-get install -y libgtk-4-1 libwebkitgtk-6.0-4 \
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

## 启动

在这个目录打开终端：

```sh
./start.sh
```

启动器先在当前电脑开启 `http://127.0.0.1:8787`，再打开包内 `Metrolist`；关闭原生程序后关闭本次服务。脚本使用 `node --use-env-proxy --max-http-header-size=65536`，不会自动安装依赖。

默认下载目录是当前用户的 `Music/Metrolist`，可通过 `DOWNLOAD_DIR` 修改。下载由 Node 流式写盘；离线音频通过本机服务播放，因此仍需保留 gateway 运行。若修改 `PORT`，也要修改应用设置中的音乐服务地址。线上曲目需要服务能访问 YouTube Music 与 googlevideo。

## 可选解析器

默认解析器无需 Python。只有明确选择 yt-dlp 时，才安装 Python 3 并执行：

```sh
python3 -m pip install --target gateway/server/.yt-dlp -r gateway/server/requirements.txt
STREAM_RESOLVER=yt-dlp ./start.sh
```

`PYTHON`、`YT_DLP_PATH` 可以指定已有程序。

## 本版与验证范围

0.2.0 提供纯音频播放、搜索/发现、歌曲/专辑/艺人/歌单曲库、歌词/队列、下载、收听统计与真实 Metroserver 一起听。一起听的房间/审批/播放命令与队列已通过双客户端公共服务测试，未验证两台实体设备的音频同步精度。

构建环境缺少 GTK/WebKitGTK，本次没有启动 Linux 原生窗口或验证扬声器出声。当前 Linux runtime 的倍速固定为 1×。原生手机后台服务尚未实现，本包不包含 Android/iOS 安装包。

完整说明见 `README.md`；来源与许可证见 `COPYING`、`NOTICE.md`、`licenses/`。分发本包时请一并提供同版本完整源代码。
