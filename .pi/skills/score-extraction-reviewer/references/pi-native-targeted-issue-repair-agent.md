# Pi-native Residual Issue Repair v10

复用冻结 single-prompt candidate 作为第一判断。Reviewer 像代码审查者一样只提交 `pass` 或显式 add/remove issue；Finalizer 只批准 challenge 的子集，Runtime 机械应用批准的增删。

```text
candidate
-> Call 1: Residual Issue Reviewer
   -> challenge(add_ranges, remove_ranges)
   -> Call 2: Residual Issue Finalizer
      -> approved_add_ranges / approved_remove_ranges
      -> Runtime 机械生成 final ranges
```

- 最多两次调用，无重试、投票、第三答案、逐 block ledger 或代码侧语义判断。
- accepted Prompt 只进入 provenance；worker 不接收 accepted 身份、历史输出或评测信息。
- Reviewer issue/evidence 作为不可信 code-review comment 进入 Finalizer，用于聚焦争议但不具备 source 权重；Finalizer 同时接收 exact challenge IDs 与完整 source。
- provider、schema、context、预算或 Finalizer degradation 均显式降级并保留 candidate。
- v9 的完整二稿 envelope 已证明会诱发虚假扩边；v10 保留强制对抗性假设，但只表达最小直接增删，并由 Finalizer 拒绝不成立的 challenge。模型不再重组完整 final ranges。
