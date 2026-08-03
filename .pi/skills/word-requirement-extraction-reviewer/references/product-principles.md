# Word 采购需求提取 Reviewer Product Principles

本文是本 capability 的最高约束，覆盖 Prompt、Extension、测试、盲评和质量结论。任何实现即使在已知 case 上得分更高，只要违反本文，也视为无效。

## 一、核心目标

从任意行业、任意项目性质、任意采购类型和任意内容结构的正常单包 Word 招标文件中，稳定取得能够直接支撑技术方案大纲和正文写作的采购需求原文范围。

上游已经迭代成熟的 single-prompt candidate 是必须复用的第一份语义判断。Reviewer 的价值不是重新生成第二份完整答案，而是修复 single prompt 残余的 5%～10% 材料性错误，同时尽量做到 `candidate correct -> final correct`。若只增加包装、调用次数或随机变化，却没有提高 `candidate wrong -> final correct` 的净比例，就不能宣称质量提升。

### 当前 active Pi-native 路线

当前产品路线是固定三调用的 Pi-native Finalizer/Witness：同一个 GLM Pi Agent loop 先提交完整 `provisional_selection`，Doubao 2.0 Pro 只提交有界反例，随后同一个 GLM Finalizer 在全新、确定性的 neutral-replay provider context 中提交 sparse `final_delta`。两次 Finalizer 调用保持同一个工具名，但 Harness 在 provider 边界暴露互斥的 phase-specific schema；第二轮权威 phase marker 位于非权威 provisional/review packet 之外，协议 phase 不能由待审查语义内容定义。Witness 接收有界 source focus、独立机械 target authorization、全部 typed hard-root claims、exact JSON schema，以及受既有 schema 限长的 provisional `owner_reason` / `residual_reason`。Harness 必须先呈现 source，再呈现 authorization 和 typed claim support，最后把理由置于 `UNTRUSTED_PROVISIONAL_RATIONALE` 下作为待攻击 claim；理由不是 source、证据、裁决或 supporting material。Witness 在读完 rationale 前不得生成、淘汰或排序候选，随后才执行 unified enumerate/rank。普通 atom 争议前，Witness 必须优先证伪 rationale 暴露的两类通用 Owner premise：否认 source-proven local hard root，以及把 recovery 扩张到 source-bound matching module 之外；两者仍必须由可见 source 独立证明。固定优先级为 `rationale-exposed owner-boundary contradiction > other source-proven root contradiction > typed/rationale/source exact contradiction > strongest singleton falsifier`。第二轮 context 由原始不可变 user 输入追加 Harness 权威 phase-control 前缀，再追加受 `REPLAY_TRUST_BOUNDARY` 约束的 normalized provisional 与 review packet 语义内容构成；不回放历史 assistant/toolResult 角色或 tool-call ID。Witness 没有单边 override；代码不在两者之间做语义裁决。只有 Finalizer 显式接受一个有效 Witness Owner index，并在 final hard-root claims 中提交 exact carrier/root/exit，Harness 才机械形成 `A=S0∩[root,exit)`；accepted array 为空时不投影，显式 index 未知或无 exact claim 时 contract-fail 且不投影。Harness 唯一执行 `S=(S0-A-Δ-)∪Δ+` 并 compact final ranges，且不要求 `run_deltas` 重复枚举 `A`。发布必须满足 `FINAL_SELECTION ∩ FINAL_HARD_ROOT_PROJECTION = ∅`，且恰好发生 `2 Finalizer + 1 Witness`。Harness 可把 provisional typed selection 与 hard-root projection 的确定性交集作为 mechanical contract blocker 回传，类似 coding agent 的编译错误；它只能指出字段自相矛盾，不能决定应修改 selection、claim exit 或哪项语义结论。任何失败均原样保留 Candidate。

Witness 固定提交三个必填、non-nullable array：`owner_boundary_challenges` 为 0-1 张独立 typed span，字段精确为 `carrier_type,root_block_id,exit_block_id_exclusive,anchor_block_id,source_conclusion,supporting_block_ids`；`remove_from_provisional` 为 0-2 张 atom-only singleton card；`add_to_provisional` 为 0-1 张 `owner_boundary|atom_membership` singleton card；总卡数最多四，空数组精确为 `[]`，不使用 `kind=none` sentinel。remove/add target 只允许一个完整 canonical block，字符串精确为 `段落N`；禁止多 block range 或“前半段/后半段/尾句/其中”等 block 内切片。每张 card 含一句 `source_conclusion` 和 1-8 个 supporting focus block；direction 由顶层字段机械映射，不是模型字段。字段名、card 数量、card 顺序和 supporting block 数量都没有证据权重，不能形成投票。全局 JSON/turn/schema/cross-field 与完整 source 地址合同必须先通过，随后代码才逐 card 做地址、focus、authorization 和 universe 校验：Owner anchor 必须位于 typed span、`S0` 与 `AUDIT_UNIVERSE`，remove/add target 必须属于对应 `MECHANICAL_TARGET_AUTHORIZATION` 连续 range；authorization 外的 source block 只可作 support。source 中真实存在但未获动态权限的 card 必须整卡弃权，不能裁剪或修补；其他有效 card 独立保留，任一卡 rejected 形成 `partial` coverage。Finalizer 第二轮必须逐 card 独立核验有效 predicate；rejected card 的 slot/index、span/range、source conclusion、supporting ID、typed reason 与 error 只能留在 trace 且 `forwarded=false`，Finalizer 只能看到中性 coverage 状态、stable index 和有效 challenge。

Active Pi-native 使用一个共享 `atomic controlling-predicate gate`，先拆 target-own propositions、归一同 block 的具体条件，再按 controlling predicate 的 semantic role 区分 requirement 与 price/proof/procedure/legal/meta/shell/pointer。计算、填写、提交、支付、扣除、赔偿、取消等语法动作若属于 excluded role，不构成 survivor；金额、预算、计费基数、费率和收费标准不得改写为项目物理规模；跨 block 指代只定位 antecedent，不复制其 requirement predicate。性能指标先按衡量对象分类：直接衡量供应商工作/成果的准确性、及时性、完整性或合格性时，即使随后触发扣费也仍是 performance threshold；仅计算价款或费用且不定义履约质量边界时才是 monetary operand。并列 trigger 必须逐 proposition 判断，任一具体履约 alternative 都触发 whole-block survivor veto。Witness 随后执行一次 global card tournament：先按肯定 exclusion mechanism × source-proven peer-bounded partition 分组，同一 root、source conclusion 或连续 remedy/price/proof cluster 最多一张，再按 `rationale-exposed owner-boundary contradiction > other source-proven root contradiction > typed/rationale/source exact contradiction > strongest singleton falsifier` 排序；同级候选才比较 source 确定性、whole-block 原子确定性、材料性与独立失败覆盖。`denied_local_hard_root` 不能以 mixed parent 或 descendant 内容价值否定 local categorical root；`overbroad_recovery` 必须把恢复限制在 source 实际绑定的固定 matching module 及其真实 peer scope，不能释放无关 sibling 或 later modules。重复、别处覆盖、内容相似或结果更短不能改变 Owner 或 membership；embedded proof tail 不能伪造独立 Owner root。Cross-reference recovery 必须在 later module atom gate 前完成；来自合格 source 的“遵守/执行 X，详见附件”是 operative incorporation，later 固定匹配 module 不能因处罚或合同式措辞重新继承前一 carrier，但 recovery 只重新开放逐 block atom evaluation，不授予整段 membership。Finalizer 对全部 selected blocks 和 provisional gaps 使用同一 gate，并按 local hard root/heading、excluded-role cluster、excluded-gap 三个风险面完成 terminal scan；heading closure 在 child 终态后按相对层级自底向上重算，只增加 heading 地址，不改变 excluded child。技术附件/制度 intro 确定适用对象并指示执行后续固定规则时是 applicability ATOM。每个 final selected block 必须以 target-own `ATOM` 或合法 `HEADING` closure 为唯一 provenance，Owner、recovery、module、cluster 或相邻 survivor不能成为第三种保留来源。第二轮先冻结 exact `S` 与 sparse typed delta，再压缩记录 delta reason，并对 reason 中 exact verdict 与机械派生 final set 做最终一致性扫描。`owner_reason` 只记录身份与 root→exit，不得塞入 atom 清单；不得用“其余范围均合格”等组摘要替 exact-block closure。上述语义判断全部由模型完成，Harness 不识别 predicate、partition、family 或 cluster。

每张 Witness premise 应以约 192 字以内为紧凑目标，但字符数不是协议合法性或语义完整性的替代品。Harness 只校验 premise 非空白、字段 shape、地址与权限，不得因一句完整 premise 超过某个自然语言字符数而 contract-fail，也不得机械裁剪。成本和最坏输出由 Witness 全局 2400-token 上限硬控制。

Active Pi-native 必须执行 canonical block provenance gate：每个可独立寻址的 block 只能使用目标自身的 controlling predicate 证明 membership，前后相邻 block 或“上述/前述”所指 antecedent 的施工、人员、质量、修理、纠正或交付谓词不得借入。后果条件只在目标自身明确可控制或可核验的行为、状态、结果、标准或阈值时归一为 requirement；只剩“质量问题、工期延误、措施不到位、损失、违反上述规定”等泛化标签时仍是 false-positive hole。同一不可分 block 内确有直接 duty 时完整保留。该判断只由 Witness/Finalizer 基于 source 完成，不增加 ledger、schema、调用或代码语义裁决。

Active Pi-native 还必须执行 proposition completeness invariant。Finalizer 与 Witness 都要从目标首字扫描到末句，穷尽句号、分号、并列/选择 alternative 和 tail clause。对每个拟从后果 antecedent 或 mixed block 中保留的履约 proposition，形成完全来自目标 block 的 `target-own survivor tuple = (履约侧主体, 具体行为/状态/结果/标准, 肯定或禁止极性)`；主体可由该 proposition 自身的省略主语、被动或规范句式确定，current-project fact 与合法 heading 不要求伪造供应商主体。负面后果 antecedent 本身可以提供禁止极性；付款、扣罚、取消、追责或其他 excluded proposition 位于开头，不能终止对后续履约命题的扫描。不得用整块“核心/主要/communicative function”、付款或处罚主题覆盖任一存活 tuple；只有所有 tuple 均被 source 逐项反驳且剩余 target-own propositions 全部属于肯定 excluded role，整个 block 才能排除。并列 trigger 必须执行 `trigger completeness checksum`，任一具体履约 alternative 存活即触发 whole-block survivor veto。

Owner 与 heading 边界必须和上述原子结论正交。Cross-reference recovery 一旦在 recovered module 起点成立，任何仍把该起点投影为前置 carrier descendant 的 typed hard-root claim，都必须把 exclusive exit 收窄到该起点或撤回；这不限制 later source 独立建立新的 hard root。边界恢复不等于 membership，但也不能被 later atom 终态反向取消。Heading 的 `D(h)` 必须在首个 source-proven 同级或更高层级 sibling/root 前结束，无后续 sibling/root 时到 source end；编号深度、Word style、字号或 outline path 任一单独信号都不能建立层级，也不能覆盖 source 已证明的 sibling/child 关系。Witness 的唯一 select card 若 target 仍位于 provisional hard-root projection 内，不得使用 `atom_membership` 内容例外；只有具备 source-proven peer exit 或 recovery 证据的 `owner_boundary` card 才可先攻击该 projection。以上均为模型语义合同，不授权 Harness 按文本或关键词执行任何同类裁决。

Recovery 必须额外通过通用 eligibility gate：earlier operative incorporation、later 固定非填报、对象/功能对应，以及 later intro 对当前项目、供应商或实施活动建立的自足适用关系，是累计 source-functional 证据；它们可以共同证明 later module 从自身起点成为边界独立、功能自足的 peer，即使外层附件标签、编号或 Word outline 仍继承前一 carrier。已填充、项目专用、内容重复、技术细节丰富、附件编号重启或直接采用为合同/响应附件，只能否定部分模板假设，不能单独证明 Owner 已退出 hard carrier。该判断不依赖 Word outline 同级，也不得把真实平铺/OCR module 拒之门外。

Witness 的 typed Owner span 是删除通道，只能攻击 provisional-selected hard-carrier descendant；anchor 必须直接具有 `remove_from_provisional` 机械授权，并产生非空净删除。已有 hard-root claim 过宽、需要在 peer/recovery 起点前收窄时，必须走 `add_to_provisional kind=owner_boundary` 的释放通道，由 Finalizer 独立重建 boundary、更新完整 claim snapshot，并仅在 target 通过 `ATOM|HEADING` 时提交 `Δ+`。两条通道都只是模型语义表达；Harness 仍只执行既有地址授权、双钥匙删除投影、delta 与最终零交集校验。

Active Pi-native 的最终集合还必须执行 `symmetric_partition_fixed_point` 与 `semantic_projection_checksum`：每个 selected compact range 都是其内部每个 canonical block 均有 membership 的全称命题，必须寻找 target-own 肯定 exclusion 反例并拆出 holes；每个 excluded gap 都是其内部每个 block 均无 membership 的全称命题，必须寻找 target-own survivor 或真实 heading/body/table closure 反例并恢复。宽 range、组摘要、端点、相邻正例和同 subsection 的其他 survivor 都不能替内部 block 证明。双向攻击结束后先冻结最终 block-ID set `S`。普通变化从 `S0-A` 与 `S` 唯一生成 typed `Δ-` / `Δ+`；`A` 只来自一个 accepted Witness Owner index 与 exact final hard-root claim 的双钥匙，Harness 自动删除其 `S0∩[root,exit)`，不得要求 `run_deltas` 逐地址重述。任何已明确判定的普通 hole 都必须进入 `Δ-`，任何已明确判定的 survivor 都必须进入 `Δ+`。reason 不得再写一份最终 compact ranges 与 typed delta 竞争。该过程使用 phase-specific final-delta schema，但不增加调用、ledger 或代码语义判断。

Active Pi-native typed final-delta fixed point 是 targeted delta 的双向验证，不是重生一份整文答案。第二轮先冻结 provisional block-ID set `S0`；`S0` 不是真值，但是唯一集合编辑基线。先关闭 reason/typed set 自相矛盾，再不依赖 Witness 卡对全部 selected blocks 执行 exclusion closure、对全部 provisional excluded gaps 执行 survivor closure，核验 Witness 后再做一次 terminal exact-block scan，最后投影 delta。除双钥匙 Owner span `A` 外，每个变化必须由 exact target-own predicate 成立并进入 `Δ-` 或 `Δ+`；第二轮只提交实际变化 run 的 `remove_ranges` / `add_ranges`，并用 `accepted_owner_boundary_challenge_indices` 0-1 个 stable index 显式接受 Owner challenge。accepted array 为空时不产生 `A`；一旦显式提交 index，它必须有效且 final hard-root claim 的 carrier/root/exit 必须 exact match，否则 contract-fail。双钥匙有效时 Harness 唯一执行 `S=(S0-A-Δ-)∪Δ+`。不得从新 reason、章节摘要、“其余均合格”或整段分组重新生成 selection。`A` 与 `Δ-` 不得出现在 final selection，`Δ+` 必须全部出现。该过程不增加调用、ledger 或代码语义判断。

Active Pi-native 还必须遵守 canonical block / table-block atomicity：不可分单位只能是恰好一个 canonical block object / 一个 block ID，不能扩张到 subsection、sibling group 或 compact range；其他 block 的 survivor 不能借给目标 block。同一个 table block 内的 row/cell 不是独立输出地址。在四类 carrier 外，只要任一 row/片段仍有 target-own requirement proposition，就不得因同表另有付款、价格、合同指针等 row 删除整个 block；只有整块通过共享 controlling-predicate gate 后无 survivor 才可排除。Witness 不得提交 row-level 删除 premise，Finalizer 不得把 row-level rationale 投影成整块 exclusion；模型内部可逐 proposition / row 阅读，但不增加 schema、patch 地址或 ledger。该 atomicity 不会覆盖 hard-carrier Owner gate。

Active Pi-native 的 hard-carrier 层级是不变量：source 一旦证明四类 root 与首个同级或更高层级、功能不同的 peer exit，内部低层 subsection 即使包含进场、人员、质量、交付等 post-award 措辞，也不能形成内容例外或内部 peer exit；Stage Owner、stripped-remainder 和 atom 判断只能在 Owner gate 之后、四类 carrier span 之外运行。Finalizer 不得为保留 descendant 把已成立的 hard-root exit 收窄到内部 subsection；selection 位于已承认 span 时必须删除，除非 source 证明其前方已有真实同级或更高层级不同功能 peer。该规则由模型判断 source 层级，不增加代码语义裁决。

每个 Finalizer turn 的唯一权威输出仍是恰好一个 contract-valid `submit_final_selection`。Prompt 继续要求不输出 prose；若 provider 同轮附带普通 text，Harness 不读取、不解析、不解释其语义，也不让它参与 provisional、repair card、final 或发布，只机械记录原样拼接文本的字符数、SHA-256 与 `forwarded=false`。Finalizer trace 只持久化 raw tool arguments、normalized structured submissions 和上述 auxiliary-text 元数据，不持久化 raw Finalizer assistant message。转换为第二轮真实模型 context 时，Harness 必须先机械验证唯一 provisional tool call 与对应 tool result 成对匹配，再移除历史 assistant/toolResult 角色、tool-call ID 和全部 auxiliary text，把 normalized provisional 与 review packet 追加到原始 user 输入，同时切换到 final-delta-only tool schema，并把 `ACTIVE_FINALIZER_PHASE`、`THIS_IS_FINAL_PROVIDER_CALL` 与 `HARNESS_PHASE_CONTROL` 放在 `REPLAY_TRUST_BOUNDARY` 之前。Finalizer thinking、未知或额外 tool call、截断和非法 schema 仍 fail-closed。

非空 Candidate 的首版 `AUDIT_UNIVERSE` 只等于 Candidate，当前只承诺 false-positive precision repair；不得声称已解决任意远端 `OUT` omission。空 Candidate 才机械扩展到完整 source，用于修复 false-null。该路由只依据 Candidate 是否为空，不读取正文、case 或答案。

运行时按角色切片加载 Prompt：Finalizer 只加载 mode-specific 的 `pi-native-semantic-contract.md` 与 `finalizer.md`，并由动态 `TERMINAL_CONTRACT` 和 tool schema 提供当前 run 的两轮字段权限；完整 `pi-native-runtime-contract.md` 仍是 Harness/governance 真源并进入 capability hash，但不整篇注入任一模型。Witness 只加载自包含的 `witness.md`，再按顺序接收 strict source-ordered `REVIEW_FOCUS_SOURCE`、`MECHANICAL_TARGET_AUTHORIZATION`、包含 projected/no-projection claims 的 `PROVISIONAL_HARD_ROOT_CLAIMS`、`UNTRUSTED_PROVISIONAL_RATIONALE` 与 exact JSON schema，之后才允许 unified enumerate/rank。Rationale 只暴露首稿待证伪 claim，不能替代 source 或地址权限；Witness 必须以 source 与实际地址独立证明结论。本文仍是治理和评估真源，但不整篇塞入模型上下文。

### V1 legacy overlay 基线

以下从 Call 1 Reviewer、Call 2 Release、`REMOVE_REVIEW`/`BASE_KEEP` overlay 到两调用预算的描述，只记录 `review_word_requirement_extraction_candidate` 旧实验基线。它不定义 active Pi-native 执行，不得混入 active Prompt；若与上面的三调用合同冲突，以上面的 active 路线为准。

V1 legacy 路线为 candidate-protected residual review：

- Call 1 Reviewer 只提交 `pass` 或一个 source-grounded add/remove challenge；
- 四类硬载体优先是 block/range 级终态门，不是 case 级早停权。Reviewer 确认 hard root→semantic-exit 后，禁止在该 hard range 内执行主要直接效力或 `duty_survival_attack`；但在终态投影前，必须将所有已确认 hard ranges 从 Candidate 中机械想象减去，继续对每个存活 Candidate residual island 执行 `pre_award_stage_gate`、`outside_carrier_precision_closure` 和反事实 duty 攻击。同一 Candidate 中的硬载体污染与载体外材料性 membership 错误必须在同一 case-level challenge 中一次关闭；不增加调用、不生成 ledger，也不搭载无关的普通噪声清理；
- 空 Candidate 的 `pass` / 机械 no-op 在一调用后结束；非空 Candidate 的 `pass` / 机械 no-op 必须进入一次独立的 terminal-or-hard veto Release audit；
- Reviewer 必须先在短 reason 中完成整文关系、Owner、材料性与反事实 final 的单一结论，再最后生成 add/remove/preserve 结构字段；结构字段是 reason 的终态投影，不能在 reason 中发现正确范围后仍保留先前生成的旧 ranges；
- Call 2 Independent Release 固定使用与 Reviewer 不同的模型家族，以减少同模型共模偏差。material challenge 时，Reviewer 是 bounded patch 的主语义判断和调用门；非空 Candidate no-change 时，Release 只获得整文终态 veto 与四类硬载体 veto 两种权限。Release 看不到 Reviewer 的 claim、reason、evidence leads 或历史，只看到完整 source 与机械 overlay。Reviewer 明确删除的 Candidate block 标记为 `REMOVE_REVIEW`，挑战新增标记为 `ADD_REVIEW`，其余 Candidate 标记为受保护 `BASE_KEEP`。Harness 还可只按 Candidate 每个连续区间首尾的固定相邻地址窗口生成 `BOUNDARY_REVIEW`；它不是 Reviewer claim、Owner 标签、置信度或普通 OUT 搜索许可。Release 只有在完整 source 独立证明这些 block 是相邻 Candidate-selected shell 所需的完整同 Owner 正文、表格、清单、续行或附件，且完整所需 island 没有延伸到普通 OUT 时，才可把它们加入 `accepted_add_ranges`。Release 没有独立 keep override；它通过同时省略两个 exclusion 字段保留 `REMOVE_REVIEW`，通过省略 `accepted_add_ranges` 拒绝新增。通常只有它独立证明并写入 `hard_excluded_ranges` 的公告/通知、投标人或供应商须知、投标/响应/报价格式、合同条款及格式 block 可以越过 `BASE_KEEP`，且所有获批的四类载体删除都必须使用该字段。Harness 只机械减去明确授权的删除；任何未进入删除字段的 `REMOVE_REVIEW` block 自动恢复。`REMOVE_REVIEW` 与 `BASE_KEEP` 的切换只是权限边界，永远不是语义 Owner exit；Release 必须沿 source 穿过该切换及后续 OUT/marker 变化，直到首个不同 Owner 的 peer root 或 EOF。除 `ADD_REVIEW` 与满足上述闭合合同的 `BOUNDARY_REVIEW` 外，不得加入其他 OUT；
- `REMOVE_REVIEW` 只授权 Release 重新裁决该 Candidate 子集，不编码删除原因或 exclusion 类型。若 Release 独立确认其属于四类载体，必须只写入 `hard_excluded_ranges`；若确认是载体外可分离 atom，必须只写入 `outside_carrier_excluded_ranges`；若最终决定保留，必须同时省略两个 exclusion 字段，由 Harness 自动恢复。不得用另一个字段覆盖已经提交的删除授权；
- `reviewer_no_change_terminal_or_hard_veto` 模式是独立的保守对抗审查，不是第二次完整提取：全部 Candidate 均为 `BASE_KEEP`，`REMOVE_REVIEW`、`ADD_REVIEW`、`BOUNDARY_REVIEW`、部分载体外删除、residual precision 和 OUT 新增全部禁用。该模式既用于非空 Candidate 的 Reviewer pass / 机械 no-op，也用于 Reviewer schema、range 或 terminal contract 无效后的安全降权：无效 Reviewer 提案整体丢弃，Harness 不从 reason、正文、Candidate 或默认业务假设补猜任何字段。Release 只能二选一：若完整 source 独立证明整文是非采购文档、供应商已完成响应、纯合同或未实例化模板，则必须把恰好完整 Candidate 写入 `outside_carrier_excluded_ranges`，并保持其他 delta 为空；否则只能把独立证明属于四类硬排除载体的 Candidate descendants 写入 `hard_excluded_ranges`。若两种 veto 都不成立，必须提交空 delta 并原样保留 Candidate。Harness 只以地址集合机械授权完整 Candidate terminal veto，部分提交会被裁剪；
- 若 Reviewer 同时提交 `source_role=buyer_issued`、`instantiation=present`，却以普通 removal 覆盖全部 Candidate，Harness 将其视为灾难性误删形状而不是语义结论：在 Release 前撤销完整普通 remove envelope，使全部 Candidate 初始为 `BASE_KEEP`，保留 `ADD_REVIEW` 与 Candidate 全域四类 hard-carrier sweep，并禁用 `BOUNDARY_REVIEW`。Release 提交 typed hard delta 后，只有至少一个 Candidate block 已进入 `hard_excluded_ranges`，且完整 Candidate 地址集合减去这些 hard exclusions 后恰好只剩一个非空连续地址岛，Harness 才把该岛暴露为一次 bounded outside-carrier precision 权限。该岛可以是前缀、后缀、中间岛，也可以是其他 Candidate intervals 全部 hard-excluded 后唯一存活的独立 interval；两个 residual 岛、没有 Candidate hard exclusion 或没有剩余 Candidate 都不授权。代码不读取正文、不决定 residual 中任何 block 的语义，Release 仍须把每个准备删除的 atom 明确写入 `outside_carrier_excluded_ranges`；
- 普通 bounded patch 也可获得同一形状的唯一 residual 权限，但解锁条件更严格：Release 必须先独立把至少一个属于 Reviewer `REMOVE_REVIEW` envelope 的 Candidate block 写入 `hard_excluded_ranges`；仅在 `BASE_KEEP` 中发现 hard carrier 不能解锁。随后仍只按完整 Candidate 地址集合减去全部 hard exclusions，且结果必须恰好是一个非空连续地址岛。该权限只补足“Reviewer 找到大 hard carrier 后对唯一存活 residual 早停”的共模风险，不是第二次完整提取；两个 residual 岛、没有 confirmed `REMOVE_REVIEW` hard hit 或没有剩余 Candidate 都不授权；
- Release 必须先写 `hard_carrier_reason`，完成整文与每个连续 Candidate interval 的四类载体 Owner/peer-root 假设；Candidate interval 的首个 block 可能只是一个起于 OUT 的四类 root descendant，必须向前检查实际 ancestor root。再写 `residual_reason`，在任何 range 字段之前对该假设执行反向边界攻击，纠正向前吞并合格章节、越过不同 Owner peer exit 或遗漏后续 qualified peer root 的判断，并关闭载体外授权 atom。两个 reason 都完成后才投影三个 typed delta：`hard_excluded_ranges` 必须精确投影 `residual_reason` 最终仍确认的每个四类 root→semantic-exit 与授权 Candidate/`ADD_REVIEW`/`BOUNDARY_REVIEW` 的完整交集，不得只写其中价格、程序或 Reviewer 已挑战的零散子集。若要保留 root 内任一 descendant，必须先在 `residual_reason` 中撤销、缩窄该 root 或证明更早的不同 Owner peer exit；已经确认的 root 内禁止再用技术价值、主要直接效力或 `duty_survival_attack` 挖洞。`outside_carrier_excluded_ranges` 通常只能投影 `REMOVE_REVIEW` / `ADD_REVIEW` / `BOUNDARY_REVIEW` block；满足当前 hard-boundary residual 解锁条件时，还可投影由同次 hard delta 机械派生的唯一非空连续 Candidate residual，表达载体外经 `duty_survival_attack` 后可安全分离的非 requirement atom。`accepted_add_ranges` 只能批准独立验证的 `ADD_REVIEW`，或满足完整 shell-body 闭合合同的 `BOUNDARY_REVIEW`。Harness 只删除两个 exclusion 字段明确授权的 block，并把其余 `REMOVE_REVIEW` 机械恢复。Harness 固定派生 `final = Candidate - authorized hard exclusions - authorized outside-carrier exclusions + accepted challenged additions`。若 accepted add 与 exclusion 重叠，accepted add 优先，冲突 exclusion trace 被机械裁剪。Release 不提交完整 `final_ranges`，Harness 不解释两个 reason、不识别载体、不补写语义；
- Release 在压缩任一多 block 的载体外删除区间前，必须执行一次 `counterexample_first_duty_attack`：把每个 canonical 段落/表格 block 视为可独立寻址，即使它们共用价格、付款、结算、保证金或法律标题；先寻找剥离价格、付款、结算、审计、证明与救济包装后仍存活的最强成交后工作义务。只要存在，就恢复该 block 所属的完整 source-fidelity island、在其前后拆分删除，并只对剩余子区间继续寻找反例，直到没有存活 duty；不得只提交代表性样本地址。安全保留通过从两个 exclusion 字段省略完整 survivor island 表达，Harness 自动恢复。该攻击只在 reason 中报告紧凑 survivor islands 或 none，不生成逐 block ledger，不增加调用；
- packet 可选携带从同一原始 DOCX 机械抽取并与 canonical block 高置信对齐的结构证据：Word body 顺序、段落/表格类型、样式、outline、编号、字号、粗体、对齐、分页、表格规模和 outline ancestry。Reviewer 与 Release 看到同一份 answer-free 结构图；它只用于恢复物理层级和真实同级边界，不携带 Owner、membership、keep/drop、历史结果或评测标签。低置信或未匹配 block 必须省略，省略不构成负面证据；
- Reviewer provider/capacity/timeout/budget failure、空 Candidate 的 contract failure、Release failure、总预算或越界都静态保留 candidate 并标记 degraded。非空 Candidate 的 Reviewer schema/range/terminal contract failure 不得获得任何 patch 权限，但可继续执行已预算的 `reviewer_no_change_terminal_or_hard_veto`；只有该独立 Release 的 typed veto 可以改变 Candidate，Release 再失败则原样保留。

## 二、评估标准

正确结果不要求唯一最短范围。必须优先判断：

- 是否覆盖采购对象、专业系统、货物/服务类别、工程范围和工作包；
- 是否覆盖会形成独立技术章节的实施、组织、进度、质量、安全、环保、风险、应急、交付、验收、培训、运维、质保和售后；
- 是否保留合格采购需求来源内真实展开的详细参数表、对象清单、工作包、项目专用技术义务和其他不可替代源文载体；
- 是否把采购需求与公告、投标人须知、投标/响应格式、合同条款及格式等其他独立能力负责的载体严格分开；
- 是否排除其他项目/包、供应商已写成的响应、内部制度或产品手册、独立评分、资格、纯价格和纯程序内容；
- 输出是否只能是裸 `null` 或合法 `完整采购需求编号范围`。

### 采购需求载体硬边界

以下四类载体不属于 `requirement`，即使其中出现项目名称、预算、投标动作、承诺空格、通用责任、程序、格式示例或只在该载体出现的技术性文字，也不得因此获得采购需求 membership：

1. 招标公告、采购公告、资格预审公告及其公告性摘要；
2. 投标人须知、供应商须知、响应人须知及其前附表、正文和通用程序；
3. 投标文件格式、响应文件格式、报价文件格式、投标函、授权书、声明函、承诺函、目录模板、封面和签章占位模板；
4. 合同条款及格式、合同协议书格式、通用合同条款、专用合同条款模板、履约考核模板和合同附件范本。

“多载体/混合采购文件”只否定“整份物理文件由同一个硬排除 Owner 贯穿到底”的整文身份假设，不能取消其中任何已由 source 证明的局部四类 root。每个局部 root 仍从自身起点继承到首个不同 Owner 的同级或更高层级 peer exit；不得以整文还包含需求书、技术章、评分章或其他载体为由，把公告章、须知章、响应格式章或合同章内部的项目概况、采购范围、工期、地点、质量、技术表等 descendant 重新保留。

### 成交前资格/响应 Stage Gate

四类载体之外进入原子 `duty_survival_attack` 之前，必须先执行一次 `pre_award_stage_gate`。若一个具有明确 root 与 peer exit 的人员或强制响应 subsection，通过多个子项共同要求证书、社保、资格材料、承诺或其他证明，并以无效响应、不得参与或类似成交前后果定义准入，则该 subsection 的主要 Owner 是成交前资格/响应证明；root 标题及全部子项整体投影到 outside-carrier exclusion，禁止再对内部某个未来岗位、人数、进场或配置子项启动 duty-survival 挖洞。只有 source 肯定证明 subsection 主要直接约束成交后实际履约，而证明要求只是可安全分离的局部注释时，才进入原子门并只删除该 proof atom。

边界完整的“投标方/供应商承诺”“响应承诺”“无偏离承诺”或声明章节，若实际功能是在成交前要求投标/响应主体就未来履约作声明、确认、保证或承诺，属于第三类投标/响应格式 Owner；即使没有空格、签章位或“格式/模板”字样，且子项复述质保、质量、服务、人员、交付等真实履约义务，也从 root 到 peer exit 整体排除。不能从孤立的“承诺/保证”词建立该载体；四类载体外采购人直接命令中标后执行的义务仍按履约事实保留。

四类载体之外，孤立的成交前提交/承诺/确认/声明包装也不能自动删除同一不可分 block。执行一次 `response_wrapper_survival_attack`：只剥离“在响应文件中填写、提交、自行承诺、确认或声明”等行为包装和称谓，再把余下内容还原为关于采购工作本身的命题。若余下命题直接规定所提供的工作、服务、产品、质量、安全、验收、质保或其他成果本身必须满足、符合或至少达到采购技术要求/结果基线，duty 即存活；即使没有另一个实施动词、同段没有项目参数、该 block 夹在付款与报价等商务 block 之间，也必须形成独立 keep island 并保留整个不可分 block。若剥离后只剩“投标人作出一般响应、无偏离、接受或遵守承诺”这一表态对象，没有独立断言所提供工作具有什么属性、动作或结果，则它仍是可安全分离的成交前 proof atom。只有 source 已建立边界完整的响应/承诺载体，或包装与履约义务可安全分离且剩余 atom 只要求成交前证明、表态、无偏离或材料提交时，才可排除。单个 block 含有“响应文件”或“承诺”不足以触发 subsection-level `pre_award_stage_gate`；该 gate 仍要求明确 root、peer exit、多个共同定义准入的证明子项及成交前后果。

合格来源包括当前项目的采购需求、用户需求书、技术标准和要求、项目专用技术条款、技术规范、设计说明、图纸说明、设备材料技术要求、技术清单、有效技术附件、采购范围，以及其他明确承载采购标的技术义务的章节。章节名称不是唯一依据；必须按载体在当前上下文中的实际功能和 Owner 判断。

四类硬排除载体之外的独立章节，不得只凭“商务要求”“履约要求”“交付条件”“售后要求”或其他标题判为纯商务。若其直接规定当前项目的工期/服务期、地点、采购范围、质量标准、保修/质保、交付、验收、服务响应或其他会形成技术方案事实基础的履约义务，这些 block 属于 requirement；只有价格、付款、结算、保证金、投标有效期，或不承载任何直接工作义务的纯违约救济、解除、争议解决、合同成立、生效、适用法律和一般法律风险分配等可安全分离 block 才按非目标处理。混合章节必须逐可寻址边界裁决，不能因其中存在付款、结算或法律后果条款而删除整章，也不能因其中存在技术义务而自动保留全部纯商务或纯法律内容。

“主要直接效力”只能在已经由 source 证明位于四类硬排除载体之外的 block 上使用。公告、须知、投标/响应格式或合同条款及格式尚未结束时，Owner 是终态门槛；不得再用 block 内的实施、服务、质量、安全、验收、人员或项目专属事实覆盖外层排除 Owner。只有先证明 source 已退出这些载体，才按该 block 的主要直接效力判断，而不是统计其中出现了多少技术名词。若正文主要规定计价、报价构成、支付、结算、扣款、审计、发票、保证金或价格调整，工程量、完工、验收、质量保证金等词仅作为金额计算依据、付款前提或结算触发条件，该 block 仍是纯商务；不能把“验收合格后结算”改写成验收要求。若正文只规定违约赔偿或救济、合同解除、生效/成立、争议解决、适用法律或一般法律风险分配，且没有直接要求供应商实施、提供、配置、施工、交付、维护、响应或达到工期/质量/安全结果，则是可分离的纯法律非工作内容。反之，直接工作义务仍是履约事实，即使末尾附带“费用已含”“不另支付”、违约后果或其他法律后果也不能因此整段删除。标题不能替代这一主导效力判断；原子 block 内两类效力确实不可分割时才按 source fidelity 保护。

载体之外的删除必须通过一次 `duty_survival_attack`。先暂时剥离审批、报审、备案、费用承担、扣款、违约、解除、赔偿或其他附带后果，只检查剩余主句是否仍直接要求供应商实施、配置资源、编制或提交计划/方案/报告、保存记录、交付、限时替换或补齐、响应、在指定平台执行或达到具体结果。费用语言不能抹掉资源提供义务：若主句要求供应商负责当前实施所需材料、耗材、工具、设备、设施或人员的提供、准备、保障或可用性，即使同一不可分 block 又说相关费用由其承担、已含或不另支付，也必须保留。只有资源仅作为丢失、损坏、浪费、赔偿或计价对象，或条款只分配费用而不要求实际提供资源时，才按纯费用/救济排除。直接工作效力不要求句法上必须出现“供应商应当”：对当前项目成果的准确性、完整性、误差或质量负责，采购人对成果进行检查、复核、验收并据此要求纠正，或者规定适用技术标准的现行版本、替代关系和优先顺序，都在直接约束交付结果或履约基线；只有与任何工作成果、质量阈值、纠正义务或适用标准无关的纯权利保留才可视为非工作内容。明确要求中标/成交供应商对当前项目的设计、施工、安全、质量或成果承担前置责任，也是在分配履约治理责任；即使同段附带经济损失承担也应保留。语法上的否定前件或处罚结构不能替代直接效力判断：若不可分原子 block 在救济之前给出独立保证、禁止、质量/结果基线，或以“未及时实施某个具体动作”“不得发生某个供应商可控制结果”作为处罚前件，剥离后果后还要对前件做极性归一，把它还原为对应的正向动作或结果义务。只要归一后的剩余内容仍具体要求及时维护、提供正确稳定的产品或版本、保证不侵权、避免返工或其他可执行/可验收结果，该 duty 就存活，整段应保留。只有“违约、违规、与合同不符、造成损失、质量问题”等泛化触发标签，且没有具体动作、阈值、交付结果或纠正责任时，才仍是纯救济触发器。相反，触发条件中出现质量差错、违规、虚假成果或其他履约问题，并不会让纯扣款、赔偿、取消资格、解除、递补或依法追责条款自动获得 membership；若去掉这些救济后只剩“采购人可追责/扣款/解除”等后果而没有独立的供应商责任、成果责任、质量阈值、复核验收、纠正或工作动作，该 block 仍是纯法律/程序内容。保密条款若直接限制当前项目数据/资料的存储、处理、传递、复制、披露、留存、返还或销毁，就是数据控制履约义务；不能仅因同段出现保密协议、法律责任或费用承担而删除。要求“按平台要求执行”的主句也不会因末尾附带解除合同后果而消失。合同签订后或履约期间的变更控制义务也必须存活：若采购人可书面提出标准、范围或条件变更，且供应商必须配合、执行、调整或补充，即使同一不可分 block 另说价款、费用或补偿另行协商，该变更配合仍是直接履约 duty，不能把整段当成纯价格协商删除。若仍存在这些可执行义务，该 block 属于履约事实；中标后提交、报审、审批、备案和记录管理是实施流程，不得误判为采购程序。只有成交前证明/响应动作，或剥离附带后果后不再存在任何直接工作义务的可分离 block，才可删除。成交前未提出异议/偏离即视为完全响应、同意、接受或无偏离，或要求在响应文件中提出异议/偏离的规则，是响应解释/证明 atom，不是中标后工作义务；即使位于四类载体之外也应作为可分离 outside-carrier exclusion。成交前证明 atom 从实际要求填写、附上或提交证明的 operative block 开始；相邻的中性标题、序号、空标签或上一个履约 block 不因地址连续自动继承该 Owner，除非 source 本身证明它们共同建立了资格/响应载体。后续出现合同扣款、违约救济或其他法律章节，不能反向把前面的同级技术、保密、数据、安全或交付章节改写为合同载体。

`remove_consequence_then_normalize_condition` 的统一判据是：若剥离后果并归一极性后，仅凭目标 block 与其已成立 Owner 可以重述为“受约束主体 + 可控制或可核验的行为/结果状态 + 明确肯定或禁止极性”，该 predicate 必须存活；无法形成该三元命题、仅剩未定义事件标签时才是 pure consequence。主句采用扣款、处罚、责任或追责语法不能覆盖该判据。标准版本也按同一实际效力门判断：在合格 requirement Owner 内，若 block 决定当前工作、材料、服务或成果适用的规范集合、替代关系或优先顺序，它属于履约基线；只有只维持采购文件、采购活动或文档法律/编制有效性时才是 meta。

Candidate 已选中一个处罚、扣款或救济 cluster 时，必须在同一次调用内做一次紧凑的 `consequence_cluster_attack`，不能因其中存在若干存活义务而整簇保护。先保留每个经极性归一后仍有具体动作、结果、数据控制或质量基线的原子 block；再单独攻击可分离的纯后果 atom，包括只泛称违约/不符、只指向处罚依据、只定义处罚触发事件、只规定确认/扣除/付款执行，或在相邻详细义务已经完整保留后仅重复“应遵守上述要求”并附处罚而不新增动作、阈值、结果或纠正责任的 wrapper。Candidate IN 中存在这类纯后果 atom 时必须作为 false protection 处理；Candidate OUT 中存在则不是可发布变化。该攻击只输出决定性的粗粒度地址岛，不形成逐 block ledger，也不增加调用。

四类载体门和 `pre_award_stage_gate` 均已关闭后，对任何把成交后交接动作与商务、证明或救济语言写在同一不可分 block 的内容执行一次 `performance_transition_attack`。成交后要求供应商协调、盘点、与实际转移相连的验收、接收、接管、迁移、移交或返还资产、设备、材料、数据、账户、场地或在制工作，是实施启动或业务连续性 duty。先剥离估值、折旧、价款、补偿、结算、承诺/证明和救济；若剩余仍有实际交接动作，整个不可分 block 必须保留。只有剥离后仅剩金额、估值、所有权或付款分配，且没有任何实际交接动作时，才可删除。可分离标题仍按标题 membership 独立性规则裁决。该攻击只是一条通用义务存活反事实，不增加 schema、角色、调用或 ledger。

四类硬排除载体之外，标题与子项分别承担 membership。处罚、扣款或救济 cluster 中，某个 child 通过 `duty_survival_attack` 只保护该不可分 child，不会自动保护只命名价格、付款、结算、扣款、违约、救济或其他非工作后果的可分离标题。若移除标题后存活 duty 仍可独立理解，该标题应单独进入 outside-carrier exclusion；若标题本身是合格技术、服务、安全、验收等 Owner，或是理解存活正文不可替代的上下文，则仍按 source fidelity 保留。该规则不能从孤立法律词建立合同载体，也不允许在已成立的四类 root 内挖洞。

四类载体之外仍可能存在可分离的纯法律 wrapper。只说明某份规范、附件或成果将成为合同组成部分、具有同等法律效力、以合同为准，若没有同时新增技术标准、实施动作、交付结果或纠正责任，就是合同效力/文件关系说明，不是工作义务。只说“未尽事宜由双方协商、另行解决”，若没有点明具体项目任务、协作流程、输出或响应时限，就是合同空缺/争议处理 fallback，不得改写为实施协调要求。这两类 block 应进入 outside-carrier exclusion；相邻技术内容不会给它们授予 membership。

若同一技术事实同时出现在排除载体和合格来源，应从合格来源忠实保留；不得用排除载体补写、扩展或替代合格来源。若某技术事实只存在于四类排除载体，本 capability 不负责把它迁入 `requirement`。公告、须知、格式模板和合同模板由其他独立能力处理。

合格来源中的“详见附件/合同附件/考核表/响应表”等交叉引用，不会把被引用载体的 Owner 转移给合格来源。必须到被引用内容实际所在的结构位置独立判断：若它仍位于公告、须知、投标/响应格式、评分、资格、合同条款及格式或其附件范本中，即使内容详细、唯一、与需求正文一致或被需求章节明确引用，也仍按其实际 Owner 排除。标题—正文—表格的 source-fidelity 闭合只能在同一个合格 Owner 内延伸，不能跨越硬排除边界。只有边界独立、实际属于技术规范、需求书、图纸、清单或有效技术附件的载体，才能因交叉引用进入 requirement。

四类载体的结构包含关系是硬边界。位于公告、须知正文、投标/响应格式或合同条款及格式内部的子标题、表格、附件项、内嵌技术清单和项目专用字段，不能在该载体尚未结束时仅凭“采购范围”“技术要求”“服务要求”“验收”或其他局部功能重新获得 requirement membership。附件标题、编号重新开始或技术细节增多本身不构成 peer exit。合格来源必须是四类载体之外边界清晰的独立技术章节/附件，或 source 中已经明确退出该载体后的独立 Owner。

每个争议边界都必须在同一次语义调用内完成一次紧凑、双向的 `carrier_root_exit_attack`：对拟排除区间，向前确认实际四类载体 root、向后确认第一个 source-proven peer exit 或 EOF；对拟保留岛，逐内部子标题检查是否新开始公告/通知、须知、响应/报价格式或合同条款载体。没有实际 root 时不能创建载体；发现平级 Owner 时必须在其前停止；保留岛内部出现局部 root 时必须从该 root 切开并排除到其 exit。若有结构证据，争议边界必须与 `sc/path` 对账：更深层附件、技术标题、普通段落或表格仍是 active carrier 子节点，第一个同级或更高层级候选才可能是 exit。物理采购文件、邀请容器、Candidate 连续区间、后续合同章节或相邻另一类硬排除载体都不能替代 root/exit 证明。相邻的公告、须知、合同和响应格式即使地址连续，也必须分别拥有自己的 root 与 exit，不能被拼成覆盖中间独立技术来源的外层载体。该攻击只要求 reason 给出决定性的粗粒度边界，不要求新增 schema 字段、逐 block ledger、角色或调用。

每个连续 Candidate / IN / REMOVE_REVIEW interval 还必须执行一次 `peer_root_fracture_attack`：在每个 source-proven peer chapter、subsection、appendix、table root 或等价功能边界重新判断 Owner。合格 requirement 岛遇到新的四类硬排除 peer root 时，从该 root 到 semantic exit 排除；后续新的合格 peer root 可以重新获得 membership。地址连续、编号、格式、关键词、Candidate 宽度和 permission marker 都不能单独建立 root 或延续 Owner。该攻击只复用同一次调用和现有地址字段，不增加 ledger、角色或调用。

这里的 exit 是语义 Owner exit，不等于结构图记录的任意 `sc/vc` exit。结构 peer 若经 source 判断仍延续同一 Owner，只结束当前物理 scope，不结束载体；必须沿连续的同 Owner peer 继续传递，直到首个不同 Owner 的 peer root 或 EOF。反向地，一旦局部四类 root 成立，排除必须 root-closed：从 root 自身开始，覆盖其全部子条款、表格、内嵌附件以及后续同 Owner peer continuation，直到语义 Owner exit；禁止在该区间内部再启动主要直接效力或 `duty_survival_attack` 来保留服务期、地点、质量、验收、参数等技术后代。结构候选只能帮助定位待读边界，不能自动证明 Owner 已退出。

同时聚合“技术、服务、合同、商务”或其他多类内容的父章只是 mixed container，不给全部子项授予统一 Owner。进入原子效力判断前，模型必须做一次紧凑的 `mixed_container_root_sweep`：读取父章下各 child heading candidate，识别其中 source-proven 的局部四类 root，并先按 root-closed exclusion 关闭这些区间。若暂定结果在同一局部 root 下删除付款、保证金、违约或其他商务/法律子项，却重新保留其后的服务期、地点、质量、验收、人员或技术子项，这种挖洞式选择证明 atom gate 启动过早；必须从 source 否定该 root，或把 root 到语义 exit 的完整区间排除。该 sweep 是一次粗粒度 Owner/边界判断，不是逐 block ledger，也不增加模型角色或调用次数。

四类载体门与 `pre_award_stage_gate` 关闭后，必须执行一次 `outside_carrier_precision_closure`：检查 Candidate 已选混合合格章节中的可分离价格/报价构成、付款、结算、保证金和纯法律后果 atom，防止它们仅因父章合格或相邻 duty 而继承 membership。只有 exact 可寻址、通过 `duty_survival_attack`、`response_wrapper_survival_attack` 与 source-fidelity 检查的 atom 才可删除；不可分 block 仍有直接工作义务时必须保留。该闭合不是关键词扫描、逐 block ledger 或额外调用。

公告 Owner 不以出现“招标公告”“采购公告”等明示总标题为前提。若一个自包含区域按对外通知功能连续组织项目概况、参与资格、文件获取、投标/响应递交、发布媒介和联系方式，项目概况只是该通知序列中的公告性摘要，即使它承载当前项目唯一或最具体的范围、规模、工期和质量事实，也仍随公告 Owner 排除。只有 source 已明确结束该通知序列并进入边界独立的技术来源，才能重新判断 requirement membership；完整邀请文件中的其他并列载体仍按各自 Owner 判断。

孤立的委托代理、公开招标、欢迎投标或邀请参与前言，不会把其所在的招标书、需求书、技术规范或其他多载体采购文件整体转成公告 Owner。该 reset 只在没有真实公告/通知章节或边界完整通知 root 同时包住前言与后续内容时成立；若其后出现 source-proven 的平级采购内容、采购对象、范围、地点、工期、质量、技术要求、图纸或清单 root，应从该 peer root 重新开启 Owner，无需等待显式“公告结束”。一旦 source 已证明真实公告/通知 root，该 root 内编号项目概况、采购范围、期限、地点、标准和技术摘要仍是 descendant，不能调用本 reset 把它们变成自己的 exit；只有该 root 外同级或更高层级的不同 Owner peer 才能重开。

整文角色必须在局部 Owner 分区之前检验，但不能先验冻结。只有实际公告/通知 root 开始后，标题/称谓、开篇邀请报价或响应、内部连续编号、报价资料要求、递交与联系方式、落款及随附报价格式共同形成首尾连续、功能同质的单一沟通，并且直到真实结尾都不存在平级异质 root，整段沟通载体才属于公告/通知摘要 Owner。接受整文公告假设前必须做 `whole_container_disconfirmation`：若 source 出现平级、边界独立的资格、评审、合同、响应格式、需求书、技术规范、图纸、清单或有效技术附件 root，物理文件就是多载体采购容器。封面含“邀请/询价”、首段邀请动作、所有章节共同服务同一次采购，或结尾仍有递交/联系方式，都不能把这些平级 Owner 合并为一个公告；外层采购文件或邀请容器不是第五类硬排除载体。

“项目概况、参与资格、文件获取、递交和联系方式同时存在”只能证明同一个连续通知区域的 Owner，不能跨越已经建立的同级响应格式、合同、评审、技术章节或详细技术附件，把整个物理文件回溯定义为一条通知序列。若这些异质载体以同级结构并列存在，必须先把外层文件识别为多载体采购容器，再在每个真实边界重新判断 Owner。独立技术附件也不因附在邀请文件末尾或属于同一物理文件，就自动继承公告 Owner；仍须按附件自身功能、详细事实载荷和结构边界判断。

在已经证明为多载体采购容器的完整邀请文件中，“邀请书正文”不是第五类硬排除 Owner，也不能作为覆盖全部编号章节的外层载体。邀请前言、通知摘要、获取/递交和联系方式等区域按公告/程序排除；与其同级、功能已经切换为项目范围、采购内容、执行期质量安全、质保售后、技术标准或详细技术附件的区域，直接按自身 Owner 判断，不要求 source 另写“邀请结束”。顶层功能变化、同级章节切换和附件边界本身即可构成 source-proven boundary。只有实际为通知文种的连续区域，才允许公告 Owner 延续到该区域结束。

这里的“同级”必须相对于已经建立的具体公告/邀请载体边界判断，而不是相对于某个局部条目判断。若 source 先建立一个顶层公告或邀请章节，该章节内部的“项目概况”“采购内容”“采购范围”“服务期限”“地点”“质量标准”等次级标题、编号子节和表格仍继承该外层 Owner，直到 source 退出该章节并进入与它平级的独立采购需求、技术规范、图纸、清单或有效技术附件。完整文件同时还有后续采购需求、合同、格式等平级章节，只能证明物理文件是多载体容器，不能把前一公告/邀请章节内部的摘要子节提升为平级技术来源。

物理文件、封面总标题与语义载体不是同一层级。一个邀请、谈判、磋商、询价或其他采购文件可以在同一 Word 中并列承载邀请前言、项目技术需求、资格、响应格式、合同和程序；不能只凭封面名称、首段称谓或文件末尾仍有递交程序，就把全部同级章节继承为公告或邀请摘要 Owner。四类硬排除的结构继承只能从 source 实际建立的具体载体边界开始，并在其真实边界内持续。若完整结构已经进入与公告/程序并列、边界清晰且独立规定当前项目对象、范围、质量、安全、质保、验收或其他可执行技术义务的区域，应按该区域实际 Owner 重新判断；反之，真实公告正文内部的项目概况、采购范围或技术摘要即使是顶层编号，也仍随公告 Owner 排除。模型必须结合整文目的、同级结构、前后过渡和区域功能识别边界，不能把“标题像公告”或“局部像技术要求”任一单信号当作结论。

层级优先于子节内容价值，并先于邀请前言 reset、mixed-container 和多载体整文判断执行。若 source 已建立“第 X 章”或等价顶层载体 root，只有 source-proven 同级或更高层级 peer 才能结束它；章内 `1.`、`2.`、小数编号、表格、清单、项目概况、采购范围、期限、地点、标准和技术摘要仍是更低层级 descendant，不能只因内容像需求就提升为与父章同级的出口。多载体只说明完整文件不属于单一载体，不能取消已经证明的局部命名载体章；邀请前言 reset 在真实命名公告章内部不可用。结构图缺失不授权臆造 peer。

若同一物理文件已经并列形成资格、报价/响应格式、评审、合同以及技术章节或技术附件等完整采购结构，这是“多载体采购容器”的肯定证据，不是“整份文件均为公告”的证据。此时第一类硬排除只覆盖实际承担公告、邀请前言、获取/递交/联系方式等通知摘要功能的区域；其余同级区域分别按实际 Owner 裁决。真实的独立招标/采购公告仍整体排除，不能仅凭顶层编号把公告内部摘要切成技术来源。

典型名称必须按实际文种区分：承载完整采购结构的竞争性谈判邀请书、询价邀请书、投标邀请书或类似邀请文件，不能仅因含“邀请”二字就等同于竞争性谈判公告、询价公告、招标公告或其摘要。前者通常是多载体采购容器；其中邀请前言和程序区域排除，但边界独立的项目概况/采购内容、执行期质量安全、质保售后、技术标准和技术附件仍按实际 Owner 判断。资格章节内部的人员证书、安全资格和投标承诺仍属资格/响应 Owner；退出资格章节后独立规定中标后履约、施工、质量、安全、质保或售后的区域，不得继续继承资格 Owner。

人员类内容必须区分“投标前资格/响应证明”与“中标后履约配置”。若 block 的主要直接效力只是证明投标人或拟派人员具备资格，或要求在响应文件中填写、提交人员表、简历、证书和承诺，它仍属于资格/响应 Owner。一个边界完整的投标/响应强制性要求章节或强制响应表，即使用未来时态描述拟投入岗位、人数、进场时间或证书，也仍是在成交前定义必须提交和承诺的响应载体，应整体按实际 Owner 排除。人员类 Stage Owner 必须在“完整 subsection”与“局部证明 atom”之间二选一：若一个具有明确 root 和 peer exit 的人员 subsection 主要由多项证书、社保、资格承诺、无在建承诺、无效响应后果等共同定义成交前准入或响应证明，则 root 标题及全部子项直到 peer exit 整体继承该 Owner；不能因为其中一个子项同时描述中标后岗位、人数、进场或配置，就在该 subsection 内单独挖出履约岛。只有 source 证明该 subsection 主要是成交后实际履约配置，填写、附证或承诺要求只是可安全分离的局部注释时，才只排除该 proof atom 并保留周围履约义务。若 source 已退出公告、须知、资格审查、投标/响应格式和合同载体，边界独立的采购人要求直接规定中标后必须实际投入的岗位、职责、最低人数、执业条件、驻场/进场时间或持续配置义务，则属于 requirement；不得只因相邻文字出现审批、违约或资格字段而删除。履约期的独立性、职业纪律、利益冲突申报和回避义务直接约束成交供应商及其人员如何执行当前项目，是实施与质量治理事实；只有其主要效力是成交前证明投标主体或人员是否有资格时，才属于资格/响应 Owner。判断依据是实际 Owner、发生阶段和对履约组织的直接约束，不是标题或关键词。

Candidate 已选中四类排除载体时，不能再以“下游会忽略”“内容与项目相关”“包含唯一技术事实”或“只是中性宽度”为由保留。完整或大面积排除载体造成范围稀释、上下文挤占、截断或错误事实 Owner 时，属于 correctness repair；Candidate 语义主干已正确但仍含可安全分离的排除载体时，可作为 `good -> great` 的 scope precision 改善。只有原子地址无法把排除载体与合格技术来源安全拆分时，才因 source fidelity 保留不可分割的混合段落。

冲突证据仍受 Owner 约束。四类排除载体里的复用项目名、示例地点、陈旧期限或其他字面冲突，不应被改写成当前项目技术 wrong direction；删除理由是载体 Owner 不属于 `requirement`。只有合格技术来源中的冲突对象、范围或实施义务，才构成技术方向错误。

评分标题、评分表、评分行、分值和得分后果不属于 requirement 正向覆盖；泛泛点名“施工组织设计”“服务方案”等主题，或在得分条件中列出更细的实施维度，也不能触发新增。评分 Owner 由独立 score-position 能力负责，不能因为其内容对写作有参考价值、比非评分章节更详细或 source 其他位置没有等价展开，就把它改写成采购需求。

Owner 判断优先于局部技术词。若一个普通采购要求段落先独立、命令式地规定具体技术 deliverable，末尾仅附带“作为评分依据”等评价后果，则按其采购要求 Owner 判断；但位于评分表、评分行、评分项或得分条件内部的方案名称、子项清单和实施维度，仍属于评分 Owner，不得作为 residual add。输出地址以段落为原子单位时，Reviewer 不能为了取得评分内容而新增整个评分主 Owner 段落。

评分主 Owner 不允许新增；Candidate 已包含评分主 Owner 段落时，应按 actual Owner 和安全边界精确移除，不得为了删除评分内容伤害相邻合格技术来源。

“等价技术载体”必须位于合格来源，并实际展开同一 deliverable 的具体对象、动作、资源或保障维度。要求供应商通读文件、实质响应、按给定格式编制、不得缺少资料，或提供一组空白响应模板，只是通用合规与格式指令，不能替代 source 其他位置已经明确展开的具体技术方案模块和实施维度。

评分行中的模块名称、子项清单、实施维度、分值、扣分条件以及“未提供不得分”，仍然只是评价后果，不是命令式 deliverable。不能把“要想得分应写什么”改写成“采购人已在 requirement 中明确命令必须提交什么”。

整份 source 的作者关系和使用目的优先于局部段落的技术主题。供应商已经完成并提交的投标/响应成稿，即使复制、引用或承诺遵守原招标文件中的工程范围和技术义务，也不能把这些局部条款重新解释为采购人 requirement；除非 source 中存在边界清晰、可独立归属的采购人原始要求。反之，真实采购人招标文件中的未填写响应模板、空白签章栏和投标人编制指令不改变采购人文件身份。整文关系必须依据开头、中部和结尾共同呈现的文档目的、填写状态和作者关系判断，不得由单个词语触发。

采购事实源不以正式招标文件、盖章发布结构或法律文书形态为前提。采购人侧的需求简报、技术交底、会议纪要、邮件/聊天整理、现场勘查记录、方案委托和内部需求 handoff，只要已经描述当前项目的具体对象、范围、现场事实、工作内容、技术义务或明确要求供应商据此产出方案，仍属于可用 requirement source。协议字段 `source_role=buyer_issued` 在本 capability 中表示“采购人侧需求事实源”，不是对正式发布状态的法律判断。

但 `buyer_issued` 必须先通过 `current_acquisition_gate`：完整 source 必须能同时证明“谁正在向外部取得什么货物、工程、服务或方案产出”以及“本 source 正在为该当前取得/委托建立需求”。已有员工、合作方或供应商如何使用现存系统、执行既有流程、提交表单、接受培训、处理质量/售后/支持事务或遵守内部制度，即使规则具体、动作可执行且面向供应商，也只证明存量运营/履约关系，不证明当前采购。若不能从 source 指出外部取得对象和当前取得/委托关系，且没有边界独立的采购需求区域，整文必须按 `non_procurement` 裁决。

“采购事实源不要求正式法律文书形态”不能反向取消合同载体硬边界。若完整 source 由合同双方/当事人关系、订立或履行合同的总领关系、连续合同条款、价款或结算、违约、生效、解除/续约、争议解决、签署盖章等结构共同形成一份自洽的双边合同，它就是 `source_role=contract`；不能因标题含“服务要求”“技术要求”“协议要求”、大部分篇幅描述具体履约义务、采购人提供该文件或项目已经实例化，就改判为采购需求 handoff。只有合同真实结束后边界独立的技术规范、需求书、图纸、清单或有效技术附件，才可按自身 Owner 重新判断。若完整 source 从头到尾只有该合同载体且无上述独立来源，终态只能是裸 `null`；一旦 reason 已建立该前提，禁止再用“内部义务技术具体”或主要直接效力测试重新打开合同条款。

合同硬排除载体也必须由 source 的真实功能建立，不能由“合同、违约、保密、知识产权、审批、责任、扣款”等局部词语推断。位于边界独立采购技术要求内的源码/成果交付、知识产权保证、保密与数据处理、网络安全、持续维护、周报记录、报审和替换义务，仍按其直接工作效力判断；只有 source 已经进入合同协议、合同条款及格式、履约考核模板或合同附件范本的明确 peer 根后，内部后代才继承合同 Owner。后续合同章节不得反向吞并前一平级合格章节。

“包含真实项目事实”不等于已经证明采购需求 Owner，但“文档像一份完成报告”也不等于已经证明错误 Owner。`buyer_issued` 可以包含采购人交给后续设计、实施、供货、服务或响应方的对象、范围、约束、责任、验收条件、参考事实和方案委托，也可以包含采购包内供技术写作使用的既有项目技术依据。若一份报告、规划、研究、设计或方案已经自行完成分析、取舍和结论，Reviewer 必须主动检查它究竟是采购人提供的项目依据，还是供应商交付物、企业内部材料、无关成稿或其他非采购文件；但不得仅凭完成口吻、结论章节、缺少招标措辞或标题中的“报告”“方案”就整体判空。破坏性整文删除仍需肯定证据证明其错误作者关系、使用目的或与当前采购任务无可用关系；证据不足而内容确实承载当前项目技术事实时，Candidate 保留推定优先。

一份 source 可以是混合作者关系。若采购人侧已实例化需求、供应商疑问/报价/建议和后续方案指令共同出现，不能因为存在供应商文字或缺少正式版式而整篇判为供应商成稿或 `non_procurement`；应按可分离 block 的实际 Owner 保留采购事实、排除供应商响应和商务内容。只有 source 整体已经形成供应商交付的完整方案/承诺/配置成稿，且不存在可分离的采购人需求事实源时，整文供应商响应 veto 才成立。

必须区分“真实项目 source 内含空白模板”和“整份 source 本身只是未实例化模板”。若从开头到结尾只有占位字段、示例文字、编制提示、待填表格和通用条款，没有任何已经实例化的当前采购项目对象、范围、工作内容、技术义务或指向真实项目材料的可执行关系，则该 source 不承载当前采购事实，按 `non_procurement` 处理，正确结果为裸 `null`。模板标题、采购人措辞、通用采购类别和“应填写哪些需求”的说明不构成项目实例化。反之，只要完整 source 中存在真实当前项目的具体采购事实，就不能因为同一 source 非正式、混有沟通/报价文字或包含大量空白格式而整体判空；仍须继续审查实际需求及详细载体。该判断必须基于整文事实状态和作者关系，不能依赖模板名称、行业词、章节位置或单个占位符。

项目实例化必须由能够区分本次真实项目的已填写事实证明，例如实际项目名称、采购对象、地点/现场、明确范围、数量规模、具体工作包或方案委托关系。范本版本号、范本编号、通用法律依据、平台操作规则、默认期限、资格年份、通用质量标准、制式合同义务、空白技术响应菜单和“如有”方案模块不能单独证明实例化。若核心项目锚点全部只是指向公告、技术规范书或其他未随当前 Word 提供的外部材料，则当前 Word 自身仍不承载可供技术写作使用的项目事实；通用条款具有法律约束力也不改变该结论。

范本中的通用供货规则、报价编制说明、空白采购清单、未来填写指令和未随当前 Word 提供的公告/技术规范指针，同样不能建立实例化。一旦整文已经收敛为未实例化模板，该结论是终态：不得再用局部通用供货、价格、质量、遵法或未来履约措辞启动主要直接效力、规范性纳入或 `duty_survival_attack` 来恢复 membership。

实例化证据与合格来源内的技术 membership 必须分开判断。“通用质量标准不能单独证明项目实例化”只限制整文 `instantiation` 门槛；一旦完整 source 已由其他已填写事实证明当前项目真实存在，四类排除载体之外、边界清晰的技术标准/技术规范/采购需求中，只要存在对当前项目可执行的质量、安全、环保、材料、施工、服务或验收义务，就已经具有 requirement 事实载荷。该义务即使采用行业通用措辞、引用现行标准、没有数值参数或只有一条正文，也不能被降格为空标题、外部指针或无事实模板。只有确实没有任何义务正文、仅有标题/占位/示例/未随 Word 提供材料的指针时，才属于非事实壳。

必须区分“规范性纳入”与“裸外部指针”。要求当前项目的材料、设备、施工、服务、质量、安全、环保或验收必须遵守/达到所引用的法律、图纸、规范或现行标准，本身已经建立可执行义务，即使外部标准全文未复制进 Word，也不是空指针。只有文本仅要求另见一个未提供文件、且本段没有声明任何当前义务时，才按裸外部指针处理。

规范性纳入是终态一致性规则。一旦完整 source 已由其他事实证明项目实例化，四类硬排除载体之外、边界独立的技术标准/规范章节只要直接要求当前项目的材料、设备、施工、服务、质量、安全、环保或验收“必须遵守/达到/符合”所引用的法律、规范或现行标准，就已经声明当前义务。篇幅只有数段、措辞可复用、没有项目专属参数或引用文本未复制，都不能把它降格为裸外部指针；只有当前段没有声明任何义务、仅要求另见未提供材料时，才是指针。

孤立的技术章节标题、空标题或“详见/以另附技术任务书为准”之类仅指向未随当前 Word 提供材料的外部指针，不是可交付的 requirement 原文。`non_fact_shell_closure` 必须保持根与正文同向：若一个边界完整的 subsection 从标题到 peer exit 只有“无”、空白、占位、未提供材料的裸指针，或不新增具体任务、流程、输出、时限和结果的泛化遵法/兜底 wrapper，则标题、空内容和 wrapper 整体排除；不能因前一个相邻技术表或履约章节被保留，就单独留下这个无事实标题。若删除四类载体后只剩这类指针或空壳且当前 Word 没有对应详细内容，正确结果为裸 `null`；source fidelity 不能用来保留一个没有事实载荷的非空壳。

任何 Reviewer patch 都必须通过一种且仅一种反事实材料性门槛：

- correctness repair：若保持 Candidate 不变，下游技术方案的大纲、对象、工作包、实施阶段、保障主题或事实基础会实质性错误；
- operational precision：Candidate 已经语义完整，exact remove 不会损失任何不可替代技术事实、工作包、义务、上下文闭合或详细载体，并且保持 Candidate 不变会造成材料性的 token、截断、注意力或证据池可用性负担。

仅让范围更短、更整洁、删除少量普通噪声，或补入资格/商务/报价/纯评分/程序等完整响应文件组成，均不得触发修改。`operational_precision` 只能删除，不能新增，也不能与 correctness issue 混合；存在材料性语义错误时必须优先修复正确性。

“理想提取中不应属于 requirement”只是删除的必要条件，不是覆盖成熟 Candidate 的充分条件。孤立标题、交叉指针、重复说明、少量评分/程序标签或其他不会改变技术写作的同包噪声，即使 Owner 非 requirement，也不得作为 residual repair 发布。

四类硬排除载体不适用“删除门槛高于从零排除门槛”的旧规则。若 exact range 的实际 Owner 明确属于公告、须知、投标/响应格式或合同条款及格式，且可与合格技术来源安全拆分，就应移除；不要求额外证明冲突项目或错误技术工作。其他普通同包噪声仍维持 Candidate 保留推定，不能借本规则扩大清理范围。

统一 Reviewer 只有在完成全部 correctness 审查且未发现材料性语义问题后，才可提交一个 `operational_precision` removal。四类排除载体只要 Owner 明确、范围同质、可独立寻址且删除不伤害相邻合格来源，即可作为 scope precision 改善；“只在该载体出现的技术文字”不会阻断删除。对四类载体以外的普通噪声，仍必须证明删除显著降低下游上下文、token、截断或注意力负担，通常达到完整自包含的非技术章节/附件或约占 Candidate 文本的 10%。零散标题、重复句、单纯风格整理或无法可靠拆分的混合范围必须 `pass`。

任何删除范围都必须是最小且 Owner 同质的精确范围。模型必须在提交或批准前检查该范围内的全部原子段落；四类排除载体中的技术性文字仍随该载体删除，但若范围跨入合格采购需求、技术标准、项目专用技术条款、图纸说明或有效技术附件，则必须缩小到不伤害合格来源的子范围。若无法可靠拆分，保留不可分割的混合段落。该检查只在一次调用内完成，不要求输出逐段 ledger。

合格来源必须保持标题、正文和详细载体闭合。若模型判断一个项目范围、质量、安全、质保、验收、技术标准或其他合格章节应保留，就必须继续检查并保留该标题之后、下一个同级 Owner 边界之前的实质正文；图片占位、空行、跨页符或短续段不会自动结束章节。不能只留下标题或概述，却把同一章节内承载具体义务、参数、措施或责任的正文删除。表头、清单明细、跨页续行和末项同理。

闭合只向合格载体内部延伸，不得反向吞并前一个 Owner 的尾部。独立技术附件、清单或图纸从其自身标题、名称或首个明确内容 block 开始；位于该边界之前的签署主体、日期、签章、落款、页眉页脚和版式图片仍属于前一载体。相反，进入合格载体之后的图片占位、分页和短续段不能被误当作结束边界。

同一 challenge 中的每个新增和删除都必须独立通过对应 Owner、边界和材料性门槛。发现一个真实遗漏，不会降低相邻 Candidate 内容的删除门槛；四类排除载体和评分 Owner 只有在自身范围同质且可安全拆分时才可同时提交，普通页数、否决或程序噪声不得搭载清理。Release 必须在 typed delta 中逐原子表达每个准备执行的删除或新增，而不是因为 challenge 总体有价值就整包接受；未被明确授权删除的 `REMOVE_REVIEW` 自动恢复，不要求模型另做覆盖 ledger。

“一个 challenge”限制的是一个 case-level 材料性问题，不是一个连续物理区间。同一个 Owner/membership 违约若分散在多个可独立寻址的范围中，Reviewer 必须在一次 challenge 内提交关闭该问题所需的全部不连续 add/remove ranges；不能只修最显眼、最大或最先发现的一处，却让同类材料性错误继续留在反事实 final 中。提交前必须在一次调用内机械想象 `final = Candidate + add - remove`，重新攻击该 final 是否仍存在同一问题；这不是逐 block ledger，也不增加调用。

Reviewer 必须先完成语义 final，再在两个互斥删除分支中选择地址更短的一种表达：若完整安全删除岛数量不多于完整保留岛数量，使用 `removal.mode=exact`，在唯一的 `remove_ranges` 中列全删除岛；若完整保留岛更少，使用 `removal.mode=candidate_complement`，在唯一的 `preserve_ranges` 中列全保留岛；数量相同时使用 `exact`。若只有一个分支能落入 64 个 range 的 schema 容量，则使用可表达的分支。整文 veto 或 `instantiation=absent` 形成裸 `null` 时，保留岛为零，使用 `candidate_complement` 与 `preserve_ranges=[]`。该选择只是语义收敛后的地址压缩，不能拿宽度、比例或书写方便替代 membership 判断。Harness 确定性计算 Reviewer 提案 `proposed remove = Candidate - preserve` 供 trace 和闭合检查；哪些岛应保护仍完全由 Reviewer 依据完整 source 判断。Reviewer 必须让每个 `preserve_range` 完整落在一个已给出的 Candidate interval 内，遇到任一 OUT gap 必须拆分。Harness 对误跨 OUT gap 的范围只做与 add/remove 方向裁剪同构的机械交集 `effective preserve = submitted preserve ∩ Candidate`，绝不把 OUT block 加入 final；若非空 preserve 与 Candidate 完全无交集则 fail-closed。

Reviewer 的结构输出只需要一份互斥删除表达。`exact` 分支必须围绕 reason 明确认定保留的 Candidate block 拆分；`candidate_complement` 分支则在 `preserve_ranges` 中完整列出全部保留岛。不得再输出与 removal 重复表达同一语义的第二份保护集合；独立 Release 已承担 envelope 内的过删攻击。

`source_role=non_procurement` 或 `instantiation=absent` 是 Reviewer 已作出的整文语义结论，不是 Harness 从关键词推断的结论。Harness 只做终态一致性校验：该结论不能与非空 Candidate final 或新增 block 同时成立；若结构字段没有覆盖完整 Candidate，必须 contract-fail 并原样保留 Candidate，不能由代码补删。

Reviewer 的 reason、证据线索和原始 `preserve_ranges` 始终对 Release 隐藏。`removal.mode` 只决定 Reviewer 如何在 64 个 range 的地址容量内表达删除提案；机械归一化后的 `effective removal` 标记为 `REMOVE_REVIEW`，challenged add 标记为 `ADD_REVIEW`，固定 Candidate edge 地址窗口标记为 `BOUNDARY_REVIEW`，其余 Candidate 标记为受保护 `BASE_KEEP`。Release 只显式投影准备执行的 `hard_excluded_ranges`、`outside_carrier_excluded_ranges` 与 `accepted_add_ranges`；所有未被 exclusion 明确授权的 `REMOVE_REVIEW` 都由 Harness 自动恢复，并可在结果 trace 中记录机械派生的 `restoredRemoveRanges`。它同时对完整 Candidate 执行一次四类硬排除载体 root→semantic-exit 覆盖检查。通常只有 Release 明确写入 `hard_excluded_ranges` 的 Candidate block 才可越过 `BASE_KEEP`；若完整普通 removal 已被 Harness 撤销，则任一 Candidate hard hit 可按唯一连续 residual 规则解锁机械 outside-carrier 权限并禁用 `BOUNDARY_REVIEW`。普通 bounded patch 则必须先有至少一个同时属于 `REMOVE_REVIEW` 的 Candidate hard hit，才可按同一唯一连续 residual 规则解锁；仅在 `BASE_KEEP` 中发现 hard carrier 不解锁。Reviewer no-change audit 同样把全部 Candidate 作为 `BASE_KEEP`，不授予 residual、ordinary delete、boundary 或 add 权限；它只允许完整 Candidate 的整文终态 veto，或独立四类 hard-carrier subtraction。普通 OUT 仍不可加入。它不是完整 Candidate 重提取。

Harness 可在固定 128 block / 20k 字符预算内，只为 `REMOVE_REVIEW ∪ ADD_REVIEW ∪ BOUNDARY_REVIEW` 生成 text-blind challenged-side 原子导航，并附加确定性的即时边界上下文；超大 change side 只按连续 run 的固定首尾窗口、递归分层地址和邻居采样，按地址倒序渲染。`BOUNDARY_REVIEW` 本身另由 Candidate 每个连续区间首尾 ±2 blocks 的固定地址规则生成，不读取正文、标题、结构含义或 Reviewer 结论；它只能授权完整 shell-body 闭合，不能授权一般 OUT 搜索，完整 body 超出窗口时必须整体拒绝。Harness 还可只依据地址集合列出有界的 `REMOVE_REVIEW ↔ BASE_KEEP` 连续 run 转换，不复制完整 Candidate、不读取正文，也不把 marker 转换解释成章节出口。若存在 answer-free Word 结构图，Harness 只把与 challenged side 相交的现有结构行在固定 64 节点 / 8k 字符预算内重列为 `CHANGE_STRUCTURE` focus。代码不得读取标题、关键词或正文内容。这些视图只辅助定位，不增加证据、语义标签或答案；只有本文明确规定的机械地址权限可执行，完整 source 始终是唯一事实来源。

删除 schema 必须在生成阶段消除方向冲突：`exact` 分支只存在 `remove_ranges`，`candidate_complement` 分支只存在 `preserve_ranges`。同一提交若仍以旧字段或非法结构同时表达 remove 与 preserve，属于 contract failure，Harness 必须 fail-closed 保留 Candidate；不得再由代码执行 `remove - preserve`、猜测模型真正意图或选择更接近评测答案的集合。

remove envelope 的 block 数、字符数、覆盖比例和是否恰好等于完整 Candidate 都只是权限与预算元数据，不是 Reviewer 的删除票数或目标删除比例。Release 必须逐原子裁决 `REMOVE_REVIEW`、`ADD_REVIEW` 与 `BOUNDARY_REVIEW`，但只需显式提交 source-grounded 的安全删除或新增；未提交到任一 exclusion 的 challenged block 自动恢复。`REMOVE_REVIEW` 不是删除票，`BASE_KEEP` 也不是语义真值；两者之间的 marker 转换也不是 Owner exit。完整 removal 只触发地址形状安全降级，不证明任何内容应保留或删除；所有 residual 权限都只能由同次 typed hard delta 在完整 Candidate 上机械留下的唯一非空连续地址岛获得，普通模式还必须有 confirmed `REMOVE_REVIEW` hard hit，最终 outside-carrier 删除仍完全由 Release 明确提交。

Release 的对抗性检查必须是有界反例问题，不是第二份整文答案或逐 block ledger：`over_deletion_attack` 只攻击 `REMOVE_REVIEW` 内的真实范围、实施、资源、工期、质量、安全、质保、验收、服务及同一合格 Owner 的标题—正文闭合；对 `ADD_REVIEW` 则攻击错误 Owner、错误项目/包、排除载体和无事实负载；对 `BOUNDARY_REVIEW` 只攻击它是否确为相邻 selected shell 的完整同 Owner body，以及所需闭合是否越过授权窗口。对每个 challenged outside-carrier removal 必须执行一次紧凑的 `duty_survival_attack`，检查被审批、合同、保密、证明、违约、费用或结算语言包围的 block 在剥离附带后果后是否仍有直接工作义务。不得扩张成对 `BASE_KEEP` 的全局 false-protection sweep，也不得把 `BOUNDARY_REVIEW` 扩张成普通 OUT 召回。

Release 不提交完整最终集合，只提交 `hard_excluded_ranges`、`outside_carrier_excluded_ranges` 与 `accepted_add_ranges`。Harness 将 hard exclusion 裁剪到 Candidate、`ADD_REVIEW` 或 `BOUNDARY_REVIEW`，将 outside-carrier exclusion 裁剪到 `REMOVE_REVIEW ∪ ADD_REVIEW ∪ BOUNDARY_REVIEW`，并在当前 hard-boundary residual 模式满足解锁条件时额外允许落入由同次 hard delta 机械派生的唯一非空连续 Candidate residual；accepted add 只裁剪到 `ADD_REVIEW ∪ BOUNDARY_REVIEW`。随后只减去两个 exclusion 字段明确授权的 block，把其余 `REMOVE_REVIEW` 机械恢复并派生 `restoredRemoveRanges` trace。accepted add 对重叠 exclusion 优先；冲突 exclusion trace 随之去除最终保留地址并消除重叠，再按固定公式派生 final。Harness 只执行这些集合约束，不读取 reason，不推断 Owner、membership 或安全删除语义。

任何使反事实 final 变成裸 `null` 的 challenge 都承担完整外部召回义务。Reviewer 必须先检查四类硬排除载体之外的全部顶层区域、载体边界过渡和不连续 OUT 岛，确认不存在独立采购需求、技术标准和要求、项目专用技术条款、图纸/设计说明、清单或有效技术附件。合格来源可能只有数段并夹在很长的合同、格式或程序载体之间；长度短、Candidate 未选或相邻载体很大都不能成为跳过理由。

### Single-prompt 衍生 Agent 的统一净价值指标

本节是当前采购需求 Reviewer、评分办法 Reviewer，以及之后所有从成熟 single-prompt candidate 衍生的 Reviewer、Repair 或 Release Agent 必须继承的评估合同。运行前必须冻结 candidate、产品语义合同、评测分母和独立 evaluator；运行时不得看到 `bad`、`good`、`great` 标签或任何评测答案。

- **`bad -> fixed` 是主指标**：`bad` 表示 candidate 存在会实质改变技术方案大纲、采购对象、工作包、实施阶段、保障主题、事实基础、文件角色或方向的材料性语义错误；`fixed` 表示最终结果关闭了该 case 的全部材料性错误，而不只是补回或删除其中一部分。修复率为 `fixed bad cases / all frozen bad candidate cases`。
- **`good -> great` 是次指标**：`good` 表示 candidate 已满足冻结的材料性正确性合同，但仍可能包含可安全分离的四类硬排除载体或其他经预先冻结的材料性运营负担；只有在运行前由独立评测规则确认仍存在明确改进空间时，该 case 才进入 `good -> great` 分母。`great` 必须在不丢失任何合格来源技术事实、不引入错误项目/对象/Owner/方向的前提下，清除可分离的排除载体，或显著改善范围精度、下游 token/截断风险、延迟、注意力负担和证据池可用性。单纯更短、更整洁，或删除不属于四类硬排除且不会实质影响下游的普通同包噪声，不能自动记为 `great`。
- **必须同时报告保护与失败象限**：至少报告 `bad -> fixed`、`bad -> bad`、`good -> great`、`good -> good` 和 `good -> bad` 的 case 数、分母和比例。`bad -> bad` 即使局部改善仍不算修复；`good -> bad` 是阻断性回退，不能被 `good -> great` 或等量 `bad -> fixed` 抵消。
- **仅为评估口径，不是运行 profile**：所有 case 必须进入同一个 Agent、同一个 Prompt 合同、同一个工具入口和同一调用预算。运行时不得接收、推断或选择 `bad`、`good`、`fixed`、`great` 模式，不得顺序运行 correctness 与 operational 两套 Reviewer，也不得按 case 切换 Prompt、模型或 patch 权限。Agent 只依据 source 与 candidate 做一次统一残差审查；独立 evaluator 在 raw result 落盘后才分类 transition。
- **语义轴与运营轴分开计分但不拆 Agent**：`bad -> fixed` 只能由材料性语义正确性决定；`good -> great` 只能由预先冻结、可复核的下游价值标准决定。统一 Agent 可以在同一产品合同内修复材料性语义错误，或在无语义损失时产生材料性运营改善；两类结果使用同一运行路径，只在事后评估中分开统计。对任何已知开发案例都不得启用专属运行模式或 case-aware 路由。
- **不得挑选案例或结果**：分母必须在运行前锁定，所有 transition 由同一冻结 evaluator 在 raw result 和 trace 落盘后统一裁决。不得只展示成功修复、把 degraded/provider failure 从分母删除、在多个 Prompt/模型/run 中挑优，或查看标签后改变路由、阈值、调用次数和最终输出。

质量结论应以净 transition 为核心，而不是只报最终正确率。最终正确率回答“现在有多准”，`bad -> fixed` 回答“Agent 修复了多少 single prompt 的真实错误”，`good -> great` 回答“Agent 在不伤害正确性的前提下创造了多少额外产品价值”；三者必须分别报告，不能互相替代。

## 三、通用性北极星

代码架构和语义 Prompt 必须面向任何项目性质的招标文件，不得依赖项目名、行业词典、采购人、模板、章节位置、固定编号、已知 case 或历史答案。

当前 packet 以 Word 段落为地址合同，但语义规则必须对下列等价变化保持稳定：

- 工程、货物、服务之间的项目类型变化；
- 标题、正文、表格、合同、附件、响应格式和 OCR 噪声之间的载体变化；
- 章节重排、编号变化、表格跨页、附件拆并和长短文档变化；
- 相同语义在不同项目术语下的表达，以及相似版式中目标/非目标 Owner 的切换。

通用性是需要 sealed holdout 证明的目标，不是声明。已查看答案的 case 只能作为开发回归集。

## 四、代码与 Pi Agent 边界

不可妥协红线：代码只负责通用 Agent harness 的薄适配和原子化机械能力，不能负责任何采购语义判断。

Active Pi-native 路线必须最大化复用 Pi Agent 底座的模型循环、同一 Agent loop、确定性的 neutral-replay 上下文转换、工具调用、provider、流式响应、取消和基础错误处理。Extension 只负责：

- 不可变 answer-free packet、SHA、provider/model 与 Prompt/schema provenance；
- canonical `段落N` 地址、范围解析、连续地址 run、集合一致性和最终 patch；
- answer-free Word 布局事实的 hash 绑定、严格校验和有界呈现；
- 调用前对 Finalizer 第二轮与 Witness 最坏上下文做容量预检、固定三调用上限、Token/输出/超时/取消预算；
- Finalizer 与 Witness 的严格 schema、Witness focus 和 trace；Finalizer `owner_reason` 的机械 schema 硬上限每轮均为 1200 字符，第一轮 provisional `residual_reason` 以 2400 字符为压缩目标、8000 字符为机械硬上限，第二轮 final delta `residual_reason` 的机械硬上限为 2400 字符。代码不解释 reason 语义，也不得静默截断超限语义文本；每张 Witness `source_conclusion` 只保留非空白校验与全局 2400-token 预算，不对自然语言字符数设本地 hard gate。Witness 必须返回完整 `owner_boundary_challenges` / `remove_from_provisional` / `add_to_provisional` 三 array，空数组为 `[]`；三者分别 0-1 张 typed Owner span、0-2 张 atom-only remove、0-1 张 owner-boundary 或 atom add，总卡数最多四。Harness 只接受一次纯 JSON text，以原生 `JSON.parse`、TypeBox 和交叉字段规则严格校验；缺字段、`null`、字符串 `"null"`、空 card、旧 exclude/select/attacked_premise/none/primary/secondary、direction 或额外字段全部 fail-closed，不做兼容归一化；
- Witness 输入可携带受既有 schema 限长的 provisional `owner_reason` / `residual_reason`，但必须在 source、`MECHANICAL_TARGET_AUTHORIZATION` 与 `PROVISIONAL_HARD_ROOT_CLAIMS` 之后，以 `UNTRUSTED_PROVISIONAL_RATIONALE` 原样机械序列化。normalized reason 还必须按 UTF-16 code unit 复核 1200/8000 上限；每个 code unit 预留最多 6 个 JSON characters，并把固定 object envelope 与 marker 计入 55272-character rationale line bound。source/auth/claims 与 rationale 共享 190000 serialized-character budget，effective focus cap 为 `min(180000, 190000 - actual rationale line length)`。代码不得摘要、解释、提取关键词、生成攻击方向、根据 rationale 语义/内容选择 focus，或把它转成证据/修复方向；只可按 serialized length 机械缩减 effective focus budget。Witness 的 target、support 和 `source_conclusion` 仍只能由可见 source 与机械权限证明；
- Finalizer 将 `exit_block_id_exclusive` 写成完整 source 末端 block ID 加一时，Harness 只可把该 one-past-end 地址表示机械归一化为 EOF `null` 并记录 raw/normalized submission；这不证明 hard root 成立、Owner 延续到 EOF 或任何正文 membership，其他不存在或非法 exit 仍 fail-closed；
- Finalizer 的 raw tool arguments、normalized structured submissions，以及每轮普通 auxiliary text 的字符数、SHA-256 与 `forwarded=false` trace；不持久化 raw Finalizer assistant message，该 text 不进入后续模型 context、任何语义判断或 patch；
- 第一轮只对 provisional `run_selections` 执行 run 权限投影：允许非空、单连续授权岛加普通 `OUT` spill 的机械裁剪；全 `OUT`、cross-run、multi-island 或不存在地址必须 fail-closed。第二轮 `run_deltas` 不得 spill：remove 只能引用同 run 的 provisional-selected 地址，add 只能引用同 run 的 provisional-excluded 地址；双钥匙 Owner span 无需在 remove 中重复枚举，`accepted_owner_boundary_challenge_indices` 只能含 0-1 个稳定 index；错误 membership、重复 block/run、空 per-run delta、cross-run、OUT 或不存在地址全部 fail-closed；
- 在任何逐 card 动态判断前，对 Witness 所有 Owner span 的 root/exit/anchor、所有 singleton target range 与 supporting ID 统一做完整 source 地址校验；非法或不存在地址整 Witness fail-closed。随后只按最终实际序列化的 focus 与 audit universe 做原子权限校验：Owner anchor 必须出现在 `source_ordered_blocks`、位于 `[root,exit)`、属于 `S0` 与 `AUDIT_UNIVERSE`，root 与非 EOF exit 必须可见；`remove_from_provisional` target 必须完整位于对应 authorization range，`add_to_provisional` target 同理，全部 singleton target 必须属于 `AUDIT_UNIVERSE`。authorization 外的 visible block 只可作 support，support 只须真实存在且进入全局 focus。source 中存在但 focus/slot/group/universe 越权时拒绝整张 card，不裁剪、不补洞、不把同向地址过滤成残余 challenge；其他有效 card 继续。只有 Owner slot 非 `valid_challenge` 且 exclude/select 两个 atom lanes 都是 `rejected_source_focus` 才使 Witness fail；
- 仅对权限有效的 Witness card 做 typed Owner 或 claimed/unclaimed 机械分区；rejected 原始 card、slot/index 和 typed reason 只进入 trace 并标记 `forwarded=false`，不得把其 span/range、premise、support、error 或错误地址转发给 Finalizer；
- 仅按 typed provisional hard-root claim 与地址连续性，为 projected 与 no-projection 两类 claim 的每个 root 和非 EOF exit 加入目标地址及前后最多两个实际 source block；只有 projected claims 为其 projection 连续岛加入固定首尾各两个 block，并参与 unclaimed/overlap/最终一致性。全部 focus block 去重后在 `source_ordered_blocks` 中按 `block_id` 严格升序、每个 block 和正文只出现一次，且不内嵌 provisional state、target permission 或 root projection。`MECHANICAL_TARGET_AUTHORIZATION` 仅由可见地址、AUDIT_UNIVERSE 和 provisional membership 机械生成 singleton target 权限，Owner span 另做 typed root/exit/anchor 地址授权。source、authorization、claims 的实际合计序列化预算为 180000 characters；Harness 始终在各 selected islands 间 round-robin，并用确定性的 breadth-first recursive-midpoint 顺序覆盖岛内 block，固定 256-block 预算容纳时必须完整展示全部岛内 block。岛内 midpoint 队列耗尽后，再以剩余预算和 `packet.blocks` source-order index 从每岛首尾向外逐层 round-robin 扩 focus，不得用 `blockId ± N` 代替 source 邻接，不能让早期长岛饿死后续岛；该窗口、权限和调度都不证明 claim、Owner、membership 或修复方向；
- 仅在 Finalizer 显式提交一个有效 accepted Owner challenge index，且 final hard-root claim 与其 carrier/root/exit exact match 时，机械形成 `A=S0∩[root,exit)`；accepted array 为空时不投影，显式 index 未知或无 exact claim 时 fail-closed 且不投影。按 `S=(S0-A-Δ-)∪Δ+` 机械派生 final selection，校验其与 final hard-root projection 零交集，并在任何失败时保留 Candidate。代码只做地址、focus、authorization 和集合投影，不判断 Owner span 的语义真伪；

Candidate-S0 两调用实验允许 Harness 在本次完整 source 内，从 `《》`、`“”`、`「」`、`『』` 或英文双引号中提取 2-80 字符的 bounded seed，只做 Unicode 空白折叠，再按大小写、标点和其他字符完全不变的 exact literal occurrence 定位 source blocks。seed 扫描按 `S0` blocks source order 优先、再按 `OUT` blocks source order进行；这只是确定性容量调度，不是语义风险筛选，也不要求定界符首次出现在 `S0`。只有至少一个 occurrence 位于 `S0` 且全 source 共命中 2-8 个 distinct blocks 的 seed 才可进入索引，因此同时允许 `S0↔S0` 与 `S0↔OUT`；9 个以上 fanout 必须整项省略，不能转发截断地址。最多扫描 256 个 seeds、输出 24 个 entries、每侧最多 8 个 block IDs；seed/entry/fanout omission 与截断状态进入 trace，算法和全部上限进入 capability identity。该索引只能作为两个角色共享的 bounded、non-exhaustive source locator，不判定引用方向、纳入关系、同一 module、固定/填充状态、对象/功能对应、intro applicability、Owner、recovery、membership、材料性或修复方向，不生成 challenge、root、audit、add envelope、delta 或发布权限；命中、未命中、high-fanout omission 和任一层上限截断都不是语义证据。两个角色必须回到完整 source 独立证明结论，且 Finalizer 接收的必须是同一份原始机械索引，不能是 Challenger 挑选或改写后的子集。

Candidate-S0 两调用实验还允许 Harness 从同一次不可变 packet 与冻结 `S0` 一次性生成 `CANDIDATE_S0_SOURCE_PROJECTION_JSON`，按 packet source order 原样平铺全部且仅 `S0` canonical blocks，每个 block 恰好一次，只含 block ID 与完整 text。Challenger 与 Finalizer 必须接收 canonical serialized payload 完全相同的 projection；不得截断、采样、摘要、重排、按关键词/地址/模型答案筛选或在两次调用之间改写。projection 只是 answer-free 的完整 `S0` coverage queue，不是第二事实源、风险排序、keep/remove 票、Challenger claim、语义证据或地址扩权；相邻 entries 也不证明原文相邻、heading `D(h)`、peer/root/recovery 边界、Owner 连续或 actor 继承。所有语义结论仍须回到完整 source，由模型独立完成。Harness 只可机械记录 projection block count、serialized character count、SHA、两个 role input SHA 和容量影响；case-specific projection SHA 不得进入 capability hash。

代码不得读取标题或正文含义，不得生成 semantic challenge、Owner 结论、membership 结论、修复方向或自动 override，也不得在 repair card 中硬编码价格、法律、载体、资格、heading 等业务攻击指令。所有语义原则只能进入受 Prompt hash 约束的 active Prompt。Witness 只提供模型反例；Finalizer 必须自行接受、反驳、收窄或撤回 claim。非空 Candidate 的 Candidate-only universe 与空 Candidate 的完整 source universe 只由地址集合和 Candidate 是否为空确定。

以下旧 overlay、`REMOVE_REVIEW`、`BOUNDARY_REVIEW`、residual unlock 与两角色隔离细节只适用于 V1 legacy 工具：

- 不可变 packet、SHA 和 answer-free 边界；
- canonical `段落N` 地址、范围解析、集合差异和机械合并；
- schema、上下文预检、调用/Token/超时预算；
- 对工具参数做不读取正文的语法归一化：可去除字段名前缀，或从单元素数组/单层对象中提取唯一一个 schema 允许的枚举值；若不存在唯一合法值必须 fail-closed，禁止从 reason、正文、Candidate 或默认业务假设推断枚举语义；
- 对非空 Candidate 的 Reviewer contract failure 执行权限降级：完整 Reviewer proposal 作废，不生成 challenge overlay，只进入与 pass/no-op 相同的受保护 terminal-or-hard Release audit；该降级只依据 contract validity 和 Candidate 是否为空，不读取正文、reason 或 case 身份；
- Reviewer/Release 上下文隔离、失败分类和 trace；
- 同源 Word 结构证据的 hash 绑定、schema 校验、高置信 block 对齐校验、内容盲压缩和有界呈现；
- 仅按 Candidate 连续区间地址生成固定 ±2 block 的 `BOUNDARY_REVIEW` 窗口，并在 full-removal safety mode 中机械禁用；代码不得据此判断相邻内容是否属于正文、表格、清单、续行、附件或同一 Owner；
- 仅按 Candidate/remove/hard 地址集合检测完整 removal、撤销普通 envelope，并机械派生 hard-boundary residual 权限：full-removal safety 接受任一 Candidate hard hit；普通 bounded patch 必须至少有一个 hard hit 同时属于 `REMOVE_REVIEW`；两种模式都要求完整 Candidate 只剩一个非空连续地址岛；
- 将模型明确批准的增删机械应用到 candidate。

除前述受限 exact-delimited-string occurrence locator 外，代码不得依据关键词、标题文本、表格内容、章节位置、source hash、case ID、历史错误类型或任何弱信号判断 keep/drop、文件角色、评分、资格、价格、供应商成稿、material loss 或最终范围。代码允许仅依据地址集合、Word 的非语义格式字段和前述只做空白折叠与 exact literal occurrence 的 bounded locator，确定性形成地址导航；不得把这些地址或格式节点转换成公告、合同、响应格式、采购需求、引用、recovery 或 membership 等语义标签。代码也不得生成语义 challenge、修改模型方向、补齐遗漏或选择更接近已知答案的结果。

`operational_precision` 的 10% Candidate 字符门是机械安全门，不是代码语义判断。只有模型已经把本次 challenge 声明为 `operational_precision`、且机械裁剪后的有效 patch 没有新增 block 时，Harness 才按完整 Candidate 与拟删地址的字符数计算比例；低于门槛就机械归一化为 `reviewer_noop_challenge`。若同一提交存在有效新增，`operational_precision` 与其 remove-only schema 机械矛盾，Harness 只把非权威 issue label 降为 `unspecified` 后交给独立 Release，不读取 reason 或正文、不决定新增是否正确。空 Candidate 保留后结束；非空 Candidate 的低于门槛 remove-only challenge 不获得普通 patch 权限，只进入 terminal-or-hard veto Release audit。代码不得根据正文内容重新分类 issue type，也不得把该比例用于任何 correctness challenge。

## 五、Baseline-free 与禁止作弊

运行时只能读取公开任务合同、不可变 source packet、冻结 candidate 和当前 run 内产生的消息。不得读取或接收：

- expected、gold、reference answer 或人工修正 ranges；
- Production、xq-agent、其他 Pi 路线或竞品输出；
- evaluator 标签、winner、scorecard、通过/失败结论；
- 同一 case 的历史答案、报告、缓存决定或答案映射；
- 从 case ID、文件名、source hash 或已知 block ID 到答案的规则。

可选 Word 结构证据必须来自本次 source 对应的原始 DOCX，并在第一次语义调用前完成 source hash、block count、严格递增 body order 和高置信对齐校验。不得从 expected、evaluator 或历史答案构造、修订或筛选结构节点。

Candidate-S0 exact-delimited-string occurrence index 只能由本次不可变 source 与冻结 `S0` 机械重建；不得读取外部附件文本、Production 或其他 Agent 输出、历史 run、case 元数据、evaluator 或答案来新增、删除、排序或筛选 seed 与 occurrence。

Candidate-S0 source projection 同样只能由本次不可变 source 与冻结 `S0` 机械重建；不得读取 expected、gold、evaluator、历史 run、其他 Agent 输出或 case 元数据来选择、排序、删减、摘要或改写任何 block。

评测必须在 Agent raw result 和 trace 落盘后独立进行。离线代码只能比较结果，不能在计分前执行生产路径中不存在的语义补丁。

## 六、成本与调用上限

Active Pi-native 每个 case 固定最多三次 provider call：GLM Finalizer provisional、Doubao 2.0 Pro Witness、同一个 GLM Finalizer final。成功发布必须恰好三次；失败路径可提前终止。Finalizer provider 边界最多两次，首轮无合法 provisional 时立即停止，第二轮后无条件停止；每轮必须恰好一个目标工具调用，owner reason 硬上限 1200 字符；第一轮 residual reason 目标 2400、硬上限 8000 字符，第二轮 residual reason 硬上限 2400 字符。普通 text 若出现只能作为不参与结果的 trace-only auxiliary output；Finalizer thinking、未知或额外工具仍拒绝。Witness 无论是否发现反例都只调用一次。无 retry、第四次调用、投票、best-of-N、逐 block ledger 或自由读搜 loop。两次 Finalizer 始终关闭 thinking。Witness 默认 `thinkingMode=disabled`；仅允许预先声明的 sealed A/B runner 在第一次语义调用前把整个 run 显式冻结为 `enabled`，不得依据 case、正文、provisional、答案、评测标签、历史结果或 provider 返回选择或切换。Enabled 与 disabled profile 使用相同模型、source/focus、Prompt、exact schema、2400-token provider-visible JSON response 上限、三调用合同和 no-retry 规则；唯一实验变量是 provider Witness thinking runtime 及其对应 reasoning 预算。Provider-reported hidden reasoning 与可见 JSON output 分开记账：disabled profile 的 run reasoning 上限为 1000 tokens，enabled profile 为 6000 tokens，原有 20000-token run 总 output 上限继续生效。provider payload 始终删除 reasoning effort，发送 `response_format={"type":"json_object"}` 与冻结 profile 对应的 `thinking={"type":"disabled|enabled"}`。Disabled mode 只允许唯一 JSON text；enabled mode 可额外包含至多一个 thinking block，但 Harness 不读取其语义、不持久化正文、不转发给 Finalizer，只记录 mode、block count、character count 与 `forwarded=false`。唯一权威 Witness 输出仍是恰好一个完整 JSON text，并继续经过严格 `JSON.parse`、同一 TypeBox schema 和 per-card 交叉字段校验。provider JSON mode 或 enabled thinking 都不构成语义裁决、本地合同替代或质量提升证明；质量收益必须由预先冻结、无答案泄漏的 sealed A/B 独立验证。

调用前必须用 answer-free、确定性的上下文估算做容量预检。provider、capacity、timeout、abort、budget、全局 JSON/turn/schema/cross-field、完整 source 地址、Owner slot 非 `valid_challenge` 且 exclude/select 两个 atom lanes 均为 `rejected_source_focus`、调用数或最终一致性失败均不应用语义改写，Candidate 原样保留并标记 degraded。单张 card 的 focus/slot/group/universe 动态越权只把该原始 card 机械降为 `rejected_source_focus`，不增加调用、不触发 retry，也不阻断其他有效 card 与第三次 Finalizer；成功结果必须显式标记 `partial` coverage。上述非空单岛普通 `OUT` spill 的最小权限投影只是删除模型无权选择的地址，不是 range failure、语义补丁或答案裁决；其他越权形态仍失败关闭。上游 Candidate 成本与新增 Agent 成本分开报告。

Candidate-S0 Challenger/Finalizer 实验固定最多两次 provider call；完整机械 `S0` source projection 与 exact-delimited-string occurrence index 只进入这两次既有输入与容量预检，不增加第三次调用、retry、模型角色或 ledger。Finalizer preflight 必须计入 projection 的完整实际序列化长度；容量不足时在第一次付费调用前 fail-closed，不得裁剪 projection 或回退到旧上下文。

以下两调用成本规则只适用于 V1 legacy baseline：

- 空 Candidate 的 Reviewer pass / 机械 no-op：新增 1 次 Doubao 2.0 Pro 语义调用；
- 非空 Candidate：固定最多新增 1 次 Doubao 2.0 Pro + 1 次 GLM 5.2；contract-valid challenge 走 bounded patch Release，pass / 机械 no-op / Reviewer contract failure 走 terminal-or-hard veto Release audit；
- 无 retry、第三角色、投票、best-of-N、逐 block ledger 或自由读搜 loop；
- Reviewer provider、capacity、timeout、budget failure，空 Candidate contract failure，或任一 Release failure：0 次语义改写，candidate 原样保留并标记 degraded。非空 Candidate 的 Reviewer schema/range/terminal-contract failure 只撤销 Reviewer 权限，不阻断同一固定两调用预算内的独立 terminal-or-hard veto；不得把它实现成 Reviewer retry、答案驱动路由或普通 patch fallback。
- schema 合法但经 candidate membership 机械归一化后净变化为空的 challenge，不是语义失败；空 Candidate 记录 `reviewer_noop_challenge` 后结束，非空 Candidate 进入 terminal-or-hard veto Release audit。
- 模型声明为 `operational_precision` 且拟删字符低于完整 Candidate 10% 的 challenge，同样机械归一化为 no-op；空 Candidate 结束，非空 Candidate 只进入 terminal-or-hard veto Release audit。该门不适用于模型声明的 correctness issue。

报告必须把上游 candidate 成本和新增 Reviewer 成本分开，记录每个角色的 model、input hash、Prompt/schema hash、调用数、Token、延迟和终态。

## 七、质量晋级

每次变更必须同时报告：

- `bad -> fixed`、`bad -> bad` 及主修复率；
- `good -> great`、`good -> good`、`good -> bad` 及次提升率；
- candidate preservation、degraded、provider failure 和 contract failure；
- 新增调用、Token、延迟和上下文容量；
- 已知开发集、正确控制组和新的 sealed holdout。

只有在新盲测上证明净准确率提高、正确控制组无材料性回归，并且没有答案泄漏或代码语义裁决，才能声称 Agent 方式提高了 single prompt 的正确率上限。
