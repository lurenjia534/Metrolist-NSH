# 来源与许可证

## Metrolist NSH

本工程的应用源代码以 **GNU General Public License v3.0 only（GPL-3.0-only）** 提供。完整条款见 [COPYING](COPYING)。

本工程是使用 Native Shell 重新实现的 Metrolist 跨平台版本；代码、界面设计与功能组织参考以下上游项目。

| 项目 | 来源 | 关联内容 |
| --- | --- | --- |
| Metrolist | <https://github.com/MetrolistGroup/Metrolist> | 音乐浏览、播放器与曲库体验，Material 3 设计语言，品牌标志；参考提交 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe` |
| InnerTubeX | <https://github.com/MetrolistGroup/innertubex> | YouTube Music 请求参数、客户端标识与响应渲染字段 |
| Metroserver | <https://github.com/MetrolistGroup/metroserver> | 一起听的 Protobuf 协议、房间/成员/点歌及播放队列同步；服务端参考提交 `159861612e8b8a42cc1bc7c0cc0b46395720d46f` |
| Native Shell | <https://github.com/longbridge/nsh> | NSH TSX、原生组件、音频播放、Storage、Picker、Web 与各平台运行时；Apache-2.0 |
| yt-dlp | <https://github.com/yt-dlp/yt-dlp> | 可选 Node 解析器，通过 `STREAM_RESOLVER=yt-dlp` 显式启用；其源代码及发行物遵循 yt-dlp 项目提供的许可证 |
| LRCLIB | <https://lrclib.net/> | 运行时查询歌词与同步时间轴 |

Metrolist、InnerTubeX 与 Metroserver 的源代码许可证为 GPL-3.0。NSH 的许可证文本见其 [LICENSE-APACHE](https://github.com/longbridge/nsh/blob/main/LICENSE-APACHE)；预编译运行时中的第三方依赖保留各自许可证。分发本工程的二进制文件时，应一并提供本工程对应源代码、COPYING、NOTICE.md 以及所附运行时的许可证。

## 音乐目录与视觉素材

`assets/catalog-seed.json` 是 2026-11-11 从 YouTube Music 实际查询得到的公开歌曲元信息。首页种子栏目属于编辑精选。每首歌曲的 `id`、标题、歌手、专辑、时长与 `artwork` 地址均来自该歌曲的实际目录记录。

`assets/artwork/` 中的 JPEG 是这些目录记录对应的专辑或单曲封面，按原始图片服务提供的 600 × 600 尺寸下载。图片的来源 URL 保存在种子目录中。封面图、艺术家名称、作品标题、Metrolist 标志与各平台商标的权利归各自权利人；应用源代码的 GPL 授权不改变这些素材的权利归属。

本工程不附带上述商业歌曲的音频文件。浏览器与原生界面统一使用 NSH AudioPlayer 播放音乐服务返回的纯音频。Worker 和 Node 默认采用纯 JavaScript 解析；Node 可显式选择 yt-dlp。用户导入的音频与曲库文件仍属于其各自权利人。

YouTube、YouTube Music 与 Google 名称和商标归 Google 及其关联权利人。本工程与其没有官方合作或背书关系。
