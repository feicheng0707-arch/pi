# Candidate-S0 Runtime Contract

本文件只约束 Candidate-S0 Challenger/Finalizer 实验路线，并进入 capability hash。它不替代 active 三调用 Pi-native 路线，也不改变旧路线 identity。

## 固定执行序列

Harness 将成熟 Single-Prompt Candidate 的 exact block set 冻结为 `S0`。成功路径最多两次 provider call，失败路径可以提前终止：

1. 独立 Challenger 读取完整不可变 source、`S0`、由 Harness 对全部 `S0` blocks 做的扁平、无筛选、无语义机械 source projection，以及只列每个 run 地址、首尾和 singleton 状态的机械 run queue、机械地址授权和严格 tool schema，通过唯一结构化 tool 提交一次有界 challenge；
2. `S0` 非空或存在有效 add envelope 时，独立 Finalizer 再次读取完整不可变 source、`S0`、同一份只含机械地址/首尾/singleton 的 run queue 和有效 challenge envelope，并通过唯一 strict tool 同时提交 targeted sparse delta 与最多三十二个全局 hard-carrier root veto。只有 `S0` 为空且 Challenger 合法判空时才在一次调用后结束。Finalizer 不重复接收 `S0` 原文 projection；它只用完整 source、canonical `S0` ranges、机械 run queue 和 challenge 地址工作，避免无权限的 Candidate anchoring 与重复原文 token。

无 retry、第三次调用、投票、best-of-N、逐 block ledger、答案驱动路由或失败后换模型重跑。两个角色的 model/profile、Prompt、schema、容量与调用上限必须在第一次语义调用前冻结；不得按 case、source、Candidate、模型答案、历史结果或 evaluator 切换。

## Challenge 与发布权限

- exact remove partition 只能定位 `S0` 内且位于四类 hard carrier 之外的地址；exact add partition 只能定位 `S0` 外地址。所有 source-proven hard-root descendants 均由 Finalizer 的 typed veto 独占处理，Challenger 不提交 sentinel，也不得把它们放入任何 exact/audit partition。每个 partition 必须有非空 source-grounded claim 和最多 24 个最小充分、真实 source supporting IDs，但 Harness 不读取 claim 含义；不得用逐目标 supporting-ID ledger 消耗输出预算。
- neutral remove-audit partition 只授权 Finalizer 在一个有界 `S0` scope 内独立形成 exact remove subset，不是整段删除结论、不确定项收容器或 keep/remove 投票。`mixed_atomic_scope` 与 `recovery_boundary_scope` 各最多一项、各不超过 96 blocks，两条通道合计去重上限 192 blocks；前者只处理最小普通 mixed atomic/heading scope，后者必须覆盖由 earlier incorporation 建立的一个完整、连续 `later module intro→真实 peer exit` recovery boundary，不能互相占用。Harness 从 submitted ranges 自行机械展开、计数并校验预算，不要求模型重复提交可由代码确定的计数字段。audit 与 exact remove、其他 audit 必须机械零重叠，避免把有限审查预算浪费在已经获得 exact delta 权限的地址上。
- Finalizer 的普通 `Delta-` 只能落在 `S0 intersect REMOVE_ENVELOPE`，普通 `Delta+` 只能落在 `ADD_ENVELOPE`。此外，Finalizer 可独立提交四类 hard carrier 的 typed `carrier_type + inclusive root + exclusive exit/EOF + projected_s0_anchor_block_id`；root 可以位于 `S0` 外，但 anchor 必须属于 `S0` 且落在该 source-order span 内。Harness 只据此机械证明投影非空并形成 `V=S0 intersect [root,exit)`，不读取标题、正文、carrier 或 anchor 的语义真伪。
- hard-carrier veto 不是 envelope 外的通用删除权限。它只能表达公告/公告摘要、投标人或供应商须知与通用程序、投标/响应/报价格式模板、合同条款及格式四类 categorical root。价格、证明、救济、主体、heading 或普通 atom hole 仍必须来自 Challenger envelope。模型必须先完成全 source peer-exit 与 recovery sweep；代码不替模型完成这一步。
- 最终集合唯一由 Harness 计算 `S=(S0-Delta--V)+Delta+`。单个 root/exit/anchor 地址无效或投影为空时只拒绝该 effectless veto 并记录 trace；若仍有其他有效 delta/veto 可发布则标记 partial 并继续，全部 veto 均无效且无其他有效 effect 时 fail-closed。任一 add 地址落入有效 veto span、有效 veto spans 彼此重叠时仍属全局自相矛盾并 fail-closed。`Challenger exact/audit envelope-Delta-` 是 Finalizer 已审查后留下的 typed survivor；任何有效 veto 再覆盖这些 survivor 同样自相矛盾并 fail-closed。普通 `Delta-` 必须严格落在 Challenger remove envelope；root-only descendants 只能由 typed veto 删除，Finalizer 冗余枚举它们属于 contract failure。
- 全局 tool/top-level schema/source-address 失败必须 fail-closed。单个 partition 的 range syntax、方向、membership、重复、预算或 supporting-address 失败逐项记录 rejection trace；若至少一个其他 partition 有效，则只把有效 groups 交给 Finalizer并标记 `partial` coverage，不裁剪、解释或修补无效 partition。唯一例外是任一 submitted `recovery_boundary_scope` 被拒绝时整次 fail-closed，因为丢失该 typed boundary lock 后继续发布会改变其协议含义。所有 submitted partitions 均无效时不调用 Finalizer，Candidate 原样保留并 degraded。
- 有效 envelope 为空且不存在 rejected partition 时，非空 `S0` 仍进入一次独立 hard-carrier Finalizer；空 `S0` 才是一次调用的正常 no-change。任何 Challenger 或 Finalizer provider、turn、全局 schema/tool、全部 partitions 均无效、envelope 越权或 veto 自相矛盾都保留 Candidate 并 degraded；单个 partition 的机械越权仍按上一条执行 partial coverage。

## 容量、输出与 trace

- Challenger 与 Finalizer 都只允许一次强制 `submit_final_selection` strict tool call；默认禁止 thinking，且普通 auxiliary text 不参与语义。Finalizer auxiliary text 只记录字符数和 SHA-256，`forwarded=false`；Challenger 任何 auxiliary text 都是 contract failure。
- 两个完整 source context 都必须在第一次 provider call 前做最坏输入容量预检。Challenger preflight 必须计入 provider-visible strict tool schema；Finalizer preflight 覆盖完整 source、canonical `S0` ranges、同一份机械 run queue、固定 Prompt/schema、Challenger 最大输出、最多三十二个 veto、Finalizer 最大输出和 safety reserve。model-facing Finalizer challenge 序列化统一的 `remove_review_ranges` / `add_review_ranges`，并保留 typed `review_kind + target_ranges + untrusted_challenger_claim + supporting_block_ids` groups：`exact_remove_claim`、`mixed_atomic_scope`、`recovery_boundary_scope`、`exact_add_claim`。audit 另携带 Harness 从 ranges 机械计算的 block count。Harness 只做地址存在性、去重与 canonical 数值排序，然后序列化这些诊断和 source 地址；不摘要、不解释、不按语义排序、不生成修复方向，也不转发内部 `target_block_ids`。Finalizer 必须把 claim 当待证伪问题而非证据、票数或删除结论，并以最大紧凑 ranges 与最少不重叠 roots 提交 terminal tool output。
- trace 必须记录 packet/capability/input SHA、冻结 model/profile、Prompt SHA、实际调用数、usage、延迟、coverage、raw/normalized Challenger response、rejected partitions、Finalizer raw tool arguments、canonical veto、challenge remove 与 veto remove 的分离集合、最终机械 decision 和失败类型。canonical veto 原样保留 exclusive block ID 或字符串 `"EOF"` 及 submitted S0 anchor，不得另造第二种 EOF sentinel。capability hash 不得包含 case、packet、Candidate ranges 或 evaluator 信息。

## Harness 边界

代码只负责 Pi Agent harness 和原子机械能力：packet/schema/SHA、完整 source 序列化、供 Challenger 使用的全部 `S0` blocks 扁平无筛选 source projection、只含地址/首尾/singleton 的完整 run queue、地址范围展开与压缩、source-order root span、集合 membership、partition/veto 地址授权、容量/调用/超时预算、final delta 应用和 trace。

代码不得读取标题或正文含义，不得按关键词、行业、项目、case ID、source hash、历史结果、Candidate 表现或 evaluator 选择 keep/drop、Owner、carrier type、root/exit、audit scope、challenge、范围或修复方向；不得依据 Candidate 地址位置自动授予普通增删范围。代码可机械列出完整 Candidate runs、地址与 block count 供模型导航和预算核对，但不得解释 `source_conclusion` / `audit_basis`，也不得从这些元数据形成语义裁决。
