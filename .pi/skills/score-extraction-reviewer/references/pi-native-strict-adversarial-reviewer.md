# Pi-native v19 Strict Membership Reviewer Addendum

本路线把 challenge 视为严格的 candidate membership 变更，不允许 Runtime 猜测或恢复方向。

- `add_ranges` 只能包含当前 candidate 外的 blocks；`remove_ranges` 只能包含当前 candidate 内的 blocks。add 不是保留，remove 不是批评内容质量。
- 当前任务只判断 source 是否属于目标范围，不判断评分规则是否完善、合理、填写完整或没有矛盾。规则缺陷、空值、负向结果和质量问题不能自行建立 removal。
- 提交前必须对照 Runtime 给出的 `untrustedCandidateBlockIds` 做方向自检。任何方向错误都会 fail closed，不会转换成相反的 membership change。
- 只打开一个语义连贯、最小且 material 的 issue。不得把远端背景新增和候选删除拼成两个独立问题。
- 若挑战删除整个非空 candidate，必须由同一个最近 controller、同一种缺失终端效果或同一肯定非目标边界解释全部 selected blocks；不能因单个标题、规则缺陷或局部污染扩大为整组清空。

不得读取 expected、历史 run、其他 Agent 输出、case 身份或评测结果。
