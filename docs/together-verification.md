# Together 公共服务验证 · 0.2.0

## 结果与边界

2026-11-11 使用两个独立客户端连接原版列出的公共服务 `wss://metroserverx.meowery.eu/ws`，实际完成房间创建、申请加入、主持人批准、当前曲/待播队列同步、播放/暂停/seek、队列移除、点歌批准、主持人移交及退出。服务未要求 Google 账号。

测试运行 `src/together.ts` 的实际协议与业务实现。网络使用真实 WebSocket，播放器替身记录命令、曲目、队列、播放状态与位置，因此结果证明服务交互和状态同步可工作，**不证明两台实体设备的音频同步精度或实际出声**。

测试结束后，访客已显式离房，两个 WebSocket 连接均已关闭。没有使用客户端随机生成的房间号冒充服务响应，没有向其他用户的房间发请求。

## 源码依据

| 来源 | 核对内容 |
| --- | --- |
| [Metrolist `e6fea3b`](https://github.com/MetrolistGroup/Metrolist/tree/e6fea3b36c68841bad21daa6252e1d69ecd3afbe) 的 `app/src/main/proto/listentogether.proto` | Envelope、TrackInfo、RoomState、加入/播放/队列/时钟字段编号和类型 |
| 同提交的 `listentogether/ListenTogetherClient.kt`、`Protocol.kt`、`MessageCodec.kt` | 消息名称、命令与服务响应、gzip、会话、成员和审批流程 |
| 同提交的 `ListenTogetherManager.kt`、`ServerClock.kt` | 待播队列定义、毫秒时间线、服务器时钟及避免回传远端状态 |
| [Metroserver `1598616`](https://github.com/MetrolistGroup/metroserver/tree/159861612e8b8a42cc1bc7c0cc0b46395720d46f) 的 `internal/server/playback.go`、`rooms.go`、`server.go` | 主持人权限、queue_add、点歌审批、buffer_ready、加入/退出与能力协商 |

移植的默认公共服务地址来自原版 `ListenTogetherServers.kt` 的 The Meowery 条目。自定义服务仍须实现兼容协议。

## 测试方法

运行环境是 Node.js 24，启用环境代理。测试驱动直接读取 `src/together.ts`，通过 Node 的 TypeScript 类型剥离执行同一业务代码；把 NSH signal/storage/播放器模块替换为测试实现，把 NSH WebSocket 接口连接到 Node 的真实 WebSocket。两个模块实例持有各自的 connection、room、userId、播放器队列和播放状态。

对比项目包括当前曲目 ID、待播列表顺序、主持人与访客角色、播放开关、seek 后的位置、成员数量和服务端错误。测试用曲目标识为真实目录中的 `G2PDJTkFiA8` 与 `4n94ukt15qg`，但播放器没有拉取歌曲音频。

## 实际场景

| 场景 | 输入与观察 | 结果 |
| --- | --- | --- |
| 编解码 | ping 的毫秒时间戳、sequence 经生产 Envelope/varint 编解码 | 通过 |
| 创建和审批 | 主持人 create_room；使用服务返回的 roomCode 加入；主持人收到 join_request 后 approve_join | 双方收到实际房间/成员状态，通过 |
| 当前曲及待播 | 主持人设当前曲与一首待播；访客在批准后收到 state | ID 与顺序一致，没有把当前曲再加到待播中，通过 |
| 播放/跳转/暂停 | 主持人开始播放、seek 到 42 秒、暂停 | 访客播放开关和位置按服务消息更新，通过 |
| 队列移除 | 主持人移除唯一待播曲 | 访客仍保留当前曲，待播列表变空，通过 |
| 点歌批准 | 访客提交刚移除的曲目；主持人批准 | 服务 queue_add 同时更新主持人和访客的下一首，通过 |
| 主持人移交 | 主持人移交给访客，再由新主持人移回 | 双方 host/guest 角色随 host_changed 更新，通过 |
| 离房 | 访客 leave_room | 主持人的成员数回到 1，访客本地房间状态清空，通过 |

首轮协议往返延迟样本约 148 ms，第二轮约 130 ms。这些是当次 ping/pong 的网络往返样本，不是声音延迟或同步误差，也不是公共服务的长期可用性指标。

## 与播放器的接线

`src/playback.ts` 提供 `applyRemoteState`、`syncingRemote` 和 `remoteControlled`。Together 把服务端的 `currentTrack + upcomingQueue` 转成客户端队列，转换毫秒为秒，并按服务器时钟推进正在播放的位置。房主广播真实本地变化，访客不把远端更新重新发布成房主命令。

主持人的自然切歌产生新的 change_track；访客 `remoteControlled=true` 时，自然结束只暂停等待服务消息，不自己续播电台。离房、断开或成为主持人时解除这个状态。新的暂停/曲目变化会使播放器丢弃尚未完成的旧媒体加载。

本版不会在仅替换了暂停队列时假发 `buffer_ready`。它等待 AudioPlayer 进入播放状态且不再缓冲后报告 ready，再接受服务端的位置校正。当前公共服务会对 ready 的访客返回 seek 和 play/pause 状态。

已实现 gzip 接收与能力协商；本客户端协商关闭服务端压缩。该次公共服务测试验证了实际协商与业务消息，不单独宣称 gzip 分支经过远端压缩流覆盖。

## 设备复验步骤

1. 在两个独立设备或浏览器配置中打开应用，为两端设置不同昵称。
2. 第一端连接默认服务并创建房间；第二端填写返回的房间号申请加入，第一端批准。
3. 第一端播放一首可正常出声的歌曲；比较两端曲目、暂停状态、歌词高亮和播放进度，再操作 seek。
4. 添加/移除待播曲目，测试访客点歌与主持人批准，然后移交主持人。
5. 在两台设备分别测试网络短暂中断后的手动重连，并确认离房后恢复独立播放。
6. 实际聆听两端输出后再记录音频同步误差；本次没有执行这一项。

构建和协议测试通过不能替代上述设备验证；原生移动后台服务也不在这份协议记录的完成范围内。
