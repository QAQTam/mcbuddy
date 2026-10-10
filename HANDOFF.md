# HANDOFF — 2026-10-10（视觉/导播/TS 工作轮之后）

接续 RECOVERY.md。本文件的读者是"下一个会话的模型/开发者"：从这里接手时，先读"当前能力"，再读"已知坑"，最后看"待办"。

## 一、当前状态

- 仓库：E:\mcbuddy-mod（git，HEAD 见 git log；本文件所在轮次的提交主题是 freecam/world.map/agent.give）
- 运行方式：`gradle runClient`（Gradle 9.7.0 在 `%USERPROFILE%\tools\gradle-9.7.0`）
- **玩家固定身份**：`tsy3m` / uuid `0a23e6f3-58f2-3f8c-84c6-7976fb305de4`（build.gradle loom.runs.client.programArgs；离线算法 `node scripts/uuid-for.mjs <name>`）。世界会记住你，不再是随机 Player###
- run/config/mcbuddy.properties：`dev_writes=true`、`keep_ticking_while_paused=true`（teleport/fixture 依赖前者）

## 二、桥接原语全表（127.0.0.1:25731，NDJSON，逐行请求/响应）

感知：`ping` `status` `world.digest{x,z,chunk_radius≤6}` `world.column{x,z,y0,y1(≤24行!)}` `world.find{block,x,z,y0,y1,radius≤16}` `world.edits{since,limit}` `events.poll{cursor}` `world.map{x,z,radius≤96}`(俯视PNG base64)

行动：`agent.walk_to{x,y,z}` `agent.teleport{x,y,z}`(dev_writes) `agent.break{x,y,z}` `agent.place{x,y,z}` `agent.pick{x,y,z}` `agent.give{item,count,slot}`(**创造直塞背包+选中，推荐**) `agent.claim` `agent.stand_for` `agent.say` `agent.gamemode` `agent.relocate` `task.status`

导播：`camera.on{x,y,z,yaw,pitch}` `camera.set` `camera.off` `camera.shot{downscale}`(游戏截帧PNG base64；异步回读已修，文件IO在GPU回调内)

测试夹具（dev_writes）：`world.pad{radius≤8}`(脚下铺石头并清2格) `world.materialize{block,x,y,z,radius≤4}`(定点生成方块，26.3 的 ResourceLocation 已改名 **Identifier**)

## 三、脚本资产（scripts/）

- `ts/mcbuddy.ts` — 类型化客户端（Node26 原生跑 TS）：Bridge/重试/status/column/groundOf/place/teleport/freecam/shot
- `ts/build-flat.ts` — 超平坦建房（地基19×20→白墙+门洞窗洞→深板岩柱→三级屋顶），按材料分组 multi-pass
- `ts/courtyard.ts [margin]` — 清房周树植（isTreePart 白名单，不伤建筑）
- `snap.mjs map|shot`（存 PNG，MAP_X/MAP_Z 定中心）、`orbit.mjs cx cz dist h`（8方位环拍）
- `verify-house.mjs`（逐格占位核对）、`uuid-for.mjs`、`bridge-client.mjs`（smoke/call/watch）
- 一次性脚本（已完成使命，可删）：`fix-roof.mjs` `complete-structure.mjs` `_probe.mjs`
- `ts/README.md` — 流水线文档 + 坑位清单

## 四、已知坑（评审必查，全部踩过）

1. `world.column` 一次最多 **24 行**，超出截断（曾致选址全错）
2. 树冠/leaf_litter 会让 mod 的 `standable()` 永久失败 → 先清场再动工；`isTreePart` 白名单清场不伤建筑
3. 屋顶方向符号：expand = **-inset**，写反 = 倒金字塔（已发生过）
4. **窗口最小化 = 游戏死亡**：26.3 renderpearl 抛 `SurfaceException: Cannot acquire minimized window`，渲染循环卡死→服务端 tick 停→桥全部超时。还原窗口也救不活服务端线程，需退出世界重进。已加双层 try-catch（mixin+handler）兜 handler 异常，但最小化问题无解，只能"别最小化"
5. `/buddy remove` 后 spawn 锚点是**世界出生点**，不是玩家身边（曾把 buddy 生在 y-60 洞里）；重生后用 `agent.teleport` 落到玩家脚边
6. 桥限速 4 请求/tick；客户端并发 ≤4
7. Loom dev run 的桥在**标题界面不响应**（服务端没 tick），属正常，进世界再说

## 五、已验证的成果

- m5 恢复 jar 与重建 jar：31 条目全同、19/28 类字节码级相同、9 类 API 面全同（分支反序差异）
- 中式房子 #1：旧世界 `新的世界` x[47..65] z[-126..-107]，地基+墙+三级屋顶 1006/1006 格核对通过，庭院已清 8 格
- 视觉闭环：world.map（高度差≥3 描边）+ orbit 环拍 8 张全部成功
- 超平坦世界（tsy3m 的新地图）：#2 号房脚本就绪（`build-flat.ts`），尚未跑

## 六、待办（按优先级）

1. **BuildSpec 重构**（用户已同意方向）：把"设计"抽成声明式 spec（site/footprint/openings/pillars/roof/materials），引擎 `buildEngine(spec)` 只吃 spec。当前 `build-flat.ts` 的门窗/柱位/材料是硬编码谓词
2. 跑通超平坦 #2 号房（流程全绿后可作流水线验收基准）
3. **桥健康检查**：ping 超时时的诊断输出（端口通+无应答=服务端没 tick：查窗口最小化/是否进世界）
4. `camera.path` 关键帧插值运镜（freecam 上加 keyframes+easing，出视频级运镜）
5. Obsidian-Launcher 集成（E:\mcpro\Obsidian-Launcher，Tauri 启动器，CLAUDE.md 有文档）：把 fabric+mod 装进它的 game/versions，用它的固定 profile 拉 modded 游戏，替代 gradle runClient
6. （旧世界）房子 #1 的窗户目前是 1 格高地板层（isWindow 用 h===1 判定，设计本意是 h===2），修不改随缘
7. history/ 里还有原 m5 的 `ptc-host.mjs`、`m5check.mjs` 验收脚本全文可恢复（M5 验收表的桥接验收逻辑直接可抄）

## 七、本轮新增原语实现位置

- `ClientCamera.java`（camera.shot，renderpearl 异步回读）
- `FreeCam.java` + `mixin/CameraMixin.java`（inject Camera.alignWithEntity TAIL）
- `bridge/WorldMap.java`（服务端 NativeImage 俯视渲染）
- `bridge/WorldFixture.materialize`（Identifier.parse！ResourceLocation 在 26.3 已更名）
- `BuddyAgent.give`（Inventory.setItem + setSelectedSlot；26.3 的 Inventory.selected 是 private，用 getSelectedSlot/setSelectedSlot）
