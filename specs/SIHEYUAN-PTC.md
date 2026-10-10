# 海棠四合院 — PTC 建造与导演录制

## 本次交付（2026-10-10）

实建已完成：`verify: ok=13556 air=0 other=0 total=13556 blockedDoorways=0`。

- 正常速度导演片：`artifacts/siheyuan-104/siheyuan-director.mp4`，2 分 28 秒。
- 20 倍施工延时片：`artifacts/siheyuan-104/construction-20x.mp4`，2 分 22 秒。
- 两者均为 1920×1080 / 30fps，已完整解码检查并抽帧视觉确认。
- 原始 MKV、录制时间码及有效素材清单均保留。施工原片开始于地坪施工中段，不包含最初接入调试；黑屏接入测试片已在清单中排除。
- OBS 录制已停止，自由相机已归还控制。日间拍摄设置保留，恢复自然昼夜的命令见下文。

## 设计

院落总占地 **104×104 = 10,816 平方格**，并非只画一个地基。边界粉墙完整围合；南向门楼可穿行，入门见影壁，经南院、抄手游廊进入主庭。正房、东西厢房、两座倒座房构成四合布局。

初始站点：`x=-52..51, z=40..143`；本次超平坦地面 `y=-61`，铺装层 `y=-60`。站点首次探测后固定在素材目录 `site.json`，续建不会误把屋顶探测成地面。

- 正房「明德堂」：31×15，朱柱、粉墙、青黑色四级退台屋面。
- 西厢「书斋」、东厢「客舍」：各 13×31。
- 西倒座茶室、东倒座膳厅：各 25×11。
- 南门楼：11×11，双向三格通道。
- 东西抄手游廊、中轴甬道、横向石径、影壁、四座海棠花池、宫灯。
- 书架、案几、卧榻、屏风等支持安全的方块家具。

总图是 `siheyuan-104.json`，六栋主体仍使用 house2 同形的标准 BuildSpec，存于 `siheyuan/`。为满足 100×100，本项目超过技能的单次 2,500 格小房子建议，但仍按小规格分栋、逐格放置。最终规格编译后 **13,556 格**（包含实测后补上的四块灯座基础）；以 `plan-summary.json` 实际数字为准。

## 接入与准备

1. 打开装有 mcbuddy 的 Minecraft，进入本次超平坦世界。
2. `/buddy spawn`，施工助手须为 creative。
3. 本实例 `config/mcbuddy.properties` 需 `dev_writes=true`；修改后重启实例。`keep_ticking_while_paused=true` 可使桥在菜单中工作，但**录屏必须关闭菜单**。
4. 摄影玩家建议位于 `0,-35,92`，渲染距离至少 16 区块。F11 全屏；F1 隐藏 HUD；不要最小化游戏。视频设置中将「降低帧率」设为「最小化时」，防止自动运镜因无人按键而被 AFK 限帧；本次渲染上限为 90fps。
5. 可设置 `/time set day`、`/gamerule minecraft:advance_time false` 固定日景。还原自然昼夜：`/gamerule minecraft:advance_time true`。

在仓库根目录执行，Node 26 无需编译：

```powershell
node scripts/ts/design-siheyuan.ts         # 重新生成设计；未改设计时不必执行
node scripts/ts/siheyuan.ts plan           # 纯离线验证及方块统计
node scripts/ts/siheyuan.ts survey         # 81 点平地采样
node scripts/ts/siheyuan.ts build --director
node scripts/ts/siheyuan.ts verify
node scripts/ts/siheyuan.ts shots
node scripts/ts/repair-siheyuan.ts         # 只有 residual.json 非空时才需要
```

施工预检逐列读取全部目标位置，遇到非规格固体或堵住的门洞直接停止，**不自动拆旧建筑**。续建会跳过已匹配格；不确定的动作超时先读取结果，不盲目重放。支撑不足的格在后续修复轮补齐。`agent.stand_for` 的坐标是字符串，执行器解析后传给 teleport，并等待传送确认。

批量放置只使用 `agent.place`，不使用 `/fill`、`/setblock` 或 materialize。放置最小间隔 120ms；读取最多三个并发，批间休息 120ms。最终必须同时达到 `air=0`、`other=0`、`blockedDoorways=0`，才能称为验收完成。

## OBS 全屏录制

本机 OBS 32.2.2 / WebSocket 5.7.4，专用 PTC 配置：1920×1080，30fps，MKV。提供主显示器全屏源，以及叠在上方的 Minecraft 全屏窗口干净采集源（排除桌面操控光标光圈）。不开直播、不上传。当前配置没有额外启用麦克风；如需旁白可后期配音。

首次初始化（已有 OBS 配置不会被覆盖）：

```powershell
node scripts/setup-obs-ptc.mjs
```

启动已安装的 OBS（工作目录须为 exe 所在目录），再运行：

```powershell
node scripts/obs-client.mjs setup
node scripts/obs-client.mjs status
node scripts/obs-client.mjs start
node scripts/obs-client.mjs stop
```

密码从 OBS 本地配置读取，不写进工程，不打印到日志。CLI 的 `start` 拒绝接管已有录制。OBS 的 StartRecord 返回并不代表已录制，导演/工作流会等待 `GetRecordStatus.outputActive=true` 确认。

一键 PTC：

```powershell
node scripts/ptc-siheyuan-workflow.mjs build   # 录制预检→真实建造→逐格验收→成片运镜
node scripts/ptc-siheyuan-workflow.mjs tour    # 验收已通过时，单独录制成品
```

重复 build 是续建，不会拆除已经建好的院落。若想从空场录一条新的施工片，请另选空地及新的素材目录，勿清空当前作品。

## 导演模式

`siheyuan-director.json` 定义十段镜头：全景揭幕、门楼推近、穿门入院、影壁绕行、东侧回廊、海棠庭心、正堂立面、书斋侧景、俯瞰总图、环院收束。相机按墙钟时间运行，20Hz 更新，smoothstep 缓入缓出，角度采用最短弧，不跨 360° 抽搐。

```powershell
node scripts/ts/director-siheyuan.ts --preview
node scripts/ts/director-siheyuan.ts --shot 正堂 --speed 2
node scripts/ts/director-siheyuan.ts --record
```

成片总时长约 2 分 25 秒（含转场等待和截帧）。运行后保存十张片段末帧、时间码与 `director-recording.json`。退出/错误时归还相机控制，并且只停止该脚本自己启动的 OBS 录制。

## 素材与证据

全部位于 `artifacts/siheyuan-104/`：

- `site.json` / `survey.json`：本次站点、地形采样。
- `plan-summary.json`：规格总数与材料清单。
- `progress.json`：可读施工进度；续建以真实世界为准。
- `ptc-trace.ndjson`：阶段、进度、截帧与验收轨迹。
- `verify.json`：逐格正确/缺失/不符，以及门洞可通行核验。
- `residual.json` / `conflicts.json`：若存在失败，保存明确坐标。
- `final-overview.png` / `final-plan.png` / `final-gate.png`：视觉 QA。
- `recordings/*.mkv`：OBS 原始素材；MKV 可无损转封装成 MP4。
- `director-timeline.json`：导演镜头时间码。

PTC 核心链路是：**生成程序/规格 → 执行工具调用 → 世界读取与视觉反馈 → 修复 → 再验收**。可以剪辑命令行/设计总图作前序，施工原片加速为延时，再接正常速度导演成片。

素材清单 `media-manifest.json` 明确列出有效原片，排除接入测试的黑屏片段。`node scripts/package-siheyuan-video.mjs --speed 20` 可生成 20 倍施工延时片，并将导演 MKV 无损转封装为 MP4；保留原片，不覆盖已有导出。

OBS 自动化接口依据 [OBS 官方启动参数](https://obsproject.com/kb/launch-parameters) 与 [官方 WebSocket 协议](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)。
