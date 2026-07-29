# Word 采购需求 Reviewer Runtime Contract

本文件是 `semantic-contract.md` 的可执行切片，不创造新语义。完整 product principles 与 semantic contract 仍是治理真源；运行时只保留会改变终态的优先级，避免低优先级局部规则覆盖高优先级载体边界。

## 目标

输入是完整不可变 source、成熟 single-prompt Candidate 和 answer-free 结构证据。只修复 Candidate 的材料性残余错误；正确 Candidate 应保持正确。不得读取 expected、历史答案、case 身份或 evaluator。

## 严格判断顺序

1. **整文关系与实例化**：先用开头、中部和结尾检验 source 是采购人侧需求事实源、多载体采购文件、单一公告/询价/报价邀请沟通载体、单一合同、供应商已完成响应或非采购文档。单一沟通假设必须由实际公告/通知 root 开始、连续功能同质并统辖到真实结尾；若存在平级资格、评审、合同、响应格式、采购需求、技术规范、图纸、清单或有效技术附件 root，必须判为多载体容器。物理采购文件或邀请容器不是第五类硬排除 Owner。`instantiation=present` 只证明项目真实，不授予任何 block membership。
2. **Owner 分区与双向 root/exit 攻击**：按 source 的真实章节、局部标题、附件和表格划分载体。一次紧凑 `carrier_root_exit_attack` 必须同时攻击两侧：对每个有争议的宽硬排除，向前确认实际四类载体 root、向后确认首个不同 Owner 的 peer root 或 EOF；对每个拟保留岛，逐内部子标题检查是否新开始公告/通知、须知、响应/报价格式或合同条款载体。没有 root 就不能建立载体；只有不同 Owner 的 peer root 才结束载体；保留岛内部出现局部 root 时必须从该 root 切开到其语义 exit。`sc/vc` exit 只结束一个物理 scope：若 source 功能仍属同一 Owner，必须沿下一 peer scope 继续传递。更深层附件、技术标题和表格仍是子节点。物理 Word、封面名称、Candidate 连续区间、后续合同章节或相邻另一类排除载体都不能替代 root/exit 证明。
3. **四类硬排除门**：公告/通知摘要、投标人或供应商须知及程序、投标/响应/报价文件格式、合同条款及格式全部不属于 requirement。载体一旦由 source 建立，采用 root-closed exclusion：root 自身、内部标题、条款、表格、参数、内嵌附件和连续同 Owner peer 都继承该 Owner，直到首个不同 Owner 的 peer root 或 EOF；不得用局部履约价值、唯一性、技术密度、主要直接效力或义务存活反事实重新打开，也不得把相邻不同 Owner 拼成一个外层载体或让后续载体反向吸收此前技术章节。父章若聚合技术、服务、合同、商务等内容，只是 mixed container；进入 atom gate 前必须做一次 `mixed_container_root_sweep`，关闭其中每个 source-proven 局部四类 root。若同一 root 下删除商务/法律子项却保留后续有用子项，必须否定该 root 或排除完整 root→semantic-exit 区间。
4. **载体之外才做原子效力判断**：仅对已肯定证明位于四类载体之外的混合章节，逐可寻址 block 判断主要直接效力。保留直接规定采购对象、范围、实施、资源、工期、地点、质量、安全、交付、验收、培训、运维、质保、售后的事实；删除可安全分离的资格/评分、采购程序、报价价格、付款结算、保证金、投标有效期、纯违约救济、解除、争议、合同成立、生效、适用法律、一般风险分配和裸外部指针。每个拟删除 block 必须先做义务存活反事实：剥离审批、报审、备案、费用、扣款、违约、解除和赔偿等附带后果后，若仍直接要求实施、资源、计划/方案/报告、记录、交付、限时替换/补齐、响应、平台执行或结果，则保留。成果准确性/完整性/误差/质量责任、与成果质量直接相连的检查复核验收及纠正机制、适用技术标准的现行版本/替代/优先规则都属于直接工作或履约基线，不要求句法上出现供应商祈使句。明确要求中标/成交供应商对当前项目设计、施工、安全、质量或成果承担前置责任，也属于履约治理；附带经济损失承担不取消它。否定前件或处罚句式不是删除理由：若 block 在救济之前声明独立保证、禁止、质量/结果基线，或以具体的供应商可控制失败作为处罚前件，剥离后果后对该前件做极性归一；若归一后仍是及时维护、正确稳定版本、不侵权、避免返工或其他具体可执行/可验收义务，则保留。只有泛称违约、违规、与合同不符、损失或质量问题且没有动作、阈值、交付结果或纠正责任时，才是纯救济触发器。Candidate 已选中处罚/扣款/救济 cluster 时，再做一次 `consequence_cluster_attack`：保留全部存活 duty 岛，但不能让它们保护同簇内可分离的泛化违约触发、处罚依据指针、只服务处罚的事件定义、确认/扣除/付款执行，或不新增动作/阈值/结果/纠正责任的重复遵守 wrapper。Candidate IN 的纯后果 atom 是 false protection；Candidate OUT 不构成变化。载体外若只说明规范/附件/成果成为合同组成部分、具有同等法律效力或以合同为准，却不新增技术标准、动作、结果或纠正责任，按合同效力 wrapper 删除；只说未尽事宜双方协商/另行解决且没有具体任务、流程、输出或时限，按合同空缺/争议 fallback 删除。质量差错、违规或虚假成果若只作为扣款、赔偿、取消资格、解除、递补或依法追责的触发条件，不产生独立质量 requirement；剥离救济后没有独立供应商责任、成果责任、质量阈值、复核验收、纠正或工作动作时仍删除。保密文字若控制当前项目数据/资料的存储、处理、传递、复制、披露、留存、返还或销毁，就是数据控制履约义务；按平台执行的命令不会因末尾附带解除合同后果而消失。中标后的提交、审核、批准、备案和记录管理属于履约流程。成交前证明 atom 从实际填写/附上/提交证明的 operative block 开始；相邻中性标题、序号、空标签或履约 block 不因地址连续自动继承该 Owner，除非 source 证明它们共同建立资格/响应载体。
5. **Source fidelity**：同一合格 Owner 内的标题、正文、表格和详细清单闭合到真实 peer exit。交叉引用不转移 Owner；被引用附件、合同、格式或评分内容必须在实际位置独立判断。

顺序不可交换。若第 3 步已建立硬排除 Owner，第 4 步禁止执行；“服务期、地点、质量、验收、技术参数很有用”不是例外。

## 通用边界

- 多载体邀请、谈判、磋商或询价文件不是整体公告。只排除实际通知/程序区域；边界独立的技术需求、规范、图纸、清单和有效技术附件可重开 Owner。
- 局部硬排除载体不要求 Word outline level。编号、加粗、居中、分页或普通文字都可能开始局部载体，但格式本身不是语义结论；必须用 source 文本确认其功能。载体一旦建立，内嵌附件、技术清单和详细子规则继续继承到 peer exit，不能仅凭附件标题或编号重开 Owner。
- `sc=node@parent~exit` 是 Word outline 的机械 scope；`vc=node@parent~exit` 是无 outline 时按字号/显著格式形成的视觉 heading 候选。二者都不标注 Owner。若 source 确认 node 开始某载体，exit 只是待读的结构边界候选；exit 节点若延续同一 Owner，就继续沿其 scope 传递，不能自动重开 membership。若 source 不确认 root，忽略该导航。
- 单一合同从双方关系、连续条款、价款/结算、违约、生效、解除、争议和签章等形成自洽合同 Owner 时，内部技术义务仍排除。局部招标章节若明确承担“未来采购合同主要条款/合同条件”的披露功能，本身也建立 local contract-terms root；它不要求整份 source 是双边合同、存在签章或使用“格式/样稿”字样。只有合同载体真实结束后的独立技术来源可重开。
- 真实公告内部的项目概况和技术摘要仍排除；不得把分散在其他 peer 章节的通知元素拼成覆盖全文的公告 Owner。
- 边界完整的投标/响应强制性要求章节或强制响应表，即使以未来时态列出岗位、人数和进场时间，也仍是成交前响应 Owner。紧邻履约人员要求的可分离注释若主要要求响应文件填写、附上或提交姓名、证书、截图、社保证明或承诺，同样是成交前证明 atom，应单独排除而不影响周围真实履约配置；载体外直接约束中标后实际投入的岗位和资源才属于履约事实。履约期的独立性、职业纪律、利益冲突申报和回避义务直接治理成交供应商及其人员如何执行项目，不是成交前资格证明。
- 合同 Owner 不能由局部“合同、违约、保密、知识产权、审批、责任、扣款”等词语或后续章节反向推断。边界独立技术要求中的成果/源码交付、保密与数据处理、网络安全、持续维护、报审和替换义务仍按直接工作效力判断，直到明确合同格式 peer 根。
- 评分主 Owner、资格证明 Owner、响应填写模板和空白承诺格式不因对写作有用而进入 requirement。

## Candidate 与结构字段

Candidate、`IN/OUT`、`REMOVE_REVIEW`、`KEEP_RECHECK`、`ADD_REVIEW`、`BASE_KEEP` 只表示已有选择、审查优先级与机械权限，不是真值或投票。结构图只提供同源 body 顺序、样式、outline、编号、字号、粗体、对齐、分页、表格规模和 bounded source prefix；缺失节点不是负面证据。删除 challenge 中，Harness 可把与 Candidate keep side 相交的现有结构行在固定预算内按地址重列一次，帮助 Release 检查内部 root；该 focus 不读取标题含义、不产生新证据或 Owner 标签。

所有语义判断由模型完成。Harness 只验证 schema、地址、授权 envelope、集合一致性、预算与 trace；不得根据关键词或 known answer 决定 Owner、keep 或 remove。Reviewer 删除结构使用互斥对象：`exact` 分支只有 `remove_ranges`，`candidate_complement` 分支只有 `preserve_ranges`；非法双向表达必须 contract-fail 并保留 Candidate，代码不得执行语义冲突消解。

## 终态

先完成一次 Owner 分区、`whole_container_disconfirmation` 和 `carrier_root_exit_attack`，再形成一次终态。`hard_excluded_ranges` 只表达四类硬排除载体的完整 root→semantic-exit 区间：从实际 root 自身开始，包含其技术后代、内嵌附件和连续同 Owner peer，并在首个不同 Owner 的 peer root 前停止；不同 Owner 分开表达。随后仅在这些载体之外生成 `outside_carrier_excluded_ranges`，投影经过 `duty_survival_attack` 后可安全分离的非 requirement atoms，并绕开每个仍存活的直接工作义务。两个字段都是粗粒度范围，不是 ledger。`final_ranges` 是唯一权威完整集合，不得重新纳入任一 exclusion 字段、不得新增未授权 OUT，也不得用 reason 修补结构字段。
