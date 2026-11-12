# 来源与许可证

## Metrolist NSH

本工程的应用源代码以 **GNU General Public License v3.0 only（GPL-3.0-only）** 提供。完整条款见 [COPYING](COPYING)。

本工程是使用 Native Shell 重新实现的 Metrolist 跨平台版本；代码、界面设计与功能组织参考以下上游项目。

| 项目 | 来源 | 关联内容 |
| --- | --- | --- |
| Metrolist | <https://github.com/MetrolistGroup/Metrolist> | 音乐浏览、播放器与曲库体验，Material 3 设计语言，品牌标志；参考提交 `e6fea3b36c68841bad21daa6252e1d69ecd3afbe` |
| InnerTubeX | <https://github.com/MetrolistGroup/innertubex> | YouTube Music 请求参数、客户端标识与响应渲染字段 |
| Metroserver | <https://github.com/MetrolistGroup/metroserver> | 一起听的 Protobuf 协议、房间/成员/点歌及播放队列同步；服务端参考提交 `159861612e8b8a42cc1bc7c0cc0b46395720d46f` |
| Native Shell | <https://github.com/longbridge/nsh> | NSH TSX、QuickJS、原生组件、音频播放、Storage、原生模块和各平台运行时；固定源码版本见 `scripts/nsh-toolchain.json`；Apache-2.0 |
| Spotish | <https://github.com/huacnlee/spotish> | Spotify 独立工作区的 TSX 界面、动画 / 着色器、浏览器桥与 Rust / CDP 引擎；参考提交 `63d320103cf87e3731844b54e71df7f786724a90`；Copyright 2026 Jason Lee；Apache-2.0 |
| yt-dlp | <https://github.com/yt-dlp/yt-dlp> | 可选 Node 解析器，通过 `STREAM_RESOLVER=yt-dlp` 显式启用；其源代码及发行物遵循 yt-dlp 项目提供的许可证 |
| LRCLIB | <https://lrclib.net/> | 运行时查询歌词与同步时间轴 |

Metrolist、InnerTubeX 与 Metroserver 的源代码许可证为 GPL-3.0。NSH 的许可证文本见其 [LICENSE-APACHE](https://github.com/longbridge/nsh/blob/main/LICENSE-APACHE)；运行时与 Rust 模块中的第三方依赖保留各自许可证，新增原生模块的依赖和版本记录在 `native/Cargo.toml` 与 `native/Cargo.lock`。分发本工程的二进制文件时，应一并提供本工程对应源代码、COPYING、NOTICE.md 以及所附运行时的许可证。

## Spotish 导入代码

`src/spotish/`、`native/src/spotish/` 及对应测试移植自上述 Spotish 提交。原始 [Apache-2.0 许可证](third-party/spotish/LICENSE-APACHE)、[上游 NOTICE](third-party/spotish/NOTICE.md) 和 [导入与修改说明](third-party/spotish/README.md) 一并保留。修改过的文件带有适配说明；工程整体仍按 GPL-3.0-only 分发。

Spotish 使用 Tabler Icons 3.19.0，Copyright (c) 2020–2024 Paweł Kuna，MIT 许可证全文见 [TABLER-LICENSE-MIT](third-party/spotish/TABLER-LICENSE-MIT)。上游 NOTICE 中对 Spotify AB 的特别授权只涉及原作者的 Spotish 作品，不构成对本工程其他代码的额外授权。分发二进制时同时附带 `third-party/spotish/` 中的许可证与说明。

Spotify 工作区通过用户已安装的浏览器和用户账号运行 Spotify 自己的 Web Player；不包含 Widevine、Spotify 音频或浏览器发行包。Spotish 的广告行为保留：不屏蔽或跳过 Spotify 广告，免费账号与 Premium 的播放能力由 Spotify 原播放器决定。Spotify 是 Spotify AB 的商标；Metrolist NSH 和 Spotish 均未获得 Spotify 的官方合作或背书。

## 音乐目录与视觉素材

`assets/catalog-seed.json` 是 2026-11-11 从 YouTube Music 实际查询得到的公开歌曲元信息。首页种子栏目属于编辑精选。每首歌曲的 `id`、标题、歌手、专辑、时长与 `artwork` 地址均来自该歌曲的实际目录记录。

`assets/artwork/` 中的 JPEG 是这些目录记录对应的专辑或单曲封面，按原始图片服务提供的 600 × 600 尺寸下载。图片的来源 URL 保存在种子目录中。封面图、艺术家名称、作品标题、Metrolist 标志与各平台商标的权利归各自权利人；应用源代码的 GPL 授权不改变这些素材的权利归属。

本工程不附带上述商业歌曲的音频文件。YouTube Music 工作区在 Android 使用 Media3 / ExoPlayer，其他平台使用 NSH AudioPlayer 播放纯音频。原生 QuickJS、Worker 和可选 Node Web 服务共享音乐解析代码；桌面发行包运行 NSH 与本项目 Rust 模块，不捆绑或启动 Node。需要额外请求头的音频转发在同一 Rust 进程内完成。可选 Node Web 服务可以显式选择 yt-dlp。用户导入的音频与曲库文件仍属于其各自权利人。

Spotify 的 `src/spotish/backend/demo-covers/` 与虚构目录一同来自 Spotish，用于无账号测试和界面预览；模拟播放不包含音频。

YouTube、YouTube Music 与 Google 名称和商标归 Google 及其关联权利人。本工程与其没有官方合作或背书关系。
