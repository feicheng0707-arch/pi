# Pi-native Untrusted-candidate Targeted Repair v9

成熟 single-prompt 输出仍是受保护的产品 candidate，但 Call 1 不知道其 accepted 身份，只把它当作待攻击的外部 patch。Call 1 不生成第二份必须整套接受的答案，而是提交一个 bounded challenge envelope；Call 2 可在该 envelope 内逐块接受或拒绝挑战并发布最终 ranges。

```text
冻结 candidate
-> Call 1: Residual Issue Reviewer
   -> candidate 作为 untrusted patch
   -> proposal_ranges 仅定义疑似遗漏/污染 envelope
   -> 必须打开至少一个 bounded falsification delta
   -> same-set/contract failure: 一次调用降级并保留 candidate
   -> contract-valid delta: Runtime 机械计算 Set A only / Set B only
      -> Call 2: Targeted Repair Finalizer
         -> 在 envelope 内发布 candidate、完整 envelope 或部分 repair
         -> degraded/failure: 降级并发布 candidate
```

- 最多两次语义调用，无重试、投票、第三个开放答案、ledger 或代码侧 keep/drop。
- Call 1 接收 candidate，但不接收 accepted Prompt、accepted 身份、历史 trace 或评测信息。
- Call 2 不接收 Reviewer claim/evidence leads，只接收 candidate、challenge envelope、机械差集和完整 source。
- 两边共同选择的 blocks 被机械锁定；Finalizer 只能在 Reviewer 打开的 added/removed envelope 内改变 candidate。
- Runtime 只负责不可变 packet/SHA、schema、canonical ranges、集合/envelope 校验、预算、失败闭合和 trace。
- expected、case ID、历史答案、其他 Agent 输出和评测结果不得进入任一模型上下文。
- v6.3、v7、v8 保留为失败实验基线，不与 v9 的 Prompt、context 或 capability hash 混用。
