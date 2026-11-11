# Metrolist NSH 0.5.1

本版补全可下载发行包与发布流水线。Android 延续 0.5 preview 的应用标识和签名；桌面发行包自带音乐 gateway 与 Node.js 24.22.1；iOS 同时提供 Apple Silicon 模拟器包和明确标记的未签名设备包。

## 下载与运行

| 平台 | 产物 | 启动方式 |
| --- | --- | --- |
| Android 手机 | `android-arm64.apk` | 安装 APK；使用与 0.5 preview 相同的签名覆盖升级 |
| Android 其他架构 | `android-universal.apk` | 包含 arm64-v8a、armeabi-v7a、x86_64 |
| Linux x64 | `linux-x64.tar.gz` | 完整解压后运行 `./Metrolist` 或 `./start.sh` |
| Windows x64 | `windows-x64.zip` | 完整解压后双击 `Metrolist.exe` |
| macOS Apple Silicon / Intel | `macos-arm64.zip` / `macos-x64.zip` | 将包内 `Metrolist.app` 拖到“应用程序”并打开 |
| iOS Simulator | `ios-simulator-arm64.zip` | 在 Apple Silicon Mac 的 iOS Simulator 安装 `.app` |
| iOS 设备 | `ios-device-arm64-unsigned.ipa` / `.app.zip` | 需要适用的 Apple 证书与 provisioning profile 重新签名 |
| Web | `web.zip` 与在线 Site | ZIP 含静态页面、Worker 与 Node gateway；在线 Site 单独发布 |

桌面启动器自动启动本机 `127.0.0.1:8787` 音乐 gateway，再打开原生窗口，关闭窗口时结束本次 gateway。无需另行安装 Node、Python 或 NSH。默认解析器使用纯 JavaScript；只有显式选择可选 yt-dlp 模式才需要 Python。

Linux 仍需 GTK 4.14+、WebKitGTK 6.0、GStreamer 和兼容的 glibc，例如 Ubuntu 24.04。Windows 需要 Windows 10 1809+。macOS 需要 macOS 14+；当前 `.app` 为 ad hoc 签名，不是 Developer ID 公证发行。

iOS Simulator 包只适用于 ARM64 模拟器，不能安装到 iPhone。`unsigned` 设备 IPA 不含有效开发者签名，不能把它称为可直接安装的签名版。配置可选 Apple secrets 后，流水线另行生成 `ios-device-arm64-signed.ipa`；其可安装设备范围取决于 profile。

## 构建与发布流程

`.github/workflows/build.yml` 在 PR、main 更新和 `v*` 标签运行。PR 只构建并保留 Actions artifacts；合入 main 后自动发布当前版本的 GitHub Release。推送版本标签，或在 main 手动运行并启用 `publish_release`，也会执行发布。

流水线先运行共享 NSH 类型检查、应用测试和 Node gateway 测试，再并行构建 Android、Linux x64、Windows x64、macOS ARM64、macOS Intel、iOS 与 Web。桌面包会运行包内 Node 和 gateway 的真实健康检查；Windows 也执行新 EXE 启动器的检查入口。iOS job 会把真实 `.app` 安装到可用 iPhone Simulator 并启动。

Release 聚合实际生成的文件，提供同提交源码 ZIP、每份产物的构建报告、`release-manifest.json` 与 `SHA256SUMS.txt`。部分平台缺失或 CI 失败时，只发布已经存在的文件，并把该 Release 标为待补齐的预发布；补齐后可重跑同一提交的流水线更新产物。版本标签必须始终指向产物记录的提交；修改源码后须提高版本，发布脚本不会把另一提交的文件写进既有版本。

### Android 签名 secrets

仓库 Actions secrets：

- `ANDROID_KEYSTORE_BASE64`：0.5 preview 原签名 keystore 的 Base64 内容。
- `ANDROID_KEYSTORE_PASSWORD`：该 keystore 的密码。

不要创建替代密钥。`scripts/release-config.json` 固定公开的证书 SHA-256 指纹及 `app.miku.metrolist.preview` 应用标识；发布脚本核对实际 APK 证书。缺少 secrets 时 Android 发布 job 明确待配置，其他平台继续构建，不会产出随机签名 APK 冒充升级包。

### 可选 iOS 签名 secrets

- `IOS_CERTIFICATE_P12_BASE64`
- `IOS_CERTIFICATE_PASSWORD`
- `IOS_PROVISION_PROFILE_BASE64`
- `IOS_SIGNING_IDENTITY`

Profile 需要覆盖 `app.miku.metrolist.preview`。证书只导入本次 macOS runner 的临时 keychain，构建完成后删除。GitHub Release IPA 构建不需要 App Store Connect API key；本流程不上传 TestFlight。

## 本地命令

```sh
# 固定 CLI 与需要的组件；iOS 必须在 Apple Silicon Mac 执行
python3 scripts/install-nsh.py --component web --component android
npm run check
npm test
node --test server/*.test.mjs

# 当前系统的桌面包，自动附带固定版本 Node
python3 scripts/package-portable.py linux --arch x64
python3 scripts/package-portable.py windows --arch x64
python3 scripts/package-portable.py macos --arch arm64

# Web 发行包；站点发布由发布端单独执行
npm run build
python3 scripts/package-portable.py web

# 使用已私密恢复的 0.5 preview 签名，构建两种 Android APK
python3 scripts/release.py android

# Apple Silicon Mac：始终生成 Simulator + unsigned device
python3 scripts/install-nsh.py --component ios
python3 scripts/build-ios.py
python3 scripts/smoke-ios.py

# 已配置有效 IOS_SIGNING_IDENTITY 与 IOS_PROVISION_PROFILE 时追加签名 IPA
python3 scripts/build-ios.py --signed-only
```

这些桌面命令分别在对应操作系统执行；Windows 将 `python3` 换成 `python`。固定 NSH revision 为 `c5214aa`，固定 Node 的下载摘要在 `scripts/node-toolchain.json`。原始 NSH nightly 会滚动，重建时应保留对应下载缓存或版本镜像。

## Web Site 版本确认

构建将 service worker 的缓存名绑定到应用版本，并生成 `/version.json`，包含 `{version, build}`。GitHub 发布 Web ZIP 不等于在线 Site 已部署；在线版本以实际 Site 的 `/version.json` 与可访问页面为准。

每次发行的具体 CI 结果、提交与文件摘要由下方自动附加的构建记录和 Release assets 给出。编译、模拟器启动和 gateway 健康检查不能代替真机网络、音频输出与完整账号登录验证。
