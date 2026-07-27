# Pi-native Source-blind Residual Review v8

成熟 single-prompt 输出仍是受保护的第一份判断，但 Call 1 不接收该输出、accepted Prompt、历史 trace 或评测信息。它只基于完整不可变 source，按一套更严格且独立的通用语义合同提交完整 proposal。

```text
冻结 single-prompt candidate
-> Call 1: source-only Blind Residual Challenger
   -> 完整 proposal 与 candidate 同集合: 一次调用发布 candidate
   -> 完整 proposal 与 candidate 不同: Runtime 机械计算 exact delta
      -> Call 2: claim-free Binary Adjudicator
         -> accept_candidate: 发布 candidate
         -> accept_proposal: 发布 exact proposal
         -> degraded/failure: 降级并发布 candidate
```

- 最多两次语义调用，无重试、投票、第三答案、ledger 或代码侧 keep/drop。
- Call 1 不继承 accepted Prompt，避免复制其 container-first common mode。
- Call 1 的 source representation 不暴露 Runtime 推断的 `Q` 序列；原始标题、父子、表格、Word 编号和文本 marker 只作为机械阅读事实。
- Call 2 只接收 candidate、proposal、exact added/removed delta 和完整 source；Challenger claim 与 evidence leads 不进入其上下文。
- Runtime 只负责不可变 packet/SHA、schema、canonical ranges、机械集合比较、delta、预算、失败闭合和 trace。
- expected、case ID、历史答案、其他 Agent 输出和评测结果不得进入任一模型上下文。
- v6.3 与 v7 保留为失败实验基线，不与 v8 的 Prompt、context format 或 capability hash 混用。
