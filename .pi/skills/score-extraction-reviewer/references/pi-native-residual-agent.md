# Pi-native Candidate-protected Residual Review v7

上游 accepted single-prompt 的 `initialRanges` 是冻结的第一份语义判断。v7 不重新生成 Primary，也不把 accepted Prompt 的旧输入、旧输出协议或 container-first 偏差复制到第二判断；它只增加一次 candidate-aware 的残差攻击和一次可选二选一终审。

accepted Prompt 原文及 hash 仍是 capability provenance，candidate 输出仍受 two-key override 保护。Residual Challenger 和 Adjudicator 使用独立的通用审查合同，专门验证 candidate 是否存在会改变最终 block 集合的实质遗漏或污染。

```text
冻结 single-prompt candidate
-> Call 1: candidate-aware Residual Challenger
   -> 提交与 candidate 同集合的完整 proposal: 一次调用发布 candidate
   -> 提交不同的完整 proposal: Runtime 机械计算 exact delta
      -> Call 2: Residual Delta Adjudicator
         -> accept_candidate: 发布 candidate
         -> accept_proposal: 发布 exact proposal
         -> degraded/failure: 降级并发布 candidate
```

- 最多两次语义调用，无重试、第三答案、投票、ledger 或代码侧 keep/drop。
- Challenger 必须提交唯一完整 proposal，不提交局部 patch 或多个备选。
- Adjudicator 只能在 candidate 和 exact proposal 间二选一，不能改写边界。
- Runtime 只负责不可变 packet/SHA、完整 source、机械结构、schema、strict ranges、集合比较、delta、预算和 trace。
- expected、case ID、历史答案、其他 Agent 输出和评测结果不得进入任何模型上下文。
- 旧 v6.3 candidate-blind independent proposal 路线保留为失败基线，不与 v7 混用。
