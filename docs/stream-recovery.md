# 音源被 CDN 拒绝后的自动恢复

签名地址过期或被 googlevideo 拒绝时，音频请求会返回 HTTP 403 或 410。过去本项目把这类错误直接显示给用户，用户需要点“重试播放”才会用 `refresh=1` 重新解析。原版 Metrolist 会在后台自动恢复，本项目现在按原版的语义处理。

## 原版行为

依据 [Metrolist `e6fea3b` MusicService.kt](https://github.com/MetrolistGroup/Metrolist/blob/e6fea3b36c68841bad21daa6252e1d69ecd3afbe/app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt)：

| 位置 | 行为 |
| --- | --- |
| `isExpiredUrlError`（L2951） | 沿异常链取 `InvalidResponseCodeException.responseCode`，只有 403 和 410 算作地址被拒绝。 |
| `onPlayerError`（L3043–3132） | 先检查这首歌是否已超过重试上限；然后清除这首歌的地址缓存（`performAggressiveCacheClear`，L3138），403 / 410 交给 `handleExpiredUrlError`（L3310）。 |
| `refreshStreamAndRetry`（L3327–3380） | 重试次数加一，作废缓存地址，把失败的客户端标为对这首歌失败 5 分钟（`InnerTubeXPlayer.STREAM_CLIENT_FAILURE_TTL_MS`），刷新 cipher 配置；记下当前位置、曲目和 `playWhenReady`，等待 `RETRY_DELAY_MS`（1 秒）后 `seekTo` 同一位置并 `prepare()`。等待期间用户改了曲目、位置或播放意图时，放弃这次重试。 |
| `MAX_RETRY_PER_SONG`（L539） | 每首歌 3 次。 |
| `STATE_READY`（L2679–2687） | 播放器就绪即清零这首歌的重试次数。所以上限只约束“恢复后还没播起来又被拒绝”的连续失败。 |
| `hasExceededRetryLimit` → `markSongAsFailed`（L3154、L3179）→ `handleFinalFailure`（L3465） | 次数用尽：清除计数；开启自动跳过或自动播放且有下一首时跳到下一首，否则暂停。 |

429 不在上面的分支里：原版和本项目都不会因为 429 重新解析。

## 本项目的实现

所有平台共用 [`src/playback.ts`](../src/playback.ts) 的 `sourceFailed`：

| 平台 | 判断音源是否被拒绝 |
| --- | --- |
| Android | `MetrolistAudio.onPlayerError` 读取同一个 `InvalidResponseCodeException`，上报 `errorCode` 为 `http-403` / `http-410`；429 上报为 `rate-limited`。 |
| Linux / Windows / macOS / iOS | NSH `AudioPlayer` 的 `error` 事件只有 `network`、`decode` 等类别，没有 HTTP 状态。出错后用解析结果自己的地址和请求头（`User-Agent`、`Origin`、`Referer`）直接向音源发一次 `Range: bytes=0-0`，得到的 403 / 410 就是 CDN 当前的回答。不探测 Rust 中转：中转会用已经读到内存里的字节回答，CDN 已拒绝时仍可能返回 206。 |
| Web | 同上；Web 的音源地址就是网关的 `/api/audio`，网关把上游 403 / 410 作为同一状态码返回。 |

判断为 403 / 410 后：

1. 不显示错误。正在播放时显示缓冲；用户已暂停时保持暂停。
2. 1 秒后，如果期间没有切歌、重新加载或手动重试，就以 `refresh=1` 重新解析，从当前位置继续。用户在等待期间暂停，恢复后的音源保持暂停；暂停后再按播放，会立即重新解析，不再等满 1 秒。
3. 每首歌最多连续 3 次；新音源开始播放时清零。第 4 次连续被拒绝时显示错误（`http-403` / `http-410`），点“重试播放”后重新开始计数。
4. 同一次失败的重复上报（Android 引擎在出错后的每个事件都会带着错误发布状态；桌面播放器的 `error` 事件和 `play()` 的拒绝）只处理一次。

暂停时被拒绝的音源会以暂停状态重新打开（Android `playWhenReady=false`，桌面和 Web 只预加载），对应原版保留 `playWhenReady` 的做法。

### 与原版的差别

- **没有移植客户端排除和 cipher 刷新。** 原版会让同一首歌在 5 分钟内跳过刚失败的客户端，并刷新播放器配置。本项目的解析器在网关和原生共享代码中，`refresh=1` 只作废缓存并重新解析，仍然先选 VISIONOS。把失败客户端传给解析器需要改动解析接口，留作后续工作。
- **次数用尽后显示错误，不自动跳歌。** 本项目目前没有“出错自动跳到下一首”的设置，最终失败沿用原有的错误提示与重试入口。
- **等待期间的改动。** 原版只要位置或播放意图变化就放弃重试；本项目只在切歌或重新加载时放弃，暂停和拖动会带进这次恢复。

## 验证

2026-11-13，在本分支（以主工作区未提交的 10 MiB 分段修复为基础）上运行：

| 验证 | 结果 |
| --- | --- |
| `tests/stream-recovery.test.tsx`（新增 9 项） | 通过。Android：播放到 96.25 秒时收到 403，同一失败上报两次只恢复一次，1 秒前不重新解析，1 秒后以 `refresh=1` 解析出新地址，并在 96.25 秒、`playWhenReady=true` 处打开；每次都恢复到播放的 403 不会用完次数；未恢复到播放的连续 403 / 410 恢复 3 次，第 4 次显示 `http-403` 错误，之后 5 秒没有任何新请求；“重试播放”后重新计数；429 立即显示错误，不重新解析；暂停中被拒绝时以暂停状态在拖动后的位置重新打开；等待期间切歌会放弃恢复。Web 与 Linux：播放器出错后带着音源请求头直接对音源（Linux 上不是中转地址）发 `Range: bytes=0-0`，403 时以 `refresh=1` 打开新地址并定位到原位置；429 时显示原错误，不重新解析。 |
| 变异检查 | 把次数上限改为 0、忽略探测结果后，5 项恢复用例失败，4 项“不应恢复”的用例仍通过；把探测对象换成中转地址后，Web 与 Linux 的播放器用例失败。 |
| `tests/playback-preparation.test.tsx` | 通过。原用例用 403 / 410 测试手动重试；这两种错误现在自动恢复，因此改用普通播放失败（`network`）测试手动重试和恢复播放仍带 `refresh=1`。 |
| 全量 NSH 测试与类型检查 | `python3 scripts/run-nsh.py test --web-host tests/native-login/host.js`：293 项，282 通过，0 失败，11 项按环境跳过（Spotify 基准、真实浏览器与 PulseAudio / MPRIS）。`nsh check`（TypeScript 与 `cargo check`）通过。 |

**尚未验证**：真实设备上的整条路径，包括 Android 真机上 Media3 收到真实 googlevideo 403、桌面 GStreamer / AVPlayer 和浏览器在真实 403 下实际报出的错误类别和时机。无头测试中的播放器不会读取音源，桌面和 Web 的失败是在 `AudioPlayer` 的 `error` 回调处注入的。另一个未验证点是桌面中转在一首歌中途（第 2 个及之后的 10 MiB 分段）收到 403 时，GStreamer 看到响应体中断后是报错还是当作播放结束；在这种情况下恢复是否触发取决于播放器是否报错。
