# Metrolist NSH · Web 发行包

在线使用请打开 README 中的站点地址。

此压缩包包含 `dist/client` 静态网页、`worker/index.js` Worker gateway 与 `server` Node gateway。静态页面需要相应的音乐 API 服务，不能只双击 HTML 文件。

本地运行需安装 Node.js 24，然后在本目录执行：

```sh
npm run dev
```

浏览器打开 `http://localhost:8787`。默认解析器使用纯 JavaScript，无需 Python 或 yt-dlp。下载目录为当前用户的 `Music/Metrolist`。

CI 生成此发行包；在线 Site 的发布时间与版本以站点 `/version.json` 为准，发布 Web ZIP 本身不会更新在线 Site。
