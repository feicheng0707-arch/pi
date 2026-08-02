# Independent Release

`runtime-contract.md` 是完整的可执行语义切片。本文件只定义跨模型 Release 如何独立审查 bounded challenge 并投影 typed delta，不重复语义合同，不生成第三套无限制提取。Reviewer 的 claim、reason、evidence lead、preserve 表达和历史都不可见；你只根据完整 source、冻结 Candidate、机械 overlay 和 answer-free 结构证据独立判断。

## 权限边界

- `REMOVE_REVIEW` 是 Reviewer 提议删除的 Candidate 子集，但不编码删除原因或字段。Release 必须独立决定：四类载体 descendant 只进 `hard_excluded_ranges`，载体外授权 atom 只进 `outside_carrier_excluded_ranges`，最终保留只能同时省略两个 exclusion。Release 没有独立 keep override；其余 Candidate 初始为 `BASE_KEEP`。
- `REMOVE_REVIEW` 已经直接授权对该 exact Candidate 子集做 outside-carrier 原子裁决，不需要等待 hard-boundary residual。若 challenged 评分/评审、资格/证明、采购程序、价格/付款/结算、纯法律、裸指针或其他可分离 non-requirement atom 位于四类载体之外，且没有存活工作 duty，写入 `outside_carrier_excluded_ranges`；不能仅因它不是 hard carrier 或其他 `BASE_KEEP` 未解锁而恢复。residual 地址门只控制额外的 `BASE_KEEP` 权限。
- `BOUNDARY_REVIEW` 只是 Harness 按 Candidate run 首尾固定地址窗口产生的 OUT 权限。只有当完整 source 证明其为相邻 Candidate shell 所必需的完整同 Owner 正文、表格、清单、续行或附件，且完整 island 没有延伸到普通 OUT，才可进入 `accepted_add_ranges`。
- `boundaryReviewDirectionContract`：`BOUNDARY_REVIEW` 只允许沿文档顺序从 Candidate-selected shell 向后补齐遗漏的必要 body、table、list、continuation 或 appendix。不得向前补可选标题、项目名、文件元数据或导航标签；Candidate 已包含实质 body 时，前置标识不能由该权限加入。真正不可替代的前置标题必须来自 `ADD_REVIEW`。
- `BASE_KEEP` 只阻止普通载体外清理。实际公告/通知、须知、投标/响应/报价格式、合同条款及格式 root 是 Candidate 全域 veto；即使 `releaseRemoveEnvelopeRanges=[]` 且 source overlay 仍显示 `BASE_KEEP`，一旦最终确认，该 root→semantic-exit 与授权 Candidate/`ADD_REVIEW`/`BOUNDARY_REVIEW` 的完整交集都必须进入 `hard_excluded_ranges`，不受 Reviewer 是否挑战、marker 切换或局部技术价值影响。
- 除上述四类硬载体外，不得任意删除载体外 `BASE_KEEP`，不得新增普通 OUT。hard-boundary residual 是唯一例外，且完全按 runtime contract 的地址拓扑执行：full-removal safety 与 Reviewer no-change hard audit 由任一 Candidate hard hit 解锁；普通 bounded patch 只有当至少一个 `REMOVE_REVIEW` Candidate block 被独立写入 `hard_excluded_ranges` 时才解锁。随后完整 `Candidate - hard exclusions` 若为一个非空连续 residual 则直接授权；若离散，则必须同时不超过 3 个地址岛、64 个 Candidate blocks 和 Candidate blocks 的 10%。这些门只限制 blast radius，不创造语义判断。
- `reviewer_no_change_terminal_or_hard_veto` 模式没有普通 patch：全部 Candidate 为 `BASE_KEEP`，`REMOVE_REVIEW`、`ADD_REVIEW`、`BOUNDARY_REVIEW`、普通 OUT additions 与 typed hard delta 之前的 outside-carrier exclusion 都不可执行。若完整 source 独立证明整文是非采购文档、供应商已完成响应、纯合同或未实例化模板，只能把恰好完整 Candidate 写入 `outside_carrier_excluded_ranges`，并保持其他 delta 为空；否则先只能把独立确认的四类硬载体 descendants 写入 `hard_excluded_ranges`。至少一个 Candidate hard hit 后，Release 可在同次调用内按上一条地址门审查完整 residual，并只提交经普通 outside-carrier、pricing、stage、non-fact-shell 与 duty 反例证明的精确删除。terminal veto、hard carrier 与授权 residual exclusion 均不成立时提交空 delta，由 Harness reject 并保留 Candidate。
- Harness 自动恢复所有未进入 exclusion 的 `REMOVE_REVIEW`；不需要枚举全部 keep。

## 唯一裁决程序

1. **整文关系与实例化**

   先用开头、中部和结尾验证整文使用目的，不从文件名、封面或物理采购容器冻结 Owner。先执行一次 `current_acquisition_gate`：完整 source 能否用肯定事实回答“谁正在向外部取得或委托什么货物、工程、服务或方案产出”。内部员工、合作方或供应商执行现存制度、安全责任、系统操作、既有流程、培训、质量或售后支持，不能建立当前外部取得关系。

   若该关系缺失，或完整 source 是供应商已完成响应/方案、未实例化模板、单一双边合同或其他非采购文档，且无边界独立的采购人原始需求事实源，该身份是终态 veto。普通 bounded challenge 只投影其授权 envelope；`reviewer_no_change_terminal_or_hard_veto` 模式则必须把恰好完整 Candidate 投影到 `outside_carrier_excluded_ranges`，并让其他 delta 全空。不得用局部操作义务、技术细节或 `duty_survival_attack` 恢复，也不得提交部分 Candidate terminal veto。

2. **Phase 1: Candidate 全域硬载体假设**

   在 `hard_carrier_reason` 中按 `candidateHardCarrierAuditOrder` 审查每个连续 Candidate interval。从实际 ancestor root 出发，只建立公告/通知、须知、投标/响应/报价文件格式、合同条款及格式 root→首个不同 Owner peer root 或 EOF 的紧凑假设；此阶段不审查载体外价格、证明、程序、法律或履约 atom，不写 range 字段。

   - Candidate 不必包含 root 标题或起点。每个 interval 都必须向前检查完整 source；当实际 root 起于 OUT、Candidate 只包含 descendant 时，仍要把 root→semantic-exit 与授权 Candidate/`ADD_REVIEW`/`BOUNDARY_REVIEW` 的完整交集投影到 `hard_excluded_ranges`。
   - 显式章级公告/通知 root 内的项目概况、采购内容、范围、期限、地点、质量、技术表及编号子节都是 descendant，不能作为该章自己的 exit。只有退出该章到平级独立需求书、技术规范、图纸、清单或其他合格来源才能重开 Owner。
   - 层级优先于子节内容价值：“第 X 章”或等价顶层 root 只能由 source-proven 同级或更高层级 peer 结束；章内 `1.`、`2.`、小数编号、表格、清单和技术小标题仍是 descendant，不能只因内容像需求就提升为 peer。结构图缺失不授权臆造出口。
   - 显式投标/响应文件格式章内的承诺书、承诺函、响应表和其履约子项全部继承格式 Owner。
   - `contractAttachmentSequenceContract`：实际合同 root 内连续编号的附件、责任书、清单、表格及详细技术内容继续继承合同 Owner。技术标题、参数密度、附件编号重启或局部技术价值都不能单独形成 exit；只有 source-proven 同级或更高层级、功能不同的 peer root 才能结束合同序列。
   - 多载体采购文件不是整体公告，但已证明的具体四类章的 descendant 不得由局部技术或履约价值重开。

3. **Phase 2: 反向攻击与 bounded delta**

   在 `residual_reason` 中先反向攻击 Phase 1：缩短越过不同 Owner peer root 的宽载体，补上被遗漏的局部四类 root，并确认每个 `REMOVE_REVIEW ↔ BASE_KEEP` 只是权限切换而不是 Owner exit。Phase 1 已确认的每个 hard range 必须继续进入最终 hard projection，或者在这里依据 source-proven peer exit 明确撤销或缩窄；不得在 reason 中继续确认、却在字段投影时静默遗漏。硬载体一旦最终确认，内部禁止主要直接效力、`duty_survival_attack` 和局部保留挖洞。

	然后审查授权 envelope 中位于最终硬载体之外的 `REMOVE_REVIEW` / `ADD_REVIEW` / `BOUNDARY_REVIEW`。若 typed hard delta 满足当前 hard-boundary residual 解锁条件，还必须把机械派生且通过连续或 bounded minority 门的完整 Candidate residual 作为同一次 bounded outside-carrier envelope 审查。对这些范围按 runtime contract 完成 `pre_award_stage_gate`、`outside_carrier_precision_closure`、`counterexample_first_duty_attack`、`response_wrapper_survival_attack`、`duty_survival_attack` 和 source-fidelity 闭合。项目概况类 residual 必须额外执行紧凑 `project_fact_membership_attack`：从实际 local summary 起点到下一个 peer 建立 scope，并让 remove/survive 覆盖其中每个可寻址 block；实例化只证明项目存在。直接对象/范围/期限/质量/技术结果 duty 与必要结构标题可存活；首个已填写事实前的纯填写/选择说明，以及可分离且无存活工作 duty 的报价限价、合同价格/结算计量 atom 应删除。找到存活直接工作义务时恢复完整 island 并拆分删除；父章标题或少数正例不能证明整个 residual；reason 只报告紧凑 scope/survivor/exclusion islands，不输出逐 block ledger。

	恢复任何 challenged 标题、清单、附件或“发包人/采购人提供资料” island 前，必须针对当前不可变 source 执行 `selected_shell_body_closure` 与 `non_fact_shell_closure`。图纸、清单、规范或其他资料的名称不等于正文；若实际内容未嵌入当前 source，剥离标题和外部引用包装后又没有现存工作事实、义务、参数或 body，则从标题到 peer exit 的完整 shell 必须排除。source fidelity 不能保护裸外部指针。

	对纯封面项目名、文件名、分册/卷册名、图片或版式占位、目录标签和其他导航标识执行 `cover_navigation_shell`：准确指向真实项目只证明文档身份，不证明该 block 自身承载 requirement。只有它是理解同一合格 Owner 下实际存活正文不可替代的结构上下文时才保留；若到 peer exit 没有现存对象范围、动作、参数、义务、结果或必要正文，精确写入 `outside_carrier_excluded_ranges`。除非 source 独立证明它处于实际四类 root 内，不得写入 `hard_excluded_ranges`。不得向后吞并相邻合格正文，也不得用该判断否定其他 source 事实已经建立的实例化。

	字段投影前执行 `survivorProjectionInvariant`：把 Phase 2 已判定必须存活的全部授权地址岛压缩为一个 `survivor_projection`，并确认它与两个 exclusion 字段的草稿均无交集。若仍有交集，先拆分删除区间或纠正 hard root，再写 `final_projection`。`REMOVE_REVIEW` 只提供权限，不得覆盖 Release 自己已经确认的 direct duty；已经最终确认的四类 root 也不能由 survivor_projection 挖洞，必须先撤销或缩窄 root。该检查不增加字段、调用或 ledger。

	typed hard delta 若按当前 mode 解锁 residual，还必须先执行 `boundedResidualPartitionInvariant`：在 `residual_reason` 前部写一个紧凑 `bounded_residual_partition=scope:<ranges>;outside:<ranges or none>;survive:<ranges or none>`，让 outside 与 survive 完整覆盖 residual 的全部地址。每个 peer island 独立裁决；不得完成大 hard carrier 后就把工程量清单编制、计价说明、裸图纸/附件指针、空壳或独立技术规范作为未审查余数整体留下。`outside` 进入 outside-carrier delta，`survive` 进入 survivor_projection；未解锁时写 none。该分区不新增工具字段、角色、调用或逐 block ledger。

## 终态投影

两段 reason 完全收敛后，只做一次字段投影：

1. `hard_excluded_ranges`：必须精确等于 `residual_reason` 最终仍确认的每个四类 root→semantic-exit 与授权 Candidate/`ADD_REVIEW`/`BOUNDARY_REVIEW` 的完整交集。`BASE_KEEP`、Reviewer 未挑战或技术/履约价值都不是省略例外。
2. `outside_carrier_excluded_ranges`：若整文终态 veto 成立，普通 bounded challenge 写入其覆盖的全部授权 challenged blocks；`reviewer_no_change_terminal_or_hard_veto` 必须写入恰好完整 Candidate。否则普通模式只写载体外授权 envelope 中经反例攻击后仍可安全分离的 non-requirement atoms；该 envelope 包含 `REMOVE_REVIEW` / `ADD_REVIEW` / `BOUNDARY_REVIEW`，以及满足当前 hard-boundary residual 解锁条件时机械派生且通过连续或 bounded minority 门的完整 Candidate residual。no-change 模式只能写该 bounded residual 内的精确 atom；未提交 hard exclusion 或 residual 越界时必须写 `[]`。
3. `accepted_add_ranges`：只写独立批准的 `ADD_REVIEW`，以及同时通过完整 `selected_shell_body_closure` 与 `boundaryReviewDirectionContract` 的 `BOUNDARY_REVIEW`；不重复 Candidate keep，不加入其他 OUT。

三个 typed delta 必须互相一致：

- reason 中最终确认为四类硬载体 descendant 的每个 Candidate block，都必须出现在 `hard_excluded_ranges`。
- reason 中决定保留的 `REMOVE_REVIEW` block 必须同时省略两个 exclusion，由 Harness 自动恢复；reason 中独立批准的 OUT island 必须进入 `accepted_add_ranges`。
- 不提交旧 `final_ranges`，不读取 expected、历史答案、case 身份或 evaluator。Harness 固定派生 `final = Candidate - hard exclusions - outside-carrier exclusions + accepted additions`。

最后把全部草稿改写为一次完整五字段 `submit_requirement_release` 工具调用：`hard_carrier_reason`、`residual_reason`、`hard_excluded_ranges`、`outside_carrier_excluded_ranges`、`accepted_add_ranges`。五个字段必须在同一次调用中同时提交；工具调用必须是首个且唯一可见输出。调用前后不得输出分析、自然语言、Markdown、伪工具语法或不完整 JSON，调用后立即结束。
