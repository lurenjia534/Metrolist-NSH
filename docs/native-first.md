# Native First：桌面运行架构

桌面版直接运行 NSH 原生可执行程序。共享 TSX 界面与业务逻辑运行于 QuickJS，系统能力由 NSH Rust runtime 和项目 Rust 扩展提供。

| 层 | 运行位置与职责 |
| --- | --- |
| 共享应用 | NSH / QuickJS 中的 TSX、账号、曲库、目录请求、音源解析与播放状态 |
| 原生网络 | NSH `fetch` 发出音乐 API 请求；普通音源由原生播放器直接打开；需要请求头的音源由同进程 Rust 媒体转发处理 |
| 原生文件 | Rust 扩展以流方式下载音频、处理本机文件；完成后直接播放本机文件 |
| 系统界面 | Linux GTK 4 / Pango，Windows / macOS 对应的 NSH 原生后端 |
| Web | 浏览器 NSH 运行时、Web host，以及独立部署的 Worker 音乐 API |

`server/catalog.mjs`、`server/account.mjs`、`server/streaming.mjs` 和 `server/index.mjs` 使用 Web 标准 API，可以由 QuickJS 直接调用。文件扩展名 `.mjs` 不要求 Node；桌面程序无需启动 HTTP 服务来调用这些业务函数。

## 发行包

Linux 的 `Metrolist`、Windows 的 `Metrolist.exe`、macOS 应用包中的原生入口均由 `nsh package` 生成。发行脚本保留 NSH 的原始入口，并附带说明和许可。包内没有 Node 可执行文件、Node gateway 或 C# / shell 网关启动器。音乐业务不依赖 8787 HTTP 服务；带请求头的音频可以使用同一 Rust 进程内、临时端口上的媒体转发。

音乐服务地址默认留空，下载使用本机能力。已保存的远程服务仍可在设置中使用；需要切回本机时清空该地址。旧版下载位于旧服务的目录时，可通过文件导入加入当前曲库。

每份发行包旁的 `.build-info.json` 记录 `runtime: nsh-native`、`bundledNode: false`、`bundledGateway: false`、原生可执行文件摘要和 NSH 字节码摘要。打包时验证这些文件真实存在、二进制格式和应用身份匹配，并检查旧 Node / gateway 文件没有进入产物。这项检查验证发行包内容；界面启动、真实网络和出声验证由各自的测试记录说明。

## 从源码运行

安装匹配的 NSH 0.5.0（`f4d68f7`）CLI、Rust 1.99.1 与对应系统编译依赖。工具链安装和下面的辅助命令使用 Python 3.11+：

```sh
python3 scripts/install-nsh.py
python3 scripts/run-native.py
python3 scripts/run-nsh.py check
python3 scripts/run-nsh.py test --web-host tests/native-login/host.js
python3 scripts/package-portable.py linux
```

Windows 将 `python3` 改为 `python`。原生运行脚本还接受 `linux`、`windows`、`macos` 等 NSH 目标；`NSH_BIN` 指定 CLI，`NSH_CACHE` 指定组件缓存。项目 Rust 模块由 `nsh build` / `nsh package` 编译和静态链接，运行安装包不需要 Rust 或 Python。

iOS 的原生下载可在应用内离线播放。NSH 0.5 下，iOS 本地文件通过应用已有的 Rust loopback 媒体通道流式读取，支持 GET、HEAD 和 Range；持久记录仍保存原文件地址，暂停和恢复复用当前来源。桌面继续直接读取应用数据目录内的音频。iOS 音频导出到 Files 尚未实现；桌面音频导入、导出和“在文件管理器中显示”使用 NSH 原生对话框与 Rust 文件能力。

Linux 构建需要 GTK 4.14+、WebKitGTK 6.0、GStreamer 开发库、pkg-config 和 clang；运行需要对应共享库。macOS 构建使用 Xcode 工具链，Windows 使用 MSVC 工具链。

## Node 的剩余用途

Node 24 继续用于可选的 Web 构建脚本、共享业务测试与本地网站服务。`npm` 命令保留为开发便利入口；直接使用上述 Python / NSH 命令即可运行和打包原生桌面版。

`server/dev.mjs` 和 `server/downloads.mjs` 只服务于用户主动启动的本地 Web / 远程 gateway 模式。它们不会被复制进桌面包，也不会由原生启动入口执行。托管 Web 的 API 仍可部署为 Worker。

Apple 平台的 `nsh.json` 同时声明本地网络和 `127.0.0.1` 的 ATS 例外，供系统播放器访问进程内转发接口；共享 API 依旧直接连接 HTTPS 上游。依据：[Apple NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)。
