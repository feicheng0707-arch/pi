# Candidate-S0 Runtime Contract

本文件只约束 Candidate-S0 Challenger/Finalizer 实验路线，并进入 capability hash。它不替代 active 三调用 Pi-native 路线，也不改变旧路线 identity。

## 固定执行序列

Harness 将成熟 Single-Prompt Candidate 的 exact block set 冻结为 `S0`。成功路径最多两次 provider call，失败路径可以提前终止：

1. 独立 Challenger 读取完整不可变 source、`S0`、机械地址授权和严格 JSON schema，提交一次有界 challenge；
2. 仅当至少一个 challenge partition 通过机械授权时，独立 Finalizer 再次读取完整不可变 source、`S0` 和有效 challenge envelope，并通过唯一 targeted-delta tool 提交一次 sparse delta。

无 retry、第三次调用、投票、best-of-N、逐 block ledger、答案驱动路由或失败后换模型重跑。两个角色的 model/profile、Prompt、schema、容量与调用上限必须在第一次语义调用前冻结；不得按 case、source、Candidate、模型答案、历史结果或 evaluator 切换。

## Challenge 与发布权限

- exact remove partition 只能定位 `S0` 内地址；exact add partition 只能定位 `S0` 外地址。每个 partition 必须有非空 source-grounded claim 和真实 source supporting IDs，但 Harness 不读取 claim 含义。
- neutral remove-audit partition 只授权 Finalizer 在一个最小、有界的 `S0` scope 内独立形成 exact remove subset，不是整段删除结论、不确定项收容器或 keep/remove 投票。每个 audit 最多 96 blocks，全部 audit 去重后最多 128 blocks；audit 与 exact remove、其他 audit 必须机械零重叠，避免把有限审查预算浪费在已经获得 exact delta 权限的地址上。
- Finalizer 只能提交 `Delta- subset S0 intersect REMOVE_ENVELOPE` 与 `Delta+ subset ADD_ENVELOPE`。未挑战地址机械保持 `S0`；最终集合唯一由 Harness 计算 `S=(S0-Delta-)+Delta+`。
- 全局 JSON/schema/source-address 失败必须 fail-closed。单个 partition 的方向、membership、重复、预算或 supporting-address 失败只拒绝该 partition；其他独立有效 partition 可继续。结果必须显式记录 `complete|partial|none|not_run` coverage 和逐 partition rejection trace，不能把 partial 冒充完整审查。
- 有效 envelope 为空且存在 rejected partition 时不调用 Finalizer，Candidate 原样保留并标记 degraded。任何 Finalizer provider、turn、schema、tool 或 envelope 越权失败同样保留 Candidate 并 degraded。

## 容量、输出与 trace

- Challenger 只允许一次正常停止的严格 JSON text response；默认禁止 thinking 和 tool call。Finalizer 只允许一次 `submit_final_selection` tool call；普通 auxiliary text 不参与语义、只记录字符数和 SHA-256，且 `forwarded=false`。
- 两个完整 source context 都必须在第一次 provider call 前做最坏输入容量预检。Finalizer preflight 覆盖完整 source、固定 Prompt/schema、Challenger 最大输出、Finalizer 最大输出和 safety reserve；model-facing challenge 只序列化 compact ranges、claims 与 supporting IDs，不展开内部 `target_block_ids`。
- trace 必须记录 packet/capability/input SHA、冻结 model/profile、Prompt SHA、实际调用数、usage、延迟、coverage、raw/normalized Challenger response、rejected partitions、Finalizer raw tool arguments、机械 decision 和失败类型。capability hash 不得包含 case、packet、Candidate ranges 或 evaluator 信息。

## Harness 边界

代码只负责 Pi Agent harness 和原子机械能力：packet/schema/SHA、完整 source 序列化、地址范围展开与压缩、集合 membership、partition 授权、容量/调用/超时预算、final delta 应用和 trace。

代码不得读取标题或正文含义，不得按关键词、行业、项目、case ID、source hash、历史结果、Candidate 表现或 evaluator 选择 keep/drop、Owner、audit scope、challenge、范围或修复方向；不得解释 `source_conclusion` / `audit_basis`，也不得从代码形成任何语义裁决。
