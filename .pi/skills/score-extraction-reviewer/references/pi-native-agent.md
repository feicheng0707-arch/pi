# Pi-native Candidate-protected Independent Proposal Review v6.3

上游 accepted single-prompt 的 `initialRanges` 是第一份语义判断，也是必须优先保护的产品资产。为避免 Reviewer 被 candidate 锚定，Pi capability 只增加一次 candidate-blind 的独立全源判断；它不重新运行 Primary，也不能单独覆盖 candidate。

## 共享冻结合同

本段之后注入的 `accepted-score-candidate-v019.txt` 是 Reviewer 与 Adjudicator 的共同业务合同。沿用其中 `<task>`、`<method>` 和语义类 `<final_check>`，尤其是文件角色、`owner_section`、有效技术/服务评价方向和最小完整容器。角色 Prompt 只能增加独立审查或二选一职责，不能缩窄任务、把完整评价容器退化成逐叶裁剪，也不能把 candidate 的 accepted 身份当作正确性证据。

原 Prompt 的 `<input>` 占位符和 `<output_contract>` 只属于旧 single-prompt 接口。当前角色只使用运行时提供的不可变 evidence packet，并且只能调用各自唯一的 terminal tool。

## 固定拓扑

```text
冻结 single-prompt candidate
-> Call 1：candidate-blind Independent Reviewer
   输入：完整 source + candidate-neutral mechanical topology
   -> provider/schema/context/runtime failure：原样发布 candidate，并记录 degraded
   -> proposal：提交唯一完整独立 proposal
      -> 与 candidate 同集合：机械归一化并原样发布 candidate
      -> Runtime 机械计算 exact added/removed delta
      -> 与 candidate 不同：Call 2 Independent Delta Adjudicator
         -> accept_candidate：原样发布 candidate
         -> accept_proposal：原样发布 Reviewer proposal
         -> degraded：原样发布 candidate，并记录 degraded
```

- Reviewer 固定一次；只要 contract-valid proposal 与 candidate 不同，就固定调用一次 Adjudicator。没有第三次调用、隐藏重试或 best-of-N。
- Reviewer 看不到 `initialRanges`、candidate block IDs、C/N 标记、candidate audit、source name、review context 或任何历史输出。它必须按共享冻结合同直接从完整 source 提交一份唯一、完整、source-grounded proposal。
- `proposal` 必须提交唯一、完整的 `proposal_ranges`，允许空集合；同时提交一个短 `proposal_claim` 和少量 `evidence_block_ids`。Runtime 只按 candidate 与 proposal 的 block 集合机械计算 added/removed delta，不生成语义 defect 或修复方向。
- Adjudicator 只裁决这一份精确 delta。它只能 `accept_candidate`、`accept_proposal` 或 `degraded`，不得生成、拼接、修复或建议第三套 ranges。
- 只有 Reviewer 提出 contract-valid 的不同 proposal，且 Adjudicator 接受完全相同的 proposal，才能修改 candidate。这是唯一的 two-key override。
- Reviewer 没有语义 `degraded` 分支。若 Reviewer proposal 的规范化 block 集合与 candidate 完全相同，Runtime 只做集合等价归一化，将其记录为 `reviewerSameProposalNormalized` 并按一次调用的 candidate preservation 发布；不得启动 Adjudicator。
- Reviewer、Adjudicator、provider、capacity、schema、地址、预算或 terminal contract 的任何失败，都静态保留 candidate，并以 `status: degraded` 显式暴露；不得把降级包装成 Reviewer 成功。
- Candidate 为空或 Locator 为 null 时仍执行同一审查，不得因空输入直接跳过；空 candidate 同样受 two-key override 保护。

## Harness 与语义边界

- 完整 source、结构事实和 canonical block/range 地址在第一次调用前形成一份不可变 candidate-neutral context；candidate 只进入可能发生的 Adjudicator user contract。中性 source context hash、字符数以及实际 Reviewer/Adjudicator input hash 都进入 trace。不得读取 expected、历史答案、其他 Agent 输出或 case 身份。
- 每个 source block 同时明示唯一映射：`id=N` 只用于 `evidence_block_ids`，`range=段落N` 只用于 `proposal_ranges`。正文中的章节号、条目号和自然语言数字只是 source 内容，不能换算为地址。
- Extension 只负责 Pi Agent loop 的薄适配：prompt 组合、packet/SHA、上下文容量预检、调用上限、schema、strict ranges、机械 delta、evidence ID 校验、trace 和降级发布。
- Reviewer 与 Adjudicator 使用同一份 candidate-neutral source context，其中只可暴露原始父子、表格、编号序列和无歧义字面 cross-reference。只有 Adjudicator user contract 额外携带 candidate、proposal 和机械 delta；结构事实都不是目标标签，也不自动扩张或删除任何 range。
- Runtime 不再要求 same-proposal 覆盖一个 candidate-derived audit frontier。Reviewer 只需提交少量非空 source evidence；代码只校验地址存在与唯一性。
- 不做逐 block ledger、业务关键词 probe、case-specific 路由、离线语义修复或自由读搜 loop。

## 产品验收

验收对象是相对冻结 candidate 的净提升，而不是 Reviewer 独立答案单独看起来是否合理。必须同时统计 `wrong→correct`、`correct→wrong`、净 case 提升、最终 exact match、candidate preservation、`status: degraded`、调用次数、token 和延迟。Protected-correct regression 必须无回退；泛化结论只能来自实现冻结后的新 sealed holdout。
