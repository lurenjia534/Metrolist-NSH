# Metrolist NSH 0.2.0 · Windows x64 便携版

本目录包含原生程序、NSH runtime、界面、Node 音乐 gateway 与启动器。运行时无需 NSH CLI，也无需重新编译。默认使用纯 JavaScript 获取纯音频，不需要 Python 或 yt-dlp。

## 准备与启动

需要 **Windows 10 1809+、Node.js 24**，并让 `node` 可以从终端运行。双击 `start.cmd`，或在当前目录的 PowerShell 执行：

```powershell
.\start.cmd
```

启动器先在当前电脑开启 `http://127.0.0.1:8787`，再打开包内 `Metrolist.exe`；关闭原生程序后关闭本次服务。运行期间保留终端窗口。脚本使用 `node --use-env-proxy --max-http-header-size=65536`，不会自动安装依赖。

默认下载目录是当前用户的 `Music\Metrolist`，可通过 `DOWNLOAD_DIR` 修改。下载由 Node 流式写盘；离线音频通过本机服务播放，因此仍需保留 gateway 运行。若修改 `PORT`，也要修改应用设置中的音乐服务地址。线上曲目需要服务能访问 YouTube Music 与 googlevideo。

## 可选解析器

默认解析器无需 Python。只有明确选择 yt-dlp 时，才安装 Python 3 并执行：

```powershell
python -m pip install --target gateway/server/.yt-dlp -r gateway/server/requirements.txt
$env:STREAM_RESOLVER = 'yt-dlp'
.\start.cmd
```

`PYTHON`、`YT_DLP_PATH` 可以指定已有程序。

## 本版与验证范围

0.2.0 提供纯音频播放、搜索/发现、歌曲/专辑/艺人/歌单曲库、歌词/队列、下载、收听统计与真实 Metroserver 一起听。一起听的房间/审批/播放命令与队列已通过双客户端公共服务测试，未验证两台实体设备的音频同步精度。

本包从 Linux 跨平台打包，尚未在 Windows 设备启动或验证扬声器出声。资源管理器可能显示运行时默认图标，窗口内使用 Metrolist 图标。这是便携 ZIP，没有安装向导。本包不包含 Android/iOS 安装包。

完整说明见 `README.md`；来源与许可证见 `COPYING`、`NOTICE.md`、`licenses/`。分发本包时请一并提供同版本完整源代码。
