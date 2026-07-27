# Pi-native Candidate-protected Owner/Boundary v5

这条路线只处理成熟 single-prompt candidate 的残余错误，不重新生成 Primary。随后注入的 `accepted-score-candidate-v019.txt` 是共享语义合同；角色只能增加正交审查职责，不能重定义目标。

## 固定流程

```text
冻结 candidate 与完整 source
-> candidate-blind Owner Gate：只判断有效评价 Owner，不输出 ranges
-> 独立 Final Boundary Gate：按 Owner 模式隔离上下文并发布唯一终态
-> 最多两次模型调用，无重试、无第三稿
```

- Owner Gate 看不到 candidate、Locator 结果、历史审查或 expected，避免先被范围锚定。
- Owner 为 `positive` 时，Boundary Gate 看完整 source、冻结 candidate、Owner typed claim 和 candidate 邻域阅读焦点，但看不到 Owner 的自由文本理由，也收不到任何 Owner 范围建议。
- Owner 为 `none` 时，第二个 Gate 同样 candidate-blind，不接收 candidate、Locator、review history、邻域焦点或邻块列表；它只能独立确认空结果或显式报告 Owner conflict / source uncertainty。
- 正向路径的 `boundaryFocusRanges` 只是 candidate 及其直接邻接块的阅读优先级，不限制最终范围。Boundary 必须同时审查全文中的远端遗漏、多个评价容器和 cross-reference。
- 正向 Boundary 必须对每个 candidate 连续范围两端真实存在的直接邻块提交一条常量级 `neighbor_decisions`，强制核对 edge hole；这不是全文逐 block ledger，代码只校验邻块地址覆盖、提交结果自洽以及 evidence block IDs 存在。
- Boundary 只提交少量 evidence block IDs；Extension 按 ID 机械附上不可变完整原文，避免模型抄写长 quote 造成协议失败。
- Owner claim 是待独立核验的审查信号，不是答案。Boundary 若与 Owner Gate 冲突，返回 `needs_review`；不得由代码或同一次提交暗中选择一方。
- Candidate 是强先验，不是答案。只有 source 中肯定的遗漏或边界证据才能修改；范围更短、措辞更像要求、局部未重复分值或编号跳号都不是充分边界。

## 运行边界

- 每个 block 的唯一输出地址是明示的 `range_id="段落N"`；正文编号只是 source 内容。
- 不读取 expected、baseline、竞品输出、历史答案、case 特征或评测结果。
- 不做逐 block ledger、关键词 probe、随机重跑、隐藏 schema retry 或预算外调用。
- Extension 只负责不可变 packet/SHA、模式隔离、上下文呈现、schema、证据 ID 到原文的机械映射、合法 ranges、预算、超时和 trace。Owner、keep/drop、边界与最终范围全部由 LLM 判断。
- 任何项目、行业、采购类型和内容格式都使用同一 Owner、评价对象、评价效果和肯定边界原则；格式差异只能由上游机械适配器转成统一 source blocks。
