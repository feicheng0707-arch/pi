# Word 采购需求 Reviewer Runtime Contract

本文件是 `semantic-contract.md` 的可执行切片，不创造新语义。完整 product principles 与 semantic contract 仍是治理真源；运行时只保留会改变终态的优先级，避免低优先级局部规则覆盖高优先级载体边界。

## 目标

输入是完整不可变 source、成熟 single-prompt Candidate 和 answer-free 结构证据。只修复 Candidate 的材料性残余错误；正确 Candidate 应保持正确。不得读取 expected、历史答案、case 身份或 evaluator。

## 严格判断顺序

1. **整文关系与实例化**：先用开头、中部和结尾检验 source 是采购人侧需求事实源、多载体采购文件、单一公告/询价/报价邀请沟通载体、单一合同、供应商已完成响应或非采购文档。单一沟通假设必须由实际公告/通知 root 开始、连续功能同质并统辖到真实结尾；若存在平级资格、评审、合同、响应格式、采购需求、技术规范、图纸、清单或有效技术附件 root，必须判为多载体容器。物理采购文件或邀请容器不是第五类硬排除 Owner。`instantiation=present` 必须由已填写且能区分当前采购对象、范围、工作包、数量、现场或委托关系的事实证明；采购机构、通用批次、平台规则、投标时间、范本版本、默认条款、空表和外部指针不能单独证明实例化。`instantiation=present` 只证明项目真实，不授予任何 block membership。
2. **Owner 分区与双向 root/exit 攻击**：按 source 的真实章节、局部标题、附件和表格划分载体。一次紧凑 `carrier_root_exit_attack` 必须同时攻击两侧：对每个有争议的宽硬排除，向前确认实际四类载体 root、向后确认首个不同 Owner 的 peer root 或 EOF；对每个拟保留岛，逐内部子标题检查是否新开始公告/通知、须知、响应/报价格式或合同条款载体。没有 root 就不能建立载体；只有不同 Owner 的 peer root 才结束载体；保留岛内部出现局部 root 时必须从该 root 切开到其语义 exit。`sc/vc` exit 只结束一个物理 scope：若 source 功能仍属同一 Owner，必须沿下一 peer scope 继续传递。更深层附件、技术标题和表格仍是子节点。物理 Word、封面名称、Candidate 连续区间、后续合同章节或相邻另一类排除载体都不能替代 root/exit 证明。
3. **四类硬排除门**：公告/通知摘要、投标人或供应商须知及程序、投标/响应/报价文件格式、合同条款及格式全部不属于 requirement。边界完整的投标方/供应商承诺、响应承诺、无偏离承诺或声明章节，若实际功能是在成交前要求投标/响应主体声明、确认、保证或承诺未来履约，就是响应格式 root；即使没有空格、签章位或“格式/模板”字样，且子项复述质保、质量、服务、人员或交付义务，也整体继承该 Owner。孤立的承诺/保证措辞不能建立载体，四类载体外采购人直接命令中标后执行的义务仍保留。载体一旦由 source 建立，采用 root-closed exclusion：root 自身、内部标题、条款、表格、参数、内嵌附件和连续同 Owner peer 都继承该 Owner，直到首个不同 Owner 的 peer root 或 EOF；不得用局部履约价值、唯一性、技术密度、主要直接效力或义务存活反事实重新打开，也不得把相邻不同 Owner 拼成一个外层载体或让后续载体反向吸收此前技术章节。显式章级公告/通知 root 内的项目概况、范围、期限、地点、质量和技术表都是子节点，不能成为自己的 Owner exit。父章若聚合技术、服务、合同、商务等内容，只是 mixed container；进入 atom gate 前必须做一次 `mixed_container_root_sweep`，关闭其中每个 source-proven 局部四类 root。若同一 root 下删除商务/法律子项却保留后续有用子项，必须否定该 root 或排除完整 root→semantic-exit 区间。
4. **载体之外才做原子效力判断**：仅对已肯定证明位于四类载体之外的混合章节，逐可寻址 block 判断主要直接效力。保留直接规定采购对象、范围、实施、资源、工期、地点、质量、安全、交付、验收、培训、运维、质保、售后的事实；删除可安全分离的资格/评分、采购程序、报价价格、付款结算、保证金、投标有效期、纯违约救济、解除、争议、合同成立、生效、适用法律、一般风险分配和裸外部指针。每个拟删除 block 必须先做义务存活反事实：剥离审批、报审、备案、费用、扣款、违约、解除和赔偿等附带后果后，若仍直接要求实施、资源、计划/方案/报告、记录、交付、限时替换/补齐、响应、平台执行或结果，则保留。供应商负责当前实施所需材料、耗材、工具、设备、设施或人员的提供/准备/保障/可用性时，费用由其承担、已含或不另支付不能抹掉资源 duty；只有资源只是丢失、损坏、浪费、赔偿或计价对象，或条款只分配费用而不要求实际提供资源时才删除。成果准确性/完整性/误差/质量责任、与成果质量直接相连的检查复核验收及纠正机制、适用技术标准的现行版本/替代/优先规则都属于直接工作或履约基线，不要求句法上出现供应商祈使句。明确要求中标/成交供应商对当前项目设计、施工、安全、质量或成果承担前置责任，也属于履约治理；附带经济损失承担不取消它。合同签订后或履约期间，采购人书面提出标准、范围或条件变更且供应商必须配合、执行、调整或补充的，是直接 change-control duty；同一不可分 block 中价款、费用或补偿另行协商只是附带商务处理，不能把整段删除。否定前件或处罚句式不是删除理由：若 block 在救济之前声明独立保证、禁止、质量/结果基线，或以具体的供应商可控制失败作为处罚前件，剥离后果后对该前件做极性归一；若归一后仍是及时维护、正确稳定版本、不侵权、避免返工或其他具体可执行/可验收义务，则保留。只有泛称违约、违规、与合同不符、损失或质量问题且没有动作、阈值、交付结果或纠正责任时，才是纯救济触发器。Candidate 已选中处罚/扣款/救济 cluster 时，再做一次 `consequence_cluster_attack`：保留全部存活 duty 岛，但不能让它们保护同簇内可分离的泛化违约触发、处罚依据指针、只服务处罚的事件定义、确认/扣除/付款执行，或不新增动作/阈值/结果/纠正责任的重复遵守 wrapper。Candidate IN 的纯后果 atom 是 false protection；Candidate OUT 不构成变化。载体外若只说明规范/附件/成果成为合同组成部分、具有同等法律效力或以合同为准，却不新增技术标准、动作、结果或纠正责任，按合同效力 wrapper 删除；只说未尽事宜双方协商/另行解决且没有具体任务、流程、输出或时限，按合同空缺/争议 fallback 删除。质量差错、违规或虚假成果若只作为扣款、赔偿、取消资格、解除、递补或依法追责的触发条件，不产生独立质量 requirement；剥离救济后没有独立供应商责任、成果责任、质量阈值、复核验收、纠正或工作动作时仍删除。保密文字若控制当前项目数据/资料的存储、处理、传递、复制、披露、留存、返还或销毁，就是数据控制履约义务；按平台执行的命令不会因末尾附带解除合同后果而消失。中标后的提交、审核、批准、备案和记录管理属于履约流程。成交前未提出异议/偏离即视为完全响应、同意、接受或无偏离，或要求在响应文件中提出异议/偏离的规则，是响应解释/证明 atom，不是中标后工作义务；即使位于四类载体之外也进入 outside-carrier exclusion。成交前证明 atom 从实际填写/附上/提交证明的 operative block 开始；相邻中性标题、序号、空标签或履约 block 不因地址连续自动继承该 Owner，除非 source 证明它们共同建立资格/响应载体。
上一步“成交前证明 atom 从 operative block 开始”只适用于 source 已证明主要属于成交后履约配置、证明要求只是可分离注释的 subsection。若整个有 root/peer-exit 的人员 subsection 共同建立成交前资格/响应 Owner，则先按 subsection 整体继承，不能用局部起算规则挖洞。

完成上述载体门与 `pre_award_stage_gate` 后，还必须对混合交接 block 执行 `performance_transition_attack`：成交后协调、盘点、与实际转移相连的验收、接收、接管、迁移、移交或返还资产、设备、材料、数据、账户、场地或在制工作，是实施启动/连续性 duty。剥离估值、折旧、价款、补偿、结算、承诺/证明和救济后，只要实际交接动作仍存在，整个不可分 block 就保留；只有剩余内容纯粹分配金额、估值、所有权或付款且没有实际交接动作时才删除。可分离标题仍按标题独立性规则处理。

5. **Source fidelity**：同一合格 Owner 内的标题、正文、表格和详细清单闭合到真实 peer exit。交叉引用不转移 Owner；被引用附件、合同、格式或评分内容必须在实际位置独立判断。

顺序不可交换。若第 3 步已建立硬排除 Owner，第 4 步禁止执行；“服务期、地点、质量、验收、技术参数很有用”不是例外。

## 成交前资格/响应 Stage Gate

四类载体门关闭后、载体外原子效力判断前，必须执行 `pre_award_stage_gate`。若一个有明确 root 与 peer exit 的人员或强制响应 subsection，通过多个子项共同要求证书、社保、资格材料、承诺或其他证明，并以无效响应、不得参与或类似成交前后果定义准入，则整个 subsection 从 root 到 peer exit 继承成交前资格/响应 Owner，并整体进入 outside-carrier exclusion；禁止在内部对未来岗位、人数、进场或配置子项执行 `duty_survival_attack`。只有 source 肯定证明 subsection 主要约束成交后实际履约，而证明要求只是可分离注释时，才进入原子门并只排除该局部 proof atom。

## 通用边界

- 对每个无事实 subsection 执行 `non_fact_shell_closure`：若从明确 root 到 peer exit 只有“无”、空白、占位、裸外部指针，或不新增具体任务、流程、输出、时限和结果的泛化遵法/兜底 wrapper，则 root、空正文和 wrapper 整体排除。相邻前一技术表或履约章节不能跨 peer 边界给这个空壳授予 membership。
- 四类载体之外执行标题 membership 独立性：存活 child duty 只保护该 child，不保护可分离的纯价格/付款/结算/扣款/处罚/违约/救济/解除/争议标题。若删除标题后 child 仍可独立理解，标题单独进入 outside-carrier exclusion；合格技术、服务、安全、验收标题或不可替代上下文仍保留。该规则不得从孤立法律词建立合同载体，也不得在四类 root 内挖洞。
- 多载体邀请、谈判、磋商或询价文件不是整体公告。只排除实际通知/程序区域；边界独立的技术需求、规范、图纸、清单和有效技术附件可重开 Owner。
- 局部硬排除载体不要求 Word outline level。编号、加粗、居中、分页或普通文字都可能开始局部载体，但格式本身不是语义结论；必须用 source 文本确认其功能。载体一旦建立，内嵌附件、技术清单和详细子规则继续继承到 peer exit，不能仅凭附件标题或编号重开 Owner。
- `sc=node@parent~exit` 是 Word outline 的机械 scope；`vc=node@parent~exit` 是无 outline 时按字号/显著格式形成的视觉 heading 候选。二者都不标注 Owner。若 source 确认 node 开始某载体，exit 只是待读的结构边界候选；exit 节点若延续同一 Owner，就继续沿其 scope 传递，不能自动重开 membership。若 source 不确认 root，忽略该导航。
- 单一合同从双方关系、连续条款、价款/结算、违约、生效、解除、争议和签章等形成自洽合同 Owner 时，内部技术义务仍排除。局部招标章节若明确承担“未来采购合同主要条款/合同条件”的披露功能，本身也建立 local contract-terms root；它不要求整份 source 是双边合同、存在签章或使用“格式/样稿”字样。只有合同载体真实结束后的独立技术来源可重开。
- 真实公告内部的项目概况和技术摘要仍排除；不得把分散在其他 peer 章节的通知元素拼成覆盖全文的公告 Owner。
- 边界完整的投标/响应强制性要求章节或强制响应表，即使以未来时态列出岗位、人数和进场时间，也仍是成交前响应 Owner。人员类 Stage Owner 必须先在 subsection 层级闭合：若一个有明确 root 与 peer exit 的人员 subsection 由多项证书、社保、资格承诺、无在建承诺或无效响应后果共同定义成交前准入/响应证明，则 root 标题及全部子项直到 peer exit 整体继承该 Owner；不得因一个子项描述未来履约配置而在其中挖洞。只有 source 证明 subsection 主要是成交后实际履约配置时，紧邻其中、主要要求响应文件填写、附上或提交姓名、证书、截图、社保证明或承诺的可分离注释才作为局部 proof atom 单独排除；载体外直接约束中标后实际投入的岗位和资源属于履约事实。履约期的独立性、职业纪律、利益冲突申报和回避义务直接治理成交供应商及其人员如何执行项目，不是成交前资格证明。
- 合同 Owner 不能由局部“合同、违约、保密、知识产权、审批、责任、扣款”等词语或后续章节反向推断。边界独立技术要求中的成果/源码交付、保密与数据处理、网络安全、持续维护、报审和替换义务仍按直接工作效力判断，直到明确合同格式 peer 根。
- 评分主 Owner、资格证明 Owner、响应填写模板和空白承诺格式不因对写作有用而进入 requirement。

## Candidate 与结构字段

Candidate、`IN/OUT`、`REMOVE_REVIEW`、`ADD_REVIEW`、`BASE_KEEP` 只表示已有选择与本次机械权限，不是真值或投票。`REMOVE_REVIEW` 是唯一可省略的 Candidate 子集，`ADD_REVIEW` 是唯一可新增的 OUT 子集，其余 Candidate 全部是强制 `BASE_KEEP`。结构图只提供同源 body 顺序、样式、outline、编号、字号、粗体、对齐、分页、表格规模和 bounded source prefix；缺失节点不是负面证据。Harness 只把与 `REMOVE_REVIEW ∪ ADD_REVIEW` 相交的现有结构行在固定预算内按地址重列为 challenged-side focus；该 focus 不读取标题含义、不产生新证据或 Owner 标签。

所有语义判断由模型完成。Harness 只验证 schema、地址、授权 envelope、集合一致性、预算与 trace；不得根据关键词或 known answer 决定 Owner、keep 或 remove。Reviewer 在语义 final 收敛后选择地址更短的互斥删除表达：删除岛不多于保留岛时使用只有 `remove_ranges` 的 `exact`，保留岛更少时使用只有 `preserve_ranges` 的 `candidate_complement`，平局 exact；非法双向表达必须 contract-fail 并保留 Candidate。`source_role=non_procurement` 或 `instantiation=absent` 是模型结论，Harness 只机械校验它不能与非空 final/add 同时成立。`exact` 中被 reason 保留的 block 必须通过拆分而留在删除 envelope 外；`candidate_complement` 中则由 `preserve_ranges` 完整表达。Release 独立恢复 envelope 内的过删，Harness 不解释 reason 或补写语义。

## 终态

Release 阅读完整 source，但只对 `REMOVE_REVIEW ∪ ADD_REVIEW` 完成 Owner 判断、`whole_container_disconfirmation` 和必要的 `carrier_root_exit_attack`。`hard_excluded_ranges` 只投影授权 envelope 内已证明属于四类硬排除载体的 challenged blocks；完整 root→semantic-exit 用于判断，不会扩大删除权限。随后仅对授权 envelope 内、这些载体之外的 challenged blocks 生成 `outside_carrier_excluded_ranges`，投影经过 `duty_survival_attack` 后可安全分离的非 requirement atoms。两个字段都是粗粒度范围，不是 ledger，并被 Harness 机械裁剪到授权 envelope。`final_ranges` 是唯一权威完整集合：全部 `BASE_KEEP` 强制恢复，`REMOVE_REVIEW` 可恢复或省略，`ADD_REVIEW` 可接受或拒绝；不得新增其他 OUT，也不得用 reason 修补结构字段。
