# Metrolist NSH 0.2.0 · 网页便携版

本包包含构建完成的网页、静态资源与本机 Node gateway。运行时无需 NSH CLI、npm install 或重新构建；默认纯 JavaScript 音频解析不需要 Python。

## 启动

安装 **Node.js 24**，在 `Metrolist-Web` 目录打开终端：

```sh
node --use-env-proxy --max-http-header-size=65536 server/dev.mjs
```

也可以运行 `npm run dev`。打开 <http://localhost:8787>；终端按 Ctrl+C 停止服务。网页与 `/api/*` 由同一服务提供。

手机与电脑连接同一局域网后，可从手机浏览器访问电脑实际地址，例如 `http://192.168.1.23:8787`。将示例 IP 换成电脑的 IP；手机上的 localhost 指向手机自身。

本 ZIP 是本地自托管方式。使用托管网站 <https://metrolist-nsh-miku.lurenjia534.chatgpt.site> 时，音乐服务在 Worker 运行，访问者无需启动自己的 Node 服务。

## 播放与保存

Web 与原生界面共用 NSH AudioPlayer，获取纯音频流。浏览器下载和导入把音频存入当前站点 IndexedDB，可再次播放或导出文件；应用资源由 service worker 缓存。清除站点数据会移除本地文件。浏览器 MediaSession 已接入，实际系统控制和手机后台持续播放能力取决于浏览器与操作系统。

Node 的磁盘下载服务默认使用用户的 `Music/Metrolist` 目录，可用 `DOWNLOAD_DIR` 修改。网页自身的下载页使用浏览器存储；原生应用连接此 gateway 时使用磁盘下载服务。

`PORT` 修改默认 8787 端口，`HOST` 默认为 0.0.0.0。线上曲目需要 gateway 能访问 YouTube Music 与 googlevideo；本环境已验证真实解析结果，但没有完成设备扬声器出声验证。

## 可选 yt-dlp

默认不需要安装它。若设置 `STREAM_RESOLVER=yt-dlp`，先安装 Python 3：

```sh
python3 -m pip install --target server/.yt-dlp -r server/requirements.txt
STREAM_RESOLVER=yt-dlp node --use-env-proxy --max-http-header-size=65536 server/dev.mjs
```

Windows PowerShell：

```powershell
python -m pip install --target server/.yt-dlp -r server/requirements.txt
$env:STREAM_RESOLVER = 'yt-dlp'
$env:PYTHON = 'python'
node --use-env-proxy --max-http-header-size=65536 server/dev.mjs
```

完整工程说明见 `README.md`；源码许可见 `COPYING`，来源与素材归属见 `NOTICE.md`，NSH 许可证位于 `licenses/`。分发时请同时提供对应版本的完整源代码。
