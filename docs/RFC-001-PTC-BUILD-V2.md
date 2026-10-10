# RFC-001：PTC Build V2 — 高阶建筑与严格生存施工

- 状态：Draft / 待评审，**不是已实现功能**。
- 日期：2026-10-10。
- 分析基线：当前工作树；Minecraft 26.3 / Fabric；模组版本 `0.0.1-m5`。
- 范围：单机集成服务器、一个 Buddy、一项活动施工任务；外部 PTC 程序与模组协作。
- 产物：本文和 [76 格屋檐示例蓝图](../specs/proposals/roof-demo.build-v2.json)。示例不能交给当前 V1 runner 执行。
- 本次不修改 Java 实现，不启动施工，不改变游戏状态。
- 后续源码 / 后端路线分析见 [RFC-002：MCP + PTC 执行后端](RFC-002-MCP-PTC-BACKENDS.md)；本文的集成服单 Buddy 是初始实现范围，不是长期架构限制。

## 1. 摘要与设计决策

项目已经具备「真实 ServerPlayer + 原版数据包处理路径 + 本地桥 + 外部程序编排」。缺少的是可恢复的工程执行层，而不是另一个直接写方块工具。

V2 采用 **Blueprint → Plan → Job → Action → Observation → Verify** 架构：

1. 外部程序生成参数化建筑、模块和镜头，不把建筑美学生成器塞进模组。
2. 模组维护权威世界观察、玩家动作、材料账本和持久化施工任务。
3. 蓝图表达最终状态；规划器推导支撑、站位、路线、临时设施和物料需求。
4. 两种执行模式共享蓝图：`creative_rig` 和 `survival_strict`，不能静默互相降级。
5. 批量提交施工意图，但放置仍走玩家交互。`setBlock`、`/fill` 不作为施工后门。
6. 完成以实际世界的完整 BlockState 验收为准，不能以 RPC 成功数代替。

本文中的 MUST / SHOULD 分别表示实现必须满足 / 建议满足。所有新方法名均为拟议接口。

## 2. 当前项目实现原理：源码事实

### 2.1 端到端调用链

```text
外部 TypeScript / 其他 PTC 程序
  │ TCP 127.0.0.1:25731，逐行 JSON
  ▼
BridgeServer.acceptLoop / serve（连接线程）
  │ 校验可选 token；请求进入 ConcurrentLinkedQueue
  ▼
MinecraftServer.tickConnection TAIL mixin（服务端线程）
  ├─ BuddyAgent.tickAgentConnection
  └─ BridgeServer.tick，最多处理 4 个请求 / tick
       ▼
     BridgeHandlers.handle
       ├─ 世界感知
       ├─ BuddyAgent → EmbeddedChannel.writeInbound(Packet)
       │                 ▼
       │            原版 Connection / 游戏数据包处理器
       │                 ▼
       │            ServerPlayer / 世界状态变化
       └─ 相机 → 客户端 / 渲染线程
  ▼
JSON 响应 → 外部程序决定下一步
```

这里的 TCP JSON 桥不是 MCP 协议本身。MCP facade 可以包装它，但现有 TS 程序直接连接 TCP 即可完成 PTC；本次分析没有把未定位到的 MCP 服务端当成已实现组件。

### 2.2 Buddy 不是普通 NPC，也不是一台完整游戏客户端

[BuddyAgent.spawn](../src/main/java/dev/tsy3m/mcbuddy/BuddyAgent.java#L82) 创建 `ServerPlayer`、`Connection(PacketFlow.SERVERBOUND)` 和 Netty `EmbeddedChannel`，调用 `PlayerList.placeNewPlayer` 接入集成服务器，并立即设为创造模式。

它没有独立渲染窗口。模组负责 keepalive、传送确认和连接 tick，并排空发给 Buddy 的 outbound 消息。动作通过 `writeInbound` 喂入连接；这不是通过鼠标点击屏幕模拟玩家。

重要边界：**经过原版 handler，不等于已经实现完整客户端行为或公平的生存策略。** 调用方仍能构造点击面、位置包等信息；路径规划、交互前置检查和资源限制需要另行保证。

### 2.3 放置、拆除与移动

| 能力 | 当前实现 | 不能据此声称具备的能力 |
|---|---|---|
| 放置 | [placeAt](../src/main/java/dev/tsy3m/mcbuddy/BuddyAgent.java#L549) 找第一个非空气邻居，以相邻方块中心中点构造 hit，发 `ServerboundUseItemOnPacket` | 指定完整状态、最优点击面、可靠遮挡检查、复杂构件规划 |
| 结果 | 即时比较目标方块的 block ID，变化时记录 EditLog | 同 ID 状态变化、多方块副作用、邻居更新后的稳定终态 |
| 拆除 | [breakAt](../src/main/java/dev/tsy3m/mcbuddy/BuddyAgent.java#L611) 连续发 START / STOP destroy 包 | 根据工具和硬度跨 tick 持续采掘、掉落回收闭环 |
| 行走 | [WalkTask](../src/main/java/dev/tsy3m/mcbuddy/nav/WalkTask.java#L91) 逐 tick 生成移动声明，处理碰撞、跳跃、卡住和重规划 | 所有地形都可通行、门梯水体全支持、客户端物理完全等价 |
| 路径建议 | [PathAdvisor](../src/main/java/dev/tsy3m/mcbuddy/nav/PathAdvisor.java#L37) 使用未加入世界的 cow 实例作为原版寻路代理 | cow 的节点可通行性与玩家完全一致 |
| 站位 | [standFor](../src/main/java/dev/tsy3m/mcbuddy/BuddyAgent.java#L638) 环形搜索，垂直只尝试 ±3，空气净空、非树叶落脚、距离判断 | 到该站位的路线、完整玩家碰撞与视线证明 |

当前 `within_reach` 字段是诊断值；不能把它当作所有交互前置条件已满足的证明。

补充：原版 ServerPlayerGameMode 可在过早 STOP 后进入 delayedDestroy，随后 tick 才破坏方块；当前即时 `broken=false` 不必然是终态失败。缺口是持续任务、取消和最终确认，而不是断言 START / STOP 路径绝对挖不动，详见 RFC-002。

### 2.4 外部建筑与导演流程

[buildspec.ts](../scripts/ts/buildspec.ts) 描述基础、墙、柱、门窗洞和屋面层；[engine.ts](../scripts/ts/engine.ts) 展开为分材料的 cells。

[compound.ts](../scripts/ts/compound.ts#L30) 组合模块和附加盒体，以坐标为键去重，后写覆盖前写，再保留门洞。四合院程序按高度 / 材料排序，逐次 `give → place`，失败时寻找站位并传送，多轮修复后逐列验收。总计 13,556 个目标格，验收也是外部程序完成。

因此当前是「外部程序控制的逐块工程」，不是模组原生 Blueprint Job。四合院没有使用直接世界写入，但使用了创造材料与传送。

相机由 [CameraMixin](../src/main/java/dev/tsy3m/mcbuddy/mixin/CameraMixin.java#L20) 覆盖渲染姿态；FreeCam 保存独立 volatile 坐标字段。外部 [director-siheyuan.ts](../scripts/ts/director-siheyuan.ts#L19) 计算插值，以约 20 Hz 更新 `camera.set`，OBS 独立录制。当前没有原生逐帧轨道播放器。

### 2.5 需要先补的工程缺口

以下是静态源码发现的行为或风险，除四合院实测问题外，未做故障注入复现。

| 位置 | 当前问题 | V2 要求 |
|---|---|---|
| [BridgeServer](../src/main/java/dev/tsy3m/mcbuddy/bridge/BridgeServer.java#L114) | 等待 5 秒后返回错误，但没有移除 / 标记已排队请求；它可能以后才执行 | 超时区分未开始和结果未知；行动用 operation ID 查询，不盲重试 |
| 同上 | 限制请求数，不限制每个 handler 的耗时或队列总量 | 有界队列、工作量限额、tick 时间预算 |
| [ClientCamera](../src/main/java/dev/tsy3m/mcbuddy/ClientCamera.java#L45) | handler 内等待客户端 future，最多 4 秒；会占用服务端执行线程 | 截图异步化，不阻塞 server tick |
| [BuddyAgent.give](../src/main/java/dev/tsy3m/mcbuddy/BuddyAgent.java#L470) | 直接设置库存，没有 `devWrites` / 创造模式门控 | 统一策略守卫；不能只靠客户端不调用 |
| Buddy 生命周期 | spawn 默认创造、随机 UUID；还有 here / relocate 等位置操作 | 稳定 agent 身份；严格模式覆盖命令入口与所有作弊路径 |
| [WorldDigest.column](../src/main/java/dev/tsy3m/mcbuddy/bridge/WorldDigest.java#L167) | 固定主世界，最多 24 行，返回 description ID 而非状态 | 显式维度、分页 / 区域读取、命名空间 ID 与完整 properties |
| [EditLog.query](../src/main/java/dev/tsy3m/mcbuddy/bridge/EditLog.java#L41) | 内存 4096 条；截断时 cursor 返回最新 sequence，按它续读会跳过未返回项 | 持久化、可分页、cursor 只前进到已交付项 |
| [EventQueue.poll](../src/main/java/dev/tsy3m/mcbuddy/bridge/EventQueue.java#L20) | 内存 256 条；丢失提示不是相对于调用方 cursor 的精确 gap | epoch + oldest / latest / nextCursor + gap；支持权威状态重同步 |
| [TS Bridge](../scripts/ts/mcbuddy.ts#L49) | close 只清 socket；pending 等待超时，buffer 未在重连时重置；未附 bridge token | 立即 reject pending、隔离连接代次、支持 token |
| 同上 | rawCall 可重试任意方法，部分旧行动 helper 使用它 | 类型区分 read / mutation，重放只允许幂等操作 |

当前感知的 `getChunkNow` 不主动生成 / 加载区块，应保留这个边界；未知不能当空气。

## 3. 目标、非目标与模式边界

### 3.1 目标

- 可靠重建四合院级别的 100×100、万格以上工程，支持完整状态与断点恢复。
- 高阶构件可以使用楼梯、台阶、原木方向、多格门与有邻居依赖的连接形态。
- 生存施工能从现有库存 / 指定箱子获取材料，合法走到工作位置，搭建并回收临时设施。
- 出错可诊断、可暂停、可恢复；不把任务未完成包装成成功。
- 录屏可与施工事件关联，原生相机插值不依赖每帧 RPC。

### 3.2 非目标

- 首版不支持远程多人服务器、多个 Buddy 并行施工或跨维度旅行。
- 不开发建筑风格生成模型；外部 DSL、脚本或 LLM 负责设计。
- 不保证任意模组方块、任意 BlockState 都可通过合法交互构造。
- 不把世界、库存、多个箱子视作一个可原子回滚的数据库。
- 自动采集 / 合成 / 熔炼是后续里程碑，不是首个生存版本的隐藏前提。

### 3.3 两种执行模式

| 行为 | creative_rig | survival_strict |
|---|---|---|
| 逐块放置、合法点击与状态验收 | 必须 | 必须 |
| 材料注入、传送、切换模式 | `dev_writes=true` 且显式启用时可用，必须记账 | 禁止 |
| world.pad / materialize / 直接写世界 | 仅独立测试夹具，不能计入施工成功 | 禁止 |
| 移动 | 可以使用明确记录的 rig 传送 | 连续、碰撞合法、受速度 / 跳跃 / 落地约束的玩家移动 |
| 材料与工具 | 可注入，报告 must 标识非生存 | 实际库存、耐久、饥饿、掉落和补给 |
| 失败降级 | 不得冒充生存 | 不得自动切创造、传送或注入材料 |

严格模式是服务端策略，不是一个脚本布尔值。任务持有 Buddy 行动 lease；桥、命令和内部帮助函数统一检查。任务活动中请求切模式 / here / relocate / fixture 必须拒绝并记录。结束后 lease 释放，但策略变更仍需显式操作。

这里的 strict 约束物品来源、移动和世界交互，不等于模拟人类视野：已加载区域的权威状态查询与导演相机仍可用于规划 / 验收。首版不实现视野战争迷雾；报告必须说明这一感知边界，不能宣称与纯手动玩家的信息条件相同。

稳定身份至少绑定 worldId + agentId；加载 Buddy 的已有库存，不能用新 UUID 重新 spawn 绕过资源账本。重启后不自动创造出生 / 恢复施工，先恢复身份与策略，再进入 RECOVERING。

## 4. 目标架构与线程边界

```text
External PTC
  BlueprintCompiler / Style generators / Director / OBS adapter
       │ 版本化 TCP JSON API
       ▼
BridgeGateway（协议、token、配额、operation ID）
       ▼
BuildJobService（持久化、状态机、行动 lease）
       ├─ WorldObserver（已加载区域、状态、分页）
       ├─ MaterialPlanner（block → action → item ledger）
       ├─ PlacementPlanner（依赖、站位、点击、脚手架）
       ├─ Movement / Mining / Inventory task executors
       └─ Verifier / JobJournal
                 │ 服务端 tick 内小步执行
                 ▼
           原版玩家交互路径

Client render thread
  CameraTrackPlayer → 单个不可变 Pose 快照 → CameraMixin
  Screenshot async completion → Bridge response / operation status
```

- 网络线程 MUST 不读写世界 / 玩家对象，只解析、限流和提交请求。
- 世界读取、动作确认与玩家交互 MUST 在服务端线程完成。
- 编译纯几何可以在外部或后台完成；注册表 / 世界访问需权威线程校验。
- 重型规划分片执行；首版不允许在 tick 内展开十万格、全场寻路或 fsync 等阻塞 I/O。
- 持久化由 I/O executor 完成；必须收到 durable ack 后才能执行相应动作。
- 初始预算：全桥最多 4 次请求 dispatch / tick；工程额外预算目标 2 ms / tick、最多一个新的世界交互动作 / Buddy / tick。均可配置，必须以实测确认，不承诺固定完工速度。
- 队列默认上限 256；满时立即 `BUSY`，不无限堆积。
- 相机姿态用不可变对象原子交换，避免同时看到新 x、旧 z 的混合帧。

## 5. Blueprint V2：最终结果，不是命令列表

### 5.1 数据模型

| 字段 | 类型 / 语义 |
|---|---|
| `schemaVersion` | 固定整数 2，与桥 protocolVersion 独立 |
| `name` | 蓝图标识；不是 job ID |
| `bounds.min/max` | 相对坐标整数三元组，闭区间，必须覆盖所有目标和 clearance |
| `palette` | 名称 → `{block: namespaced ID, properties: string map}` |
| `elements` | 有唯一 id 的 `box` 或 `cell`，引用 palette 和 phase |
| `phases` | 有唯一 id，`after` 为其他 phase ID；必须无环 |
| `constraints` | `clearance`：指定应为空气的空间，不是删除指令 |

坐标使用 Minecraft 轴向：+X 东、+Y 上、+Z 南。`origin` 是相对 `[0,0,0]` 对应的世界方块坐标，**不是 groundTopY**。地基高度由调用方勘察后明确选择；编译器不能猜。

元素形态：

```json
{"id":"floor","kind":"box","from":[0,0,0],"to":[6,0,6],"palette":"stone","phase":"foundation"}
```

`box` 是几何压缩表达，展开为单元格，绝不是调用 `/fill`。`cell` 使用 `at` 三元组。V2 首版不含 include 路径和任意代码；模块、曲线、旋转与镜像在外部编译后提交。旋转 / 镜像必须同时变换 BlockState，不仅变换坐标。

### 5.2 编译与注册表校验

1. 坐标必须有限整数，from ≤ to，不能越界 / 超世界高度。
2. 默认最多 100,000 个唯一目标格、100,000 个 clearance 格；上传展开总量也受上限约束，不能用重叠盒体规避。
3. 相同坐标 + 相同规范化状态可合并；不同状态重叠返回 `BLUEPRINT_CONFLICT`。不继承当前 compound 的隐式 last-write-wins。
4. 状态与 clearance 重叠必须拒绝；phase / palette 悬空引用必须拒绝。
5. 使用注册表 block ID，不能使用翻译键或 contains 模糊匹配。
6. 未知方块 / 属性 / 属性值拒绝。省略 properties 由该版本注册表默认值展开，报告返回完整规范化状态。
7. 状态构造与合法放置可达性分开：合法注册表状态也可能无法由已支持的玩家动作生成，返回 `UNSUPPORTED_STATE`。
8. hash 对规范化目标、约束和 phase DAG 计算；不依赖元素输入顺序。允许 cell 合并时，保留全部来源和 phase 前置依赖。

示例 [roof-demo.build-v2.json](../specs/proposals/roof-demo.build-v2.json) 展开为 76 个唯一目标格：49 地坪 + 12 柱 + 5 梁 + 5 楼梯 + 5 台阶，以及 2 格入口净空。它故意有高处悬挑，检验临时支撑与状态定向，**并非当前模组已支持的演示**。

## 6. API 合约（拟议）

### 6.1 协议与错误

保留 NDJSON 请求 `{id, method, params, token?}` 和 `{id, result}` / `{id, error}` 响应外壳。`id` 只用于本连接响应配对，不用于幂等。

错误统一为 `{code, message, retryable, details}`。缺材料、不可达等可恢复施工问题是 job 状态，不应只抛一条 RPC error 后失去进度。

新增 `bridge.capabilities` 返回 protocolVersion、methods、mode 支持、限制、世界 / agent 身份和 serverEpoch。不通过“调用看看会不会报错”猜能力。

纯 transport capabilities 可在未进入世界时回答，worldId / agentId 返回 null；需要读取游戏状态的部分异步请求到游戏线程，不能由网络线程直接访问 Minecraft 对象。serverEpoch 是服务端会话代次，不是持久化 worldId。

所有会改变任务 / 玩家 / 世界的 V2 方法 MUST 带 `operationId`。相同身份域内，同 ID 同规范化参数返回同一操作结果；同 ID 不同参数返回 `IDEMPOTENCY_CONFLICT`。身份域为 worldId + agentId，记录与任务一起持久化；live job 的记录不能过期。客户端只可在确认 serverEpoch / worldId 后续接。

### 6.2 核心方法

| 方法 | 输入重点 | 返回 / 行为 |
|---|---|---|
| `blueprint.validate` | blueprint | schema / registry / DAG 报告、hash、目标格统计；不改世界 |
| `build.plan` | blueprint、dimension、origin、mode、policy、resources | 异步 planId；生成材料预算、冲突、行动能力缺口与临时设施方案 |
| `build.plan_status` | planId | PLANNING / READY / BLOCKED / FAILED，planHash、worldId、registryFingerprint、报告 |
| `build.submit` | planId、planHash、operationId、onDisconnect | durable 接受后返回 jobId，不在请求内执行整栋建筑 |
| `build.status` | jobId | state、revision、进度、waiting reason、当前 action、材料账本和报告位置 |
| `build.pause` / `resume` | jobId、expectedRevision、operationId | 并发控制；恢复时重新验证相关世界状态 |
| `build.cancel` | 同上，cleanup=`leave` 或 `temporary_only` | 到安全动作边界停止；默认不拆已建主体 |
| `build.verify` | jobId、operationId | 异步完整验收，不自动施工 / 修复 |
| `operation.status` | operationId | ACCEPTED / RUNNING / COMMITTED / EXPIRED / RECONCILE_REQUIRED / FAILED |
| `world.region` | dimension、闭区间 bounds、pageToken? | palette + RLE 状态、loadedMask、观察 tick 区间、nextPageToken |
| `agent.inventory` | agentId | slots、item / components、count、durability、revision；不只 hotbar 字符串 |
| `container.inspect` | dimension、at | 实际打开后返回菜单 sessionId、slots、revision；不可达返回原因，不远程取物 |
| `container.transfer` | sessionId、expectedRevision、from/to slot、count、operationId | 使用真实菜单动作；回执包含实际移动数量和新 revision，冲突重新观察 |
| `agent.mine` | dimension、at、toolPolicy、operationId | 跨 tick 采掘任务；观察破坏 / 工具 / 掉落，不保证掉落已收回 |
| `placement.plan` | expected target states、policy | 合法站位 / 点击方案 / 缺失依赖，或明确不可达原因；不移动 |
| `agent.place_state` | targets、placementPlanId、operationId | 单动作异步回执；执行后验证全部目标，不直接写期望状态 |
| `job.events` / `job.edits` | jobId、cursor、limit | 分页、gap 检测、返回末条 nextCursor；不跳过未返回项 |

`build.plan` / `build.submit` 在 server 端不支持资源 policy 或状态 adapter 时必须明确拒绝，不能接受后偷偷忽略。plan READY 不是世界锁；submit 和每次行动必须重新检查冲突。

planHash MUST 覆盖 blueprintHash、origin / dimension、mode / policy、resources 和 registryFingerprint。路线 / 材料 availability 属于可失效观察，不因 planHash 未变就免于重验。用户改变任何施工配置需重新 plan，不能复用旧 hash 偷换执行策略。

进度分别计数 target cells 与 actions：`targets.total/matched/missing/wrong/unknown`；`actions.committed/pending`；`temporary.outstanding`。多格门不能令完成分子超过格数；已有匹配格不冒充本任务放置次数。`revision` 每次可观察状态变更递增，控制命令 expectedRevision 不匹配返回 `REVISION_CONFLICT`。

### 6.3 规划请求示例

以下坐标仅是合约示例，不是当前世界中已勘察的工地 / 箱子。

```json
{
  "id": 12,
  "method": "build.plan",
  "params": {
    "blueprint": "<inline Blueprint V2 object>",
    "dimension": "minecraft:overworld",
    "origin": [256, -60, 256],
    "mode": "survival_strict",
    "policy": {
      "replace": "air_only",
      "onUnknownChunk": "wait",
      "temporary": {
        "enabled": true,
        "material": "minecraft:cobblestone",
        "maxConcurrentBlocks": 128,
        "allowedBounds": {"min": [-2, 0, -2], "max": [8, 6, 8]}
      }
    },
    "resources": {
      "sources": [{"kind": "agent_inventory"}, {"kind": "container", "at": [254, -59, 254]}],
      "acquisition": "existing_only"
    }
  }
}
```

实际线协议 `blueprint` MUST 是内联对象，上例字符串仅省略较长数据。资源 source 必须位于请求 dimension；不支持跨维度远程取物。

plan 报告 MUST 区分 `alreadyMatching`、`missing`、`conflicts`、`unknown`、`unconstructible`、`finalItems`、`temporaryPeakItems`、`toolRequirements`。物料按 action 的实际消耗统计，不能简单把每个 target cell 算作一个物品。

## 7. 放置与施工规划

### 7.1 单动作状态机

```text
OBSERVE → CHECK_POLICY → ACQUIRE_ITEM → NAVIGATE → AIM → INTERACT
                                                    │
                    OBSERVE_AFTER / SETTLE ←─────────┘
                          ├─ MATCH → COMMIT
                          ├─ CHANGED_UNEXPECTEDLY → CONFLICT
                          └─ NO_CHANGE → 有限重规划 / WAIT / FAILED
```

MUST 检查：目标 precondition、支撑形状、玩家全包围盒、原版交互距离、射线命中面、占用碰撞、正确 held item、使用动作是否会打开箱子而非放块，以及有无 pending teleport / 冲突移动任务。

楼梯 / 台阶 / 原木由 yaw、pitch、点击面、hit vector 与必要的 sneak 等操作构造。期望状态不能在放置后用 `setBlock` 修正。

门、床等一个物品改变多个格的操作 MUST 为 action group：全部格先检查，动作后全部读回，账本只记录实际物品消耗。动态邻居形态在局部更新后复核；shape、连接与 waterlogged 不是仅凭初次放置回执就可验收。

SETTLE 首版要求相关格连续 2 个服务端 tick 的完整状态匹配；超过配置窗口未稳定进入诊断。最终 verify 仍需再次扫描；这不是保证之后永远不变化。

### 7.2 顺序与临时设施

用户 phase DAG 只是设计前置关系，规划器还需推导实际放置支撑、工作面、路线和退路依赖。不能仅按 Y / 材料排序。

- 先比较实际世界；已有完全匹配格不重复放置 / 消耗。
- 缺支撑时规划合法临时方块，而不是传送到空中或无限重试。
- 临时设施必须在显式 allowedBounds 内，且不覆盖已有实体方块 / clearance / 最终目标。
- 每次增加设施后重新评估路线，避免把 Buddy 封在房内、填死门洞或先拆回程路。
- 规划器达不到目标时返回 `NO_ROUTE` / `NO_SUPPORT` / `UNSUPPORTED_STATE`，保留依赖解释。
- 临时方块清理采用逆依赖顺序，只拆 job 所有且当前状态仍匹配的块。
- 临时区有未加载区块时同样等待，不得把 unknown 当作落脚点。

## 8. 生存资源与交互闭环

首个生存版本只支持 `existing_only`：Buddy 库存与指定可到达箱子。没有采集能力时明确报缺料，而不是注入。

1. 箱子通过实际到达、打开、菜单 slot 交互取放物品；校验菜单 / 容器 revision，不直接 setItem 改库存。
2. 计划预算区分最终消耗、临时设施峰值、已匹配格、工具 / 耐久和补给批次；门 / 双台阶等按动作与物品映射核算。
3. 物料 transfer / placement 前后观察库存变化，记录实际消耗与来源。箱子里的预算不是锁，玩家取走后要重算。
4. 材料耗尽 → WAITING(MATERIAL_MISSING)，提供缺口；补足后可恢复。
5. 采掘必须跨 tick 驱动、正确使用工具并处理硬度 / 掉落；不能把立即 START / STOP 当作通用生存挖掘。
6. 清脚手架后确认破坏与掉落；物品因熔岩、掉落位置或他人拾取而未收回时报告损失，不能凭空退款。
7. 低血量、低饥饿、工具即将损坏、跌落风险达到配置阈值时进入 WAITING；没有应对能力不能继续冒险。
8. Buddy 死亡进入 WAITING(AGENT_DEAD)，保存待确认动作和资源差额；不自动重生并补全库存。

后续 `gather_and_craft` 必须另行声明支持的采集、配方、燃料和工作站能力。制作按配方输出 / 容器残留核算；熔炼是耗时任务，不是即时转换。

## 9. Job 状态机、幂等与恢复

### 9.1 状态

```text
ACCEPTED → PREFLIGHT → RUNNING → CLEANING → VERIFYING → COMPLETED
                         │          │          │
                         ├──────────┴──────────┴→ WAITING(reason)
                         ├→ PAUSING → PAUSED
                         ├→ CANCELLING → CANCELLED
                         └→ FAILED

重启 / 重新入世界：非终态 → RECOVERING → PAUSED 或 WAITING
显式 resume：重新检查 → RUNNING / CLEANING / VERIFYING
```

WAITING 原因包括 `MATERIAL_MISSING`、`CHUNK_UNLOADED`、`NO_ROUTE`、`CONFLICT`、`AGENT_DEAD`、`WORLD_PAUSED`、`RECONCILE_REQUIRED`。这些是工程状态，不能冒用 goal 工具的状态。

pause / cancel 必须到安全动作边界停止；持续挖掘需要停止 / abort 动作，不能把未完成挖掘留在后台。cancel 返回终态前完成必要的动作收尾；`temporary_only` 可进入清理阶段，主体保留。

断开控制端默认 `onDisconnect=pause`，心跳 lease 超时进入 PAUSING；可明确配置 continue。camera 使用独立 lease，失联恢复玩家相机。job / camera / OBS 互不冒充对方已清理完毕。

### 9.2 持久化与行动结果不确定性

世界存档内建议布局：

```text
mcbuddy/
  identity.json
  jobs/<jobId>/blueprint.json
               plan.json
               checkpoint.json
               journal.ndjson
               verify.json
```

checkpoint 通过临时文件 + 原子替换；journal 保持递增 sequence，损坏尾记录可识别。每个世界动作有 actionId、operationId、预期 before / after states、物品预期和 phase。

执行顺序：**durable PREPARED → 玩家交互 → 世界 / 库存观察 → durable OBSERVED / COMMITTED**。写盘由后台线程完成，server tick 等待 future 就绪而不阻塞。

不能承诺世界和账本跨崩溃的 exactly-once 事务：

- 有 PREPARED 无 COMMITTED：恢复时先观察，不盲目重放。
- 世界和库存可一致证明动作已发生时，补记恢复结果。
- 库存已消耗但世界未保存、或结果可能来自玩家手工修改时，进入 RECONCILE_REQUIRED；不自动复制 / 退款。
- 世界已经匹配可以满足目标，但没有证据不能把它标为本 job 所有，更不能在撤销时拆它。
- 与另一个世界、错误维度、不同 registryFingerprint 或不同蓝图 hash 不匹配时拒绝续建。
- operationId 的幂等提交可以可靠实现；玩家交互副作用的崩溃恢复必须遵守上述不确定性边界。

### 9.3 Deadline 与旧请求

V2 mutation 在入队时登记 operationId。到期且尚未开始必须标 EXPIRED，后续 tick 不再执行；已开始但回执丢失返回 / 查询结果未知，不能假报“没有执行”。所有客户端超时提示应给出 operationId 查询路径。

客户端重连必须清 buffer、立即失败旧 pending，并查询 durable operation / job；不能把旧连接的响应与新连接 id 混配。

## 10. 世界观察、日志与完成条件

- world.region 显式 dimension；使用已加载区块，无静默 force-load。
- region 大查询跨 tick 分页，返回观察开始 / 结束 tick 与 page session。**不是全区域同一时刻的原子快照**；行动前重新核验相关小区域。
- palette 必须为完整规范化 BlockState，RLE 包含明确坐标遍历顺序：X 最快、Z 次之、Y 最慢。
- loadedMask 单独表达 unknown 区域，不能用 air 的 palette index 冒充。
- job.events / edits 使用持久化序列，分页 nextCursor 为最后交付记录。落后于保留窗口返回 gap=true、oldestCursor，客户端通过 status 重同步；不能静默漏事件。
- 记录 before / after 完整状态、job / action / operation、tick、agent / dimension、来源、库存 delta 和临时标记。
- 自然更新副作用需要记录范围 / 未归因提示；不能声称一个目标格 EditLog 就代表整次交互的全部影响。

COMPLETED MUST 同时满足：

1. 全部目标完整状态匹配；未知、缺失、错误状态都为 0。
2. clearance 全部为空气；植物等是否可通行另有约束，不能直接算作空气。
3. 需要回收的临时块全部清理；资源损失如实列出，不要求不现实的 100% 掉落回收。
4. 没有未决行动 / policy violation；严格模式中没有作弊操作成功。
5. 报告包含 blueprint / plan hash、worldId、registryFingerprint、mode、agent 身份、时间范围、材料实际流量和完整验收扫描范围。

取消不等于 undo。后续补偿式 undo 只可拆 job 可证明所有且仍匹配的块；生存中真实消耗工具 / 时间并回收掉落。无事务式“魔法还原”。

## 11. 导演与录屏（独立 P2 模块）

新增拟议 `camera.track.submit/play/pause/stop/status`；轨道包含时间、position、lookAt 或 rotation、easing、marker。

- 客户端渲染帧内计算位置 / 姿态，角度最短弧或四元数插值；支持线性、样条、环绕。
- 显式 clock=`simulation` 或 `monotonic`。录屏默认 monotonic；暂停、低帧率、失联处理必须可配置并记录。
- 镜头变化不移动 Buddy / 人类玩家，不充当严格生存的区块强制加载工具。区块不可见时等待 / 警告，不拍黑屏后假报成功。
- 截图异步回读，客户端 / 服务端都不等待长耗时写盘。
- 轨道 marker 与 job event 使用关联 id；OBS 适配器保持在外部程序，模组不保存 OBS 密码。
- 只停止本流程启动的录制，不能截断用户已有录制；记录 OBS 实际 start / stop 时间与路径，不能仅凭请求发送宣称录制成功。
- 自动清理相机 lease，记录 cleanup 失败；录像完整解码和抽帧 QA 属于外部素材验收。

## 12. 里程碑与验收矩阵

| 里程碑 | 实施范围 | 验收门槛 |
|---|---|---|
| P0-A | capability / error / deadline / queue / 客户端重连；统一策略守卫 | 超时排队请求不晚执行；行动重放可查询；严格策略所有入口拒绝作弊 |
| P0-B | V2 编译、完整状态观察、state placement adapter、异步 job / journal / verify | 小型屋檐样例可构造；万格四合院无静默覆盖、断线不丢任务；支持明确的 rig 模式 |
| P1-A | 玩家匹配的站位 / 路线、临时设施、持续采掘、existing_only 补给 | 无 give / teleport 的小型高处建筑，缺料等待，补给后继续，临时设施清理 |
| P1-B | 完整库存与容器对账、存档恢复、资源安全 / 死亡处理 | world / inventory 崩溃边界不复制物品，不假报消耗；有歧义进入 reconciliation |
| P2-A | 有限采集、合成 / 熔炼能力 | 材料获取与工作站可执行，资源 / 配方账本正确，不支持项明确报告 |
| P2-B | 原生轨道、异步截图、录制 markers | 低 RPC 频率下相机仍逐帧平滑；OBS 与相机清理不影响用户其他录制 |

首次 P0-B 的高处例子可使用显式 creative rig 站位；不能因此宣称 P1 生存脚手架已完成。小例子与万格回归分别检验状态能力和规模可靠性。

### 12.1 必须覆盖的验证场景

| ID | 场景 | 必须观察到的结果 |
|---|---|---|
| T01 | 给 roof-demo 改错一个 stairs facing，但 ID 相同 | verify 报 wrongState，不计入 ok |
| T02 | 下半 / 上半台阶、原木三轴、门上下两格、楼梯转角 | 精确状态 + 多格动作 / 物品计数正确；不支持者拒绝，不伪造 |
| T03 | job 运行时调用 give / here / relocate / claim / gamemode / materialize | 严格模式拒绝；库存和位置无作弊变化；命令与桥同样受限 |
| T04 | 请求入队后暂停超过 deadline | 未开始操作 EXPIRED，恢复 tick 不执行 |
| T05 | 同 operationId 重复 submit；同 ID 不同 body | 同 jobId；冲突 body 拒绝 |
| T06 | PREPARED 前后、交互后、COMMITTED 前分别终止进程 | 恢复先观察，无盲重放 / 复制物品；歧义可见 |
| T07 | 区块卸载，region 跨多页，事件超过内存窗口 | unknown ≠ air；不 force-load；cursor / gap 正确 |
| T08 | 玩家修改目标 / 拿走箱中材料 / 移除脚手架 | 不覆盖他人；更新冲突或缺料报告；重规划路线 |
| T09 | 物料少 1、工具损坏、Buddy 死亡 | WAITING 带明确差额；补给 / 恢复后只做剩余动作 |
| T10 | 路线含楼梯 / 台阶 / 窄口 / 无落脚处 | 玩家碰撞校验；不可达明确，不靠 cow path 判成功 |
| T11 | 高处屋檐施工、清理最后一条退路 | 临时设施依赖可执行，不能困住或摔落 Buddy |
| T12 | 截图耗时 4 秒、万格区域验证 | 不阻塞 server tick；任务可暂停、状态查询可响应 |
| T13 | 万格四合院旧蓝图迁移 | 13,556 目标 + 门洞断言，完整验收；进度分母唯一格数正确 |
| T14 | 外部 OBS 已录制；camera 控制断开 | 不停止他人录制；相机 lease 超时释放；清理状态可见 |

性能目标：在同一固定世界 / 硬件上，工程模块自身 server-tick 耗时 p95 ≤ 2 ms，无单次已知阻塞 I/O；记录 p99、规划和验收耗时。不得把目标写成未经测量的实现事实，也不以录像帧率代替 tick 指标。

## 13. 迁移与代码落点

- V1 `agent.place` / `world.column` 保留现有字段，避免破坏旧脚本；新增结构化状态能力通过 capabilities 声明。
- 所有旧动作同样接入统一策略守卫。give 增加门控属于明确的兼容性变更，发布说明需写明；已有四合院流程已要求 dev_writes=true。
- V1 BuildSpec / compound 在外部转换为 V2。现有已知重叠必须显式决议后输出唯一 targets；不能把旧 last-write-wins 直接带进 V2。
- 保留 groundTopY + 1 的旧坐标转换，但提交 V2 时输出明确 origin，避免 +1 地基偏差。
- 验收旧 progress.json 不能直接变成 COMMITTED journal；只能通过当前世界扫描导入 alreadyMatching，无自动所有权。
- `BridgeHandlers` 拆分 transport / observation / action / build / camera handlers；`BuddyAgent` 保留生命周期和 packet endpoint，不继续堆施工逻辑。
- 建议新包 `build/`：Blueprint、BuildPlan、BuildJob、JobJournal、PlacementPlanner、StatePlacementAdapter、MaterialLedger、BuildVerifier、ActionPolicy。
- `nav/` 保留现有规划作为候选路线来源，但执行前用玩家碰撞验证；长期替换 cow evaluator。
- Java 26.3 注入点必须用本地 vanilla 源码 / 方法描述符确认。本文不猜未来版本 Fabric API，也不要求为本 RFC 添加 mixin。
- 先恢复可构建基线和关键故障验证，再动连接 tick / 玩家路径；当前源码有 jar 反编译恢复历史，不能只依赖旧 HANDOFF 描述。

## 14. 首版评审结论与暂定选择

本 Draft 的默认选择已经明确，可据此拆实现任务：

- 对接范围：仅集成服务器、单 Buddy / 单施工 lease。
- 首版蓝图：cell / box + palette + phase DAG + clearance，不支持导入外部路径。
- 生存第一步：existing_only，不承诺自动采集；默认缺料等待。
- 冲突策略：air_only；同完整状态跳过；任何未知先等待。
- 失联默认暂停；重启默认恢复到 PAUSED / WAITING，不自动开工。
- 相机 / OBS 独立 P2，不能成为工程正确性的依赖。

仍需在实现前实测确认：支持的 BlockState adapter 清单、持久化吞吐预算、玩家运动一致性和邻居状态稳定窗口。未通过对应验收的能力 MUST 不在 capabilities 中宣告支持。

**北极星验收：同一份蓝图，在 creative_rig 中可快速调试，在 survival_strict 中可用真实资源和合法移动完成；两者的区别可在日志和验收报告中证明，而不是靠口头宣称。**
