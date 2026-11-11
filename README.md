# Metrolist NSH · 0.5.1

使用 [Native Shell（nsh）](https://github.com/longbridge/nsh) 编写的 Metrolist 移植版。共享 TSX 界面、个人曲库、播放队列和纯音频播放器，面向现代浏览器、桌面系统与具备相应运行时的手机平台。

**网页版：[打开 Metrolist NSH](https://metrolist-nsh-miku.lurenjia534.chatgpt.site)**。当前站点公开访问。托管版本的音乐服务运行在 Worker 上，访问者无需在自己的电脑启动 Node、安装 Python 或配置 yt-dlp。

**公开知识库：[Metrolist NSH 文档](https://metrolist-nsh-docs.lurenjia534.chatgpt.site/)**。包含 Android 安装、账号登录、云端音乐库、播放与下载、构建和版本发布说明。

**下载与发布：[GitHub Releases](https://github.com/lurenjia534/Metrolist-NSH/releases/latest)**。发布流水线生成 Android、Linux、Windows、macOS、iOS 与 Web 工件，并提供版本、来源提交、构建信息和 SHA-256。平台包的具体名称与签名状态以该版本发布页为准。

**Android 0.5.1 沿用 0.5 的 `app.miku.metrolist.preview` 和同一签名，应用名为 `Metrolist NSH Preview`。** 可覆盖升级 0.5 并保留账号、曲库与下载；最低 Android 8 / API 26。0.4 使用的 `app.miku.metrolist.next` 与它是不同应用，可从旧版导出曲库再导入。正式 Android 发布使用持久签名；构建检查产生的测试签名文件不作为正式升级包。

### 0.5.1：登录与多平台发布

Android 登录窗口重新设计：紧凑的返回/关闭栏、页面域名、加载进度和验证状态，进入 YouTube Music 后自动读取并验证会话，成功即返回应用。已有 WebView 会话会先尝试复用；添加账号使用 Google 账号选择。取消、网络错误和过期会话分别处理，不再要求用户猜测何时点击“完成”。应用账号页同步显示打开登录页、等待登录、验证账号等实际阶段，高级会话导入折叠收起。

网页版账号页说明它与 YouTube Music 的浏览器会话相互独立，并提供「获取 Android 版」和「打开 YouTube Music」。已有会话可从「高级连接 → 导入已有会话」连接；导入失败保留输入，可修改后直接重试。连接成功后，点击「打开音乐库」进入当前账号的云端内容。

桌面发行包包含固定版本 Node 和本机 gateway，Linux / Windows / macOS 的启动入口自动启动音乐服务。iOS 构建同时生成模拟器应用和真机工件；未配置 Apple 证书时真机包明确标记为 unsigned，供用户签名安装。Web 版本发布到上述现有 Site，关于页与应用壳缓存随版本更新。

[账号说明](docs/ACCOUNT.md)与[发布和构建说明](docs/releases-0.5.1.md)记录真实能力、运行方式和签名配置。

### 0.5 播放与播放器改进

播放链路合并重复的配置和音源解析请求，复用匿名首页的访客信息，并在当前歌曲开始播放后准备真正的下一首。Android 在当前歌曲有至少 12 秒前方缓冲时，将下一首最多 256 KiB 的开头写入同一个音频缓存。错误现在区分解析阶段与音频 CDN 的 HTTP 429；解析只接受服务端明确给出的短 `Retry-After`，CDN 429 不再触发播放器默认的连续重试。点“重试”或错误后的播放按钮会重新解析地址。

播放器增加连接/缓冲状态、缓冲进度、下一首准备状态和起播耗时明细；手机迷你播放器可直接打开队列。队列支持回到当前、移除当前之后的歌曲、自动续播，重复歌曲按实际队列位置高亮。首页增加喜欢、下载、最近播放和一起听入口，改善矮横屏导航。菜单操作等待原生关闭完成，修复删除所在行时的 NSH 生命周期错误。

[0.5 播放研究、实现与验证](docs/playback-0.5.md)记录请求数量对照、原版源码依据和真实验证边界。该轮应用版本为 0.5.0；0.5.1 继续使用匹配的 NSH runtime `0.4.0 / c5214aa`。

### 0.4 播放引擎基础

Android 音频改为服务持有的 Media3 1.10.1 / ExoPlayer，使用 OkHttp、1 GiB 磁盘缓存和原版对应的 50 秒缓冲参数。拖动进度只在松手时 seek，暂停保留源与缓冲，界面重建重接服务实际状态；NSH 仍负责共享界面。重新实现原生动画、底栏指示器、弹窗退出和短横屏播放器，调整音乐库、歌单编辑、下载、账号与设置的小屏布局。

[本轮问题分析与实现对照](docs/playback-and-motion-0.4.md)记录了源码依据、实际修复、测试与尚未完成的真机验证。

本版直接阅读了 [Metrolist 原版源码](https://github.com/MetrolistGroup/Metrolist/tree/e6fea3b36c68841bad21daa6252e1d69ecd3afbe) 和六张官方截图，以 Home、Search、Library 导航、四行快速选歌、独立曲库分类、全屏播放器、歌词与待播队列为界面依据。宽屏使用侧栏，窄屏使用底部导航；一起听、发现分类、下载、历史、统计和设置保留明确入口。源码与页面的对应关系见 [原版映射](docs/upstream-map.md)，移植范围见 [平台与功能状态](docs/port.md)。

## 本版功能

| 范围 | 已实现的业务路径 |
| --- | --- |
| Google / YouTube Music 账号 | Android 自动完成登录与 CookieManager；Web / 桌面高级会话导入；真实资料验证、头像、多账号、品牌频道切换、退出 |
| 云端音乐库 | 喜欢、歌曲、专辑、订阅、歌单的完整分页同步；新建歌单/简介/可见性、重命名/删除、添加/精确移除/移动条目；按账号保存缓存 |
| 首页与发现 | YouTube Music 在线首页、快速选歌、继续聆听、新发行、排行榜、心情与流派；冷启动使用 12 首真实目录记录构成的编辑精选 |
| 搜索与详情 | 在线建议、设备搜索历史、全部/歌曲/专辑/艺人/歌单分类、分页、专辑/艺人/歌单详情、真实 browse endpoint |
| 个人曲库 | 明确加入的歌曲、喜欢、收藏专辑、收藏艺人、个人歌单；查询、排序、列表/网格；在线浏览缓存与个人收藏分别保存 |
| 歌单 | 创建、重命名、删除、导入、导出、添加/移除/移动曲目；重复歌曲按条目位置处理 |
| 播放 | Android 使用服务持有的 Media3 / ExoPlayer，其他平台使用 NSH AudioPlayer；播放/暂停、上/下一首、进度、音量、倍速、随机、单曲/列表循环、睡眠计时、音质选择、歌曲电台与自动续播 |
| 队列与歌词 | 添加到末尾、下一首播放、移动/删除/清空、恢复队列；LRCLIB 普通与同步歌词、点击跳转、字号/对齐/时间偏移设置 |
| 下载与离线 | 真实任务状态、字节进度、取消、重试、删除、导出和已下载音频播放；Android Java 流式下载、浏览器存储与 Node 磁盘下载分别实现 |
| 历史与统计 | 最近播放、真实收听事件与时长、7日/30日/365日/全部区间、歌曲/艺人排行、每日统计；可暂停记录及清除 |
| 一起听 | 原版 Metroserver 协议、创建/加入/审批、成员状态、主持人移交、点歌审批、播放与待播队列同步、自定义服务地址 |
| 本地数据 | 音频文件、音频 URL、YouTube 曲目/歌单链接导入；曲库与歌单 JSON 导入导出；设备持久化 |
| 外观与浏览器能力 | 深色、纯黑、浅色及跟随系统；响应式布局；Android MediaSession / 媒体通知 / 前台服务、浏览器 MediaSession 与应用资源缓存 |

曲库和收听数据保存在当前设备。登录后在线歌曲的喜欢与云端操作使用当前 YouTube Music 账号。私人音频上传、完整播客业务、识曲、均衡器、交叉淡化和无缝播放尚未实现；部分账号音源若需要 signatureCipher / PoToken 会报告当前能力。Android 已增加媒体通知、锁屏控制与 mediaPlayback 前台服务，尚未用真机验证后台生命周期；iOS 原生后台服务尚未实现。

## 选择运行方式

| 方式 | 音乐服务在哪里 | 使用者需要 |
| --- | --- | --- |
| Android APK | 在设备内运行共享音乐接口，直连 YouTube Music / 音频 CDN | Android 8.0+，可访问相关服务的网络 |
| 托管网页版 | 同站点 Worker 直接解析和转发纯音频 | 可访问站点的现代浏览器 |
| Linux / Windows / macOS 原生便携包 | 随包提供的 Node gateway，由应用启动器拉起 | 对应系统及其原生运行库 |
| 网页便携 ZIP / 本地开发网站 | 本机 Node 同时提供静态页面与音乐 API | Node.js 24 与现代浏览器 |
| 自行部署 Web | dist/client 静态资源 + dist/server/index.js Worker | 支持 Web 标准 Request/Response 与静态资源绑定的部署环境 |

Worker 与 Node 默认使用同一套纯 JavaScript 音频解析：`/api/stream` 返回实际格式与播放地址，`/api/audio` 转发媒体并支持 Range/HEAD。实现采用原版/InnerTubeX 对应的 VISIONOS 音频路径，默认无需 Python 或 yt-dlp。Node 另外提供磁盘下载、下载清单与离线文件服务。

需要另选解析器时，可以显式设置 `STREAM_RESOLVER=yt-dlp`；只有这种模式需要 Python/yt-dlp。曲目和地区是否可播放仍取决于 YouTube 响应及服务节点的网络。

## 多平台发行包

当前版本统一从 [GitHub Releases](https://github.com/lurenjia534/Metrolist-NSH/releases/latest) 下载。Linux、Windows 与 macOS 包含 NSH runtime、本机音乐 gateway 和固定 Node 运行环境，使用者无需另装 NSH、Node 或 Python。平台依赖、CPU 架构和签名状态在发行说明中列出；iOS unsigned 工件需要先签名才能安装到真机。

### Android

下载发布页中的 arm64 APK（应用名为 Metrolist NSH Preview），安装后点右上角头像连接账号。完成 Google 登录后，应用自动验证 YouTube Music 会话并返回账号页；通过后可同步和编辑云端音乐库。已有 0.5 安装可直接覆盖升级。

账号详情见 [账号使用与实现](docs/ACCOUNT.md)，APK 构建、签名、16 KiB 对齐及原生桥见 [Android 构建](docs/android-build.md)。

### Linux x64

本版 NSH 预编译运行时需要 **glibc 2.39、GTK 4.14+、WebKitGTK 6.0 与 GStreamer**，例如 Ubuntu 24.04。Ubuntu 运行库安装命令：

```sh
sudo apt-get update
sudo apt-get install -y libgtk-4-1 libwebkitgtk-6.0-4 \
  libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

解压后在 `Metrolist` 目录启动：

```sh
./start.sh
```

启动器先监听 `http://127.0.0.1:8787`，再打开包内原生程序；原生程序退出后关闭该次 gateway。启动器不会自动安装依赖。

### Windows x64

需要 **Windows 10 1809+**。解压后双击 `Metrolist.exe`；也可在 `Metrolist` 目录执行：

```powershell
.\start.cmd
```

启动入口自动运行随包 Node 与本机音乐服务，关闭原生程序后停止该次服务。包内是便携程序，没有安装向导。

### macOS 与 iOS

macOS 提供 Apple Silicon 与 Intel 包，解压后启动 `Metrolist.app`。未配置 Developer ID 的构建使用 ad-hoc 签名，没有 Apple 公证；系统首次运行提示和允许方式以当前 macOS 为准。

iOS 提供 ARM64 模拟器应用，以及真机应用/IPA。配置发行证书和描述文件后生成对应签名包；没有证书时文件名与发行说明明确标为 unsigned，不能直接作为已签名安装包使用。完整命令见[发布说明](docs/releases-0.5.1.md)。

### 本地网页版 ZIP

解压当前版本的 Web ZIP，进入包含 `server/` 和 `dist/` 的 `Metrolist-Web` 目录。安装 Node.js 24 后运行：

```sh
node --use-env-proxy --max-http-header-size=65536 server/dev.mjs
```

打开 [http://localhost:8787](http://localhost:8787)。无需 npm 依赖安装、Python 或 NSH CLI；终端按 Ctrl+C 停止服务。这个 ZIP 用于本地运行，托管网站的访问者无需启动本机服务。

### 可选 yt-dlp 模式

只有选择此模式时才安装 Python 3。Linux 原生便携包目录内执行：

```sh
python3 -m pip install --target gateway/server/.yt-dlp -r gateway/server/requirements.txt
STREAM_RESOLVER=yt-dlp ./start.sh
```

Windows 原生便携包目录内执行：

```powershell
python -m pip install --target gateway/server/.yt-dlp -r gateway/server/requirements.txt
$env:STREAM_RESOLVER = 'yt-dlp'
.\start.cmd
```

源码工程或 Web ZIP 的解析器目录改为 `server/.yt-dlp`。Windows 直接运行 `server/dev.mjs` 且使用此模式时，再设置 `$env:PYTHON = 'python'`。也可通过 `YT_DLP_PATH` 指定现有 yt-dlp 可执行程序。

## 下载、导入与数据位置

浏览器下载把真实音频写入当前站点的 IndexedDB；再次播放从本地 Blob 读取，也可以导出音频文件。应用资源由 service worker 缓存。文件仅在当前浏览器/站点中保存，清除站点数据会移除这些文件。

Windows / Linux 原生下载由 Node gateway 以流式写入磁盘，默认目录是运行 gateway 的用户目录下 `Music/Metrolist`，下载清单为其中的 `library.json`。`DOWNLOAD_DIR` 可以指定其他目录。原生应用播放已下载音频时仍使用本机 gateway 提供的 `/api/offline`；它不再需要访问 YouTube。若 gateway 运行在另一台电脑，下载文件也位于那台电脑。

Android 下载和音频导入由 Java 流式写入应用私有目录，导入与另存使用系统文件选择器，不经过 JS 的文件缓冲限制。桌面原生文件导入通过 Picker 保存到 NSH 应用数据目录；当前 runtime 的 `fs.writeFile` 单次 8 MiB 限制仍影响这条导入路径，**不影响 Node 的流式磁盘下载**。浏览器文件导入不经过该写入路径。JSON 备份包含曲库、收藏、歌单、搜索历史和收听记录，不包含音频文件本身。

## 一起听

默认服务是原版所列的 `wss://metroserverx.meowery.eu/ws`。在一起听页面设置昵称，连接后创建房间，或填写现有房间号申请加入；主持人批准后同步当前曲目和待播队列。主持人可以批准点歌、移交主持人或移除成员。设置中可改用兼容 Metroserver 的 WebSocket 地址。

该功能使用原版二进制 Protobuf 协议，不要求 Google 账号。房间同步 YouTube 曲目标识；本地文件不会上传给其他成员。主持人控制时间线，访客自然播完等待房间更新。

2026-11-11 已通过真实公共服务完成双客户端创建、审批、播放/暂停/seek、队列移除、点歌、主持人移交及退出验证。记录与验证边界见 [Together 实测记录](docs/together-verification.md)。此次协议检查使用播放器替身，未验证两台实体设备的声音同步精度。

## 从源码开发

需要 **Node.js 24** 与匹配的 **NSH 0.4.0 nightly `c5214aa`**。安装工具链需要 **Python 3.11+** 与 curl。默认音频解析不需要 Python，服务端使用 Node 内置模块，无 npm 运行依赖。

在源码目录安装固定版本的 CLI 与网页组件（Linux / macOS / Windows）：

```sh
python3 scripts/install-nsh.py --component web
node scripts/run-nsh.mjs --version
```

Windows 将 `python3` 换成 `python`。工具链默认放在源码相邻的 `toolchain/`，项目脚本会自动使用它。安装器按 `scripts/nsh-toolchain.json` 检查固定摘要；上游 nightly 更新后，应恢复这份版本的归档或通过 `NSH_DOWNLOAD_BASE` 指向保留该版本的镜像。Android 构建另加 `--component android`。已有 CLI 可通过 `NSH_BIN` 指定；缓存目录可通过 `NSH_CACHE` 指定。

原生开发脚本会先启动 gateway，再打开当前系统的 NSH 窗口：

```sh
node scripts/run-native.mjs
node scripts/run-native.mjs linux
node scripts/run-native.mjs windows
node scripts/run-native.mjs macos
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
npm run check
node scripts/run-nsh.mjs build
npm test
node --test server/*.test.mjs
```

NSH 无界面检查验证共享状态与交互；服务端测试验证目录解析、分页、歌词、音频格式选择、Range/HEAD/CORS、真实磁盘下载/取消/持久化。构建、协议测试、浏览器视觉检查和设备出声属于不同验证项。

## 手机使用自定义 gateway（可选）

Android 默认音乐服务留空，即设备直连。只有主动选择另一台设备的服务时才需要以下配置。

手机与电脑在同一局域网时，将手机应用的音乐服务地址设为电脑实际地址，例如 `http://192.168.1.23:8787`。`127.0.0.1` 在手机上表示手机自身。Node 默认监听 `0.0.0.0:8787`；电脑需允许局域网访问该端口。

Android USB 调试可以建立反向端口转发后启动：

```sh
adb reverse tcp:8787 tcp:8787
node scripts/run-native.mjs android
```

只有建立转发后，Android 应用才能用手动填写的 `http://127.0.0.1:8787` 访问电脑服务。iOS 真机使用可达的局域网或 HTTPS 服务地址，开发目标需在 macOS 上运行。托管网页版直接使用同站点 Worker，无需上述本机配置。

## 平台要求与验证范围

最低要求来自 [NSH 平台说明](https://github.com/longbridge/nsh#platforms) 与 [安装文档](https://nsh.dev/docs/installation)。本移植支持的目标不等于所有旧设备都可运行。

| 平台 | 最低要求/运行条件 | 当前设备验证 |
| --- | --- | --- |
| Web | 支持 WebAssembly、现代音频 API 与所选音频格式的浏览器 | Web 构建与发布后检查分别执行；具体部署版本以线上关于页和发布记录为准 |
| Linux x86_64 | glibc 2.39、GTK 4.14+、WebKitGTK 6.0、GStreamer | 提供便携打包；构建容器缺 GTK/WebKitGTK，未启动原生窗口或验证出声 |
| Windows x86_64 | Windows 10 1809+ | 提供跨平台生成的便携包；未在 Windows 设备启动或验证出声 |
| macOS | macOS 14+ | Apple Silicon / Intel 原生构建与便携打包；构建通过不等于已完成用户设备的播放验收 |
| Android | Android 8 / API 26+；构建需 Android SDK、JDK 和 runtime | 0.5 使用真实 Java 编译、资源链接、DEX、Manifest、签名与 ZIP/ELF 16 KiB 对齐检查；没有真机登录/出声验证 |
| iOS | iOS 15+；构建需 Apple Silicon macOS、Xcode 和对应 runtime | CI 生成真机与模拟器工件；真实设备安装另需有效签名，未验证真机出声 |

本环境已核对真实目录和音频解析响应；访问 googlevideo 媒体地址时，执行网络返回网页内容而非音频字节，不能据此宣称已经实机出声。音频格式选择、代理与下载流程另以本地 HTTP 音频源进行测试。Together 的公共服务协议测试已经独立完成。服务端验证详见 [验证记录](docs/VERIFICATION.md)。

当前 runtime 的 Linux 倍速固定为 1×。Android 已接入原生后台媒体服务、MediaSession、锁屏和通知控制，实际设备后台持续运行仍待验证；iOS 需要对应平台专项实现。浏览器 MediaSession 已接入，但实际可用的系统控件取决于浏览器与操作系统。

本次使用 `nsh 0.4.0 (c5214aa nightly)`。GitHub Actions 工作流覆盖 Android、Linux、Windows、macOS、iOS 和 Web；所有组件使用固定版本与下载摘要。`main` 的发行流程收集各平台工件并发布 GitHub Release；Android 与 Apple 的持久签名通过仓库 Secrets 配置。Site 的源码与发布使用其独立发布通道，详见发布说明。

## 打包与复现

NSH 标准打包：

```sh
node scripts/run-nsh.mjs package --target linux --out releases/linux
node scripts/run-nsh.mjs package --target windows --out releases/windows
node scripts/run-nsh.mjs package --target macos --out releases/macos
node scripts/run-nsh.mjs package --target web --out releases/web-standard
```

标准原生包包含应用与 NSH runtime，音乐服务单独启动。增强便携包将 gateway、启动器、README 与许可证一同装入发行目录：

```sh
python3 scripts/package-portable.py linux windows
npm run build
python3 scripts/package-portable.py web
```

可只指定一个目标；Windows 将 `python3` 换成 `python`。默认输出到工程父目录 `artifacts/`，`--out` 可更改。`NSH_BIN` 可指定 CLI；模板位于 `scripts/portable/`。原生打包需要对应 runtime；Web ZIP 打包使用当前 `dist/client`，必须先构建。

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
| src/api.ts | 音乐 API 与可配置服务地址 |
| web/host.js、web/sw.js | 浏览器文件、下载、MediaSession 与应用资源缓存 |
| server/catalog.mjs | YouTube Music/InnerTube 目录与 LRCLIB 歌词 |
| server/streaming.mjs、server/index.mjs | Web 标准 Worker 音频解析、代理与 API |
| server/dev.mjs、server/resolve.mjs、server/downloads.mjs | 本地 Node 服务、可选 yt-dlp、流式磁盘下载与离线文件 |
| assets/catalog-seed.json、assets/artwork/ | 真实目录种子及对应封面 |
| scripts/run-native.mjs、scripts/portable/ | 原生开发启动与便携发行启动器 |

### Node gateway 参数

| 环境变量 | 用途 |
| --- | --- |
| NSH_BIN | 开发/打包使用的 CLI，默认 nsh |
| PORT | gateway 端口，默认 8787；改变后同步更新原生应用服务地址 |
| HOST | 监听地址，默认 0.0.0.0 |
| STREAM_RESOLVER | 默认使用纯 JavaScript VISIONOS；设为 yt-dlp 才调用可选解析器 |
| PYTHON | 可选解析器的 Python 程序，启动器在 Windows 使用 python、其他系统 python3 |
| YT_DLP_PATH | 已安装的 yt-dlp 可执行程序路径 |
| DOWNLOAD_DIR | 磁盘下载目录，默认用户的 Music/Metrolist |
| STATIC_DIR | 相对于 server/ 的静态目录，默认 ../dist/client |
| PUBLIC_ORIGIN | API 对外地址，用于生成音频与下载文件的绝对 URL |

## 许可证

应用源代码采用 **GPL-3.0-only**，完整条款见 [COPYING](COPYING)。原版 Metrolist、InnerTubeX、Metroserver、NSH、yt-dlp、歌词与图片归属见 [NOTICE.md](NOTICE.md)。封面与品牌素材的版权仍归各自权利人。分发二进制时请一并提供同版本完整源代码与许可证。


## Git 与源代码交付

公开源码仓库：[lurenjia534/Metrolist-NSH](https://github.com/lurenjia534/Metrolist-NSH)。本仓库从 `Metrolist-NSH-0.4.0-source.zip` 导入 0.4.0 源码快照；该归档不含 `.git`，因此这里的提交历史从此次导入开始，不包含此前的开发历史。根目录 `AGENTS.md` 保留用户指定开发要求。0.4 的 Android 安装包及签名备份单独交付，签名文件不写入代码仓库或公开站点。

源码发布前检查敏感凭证；账号测试使用人工 fixture，Android 持久签名通过 GitHub Actions Secrets 配置。本地托管配置 `.openai/hosting.json` 不提交。`scripts/publish-github.sh` 可用于显式创建新的公开仓库。
