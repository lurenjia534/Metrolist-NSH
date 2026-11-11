# Metrolist NSH 0.3.0

2026-11-11 · Android versionCode 3

## 账号与云端音乐库

Android 使用内置 Google / YouTube Music 登录窗口，通过 CookieManager 和网页配置取得会话，再请求真实账号资料；Web 和桌面版可导入本人会话。新增头像与姓名、多账号、品牌频道选择、账号切换和退出。首页右上角、桌面侧栏及设置提供账号入口。

云端库支持喜欢、歌曲、专辑、订阅、歌单五类内容，读取全部 continuation 并按账号持久化。音乐库提供本机 / YouTube Music 切换。新建云端歌单可填写简介和可见性；支持重命名、删除、添加曲目和具体条目的移动、移除。重复歌曲使用 setVideoId 区分。

歌曲菜单、播放器喜欢、专辑收藏、歌手订阅及本机歌单加入云端均已接入接口。关闭“使用账号浏览”仅影响目录推荐；账号播放仍携带当前会话。

## Android 原生功能

APK 内运行纯 Web API 编写的音乐接口模块，手机默认直连服务。新增原生流式下载、实际字节进度、取消、移除、音频另存与多文件导入，文件选择由系统界面完成。

新增 MediaSession、MediaStyle 媒体通知、mediaPlayback 前台服务和播放期间的唤醒锁；系统与蓝牙控制通过 host 事件调用同一个 NSH 播放器。Activity 被系统销毁后重建完整播放服务还未实现。

通用 APK 包含 arm64-v8a、armeabi-v7a、x86_64；Android 8.0 / API 26 起，target API 35。构建使用匹配 NSH c5214aa 的 Java 层与原生库，加入项目 host 后经过 D8、资源重链接、签名与 ZIP / ELF 16 KiB 检查。

## 工程与文档

- 根目录 `AGENTS.md` 保存用户指定的开发要求。
- [公开知识库](https://metrolist-nsh-docs.lurenjia534.chatgpt.site/) 已发布，包含安装、账号、音乐库、播放、离线、开发、构建和版本交付。
- `scripts/build-android.py` 用于生成本项目完整 APK；`scripts/publish-github.sh` 创建并推送 GitHub 私有源码仓库。
- 源码 ZIP、完整 Git bundle、APK 与 SHA-256 文件配套交付；签名身份独立保管，不写入源码或公开文档。

## 验证含义

账号和界面测试使用人工会话与网络 fixture。真实 Google 本人登录、品牌频道实际数据、账号曲目播放、锁屏和后台生命周期需由真实设备验证。开发网络未取得真实 googlevideo 音频正文，因此不能将音源解析成功或模拟音频测试说成实际出声成功。

部分账号音源需要尚未实现的 signatureCipher / PoToken；此时报告实际结果，不用匿名曲目冒充账号内容。macOS / iOS 本轮未构建安装包。

最终检查和产物信息见 `docs/VERIFICATION.md`、`docs/android-build.md` 与 APK 随附的 `build-info.json`。
