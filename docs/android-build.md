# Android APK 构建与原生播放

当前源码版本为 **0.7.1**。可升级发行使用 `python3 scripts/release.py android`，沿用 `app.miku.metrolist.preview` 和原 0.5 preview 签名。下面的播放链路与签名方式继承自 0.5.1；0.7 的 Spotify 工作区在 Android 上为明确标注的界面演示，详见 [0.7 发布说明](releases-0.7.0.md) 与 [手机触摸修复](releases-0.7.1.md)。

## 0.5.1 的 Android 播放链路

界面仍由 NSH 渲染。Android 继续使用 0.4 已引入的原生 **Media3 ExoPlayer 1.10.1**，使用 OkHttp 数据源和 1 GiB LRU 磁盘缓存；Web、桌面平台继续使用 NSH AudioPlayer。0.5 重点改进解析请求复用、下一首准备、429 行为与播放状态界面。

`MetrolistAudio` 在应用进程中保留一个 ExoPlayer。暂停、恢复、切换页面和 Activity 重建不会重新创建播放器；切歌更换 MediaSource，不销毁引擎。音频直接从签名地址加载，HTTP 请求头随对应曲目传给 OkHttp，不通过 JavaScript 全量下载音频后再播放。

与本轮核对的原版 Metrolist 相同，配置为：

| 项目 | 配置 |
| --- | --- |
| 播放器 | Media3 ExoPlayer 1.10.1 |
| 最小 / 最大预缓冲 | 50,000 / 50,000 ms |
| 首次开始播放阈值 | 750 ms |
| 重新缓冲后恢复阈值 | 2,000 ms |
| 流缓存 | SimpleCache + 1 GiB LRU |
| 网络连接 | 一个复用的 OkHttpClient |
| 唤醒模式 | `WAKE_MODE_NETWORK` |
| 音频焦点 / 耳机拔出 | ExoPlayer 音频焦点管理、AudioBecomingNoisy |

缓存按歌曲与音频格式的稳定 `cacheKey` 区分，不把会过期的签名 URL 作为同一首歌的唯一缓存身份。媒体内容与 HTTP Range 读取由 Media3 的数据源和提取器处理。

当前歌曲开始播放后，共享播放逻辑解析实际下一首；只有当前前方缓冲达到 12 秒，Android 才以 `CacheWriter` 读取下一首最多 256 KiB 的开头。它复用播放数据源、请求头与缓存标识，切歌即可读取已缓存的部分。切换歌曲、队列或账号时会结束旧准备任务。此实现不等于完整队列已经交给 ExoPlayer，也不提供无缝播放。

音频 CDN 返回 HTTP 429 时，当前 MediaSource 的错误策略直接结束该次加载，不使用 Media3 默认的连续重试；其余错误保持原生策略。界面显示音频数据阶段的 429，用户重试会重新解析地址。`SimpleCache` 由进程持有，服务重建复用同一缓存，避免异步预读尚未结束时重新打开缓存锁。

### 界面、服务和通知

`MetrolistMediaService` 管理前台媒体通知和 Android MediaSession。系统的播放、暂停、seek 直接操作原生引擎，再将实际状态传回 NSH；上一首、下一首继续交给共享队列。一起听访客的系统控制约束由 `remoteControlled` 同步到原生层。

播放时每 250 ms 向已连接的 NSH View 发一份位置 / 缓冲快照。状态变化即时发送。暂停、没有活动曲目或 View 分离时不运行这条 UI 进度计时器。Android 不再把每份进度又通过 `app.playback` 发回原生服务。

MediaSession 使用自身时间基准推算播放位置，仅在原生状态变化或 seek 时更新；歌曲元数据只在内容变化时重建，通知只在歌曲、播放意图或系统控制权限变化时重建。

Activity 销毁时只解除 View 连接，当前曲目继续由前台服务持有。新 Activity 加载已有队列后通过 `app.audio.snapshot` 重接当前曲目和真实位置。强行停止应用或系统结束整个进程后，不会自动重建已销毁的播放器。完整队列和下一首解析仍由 NSH 共享逻辑负责。

## 构建

需要 Python 3.11+、Java 17 以上（带 `jdk.compiler` 模块）、curl，以及 NSH 0.5.0 `f4d68f7`。既有 Android 构建使用 JDK 21。重建不需要 Gradle 或 Maven；NSH 自定义 Rust Host 的构建还需要 Rust 与 Android NDK。

```sh
# 安装本项目匹配的 CLI 与 Android runtime
python3 scripts/install-nsh.py --component android

# 手机常用的较小 arm64 APK
python3 scripts/build-android.py --abi arm64-v8a

# 三架构通用 APK
python3 scripts/build-android.py
```

本轮使用独立应用标识 `app.miku.metrolist.preview` 与名称 `Metrolist NSH Preview` 并排安装，保留旧版应用及其数据：

```sh
python3 scripts/build-android.py --abi arm64-v8a \
  --application-id app.miku.metrolist.preview --application-name 'Metrolist NSH Preview' \
  --out releases/android/arm64

python3 scripts/build-android.py \
  --application-id app.miku.metrolist.preview --application-name 'Metrolist NSH Preview' \
  --out releases/android/universal
```

该参数同时修改最终 Android Manifest 和 APK 内 NSH `app.json` 的应用 ID；NSH 数据目录与 host 的下载目录保持一致，其他平台的源码 ID 不变。

默认从项目相邻的 `toolchain` 使用工具链，产物写入 `releases/android/`。可指定已有工具链和签名：

```sh
python scripts/build-android.py \
  --nsh /path/to/nsh/bin/nsh \
  --sdk /path/to/android-sdk \
  --toolchain /path/to/metrolist-toolchain \
  --keystore /private/path/metrolist-release.jks \
  --password-file /private/path/metrolist-password \
  --alias metrolist \
  --abi arm64-v8a
```

也支持 `ANDROID_HOME` / `ANDROID_SDK_ROOT`、`JAVA_HOME`、`NSH_BIN` 和 `NSH_KEYSTORE_PASSWORD`。密码不输出到命令行。

Linux 缺少 SDK 时，脚本从 Google 官方仓库获取 `build-tools;35.0.1` 与 `platforms;android-35`；macOS / Windows 可先用 Android SDK Manager 安装。NSH Java 源码与原生库都固定为 `f4d68f7`。

Media3、OkHttp、Kotlin 和其依赖固定在 `android/media3-dependencies.json`，包含官方 Google Maven / Maven Central 地址和摘要。NSH CLI、Android/Web 组件与 Java 源码固定在 `scripts/nsh-toolchain.json`。发布构建读取这两份清单，不临时解析“最新版本”。安装器和 Android 构建优先使用本仓库的 `nsh-runtime-f4d68f7` 固定工具链 Release；只有镜像资产返回 HTTP 404 时才从上游稳定版 `v0.5.0` 引导，随后仍校验固定摘要。`NSH_DOWNLOAD_BASE` 可指定同一固定版本的其他镜像；不同版本的 Java 与 JNI 库不能混用。

### 资源与字节码

1. 用匹配的官方 NSH Android 运行时打出当前 TSX 的基础 APK。
2. 合并 Media3 AAR 的多语言字符串资源和本项目 Manifest；由 AAPT2 生成最终资源表及对应的 `R.java`。
3. 将官方 NSH Java、项目 host / 播放器 / 前台服务和生成的 `R.java` 一起编译，使用完整依赖 classpath。
4. D8 处理应用与所有运行时依赖，将生成的 `classes*.dex` 装入最终 APK。不会只复制 AAR 的 `classes.jar` 而遗漏它的资源 ID。
5. 执行 16 KiB ZIP 对齐和 APK 签名，检查签名以及每个架构 ELF `PT_LOAD` 的 16 KiB 对齐。
6. 输出 APK、SHA-256 和 `build-info.json`，记录实际 Git 状态、引擎版本、缓冲设置、架构和关键源码摘要。

最低系统 Android 8（API 26），目标 API 35。`--abi arm64-v8a` 输出 `Metrolist-<version>-arm64.apk`；默认通用包包含 `arm64-v8a`、`armeabi-v7a` 和 `x86_64`。

## 签名

0.5.1 发行必须恢复 `toolchain/signing/` 中原 0.5 preview 的 keystore 和密码，并使用 `release.py android` 核验证书。底层 `build-android.py` 在开发场景可生成 RSA 3072 位新密钥；它不应替代原发行签名。私钥不进入源码仓库，覆盖升级必须使用同一签名。

0.5 preview 的签名已私密保存，0.5.1 沿用同一应用标识和证书，可覆盖该 preview 系列。更早的 0.4 使用 `app.miku.metrolist.next` 与不同签名，属于独立安装系列；可通过音乐库导出/导入迁移。实际包名、证书与 APK 摘要以本次构建报告为准。

签名备份应单独私有保存，不放入公开文档、APK 或源码压缩包。

## Android host 契约

`nsh.json` 的 `app.*`、`auth.*`、`files.*` 覆盖这些接口。

| 接口 / 事件 | 行为 |
| --- | --- |
| `app.capabilities` | 平台能力与 `audioEngine` 名称。 |
| `app.audio.open` | 接受 `requestId,track,url,headers,mimeType,cacheKey,position,volume,rate,playWhenReady,remoteControlled`，设置音源并开始准备；调用返回不表示已经出声。 |
| `app.audio.play` / `pause` | 原生播放或暂停，保留播放器与已缓冲数据。 |
| `app.audio.seek({position})` | 跳到秒数；系统 seek 的状态包含 `discontinuity:true`，不把跳过的时间算作收听时长。 |
| `app.audio.settings` | 修改 `volume,rate,remoteControlled`。 |
| `app.audio.stop` | 清空原生媒体源并结束前台服务。切歌使用 open，不使用 stop→open。 |
| `app.audio.snapshot` | 无音源返回 null；否则返回实际状态、track、source 和引擎信息，供 Activity 重接。 |
| `app.audio.preload` / `cancelPreload` | 使用下一首的 URL、请求头、cacheKey 和可选 contentLength，在播放缓存中预读最多 256 KiB；取消结束该准备任务。 |
| `audio.preload` | 返回 trackId、cacheKey、cached，界面只更新匹配的下一首状态。 |
| `audio.state` | `requestId,position,duration,bufferedPosition,playing,playWhenReady,buffering,state,rate,volume,error?,errorCode?`。长 URL 和曲目信息只在 snapshot 提供。 |
| `media.command` | 系统上一首 / 下一首交给共享队列。 |
| `auth.available/login/logout` | Android WebView + CookieManager 本人会话登录，保留 0.3.0 的账号功能。 |
| `files.download/import/export` | 后台分块下载、Android 文件选择器导入与导出，保留 0.3.0 的文件功能。 |

Manifest 包含 Internet、网络 / Wi-Fi 状态、唤醒锁与媒体播放前台服务权限。Activity 使用 singleTask；根页返回将任务移到后台。

## 验证边界

本轮验证应覆盖真实 Java 编译、资源链接、D8、签名、ABI / API 信息与 16 KiB 对齐，以及 NSH 测试中的 native host 状态协议。执行环境没有可用 Android 真机会话，编译通过不等于已验证具体手机的实际网络、音频解码和锁屏交互；真机卡顿改善须以手机试听和缓冲状态为准。

## 官方参考

- [原版 Metrolist MusicService](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt)
- [Media3 自定义播放器与数据源](https://developer.android.com/media/media3/exoplayer/customization)
- [Media3 DefaultLoadControl](https://developer.android.com/reference/androidx/media3/exoplayer/DefaultLoadControl.Builder)
- [NSH Android host](https://github.com/longbridge/nsh/blob/f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1/crates/nsh-platform-android/java/com/longbridge/nsh/NshView.java)

## 0.5.1 的可升级发行与 CI

0.5.1 继续使用 `app.miku.metrolist.preview`、`Metrolist NSH Preview` 与 0.5 preview 的既有签名，版本码由 `nsh.json` 提供。新原生登录控制器 `MetrolistLogin.java` 会随所有 Java host 源码一起编译，构建报告新增 `loginSourceSha256`。

发行入口为：

```sh
python3 scripts/install-nsh.py --component android
python3 scripts/release.py android
```

该命令先要求恢复原 keystore 与密码文件（默认位于项目相邻的 `toolchain/signing/`），随后串行构建通用与 arm64 APK，并校验实际签名证书是否与 `scripts/release-config.json` 的公开指纹相同。确认后才将版本化文件写入 `dist/release/`；各自详细报告仍留在 `releases/android/universal/` 与 `releases/android/arm64/`。

GitHub Actions 使用 `ANDROID_KEYSTORE_BASE64` 与 `ANDROID_KEYSTORE_PASSWORD` 两个仓库 secrets 恢复同一密钥。缺少这两个 secrets 时 Android Release 标为待配置，Linux、Windows、macOS、iOS 和 Web 构建照常进行；流水线不会临时生成另一个签名的“升级”包。具体平台发布、可选 Apple 签名和聚合 Release 说明见 [0.5.1 发行说明](releases-0.5.1.md)。

已有的底层 `build-android.py` 仍支持为开发用途创建新签名；发布和升级应使用上述 `release.py android` 入口，它明确要求原签名并核验证书。私钥与密码不进入源码 ZIP、构建报告、公共 artifact 或 GitHub Release。
