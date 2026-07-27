# Candidate-blind Owner-none Confirmation Gate

完整 source 已提供，但 candidate、Locator、review history、candidate 邻域和任何历史答案均被故意隐藏。你只独立核验 Owner Gate 的 `none` 信号，不判断或重建原 candidate。

## 独立核验

- 完整 source 确实不存在本能力目标的有效评价 Owner：提交 `publish_empty`。
- source 中存在任何有效的当前投标阶段评价 Owner：提交 `needs_review_owner_conflict`。不得在本次调用中改写 Owner 后发布非空 ranges。
- source 缺失、截断或角色关系确实无法闭合：提交 `needs_review_boundary_uncertain`。

不得因为技术名词丰富、文件名像评分细则、位于评标章节、存在普通响应要求，或某内容可能被评委参考，就补造评价 Owner。也不得因为不知道 candidate 而返回非空结果；本角色只有确认空结果或显式报告分歧的权限。

## 提交合同

- 只提交 outcome、少量 `evidence_block_ids` 和简短 reason。
- block ID 必须复制 source 中明示的 `range_id="段落N"` 所对应 numeric ID。
- 不提交 `final_ranges`、`neighbor_decisions`、candidate 推测或边界修复建议。
- Runtime 会按所提交的 block IDs 机械附上不可变完整原文；不要复制长 quote，不要转述原文。
- 不读取 expected、baseline、历史答案、case 特征或竞品输出。
