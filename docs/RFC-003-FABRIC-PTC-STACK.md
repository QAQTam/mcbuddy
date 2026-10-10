# RFC-003：Fabric 前置、TypeScript 建筑编排与 GhastLoader 的定位

- 日期：2026-10-10；状态：技术选型 / API Draft，不是已经实现的 SDK。
- 目标环境：Minecraft 26.3、Java 25、当前 mcbuddy Fabric 项目。
- 关联：[Build V2](RFC-001-PTC-BUILD-V2.md)、[执行后端分析](RFC-002-MCP-PTC-BACKENDS.md)。
- 依据：当前源码、8 组 Modrinth 搜索、发布版本 / 依赖元数据、官方 API 源码、`E:/ghastLoader`。
- 本次没有安装前置、运行新模组、加载 native DLL 或修改 GhastLoader；选型不等于兼容性验收。

## 1. 推荐结论

**不需要先造新 loader，也不需要把 TypeScript 嵌入 Minecraft。** 最值得验证的组合是：

```text
Node / TypeScript：参数化设计、编译、工程策略、素材流程
             │ MCP / typed RPC
             ▼
mcbuddy：身份、策略、operation/job、完整状态、验收、适配器
  ├─ Fabric API：生命周期、tick、网络、交互事件
  ├─ Actor client + Baritone：寻路 / 采矿 / schematic 施工候选
  ├─ Fabric server observer：权威区域与库存观察、任务约束
  └─ Camera client：导演 / 截图 / OBS markers
```

Litematica / MaLiLib 是可选的蓝图预览与人工检查工具；WorldEdit 是独立 editor 后端；Carpet 是 server fake-player 路线的候选替代，不是必须同时安装的一揽子前置。

最有价值的新增工作是 **Blueprint → 执行器的适配器 + 可靠工程 API**，不是重新实现已有 loader、寻路和编辑器。

## 2. Fabric Loader 和 Fabric API 是两件事

当前 [build.gradle](../build.gradle) 只有 Minecraft 与 fabric-loader 依赖；[fabric.mod.json](../src/main/resources/fabric.mod.json) 没有 fabric-api 依赖。现有代码主要靠自身 mixin 与原版对象完成工作。

- Fabric Loader：发现 / 加载模组、entrypoint、依赖与环境管理等基础设施。
- Fabric API：在原版上增加公共事件与跨模组协作 API。
- Fabric API 不是自动建筑机器人，也不是自带 MCP / Node.js 的脚本系统。

截至本次核对，26.3 对应的 Fabric API 发布包括 `0.162.0+26.3`；不能取全局 latest 的 26.4 snapshot 构件。证据保存在 [dependency-survey.json](../artifacts/fabric-ptc-survey-2026-10-10/dependency-survey.json)，版本发布页见 [Fabric API](https://modrinth.com/mod/fabric-api/versions?g=26.3)。

### 2.1 可以直接减少的底层工作

| Fabric 能力 | 本项目用途 | 仍由我们负责 |
|---|---|---|
| ClientTickEvents | 驱动客户端动作、超时、输入 lease | 动作状态机、人工接管、重生重绑 |
| ServerTickEvents | 工程队列分片、限额调度、读回 | tick 时间预算、优先级、失败恢复 |
| ServerLifecycleEvents | 世界启动 / 停止、保存、数据包重载 | worldId、任务持久化、registry 失效 |
| 客户端 / 服务端连接事件 | 断线释放输入、取消采掘、身份重绑定 | 业务 lease、重连后的 reconciliation |
| PayloadTypeRegistry + Client/ServerPlayNetworking | Actor ↔ observer 的类型化自定义 payload | 协议版本、幂等、体积限额和 job 合约 |
| UseBlockCallback、AttackBlockCallback、PlayerBlockBreakEvents | 部分交互保护 / 观察、破坏前后记录 | 不是通用世界事务事件，不覆盖所有编辑 / 活塞 / 流体变化 |
| command API | 状态、暂停、人工接管等管理入口 | 不能用无限制 console command 替代有限 actor API |

已核对 [26.3 ClientTickEvents](https://github.com/FabricMC/fabric/blob/0b50ffdc5705b6b3c1d826706347b9adad051dc7/fabric-lifecycle-events-v1/src/client/java/net/fabricmc/fabric/api/client/event/lifecycle/v1/ClientTickEvents.java) 与 [ServerTickEvents](https://github.com/FabricMC/fabric/blob/0b50ffdc5705b6b3c1d826706347b9adad051dc7/fabric-lifecycle-events-v1/src/main/java/net/fabricmc/fabric/api/event/lifecycle/v1/ServerTickEvents.java)。[ServerPlayNetworking](https://github.com/FabricMC/fabric/blob/0b50ffdc5705b6b3c1d826706347b9adad051dc7/fabric-networking-api-v1/src/main/java/net/fabricmc/fabric/api/networking/v1/ServerPlayNetworking.java) 的对象型 payload receiver 在服务端线程执行；不能把所有网络 API / 外部 TCP handler 都推定为同样线程语义。

外部 Node 程序仍通过 loopback TCP / HTTP / WebSocket 接入。Fabric networking 解决的是游戏客户端与服务器的自定义包，不是让 Node 自动成为已登录玩家。

迁移时优先用事件替换普通 tick / lifecycle mixin；保留确实需要的特殊连接驱动或缺失 hook。现有 Buddy 的 connection tick 顺序不能不经验证就整体删掉。 dedicated server 后端还需移除 common 代码对 `Minecraft.getInstance()` 等客户端类的依赖。

### 2.2 不会自动提供的能力

Fabric API 不提供完整自然玩家寻路、参数化中式屋顶、状态定向施工、脚手架工程、箱子物流、断点施工账本或电影轨道。低层合法交互仍复用原版 LocalPlayer / MultiPlayerGameMode；复杂路径与施工可交给候选库，但工程完成条件仍由我们验证。

## 3. 社区组件：按角色选，不是全部堆进去

以下版本来自项目发布元数据；均未在本机运行验收。license / side / dependencies 的记录见 survey JSON。

| 组件 | 26.3 候选 | 推荐角色 | 不应误认成什么 |
|---|---|---|---|
| Fabric API | 0.162.0+26.3 | 首选基础前置，Apache-2.0 | 自动施工 API |
| Baritone | 官方 v1.20.0，baritone-api-fabric 构件 | 首选真实 Actor 的寻路 / 采矿 / schematic 建造适配 | 耐久工程账本、箱子物流、任意精细状态保证 |
| Carpet | 26.3，MIT | server fake-player / action pack 候选，减少 Buddy 生命周期工作 | 完整自主建筑规划或 Baritone 的服务端版 |
| Litematica + MaLiLib | 0.29.1 + 0.30.2，LGPL-3.0-only | 蓝图预览、材料信息、人工检查 | Litematica 本体自带全自动 printer |
| WorldEdit | Fabric 7.4.6-beta-02，GPL-3.0-only | editor 后端、Clipboard / schematic / 编辑历史 | 自然玩家施工；26.3 候选仍是 beta |
| JsMacros Reloaded | 2.2.0+26.3-fabric，MPL-2.0 | 快速验证客户端动作 / 菜单脚本，附 TS 定义 | Node.js 运行时或已完成的远程 job service |
| 原版 JsMacros | 此次发布列表未见 26.3 | 历史参考 | 直接使用旧 1.21 包 |
| KubeJS | 此次发布列表未见 26.3 Fabric | 配方 / 内容脚本参考，不列入当前必需栈 | 为现有 Node 编排必装的 JS 引擎 |

### 3.1 Baritone：最值得先做适配 PoC

[官方 v1.20.0 release](https://github.com/cabaletta/baritone/releases/tag/v1.20.0) 明确针对 26.3，包含 `baritone-api-fabric-1.20.0.jar`。此次核对的 release commit 为 `25111daedf1d59e6a8dfb5a3e61885cdb8d953df`。

公开 API 已有：

- IBuilderProcess：接受名称、ISchematic 与 origin，提供 pause / resume。
- ISchematic：提供尺寸、指定坐标是否有意义、期望 BlockState。
- IMineProcess：按目标方块和数量启动采矿。
- 自定义路径 goal 等 API；使用公开 `baritone.api`，不依赖内部实现。

最短链路是：

```text
TypeScript 几何 / 模块设计
  → Blueprint V2（palette + 精确状态 + 稀疏 targets + clearance）
  → Java BlueprintSchematicAdapter implements ISchematic
  → IBuilderProcess
  → 实际客户端玩家
  → 独立完整状态验收
```

参考：[IBuilderProcess](https://github.com/cabaletta/baritone/blob/v1.20.0/src/api/java/baritone/api/process/IBuilderProcess.java)、[ISchematic](https://github.com/cabaletta/baritone/blob/v1.20.0/src/api/java/baritone/api/schematic/ISchematic.java)。

必须由适配器解决：

1. 未指定格是 don't-care，不是“整个包围盒都清成空气”。入口 clearance 默认断言，不是任意拆除命令。
2. Baritone 为开路 / 建造可能拆放方块；其默认行为不是我们的工作区 / 所有权 policy。必须保护非任务建筑，限制可破坏格和临时设施范围。
3. getApproxPlaceable 与 builder 结束状态不等于精确最终状态通过。楼梯连接、门、多格结构和水状态需要专项验证；不能自动用近似材料替代设计。
4. 进度、缺料、掉落损失、撤销、重启和材料 conservation 不由 IBuilderProcess 单独保证。
5. Baritone 依赖真实客户端上下文，不可直接安装在专服替无客户端假玩家做同样工作。
6. Actor 的输入只有一个 owner；Baritone 与我们的短动作 / 人类键鼠需要互斥 lease。

因此先借它完成运动 / builder，再补薄适配器与工程约束；不把“建造进程停止”包装成 job COMPLETED。

### 3.2 Carpet：服务器 Buddy 的另一条减负路线

[Carpet 26.3 发布](https://modrinth.com/mod/carpet/version/yt9oDFOj) 可以作为服务端前置。核对源码中的 EntityPlayerMPFake 与 EntityPlayerActionPack 后，它已经具备假玩家接入、ray-trace use、动作更新和采掘状态逻辑。

它有机会替代当前自制 EmbeddedChannel Buddy 的一部分生命周期与动作代码。仍需要自主路线、工程规划、菜单 / 补给适配和持久化任务。Carpet 的行为与设置必须明确固定，不能仅凭“假玩家能 use”就声称所有原版校验都相同。

本次源码固定到 `0986bffa2f5ef2e8fe3cfc80cfe2d790378c5e28`：[EntityPlayerMPFake](https://github.com/gnembon/fabric-carpet/blob/0986bffa2f5ef2e8fe3cfc80cfe2d790378c5e28/src/main/java/carpet/patches/EntityPlayerMPFake.java)、[EntityPlayerActionPack](https://github.com/gnembon/fabric-carpet/blob/0986bffa2f5ef2e8fe3cfc80cfe2d790378c5e28/src/main/java/carpet/helpers/EntityPlayerActionPack.java)。这是已检查源码提交，不声称它与发布 JAR 位级一致。

**路线 A：真实 Actor + Baritone。路线 B：Carpet fake-player + 自己的路线 / 工程适配。** 不要把它们想成装上就自然协作的同一执行器。

### 3.3 蓝图、编辑与脚本辅助

- [Litematica](https://modrinth.com/mod/litematica/version/ZqV316KY)：用于用户可见的蓝图审查。项目说明明确 printer 留给扩展，不把本体等同于自动施工。API 耦合前需检查内部接口稳定性。
- [WorldEdit Clipboard API](https://worldedit.enginehub.org/en/latest/api/examples/clipboard/) / [EditSession](https://worldedit.enginehub.org/en/latest/api/concepts/edit-sessions/)：适合导入导出与编辑模式。它的历史不是我们跨重启的工程账本；普通操作也不能自动成为符合预算的异步任务。
- [JsMacros Reloaded](https://modrinth.com/mod/jsmacros-reloaded)：快速动作 spike 候选。实际 helper 有持续 break / async callback 和 useItemOn 封装；可以比较其 API，减少重写。Graal 等游戏内脚本环境与 Node 是不同环境，TS 定义不代表 npm / fs / net 可照搬。等待脚本方法不能阻塞客户端线程。
- KubeJS 的强项是配方、内容和世界事件，不是为本项目外部 Node 编排补一个同名 JavaScript 引擎。此次没有合适的 26.3 Fabric 发布证据，不列为前置。

## 4. 程序化建房，Minecraft 应提供什么

### 4.1 放在 TypeScript 侧，不必让 MC 实现

布局规则、院落模块、对称 / 阵列 / 旋转、屋顶曲线、体素化、材料 palette、设计约束、工程策略、文件 / 视频流程都可以在 Node 中完成。

MC 不需要知道“中式四合院是什么”，需要可靠表达与执行目标方块状态。几何 `box` / `fill` 是纯数据生成器，不应自动变成直接世界写入工具。

设计至少分两层：

1. **DesignSpec**：语义与参数，例如开间、进深、回廊、屋面、门洞与使用功能。
2. **Blueprint**：编译后的状态 targets、净空、phase DAG 与 provenance，具体可验收。

旋转必须变换 BlockState（facing、axis、hinge、shape 等），不只变坐标。材料替换需要校验形状与施工语义；不能把楼梯换普通方块而仍宣称同一设计。

### 4.2 最小游戏侧 API

| 能力 | 首版合约 | 为什么需要 |
|---|---|---|
| 身份 / 能力 | capabilities、worldId / dimension / actorId、registryFingerprint、mode | 不向不支持的后端提交，也不续建错世界 |
| 方块注册表 | registry.blocks、state.normalize、state.transform | 校验完整属性，正确旋转 / 镜像 |
| 有界世界观察 | world.region / diff、palette RLE、loadedMask、分页与观察 tick | unknown 不算 air，减少逐列 RPC |
| 勘察 / 可达性 | heightmap、collision、raycast、placement.plan | 支撑、站位、hit、工作面与退路 |
| 资源 | inventory、实际 menu transfer、recipe 查询 | 缺料预算、真实箱子补给与制作 |
| 行动 | actor.move / mine / interact，operationId | 连续动作在游戏 tick 内完成，不逐帧问 LLM |
| 工程 | build.plan / submit / status / pause / resume / cancel | 后端适配、持久化进度、错误与断点恢复 |
| 验收 / 导演 | build.verify、camera.track、shot operation、markers | 精确结果 + 可重复素材生产 |

`state.transform` 可以调用本版本原版 BlockState.rotate / mirror 等语义，而不是在 TS 中凭记忆写所有特殊属性。特殊方块 / 动态 shape 仍需 adapter 验证，不能默认所有变换都支持。

明确分三类执行语义：`survival_strict`、`creative_rig`、`editor`。同一 Blueprint 可复用，不同模式的资源 / 移动 / 世界写入记录不可混淆。

### 4.3 我们自己最该写的四块

1. **类型化 SDK 与 capability negotiation**：读和 mutation 分开，带 operationId；超时先查询，不盲重放动作。
2. **Blueprint compiler / adapter**：确定性去重、冲突校验、完整状态、don't-care / clearance、Baritone ISchematic / WorldEdit Clipboard 输出。
3. **Job coordinator / policy / material ledger**：统一 actor lease、允许区域、临时设施归属、库存真实流量、持久化与恢复。
4. **Verifier / Director adapter**：独立读回验收；原生相机轨道和 OBS owned recording。

这四块是我们的产品差异。Fabric 和社区库处理其擅长的执行细节，不代表任何库已经满足整份 spec。

## 5. 拟议 TypeScript 用法

下面只是 API 草案，不是当前可执行程序；函数与包名未实现。正式实现需补 JSON schema、TypeScript 类型、method/result 映射和合约测试。

```ts
// Node 侧：设计器只产生数据，不接触游戏对象。
const design = courtyard({
  width: 104,
  depth: 104,
  layout: "three-courtyards",
  roof: { style: "hip", overhang: 2 },
});
const blueprint = design.compile({ palette: chineseCourtyardPalette });

const mc = await connectMinecraft({ endpoint: "127.0.0.1:25731" });
const caps = await mc.capabilities();
assertSupports(caps, "baritone", "survival_strict");

const plan = await mc.build.plan({
  blueprint,
  dimension: "minecraft:overworld",
  origin: [-52, -60, 40],
  executor: "baritone",
  mode: "survival_strict",
  resources: { acquisition: "existing_only" },
  policy: { protectExisting: true, temporaryBlocks: "owned_only" },
});
if (!plan.ready) throw new PlanningError(plan.issues);

const { jobId } = await mc.build.submit({
  planId: plan.id,
  planHash: plan.hash,
  operationId: crypto.randomUUID(),
});
await mc.jobs.wait(jobId); // SDK 轮询 / 订阅；不阻塞游戏线程。
const report = await mc.build.verify({ jobId });
assertVerified(report);  // 包含完整状态、净空和临时块清理。
```

真正的 SDK 必须允许 WAITING(MATERIAL_MISSING / NO_ROUTE / UNKNOWN / CONFLICT)，支持用户 / 策略补给后恢复；`wait` 不能忽略这些状态永远等待。上例未指定箱子，不代表可凭空取得材料。

客户端看到的目标匹配和服务端权威验收应分别标识。baritone.isActive=false、RPC 返回 200、放置次数达到目标数，都不能单独代表建完。

## 6. GhastLoader 能帮什么，不能帮什么

### 6.1 当前项目实际是什么

检查目录 `E:/ghastLoader`，工作树干净，remote 为 `https://github.com/QAQTam/ghastLoader.git`，commit `d9a5d6771e3422c1151efdb23ec121ca729c3a32`。

- [GhastLoaderAgent](E:/ghastLoader/src/main/java/com/ghastloader/GhastLoaderAgent.java:22)：premain 发现 mod，注册 Java Instrumentation transformer。
- [HappyGhastTransformer](E:/ghastLoader/src/main/java/com/ghastloader/transform/HappyGhastTransformer.java:19)：只针对 HappyGhast 的少数方法 / 常量替换；不是通用玩家、世界或建筑接口。
- [EventBus](E:/ghastLoader/src/main/java/com/ghastloader/EventBus.java)：Java 反射订阅与 HappyGhast 数值 getter。
- [NativeBridge](E:/ghastLoader/src/main/java/com/ghastloader/NativeBridge.java)：Panama FFM 调用 C ABI；Rust 示例处理速度和平滑参数。
- 没有 TCP / MCP / TS runtime、Blueprint、方块观察、玩家动作、工程任务和相机协议。

它证明的方向是「Java 插桩 → 有限 API → Java / Rust 扩展」，不是「已有程序化建筑系统」。README 关于无需 Mixin 的主张不等于 Mixin 所有能力都多余；可读类名只减少映射问题，不会消除精确目标、版本变化和跨模组变换协调。

### 6.2 扩展前的具体问题

以下不为本任务直接修复；除了 FFM carrier 的纯 JDK 验证，尚未运行 loader / DLL。

| 位置 | 观察 / 推断 | 影响 |
|---|---|---|
| build.gradle 的 ASM 9.7 | 官方 ASM 9.7 对应 Java 23；Java 25 支持加入于 9.8，而目标 MC 是 Java 25 | 必须使用支持目标 class version 的 ASM，不宜在这个基线上承诺已可解析 MC 字节码 |
| ModDiscoverer 的 platform parent | sample mod compileOnly 引用 loader API，但 URLClassLoader 的父是 platform loader，没有代码把 loader API 暴露给该父 | 按当前隔离加载布局预计无法解析共享 API；若另行复制 API，又会有类身份不一致风险 |
| NativeBridge 的 ADDRESS 返回与 `(long)getName.invoke()` | JDK 25 ADDRESS carrier 是 MemorySegment，不是 long | 当前模块名获取返回类型不匹配；应接收 MemorySegment 并有界读取 |
| HappyGhastTransformer | 按方法名 / 数值替换，未核对描述符 / 命中数量 | 新版本相同常量多处出现或消失时可能误改 / 静默漏钩子 |
| EventBus / NativeBridge | 部分 getter 不使用事件修改后的全部字段；travel handler 返回首个模块结果 | API 可修改字段与实际效果、链式策略不完全一致 |

依据：[ASM 官方版本记录](https://asm.ow2.io/versions.html)、[JDK 25 AddressLayout](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/AddressLayout.html)。本地 JShell 输出为：`ADDRESS carrier: java.lang.foreign.MemorySegment`、`FD_MOD_INFO method type: ()MemorySegment`，未加载任何原生库。

### 6.3 有价值的复用方式

**建议抽思想 / 模块，不先替换 Fabric。**

- 将来如果体素化、空间索引或路径搜索确实成为 CPU 热点，可做 Rust worker / 有界 C ABI 接口。
- 原生模块只接收快照 / 数组并返回计算结果，世界读写留在 Java 正确线程。
- FFM 可以直接由 Fabric mod 使用，不要求先换成 GhastLoader；Node 侧也可调用独立计算进程。
- 对当前大量 RPC / 等待 / 玩家行动占主导的流程，换 Rust 不会自动让合法施工变快；先测瓶颈。
- 如果未来目标是研究独立 loader，GhastLoader 是实验起点，但这会成为额外产品，不是建筑最短路径。

## 7. 推荐最小栈与推进顺序

### 7.1 真正生存路线

必需候选：mcbuddy + Fabric API + 真实 Actor 客户端。首个高价值可选执行器：Baritone API；不要同时让自制输入控制器和 Baritone 抢角色。

可选：Litematica / MaLiLib 用于审查；服务器 observer 与摄影客户端按权威验收 / 录像需求添加。JsMacros Reloaded 用于 spike，不必永久依赖它。

### 7.2 快速编辑路线

mcbuddy job / policy + Fabric API + WorldEdit editor adapter + camera。明确 editor 语义，不把库存扣减包装成原版生存。

### 7.3 无第二客户端路线

在隔离环境验证 Carpet 26.3 fake-player / action-pack 是否可替代 Buddy 接入；仍需单独解决自主路线 / 建造。它可能节约资源与假连接维护，但不要承诺比真实 Actor 更少全部工作。

### 7.4 第一轮应该验证什么

1. 引入匹配 26.3 的 Fabric API，只迁移普通 tick / lifecycle；维持现有 Buddy 回归。
2. 做 76 格 roof-demo 的 ISchematic adapter；检查非任务格不被清除。
3. Baritone 基础移动 / 采矿，带人工接管与 cancel；不靠未声明的作弊 fallback。
4. 测完整状态的楼梯 / 台阶 / 原木 / 门，以及缺料和不可达结果。
5. 验证开路 / 临时块不会破坏保护区；禁用不适用的默认行为。
6. 原版菜单箱子 transfer、材料 ledger、断连恢复；这些不因引入 Baritone 自动完成。
7. 最后才做万格四合院和导演录制回归。

## 8. 本次范围与选型边界

已完成本地源码审阅、真实发布元数据核对、公开接口检查、GhastLoader 静态检查及纯 JDK FFM 类型验证。调查数据已落盘；没有安装 / 构建 / 运行上述社区模组，没有更改当前游戏。

版本适配、库之间 mixin 冲突、精细状态和工程资源正确性仍需隔离 PoC。文档中的 API 用法是草案，不应直接交给当前 runner 执行。

**最短路线：Fabric API 做基础，Baritone 做可替换执行器，Node/TS 做设计与策略，mcbuddy 做可靠工程适配。GhastLoader 留作原生计算 / 插桩实验，不成为当前建筑前置。**
