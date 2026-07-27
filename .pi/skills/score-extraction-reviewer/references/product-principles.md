# 评分办法提取 Reviewer Product Principles

本文档是 Score Extraction Reviewer 的最高约束，适用于所有运行路线、Prompt、Extension、开发回归、盲测和质量结论。任何实现或评测即使分数更高，只要违反本文档，也视为无效。

## 一、核心目标

从任意项目、任意行业、任意采购类型和任意内容格式的招标文件中，输出能够直接驱动当前项目技术标或服务方案写作的高质量评分办法原文范围。文件必须先通过可核验的机械适配层形成不可变 source units；语义核心不得依赖某一种文件格式、解析器或版式。

产品目标不是给 Locator 或 accepted Prompt 套一层 Agent 外壳，也不是提取整份评标办法。已经迭代成熟的 single-prompt candidate 是本产品必须复用的第一份语义判断，而不是应被 Agent 从头替换的临时草稿。复用至少包括冻结 candidate 输出、accepted Prompt 原文/hash provenance 和其中仍有效的通用语义资产；但第二角色不得机械复制旧 Prompt 的输入/输出接口、container-first 偏差或已证明会产生共同错误的判断拓扑。Agent 的新增价值必须集中在 single prompt 仍会出错的残余 5%～10%：通过可复盘、source-grounded 的正交残差攻击和有界终审，在保护 candidate 已正确结果的同时提高最终正确率上限。若只增加工程包装、重复生成同一稿却没有产生相对 candidate 的净语义改善，只能称为 capability packaging 或 parity，不能称为质量提升。

当前 candidate-protected 质量候选路线采用 v9 bounded targeted repair：Residual Issue Reviewer 接收 candidate，但只把它视为不可信外部 patch，不接收 accepted Prompt、accepted 身份、历史判断或评测信息。Call 1 不生成必须整套接受的第二答案，而是通过一份完整 ranges 打开疑似遗漏/污染 challenge envelope；因为 envelope 是待证伪假设而非 verdict，它必须至少包含一个 exact changed block。Runtime 机械计算 candidate 与 envelope 的对称差，再调用 Targeted Repair Finalizer；Call 2 只接收 candidate、envelope、exact delta 和完整 source，不接收 Reviewer claim 或 evidence leads，并可在 envelope 内逐块接受或拒绝挑战。共同 blocks 被机械锁定，Finalizer 不能改动 envelope 外 block。Reviewer 提交 same-set 或未完成合同时一调用保留 candidate并显式 degraded；任一角色失败或 Finalizer 降级时也静态保留 candidate。Source-blind full-proposal v8、candidate-aware full-proposal v7 与 candidate-blind same-contract v6.3 均只保留为已失败实验基线。

### Selective Release Gate 实验合同

v13 `release_gated_issue_repair` 是在 v10/v11 residual issue repair 之上的候选保护实验，不替换或重写前两次语义判断。Call 1 仍只定位最小 add/remove challenge；Call 2 仍只批准 challenge 子集。只有 Call 2 实际改变冻结 candidate 时，Runtime 才允许 Call 3 Independent Release Gate。若 Call 2 没有改变 candidate，则两次调用直接发布 candidate，不得为了“多一票”强制调用 Gate。

Call 3 只接收完整不可变 source、冻结 candidate 和 Call 2 已批准的 exact addition/removal IDs。它看不到 Reviewer claim、Reviewer evidence leads、Call 2 拒绝的 challenge、expected、历史结果或评测信息；只能批准 Call 2 approvals 的子集并逐项 veto，不能新增未批准 block、恢复未批准 challenge、重组第三套答案或提出新的修复方向。最终增删由 Runtime 对两次批准集合做机械交集并应用到 candidate，代码不得依据 source 含义改变交集结果。

该实验每个 case 最多三次 provider call，无 retry、投票、best-of-N、逐 block ledger 或隐藏第四次调用。Call 3 provider/schema/context/budget failure、主动 `degraded` 或越界批准时，整个 override fail closed，最终静态保留冻结 candidate 并显式记录 degraded；不得发布只有 Call 2 支持的中间结果。model profile、Prompt/schema hashes、三次输入 hashes、调用数、token、延迟和 Gate 是否跳过必须进入 trace。v13 的目标是为 candidate override 增加一把独立发布钥匙，而不是把候选正确性当作 source 证据；Gate 仍必须从 source 正向裁决每个 exact change。

v14 `full_challenge_release` 保留 v13 的三调用上限与条件式触发，但修正其单向 veto 边界：当 Primary 实际提出任一 candidate override 时，Call 3 接收 Reviewer 打开的完整 exact add/remove challenge，而不是只接收 Primary approvals。Primary 的理由、批准集合和拒绝集合全部隐藏；Call 3 从完整 source 独立批准 Reviewer challenge 的任意子集。它可以拒绝 Primary 错批的变更，也可以批准 Primary 错拒但 Reviewer 已明确打开的变更；仍绝对禁止新增 Reviewer 未提出的 block、生成第三套自由答案或读取评测信息。最终 delta 完全等于 Call 3 批准子集，由 Runtime 机械应用。若 Primary 没有提出任何 override，则 v14 在两次调用后保留 candidate，不为推翻一次完整拒绝而强制增加第三次成本。

v14 的职责分离是：Reviewer 负责高召回地打开最小残差争议；Primary 负责判断是否存在足以进入发布审查的 candidate override；Full-Challenge Release 独立决定该已打开 envelope 中哪些 exact changes 可以真正发布。Primary 是条件式发布审查触发器，不是 Call 3 的证据，也不限制 Call 3 在 Reviewer envelope 内的最终子集。任一 Call 3 failure/degraded/越界仍 fail closed 保留 candidate。

v15 `partial_group_appeal_release` 回到 v13 的保守发布边界，只增加一个纯集合拓扑的 unresolved-issue appeal：Call 3 默认只复核 Primary approvals；若 Reviewer 在同一个显式 range item 中挑战多个 blocks，而 Primary 对该 item 只批准严格非空子集，则同一 item 内其余被拒 blocks 也进入 bounded appeal scope。代码只根据 Reviewer 自己提交的 range 分组、candidate membership 与 Primary approval 集合计算 scope，不从文本、关键词、项目或 expected 推断这些 blocks 是否语义同组。Call 3 可以批准 Primary approvals 与 partial-item appeals 的任意子集，不能触及全拒 item、Reviewer 未挑战 block 或 envelope 外范围。

该 appeal 处理的是代码审查中的“同一 issue 只修了一部分”风险，不预设剩余成员应当修改。Reviewer range 只是模型声明的争议分组，不是 Owner 或 shared-effect 证据；Call 3 必须从 source 找到真实共享关系或肯定边界后独立裁决。Primary 对某个 range item 全部拒绝时，不因 adjacency、连续编号或另一个 item 获批而自动重开，以避免把 Reviewer 的宽泛错误重新放大。v15 仍只在 Primary 实际改变 candidate 时调用第三角色，最多三次调用；失败、degraded 或越界时保留 candidate。

v16 `reviewer_dialogue_release` 采用代码审查式职责分离：Call 2 Primary 可以看到 Reviewer 的 `issue_claim` 与少量 evidence leads，但它们被明确标记为不可信 review comment，不具有 source 权重；Primary 必须逐项回应 exact challenge，而不是在隐藏问题陈述后重新做宽泛抽取。只有 Primary 实际批准 candidate override 时，Call 3 Selective Release 才启动；Call 3 只接收 Primary-approved exact IDs 与完整 source，Reviewer comment、Reviewer evidence、Primary reason 和所有 rejected challenge 全部隐藏，并只能 veto approvals 的子集。

v16 用“可见 issue、盲发布”分开解决两种风险：Primary 通过具体 issue 语义理解连续组、边界或遗漏；Release 防止 Reviewer 叙事锚定让 Primary 扩入背景、模板、普通要求或其他错误范围。代码只隔离消息、计算 exact set、限制 subset 和记录 trace，不判断 comment 是否正确。Primary comment-visible 与 Release comment-blind 必须进入不同 input hash；任何 Release failure/degraded/越界都保留 candidate。

v17 `single_issue_release` 禁止一次 run 形成混合 patch。Call 1 Reviewer 只能提交 `pass`，或一个最小、material、source-grounded issue：`desired_membership=include` 表示所有 issue blocks 当前都在 candidate 外且应整体加入；`desired_membership=exclude` 表示所有 issue blocks 当前都在 candidate 内且应整体删除。Runtime 只校验当前 membership 与 action 一致，不提供方向恢复、部分 issue、第二 issue、完整替代答案或代码语义修正。若候选有多个可能问题，Reviewer 只选择 source 证据最直接、改动最小、最可能产生 case-level 修复的一项；剩余问题留给后续独立 run 或人工复核，不能在同一次调用中扩大 envelope。

Reviewer `pass` 时一调用保留 candidate，并记录完整 review 成功而非 degraded。Reviewer 提交 issue 后，Call 2 Primary 看到不可信 issue claim 与 exact ranges，只能整体 `approve_change`、`reject_change` 或 `degraded`，不能部分批准、改 action、改 ranges 或提出新答案。Primary reject 时两次调用保留 candidate；Primary approve 时才调用 Call 3 blind Release。Release 只看 exact action/ranges 与完整 source，看不到 Reviewer claim、evidence leads 或 Primary reason，只能整体 approve/reject/degraded。只有 Reviewer、Primary、Release 三者对同一 exact issue 连续授权时，Runtime 才机械应用一次 membership change。

v17 以更低 recall ceiling 换取 candidate preservation 与协议清晰度：它不能在一轮内修复两个独立错误，也不能做逐 block partial repair；这必须在质量报告中如实计入。其价值假设是成熟 single-prompt candidate 的残余错误通常由一个最小遗漏或污染主导。若受治理 cases 证明多错误候选普遍存在，不能在 v17 内偷偷恢复多 issue，而应另立明确合同。

v18 `adversarial_debate_release` 保留 v13 前两次调用、Reviewer Prompt、Primary Prompt、schema 和条件式第三次调用不变，只改变最终发布审查的证据结构。Call 3 读取 Reviewer 打开的完整 exact challenge、Reviewer 的不可信 attack、Primary 对该 challenge 的 exact approvals/rejections 与不可信 response，以及同一完整 source；它可以批准 Reviewer envelope 的任意子集，但不能触及未挑战 block、依据角色身份投票或生成自由第三答案。Reviewer attack 与 Primary response 都只用于暴露相互冲突的可证伪主张，没有 source 权重。

v18 的对抗职责是先为双方重建最强版本，再裁决 source membership，而不是判断评分规则本身是否完善、合理或无缺陷。规则中的空值、矛盾、缺失描述、负向结果或质量问题不能自动使其成为非目标；供应商编制动作和完整、合理、先进、针对性强等理想属性也不能在缺少独立 evaluator 与终端效果时自动成为评价规则。Call 3 仅在 Primary 实际改变 candidate 时启动，因此正常成本边界与 v13/v14 相同；任一 failure、degraded 或 envelope 越界仍 fail closed 保留 candidate。v18 必须作为独立 capability hash 计分，不能与 v13-v17 挑优合并。

v19 `strict_adversarial_debate_release` 针对 v18 暴露出的两个协议缺陷做最小收敛。Reviewer 必须按 Runtime 明示的 candidate block IDs 严格提交方向：`add_ranges` 只能包含 candidate 外 blocks，`remove_ranges` 只能包含 candidate 内 blocks；方向错误、空 delta 或用 add 表示保留时直接 fail closed，代码不得反向恢复成另一种语义 change。Prompt 同时明确 extraction 只判断 source membership，不判断评分规则质量，避免因空值、矛盾、缺陷或负向结果误删真实评价规则。

v19 通常仍沿用 v13 的条件式第三次调用。唯一额外触发是纯集合可判定的高风险结构：Reviewer 挑战删除整个非空 candidate、Primary 完整保留 candidate。此时第三角色读取完整 attack、response 和 source 做一次终审，防止 Primary 全拒成为 whole-candidate challenge 的 recall ceiling。代码只检查 candidate 是否非空、Reviewer additions 是否为空、Reviewer removals 是否与 candidate block set 完全相同；它不得读取文本含义或预设应清空还是保留。普通 addition、局部 removal 或 Primary preserve 不增加第三次调用。v19 是独立实验 capability，不得覆盖 v18 历史结果或与其他版本挑优。

v23 `dual_axis_release` 针对单 issue Reviewer 的 first-choice ceiling 做常量规模修正。Call 1 必须在同一次完整 source 阅读中独立完成 precision attack 与 recall attack，可提交最多一个 candidate-present precision issue、最多一个 candidate-absent recall issue，或在两个方向均未证明 material defect 时 `pass`。两个 issue 是彼此独立的反例，不是可同时应用的混合 patch；代码只校验各自 ranges 的 candidate membership、地址、schema 和数量上限。

Call 2 Primary 同时读取两个不可信 issue 与完整 source，必须比较保留 candidate、只应用 precision、只应用 recall 三个完整结果，只能选择一个或降级，不能拼接两项形成第三答案。只有 Primary 选择一个 exact issue 时才启动 Call 3；Release 看不到另一个 issue、Reviewer 理由或 Primary 理由，只从完整 source 对该 exact change 做对抗性回退审查，并整体 approve/reject/degraded。v23 每个 case 最多三次调用，无 retry、逐 block ledger、部分批准、第四次调用或代码语义裁决；任一 failure/degraded/越界都 fail closed 保留 candidate。v23 必须以独立 capability hash 计分，不能与 v17、v21 或其他路线挑优。

v24 `dual_axis_debate_release` 保留 v23 的 Reviewer、Primary、双轴 issue 上限和三调用硬预算，只改变最终对抗裁决的上下文与允许选择。Call 3 接收两个 Reviewer issue 及其不可信 attack、Primary verdict/response、完整 source 和同一三选一合同；它必须分别重建 candidate defense、precision attack/defense 与 recall attack/defense，然后可保留 candidate，或选择 Reviewer 已实际打开的任一 exact issue，包括与 Primary 不同的另一轴。它不得合并两个 issue、部分批准、改写 ranges 或生成新答案。

v24 在 Primary 选择任一 change 时调用 Call 3；若 Reviewer 同时打开 precision 与 recall 而 Primary preserve，也调用 Call 3，以终审完整双轴分歧。Reviewer 只打开一个轴且 Primary preserve 时必须两次结束，不能为了多一票增加成本。完整 debate 只是互相冲突的待证伪论点，不是多数投票或 source 证据；最终语义仍由 Release 读取 source 决定。代码只校验 issue 是否存在、candidate membership、上述纯结构触发、schema、预算与机械 set operation，不得根据 attack 内容、Primary 理由、case 身份或评测结果选择方向。任一 Call 3 failure/degraded/越界都 fail closed 保留 candidate。v24 必须以独立 capability hash 计分，不得与 v23 或模型变体 best-of-N 挑优。

v25 `dual_axis_blind_debate_release` 保留 v24 的双轴 Reviewer、Primary、三选一能力、结构触发条件和三调用硬预算，但对最终裁决执行严格叙事隔离。Call 3 只接收冻结 candidate、Reviewer 实际打开的 precision/recall exact ranges 和完整 source；Reviewer claim、Reviewer evidence IDs、Primary verdict、Primary reason、角色身份与置信信号全部隐藏。Release 必须先从 source 独立重建正确边界，再把两个 issue 分别当作可能造成删除回退或范围扩张的外部 patch，最终只能 preserve 或整体选择其中一个已存在 issue。

v25 用上下文消融检验“争议坐标有用、前序叙事有害”的假设：它保留 v24 能够改选另一轴的上限，同时恢复 v23 blind Release 对 Reviewer/Primary 共同错误的独立保护。隐藏叙事不是把 candidate 当答案，也不是降低 source 审查义务；Release 仍看到完整 source，并必须对 local group、Owner、lifecycle、post-award、response mapping 和最小闭合做对抗性反证。代码只执行消息隔离、issue existence、candidate membership、纯结构触发、schema、预算、hash 和机械 set operation。v25 必须作为独立 capability hash 计分，不得与 v23/v24 或模型变体挑优合并。

v51 `common_id_normalized_membership` 是 Reviewer 上下文与对抗角度实验。空 candidate 使用独立 mode-specific Reviewer：完整 source 无目标时一次 `PASS`，否则只能打开 addition challenge。非空 candidate 的 Doubao 2.0 Lite Reviewer 必须读取完整 source 并打开一个 exact addition 或 removal challenge，不能 `PASS`、生成整套第二答案、提交叙事 ledger 或混合增删。Runtime 只把该 challenge 机械应用为匿名 Set B，并把冻结 candidate 作为匿名 Set A；Doubao 2.0 Pro Primary 看不到 candidate/Reviewer 身份、challenge 类型、理由或历史，只在两集合 exact difference envelope 内提交最终保留 membership。两集合公共 IDs 被锁定；Primary 冗余提交公共 ID 时可机械忽略，但冲突、未知或 envelope 外 ID 必须 fail closed。

v51 的 Primary 可以在 Set A、Set B 或二者差异的严格子集之间选择，因此 Reviewer 的宽 challenge 不再形成二选一强迫。只有 exact difference 中存在字符数超过冻结阈值的不可拆原子 block 时，才允许在 Primary 前增加一次独立 Pro literal-inspection Planner；Planner 只能选择 bounded focus IDs 和 source literal queries，代码只执行 NFKC、大小写、标点和空白无关的字面字符序列搜索并返回带原始 offset 的 excerpts。Planner、search hit、zero hit 和 excerpt 都没有 keep/drop 权力。普通路径固定两次调用，空结果可一次结束，超长原子差异路径最多三次；无 retry、投票、best-of-N、Release、逐 block ledger 或第四次调用。任一角色、schema、容量、预算或范围失败静态保留 candidate 并显式 degraded。v51 当前 gate10 仅为已解封 development/protected regression，不得作为 sealed 泛化证明，也不得替换默认 xq-parity 路线。

v53 `atomic_removal_verifier` 在 v51 上增加两个纯结构、固定成本的 mode-specific 二次审查。其一，Reviewer 的 removal envelope 中恰有一个 candidate-present 不可拆 source block 达到冻结 oversized 字符阈值时，不再调用 literal Planner 和通用 Primary，而由一个独立 Pro Atomic Removal Verifier 在第二次调用中扫描完整物理 block，并只提交 `RETAIN_ATOMIC_BLOCK` 或 `AUTHORIZE_REMOVAL` 以及一个来自该 block 的常量规模 distinctive source literal query。Runtime 只做 NFKC、大小写、标点和空白无关的唯一字面匹配，并物化 canonical exact quote 与原始 offsets。任何有效目标出现在不可拆 block 的任意位置，都足以否决 whole-block removal；授权删除必须在扫描到末尾后确认整块没有有效目标，并引用肯定的非目标 Owner、完成生命周期、独立单元或空指针边界。

其二，Reviewer 只提出一个 candidate-absent block，且该 block 在 canonical source address 上紧邻某个 candidate interval、同时没有 oversized difference 时，第二次 Pro 调用改用 Single Immediate-Edge Addition Judge。它只比较 clipped candidate 与 candidate 加该 edge 的两个完整 membership，专门从 source 审查 shared local evaluator、双向 peer effect inheritance、必要局部闭合和肯定的新 controller、Owner、lifecycle、peer-section 或 independent-unit boundary。它不能新增第二个 edge、删除 candidate block 或生成自由第三答案。Runtime 只根据 exact one-block addition、candidate membership、canonical adjacency 和 block size 选择该 Prompt；相邻性只决定审查模式，不赋予 edge 目标身份。是否同组、是否继承评价效果、是否存在肯定边界以及最终 include/exclude 全部由 Pro LLM 决定。

Runtime 只根据 Reviewer 已提交的 action、candidate membership、changed-block 数量、canonical adjacency、oversized block 数量和字符长度进入上述路线，并校验 Verifier query 在 challenged block 内只有一个机械 literal match；代码不得判断 query、canonical quote、local group 或 boundary 的含义。`RETAIN_ATOMIC_BLOCK` 机械保留完整 candidate，`AUTHORIZE_REMOVAL` 只机械应用该 oversized block 的 exact one-block removal。同一 removal envelope 中其他短 blocks 因没有第二把独立授权而锁回 candidate；这不是语义保留判断。普通 remote addition、多个 additions、纯短 removal、多个 oversized blocks 和其他 dispute 继续走原 v51 bounded membership，不从文本含义推导路由。两个 mode-specific 路径均固定 Lite Reviewer 加一次 Pro 二次审查，整体仍不超过三次；无 retry、ledger、投票、best-of-N、Release 或第四次调用。v53 必须作为独立 capability hash 计分，已解封回归结果不能作为 sealed 泛化证据。

v55 `orthogonal_complete_delta` 是针对 v53 Reviewer 只打开局部单向 challenge 所形成 recall ceiling 的两调用实验。冻结 candidate 与 accepted Prompt hash 继续进入 provenance，但 accepted Prompt 正文不进入 Reviewer 或 Primary 上下文，避免 candidate-generation 的 container-first、无害偏宽和孤立指针删除规则干扰精确终审。Call 1 Reviewer 读取完整 answer-free source 与 untrusted candidate，先独立重建一个完整最小答案，再提交 candidate 与该答案的完整对称差；非空 candidate 不得 `PASS`，delta 可以混合新增和删除，且不能在发现第一个问题后停止。Call 2 Primary 看不到 Reviewer 理由、challenge 类型、candidate 身份或 accepted 历史，只接收匿名 A/B 集合、机械差集和 source-address evidence，并在差集内提交最终 membership；共同 IDs 机械锁定。

v55 的通用语义合同必须同时覆盖：当前生效且指向实际技术/服务评价内容的分值构成或 cross-reference gateway；最低价或 pass/fail 方法中对具名技术响应产生否决、重大偏差或定性结果的规则；包含有效技术成员并由同一终端效果支配的最小 authored subgroup；不可拆 mixed block；以及从自身标题、标签、包前缀或表名开始的 sibling Owner 边界。上述判断全部由两个 LLM 从 source 完成。代码只做 prompt/context 隔离、schema、ID、集合差、公共 ID 锁、预算、模型容量预检、trace 和机械 ranges 展开，不读取关键词或 source 含义。

v55 每个 case 最多两次 provider call；只有空 candidate 且 Reviewer 独立重建仍为空时可一次 `PASS`。无 retry、第三角色、逐 block ledger、投票、best-of-N 或答案感知模型路由。模型 profile 必须在第一次语义调用前仅依据硬上下文容量和 provider 可用性冻结，不能根据 case ID、首次结果或评测反馈切换。任一 provider/schema/context/budget failure 均静态保留 candidate 并显式 degraded。v55 在 known29 全量达到 exact match、零 degraded、零 correct-to-wrong 前不得接入默认 Extension，也不能把已解封开发回归成绩表述为泛化证明。

v56 `editable_union` 修正 v55 的 common-ID lock 和非空 `PASS` 绕过独立精度审查的问题，但不增加调用次数或代码语义权力。Call 1 先接收完整 answer-free source，再把 candidate 作为不可信 Locator scope hypothesis 接收；不接收 accepted Prompt 正文、历史输出或评测信息，并提交一份完整重建 block 集合。远端新增必须属于同一个当前生效评价方法，或与保留目标存在明确 source gateway、cross-reference、bridge、原子续接等直接依赖；不得把同文件中的样表、备选方法、响应格式复写或其他生命周期内容当作 residual repair。Runtime 构造 `reviewUniverse = candidate ∪ reconstruction`。只有 candidate 与重建都为空时可一次结束；任何非空 candidate 都固定进入 Call 2，即使两集合相等也不能绕过独立精度审查。

Call 2 Editable-Union Finalizer 接收匿名 review universe 与同一完整 source，并发布该 universe 的任意完整子集，包括空集合。它可以删除任一 candidate 污染、恢复独立重建遗漏但 candidate 已保留的 block、接受或拒绝独立重建新增，但绝不能新增 universe 外 block。该全集是 recall ceiling，不是相关性标签、投票或第二答案；最终 membership 全部由 Finalizer LLM 从 source 裁决。代码只校验 IDs、subset、schema、预算、调用上限、hash、trace 和机械 ranges 展开，不依据文本含义判断 keep/drop。

v56 固定最多两次 provider call、总输出预留 12000 tokens，无 retry、第三角色、逐 block ledger、best-of-N 或答案感知模型切换。模型 profile 必须在第一次语义调用前仅按可测量的上下文容量和 provider 可用性冻结。任一失败都显式 degraded 并静态保留 candidate。v56 只有在 known29 达到 `29/29 exact-match`、`0 degraded`、`0 correct→wrong` 后才可接入 Extension index；该结果仍只属于已解封开发回归，泛化声明必须另由实现冻结后的 sealed holdout 支持。

v58 `hypothesis_aware_editable_union` 保留 v56 的两调用上限、完整 source、机械 union 和 Finalizer 任意子集发布能力，但修正 Reviewer 对 candidate-present precision challenge 无法向第二角色提供信息的问题。Runtime 将 candidate 与 Reviewer delta 机械形成的 proposal 作为匿名 A/B membership hypotheses 暴露给 Finalizer；不暴露 accepted 身份、Reviewer 身份、理由、evidence leads、置信度或投票含义。A/B agreement、disagreement、宽度和 edit distance 都不是 source 证据，只是对抗性 attention map；Finalizer 必须从空集合开始按 source 独立裁决，并可发布任一 hypothesis、二者混合、严格子集或空集合。代码只计算 A/B membership、union、schema、预算与 trace，不依据 source 含义选择任何 block。

v58 固定最多两次 provider call，无 retry、第三角色、逐 block ledger、best-of-N 或答案感知模型切换。只有 candidate 与 Reviewer proposal 都为空时可一次结束；任何非空 universe 都调用一次 Finalizer。任一失败显式 degraded 并静态保留 candidate。v58 必须以独立 contract、schema、Prompt hashes 和 input hashes 计分；known29 通过仍只属于开发回归，泛化声明必须来自实现冻结后的 sealed holdout。

v91 `hypothesis_terminal_adjudication` 继承 v58 的匿名 A/B、任意子集发布和两调用硬边界，并把第二角色明确为 terminal adjudicator。A/B 只恢复 Reviewer precision challenge 的可见性，不提供票数或默认答案。重复 reference occurrence 必须由自身直接承载当前技术/服务权重、评价效果，或直接指向已保留的详细评价 artifact；仅转指另一个摘要、前附表或已保留 pointer 的 relay 不属于独立 gateway。该 directness 判断完全由 LLM 根据 source 完成，代码只暴露机械 membership 与 source 地址。

### 通用性北极星

**不可妥协的产品要求：** 对任何内容格式、任何项目的招标文件，代码架构和 Prompt 都必须依靠同一套通用语义原则稳定产出高质量评分办法范围。不得以项目、行业、格式、模板或已知 case 的特化规则换取局部正确率；无法泛化到等价新项目和新载体的修复，不属于产品能力提升。

- **任何项目**：不得依赖项目名称、采购人、地区、行业、标的物、预算规模、评标方法、章节编号或已知模板。工程、货物、服务及其混合项目都必须由同一组 Owner、评价对象、评价效果和结构闭合原则判断。
- **任何内容格式**：DOCX、PDF、旧 `.doc`、扫描/OCR、表格密集文档、段落文本、图片转写、多文件附件和混合载体的差异，只能由代码适配器转换为带 source provenance 的原子内容与结构事实。Prompt 和语义角色必须面对统一证据合同，不能为某种格式编写答案特例。
- **任何版式与表达**：标题层级、编号体系、表格/段落互换、跨页、合并单元格、脚注、附件、引用、自然语言风格和内容顺序变化，不得改变同义 source 的目标判断。格式噪声可以影响定位置信度，但不能成为 keep/drop 的语义捷径。
- **高质量而非仅可运行**：所有受支持格式都必须按相同的 completeness、precision、boundary correctness、source fidelity 和 candidate-preservation 标准验收；不能用“格式复杂”降低语义质量门槛。
- **能力声明必须诚实**：通用性是产品与架构目标，不是未经验证的口号。每种新格式、项目族或适配器都必须通过独立的跨格式、跨行业、跨结构治理集和 sealed holdout，才能宣称该 full-chain 已支持；packet replay 通过不能替代真实文件链路验证。

正确结果必须同时满足：

- **完整**：覆盖当前投标、评标或定标阶段中，对具名技术或服务方案的内容、质量、组成、能力、承诺、响应属性或比较优势进行评价的全部目标 source。评价机制可以是分值、档位、扣分、比较、排名、折算、通过或不通过、无效或重大偏差判断。
- **精确**：排除可分离的资格、形式、通用符合性、纯商务资质或业绩、纯价格、报价修正与排序、候选推荐、澄清、行政程序、评审纪律、签约后履约考核、普通采购要求、响应目录和空参考指针。
- **结构闭合**：保留理解有效目标所必需的最近标题、分组、父项、表头、阈值、上下限、适用条件、有效 cross-reference 和原始顺序，但不得让宽泛父标题把无关后代升级为目标。连续 Locator interval 开头的评价 controller 若与后续已证明评分范围共同形成原始文档入口，不能仅因宽泛、没有独立叶子或被称为“包装”而删除。从 Locator 起点到首个实质评分叶子之前，连续且只承担评价文档/章节身份的短标题/controller blocks 以完整 authored heading run 为最小单位，不能只保留最后一个 sibling 标题；前后 source 已保留而中间只遗漏连续短标题/controller blocks 时，同样必须作为结构洞审查。短标题名称包含“方法”“程序”或“流程”不等于程序正文，只有实际评审步骤、行政流程或其他实质非目标正文才会终止 heading run。删除该 run 的前缀必须由 source 中肯定的新项目/标包、生命周期、文档角色、Owner、独立非目标 controller 边界，或可核验的目录/页眉/附件 wrapper 身份证明；可分离的程序正文、资格、价格或行政内容会终止该 run，且不受标题保护。可独立删除的“附件 N”“附表 N”、目录或页眉包装不是语义标题；真正说明表格身份、对象、分值或适用范围的直接标题才属于闭包。
- **评分文件不等于单一评价容器**：整份文件自称评分细则只建立可能的文件角色，不能把其中所有同级章节升级为目标。最小完整评价容器在第一个同级非评价 controller 前停止；文件解释、修订、生效、有效期、发布管理、评审行政、法律套话或普通结束语若不再定义评价对象、条件、效果或必要结构关系，就属于新的非评价 owner。必要闭合只包括理解有效评价所需的分值、档位、阈值、适用条件、有效 cross-reference 和上一评价项正文闭合，不包括整份文档的行政闭合。对任何声称必要闭合的可单独寻址 block，必须通过反事实测试：删除后若评分对象、规则、阈值、效果和当前适用引用仍可完整理解，且评价 source 没有字面依赖，该 block 就不是必要闭合；项目背景、事实清单或技术写作素材的相关性不够。
- **候选序列删除门槛**：accepted candidate 已保留的连续同级编号序列或 authored container 是待反证的完整结构假设。若 Reviewer envelope 挑战删除首项或中间项而保留后续 sibling，v9 Finalizer 必须从删留之间找到肯定的新 controller、Owner、生命周期、同级章节或其他 source boundary，才能在 final ranges 中接受该删除。被删 block 的局部措辞、单独缺少分值或表面更像要求，不能替代边界证据。该门槛只保护 candidate 不被弱审查随意拆坏，不阻止 source 明确证明的遗漏修复或污染删除。
- **候选边缘结构洞**：完整性审查不能只看 candidate 内部。每个连续 candidate range 的紧邻前驱和后继必须接受常量级边界审查；若 candidate 从 authored 同级评价序列的第二项/中间项开始，或在最后一项之前结束，只有遗漏项与已选项之间存在肯定的新 controller、Owner、生命周期、同级章节或其他 source boundary 才能维持截断。没有边界时，紧邻项可以继承同一局部评价序列的共享评价效果，不因缺少独立分值、单独效果句或局部写成承诺、响应、提供、时限、要求而自动排除。该原则不授权跨越非评价 controller，也不要求逐 block ledger。
- **表尾归属**：表格后的签名、日期、备注、未编号说明和连续编号说明，在下一个 peer table 标题出现前先作为前一表的候选 linked tail 审查。跨越这段前表尾部并触及后一表标题/前缀的 base unit，不能仅凭相邻性与后一表组成 authored union；最终归属仍由 LLM 根据 source 裁决。
- **修改必须是实质 delta**：Reviewer 只有提交与 candidate 不同的完整 challenge-envelope block 集合，Runtime 才可机械计算 added/removed delta 并触发终审。解释、Owner 标签或理由不同但 blocks 相同，不能授权 override；规范化集合相同时只可机械归一化为一次调用的 candidate preservation。Finalizer 可只接受 envelope 中部分 challenged blocks，但不得改动 candidate/envelope 共同 blocks，也不得新增 envelope 外答案。
- **忠于原文**：只选择原始 block ranges，不改写、不摘要、不补造 source。不可拆原子 block 同时包含目标与非目标时可以整块保留；precision debt 只能停留在该原子 block 内，不能传播到相邻 block、表格或章节。
- **原子表完整扫描**：mixed atomic table 必须从 block 开头扫描到结尾，不能按首行、首个 controller 或多数内容分类。一个不可拆 block 即使前部是价格、资信或资格，只要后部任一位置存在有效技术/服务评价，整块仍须保留；若下一个 atomic block 从半句续接同一技术评分内容，也要分别保留两个 blocks。独立纯价格/资信 block 仍可删除。
- **最小完整**：最终范围既不能遗漏有效目标叶子，也不能保留可独立删除的污染。Locator、Checker、Reviewer 或其他中间结果都只是待核对假设，不具有答案权威。

证据不足时不得猜测、伪造证据或用代码补出一个看似完整的语义答案。对于 candidate-protected Reviewer 增强层，无法安全完成 override 时保留冻结 candidate，并显式返回 `status: degraded` 与 `reviewDegraded: true`；只有 source/candidate 本身不可用，或调用方合同要求阻断发布时，才返回 `needs_review` 或 `blocked`。

### 当前工程验证范围

- 当前验证切片是正常单包 Word 评分办法审查；它不得反向限制上述通用产品目标，也不得使 Prompt 或 Extension 固化 Word 专属语义。
- 当前 Pi capability 接收已经生成的不可变 `xique.score-review.packet.v1` block packet 和 Locator 候选，输出审查后的 ranges、终态与 trace。
- 当前不负责 DOCX/PDF/旧 `.doc`/扫描件解析、上游 Locator、多包隔离、服务端发布或外部业务接口。Packet replay 只能证明标准化证据上的 Reviewer 节点质量；没有对应真实文件、source-hash parity、适配器和客户端主路径验证，不得宣称该格式的 full-chain correctness。

## 二、评估标准

### 1. 语义正确性是第一标准

按以下维度评估最终 block 集合：

1. **Completeness / Recall**：是否遗漏任何有效目标叶子、必要局部容器或有效关系桥。
2. **Precision**：是否混入任何可分离的非目标 block，或让目标身份越过明确的项目、标包、生命周期、Owner、对象或同级 controller 边界。
3. **Boundary correctness**：评分组、表格、编号序列、cross-reference、不可拆 mixed block 和 precision debt 的边界是否正确。
4. **Source fidelity**：输出是否能逐块映射回同一份不可变 source，范围、顺序、引用和 SHA 是否一致。

盲测的主要自动化指标是最终 block 集合或规范化 ranges 与独立 expected 的 exact match。还必须分别报告 false-negative blocks、false-positive blocks、错误类别和 case-level exact-match rate，避免总分掩盖漏提或误收。

每个 case 必须先判断 Agent 结果对当前 source 是否绝对正确，再比较 production baseline、xq-agent 或其他系统的相对胜负。两侧都错误不能记为平局；结果更短不能自动视为更精确；中间阶段发现但最终未修复的问题仍计为最终错误。

### 2. 稳定性与协议完整性

- 相同冻结版本在重复运行中的语义结果应稳定；协议失败、超时和无结果不能隐藏在平均质量中。
- `status: degraded`、`reviewDegraded`、`needs_review`、`blocked`、超时、schema 失败和缺失输出如何计分，必须在运行前冻结。静态保留 candidate 可以避免语义回退，但不能从 runtime success 或 Reviewer 有效性统计中删除该次降级。
- 输出必须包含可核验的 source hash、Prompt/合同版本、模型配置、调用次数、token、耗时和终态，不得事后重写运行记录。
- Candidate 必须作为冻结输入保留 provenance，其 accepted Prompt 原文与 hash 也必须进入 capability hash；不得在 Reviewer 运行时重跑、改写或用另一个隐藏候选替换。正式质量结论必须同时报告 `wrong→correct`、`correct→wrong`、净 case 提升、最终 exact-match rate 和 candidate preservation rate；只报告 Reviewer 自身命中率不能证明产品增益。Protected-correct case 的 `correct→wrong` 是阻断性回退，不能用同数量的 `wrong→correct` 抵消。

### 3. 成本与延迟是约束，不是正确性的替代品

- 必须设置硬性的模型调用、token、时间和重试上限。
- 新一次语义调用必须获得新证据、独立反证或聚焦争议；不得用无界重复调用碰运气。
- 在语义质量相当时，优先调用更少、上下文更小、延迟和成本更低的方案。
- A/B 必须分别报告正确率、稳定性、调用次数、token、成本和延迟，不能用速度替代质量结论，也不能用质量均值掩盖成本失控。
- Candidate-protected 路线的成本口径必须把既有 single-prompt candidate 调用与新增 Agent 调用分开报告。当前 targeted-repair v9 不得重新生成 Primary：正常完成路径固定一次 Residual Issue Reviewer 和一次 Targeted Repair Finalizer。最多两次新增语义调用，不得出现隐藏协议重试、第三次调用、逐 block ledger 或自由读搜 loop。Reviewer same-set、协议/provider/capacity failure 不调用第二角色，静态保留 candidate 并计为 degraded，而不是成功的一调用捷径。
- v13 selective Release Gate 是上述两调用基线之外唯一明确命名的三调用实验：前两次角色完成且 Primary 实际改变 candidate 时才允许第三次调用；Primary 保留 candidate 时必须停在两次。第三次只能 veto Primary approvals，不能扩大语义搜索面或形成新答案。
- v14 full-challenge release 使用相同条件式第三次调用预算，但第三角色可在完整 Reviewer challenge 内独立批准任意子集；它仍不得触及 Reviewer 未挑战的 block。v13 与 v14 必须作为不同 capability hash 和 contract 分别计分，不能挑选两者较优结果冒充一次运行。
- v15 partial-group appeal 与 v13/v14 也是独立 capability：第三角色的允许集合等于 Primary approvals，加上同一 Reviewer 显式 range item 被 Primary 部分批准后留下的 rejected members。全拒 item 不进入 appeal；代码不得跨 item 合并或依据 source 语义扩大 appeal。
- v16 reviewer-dialogue release 保持 v13 的 Primary-approval-only 发布范围，但 Call 2 显式接收不可信 Reviewer comment，Call 3 完全隐藏该 comment。它不得与 claim-blind v13 合并计分，也不得把 visible 与 blind 两条 run 选优为一次结果。
- v17 single-issue release 的新增语义调用最多三次，但正常路径可以是 pass 后一次、Primary reject 后两次或三角色一致后三次。它不得通过重试第二个 issue 来绕过单 issue 上限。
- v18 adversarial-debate release 与 v13 一样只在 Primary 实际改变 candidate 时调用第三角色；前两次调用必须与 v13 byte-identical。第三角色可以审查完整 Reviewer envelope，但只能机械发布其批准子集，不得提出新 issue、第四次调用或 envelope 外答案。
- v19 strict-adversarial-debate 最多三次调用。除 Primary 实际 override 外，只有完整 whole-candidate removal challenge 被 Primary 全拒时可触发第三次；普通 Primary preserve 必须停在两次。方向错误在一次 Reviewer 调用后 fail closed，不能消费隐藏纠错调用。
- v23 dual-axis release 最多三次调用。Reviewer `pass` 后一次结束；Primary 保留 candidate 后两次结束；只有 Primary 选择一个 exact precision 或 recall issue 时才允许第三次 Release。两个轴不得拆成额外调用，也不得在同一 run 依次尝试两个 issue。
- v24 dual-axis debate release 最多三次调用。Primary 选择任一 issue 时进入完整 debate Release；Primary preserve 只有在 Reviewer 同时打开两个轴时才进入 Release，单轴被拒必须两次结束。Release 只能在 candidate 与已提交的两个 exact issue 之间三选一，不能合并、部分批准、增加第四次调用或提出新 ranges。
- v25 dual-axis blind debate release 与 v24 使用相同的条件式三调用上限和三选一范围，但 Call 3 必须隐藏全部前序 claim、evidence leads、verdict 和 reason，只保留 exact issue ranges 与完整 source。不得把隐藏字段通过 trace、Prompt 拼接或其他旁路重新注入 Release。
- v51 common-ID-normalized membership 最多三次调用：空 candidate `PASS` 一次结束，普通 challenge 使用 Lite Reviewer 加 Pro Primary 两次，只有 exact difference 含冻结字符阈值以上的原子 block 时才加入一次 Pro literal-inspection Planner。Planner 只能生成字面查询，Primary 仍是唯一终审；不得对 Planner 失败降级为隐藏的无 Planner 重跑，不得增加 Release 或第四次调用。
- v53 的单个 oversized removal 路径固定 Lite Reviewer 加 Pro Verifier 两次；单个非 oversized immediate-edge addition 路径固定 Lite Reviewer 加 mode-specific Pro Primary 两次。remote/multi-block addition、短 block removal 和其他 dispute 沿用 v51 的调用边界，整个 case 仍最多三次；不得在 mode-specific 二次审查后再调用另一个 Primary、Planner 或 Release，也不得因 verdict 不利而回退重跑 v51。
- v56 editable-union 最多两次调用：candidate 与 Reviewer 重建均为空时一次结束；任何非空 candidate 或非空重建都固定再调用一次 Finalizer。两角色各预留最多 6000 输出 tokens，总预留上限 12000；不得把 schema 修复、模型切换、第二 Reviewer 或第三次终审隐藏在预算之外。Finalizer 必须一次提交完整 universe membership，不得拆成分页 ledger 或逐 block 调用。
- v58 hypothesis-aware editable-union 沿用同一最多两次调用边界，只把两份机械 membership hypothesis 匿名暴露给 Finalizer 作为对抗性 attention map；不得增加 Reviewer 叙事、角色权威、投票、retry、第三角色或逐 block 调用。

### 4. 泛化证据标准

- 已经查看答案并参与修改的 case 只能作为 `development` 或 `regression`，不能证明泛化能力。
- 质量或泛化结论必须来自实现冻结后的全新、答案隔离 blind holdout。
- A/B 中各 Agent 必须独立生成并先落盘结果，再由同一个冻结评测器计分。不得把另一 Agent 的结果作为当前 Agent 的输入。

受治理评测集至少分为：

1. `protected regression`：保护当前已经正确的能力；
2. `known issue`：关闭所有已知遗漏、误收、边界、contract 和 runtime 问题；
3. `sealed fresh holdout`：在本轮 Agent 修改前封存，只有输出落盘后才能解封答案；
4. `stability and long-context`：覆盖重复运行、大表格、极端 block 数和上下文边界；
5. `full-chain`：宣称任一具体内容格式的完整产品能力时，都必须加入该格式的真实文件、source hash、artifact、适配器和客户端链路。

通用性晋级还必须包含跨项目、跨行业、跨采购类型和跨内容格式的等价语义对照：同一语义在表格/段落、DOCX/PDF/OCR、章节重排、编号变化和附件拆并后的预期目标应保持一致；不同语义即使版式相似也必须保持可区分。任何只在单一格式或单一项目族上成立的高分都不能证明通用性。

正式晋级要求在运行前锁定分母，并在当前冻结 hash 上达到：known-issue resolution、material target recall、target precision、hierarchy/order、source integrity、native contract 和 supported-scope runtime success 全部 `100%`，且 protected regression 无回退。这里的 `100%` 只表示当前受治理套件通过，不得表述为未知开放世界永久完美。

## 三、原则约束

### 1. Source-first，面向任意招标文件

- 所有语义结论必须由当前 source 中的评价 Owner、具名技术或服务对象、评价动作或结果机制及其局部边界共同证明。
- 不依赖特定采购人、行业、项目类型、内容格式、解析器、模板、章节编号、表格样式、文件名或已知 case 的写法。
- 结构相似、出现“技术”“评分”“评审”“通过”等词、位于评标办法章节或被 Locator 选中，都不能单独证明目标身份。
- 对个案失败的修复必须提升通用语义合同或结构能力，不得增加只对已知样本成立的答案映射。

每个非空语义判断必须闭合四个 Owner Gate。Reviewer 提议修改或 Adjudicator 接受修改时，必须提交少量固定上限的证明地址，且地址来自当前不可变 source：

1. **最近 controller / 文档角色**：最近支配内容的是评价规则，而不是供应商响应、提交、编制、目录、资格形式、行政程序或履约要求。不能跳过更近的供应商侧 controller，借远处“评标办法”标题或其他章节给当前内容补 Owner。
2. **生命周期**：判断发生在当前投标、评标或定标阶段。依赖中标后实际交付、安装、验收、合同履行、服务效果或绩效的评价属于 post-award，不是本能力目标；投标阶段对方案或承诺本身的评价不受此限。
3. **具名评价对象**：source 必须给出具体方案、方法、能力、性能属性、配置、承诺或可比较服务方向。泛称“技术评审”“技术响应无实质偏差”“主要技术指标满足要求”、总分构成或空 reference 不能自动成为写作目标。
4. **终端评价效果**：source 必须说明对象怎样改变得分、扣分、档位、比较排序、通过结果、定性结果或选择结果。完整、合理、先进、优化、针对性强等理想属性本身不是终端效果。

证明地址必须忠实覆盖实际支撑 controller、target、effect 或边界判断的 source，不能只引用一个宽标题，再从未引用的相邻表格或尾句借来语义。v9 对 Reviewer envelope 和 Finalizer publish 要求少量非空 `evidence_block_ids`；v8/v7/v6.3 基线保持同一地址约束。Runtime 只校验 numeric block ID 存在、SHA、envelope 和 final set 的机械一致性；它不判断这些 blocks 是否真的承担某个语义角色，不要求逐角色 exact quote，也不生成逐 block ledger。角色语义是否成立完全由 LLM 判断。

四个 Gate 之前还必须确认当前项目的规范效力。样表、示例、参考值、可调整模板或并列备选评标方法，即使内部包含完整分值和技术评分项，也不能仅凭被收录在文件中而视为当前项目已采用；必须由当前 source 中肯定的选用、填值或适用关系证明。只有“可据实调整”“仅供参考”“由采购人另行确定”等开放占位语义且没有采用证据时，应发布空集合。反过来，若 source 已明确选定该方法，通用模板注记不能抹除其规范效力。该判断属于 LLM 语义职责，代码只能提供相邻 source 和结构候选。

`repeated_result_group` 只接受至少两个不同具名对象的完整结果命题：每句必须在语法上直接断言对象处于某个缺陷、档位、可行性、提供状态或通过结果。组一旦成立，共享评价效果在同一 uninterrupted local list 内双向覆盖前后短 sibling；不能只从首个明确结果开始继承，也不能要求每个成员重复分值或评价动词。名词化维度、目标属性、内容要求、标题、履约 KPI、供应商动作和“应完整、合理、先进”等理想属性不是结果命题；最近存在响应、提交、编制、提供或“投标文件内容”controller 时，该 basis 被阻断，除非 source 后续另行闭合新的评价 Owner 与终端效果。

具名技术或服务因素不要求拥有独立分值。“具名”表示 source 命名了语义上彼此可区分的评价维度，不表示每个维度必须继续给出子指标、阈值或专业细目。若同一局部规则并列给出两个或以上 head noun 不同的服务能力、产品性能、技术配置、方案、承诺或响应属性，并把它们与共享综合评分、比较、排序或选择效果相连，这些因素已经满足关系型 specificity；能力、性能、配置不能被合并降级成一个泛称标签。禁止增设“每个因素必须另有具体评分规则、档位、扣分或 pass/fail 命题”的第五 Gate：评价 controller、并列因素列表和后续共享的综合评判、分别评分、名次折算、累计得分、排序或选择结果可以位于相邻不同 blocks，它们共同构成一个 explicit evaluator。即使同一规则还包含资质、业绩或价格，最小关系闭包仍是目标。纯总分构成、纯价格规则或只有一个“技术评审”“服务能力”等泛称标签而没有第二个可区分方向的内容仍不是目标。

Specificity 同时允许 intrinsic 与 relational 两条独立充分路径。单个具名方案、方法、措施、能力、性能、配置、承诺或响应属性，只要其内部列出具体组成、步骤、阈值、分值、扣分、档位或缺陷标准，就已经具名，不要求再出现第二个大类。只有单项内部缺少可区分内容时，才需要依靠两个或以上不同 head noun 与共享评价效果形成 relational specificity。不得把 relational 路径误用为所有目标都必须满足的最低数量门槛。

普通响应目录和编制要求不能自行建立评价 Owner。但 Owner 已由独立评价 source 闭合后，远端投标响应章节若逐项复现该评价规则的全部或主要具名因素，并明确它们是投标文件必须组织、编制或提交的对应部分，则最小因素标题、目录和必要格式句属于 evaluator-dependent response mapping，应随评价关系闭合保留。单个名称巧合、部分弱对应、通用封面、签章或无关响应内容不属于该闭包。

若完整 source 已足以确认不存在有效 Owner，或 Owner claim 明确为 `none`、生命周期明确为 `post_award` / `non_evaluation`，空集合是正常且强制的 `publish` / `resolved` 结果。不应为了避免空结果而选择程序、符合性、履约考核或响应目录，也不应仅因“没有目标”返回 `needs_review`。只有 source 本身缺失、截断或角色关系确实无法完成判断时才进入人工复核。

### 2. LLM 负责语义，代码不得离线裁决

**不可妥协红线：代码只负责原子化机械工具，不能负责任何语义判断。凡是依据 source 文本含义改变 keep/drop、Owner、最终范围或裁决方向的逻辑，都属于架构违规。**

Pi Agent 底座负责通用 Agent harness，包括模型循环、消息上下文、工具调用、provider、流式响应、取消和基础错误处理。repo-local Extension 不得重复建设另一套专业 Agent 框架；它只保留当前 capability 无法交给通用底座的薄适配层，例如不可变 packet/SHA、硬预算、schema、trace、失败分类和唯一终态。

因此，本项目代码工具的主体应是原子能力：结构寻址与原文读取、显式 query 搜索、切片、范围解析、exact quote 锚定、集合比较以及模型已选择结果的机械展开。必要的隔离 Reviewer/Challenger 也应直接复用 Pi Agent loop；Extension 可以冻结机械阶段顺序、隔离上下文并施加预算，但不能依据 source 含义、关键词或预期答案选择语义路线、修复方向或最终结果。Harness 可以拒绝结构上或协议上无效的提交；是否允许另一次模型调用必须服从该路线预先冻结的总调用上限，不能把 schema 纠错隐藏在预算之外。代码不能替 LLM 修正、补全、删除或选择任何语义答案。

代码只能提供原子化、可组合、无语义答案权力的工具。这里的“原子化”是指：读取一个不可变 block 或结构字段、按显式 ID 定位和切片、暴露原始邻接/父子/表格/编号拓扑、把模型选择的 unit 展开为 ranges、锚定 exact quote、校验 schema/SHA/集合/预算/调用上限并记录 trace。每个工具只完成一种确定性机械动作；工具输出只能是 source、结构事实、地址或协议结果，不能是 keep/drop、目标/非目标、Owner、controller 语义、生命周期、评价对象、评价效果或最终范围结论。

原子地址必须单义且直接暴露。每个 block 的 canonical `range_id="段落N"` 必须与 numeric block ID 一一对应；正文中的章节号、条目号、评分项序号和自然语言数字只是 source 内容，不得被代码或模型换算、平移或猜测成输出地址。

任何依赖 source 文本含义的判断都必须由 LLM 完成，包括某段是否属于技术/服务评分、价格、资格、程序、响应要求、post-award，某标题是否真正支配后文，某表尾是否归属前表，某 cross-reference 是否有效，以及某 quote 是否真的分别证明 controller、target 或 effect。代码可以验证模型引用的字符串确实存在、地址属于允许范围、多个 anchor 是否满足固定形式约束，但不能验证或补写其角色含义。

禁止把多个原子工具逐步组合成隐藏的离线语义裁决器。尤其不得因为关键词、regex、结构位置、表格列名、编号模式、历史错误类型或多个弱信号同时命中，就自动选择/删除 unit、生成 typed Owner、改写模型 verdict、确定最终 ranges，或选择一个更接近已知答案的 proposal。确定性路由只能依据与语义答案无关的协议状态、调用预算、模型已提交的 typed claim 和纯结构争议形状来限制下一次 LLM 的证据范围；它不能替下一角色预设语义结论。

新增代码前必须回答三个门禁问题：该逻辑是否只暴露或校验机械事实；删除它是否只影响可观测性/协议安全而不会直接改变 source 的语义分类；它是否能在不读取任何 expected、case ID、项目名和行业词典的情况下，对行业名词替换、章节重排、表格/段落互换保持同一机械行为。任一答案为否，就必须把该判断移入 Prompt/LLM，或拒绝实现。

确定性代码只能负责：

- schema 解析与规范化；
- 文档结构解析、索引和不带目标标签的结构分组；
- 定位、切片、上下文投影和 token budget；
- SHA、range 解析与展开、exact quote、集合差异和一致性校验；
- 调用上限、超时、协议重试、trace；
- 将模型选择的结构 unit IDs 确定性展开为最终 blocks。

代码不得判断某段 source 是否属于评分目标、应该 keep 还是 drop。尤其禁止使用人工关键词、regex、词典、启发式、预标注、case-specific 表或冻结 ranges，把语义内容直接转换成最终答案。

确定性 recall probes 只能发现或扩大候选上下文，不能删除候选、赋予目标身份、强制保留 unit、直接生成最终 ranges 或覆盖模型判断。结构 closure 只能表达文档拓扑，其语义选择必须由 LLM 完成。合同校验可以拒绝无效决定，但代码不得替模型给出语义答案。

保留的 v6.3 Candidate-blind Reviewer 输入必须只由其冻结 Prompt、candidate-neutral 完整 source、机械拓扑、terminal tool schema 和固定预算组成。对同一 source packet 改变 `initialRanges` 时，该基线的 system Prompt、user Prompt 和 tool schema 必须保持 byte-identical。保留的 v7 Residual Challenger 显式看到 candidate ranges；保留的 v8 Source-only Challenger 对 candidate 变化保持 byte-identical。当前 v9 Residual Issue Reviewer 必须看到 candidate ranges，但只以 `untrustedCandidateRanges` 身份接收；不得注入 accepted Prompt、accepted 身份、candidate-derived C/N 标记、candidate audit、历史输出、case 身份或 evaluator 数据，也不得暴露 Runtime 推断的 `Q` sequence facts。原始 Word numbering、text marker、标题、父子和表格事实可以作为无语义权力的机械证据。

当连续段落 `base_scope` 与带直接前缀、表格及局部尾句的 `table_scope` 形成 crossing overlap 时，代码只可暴露 overlap、两侧独有范围和 union。是否属于同一 authored score representation 必须由 LLM 根据 controller、Owner、生命周期和 source 关系判断；成立时选择并集，不成立时按肯定语义边界拆分。拓扑重叠本身既不证明保留，也不证明删除。

保留的 scope-graph 与 Owner/Boundary 实验基线可以按各自冻结合同暴露结构事实并把争议交给 LLM，但代码只能扩大证据、拒绝结构上自相矛盾的表达和执行机械调用预算，不能决定应补标题、删边界还是闭合并集。当前 Pi-native targeted-repair v9 为两个角色构造同一份完整 source 与机械拓扑；Call 1 接收 untrusted candidate 并提交 challenge-envelope ranges、短 `proposal_claim` 和 evidence blocks。发生 contract-valid different envelope 时，Finalizer 接收 candidate、envelope、Runtime 机械计算的 exact delta 和完整 source，但不接收 Reviewer claim 或 evidence leads。accepted Prompt 原文只进入 capability provenance。Finalizer 可以在 envelope 内逐块发布最终 ranges；代码只校验 ID、共同 block 锁、允许的 added/removed envelope 和地址合同，不得生成语义挑战或修复方向。

评测脚本同样不得在计分前对 Agent 结果做生产路径不存在的语义修正、范围补齐、污染删除或更宽松 canonicalization。只有与正式运行完全相同、且能证明 expanded block IDs 不变的纯语法规范化才允许使用。

### 3. Baseline-free，禁止答案泄漏

Agent 运行时只能读取不可变 source packet、公开任务合同和当前 run 内产生的输出。运行时不得读取或接收：

- expected、gold、reference 或人工修正 ranges；
- production baseline、xq-agent、Pi-agent 或其他竞品输出；
- evaluator 标签、通过/失败结果、scorecard 或含答案评论；
- 同一 case 的历史 run、trace、报告、缓存决定或模型答案；
- 从 case ID、source name、source hash、block ID 或已知 ranges 到答案的映射。

`initialRanges` 和 `locatorContext` 仅是无答案特权的上游 Locator 候选，不是 baseline、expected 或正确性证据。

禁止：

- 按 case ID、文件名、source hash、已知 block ID 或冻结 ranges 分支；
- 从 fixture、报告、trace、snapshot 或其他仓库复制答案；
- 根据隐藏答案选择 Prompt、模型、阈值、重试次数或工具；
- 查看 blind case 答案后修改实现，却继续把该 case 报告为 blind；
- 查看 expected 后人工修复输出，并计入原始 Agent 成绩。

### 4. 盲测必须隔离运行时与评测器

盲测前必须：

1. 冻结 Agent 代码、Prompt、模型配置、工具合同和评测规则，并记录不可变 hash。
2. 选择开发者和运行时都未接触答案及历史输出的新 case。
3. 在无答案环境运行 Agent，先持久化 raw result、trace、配置和 hashes。
4. Agent 结果落盘后再启动独立 evaluator；只有 evaluator 可以读取 expected。
5. 按冻结规则计分，不得在评分后修复、重解释或挑选结果。

评测器可以确定性比较 Agent 输出和 expected；这是独立评测，不是 Agent 运行时的离线语义裁决。

任何已查看答案的 case，从该时刻起永久降级为当前 Agent 家族的开发回归集。它可以验证不回退，但不能再提供 blind 泛化证据。

### 5. 有界 Agent loop，不靠随机重跑

- 每条运行路线必须声明角色、证据输入、最大模型调用数、协议重试条件和唯一终态。
- 当前 Pi-native targeted-repair v9 把冻结 single-prompt candidate 视为受保护产品输入；accepted Prompt 原文/hash 进入 capability provenance，但 Prompt 文本和 accepted 身份不注入 worker。Call 1 只把 candidate 视为 untrusted patch。Owner 不是代码 Gate，而是两个角色都必须从 source 闭合的通用语义关系。
- Residual Issue Reviewer 提交唯一完整 `proposal_ranges`，但该集合只定义 challenge envelope，不是必须整套接受的第二答案。它必须包含短 `proposal_claim` 和少量非空 `evidence_block_ids`，没有语义 `degraded` 分支。Candidate 为 null/空集合仍必须审查完整 source，不能直接发布空结果。
- Reviewer 提交前必须双向反证 candidate：扫描 candidate 外部的最强 missing-scope 反例，并扫描 candidate 内部、首尾、表格、controller transition 和可分离 sibling 的最强 pollution/boundary 反例。每个 envelope-only block 都必须对应具体 material challenge，不能为扩大审查面加入无关远端章节。某处存在一个有效目标不能自动保护整个连续范围；不可拆原子 block 的 precision debt 也不能传播到可单独寻址的后续 sibling。
- Runtime 机械比较 candidate 与 envelope。Same-set 不是有效 falsification envelope，必须一调用 fail closed 并以 degraded 保留 candidate；只有 contract-valid 且不同的 envelope 才调用一次 Targeted Repair Finalizer。共同 blocks 被锁定；Finalizer 可以逐块接受或拒绝 Set A only / Set B only challenge，并发布 envelope 内的完整 final ranges，或 `degraded`。它不得新增 envelope 外 block、删除共同 block或触发第三次修复。
- Candidate override 必须同时具备两把语义钥匙：Reviewer 先打开 exact changed-block envelope，Finalizer 再在该 envelope 内发布实际改变。除此之外的所有路径都静态保留 candidate；其中 provider、context、schema、地址、预算、Finalizer `degraded` 或其他审查未完成必须显式返回 `status: degraded` 与 `reviewDegraded: true`。
- Candidate 是受保护的第一判断而不是答案。Reviewer envelope 必须来自具体 source-grounded 残差问题。进入 Finalizer 后，candidate 的 accepted 历史和 envelope 的 Reviewer 身份都不能作为 source 证据；Reviewer claim 和 evidence leads 必须隐藏，避免第二角色被其叙事锚定。每个被最终新增或删除的 block 都必须正向闭合或排除 Owner、生命周期、评价对象、终端效果和最小边界；“内容可指导技术写作”不是充分理由。
- 后续调用必须带来正交职责、独立反证、新 source 证据或明确争议收敛，不能重复同一 Prompt 等待随机变好。两个同模型角色仍可能存在 common-mode risk，因此调用次数本身不是质量证据。
- v13 的 Independent Release Gate 是 candidate override 的条件式第三把发布钥匙：它只审查 Primary 已批准的 exact add/remove IDs，并只能批准其子集。Primary 未改变 candidate 时 Gate 必须跳过；Gate 未完成、降级或越界时必须保留 candidate，不能发布 Primary 中间结果。
- v14 的 Full-Challenge Release 同样只在 Primary 实际改变 candidate 时启动，但它盲审 Reviewer 打开的完整 exact challenge，并将自己的批准子集作为唯一可发布 delta。它不能读取 Primary 理由或批准状态，不能新增 Reviewer envelope 外范围；失败时保留 candidate。
- v15 的 Partial-Group Appeal Release 只接收 Primary approvals 与机械计算的 partial-item appeal IDs，不接收 Primary reason 或 Reviewer claim。它可以 veto approvals、批准 appeal 子集，但不能访问全拒 item 或未挑战 block；最终 delta 由其批准集合机械生成。
- v16 的 Reviewer-Dialogue Primary 必须把 Reviewer claim 只当待验证 issue；Selective Release 只审核 Primary approvals，且看不到两次前序角色的叙述。最终 delta 仍是 Release approvals 的机械子集。
- v17 的代码只校验单 issue action 与 candidate membership、exact ranges、三次整体 verdict、预算和 trace；任何部分批准、action/range 改写或方向恢复都必须拒绝并保留 candidate。
- v18 的代码只隔离 Reviewer attack、Primary response 与完整 source，计算 exact approvals/rejections，并校验 Release 输出属于 Reviewer envelope；代码不得判断哪一方论证更强或据此预设最终 delta。
- v19 的严格方向校验和 whole-candidate escalation 只能使用 candidate membership 与集合相等性；不得从关键词、项目、block 内容或历史答案推断方向或触发第三角色。
- v23 的代码只能分别验证 precision issue 全部位于 candidate 内、recall issue 全部位于 candidate 外，并机械执行 Primary 选择和 Release 整体 verdict；不得依据 source 文本、issue claim、case 身份或评测结果替 Primary 选择方向、合并两个 issue 或改写最终范围。
- v24 的代码只可在 Primary 已选择 issue，或 Reviewer 双轴均非空且 Primary preserve 时触发 Debate Release，并机械执行 Release 在现有三项中的选择；不得读取论点含义决定是否触发、替 Release 选边、合并 issue 或生成第四套范围。
- v25 的代码沿用 v24 的纯结构触发和机械三选一，但必须保证 Release 输入不含 Reviewer/Primary 叙事、evidence leads 或选择结果；消息隔离本身属于 harness，不能从被隐藏内容推导提示、优先级或默认答案。
- v51 的代码只能构造匿名 A/B 集合、锁定公共 IDs、校验 difference membership、按字符长度触发可选 Planner、执行模型明确给出的 literal queries、返回原始 offsets/excerpts、规范化完全相同的重复 terminal submission，并记录预算与 trace。字符阈值、集合身份、NFKC/标点/空白规范化和 provider terminal 兼容都只能影响可读证据与协议有效性，不能根据 source 含义选择 Set A、Set B、子集或 semantic route。
- v53 的代码只能在 Reviewer 已明确提交 removal 后，依据 candidate membership、exactly-one oversized changed block 和冻结字符阈值选择 Atomic Removal Verifier，并对其唯一 source literal query 做机械规范化、唯一匹配和 canonical exact quote/offset 物化；或者在 Reviewer 提交 exactly-one candidate-absent、非 oversized、canonical immediate-edge block 时选择专用 Edge Addition Primary Prompt。同一 removal envelope 的其他短 blocks 必须保持 candidate membership，不能因 Reviewer 单方挑战被删除。代码不得读取 query/quote 含义、自动识别 mixed table、local group 或 boundary，替任一模型选择 retain/remove/include/exclude，或把多个 changed blocks 拆成隐藏 ledger；删除这些结构分流只应改变调用角色或证据合同，不应由代码产生任何语义答案。
- v56 的代码只能校验 Reviewer 完整重建 IDs，机械比较其与 candidate 的集合相等性，构造二者集合并集，并校验 Finalizer 输出是该并集的子集。代码不得根据两集合差异方向或文本内容触发不同 Prompt、模型、重试或离线修复；所有 keep/drop、恢复、删除与必要闭合判断都由 Finalizer LLM 完成。
- v58 的代码还可以把 candidate 与 Reviewer proposal 的 membership 机械标记为匿名 A/B hypothesis 并记录到 Finalizer 输入 hash；这些标记不得带 accepted/Reviewer 身份、置信度、默认答案或语义权重，代码仍不得依据差异方向或 source 内容替 Finalizer 选择 membership。
- contract-valid 的有利或不利语义 verdict 都不能因为“不符合预期”而重跑、投票或 best-of-N 选优。当前 v9 不提供 protocol retry；失败直接走候选保护降级，不得消费隐藏调用。
- v8 source-blind full-proposal、v7 candidate-aware full-proposal、v6.3 candidate-blind same-contract 路线和旧 v1/v2/v3、Owner/Boundary v5、xq-parity、scope-graph 路线只作为明确命名的实验基线保留；它们的具体阶段、schema 与修复拓扑属于各自 route contract，不属于 v9 产品合同，也不得泄漏进 v9 worker Prompt。
- 未闭合分歧、provider failure、context failure 或预算耗尽必须显式记录为降级或进入人工复核，不能伪装成 Reviewer 成功、Agent 修复或 runtime success。

### 6. Prompt 泛化与反过拟合

从开发 case 学习时，必须先形成可审查的抽象链：

```text
case symptom
-> abstract failure mode
-> stable domain invariant
-> generic decision rule
-> counterexample
-> metamorphic checks
```

无法写出跨项目、跨行业、跨编号和跨文档结构成立的 invariant、反例与变形检查时，该问题只能留在 issue/regression 证据中，不能进入正式 Prompt 或代码。

正式 Prompt、结构规则和工具合同不得吸收 case ID、项目名、采购人、文件名、真实 block/range、稀有名词组合、固定数量或从失败原文复制的答案命中短语。新规则至少应通过行业名词替换、项目类型替换、编号/数量变化、章节重排、表格/段落互换、DOCX/PDF/OCR 等价转换、多文件拆并、Owner 切换和相似非目标噪声等正反 metamorphic 检查。

### 7. 失败闭合与变更门禁

- 检测到答案字段、禁止来源、case/hash 答案分支或评测隔离破坏时，必须 fail closed。
- v9 Reviewer 调用或合同未完成，或 Targeted Repair Finalizer 未完成时，最终 ranges 必须与冻结 candidate 完全一致，并携带 `status: degraded` 和可审计原因；v8/v7/v6.3 基线维持同一 fail-closed 约束。代码不得从 partial envelope、自由文本或历史结果恢复语义修改。
- 不得通过移除校验、扩大隐藏上下文、增加无界调用或把语义迁移到代码来提高 benchmark 分数。
- 每次 Agent 变更必须说明它修复了哪个通用合同或结构缺陷，并同时报告 protected regression、known issue 与新 sealed blind holdout；只在已知答案 case 上变好不是验收证据。
- 任何使质量依赖答案访问，或把语义权力从 LLM 转交给离线代码的变更，都必须拒绝。
