# mcbuddy

一个自用的 Minecraft 单机小工具：往自己的世界里放一个"假玩家"（buddy），在本机开一个 TCP 口，用逐行 JSON 跟它说话，让它走路、放方块、拍照。外面再配了些 Node 脚本，可以照着 JSON 图纸让它盖房子、录屏。

基本上是我自己折腾 AI 玩游戏的练手项目，不是什么成熟工具——你打算用的话请把预期放低，大概率会遇到毛手毛脚的地方。

## 现状（丑话说在前面）

- **只保证 MC 26.3 + Fabric Loader 0.19.5**，别的版本没试过，mixin 大概率会炸。
- 桥只听 `127.0.0.1:25731`，设计上就没考虑联机/远程场景。
- 脚本侧要 Node 20+（TS 直接跑，`scripts/ts/` 下的东西很多是探针和一次性脚本，命名里带 probe/repair/finish 的基本都是当时的脚手架，没清理）。
- 建造脚本默认 `dev_writes=true` 的开发配置；产品档（false）下 teleport 相关功能会被 mod 拒绝，管线会瘸。
- 建好的房子靠逐格读回核对（`verify`），但边缘格子偶尔还是会卡住，需要手工补。
- 文档比较散：`PTC-BRIEF.md`（桥协议实测笔记）、`HANDOFF.md`（交接记录）、`docs/`（几份 RFC）、`specs/README.md`（图纸格式）。

## 想跑跑看？

```bash
# mod 侧（需要 Gradle 9.7 + JDK 25）
gradle runClient          # 进世界后 /buddy spawn

# 脚本侧
node scripts/bridge-client.mjs smoke     # 桥通不通
node scripts/ts/build-flat.ts            # 盖个小的（19×20）
```

四合院那种大家伙在 `specs/`，怎么画图纸看 `specs/README.md`，但别指望开箱即用。

## 协议

MIT（见 LICENSE）。素材与录屏不在授权范围内。请遵守 Minecraft EULA；与 Mojang 无关。
