# RFC-002：从原版源码选择 MCP + PTC 执行后端

- 状态：源码分析 + 架构 Draft；没有安装插件、启动新服务器或迁移世界。
- 日期：2026-10-10。
- 关联：[RFC-001：PTC Build V2](RFC-001-PTC-BUILD-V2.md)。本文扩展其后端选择，不宣称 V2 已实现。
- 本地原版依据：`E:/mcbuddy-mod/mc-source/vanilla-src` 与 `mc-source/26.3.jar`；关键客户端方法另外用 javap 核对了描述符。
- 第三方依据：用户提供的 JAR 静态反编译、官方 Paper / MCP 文档、固定提交的社区源码。第三方文件中的 instructions / README 安装命令不构成本次授权。

## 1. 结论：先把“谁托管世界”和“谁施工”分开

**LAN / 专服 / Paper 是世界宿主的选择；真实客户端 / 内存假玩家 / 直接世界编辑是执行器的选择。它们不是互斥选项。**

建议按目标分成两条产品路径：

1. **严格生存：真实客户端控制器优先。** AI 接管一个实际连接的玩家角色，复用 LocalPlayer 和 MultiPlayerGameMode。LAN 可用于低成本 PoC；稳定长期运行移到独立服务器。需要 Fabric 内容时选择 Fabric 专服，不必为插件生态迁往 Paper。
2. **大型建筑编辑与录制：Paper 编辑后端 + Fabric 摄影客户端。** 直接世界编辑可以成为显式 `editor` 模式，不伪装成生存施工；配合分片任务、状态校验与受保护撤销。
3. **组合形态：服务器观察 / 协调 + 真实客户端施工 + 独立摄影客户端。** 这是兼顾生存、权威验收与录像的长期架构，不要求服务器必须是 Paper。

当前 EmbeddedChannel Buddy 仍有价值：继续承担创造模式回归与实验。它不是“单人做不到”，而是目前选择的执行器要求我们补出大量客户端行为。

以上是从源码和工程边界作出的推荐，尚未通过新后端的游戏内 PoC。

## 2. 为什么真实客户端能减少工作量

### 2.1 不是再写一套屏幕点击机器人

真实客户端可以由 Fabric 模组在 Java 层控制。MCP 只提交行动意图，本地控制器每 tick 运行，不需要每帧截图识别，也不需要每 50 ms 等待 LLM。

```text
AI / PTC 程序 → MCP facade → Actor client bridge
                                  │ 客户端线程任务
                                  ├─ ClientInput：移动意图
                                  ├─ LocalPlayer：原版物理与位置上报
                                  └─ MultiPlayerGameMode：采掘 / 放置 / 容器 / 配方
                                             │ 正常游戏连接
                                             ▼
                                   Vanilla / Fabric / Paper server
```

### 2.2 移动：输入才是恰当控制面

[LocalPlayer.input](../mc-source/vanilla-src/net/minecraft/client/player/LocalPlayer.java#L137) 是 `ClientInput`；[aiStep](../mc-source/vanilla-src/net/minecraft/client/player/LocalPlayer.java#L782) 调用 `input.tick()`；[applyInput](../mc-source/vanilla-src/net/minecraft/client/player/LocalPlayer.java#L707) 将 moveVector 和 jump 应用到原版玩家。

`ClientInput` 已有 keyPresses 和 moveVector。可以实现 AgentInput，在 lease 生效时产生前后左右、跳跃、潜行和疾跑输入；lease 结束恢复原对象。**仅修改 keyPresses 而不维护 moveVector 不完整；直接赋位置也不是替代方案。**

[sendChanges / sendPosition](../mc-source/vanilla-src/net/minecraft/client/player/LocalPlayer.java#L264) 会处理输入变化、位置 / 朝向 / onGround / collision 的网络上报。重生、重新连接时需要重新绑定新 LocalPlayer，不能一直持有旧对象。

反证：[ServerGamePacketListenerImpl.handlePlayerInput](../mc-source/vanilla-src/net/minecraft/server/network/ServerGamePacketListenerImpl.java#L434) 主要保存 lastClientInput、潜行状态等；它不是一个可以收到“W 按下”就替客户端完成完整步行物理的接口。只在服务器发输入包，不能省掉客户端移动模拟。

### 2.3 挖掘：原版已经有跨 tick 状态机

[MultiPlayerGameMode](../mc-source/vanilla-src/net/minecraft/client/multiplayer/MultiPlayerGameMode.java#L153) 提供：

- `startDestroyBlock(pos, face)`：开始，处理旧目标和预测。
- `continueDestroyBlock(pos, face)`：按工具 / 状态累积进度，达到阈值才完成。
- `stopDestroyBlock()`：取消并发 ABORT。

这比外部程序计算硬度、猜 STOP 时刻、处理改工具和服务端纠正更可靠。任务仍需验证目标、距离、视线、工具、服务器回执与掉落，不是调用 start 后立刻返回“挖完”。

**修正一个容易误解的细节：** 当前 Buddy 连续 START / STOP 并不意味着一定挖不动。原版 [ServerPlayerGameMode](../mc-source/vanilla-src/net/minecraft/server/level/ServerPlayerGameMode.java#L114) 在 STOP 太早时可以进入 delayedDestroy，随后 tick 才破坏。因此当前同步 `broken=false` 也可能是“稍后才发生”，更需要异步任务、取消和读回确认，而不能立即重试或宣称最终失败。

### 2.4 放置：复用预测和菜单同步，而不是手造每个包

[MultiPlayerGameMode.useItemOn](../mc-source/vanilla-src/net/minecraft/client/multiplayer/MultiPlayerGameMode.java#L315) 负责选中槽位同步、预测 sequence 和交互包。它返回的客户端预测成功**不是最终服务端成功**；必须结合块更新、预测 ack 和实际读回确认。

[handleContainerInput](../mc-source/vanilla-src/net/minecraft/client/multiplayer/MultiPlayerGameMode.java#L455) 已实现菜单点击、变动 slot 的 HashedStack、carried item 和 stateId 发包。[handlePlaceRecipe](../mc-source/vanilla-src/net/minecraft/client/multiplayer/MultiPlayerGameMode.java#L495) 提供配方摆放入口。

继续使用无客户端 Buddy，就要自行维护这些菜单和预测协议，包括新版本的堆栈 hash。真实客户端提供了一条不必重复实现的现成路径。

## 3. 更适合 MCP / PTC 的源码接口地图

下表是具体能力落点，不是建议把全部 Java 方法原样暴露为任意反射工具。`protected` 方法、线程限制和注册表依赖必须由窄适配器处理。

| 源码 / 方法 | 适合封装的能力 | 重要边界 |
|---|---|---|
| [ClientInput](../mc-source/vanilla-src/net/minecraft/client/player/ClientInput.java#L6) + LocalPlayer.applyInput | `actor.move_to`、短输入段、jump / sneak | 本地连续控制、碰撞与超时；不能长期卡键 |
| MultiPlayerGameMode.start / continue / stopDestroyBlock | `actor.mine` 长任务 | 不用固定“等 1 秒”；取消停止采掘 |
| MultiPlayerGameMode.useItemOn / useItem | `actor.interact`、精确面放置、吃食物 / 用桶 | 真实射线、手持物、主 / 副手、预测与服务端确认 |
| MultiPlayerGameMode.handleContainerInput | `container.open / transfer` | 当前 menu session、stateId、slot index；不远程改库存 |
| MultiPlayerGameMode.handlePlaceRecipe | `craft.prepare`、配方任务 | 配方可见性、工作站、取出结果与库存消耗仍需执行 |
| [ClientPacketListener](../mc-source/vanilla-src/net/minecraft/client/multiplayer/ClientPacketListener.java#L932) 的块 / 容器更新与 prediction ack | `action.status`、服务端纠正事件 | 回执来自网络，不等于事务日志；不吞掉原版处理 |
| [BlockPlaceContext](../mc-source/vanilla-src/net/minecraft/world/item/context/BlockPlaceContext.java#L55) | replaceability、有效点击位置、朝向候选 | 面、hit、player 和 item 都影响结果 |
| [BlockItem.getPlacementState / canPlace](../mc-source/vanilla-src/net/minecraft/world/item/BlockItem.java#L115) | `placement.plan`，用原版求候选状态与支撑合法性 | 不调用有副作用的 place 来做 dry-run；方法受访问限制 |
| [StairBlock](../mc-source/vanilla-src/net/minecraft/world/level/block/StairBlock.java#L87)、[SlabBlock](../mc-source/vanilla-src/net/minecraft/world/level/block/SlabBlock.java#L62)、[DoorBlock](../mc-source/vanilla-src/net/minecraft/world/level/block/DoorBlock.java#L130) | 楼梯 / 台阶 / 双格门的状态 adapter | 邻居会改 shape，门有第二格副作用，不能只比较 ID |
| [BlockGetter.clip](../mc-source/vanilla-src/net/minecraft/world/level/BlockGetter.java#L64) + collision shapes | `placement.reachable`、视线、站位体积检查 | 选择正确 ClipContext、fluid / block shape 模式；未知区块不算空气 |
| [ServerChunkCache.getChunkNow](../mc-source/vanilla-src/net/minecraft/server/level/ServerChunkCache.java#L179) | `world.region / diff / verify` | 已加载才读；getChunk / ticket 是另一种显式加载能力 |
| [AbstractContainerMenu](../mc-source/vanilla-src/net/minecraft/world/inventory/AbstractContainerMenu.java#L324) | 权威 menu 状态、slot / carried 对账 | clicked 是状态变化，不可在“只读工具”里试跑 |
| [RecipeManager.getRecipes / getRecipeFor](../mc-source/vanilla-src/net/minecraft/world/item/crafting/RecipeManager.java#L105) | 配方查询、材料计划、替代配方 | 查询不等于凭空制作；按当前数据包 / 配方注册表 |
| ServerPlayerGameMode.useItemOn / handleBlockBreakAction | 服务端执行器与验收依据 | 直接调用内层 useItemOn 不能自动继承外层 packet handler 的距离 / 保护检查 |
| [IncomingRpcMethods](../mc-source/vanilla-src/net/minecraft/server/jsonrpc/IncomingRpcMethods.java#L16) | 管理 MCP：状态、保存、玩家列表、规则、白名单 | 原版管理接口不是 MCP，不含建筑 / 玩家行为接口 |
| 当前 CameraMixin / 原版 Screenshot | 导演轨道、游戏画面、验收截图 | 客户端逐帧插值与异步截图；服务器没有 framebuffer |

一个重要复用点：[BlockItem.place](../mc-source/vanilla-src/net/minecraft/world/item/BlockItem.java#L55) 已包含特性检查、合法状态、方块实体数据、setPlacedBy、多格副作用、声音、成就与物品消耗。若直接 setBlockData 后再扣一个物品，仍不能声称复用了这整条玩家语义。

即便最终选择 Paper，这份 vanilla 分析仍可作为行为基线；Paper NMS 是经过补丁的实现，不能拿原版行号当作 Paper 字节码的已验证入口。

## 4. LAN 分配一个真实角色：能解决什么

这里的“真人”指一个正常登录、实际有客户端连接的玩家实体，由 AI 接管；不是要求另找一个人手动帮忙操作。

### 4.1 它确实可以缓解暂停问题

[IntegratedServer.publishServer](../mc-source/vanilla-src/net/minecraft/client/server/IntegratedServer.java#L245) 开 TCP listener 并发布 LAN。[Minecraft 的暂停判断](../mc-source/vanilla-src/net/minecraft/client/Minecraft.java#L1247) 包含 `!singleplayerServer.isPublished()`。

所以打开 LAN 后，正常菜单不再像未发布的单人世界那样暂停服务端 tick。这不是换一个传送工具，而是源码里明确存在的生命周期分支。

### 4.2 它没有解决所有可靠性问题

- 宿主仍在人的客户端进程内；宿主退出 / 崩溃，世界服务随之结束。
- 另一个角色需要独立客户端与不冲突的身份，按服务器认证方式合法接入；不能假设改 username 就有第二个在线身份。
- 两个客户端有额外 CPU / 内存 / GPU 成本；常驻 Actor 不应被后台 FPS 限制拖慢 tick。
- 若控制宿主本人的 LocalPlayer，AI 与人的键鼠会争用，需要明确 lease 与人工接管。
- LAN 宿主不是 Paper，不能直接把 Bukkit 插件 JAR 放进 Fabric mods 就运行。
- 真实客户端只消除了重复实现部分客户端机制；寻路、脚手架、补给和工程恢复仍需要任务层。

**建议：LAN 用来先证明 Actor API，不作为长期无人值守的最终宿主。** 最便宜的 PoC 可以先接管一个现有真实角色，不以“两台客户端 + 第二账号配置完成”为验证动作层的前置条件。

## 5. 用户提供的 MinecraftMCP JAR 分析

### 5.1 证据与身份

- 文件：`C:/Users/tsy3m/Downloads/MinecraftMCP-1.1.0-paper.jar`，42,999 bytes。
- SHA-256：`a0fbbc44095600267aea771223ce783b408afbd500822242b8d686349cfa1eb5`。
- plugin.yml：`MinecraftMCP`，1.1.0，`com.example.mcmcp.McpPlugin`，api-version 26.2。
- 内嵌 Maven POM：Java 25，`paper-api:26.2.build.129-stable`，provided。
- 4 个顶层类：McpPlugin、McpHttpServer、McpTools、McpEvents；另有内部 Tool / Change / Operation。
- **未确认原始 GitHub。** JAR 未记录 scm / 作者 / repo URL；搜索结果里同名项目不能作为来源证明。用户也不记得来源，因此不再把名字匹配当成确认。
- 反编译只为本地分析，未启动 / 安装插件；没有依据断言其作者的开发方式或许可证。

反编译文件在 [analysis-minecraftmcp-1.1.0](../artifacts/analysis-minecraftmcp-1.1.0/com/example/mcmcp/McpTools.java)。

### 5.2 架构与工具

```text
MCP HTTP /mcp，Bearer token
  → JDK HttpServer，4 个 HTTP worker
  → tools/list / tools/call
  → plugin.sync(callable)
  → Bukkit scheduler 主线程任务，HTTP worker 等待最多 30 秒
  → Bukkit / Paper API
```

20 个工具覆盖：玩家信息、完整 BlockData 查询、set / batch / fill、undo、方块扫描 / 搜索、地形高度图、实体、传送、物品、容器、指令、消息、近期事件、世界与服务器指标。

值得借鉴：完整状态字符串、一次 4096 格的 batch、origin 偏移、HeightMap.MOTION_BLOCKING_NO_LEAVES、容器观察、TPS / MSPT、工具 schema 和 disabled-tools。它比单纯提供 run_command 更可编排。

### 5.3 它是编辑器，不是生存施工机器人

[McpTools.change](../artifacts/analysis-minecraftmcp-1.1.0/com/example/mcmcp/McpTools.java#L429) 的核心是：

```text
读取当前 BlockData → 记录旧状态 → block.setBlockData(desired, physics)
```

- `set_blocks`：最多 4096 项，主线程一个 callable 内循环完成；单项异常可以部分成功，最多返回 20 条错误。
- `fill_blocks`：最多 32768 格，同样一次主线程循环，默认 physics=false。
- `undo`：内存保留 30 操作，反向 setBlockData；只存旧 BlockData，不保存完整容器 / 方块实体内容，也不检查目标后来是否被玩家改动。
- 工具没有真实步行、持续采掘、合法点击放置、箱子取物、合成 / 熔炼闭环。

因此它可以被 PTC 程序用来生成建筑，但应该标为 `editor`。**程序化 ≠ 玩家施工；批量写方块 ≠ 生存能力。**

### 5.4 扩展前需要补强的地方

| 当前行为 | 风险 / 局限 | 建议 |
|---|---|---|
| 大循环在一个主线程 callable 中执行 | batch 数量上限不是 tick 时间预算；半径 32 搜索在未被高度裁剪时遍历 65³ = 274,625 格 | 分片 job、限时预算、分页 / 压缩结果 |
| getBlockAt / getHighestBlockAt 直接访问，没有 loaded guard | 不能据此承诺“只观察已加载区块” | loaded mask 与显式加载 policy |
| HTTP worker 等待 30 秒，timeout 不取消 Future | 已返回错误的动作可能稍后执行 | operationId + 状态查询 + 未开始过期 / 已开始未知 |
| 全局内存 undo，30 步 | 重启丢历史、多个调用方混用、覆盖后来的改动 | 项目 / job 所有权、持久化 receipt、冲突检查 |
| 完整 readAllBytes 与固定线程池 | 没有请求体 / 排队量限额 | 有界输入、背压，不把巨大 JSON 放进长队列 |
| config 默认 0.0.0.0、固定 change-me token、允许 console command | 这是管理权限接口，不是角色有限动作接口 | 部署配置显式化；read / actor / editor / admin 分层 |
| 手写 initialize 原样回显任意 protocolVersion；生成 sessionId 但不保存 / 校验 | “声明支持某版本”不等于实现该协议 | 使用已验证 MCP SDK，或做真实版本协商 / 会话与互操作测试 |

这不是一次公网安全审计；以上仅用于判断它是否适合作为工程后端。

MCP 协议细节应按其声明的 [2025-06-18 transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) 与 [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle) 检查：GET 返回 405 可以是合法的无 SSE 模式，不能把“没有 SSE”误判为不支持 MCP。该版 POST 是单条 JSON-RPC 消息，JAR 的 JSON array 分支不是可依赖的标准批处理能力；批量施工应放在工具参数中。版本协商、Origin 校验与所声明的 session 行为仍需核验。

## 6. 直接做 Spigot / Paper 插件是否更好

### 6.1 更适合的部分

- 权威世界状态、区块观察、实体 / 库存与事件、工作区保护。
- 分片施工 / 编辑任务、持久化日志、材料计划与验收。
- 稳定独立服务生命周期，不依赖摄影客户端暂停菜单。
- 显式编辑模式：直接构造完整状态，大幅减少 per-block RPC 与玩家站位开销。

Paper 主线程 scheduler 和大量世界 API 已有公共接口。但异步不等于随意调用世界 API，相关线程限制见 [Paper scheduling](https://docs.papermc.io/paper/dev/scheduler/)。

### 6.2 没有自动得到的部分

- Bukkit 插件不会自动得到第二个 LocalPlayer；绑定在线 Player 也不代表可以替它按 W。
- `teleport` / `setVelocity` 不是完整自然步行控制器，真实客户端可能继续上报自己的位置。
- [Player.breakBlock](https://jd.papermc.io/paper/26.2/org/bukkit/entity/Player.html#breakBlock(org.bukkit.block.Block)) 尊重工具耐久、掉落和相关事件，是有用能力，但它是强制完成一次破坏，不提供原版持续按住挖掘的完整时间流程。
- 放置后手动扣材料、手动 fire BlockPlaceEvent，不能自动继承原版距离、视线、替换上下文、多格副作用、权限和客户端预测。
- 用 Paper NMS `ServerPlayerGameMode.useItemOn` 比直接 setBlock 更接近交互，但外层包处理器的校验不能遗漏，仍需要 actor movement / menu / lifecycle 实现。
- 纯服务器没有游戏截图和导演相机；仍需摄影客户端或另一个独立渲染方案。

**插件-only 生存路线可以做，不是技术上不可能；但公共 API 不会把假玩家难题自动消掉。** 若目标是近期实现真正生存，应优先复用真实客户端动作链，而非再次在 Paper 内部造一套客户端。

这个 JAR 依赖 AsyncChatEvent、getPluginMeta、Bukkit.getTPS / getAverageTickTime 等 Paper 能力。它不能仅凭 plugin.yml 就认定兼容纯 Spigot。建议首个插件后端明确锁 Paper；若要支持 Spigot，再抽 capability adapter。需要 NMS 时按 [paperweight-userdev](https://docs.papermc.io/paper/dev/userdev/) 的当前构建 / 版本边界验证。

## 7. 原版专服自带 JSON-RPC：可以复用，但不是施工 API

本地源码已经包含：

- [ManagementServer](../mc-source/vanilla-src/net/minecraft/server/jsonrpc/ManagementServer.java)：WebSocket JSON-RPC、认证 / TLS 支持。
- [DedicatedServerProperties](../mc-source/vanilla-src/net/minecraft/server/dedicated/DedicatedServerProperties.java#L73)：management-server-enabled 默认 false；host 默认 localhost 等配置。
- IncomingRpcMethods：rpc.discover、players / kick、白名单 / 封禁 / OP、server/status / save / stop / system_message、服务器设置和 gamerules。
- [MinecraftExecutorServiceImpl](../mc-source/vanilla-src/net/minecraft/server/jsonrpc/internalapi/MinecraftExecutorServiceImpl.java)：转交 DedicatedServer.submit，而不是在网络线程操作游戏。
- OutgoingRpcMethods：启动 / 停止、玩家进出等通知。

**当前公开 RPC 没有建筑、背包 / 容器、挖掘 / 放置 / 移动方法。** `players` 返回 PlayerDto 的身份信息，不等于完整玩家状态。

适合增加一个 MCP management adapter，避免重写保存 / 状态 / 规则等管理工具。它是可选管理平面；不能替代 actor bridge 或 world observer。`pause-when-empty-seconds` 也要纳入常驻任务设计，不能笼统声称“专服永远不暂停”。

## 8. 后端对比

| 方案 | 原版生存动作 | 大型直接编辑 | 生命周期 / 运维 | 渲染 / 录制 | 本项目迁移成本 |
|---|---|---|---|---|---|
| 当前集成服 + Embedded Buddy | 部分，很多机制要补 | 当前流程有意不使用 | 随宿主客户端 | 已有 freecam / OBS | 最低，适合保留回归 |
| LAN + 真实 Actor 客户端 | 可复用客户端链，任务仍要做 | 需另加宿主能力 | 仍依赖 LAN 宿主 | 宿主 / observer 可以拍 | 中，适合第一轮 PoC |
| Fabric 专服 + 真实 Actor | 可复用客户端链 | 可加独立 editor adapter | 独立，适合 Fabric 内容 | 独立 observer | 中，保留当前模组生态 |
| Paper 插件-only | 依赖额外实现；不是现成玩家控制器 | 最擅长 | 独立，公共插件 API | 无内建画面 | 编辑器低，严格生存高 |
| Paper + 真实 Actor + observer | 客户端动作 + 权威服务端检查 | 显式 editor 模式另行提供 | 独立、多进程协调 | 支持 | 中高，但职责清楚 |

**我的优先级：先做 Actor PoC；同时将 Blueprint / Plan / Job 与后端解耦。不要为了“插件更容易”把生存需求偷偷改成管理世界。**

26.3 本地源码与此 JAR 的 26.2 API 是不同基线。本文没有确认它能直接加载在 26.3，也没有建议把已有 26.3 世界降级到 26.2。

## 9. 可确认的社区参考，不冒充用户 JAR 的源码

### 9.1 minecraft-builder-mcp：编辑器 + 摄影 worker

[emil28092005/minecraft-builder-mcp](https://github.com/emil28092005/minecraft-builder-mcp)，检查提交 `0fc4b154b6089269d564173632b6af48a7621c5d`。

仓库拆为 Paper plugin、world-core、MCP / ACP bridge、Fabric camera worker。核对 [EditEngine](https://github.com/emil28092005/minecraft-builder-mcp/blob/0fc4b154b6089269d564173632b6af48a7621c5d/world-core/src/main/java/io/github/minecraftbuilder/core/EditEngine.java) 后，可以借鉴 prepare、durable slice、commit、conflict、受保护 undo 与不自动重放的 recovery；它底层仍是编辑写入，不是生存执行器。README 的已验证环境是 Paper 26.2 / Linux，不能替代我们本机 26.3 验证。

### 9.2 IotA-asce/minecraft-mcp：工具语义必须看实现

[IotA-asce/minecraft-mcp](https://github.com/IotA-asce/minecraft-mcp)，检查提交 `b46258a47ce7e73f1ddc8e93ebefbfcca30a0191`。

它有 Paper bridge 与 client bridge，适合参考双端接口。源码也说明不能只相信工具名：[client dispatcher](https://github.com/IotA-asce/minecraft-mcp/blob/b46258a47ce7e73f1ddc8e93ebefbfcca30a0191/client-bridge/src/client/java/com/iotaasce/mcp/client/ClientCommandDispatcher.java) 的 break / place 发 setblock 命令；[server interaction](https://github.com/IotA-asce/minecraft-mcp/blob/b46258a47ce7e73f1ddc8e93ebefbfcca30a0191/plugin/src/main/java/com/iotaasce/mcp/actions/InteractionActions.java) 用固定 1 秒近似生存采掘，再强制 break。这些不是本项目严格生存动作链的直接替代。

同名 [Loyal0713/MinecraftMCP](https://github.com/Loyal0713/MinecraftMCP) 当前 package / 结构与附件不同，所检查的旧路径 history 也没有建立匹配证据，因此不认作原仓库。找到同名项目、看到相似功能和确认 JAR 来源是三件不同的事。

## 10. 对 RFC-001 的具体扩展建议

### 10.1 统一能力模型，而非所有后端假装一样

```json
{
  "actorBackend": "vanilla_client",
  "worldBackend": "fabric_observer",
  "worldVersion": "26.3",
  "executionSemantics": "player_interaction",
  "capabilities": {
    "naturalMovement": true,
    "timedMining": true,
    "menuTransactions": true,
    "authoritativeWorldRead": true,
    "directEditorWrites": false,
    "cameraTrack": false
  }
}
```

上例是目标合约，不是当前实现的真实能力返回。capability 必须通过验收后才声明，不能根据选了 Fabric / Paper 自动填 true。

新增执行语义：

- `player_interaction`：实际玩家动作与资源账本，适合 survival_strict。
- `creative_rig`：显式给料 / 传送，保留已有 Buddy。
- `editor`：权威直接编辑、没有玩家资源约束，允许用于用户明确选择的快速建筑。

三种模式保持报告独立。editor 不受之前玩家施工流程“只能 agent.place”的实现限制，因为它是新提出的、明确不同语义的后端；本次没有实际执行 editor 写入。

### 10.2 推荐新的工具边界

| 层 | MCP 工具 / PTC 编排建议 |
|---|---|
| Actor | acquire / release lease、look、move_to、mine、interact、select_slot、open / click menu、eat |
| Observe | region / diff、collision / raycast、inventory、recipes、entities、loaded mask、版本 / registry fingerprint |
| Engineer | blueprint.validate、build.plan / submit / status / pause / resume / verify |
| Editor | edit.prepare / submit / status / undo；工作区 + expected-state + 持久化 receipt |
| Director | camera.track、screenshot.operation、markers；OBS adapter 外部独立 |
| Admin | 使用原版 management RPC 或 Paper 管理 adapter；不混入生存 actor 权限 |

PTC 脚本负责组合与策略，tick 内的控制器负责快速反馈。一次 `mine` / `move_to` 返回 operationId，不能把 200 个 tick 的运动摊成 200 次 LLM 工具往返。

### 10.3 双端一致性

- actor 与 observer 必须在同 world / dimension / UUID 身份域内绑定；仅凭同名玩家不够。
- 服务器记录 actionId 对应的实际块 / 库存变化；客户端预测只作为阶段状态。
- 如果服务器 observer 不在场，报告只能标 client-observed，不能冒称权威全场验收。
- inventory / menu stateId 用于菜单同步，不代替 operationId 幂等和 job journal。
- 同一 actor 只有一个 controller lease；人类介入、死亡、断连、换世界立即暂停动作。
- 失联时释放输入并取消持续挖掘，不能停了 MCP 网络却还保持 W / 鼠标按住。

## 11. 最小验证路线：先验证动作语义，再决定长期宿主

此处是建议的下一阶段工作，不是已经启动的实验。

### P0：真实 Actor 的六个动作

在隔离测试世界先验证 look、短距离 move、select_slot、持续 mine、useItemOn、menu transfer。可用单个受控客户端完成，不必先搬世界。

验收：

1. 步行绕障碍 / 上台阶，输入停止后不会继续跑；无赋坐标 / tp。
2. 不同工具挖同一方块的耗时与耐久 / 掉落符合原版；中途取消不晚挖完。
3. 朝向、上 / 下台阶和楼梯精确状态；服务端拒绝时不报告成功。
4. 实际打开箱子取物、菜单 revision 变化可处理；无 setItem / give。
5. server correction / prediction ack 可观察；断连 / 人工接管释放 lease。
6. 非 OP / 非创造玩家也能完成这些正常动作，不依赖指令权限。

### P1：LAN 双角色对照

宿主 / observer 与 actor 分离。验证打开 LAN 后菜单不会暂停工程，身份不冲突，两客户端后台限帧不会破坏动作；宿主退出后 job 正确暂停而非继续报进度。

### P2：专服 + observer

先选同版本 Fabric 专服或同版本 Paper 测试副本，保留当前世界。验证服务器 tick 与录像 FPS 独立，observer 能做区域验收 / marker，所有动作属于实际 actor 身份。

### P3：分别验证两个工程执行器

- 生存：RFC-001 的 76 格屋檐例子，已有材料、真实移动、临时设施与回收，零 give / teleport / direct-write。
- 编辑器：相同 Blueprint 由分片 editor 构造，状态和净空相同，但报告明确资源不受限；undo 检查玩家后改的格，不恢复不完整容器数据。
- 最后才做 13,556 格四合院回归，避免大工程掩盖基础动作错误。

## 12. 本次验证范围

- 已静态检查本地原版源码、当前 Buddy 和附件全部四个顶层类。
- 已核对客户端关键方法的 jar 描述符，不依赖 1.x 教程记忆。
- 已浏览官方 Paper / MCP 文档，并将社区参考固定到提交。
- 尚未运行社区项目、插件加载测试、联机 / 第二客户端实验或吞吐基准。
- 未找到能与附件唯一匹配的 GitHub 源码；分析依据是附件本身，不以同名仓库替代。

**最终建议：生存的执行内核从“模拟无客户端玩家”转向“控制原版真实客户端”；服务器作为权威观察与工程协调器；Paper 的直接编辑作为独立模式；摄影继续留在客户端。**
