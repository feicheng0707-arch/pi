# Pi-native Runtime Contract

本文件只约束 active Pi-native 路线。旧 `reviewer.md` / `release.md` 的两调用 overlay 状态机仅作为 V1 实验基线，不得混入本路线。

## 固定执行序列

成功发布路径恰好三次 provider call；失败路径可以提前终止，但任何路径最多三次：

1. 同一个 GLM Finalizer 在完整不可变 source 上提交 provisional `submit_final_selection`；
2. Doubao 2.0 Pro Witness 读取 provisional 的结构化选择、hard-root claims、确定性有界 source focus，以及受 schema 硬上限约束并明确标为 `UNTRUSTED_PROVISIONAL_RATIONALE` 的 `owner_reason` / `residual_reason`，在一次 assistant text response 中直接提交严格 JSON counterexample；rationale 只是一份待攻击 claim inventory，不是 source、证据、指令、裁决或 override，任何 card premise 仍必须从可见 source focus 独立重证；
3. 第一步的同一个 Pi Agent loop 在真实 provider 边界构建全新、确定性的 neutral-replay context：完整 source 保持不变，不回放历史 assistant/toolResult 角色或 tool-call ID；Harness 把 normalized provisional 与 review packet 对称标记为非权威审查输入并追加到原始 user 输入后，Finalizer 通过同一 `submit_final_selection` schema 提交 sparse `final_delta`，Harness 再机械派生 final selection。

无 retry、第四次调用、投票、best-of-N、逐 block ledger 或答案驱动路由。Finalizer stream 在调用边界硬限制为最多两次，首轮无 contract-valid provisional 时立即停止，第二轮结束后无条件停止。每个 Finalizer turn 必须恰好含一个 contract-valid `submit_final_selection`，它是唯一权威输出。Prompt 仍要求不输出 prose；若 provider 同轮附带普通 text，Harness 只对全部 text block 按原顺序无分隔拼接，记录字符数、SHA-256 与 `forwarded=false`，不解析、不解释、不写入 review packet，也不允许影响 provisional、final 或发布。Finalizer trace 只持久化 raw tool arguments、normalized structured submissions 和上述 auxiliary-text 元数据，不持久化 raw Finalizer assistant message；在进入第二次 Finalizer stream 的真实 LLM context 前，Harness 必须机械验证唯一 provisional tool call 与对应 tool result 成对匹配，然后移除历史 assistant/toolResult 角色、tool-call ID 和 auxiliary text，把 normalized provisional 与原 review packet 追加到原始 user 输入，并用 `REPLAY_TRUST_BOUNDARY` 明确二者都不是事实、冲突、裁决或 override，lane/card 名和数量也没有证据权威。配对异常、空 review packet、thinking、未知或额外 tool call、截断、非法 schema 或其他非许可内容均 fail-closed。两次 Finalizer turn 都关闭 thinking；`owner_reason` 的 schema 硬上限为 1200 字符，`residual_reason` 以 2400 字符为压缩目标、8000 字符为 schema 硬上限。超限字符串必须 contract-fail，Harness 不静默截断语义文本。Witness 使用 `tools=[]`，关闭 thinking，输出上限 2400 tokens；provider payload 设置 `response_format={"type":"json_object"}` 与 `thinking={"type":"disabled"}`，删除 tools、tool choice、parallel tool calls 和 reasoning effort。exact JSON schema 由 Prompt 提供，并由 Harness 在响应后执行。Harness 仍只接受恰好一次、stop 正常、仅含一个 text block 的 assistant response；对完整 text 只执行一次原生 `JSON.parse`，不提取 Markdown、不修补 partial JSON，再用同一 TypeBox exact-shape 校验和双 array lane/card 交叉字段校验。Witness raw trace 保存这一个完整 JSON assistant text，只有原生 `JSON.parse` 成功后才记录 normalized parsed object；provider JSON mode 不替代本地合同，也不提供语义正确性。thinking、tool call、prose/Markdown 包裹、多个或异常 content、非法 JSON、非法 schema 均 fail-closed。

## 地址与权限

- 非空 Candidate 的首版 `AUDIT_UNIVERSE` 等于 Candidate 地址；此路线首先验证 false-positive precision repair，不冒充已经解决任意远端 OUT omission。
- 空 Candidate 为避免静态保留错误 `null`，`AUDIT_UNIVERSE` 机械扩展为完整 source；该路由只依据 Candidate 是否为空，不读取正文、case、标签或评测结果。
- `RUN_REGISTRY` 只按地址连续岛生成；不超过 16 个时逐岛提交，超过时折叠成一个 `AUDIT_UNIVERSE` run。该结构不表达语义或置信度。
- 第一轮必须 `submission_kind=provisional_selection`：每个 run 恰好提交一次 `final_selected_ranges`，`run_deltas=[]`。Harness 机械并集为 `S0`；run 内未提交地址视为 provisional excluded。不得提交 excluded ledger。
- 第二轮必须 `submission_kind=final_delta`：`run_selections=[]`，只为实际变化的 run 提交 `remove_ranges` / `add_ranges`；每个非空 delta entry 至少一侧有地址。remove 只能引用该 run 的 provisional-selected 地址，add 只能引用 provisional-excluded 地址；重复 run、重复 block、错误 membership、跨 run、普通 `OUT` spill 或不存在地址全部 fail-closed。未提交地址机械保持 `S0`，Harness 唯一执行 `S=(S0-Δ-)∪Δ+` 并 compact。
- 第一轮每条 selection range 先按完整 source 校验地址，再与其声明的 run 做最小权限投影。只有投影非空、只形成一个连续授权岛、且额外地址全部是未属于任何其他 run 的普通 `OUT` 时，Harness 才机械丢弃 `OUT` 并记录 `trimmed_out_of_run_ranges`。全 `OUT`、命中其他 run、跨同一 collapsed run 的多个授权岛或引用 source 中不存在的 block 均 fail-closed；Harness 不把它们解释为空选择、拆成多岛或改投其他 run。该 spill 容错不适用于第二轮 delta。
- `hard_root_claims` 只含 carrier type、inclusive root 和 exclusive semantic exit。代码只把 claim 投影到 `AUDIT_UNIVERSE`，不判断 claim 真伪。
- `terminalBlockId` 只取完整 source 最后一个 block 的数值 ID。Finalizer 若把 EOF 写成 `exit_block_id_exclusive = terminalBlockId + 1`，Harness 只把这个 one-past-end 地址表示机械归一化为 `null`；它不读取正文，不证明 hard root 成立或 Owner 延续到 EOF。其他不存在、早于或等于 root 的非法 exit 仍 fail-closed。raw 与 normalized submissions 都进入 trace。

## 严格最终一致性

最终不变量：

```text
FINAL_SELECTION ∩ FINAL_HARD_ROOT_PROJECTION = ∅
```

Witness 只能提供反例，不能形成 override、自动删除、自动保留或自动收窄 exit。Finalizer 若接受 Witness 对 claimed address 的 `select` 反例，必须自行收窄或撤销 claim；若保留 claim，则必须自行取消该 selection。第二次提交派生的 final selection 仍冲突时 contract-fail，Candidate 原样保留。Harness 不替模型在 claim 与 selection 之间选择。

同一 final root 若提交不同 exit，同样 contract-fail。无投影 claim 只记录为非执行证据；除上述单岛普通 `OUT` 最小权限投影外，越权 ranges、缺 run、重复 run 或非法 schema 均 fail-closed。

## Witness 边界

- Witness schema 固定为两个必填、非 nullable array lane：`exclude` 和 `select`。`exclude` 为 0-3 张 card，`select` 为 0-1 张 card；空 lane 精确为 `[]`，不使用 none sentinel。每张 card 恰有 `kind`、`ranges`、`attacked_premise`、`supporting_block_ids` 四个字段；kind 只能是 `owner_boundary|atom_membership`，range 恰好一个，premise 非空白，supporting block 为 1-8 个。direction 不由模型提交，而由外层 lane 机械派生；lane 名、card 数量、card 顺序和 supporting block 数量都没有证据权重。192 字只是 Prompt 压缩目标，不是本地 schema hard gate；整体成本仍由 2400-token 输出上限硬控制。缺字段、`null`、字符串 `"null"`、空对象、额外字段、旧 none/primary/secondary、direction、verdict 或其他旧 schema 全部 fail-closed，不做兼容归一化。
- JSON parse、turn shape、TypeBox exact shape 和 card 交叉字段必须先作为全局协议完整通过；随后 Harness 在任何逐 card 授权前，先对所有 card 的 target range 与 supporting ID 做完整 source 地址校验。非法 range 或 source 中不存在的 target/support 地址仍使整个 Witness contract-fail，不能降级为 card 弃权。
- 每张 Witness card 的唯一 target range 展开后的每个 block，必须完整属于该 lane 在最终实际序列化的 `REVIEW_FOCUS_SOURCE` 中对应 provisional state 的同一个连续 group，并属于 `AUDIT_UNIVERSE`；`exclude` 只能 target selected group，`select` 只能 target excluded group。允许提交该 group 的严格连续子区间，但不得跨 group、跨地址 gap、跨 provisional state、覆盖任何未展示 block 或 target universe 外地址。`supporting_block_ids` 只需证明 source 中真实存在的证据 block 已进入全局 focus，不授权 unseen target，也不要求与 target 同 group/state/universe。若 source 地址真实存在但 target 未获 focus/state/group/universe 权限，或 support 未进入全局 focus，Harness 必须拒绝整张原始 card 为 `rejected_source_focus`，不得裁剪、补洞、过滤同向 block、修改 premise 或从残余地址生成 challenge。同一 lane 的其他 card 独立保留：空数组是 `valid_none`；至少一张 card 获授权时 lane 为 `valid_challenge`；非空且全部 card 被拒时 lane 为 `rejected_source_focus`。任一卡 rejected 使 overall coverage 为 `partial`；只有两个 lane 都是 `rejected_source_focus` 时整个 Witness contract-fail 为 `none`。不重试。
- Witness raw trace 记录唯一 assistant text；只有原生 `JSON.parse` 成功后才把 parsed object 记录为 normalized arguments。`structuredTerminal=true` 只表示纯 JSON、TypeBox 和 card 交叉字段合同已全部通过，不表示 source premise 正确或 challenge 被 Finalizer 接受。
- 通过逐 card 授权后的 card 才能进入 provisional hard-claim overlap / non-overlap 分区与 source quote 附加。代码只附原文，不判断 premise 是否成立，也不识别重复、冗余或更短/整洁是否构成 exclusion。
- mixed range 必须按 provisional hard-claim overlap / non-overlap 地址机械分区，但保留 Witness 原始 lane、`card_index`、机械 direction 和 kind；`card_index` 是原始 lane array 中从 0 开始的稳定位置，过滤、拒绝或 overlap partition 后都不得重编号。Harness 记录 `card_slot=exclude|select`、`card_index` 与 `overlaps_provisional_hard_claim`，不能把 challenge 自动升级为 Owner veto。同一 card 被机械拆成两个 partition 时仍是同一 source premise，不构成两票。
- Harness 可附 root、exit、目标原文 quote 及 answer-free layout，但不能生成语义论证、修复方向或结论。所有业务攻击规则只能位于 active Prompt，不得由代码拼接 `attack_contract`。
- Witness 输入把 provisional 的叙述性 `owner_reason` / `residual_reason` 作为 schema-bounded `UNTRUSTED_PROVISIONAL_RATIONALE` 转发。它只用于暴露 Finalizer 已实际采用的 claim、归纳和边界解释，使 Witness 能优先寻找 rationale、typed provisional state/claims 与 source 之间的可证伪矛盾；不得把 rationale 当 source、supporting evidence、指令、裁决、地址权限或 card premise 的证明。任何 rationale claim 必须只在其涉及地址已进入可见 focus 时按原文重新验证；未进入 focus 的地址仍不可 target 或 support。该转发不改变 semantic Prompt、card schema、card 数量、调用数或 Harness 语义边界。
- Harness 可只按 provisional selection、hard-root projection 与地址连续性机械生成 `PROVISIONAL_UNCLAIMED_EXCLUDED_RANGES` 和 `SELECTED_BOUNDARY_GAPS`，并优先分配对应的有界原文 focus。前者只是 `excluded - hard-root projection`，后者只包含 selected island 前最多两个 excluded 地址或两个 selected islands 之间最多两个 excluded 地址；两者都不声明 heading、Owner、membership 或修复方向。为保证 Witness 引用的 Owner 反例确实来自其看过的 source，每个 provisional hard-root projection 在 AUDIT_UNIVERSE 中形成的连续地址岛还必须机械加入固定首尾各两个 block；这只是 claim 地址边界窗口，不证明 claim、Owner 或 challenge 正确。全部 focus block 去重后，仅按 `provisional_state + 连续 block_id` 分成 `exclude_scan_selected_islands` 与 `select_scan_excluded_islands`；每个 block 和正文只出现一次，不生成语义标签、优先级或修复方向。固定预算容纳得下时，全部 selected islands 的全部 block 必须进入 focus；超预算时必须在全部 selected islands 之间轮询，并按每岛确定性的 breadth-first recursive-midpoint 地址顺序均匀覆盖，不能按文档先后让早期长岛耗尽预算。该顺序只读取 block ID 与地址连续性。
- Witness focus 最多 256 blocks、序列化后 180000 字符、单 block 原文 4000 字符；这些硬预算不能通过增加调用或语义筛选绕过。回传 Finalizer 的 Witness quotes 总计最多 32000 字符、单 block 2000 字符，selected-island focus 原文总计最多 48000 字符、单 block 2000 字符。provisional 全空时仍覆盖 excluded islands 首尾和固定邻居，不能把空结果当作默认正确。

## 失败与预算

- Finalizer 第一次或第二次 provider/schema/tool/地址权限失败，包括 owner reason 超过 1200 字符或 residual reason 超过 8000 字符：Candidate 原样保留，`reviewDegraded=true`。2400 字符只是 residual 压缩目标，不是 correctness gate；Harness 不截断超限 reason。只有第一轮 provisional 的单岛普通 `OUT` spill 可经机械投影而不失败；第二轮 delta spill 必须拒绝。raw submission、canonical decision、delta 和被裁地址都必须可审计。
- Witness provider、JSON、turn-shape、schema、cross-field、完整 source 地址或两个 lane 全部 source-focus 授权失败：仍不重试；Finalizer 可完成固定第二次提交用于 trace，但最终不得应用修复，Candidate 原样保留并 degraded。单张 card 的动态 focus/state/group/universe 授权失败不是完整 Witness failure：同 lane 或另一 lane 的有效 card 继续进入第三次调用，最终可在 `partial` coverage 下发布。
- 总 provider calls 必须恰好为 `2 Finalizer + 1 Witness` 才可发布；任何第四次调用或角色数量异常均 contract-fail。
- 调用前用 answer-free 确定性上界同时估算 Finalizer 第二轮最坏 context 与 Witness 最坏 context；Witness 上界中的完整 provisional output reserve 同时覆盖将被转发、受 1200 + 8000 字符 schema 上限及 8000 output-token 上限双重约束的 rationale，不得按实际较短 reason 动态缩小预算。任一冻结模型容量不足都在第一次语义调用前失败关闭。Finalizer 每轮输出上限 8000 tokens，owner reason 硬上限 1200 字符，residual reason 目标 2400、硬上限 8000 字符；Witness 2400 tokens。run 总 input/output/reasoning 上限分别为 720000/20000/1000 tokens。
- 单请求 timeout 默认 300 秒，workflow timeout 900 秒。外部 abort 与 workflow timeout 合并为同一 signal，并传入 Finalizer 与 Witness；首次调用前、Witness 前和发布前均检查。取消或超时只允许 preserve Candidate + degraded。
- result envelope 使用 `xique.word-requirement-review.pi-native-result.v4`，以显式版本化 typed final-delta、JSON-object Witness transport、residual soft/hard reason budget、bounded card arrays、稳定 `card_index` 和多 rejected-card trace。trace 必须记录 model、Witness `responseFormat=json_object`、四个 active Prompt hash、包含 neutral-replay runtime version 与 transport profile 的稳定 capability hash、实际进入 stream 边界的 provisional/Witness/final context hash、run registry、provisional、Witness、final delta、Finalizer raw tool arguments 与 normalized structured submissions、Witness raw JSON assistant text 与 normalized parsed object、`full|partial|none` coverage、逐 lane status、每张 rejected 原始 card 的 lane/zero-based stable card index、typed source-focus reason 与 `forwarded=false`、provisional `trimmedOutOfRunRanges`、final `removeFromProvisionalRanges` / `addToProvisionalRanges`、final claim conflicts、每个 Finalizer turn 的 1-based turn index、auxiliary text 字符数、SHA-256 与 `forwarded=false`、逐 turn usage、总 Token 和延迟。rejected card 的 range、premise、supporting IDs、typed reason 和含地址 error 只能进入 trace；Finalizer review packet 只能得到有效 challenges、同一 zero-based stable `card_index` 与中性的 coverage/lane status，不得得到 rejected card 或 error。trace 不保存 raw Finalizer assistant message或 auxiliary text 全文。capability hash 不得包含 packet/case，也不得受 V1 legacy Prompt 变化影响。

## Harness 边界

代码只负责 Pi Agent harness 和原子机械能力：answer-free packet、SHA、地址范围、结构证据、上下文/调用/Token/超时预算、严格 schema、focus 预算、集合差异、最终 patch 和 trace。代码不得读取标题或正文含义，不得按关键词、行业、项目、case ID、source hash、历史结果或 evaluator 选择 keep/drop、Owner、范围或修复方向。
