# Pi-native v17 Single-Issue Candidate Protection

复用冻结 single-prompt candidate 作为第一判断。Reviewer 只能 pass 或打开一个最小 membership issue；Primary 整体批准或拒绝；只有 Primary 批准时才由独立 blind Release 对同一 exact issue 整体批准或拒绝。

```text
candidate
-> Call 1 Reviewer: pass | one include/exclude issue
-> Call 2 Primary: approve_change | reject_change | degraded
-> Call 3 Release: approve_change | reject_change | degraded
-> Runtime 机械应用同一 exact issue
```

- 最多三次调用，无 retry、第二 issue、部分批准、方向恢复、投票、best-of-N、逐 block ledger 或代码侧语义判断。
- accepted Prompt 只进入 provenance；worker 不接收 accepted 身份、历史输出或评测信息。
- provider、schema、context、预算、Primary/Release degradation 或任一角色越界均显式降级并保留 candidate。
- 代码只校验 action 与当前 membership、exact ranges、三角色 verdict、SHA、预算和 trace。
