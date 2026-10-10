# mcbuddy 源码恢复记录（2026-10-10）

原仓库 `D:\mcbuddy-mod` 被误删，git 历史随之丢失。当前树由以下材料重建：

## 来源

1. **`mcbuddy-0.0.1-m5.jar`**（唯一幸存的构建产物，比聊天记录里的 HANDOFF 文档还新——文档只写到 M4，jar 已是 M5 版）。
   用 Vineflower 1.11.1 反编译出全部 23 个类，拷入 `src/main/java/`。
   打包用了 official（Mojang）映射，因此反编译结果是真名，可读性接近原始源码。
2. **`history/`**：LLM 会话导出（HANDOFF 文档的两个历史版本快照 + 若干过程记录），作为设计意图与常量依据。
3. **`mc-source/26.3.jar`**：原 Loom 缓存的 remapped 客户端 jar（mojmap 名），反编译到 `mc-source/vanilla-src/`（不入库），用于三方比对：还原代码 ↔ vanilla 源码 ↔ 会话记录。

## 丢失且不可还原

- 全部注释与 `docs/`（DESIGN.md、HANDOFF.md 最终版）。
- `scripts/*.mjs` 调试脚本（约 14 个，不在 jar 内；聊天记录里只有零散片段）。
- git 历史（提交序列可从 `history/` 里引用的短哈希部分考据，但对象本体已丢失）。

## 反编译产物的已知形态偏差

- 注释全失；部分 lambda / switch 被反编译器改写为等价形式。
- 局部变量名来自调试信息，可能与原始命名有出入。
- 需要人工复查的典型点：`BuddyAgent`、`WalkTask` 的长方法，反编译器可能引入冗余的显式 `this` / 中间变量。

## 构建参数依据（来自 jar 内 MANIFEST 与 fabric.mod.json）

- Gradle 9.7.0 / fabric-loom 1.18.2 / loader 0.19.5 / Minecraft 26.3
- 映射：`loom.officialMojangMappings()`（代码中出现 jspecify `@Nullable` 注解，与 mojmap 工具链一致）
- mixin 清单：jar 内 `mcbuddy.mixins.json`（9 个 client mixin，原样保留）
- 入口：`dev.tsy3m.mcbuddy.Mcbuddy`（client entrypoint）
