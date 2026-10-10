# mcbuddy PTC 工作流（TS）

模型一次性写程序 → mod 算法执行 → 视觉/状态反馈 → 修复。Node 26 原生跑 TS（type stripping），无需构建步骤。

## 脚本

| 脚本 | 作用 |
|---|---|
| `ts/mcbuddy.ts` | 类型化桥接客户端：重试、类型、领域原语（column/place/teleport/freecam/shot）|
| `ts/courtyard.ts [margin=8]` | 清除房子周边 margin 格内所有树（树冠/树干/落叶层），不动建筑本体 |
| `../snap.mjs map\|shot` | 拉俯视地图 / 游戏截帧存 PNG |
| `../orbit.mjs cx cz dist h` | freecam 绕房子 8 方位环拍 |
| `../verify-house.mjs` | 逐格核对设计占位（ring/tier/ridge 占用率）|

环境变量：`MAP_X`/`MAP_Z` 指定地图中心（默认 agent 位置）。

## 建房流水线（下一栋房子走这条）

1. **survey**：网格采样 `world.column`，候选窗口打分：
   地形方差 + **植被密度**（窗口+外扩 8 格内的 leaves/log 占比，>2% 直接否决——本次教训）+ 无水。
2. **clear**：先清后建。清树范围 = 足迹 + 6 格，只 break `isTreePart`。
3. **build**：地基（逐列填到统一 y0）→ 墙（留门洞窗洞）→ 屋顶三级递收。
4. **verify**：`verify-house.mjs` 逐格占位核对，缺格 multi-pass 补齐。
5. **visual QA**：`snap.mjs map`（平面）+ `orbit.mjs`（环拍）→ 人/模型看图定问题。
6. 修复 → 回到 4，直到 verify 与 visual QA 双绿。

## 已知坑（模型生成时容易错，评审时必查）

- `world.column` 一次最多返回 **24 行**，窗口要 ≤24
- 树冠会让 `standable()` 永远失败（leaf_litter 同理），先清场再动工
- 屋顶方向符号：`expand = -inset`，写反就是倒金字塔
- `agent.pick` 异步回读：`camera.shot` 的文件 IO 必须在 GPU 回调内完成
- 桥限速 4 请求/tick：并发 ≤4，别把 tick 打满
