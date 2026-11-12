# Metrolist NSH · 0.8.0

使用 [Native Shell（nsh）](https://github.com/longbridge/nsh) 编写的 Metrolist 移植版。共享 TSX 界面、个人曲库、播放队列和纯音频播放器，面向现代浏览器、桌面系统与具备相应运行时的手机平台。

0.7 增加可切换的 **Spotify 独立工作区**，移植 [Spotish](https://github.com/huacnlee/spotish) 的 NSH 原生界面、Rust / CDP 播放引擎与完整音乐灯光动画。YouTube Music 和 Spotify 各自保留页面、账号、音乐库、播放器状态与外观，通过顶部切换器进入。[Spotify 使用与实现](docs/spotify.md) · [0.7 发布说明](docs/releases-0.7.0.md)。

**网页版：[打开 Metrolist NSH](https://metrolist-nsh-miku.lurenjia534.chatgpt.site)**。当前站点公开访问。托管版本的音乐服务运行在 Worker 上，访问者无需在自己的电脑启动 Node、安装 Python 或配置 yt-dlp。

**公开知识库：[Metrolist NSH 文档](https://metrolist-nsh-docs.lurenjia534.chatgpt.site/)**。包含 Android 安装、账号登录、云端音乐库、播放与下载、构建和版本发布说明。

**下载与发布：[GitHub Releases](https://github.com/lurenjia534/Metrolist-NSH/releases)**。发布流水线生成 Android、Linux、Windows、macOS、iOS 与 Web 工件，并提供版本、来源提交、构建信息和 SHA-256。平台包的具体名称与签名状态以该版本发布页为准。

**Android 0.7 沿用 0.5 / 0.6 的 `app.miku.metrolist.preview` 和同一签名，应用名为 `Metrolist NSH Preview`。** 可覆盖升级并保留账号、曲库与下载；最低 Android 8 / API 26。0.4 使用的 `app.miku.metrolist.next` 与它是不同应用，可从旧版导出曲库再导入。正式 Android 发布使用持久签名；构建检查产生的测试签名文件不作为正式升级包。

### 0.8：Spotify 真实 Web 与手机播放器

0.8 将 Web、Android、iOS 的默认演示后端替换为真实 Spotify 接入。Web 使用 Web Playback SDK 在当前浏览器出声；Android / iOS 使用官方 App Remote 控制本机 Spotify 应用。登录通过 OAuth PKCE，曲库和搜索使用真实 Web API。首次配置应用 Client ID 和回调地址，随后登录自己的 Spotify 账号。[0.8 发布说明](docs/releases-0.8.0.md)。

从顶部选择 **Spotify** 即可进入独立界面：侧栏音乐库、首页推荐、搜索、专辑 / 艺人 / 歌单、曲目排序、悬浮播放器、全屏 Now Playing 和同步歌词均沿用 Spotish 的实现。播放器和全屏页共有 14 种音乐灯光效果，并支持每曲随机；按压层、图标变形、列表波浪入场、封面翻转、导航和歌词动画由 NSH 绘制。

桌面 Spotify 播放由 Rust 启动本机已有的 Chrome、Chromium、Edge 或 Brave，在后台加载 Spotify Web Player 并通过 CDP 控制。首次使用在 Spotify 工作区点 **Log in**，在打开的浏览器窗口完成登录。需要浏览器具备 Widevine 和可用 Spotify 账号；Free / Premium 行为与广告由 Spotify 原播放器提供。桌面应用继续无需 Node 运行时。

切换服务会暂停离开的播放器，返回时保留其队列和页面，由用户继续播放。YouTube 的一起听会在切换到 Spotify 时断开，避免远端房间随后启动另一套播放器。Spotify 的会话、缓存、灯光偏好和浏览器配置目录独立保存。

**Web、Android、iOS 正常启动均使用真实播放器后端。** 未配置或未登录时显示连接页面，不加载虚构目录。Web 播放需要 Spotify Premium；原生手机需要安装 Spotify，并在 Spotify Developer Dashboard 登记应用标识、回调及 Android 签名。演示后端仅保留给显式选择的测试与动画压力场景。平台接入步骤与实际验收记录见 [Spotify 说明](docs/spotify.md)。

### 0.6：Native First

桌面程序直接进入 NSH 原生 Host：TSX / QuickJS 负责界面、账号、曲库与音源解析，NSH 原生网络负责请求，Rust 扩展负责流式下载、本机文件和携带请求头的音频转发。Linux、Windows 与 macOS 发行包去除 Node 运行时和独立 gateway 启动器，音乐服务地址默认留空即可直连。

桌面与 iOS 下载写入本机应用数据目录。桌面直接播放本机文件；iOS 通过同一进程内的 Rust 媒体通道流式播放这些文件，并支持拖动进度。需要携带上游请求头的在线音频也由该 Rust 通道处理。Android 继续使用原生 Media3 与 Java 文件 Host；Web 继续使用浏览器 Host 和 Worker API。

原生运行与打包可直接使用 NSH CLI 或 Python 辅助命令。Node 保留为可选的 Web 开发、构建和业务测试工具。架构、迁移与复现见 [Native First](docs/native-first.md)。

### 0.5.1：登录与多平台发布

Android 登录窗口重新设计：紧凑的返回/关闭栏、页面域名、加载进度和验证状态，进入 YouTube Music 后自动读取并验证会话，成功即返回应用。已有 WebView 会话会先尝试复用；添加账号使用 Google 账号选择。取消、网络错误和过期会话分别处理，不再要求用户猜测何时点击“完成”。应用账号页同步显示打开登录页、等待登录、验证账号等实际阶段，高级会话导入折叠收起。

网页版账号页说明它与 YouTube Music 的浏览器会话相互独立，并提供「获取 Android 版」和「打开 YouTube Music」。已有会话可从「高级连接 → 导入已有会话」连接；导入失败保留输入，可修改后直接重试。连接成功后，点击「打开音乐库」进入当前账号的云端内容。

0.5.1 的桌面包曾包含固定版本 Node 和本机 gateway；0.6 已改用上述原生架构。iOS 构建同时生成模拟器应用和真机工件；未配置 Apple 证书时真机包明确标记为 unsigned，供用户签名安装。Web 版本发布到上述现有 Site，关于页与应用壳缓存随版本更新。

[账号说明](docs/ACCOUNT.md)与[发布和构建说明](docs/releases-0.5.1.md)记录真实能力、运行方式和签名配置。

### 0.5 播放与播放器改进

播放链路合并重复的配置和音源解析请求，复用匿名首页的访客信息，并在当前歌曲开始播放后准备真正的下一首。Android 在当前歌曲有至少 12 秒前方缓冲时，将下一首最多 256 KiB 的开头写入同一个音频缓存。错误现在区分解析阶段与音频 CDN 的 HTTP 429；解析只接受服务端明确给出的短 `Retry-After`，CDN 429 不再触发播放器默认的连续重试。点“重试”或错误后的播放按钮会重新解析地址。

播放器增加连接/缓冲状态、缓冲进度、下一首准备状态和起播耗时明细；手机迷你播放器可直接打开队列。队列支持回到当前、移除当前之后的歌曲、自动续播，重复歌曲按实际队列位置高亮。首页增加喜欢、下载、最近播放和一起听入口，改善矮横屏导航。菜单操作等待原生关闭完成，修复删除所在行时的 NSH 生命周期错误。

[0.5 播放研究、实现与验证](docs/playback-0.5.md)记录请求数量对照、原版源码依据和真实验证边界。该轮应用版本为 0.5.0；0.6 继续使用匹配的 NSH runtime `0.4.0 / c5214aa`。

### 0.4 播放引擎基础

Android 音频改为服务持有的 Media3 1.10.1 / ExoPlayer，使用 OkHttp、1 GiB 磁盘缓存和原版对应的 50 秒缓冲参数。拖动进度只在松手时 seek，暂停保留源与缓冲，界面重建重接服务实际状态；NSH 仍负责共享界面。重新实现原生动画、底栏指示器、弹窗退出和短横屏播放器，调整音乐库、歌单编辑、下载、账号与设置的小屏布局。

[本轮问题分析与实现对照](docs/playback-and-motion-0.4.md)记录了源码依据、实际修复、测试与尚未完成的真机验证。

本版直接阅读了 [Metrolist 原版源码](https://github.com/MetrolistGroup/Metrolist/tree/e6fea3b36c68841bad21daa6252e1d69ecd3afbe) 和六张官方截图，以 Home、Search、Library 导航、四行快速选歌、独立曲库分类、全屏播放器、歌词与待播队列为界面依据。宽屏使用侧栏，窄屏使用底部导航；一起听、发现分类、下载、历史、统计和设置保留明确入口。源码与页面的对应关系见 [原版映射](docs/upstream-map.md)，移植范围见 [平台与功能状态](docs/port.md)。

## 本版功能

| 范围 | 已实现的业务路径 |
| --- | --- |
| Spotify 独立工作区 | 桌面 Rust / CDP 浏览器播放、账号登录、首页、音乐库、搜索、专辑 / 艺人 / 歌单、收藏、同步歌词、原生播放器与 14 种音乐灯光；Web Playback SDK、Android / iOS App Remote 真实后端与 OAuth PKCE |
| Google / YouTube Music 账号 | Android 自动完成登录与 CookieManager；Web / 桌面高级会话导入；真实资料验证、头像、多账号、品牌频道切换、退出 |
| 云端音乐库 | 喜欢、歌曲、专辑、订阅、歌单的完整分页同步；新建歌单/简介/可见性、重命名/删除、添加/精确移除/移动条目；按账号保存缓存 |
| 首页与发现 | YouTube Music 在线首页、快速选歌、继续聆听、新发行、排行榜、心情与流派；冷启动使用 12 首真实目录记录构成的编辑精选 |
| 搜索与详情 | 在线建议、设备搜索历史、全部/歌曲/专辑/艺人/歌单分类、分页、专辑/艺人/歌单详情、真实 browse endpoint |
| 个人曲库 | 明确加入的歌曲、喜欢、收藏专辑、收藏艺人、个人歌单；查询、排序、列表/网格；在线浏览缓存与个人收藏分别保存 |
| 歌单 | 创建、重命名、删除、导入、导出、添加/移除/移动曲目；重复歌曲按条目位置处理 |
| 播放 | Android 使用服务持有的 Media3 / ExoPlayer，其他平台使用 NSH AudioPlayer；播放/暂停、上/下一首、进度、音量、倍速、随机、单曲/列表循环、睡眠计时、音质选择、歌曲电台与自动续播 |
| 队列与歌词 | 添加到末尾、下一首播放、移动/删除/清空、恢复队列；LRCLIB 普通与同步歌词、点击跳转、字号/对齐/时间偏移设置 |
| 下载与离线 | 真实任务状态、字节进度、取消、重试、删除、导出和已下载音频播放；桌面 / iOS Rust 流式下载、Android Java 流式下载与浏览器存储分别实现 |
| 历史与统计 | 最近播放、真实收听事件与时长、7日/30日/365日/全部区间、歌曲/艺人排行、每日统计；可暂停记录及清除 |
| 一起听 | 原版 Metroserver 协议、创建/加入/审批、成员状态、主持人移交、点歌审批、播放与待播队列同步、自定义服务地址 |
| 本地数据 | 音频文件、音频 URL、YouTube 曲目/歌单链接导入；曲库与歌单 JSON 导入导出；设备持久化 |
| 外观与浏览器能力 | 深色、纯黑、浅色及跟随系统；响应式布局；Android MediaSession / 媒体通知 / 前台服务、浏览器 MediaSession 与应用资源缓存 |

表中除 Spotify 专项外的音乐功能属于 YouTube Music 工作区。曲库和收听数据保存在当前设备。登录后在线歌曲的喜欢与云端操作使用当前 YouTube Music 账号。私人音频上传、完整播客业务、识曲、均衡器、交叉淡化和无缝播放尚未实现；部分账号音源若需要 signatureCipher / PoToken 会报告当前能力。Android 已增加媒体通知、锁屏控制与 mediaPlayback 前台服务，尚未用真机验证后台生命周期；iOS 原生后台服务尚未实现。

## 选择运行方式

| 方式 | 音乐服务在哪里 | 使用者需要 |
| --- | --- | --- |
| Android APK | 在设备内运行共享音乐接口，直连 YouTube Music / 音频 CDN | Android 8.0+，可访问相关服务的网络 |
| 托管网页版 | 同站点 Worker 直接解析和转发纯音频 | 可访问站点的现代浏览器 |
| Linux / Windows / macOS 原生便携包 | QuickJS 中直接运行共享业务，NSH / Rust 提供网络、文件与媒体能力 | 对应系统及其原生运行库 |
| iOS | NSH 原生网络直连，Rust Host 处理本机下载 | iOS 15+；真机需有效签名 |
| 网页便携 ZIP / 本地开发网站 | 本机 Node 同时提供静态页面与音乐 API | Node.js 24 与现代浏览器 |
| 自行部署 Web | dist/client 静态资源 + dist/server/index.js Worker | 支持 Web 标准 Request/Response 与静态资源绑定的部署环境 |

原生 QuickJS、Worker 与可选 Node Web 服务使用同一套纯 JavaScript 音频解析。原生应用直接调用业务函数；Web 的 `/api/stream` 返回实际格式与播放地址，`/api/audio` 转发媒体并支持 Range/HEAD。实现采用原版/InnerTubeX 对应的 VISIONOS 音频路径，默认无需 Python 或 yt-dlp。可选 Node Web 服务另提供服务端磁盘下载与离线文件；原生客户端使用本机 Rust / 平台文件能力。

可选 Node Web 服务需要另选解析器时，可以显式设置 `STREAM_RESOLVER=yt-dlp`；只有这种模式需要 Python/yt-dlp。曲目和地区是否可播放仍取决于 YouTube 响应及服务节点的网络。

## 多平台发行包

当前版本统一从 [GitHub Releases](https://github.com/lurenjia534/Metrolist-NSH/releases) 下载。Linux、Windows 与 macOS 包含 NSH runtime、应用字节码与静态链接的 Rust Host，使用者无需另装 NSH、Node、Rust 或 Python。平台依赖、CPU 架构和签名状态在发行说明中列出；iOS unsigned 工件需要先签名才能安装到真机。

### Android

下载发布页中的 arm64 APK（应用名为 Metrolist NSH Preview），安装后点右上角头像连接账号。完成 Google 登录后，应用自动验证 YouTube Music 会话并返回账号页；通过后可同步和编辑云端音乐库。已有 0.5 安装可直接覆盖升级。

账号详情见 [账号使用与实现](docs/ACCOUNT.md)，APK 构建、签名、16 KiB 对齐及原生桥见 [Android 构建](docs/android-build.md)。

### Linux x64

本版 Linux 原生程序需要 **glibc 2.39、GTK 4.14+、WebKitGTK 6.0 与 GStreamer**，例如 Ubuntu 24.04。Ubuntu 运行库安装命令：

```sh
sudo apt-get update
sudo apt-get install -y libgtk-4-1 libwebkitgtk-6.0-4 \
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

解压后在 `Metrolist` 目录启动：

```sh
./Metrolist
```

此入口直接运行原生应用。音乐服务地址默认留空；本机不需要常驻的 8787 音乐网关。请保留完整解压目录。

### Windows x64

需要 **Windows 10 1809+**。解压后双击 `Metrolist.exe`；也可在 `Metrolist` 目录执行：

```powershell
.\Metrolist.exe
```

此入口就是 NSH 原生可执行程序，直接打开应用窗口。包内是便携程序，没有安装向导。

### macOS 与 iOS

macOS 提供 Apple Silicon 与 Intel 包，解压后启动 `Metrolist.app`。未配置 Developer ID 的构建使用 ad-hoc 签名，没有 Apple 公证；系统首次运行提示和允许方式以当前 macOS 为准。

iOS 提供 ARM64 模拟器应用，以及真机应用/IPA。配置发行证书和描述文件后生成对应签名包；没有证书时文件名与发行说明明确标为 unsigned，不能直接作为已签名安装包使用。完整命令见[发布说明](docs/releases-0.5.1.md)。

iOS 默认通过设备直连浏览和在线播放；下载由 Rust Host 写入本机应用数据目录，完成后可在应用内离线播放。音频导出到 Files 尚未实现。

### 本地网页版 ZIP

解压当前版本的 Web ZIP，进入包含 `server/` 和 `dist/` 的 `Metrolist-Web` 目录。安装 Node.js 24 后运行：

```sh
node --use-env-proxy --max-http-header-size=65536 server/dev.mjs
```

打开 [http://localhost:8787](http://localhost:8787)。无需 npm 依赖安装、Python 或 NSH CLI；终端按 Ctrl+C 停止服务。这个 ZIP 用于本地运行，托管网站的访问者无需启动本机服务。

### 可选 yt-dlp 模式（Web / 自建服务）

在源码工程或 Web ZIP 内可以主动启动另一套解析服务。只有选择此模式时才安装 Python 3；它不属于桌面发行包的运行链路：

```sh
python3 -m pip install --target server/.yt-dlp -r server/requirements.txt
STREAM_RESOLVER=yt-dlp node --use-env-proxy --max-http-header-size=65536 server/dev.mjs
```

Windows 可在 PowerShell 中设置 `$env:STREAM_RESOLVER = 'yt-dlp'` 与 `$env:PYTHON = 'python'` 后启动 `server/dev.mjs`。也可通过 `YT_DLP_PATH` 指定现有 yt-dlp 可执行程序。在原生应用中主动填写该服务地址即可使用。

## 下载、导入与数据位置

浏览器下载把真实音频写入当前站点的 IndexedDB；再次播放从本地 Blob 读取，也可以导出音频文件。应用资源由 service worker 缓存。文件仅在当前浏览器/站点中保存，清除站点数据会移除这些文件。

桌面与 iOS 原生下载由 Rust Host 流式写入 NSH 应用数据目录，下载任务状态保存在应用 Storage 中。离线记录保存本机文件地址；桌面直接读取，iOS 由应用内的 Rust loopback 媒体通道提供 GET、HEAD 和 Range 分段读取，无需 Node 或外部服务，也无需 JS 载入整个文件。下载页面可查看任务、重试和删除；音乐库导出仍是 JSON 数据备份。

Android 下载和音频导入由 Java 流式写入应用私有目录，导入与另存使用系统文件选择器。浏览器文件保存在当前站点的 IndexedDB。JSON 备份包含曲库、收藏、歌单、搜索历史和收听记录，不包含音频文件本身。

旧版 Node gateway 已下载的音频仍位于旧服务用户的 `Music/Metrolist` 或配置的 `DOWNLOAD_DIR` 中。升级不会移动这些外部文件，可从应用的文件导入入口加入曲库。主动连接远程服务时，该服务提供的下载文件位于服务端。

## 一起听

默认服务是原版所列的 `wss://metroserverx.meowery.eu/ws`。在一起听页面设置昵称，连接后创建房间，或填写现有房间号申请加入；主持人批准后同步当前曲目和待播队列。主持人可以批准点歌、移交主持人或移除成员。设置中可改用兼容 Metroserver 的 WebSocket 地址。

该功能使用原版二进制 Protobuf 协议，不要求 Google 账号。房间同步 YouTube 曲目标识；本地文件不会上传给其他成员。主持人控制时间线，访客自然播完等待房间更新。

2026-11-11 已通过真实公共服务完成双客户端创建、审批、播放/暂停/seek、队列移除、点歌、主持人移交及退出验证。记录与验证边界见 [Together 实测记录](docs/together-verification.md)。此次协议检查使用播放器替身，未验证两台实体设备的声音同步精度。

## 从源码开发

原生开发需要匹配的 **NSH 0.5.0 `f4d68f7`**、**Rust 1.99.1** 和对应系统编译依赖。工具链安装和辅助命令使用 **Python 3.11+** 与 curl。**Node.js 24** 仅用于可选 Web 构建、Node 业务测试与本地网站服务。Linux 构建库清单见 [Native First](docs/native-first.md)。

在源码目录安装固定版本的 CLI（Linux / macOS / Windows）；需要构建网页时增加 `--component web`：

```sh
python3 scripts/install-nsh.py
python3 scripts/run-nsh.py --version
```

Windows 将 `python3` 换成 `python`。工具链默认放在源码相邻的 `toolchain/`，项目脚本会自动使用它。安装器按 `scripts/nsh-toolchain.json` 检查固定摘要，优先使用 `nsh-runtime-f4d68f7` 工具链镜像；镜像尚无资产时从上游 `v0.5.0` 稳定发布获取同一归档。`NSH_DOWNLOAD_BASE` 可指定保留该版本的镜像。Android 构建另加 `--component android`。已有 CLI 可通过 `NSH_BIN` 指定；缓存目录可通过 `NSH_CACHE` 指定。

原生开发脚本直接打开当前系统的 NSH 窗口，原生模块由 NSH 编译并链接：

```sh
python3 scripts/run-native.py
python3 scripts/run-native.py linux
python3 scripts/run-native.py windows
python3 scripts/run-native.py macos
```

macOS 目标需要 macOS 14+；脚本接受 `macos` 或别名 `mac`。

构建与运行网页：

```sh
npm run build
npm run dev
```

`scripts/build.mjs` 生成 `dist/client` 和 `dist/server/index.js`。部署 Worker 时需要把静态资源绑定为 `ASSETS`；只上传静态目录并不会自动得到音乐 API。

开发检查：

```sh
python3 scripts/run-nsh.py check
python3 scripts/run-nsh.py build
python3 scripts/run-nsh.py test --web-host tests/native-login/host.js
SPOTISH_DEMO=1 python3 scripts/run-nsh.py test tests/spotify-native.test.tsx --web-host tests/native-login/host.js
cargo test --manifest-path native/Cargo.toml
# 可选 Node 测试还验证共享业务与 Web 服务
node --test server/*.test.mjs
# Spotify 浏览器桥的独立测试与生成源一致性
node --check src/spotish/bridge/bridge.js
node --test src/spotish/bridge/tests/*.test.mjs
node src/spotish/bridge/gen-source.mjs --check
```

NSH 无界面检查验证共享状态与交互；服务端测试验证目录解析、分页、歌词、音频格式选择、Range/HEAD/CORS、真实磁盘下载/取消/持久化。构建、协议测试、浏览器视觉检查和设备出声属于不同验证项。

## 手机使用自定义 gateway（可选）

原生客户端默认音乐服务留空，即设备直连。只有主动选择另一台设备的服务时才需要以下配置。

手机与电脑在同一局域网时，将手机应用的音乐服务地址设为电脑实际地址，例如 `http://192.168.1.23:8787`。`127.0.0.1` 在手机上表示手机自身。Node 默认监听 `0.0.0.0:8787`；电脑需允许局域网访问该端口。

Android USB 调试可以建立反向端口转发后启动：

```sh
# 先在另一终端运行 npm run dev
adb reverse tcp:8787 tcp:8787
python3 scripts/run-native.py android
```

只有建立转发后，Android 应用才能用手动填写的 `http://127.0.0.1:8787` 访问电脑服务。iOS 真机使用可达的局域网或 HTTPS 服务地址，开发目标需在 macOS 上运行。托管网页版直接使用同站点 Worker，无需上述本机配置。

## 平台要求与验证范围

最低要求来自 [NSH 平台说明](https://github.com/longbridge/nsh#platforms) 与 [安装文档](https://nsh.dev/docs/installation)。本移植支持的目标不等于所有旧设备都可运行。

| 平台 | 最低要求/运行条件 | 当前设备验证 |
| --- | --- | --- |
| Web | 支持 WebAssembly、现代音频 API 与所选音频格式的浏览器 | Web 构建与发布后检查分别执行；具体部署版本以线上关于页和发布记录为准 |
| Linux x86_64 | glibc 2.39、GTK 4.14+、WebKitGTK 6.0、GStreamer | 本地已备齐 GTK / WebKitGTK 依赖；执行环境的显示与本地套接字限制使原生窗口截图和出声尚未验证，Linux CI 另执行启动与截图 |
| Windows x86_64 | Windows 10 1809+ | 提供跨平台生成的便携包；未在 Windows 设备启动或验证出声 |
| macOS | macOS 14+ | Apple Silicon / Intel 原生构建与便携打包；构建通过不等于已完成用户设备的播放验收 |
| Android | Android 8 / API 26+；构建需 Android SDK、JDK 和 runtime | 0.5 使用真实 Java 编译、资源链接、DEX、Manifest、签名与 ZIP/ELF 16 KiB 对齐检查；没有真机登录/出声验证 |
| iOS | iOS 15+；构建需 Apple Silicon macOS、Xcode 和对应 runtime | CI 生成真机与模拟器工件；真实设备安装另需有效签名，未验证真机出声 |

本环境已核对真实目录和音频解析响应；访问 googlevideo 媒体地址时，执行网络返回网页内容而非音频字节，不能据此宣称已经实机出声。音频格式选择、代理与下载流程另以本地 HTTP 音频源进行测试。Together 的公共服务协议测试已经独立完成。服务端验证详见 [验证记录](docs/VERIFICATION.md)。

当前 runtime 的 Linux 倍速固定为 1×。Android 已接入原生后台媒体服务、MediaSession、锁屏和通知控制，实际设备后台持续运行仍待验证；iOS 需要对应平台专项实现。浏览器 MediaSession 已接入，但实际可用的系统控件取决于浏览器与操作系统。

0.7 使用 `nsh 0.5.0 (f4d68f7)`；完整源码 revision 为 `f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1`。这一版本修复了多层弹出菜单在卸载时读取已释放响应式状态的问题。GitHub Actions 工作流覆盖 Android、Linux、Windows、macOS、iOS 和 Web；所有组件使用固定版本与下载摘要。`main` 的发行流程收集各平台工件并发布 GitHub Release；Android 与 Apple 的持久签名通过仓库 Secrets 配置。Site 的源码与发布使用其独立发布通道，详见发布说明。

## 打包与复现

NSH 标准打包：

```sh
python3 scripts/run-nsh.py package --target linux --out releases/linux
python3 scripts/run-nsh.py package --target windows --out releases/windows
python3 scripts/run-nsh.py package --target macos --out releases/macos
python3 scripts/run-nsh.py package --target web --out releases/web-standard
```

标准原生包包含应用与静态链接 Rust 扩展的 NSH runtime。发行脚本保留原生入口，附上 README、许可证及构建报告；不打包独立音乐服务：

```sh
python3 scripts/package-portable.py linux
# Windows / macOS 在对应系统构建目标
npm run build
python3 scripts/package-portable.py web
```

可只指定一个目标；Windows 将 `python3` 换成 `python`。默认输出到工程内 `dist/release/`，`--out` 可更改。`NSH_BIN` 可指定 CLI；模板位于 `scripts/portable/`。原生打包需要对应系统 Rust / SDK 编译环境；Web ZIP 打包使用当前 `dist/client`，必须先构建。

Android 使用本项目 host 与媒体服务构建脚本：

```sh
python3 scripts/build-android.py --help
python3 scripts/build-android.py
```

工具链和签名配置见 [Android 构建](docs/android-build.md)。以下 NSH 标准命令适用于平台组件与原生基线；直接标准打包不会注入本项目 Android 登录/下载/媒体 host：

```sh
nsh component add android
nsh package --target android --out releases/android
nsh component add ios
nsh package --target ios-simulator --out releases/ios-simulator
nsh package --target ios --out releases/ios
```

Android 默认生成本地调试签名 APK。iOS 未指定签名时得到未签名 `.app`；真机安装的 `.ipa` 需配置 `--sign` 和 `--profile`。iOS 打包在 macOS/Xcode 环境执行。

## 架构

| 路径 | 职责 |
| --- | --- |
| App.tsx、src/ui.tsx、src/navigation.ts | 响应式界面、共享控件、页面导航 |
| src/store.ts、src/model.ts | 曲库、收藏、歌单、查询、下载状态、统计与持久化 |
| src/playback.ts | Android 原生音频桥 / 其他平台 AudioPlayer、队列、播放事件、随机/循环、电台、睡眠、远端同步入口 |
| android/MetrolistAudio.java、android/MetrolistMediaService.java | Android ExoPlayer、OkHttp、SimpleCache、媒体服务、系统控制与状态重接 |
| src/motion.ts、src/components/Player.tsx、src/components/Toasts.tsx | NSH 原生过渡、拖动预览、歌词跟随、播放器与提示生命周期 |
| src/together.ts | Metroserver Protobuf、房间、成员、审批、时钟与播放同步 |
| src/api.ts | QuickJS 内直接调用共享音乐 API，以及可选的远程服务地址 |
| native/ | NSH Rust 模块：流式下载、文件与同进程音频转发 |
| web/host.js、web/sw.js | 浏览器文件、下载、MediaSession 与应用资源缓存 |
| server/catalog.mjs | YouTube Music/InnerTube 目录与 LRCLIB 歌词 |
| server/streaming.mjs、server/index.mjs | Web 标准 Worker 音频解析、代理与 API |
| server/dev.mjs、server/resolve.mjs、server/downloads.mjs | 可选 Web / 自建 Node 服务、yt-dlp 与服务端文件 |
| assets/catalog-seed.json、assets/artwork/ | 真实目录种子及对应封面 |
| scripts/run-native.py、scripts/package-portable.py、scripts/portable/ | 原生开发直接启动、NSH 打包与发行说明 |

### 可选 Node Web 服务参数

| 环境变量 | 用途 |
| --- | --- |
| NSH_BIN | 开发/打包使用的 CLI，默认 nsh |
| PORT | 可选 Web / gateway 端口，默认 8787 |
| HOST | 监听地址，默认 0.0.0.0 |
| STREAM_RESOLVER | 默认使用纯 JavaScript VISIONOS；设为 yt-dlp 才调用可选解析器 |
| PYTHON | 可选 yt-dlp 解析器的 Python 程序；Windows 可显式设置为 python |
| YT_DLP_PATH | 已安装的 yt-dlp 可执行程序路径 |
| DOWNLOAD_DIR | 磁盘下载目录，默认用户的 Music/Metrolist |
| STATIC_DIR | 相对于 server/ 的静态目录，默认 ../dist/client |
| PUBLIC_ORIGIN | API 对外地址，用于生成音频与下载文件的绝对 URL |

## 许可证

应用源代码采用 **GPL-3.0-only**，完整条款见 [COPYING](COPYING)。原版 Metrolist、InnerTubeX、Metroserver、NSH、yt-dlp、歌词与图片归属见 [NOTICE.md](NOTICE.md)。封面与品牌素材的版权仍归各自权利人。分发二进制时请一并提供同版本完整源代码与许可证。


## Git 与源代码交付

公开源码仓库：[lurenjia534/Metrolist-NSH](https://github.com/lurenjia534/Metrolist-NSH)。本仓库从 `Metrolist-NSH-0.4.0-source.zip` 导入 0.4.0 源码快照；该归档不含 `.git`，因此这里的提交历史从此次导入开始，不包含此前的开发历史。根目录 `AGENTS.md` 保留用户指定开发要求。0.4 的 Android 安装包及签名备份单独交付，签名文件不写入代码仓库或公开站点。

源码发布前检查敏感凭证；账号测试使用人工 fixture，Android 持久签名通过 GitHub Actions Secrets 配置。本地托管配置 `.openai/hosting.json` 不提交。`scripts/publish-github.sh` 可用于显式创建新的公开仓库。
