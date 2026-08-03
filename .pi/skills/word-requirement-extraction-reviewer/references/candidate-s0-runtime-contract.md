# Candidate-S0 Runtime Contract

本文件只约束 Candidate-S0 Challenger/Finalizer 实验路线，并进入 capability hash。它不替代 active 三调用 Pi-native 路线，也不改变旧路线 identity。

## 固定执行序列

Harness 将成熟 Single-Prompt Candidate 的 exact block set 冻结为 `S0`。成功路径最多两次 provider call，失败路径可以提前终止：

1. 独立 Challenger 读取完整不可变 source、`S0`、机械地址授权和严格 tool schema，通过唯一结构化 tool 提交一次有界 challenge；
2. `S0` 非空或存在有效 add envelope 时，独立 Finalizer 再次读取完整不可变 source、`S0` 和有效 challenge envelope，并通过唯一 strict tool 同时提交 targeted sparse delta 与最多三十二个全局 hard-carrier root veto。只有 `S0` 为空且 Challenger 合法判空时才在一次调用后结束。

无 retry、第三次调用、投票、best-of-N、逐 block ledger、答案驱动路由或失败后换模型重跑。两个角色的 model/profile、Prompt、schema、容量与调用上限必须在第一次语义调用前冻结；不得按 case、source、Candidate、模型答案、历史结果或 evaluator 切换。

## Challenge 与发布权限

- exact remove partition 只能定位 `S0` 内地址；exact add partition 只能定位 `S0` 外地址。每个 partition 必须有非空 source-grounded claim 和真实 source supporting IDs，但 Harness 不读取 claim 含义。
- neutral remove-audit partition 只授权 Finalizer 在一个最小、有界的 `S0` scope 内独立形成 exact remove subset，不是整段删除结论、不确定项收容器或 keep/remove 投票。每个 audit 最多 96 blocks，全部 audit 去重后最多 128 blocks；audit 与 exact remove、其他 audit 必须机械零重叠，避免把有限审查预算浪费在已经获得 exact delta 权限的地址上。
- Finalizer 的普通 `Delta-` 只能落在 `S0 intersect REMOVE_ENVELOPE`，普通 `Delta+` 只能落在 `ADD_ENVELOPE`。此外，Finalizer 可独立提交四类 hard carrier 的 typed `carrier_type + inclusive root + exclusive exit/EOF`；root 可以位于 `S0` 外，Harness 只按 source order 机械形成非空 `V=S0 intersect [root,exit)`，不读取标题、正文或 carrier 真伪。
- hard-carrier veto 不是 envelope 外的通用删除权限。它只能表达公告/公告摘要、投标人或供应商须知与通用程序、投标/响应/报价格式模板、合同条款及格式四类 categorical root。价格、证明、救济、主体、heading 或普通 atom hole 仍必须来自 Challenger envelope。模型必须先完成全 source peer-exit 与 recovery sweep；代码不替模型完成这一步。
- 最终集合唯一由 Harness 计算 `S=(S0-Delta--V)+Delta+`。任一 add 地址落入已提交 veto span、veto spans 彼此重叠、root/exit 不满足 source order、投影为空或地址不存在时整个 Finalizer fail-closed。`REMOVE_ENVELOPE-Delta-` 是 Finalizer 已审查后留下的 typed survivor；任何 veto 再覆盖这些 survivor同样自相矛盾并 fail-closed。
- 全局 tool/schema/source-address 失败必须 fail-closed。单个 partition 的方向、membership、重复、预算或 supporting-address 失败仍须逐项记录 rejection trace；但只要存在任一 rejected partition，整个 run 不调用 Finalizer，Candidate 原样保留并标记 degraded。partial coverage 不具备发布权限。
- 有效 envelope 为空且不存在 rejected partition 时，非空 `S0` 仍进入一次独立 hard-carrier Finalizer；空 `S0` 才是一次调用的正常 no-change。任何 Challenger 或 Finalizer provider、turn、schema、tool、partition 授权、envelope 越权或 veto 自相矛盾都保留 Candidate 并 degraded。

## 容量、输出与 trace

- Challenger 与 Finalizer 都只允许一次强制 `submit_final_selection` strict tool call；默认禁止 thinking，且普通 auxiliary text 不参与语义。Finalizer auxiliary text 只记录字符数和 SHA-256，`forwarded=false`；Challenger 任何 auxiliary text 都是 contract failure。
- 两个完整 source context 都必须在第一次 provider call 前做最坏输入容量预检。Challenger preflight 必须计入 provider-visible strict tool schema；Finalizer preflight 覆盖完整 source、固定 Prompt/schema、Challenger 最大输出、最多三十二个 veto、Finalizer 最大输出和 safety reserve。model-facing Finalizer challenge 序列化统一的 neutral `remove_review_ranges` / `add_review_ranges`，并保留不带类型与结论的中性 range groups，避免把多个独立审查范围压成一个错误的宽闭包；不传 Challenger conclusions、audit basis、supporting IDs、exact/audit kind 或内部 `target_block_ids`。原始分类只留 trace。
- trace 必须记录 packet/capability/input SHA、冻结 model/profile、Prompt SHA、实际调用数、usage、延迟、coverage、raw/normalized Challenger response、rejected partitions、Finalizer raw tool arguments、canonical veto、challenge remove 与 veto remove 的分离集合、最终机械 decision 和失败类型。canonical veto 原样保留 exclusive block ID 或字符串 `"EOF"`，不得另造第二种 EOF sentinel。capability hash 不得包含 case、packet、Candidate ranges 或 evaluator 信息。

## Harness 边界

代码只负责 Pi Agent harness 和原子机械能力：packet/schema/SHA、完整 source 序列化、地址范围展开与压缩、source-order root span、集合 membership、partition/veto 地址授权、容量/调用/超时预算、final delta 应用和 trace。

代码不得读取标题或正文含义，不得按关键词、行业、项目、case ID、source hash、历史结果、Candidate 表现或 evaluator 选择 keep/drop、Owner、carrier type、root/exit、audit scope、challenge、范围或修复方向；不得解释 `source_conclusion` / `audit_basis`，也不得从代码形成任何语义裁决。
