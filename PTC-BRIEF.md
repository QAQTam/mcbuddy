# PTC 桥接脚本规格说明（给 Claude Code 的生成简报）

> 目标：照这份简报生成一套"高级"的 PTC 客户端工具链（TypeScript, Node ≥ 20，零依赖或仅 node: 内置）。
> 现有参照物：`scripts/bridge-client.mjs`（莽夫版客户端）与 `scripts/ts/mcbuddy.ts`（类型化客户端）。
> 下文所有形状/语义均来自实测，不是猜的。

## 1. 传输层

- **协议**：NDJSON over TCP，`127.0.0.1:25731`（env `MCBUDDY_PORT` 可覆盖）。
- **请求行**：`{"id":<number自增>, "method":"<名>", "params":{...}}`，可选 `"token":"..."`（env `MCBUDDY_TOKEN`，当前 mod 未强制）。
- **响应行**：成功 `{"id":N, "result":{...}}`；失败 `{"id":N, "error":{"message":"..."}}`。
- 无批处理、无 keepalive 帧、无响应顺序保证（按 id 配对）。
- **限速：桥每 tick 只吃 4 个请求**；客户端并发 > 4 会排队/超时。请求超时建议：感知类 6–9s，walk 类 20s，build 循环自管。
- 服务端只在世界运行时 tick：**标题界面完全聋**（ping 也挂）；窗口最小化会杀死渲染线程→服务端停摆→所有调用超时，只能退出世界重进。健康检查要能区分这两种"超时"（见 §5）。

## 2. 方法全表

### 感知
| method | params | 返回要点 |
|---|---|---|
| `ping` | {} | 活性检查 |
| `status` | {} | 见 §3 AgentStatus |
| `world.digest` | {x,z,chunk_radius≤6} | 区块方块分布（省略 x/z 默认 agent 所在，勿按名字误解为"眼前"） |
| `world.column` | {x,z,y0,y1} | `{x,z,loaded,column:["-60 block.minecraft.air",…]}`；**y1-y0 ≤ 24 行，超出静默截断（踩过坑）**；绝不触发区块加载，未加载列 loaded=false |
| `world.find` | {block,x,z,y0,y1,radius≤16} | 找方块；只扫已加载区块，缺席计数 `columns_absent` |
| `world.edits` | {since,limit,bp?} | 方块改动日志（place/break 100% 入账，可按 bp 标签过滤） |
| `events.poll` | {cursor} | `{events:[…], cursor}`；当前事件仅 walk/chat |
| `world.map` | {x,z,radius≤96} | 俯视 PNG base64（高度差≥3 描边） |

### 行动
| method | params | 返回要点 |
|---|---|---|
| `agent.walk_to` | {x,y,z} | 异步起走；结果里 est_ticks_lower_bound 等；寻路会诚实拒绝（no footing / 树干） |
| `agent.teleport` | {x,y,z} | `{from,moved,to,adjusted}`；**dev_writes 门控**；y 给脚部高度 |
| `agent.place` | {x,y,z} | `{placed, held, support?, within_reach?, target_before, target_after, reason?, teleport_latched}`；**placed=false 且可能没有 reason（踩过坑）** |
| `agent.break` | {x,y,z} | `{broken}` |
| `agent.pick` | {x,y,z} | 选中该方块到手上 |
| `agent.give` | {item,count,slot} | 创造直塞 hotbar 并选中：`{given,slot,item,held:"stone x64"}`；item 需 `minecraft:` 前缀 |
| `agent.say` | {text} | 聊天 |
| `agent.claim` / `agent.stand_for` / `agent.relocate` / `agent.gamemode` | — | 会话/身份/位置/模式管理 |
| `task.status` | — | mod 内任务状态 |

### 导播
- `camera.on {x,y,z,yaw,pitch}` / `camera.set` / `camera.off` — freecam（yaw/pitch 数学见 §6 lookYawPitch）。
- `camera.shot {downscale}` → `{data_base64, bytes}` 游戏截帧 PNG（异步回读已修好，可放心用）。

### 测试夹具（全部 dev_writes 门控）
- `world.pad {radius≤8}` — 脚下铺石台并清 2 格净空；幂等；中心随 agent 漂，跨会话数值不可比。
- `world.materialize {block,x,y,z,radius≤4}` — 定点生成方块（故意不用 /setblock，见 §7 纪律）。

## 3. 关键返回形状

```ts
interface AgentStatus {
  tick: number;
  agent: null | {
    spawned: boolean; removed?: boolean; name: string; dimension: string;
    pos: { x:number; y:number; z:number; chunk_x:number; chunk_z:number };
    health: number; gamemode: string; selected_slot: number;
    hotbar: string[];          // 例如 ["stone x64","diorite x64","","",…]
  };
  others: { name:string; x:number; y:number; z:number; dist:number }[];
  pause: { client_paused:boolean; server_paused:boolean;
           keep_ticking_while_paused:boolean; dev_writes:boolean };
  event_cursor: number;
}
```

## 4. 现有客户端架构（要继承的部分）

`mcbuddy.ts` / `bridge-client.mjs` 共用一套骨架：

1. `connect(timeoutMs)` — 死循环 dial，1s 间隔，到 deadline 才放弃（进世界前的等待）。
2. `#dial()` — net.connect；connect 后把 data/close/error 挂好；**close 时必须 reject 所有 pending 并清空**。
3. `onData` — 累积 buffer，按 `\n` 切行，JSON.parse 失败静默丢，按 `msg.id` 配对 resolve/reject。
4. `call(method, params, timeoutMs)` — id 自增 + setTimeout 超时（超时后从 pending 删除，防泄漏）。
5. `rawCall(..., tries=4)` — 在 call 上加指数退避重试（500ms*a），用于感知类；**行动类不要盲重试**（place 会重复放）。
6. 类型化包装：status/column/groundOf/place/teleport/give/shot/freecam + `lookYawPitch(p,t)`：
   `yaw = atan2(dz,dx)*180/π - 90; pitch = -atan2(dy, hypot(dx,dz))*180/π`。
7. `shot(file, downscale)` — camera.shot base64 → fs 写文件。

## 5. 实测坑位（新工具链必须内置的防御）

1. `world.column` ≤24 行，超出截断——封装时按 24 行分页自动拼。
2. 方块 id 带 `block.minecraft.` 前缀；变体（polished_ 等）比较用 includes 而非等号。
3. `agent.place` 失败可能无 reason；`no solid neighbour to click from` 是常见拒因；**自救姿势 = 先 `agent.teleport` 到目标旁真正相邻的空位（房外优先，如 x+0.5, z±2.5），再 place**。笼统的相对偏移点（x±1.5 等）可能落进墙里。
4. `agent.give` 会顺手选中该槽位——多材料构建按槽位切换即可。
5. 地面探测：列顶向下找第一个非 airish 块（airish = air/short_grass/tall_grass/fern/花/snow/leaf_litter），树冠（leaves/*_log/wood）要跳过。
6. 限速 4 req/tick：大批量 place/column 之间 sleep(120–200ms)，或客户端做令牌桶。
7. 健康检查三分法：TCP 拒连=没起桥；连上但 ping 超时=没进世界/服务端没 tick；status.pause.server_paused=暂停菜单。
8. 判空用 `held.length > 0`，别用 `startsWith('')`（恒真，历史上绕死过循环）。
9. 事件游标要持久化（events.poll 用 cursor 续传）。

## 6. 已验证的作业模式（可直接抄成语义封装）

- **定点建造**：give 材料→按组 multi-pass fill（每格先 column 查占位，airish 才 place；统计 placed/occupied/failed；failed=0 停，placed=0 停）→ 残余格单独 teleport 补齐 → `world.edits`/逐格 column 核对。
- **视觉闭环**：camera.on 到计算好的机位（lookYawPitch 对准目标）→ sleep(500) → camera.shot 落盘 → off。
- **验收脚本风格**：先 smoke（ping/status/短 walk/events），再夹具（pad），再业务，全程 stdout 打 JSON 行，失败 FAIL:msg + exit 1。

## 7. 设计纪律（不能违反）

- `/setblock` `/fill` 命令路径是**黑名单**（绕过玩家语义、绕过裁决）；批量写一律走 agent.place 循环或 dev_writes 下的 materialize。
- dev_writes=false 时 teleport/pad/materialize 全部拒绝，客户端要能优雅降级（walk+say 仍可用）。
- 感知调用绝不触发区块加载；"诚实报告缺席"是协议美德。

## 8. "高级货"建议清单（生成目标）

1. **PTCClient 类**：自动重连（指数退避+pending 恢复）、令牌桶限速（4/tick）、请求队列优先级（感知>行动>导播）、类型安全的 method→params/result 映射（ discriminated union + 泛型 `call('agent.place', {...})`）。
2. **健康监控**：后台 ping 心跳 + §5 三分法诊断 + 状态机（deaf/unspawned/paused/ok）事件。
3. **WorldCache**：column 24 行自动分页 + 本地缓存 + TTL + 批量预取（建造矩形一次性拉满）。
4. **Builder**：声明式 spec（site/footprint/openings/pillars/roofTiers/materials/slots）→ 分组 multi-pass → 边缘格 teleport 补齐 → verify（逐格核对报告 md/json）。
5. **Director**：关键帧运镜（keyframes+easing，绕 camera.set 逐步逼近）、orbit 环拍、shot 拼接。
6. **事件总线**：events.poll cursor 续传 + EventEmitter 语义。
7. **CLI**：`ptc smoke|status|map|shot|build <spec.json>|verify <spec.json>|orbit …`，全 JSON 行输出。
