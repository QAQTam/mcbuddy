# specs/ — 声明式建筑 JSON 规范（给 Claude Code 的创作说明）

一个 spec = 一栋建筑的全部设计数据，纯 JSON，无代码、无谓词。通用执行器：
`node scripts/ts/build-spec.ts <spec.json> [--check] [--shots] [--x0 N] [--z0 N] [--y N]`
范例：`specs/house2.json`（19×20 中式平房，已实建并逐格核对通过）。

## 坐标约定（全相对，spec 与选址解耦）

- `dx, dz` — 相对 `site.x0 / site.z0` 的偏移，**含端点**，范围 `[0, fx-1] / [0, fz-1]`。
- `y` — 相对 `Y0 = site.groundTopY + 1`（地基顶层）。`y: 0` 就是地基层，墙体 `y: 1..wallHeight`，屋顶必须 `y > wallHeight`。
- 屋顶用显式矩形 `rect`（x0<=x1, z0<=z1），允许 ±1 出檐（悬挑）；**不存在 expand/inset 符号陷阱**。
- `site.groundTopY` 填 `null` = 执行器在 footprint 中心自动探测（推荐）；也可以用 `--y N` 强制。

## 字段

| 字段 | 说明 |
|---|---|
| `name` | 用于日志与截图文件名 |
| `site` | `{x0, z0, groundTopY}`；groundTopY 建议填 `null` 让执行器探测 |
| `footprint` | `{fx, fz}` 地基尺寸（完整填充一层 foundation） |
| `wallHeight` | 墙体格数（不含地基） |
| `materials` | `foundation / wall / pillar / roof / ridge` 五种，值是**不带 `minecraft:` 前缀**的方块名 |
| `slots` | 材料 → hotbar 槽位 0..8（执行器按槽 agent.give + 自动选中） |
| `pillars` | 通天柱 `{dx,dz}`，高 wallHeight+1；只能放在墙周长上 |
| `doors` | 门洞 `{dx,dz,height}`，洞高 1..height 的墙格全空；两格宽门就写两条 |
| `windows` | 单格窗洞 `{dx,dz,y}`，y∈[1, wallHeight] |
| `roofTiers` | 层叠屋顶 `{y, rect, mat}`，mat 只能 `'roof'` 或 `'ridge'`，自下而上执行 |

## 校验规则（执行器会先跑，违反直接 FAIL）

1. 每种材料必须有槽位；槽位 0..8。
2. 柱/门/窗必须在墙周长上（dx∈{0,fx-1} 或 dz∈{0,fz-1}）——引擎只对周长生成墙。
3. 门、窗不得落在柱子上；窗不得落在门洞内；窗 y 在墙范围内。
4. 屋顶层 y 必须 > wallHeight；rect 不得倒置。

## 设计守则（画得好看的经验值）

- 柱子放四角 + 长边中段成对，形成立面节奏（参考 house2 的 12 柱）。
- 出檐：tier1 的 rect 比墙体外扩 1 格（x0:-1, x1:fx, z0:-1, z1:fz），往上每层内收 2 格。
- 脊线：最高层 rect 窄长条（宽 3~5 格）横贯，mat 用 ridge 区分颜色。
- 材料对比：foundation/roof 用深色（stone/deepslate），wall 用浅色（diorite），pillar 用最深色勾边。
- **规模预算**：单次实建 ≈ 每格 0.25–0.4s；1,500 格约 5–8 分钟，别超过 ~2,500 格。
- 材料必须是玩家可放置的完整方块；避开需要支撑的（火把、花）与重力方块（沙/沙砾会塌）。

## 我（执行方）的运行方式

1. `node scripts/ts/build-spec.ts specs/<你的>.json --check` 先看 spec 校验（不碰世界）。
2. 去掉 `--check` 实建，结束自动逐格 verify 并打印 `ok/air/other`；边缘 stuck 格我会手工 teleport 补齐。
3. `--shots` 出远景/近景两张截图给你。
