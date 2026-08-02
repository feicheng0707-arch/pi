import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentMessage,
	type AgentTool,
	type AgentToolCall,
	type AgentToolResult,
	runAgentLoop,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type {
	Api,
	AssistantMessage,
	Message,
	Model,
	ProviderEnv,
	ProviderHeaders,
	Usage,
} from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/compat";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import {
	piNativeFinalizerStreamFunction,
	piNativeWitnessStreamFunction,
	runPiNativeRequirementReview,
} from "./pi-native.ts";

const REVIEWER_PROVIDER = "pi-requirement-reviewer-doubao";
const REVIEWER_MODEL_ID = "doubao-seed-2-0-pro-260215";
const RELEASE_PROVIDER = "pi-requirement-release-glm";
const RELEASE_MODEL_ID = "glm-5.2";
const DEFAULT_REVIEWER_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_RELEASE_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const MAX_PACKET_BYTES = 20 * 1024 * 1024;
const REVIEWER_MAX_TOKENS = 4_000;
const RELEASE_MAX_TOKENS = 19_000;
const REVIEWER_THINKING_LEVEL: ThinkingLevel = "medium";
const RELEASE_THINKING_LEVEL: ThinkingLevel = "off";
const REQUEST_TIMEOUT_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 600_000;
const CONTEXT_SAFETY_TOKENS = 8_000;
const MAX_PROVIDER_CALLS = 2;
const MAX_RUN_INPUT_TOKENS = 480_000;
const MAX_RUN_OUTPUT_TOKENS = 24_000;
const MAX_RUN_REASONING_TOKENS = 30_000;
const MIN_OPERATIONAL_PRECISION_CANDIDATE_CHARACTER_RATIO = 0.1;
const MAX_REVIEWER_FOCUS_BLOCKS = 256;
const MAX_REVIEWER_FOCUS_CHARACTERS = 20_000;
const REVIEWER_INTERVAL_EDGE_WINDOW_BLOCKS = 48;
const MAX_REVIEWER_INTERVAL_AUDIT_FOCUS_BLOCKS = 192;
const MAX_REVIEWER_INTERVAL_AUDIT_FOCUS_CHARACTERS = 30_000;
const REVIEWER_BOUNDARY_WINDOW_BLOCKS = 2;
const MAX_REVIEWER_BOUNDARY_FOCUS_BLOCKS = 128;
const MAX_REVIEWER_BOUNDARY_FOCUS_CHARACTERS = 20_000;
const MAX_RELEASE_FOCUS_BLOCKS = 128;
const MAX_RELEASE_FOCUS_CHARACTERS = 20_000;
const FOCUS_BOUNDARY_WINDOW_BLOCKS = 16;
const MAX_STRUCTURE_MAP_NODES = 384;
const MAX_STRUCTURE_MAP_CHARACTERS = 36_000;
const MAX_STRUCTURE_TEXT_PREVIEW_CHARACTERS = 64;
const MAX_RELEASE_STRUCTURE_FOCUS_NODES = 64;
const MAX_RELEASE_STRUCTURE_FOCUS_CHARACTERS = 8_000;
const MAX_RELEASE_PERMISSION_TRANSITIONS = 32;
const RUNTIME_CONTRACT_VERSION =
	"candidate-protected-hybrid-v168-derived-hard-projections";
const FULL_REMOVAL_SAFETY_CONTRACT =
	"fullRemovalSafetyContract=When Reviewer classifies the complete source as buyer_issued with instantiation=present but proposes ordinary removal of every Candidate block, the Harness withdraws that ordinary removal envelope before Release. Every Candidate block becomes protected BASE_KEEP, challengeRemoveRanges and releaseRemoveEnvelopeRanges become empty, and releaseAuditMode becomes hard_carrier_boundary_residual. Release first performs the unchanged candidate-wide four-carrier sweep by submitting hard_root_claims only. After the Harness derives the hard projection union, outside_carrier_excluded_ranges may subtract Candidate only when at least one Candidate block is hard-excluded and every remaining Candidate block forms exactly one non-empty continuous residual island. The island may be left by a hard prefix, hard suffix, dual hard boundaries, or by fully hard-excluding every other Candidate interval; the Harness derives and clips this narrow authority from addresses only. An internal hard island that leaves two sides, multiple residual islands, no Candidate hard exclusion, or a fully hard-excluded Candidate grants no residual authority. ADD_REVIEW remains independently available. This is a patch-shape and topology safety policy only: code does not inspect source meaning or choose keep/remove semantics, and terminal non_procurement, completed-supplier-response, contract, or instantiation=absent decisions keep their original bounded envelope.";
const CONFIRMED_HARD_RESIDUAL_CONTRACT =
	"confirmedHardResidualContract=In a normal bounded patch, hard-boundary residual precision unlocks only when the Harness-derived projection of Release hard_root_claims contains at least one Candidate block from the Reviewer REMOVE_REVIEW envelope. The Harness then computes complete Candidate minus all derived hard exclusions. If and only if the result is exactly one non-empty continuous block-address run, that entire run becomes a bounded outside-carrier review envelope for the same Release call. Release must audit that run after settling the root claims and may put only exact safely separable outside-carrier non-requirement atoms into outside_carrier_excluded_ranges; every omitted block remains selected. A hard finding only in BASE_KEEP, no confirmed REMOVE_REVIEW hard block, two residual runs, no residual, or no Candidate hard exclusion grants no authority. This is content-blind topology and patch-coupling only; code never reads source meaning or chooses a deletion.";
const HARD_CARRIER_VETO_CONTRACT =
	"hardCarrierVetoContract=Release has one candidate-wide safety authority in addition to the bounded Reviewer patch: submit one hard_root_claim for every actual announcement/notice, bidder or supplier instruction, bid/response/quotation format, or contract terms/format root whose span intersects hardRootClaimProjectionUniverseRanges. Candidate need not contain the carrier root title or start block. For every Candidate interval, inspect source ancestors before its first Candidate block; when the actual root begins in OUT and Candidate contains only descendants, submit the OUT root and its semantic exit. 'The root is not independently present inside Candidate' is never a keep reason. Once the corrected two-reason plan affirms an actual root through its semantic exit, the Harness mechanically projects every authorized Candidate, ADD_REVIEW, and BOUNDARY_REVIEW address in that span into the derived hard exclusion union. There is no technical-duty, usefulness, primary-effect, or duty-survival keep option inside the affirmed root. To retain any descendant, residual_reason must first retract the claim, narrow its exit, or establish an earlier different-Owner peer exit. A REMOVE_REVIEW-to-BASE_KEEP or BASE_KEEP-to-REMOVE_REVIEW marker transition is only a permission boundary and can never prove a semantic Owner exit; follow the actual source root across the transition and through any later OUT or marker change until the first different-Owner peer root or EOF. outside_carrier_excluded_ranges is never an alternative encoding for a hard carrier. Outside-carrier atom deletion is ordinarily limited to REMOVE_REVIEW. The only BASE_KEEP exception is the runtime-declared full-removal safety mode, where the Harness derives the one non-empty continuous residual island left across Candidate after at least one hard exclusion; every other Candidate block must already be hard-excluded. The Harness derives every hard projection and the final set mechanically; code never chooses carrier semantics.";
const WHOLE_SOURCE_IDENTITY_VETO_CONTRACT =
	"wholeSourceIdentityVetoContract=Before carrier or atom gates, independently inspect the beginning, middle, and end to decide whole-source authorship and use. If affirmative source evidence establishes one completed supplier-authored bid, response, technical proposal, implementation plan, or deliverable; one non-procurement document; one contract-only document; or one uninstantiated template or form through its true end, and whole_container_disconfirmation finds no boundary-independent buyer-issued requirement region, that identity is terminal for every runtime-authorized Candidate block. Copied tender clauses, technical detail, future duties, response tables, or commitments cannot reopen membership, and duty_survival_attack is forbidden. When the runtime grants a complete-Candidate terminal veto, put exactly the complete Candidate in outside_carrier_excluded_ranges and leave hard_root_claims and accepted_add_ranges empty so the mechanically derived final is null. Do not infer this veto from a title, completed tone, or one supplier phrase; mixed-author handoffs and buyer-provided technical reports require block-level Owner judgment.";
const UNINSTANTIATED_TEMPLATE_TERMINAL_CONTRACT =
	"uninstantiatedTemplateTerminalContract=Instantiation requires at least one already-filled fact that distinguishes the current procurement object, scope, work package, quantity, site, or commissioned relationship. A template or model identifier, generic supply or quotation rule, drafting instruction, default obligation, blank schedule or table, and a pointer to an absent notice, list, or specification cannot establish it. When the complete source remains an uninstantiated template, that whole-source identity is terminal: do not reopen local generic supply, pricing, quality, compliance, or future-work clauses through primary-effect, normative-incorporation, or duty_survival_attack. Submit the complete authorized omission and accept no additions.";
const PERFORMANCE_TRANSITION_ATTACK_CONTRACT =
	"performanceTransitionAttackContract=After the carrier and pre-award stage gates, run performance_transition_attack before deleting any indivisible block that combines commercial or proof language with a post-award transition. Actual coordination, inventory, transfer-linked acceptance, receipt, takeover, migration, handover, or return of assets, equipment, materials, data, accounts, sites, or work in progress is an implementation-start or continuity duty. Strip valuation, depreciation, price, compensation, settlement, commitment, proof, and remedy language; if an actual transition action remains, preserve the indivisible block. Delete only when the remainder solely allocates money, valuation, title, or payment and imposes no actual transition action. Heading membership remains governed by the existing independent-heading rule.";
const PEER_ROOT_FRACTURE_CONTRACT =
	"peerRootFractureContract=Address continuity never carries Owner across a source-proven peer root. Inside every continuous Candidate, IN, or REMOVE_REVIEW interval, reopen Owner at each peer chapter, subsection, appendix, table root, or equivalent functional boundary. When a qualified requirement region is followed by a new announcement/notice, bidder or supplier instruction, bid/response/quotation-format, or contract-terms root, end the qualified island immediately before that root and carry the new Owner to its semantic exit. A later qualified peer root may likewise reopen membership after a hard carrier. A contract root ends before a later peer technical, specification, material, brand, drawing, list, or equivalent requirement chapter unless the source itself identifies that peer as a contract attachment or continuation; adjacency, chapter order, an earlier cross-reference, or placement between contract and response-format chapters is insufficient. Only source-proven peer function can trigger the reset; block number, keywords, formatting, Candidate width, and permission markers cannot.";
const HARD_CARRIER_FUNCTION_CONTRACT =
	"hardCarrierFunctionContract=Four-class roots are defined by communicative function, never by isolated addressee or price words. Announcement/notice requires one uninterrupted outward-notification sequence, not an invitation sentence plus later peer requirements outside any source-proven notice root. Once source establishes an actual announcement/notice chapter or boundary-complete notification root, its numbered project synopsis, procurement scope, period, location, standard, and technical-summary children remain descendants until a same-or-higher different-Owner peer exits that root. Bidder/supplier instruction requires a rooted participation, acquisition, submission, evaluation, or response-procedure region, not any sentence addressed to a bidder. Bid/response/quotation format requires a response-artifact schema that prescribes submitted documents, fields, tables, declarations, signatures, or layout; ordinary price calculation, quotation construction, cost inclusion, payment, or commercial rules outside such a schema are outside-carrier atoms and can never become hard_root_claims. A local commitment sentence is not a format root without a boundary-complete declaration/commitment section. Contract terms still require an actual agreement, terms, format, or contract-appendix root. Mixed or multi-carrier is only a whole-source diagnosis: it rejects one whole-file carrier identity but never cancels a proven local four-class root. Every local root still owns its descendants through the peer exit; never use mixed or multi-carrier to produce hard_hypothesis=none or retain a descendant. When these functional roots are absent, submit no hard_root_claim for that block and adjudicate any authorized price, procedure, proof, or legal atom only in Phase 2.";
const ANNOUNCEMENT_PREAMBLE_BOUNDARY_CONTRACT =
	"announcementPreambleBoundaryContract=This reset applies only when no source-proven announcement/notice chapter or boundary-complete notification root encloses both the preamble and the later content. An isolated buyer or agent sentence announcing an open invitation, commission, or welcome to participate does not convert its enclosing tender-book, requirement, specification, or technical chapter into an announcement carrier. Without a boundary-complete outward-notification sequence, treat that sentence as at most a local preamble and reopen Owner at the next source-proven numbered peer root. A peer procurement-content, object, scope, site, schedule, quality, specification, drawing, list, or technical-requirement root is then a semantic exit even without an explicit end-of-notice phrase. Once an actual announcement/notice root is proven, disable this reset inside that root: its numbered project synopsis, procurement scope, period, location, standard, and technical-summary children cannot be their own exits; only a same-or-higher different-Owner peer outside the real notice root can reopen Owner. Repetition of the same project facts in an earlier separate notice cannot transfer announcement Owner to a later peer root outside that notice; decide the later root's local communicative function independently. Agent, commission, public-tender, or welcome language alone is insufficient to create or extend a notice root.";
const EXPLICIT_CHAPTER_HIERARCHY_CONTRACT =
	"explicitChapterHierarchyContract=Run this gate before announcementPreambleBoundaryContract, mixed-container reasoning, multi-carrier reasoning, or block-level usefulness. When source establishes an explicit chapter-level or equivalent top-level hard-carrier root, every lower-rank numbered subsection, paragraph, table, list, attachment, project synopsis, procurement scope, schedule, location, standard, or technical summary before the next source-proven same-or-higher-rank peer remains its descendant. A simple 1., 2., 3., decimal, item, or table heading inside a named Chapter cannot be treated as a peer to that Chapter merely because its content looks like requirements. Multi-carrier describes the complete file and never cancels a proven local named carrier chapter. The preamble reset is unavailable inside that chapter. Only a source-proven peer matching or exceeding the carrier root's structural rank and changing Owner can end it. If answer-free structure evidence is unavailable, use the source's explicit chapter markers and sequence; absence of a structure map never authorizes inventing a peer exit. If a reason names a Candidate block as a descendant of such a root but proposes keeping it for project facts, technical value, scope, period, location, standard, or direct duty, the reason is internally inconsistent and must be corrected to root-closed exclusion before submission.";
const SUBSTANTIVE_RESPONSE_WRAPPER_CONTRACT =
	"substantiveResponseWrapperContract=Outside an actual bid/response-format root and outside a rooted pre-award proof subsection, a buyer-issued sentence does not become format or procedure merely because it addresses a bidder or says respond, state, confirm, guarantee, or commit. Strip only the performative wrapper and addressee, then run subject_predicate_remainder_test. If the actual offered service, work, product, quality, safety, acceptance, warranty, or result remains the grammatical subject of a requirement to meet, satisfy, or at least reach a substantive technical baseline, preserve the indivisible block; no separate implementation verb or project parameter is required, and neighboring payment, price, quotation, or proof blocks cannot transfer Owner across it. If stripping instead leaves only an orphaned general-compliance, response, no-deviation, or acceptance phrase that is merely the object of a bidder declaration or commitment, with no independent predicate about the actual offered work, it is a separable pre-award proof atom. Only a boundary-complete response artifact or such a safely separable proof/declaration atom may be excluded.";
const OUTSIDE_CARRIER_PRECISION_CLOSURE_CONTRACT =
	"outsideCarrierPrecisionClosureContract=Hard-carrier findings are range-local and never finish the case. First imagine Candidate minus every affirmed hard root-to-semantic-exit range, then close every surviving Candidate residual island after the four-carrier gate and pre_award_stage_gate. A parent chapter label, including a procurement, requirement, technical, service, or business chapter label, is only navigation and never grants membership to all descendants. Partition each residual at every source-proven peer heading, numbered subsection, table segment, or equivalent functional boundary, and inspect it once for separable outside-carrier non-requirement atoms. A peer-rooted price or quotation-construction, payment, settlement, guarantee, pre-award proof, empty shell, bare pointer, or pure legal-effect/remedy subsection forms its own removable island through the next peer boundary; a qualified parent or neighboring duty cannot protect it. Reopen a keep island when a later peer subsection or indivisible child has an actual implementation, resource, schedule, quality, safety, acceptance, delivery, service, or result duty. Remove only exact addressable atoms after duty_survival_attack, response_wrapper_survival_attack, and source-fidelity checks; preserve every indivisible block with a surviving direct work duty. A submission that treats an unsplit residual as qualified solely because of its ancestor chapter is unfinished. This is one bounded island closure, not a keyword scan, block ledger, or extra call.";
const OUTSIDE_CARRIER_COUNTEREXAMPLE_CONTRACT =
	"outsideCarrierCounterexampleContract=Before compressing any multi-block outside_carrier_excluded range, run counterexample_first_duty_attack on that exact interval. Treat every canonical paragraph or table block as independently addressable even when all blocks sit below one price, payment, settlement, guarantee, or legal heading. Search first for the strongest single block whose operative remainder still imposes post-award implementation, resource, plan or report, record, delivery, transition, response, platform execution, staffing, quality, safety, acceptance, warranty, service, or result after stripping price, payment, settlement, audit, proof, and remedy language. If one survives, restore its complete heading-body-table/list source-fidelity island, split the proposed deletion around that island, and repeat the counterexample search only on the remaining subranges until none survives. Never submit representative sample addresses. Technical nouns used only as pricing inputs still fail pricing_basis_role_attack. State only compact surviving address islands or none; do not output a per-block ledger.";
const PROJECT_FACT_ATTACK_CLOSURE_CONTRACT =
	"projectFactAttackClosureContract=Whenever an authorized residual contains a project overview, project facts, or an equivalent current-project summary, execute the system-defined project_fact_membership_attack before treating that region as qualified. Identify the exact local summary scope through the next source-proven peer, excluding its outer chapter and the next peer; every address in that scope must appear once in remove or survive. residual_reason must include exactly one compact project_fact_membership_attack=scope:<ranges>;remove:<ranges or none>;survive:<ranges or none> clause. A blanket project-facts or parent-heading keep verdict, or a clause that skips a drafting/filling instruction before the first filled fact, is unfinished. This is one terminal island closure, not a per-block ledger; the Harness does not infer or validate the semantic addresses.";
const PRICING_BASIS_ROLE_CONTRACT =
	"pricingBasisRoleContract=Run pricing_basis_role_attack whenever standards, drawings, quantities, plans, site facts, work names, resources, risks, or technical terms appear inside a price or quotation subsection. Read the operative relationship, not the nouns: material used only to calculate, compile, fill, compare, validate, include, or allocate a bid price remains price formation and has no direct work duty. A fixed-price or unit-price clause does not become requirement merely because its generic cost composition names labor, materials, machinery, transport, protection, fencing, measures, taxes, or construction risks. Never inherit that price decision across every child of a broad quotation heading: reopen primary effect at each direct child numbered subsection and each addressable list item. For a later cost-inclusion list, strip the heading's price wrapper and each item's fee/included-cost wording; a concrete current-project work action, work-scope item, resource provision, restoration, safety/environmental measure, delivery, acceptance, or responsible-party command survives even when written as a noun phrase without an imperative. Generic cost categories, price risks, rates, taxes, profit, or price-adjustment rules with no such surviving work fact remain price formation. Normative incorporation exists only when the source independently binds actual work, material, deliverable, or result to the cited material.";
const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const promptDirectory = resolve(
	extensionDirectory,
	"../../skills/word-requirement-extraction-reviewer/references",
);
const RangeSchema = Type.String({ pattern: "^段落\\d+(?:-段落\\d+)?$" });
type HardCarrierType =
	| "announcement"
	| "bidder_instruction"
	| "response_format"
	| "contract_terms";
const HardRootClaimSchema = Type.Object(
	{
		carrier_type: Type.Union(
			[
				Type.Literal("announcement"),
				Type.Literal("bidder_instruction"),
				Type.Literal("response_format"),
				Type.Literal("contract_terms"),
			],
			{
				description:
					"Exact enum for the source-proven hard carrier root. The Harness treats this as a typed model claim and never infers carrier semantics from source text.",
			},
		),
		root_block_id: Type.Integer({
			minimum: 0,
			description:
				"Inclusive source block ID where the claimed hard-carrier root begins. It may be OUT but must exist in the immutable source.",
		}),
		exit_block_id_exclusive: Type.Union(
			[
				Type.Integer({ minimum: 1 }),
				Type.Null(),
			],
			{
				description:
					"Exclusive source block boundary where the claimed hard-carrier Owner ends, or null when the root continues through EOF.",
			},
		),
	},
	{ additionalProperties: false },
);
const ReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Settle role_evidence and instantiation_evidence first, then audit Candidate intervals in the address-only candidateHardCarrierAuditOrder before narrating smaller ranges. A hard-carrier hit clears only its own root-to-exit range: explicitly form the surviving Candidate residual and split it at every peer heading, subsection, table segment, or equivalent functional boundary. Never use an ancestor chapter label as a keep verdict for all residual descendants. Use compact root->semantic-exit decisions and complete outside_carrier_precision_closure on every surviving residual island. Instantiation requires at least one already-filled fact that distinguishes the current procurement object, scope, work package, quantity, site, or commissioned relationship; a template/version number, procuring organization, generic batch label, platform operation, bid timetable, default clause, blank table, or external pointer cannot establish it alone. Test rather than assume a whole-document communicative role: one notice Owner may govern the source only when an actual notice root begins one uninterrupted, functionally homogeneous outward act through its true end and no peer qualification, evaluation, contract, response-format, requirement, specification, drawing, list, or technical-appendix root disproves it. A physical procurement file or invitation container is never itself a hard-excluded carrier root. Carrier Owner is decided before block-level primary effect: never apply the primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier. For every disputed broad exclusion, include one compact bidirectional carrier_root_exit_attack naming the source-proven carrier root and the first later peer root whose source function changes Owner, or EOF. A structural sc/vc exit closes one physical scope only: if the peer remains the same Owner, chain through that scope and continue searching. Attack both directions: truncate an exclusion that crosses an earlier different-Owner exit, and split a proposed keep when any internal subsection starts a new four-class carrier. No actual root means no carrier. Once a hard-excluded root is established, exclusion is root-closed: the root itself, every child clause and embedded attachment, and every consecutive same-Owner peer continuation remain excluded until the semantic Owner exit; primary-effect and duty-survival tests cannot reopen them. An explicit chapter-level announcement or notice root remains active through every numbered child subsection until the next source-proven peer chapter; a child project-overview, scope, period, location, quality, or technical table can never be its exit. A hard-excluded local carrier can begin at a numbered, bold, centered, or plain-text subsection even when nested inside a chapter mixing technical, service, business, contract, or other requirements. Treat such an aggregate parent as a mixed container, not as one Owner grant: before any block-level effect test, run one mixed_container_root_sweep over its child heading candidates and classify every source-proven local four-class root. If a tentative final drops payment, guarantee, or legal children but keeps service period, location, quality, acceptance, personnel, or technical children after the same local root, that holey selection proves the atom gate ran too early; either disprove the root from source or exclude the complete root-closed interval. If the complete source is one hard-excluded carrier with no source-proven different-Owner exit, that is a terminal null decision; do not reopen internal blocks by technical usefulness. When structure navigation is provided, reconcile every disputed root/exit with sc/path: a deeper attachment, technical title, or table is a child and cannot be an exit; the first same-or-shallower candidate must be read and semantically classified before reopening. A qualified cross-reference never transfers membership to a referenced excluded appendix, and a direct must-comply duty in an independent technical chapter is not a bare pointer merely because it is short or general. For every mixed source-proven non-excluded chapter touched by the final patch, include one compact mixed_chapter_audit with literal keep/remove address islands. Before deleting any outside-carrier block, run duty_survival_attack: strip approval, filing, cost, deduction, breach, termination, damages, or other incidental consequences and preserve the indivisible block if the remaining clause still directly requires implementation, resources, plans/reports, records, delivery, timed replacement or replenishment, response, platform execution, or a result. Direct work effect does not require a supplier imperative: deliverable accuracy, completeness, error or quality accountability; inspection, review or acceptance tied to deliverable quality or correction; and current-version, replacement or precedence rules for applicable technical standards all survive. Grammar is not the gate: when an indivisible block states a direct guarantee, prohibition, quality/result baseline, or a specifically negated supplier-controlled failure before its remedy, strip the remedy and polarity-normalize that antecedent. Preserve the block when the normalized remainder is a concrete executable or verifiable duty such as timely maintenance, a correct stable version, non-infringement, or avoiding rework. Generic breach, noncompliance, misconduct, loss, or quality-problem labels without an action, threshold, deliverable result, or correction duty remain pure remedy triggers. Confidentiality duties that directly control storage, processing, transmission, copying, disclosure, retention, return, or destruction of project data are surviving data-control work duties outside a true contract carrier. A platform-execution command remains a direct duty when termination is only its consequence. Post-award submission, review, approval, filing, and record management are performance workflow, not procurement procedure. A complete bid/response mandatory-requirements section or table remains pre-award response Owner even when it describes future staff. Close personnel Stage Owner at subsection level first: when a rooted subsection with a peer exit jointly uses multiple credentials, social-insurance proofs, commitments, or invalid-response consequences to define pre-award admissibility, its root and all children inherit that Owner through the exit; one future-staffing child cannot carve out a keep island. Only when source proves the subsection is primarily post-award staffing may a separable proof note begin at its operative fill, attach, or submit-proof block; adjacency alone never expands that local atom backward. Pure contract formation, breach remedy, termination, dispute, governing-law, or general legal-risk blocks with no surviving direct work duty belong on the remove side. Then state the case-level impact. Compute the settled Candidate keep islands and remove islands once, choose the valid removal branch with fewer disjoint ranges, and use exact on a tie. Every exact remove range must contain only blocks already judged safe to delete; every complement preserve range must be a block already judged necessary. source_role=non_procurement or instantiation=absent is a terminal null claim and must leave no Candidate or add block. Range fields must be an exact projection of this settled reason.",
});
const ReleaseHardCarrierReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Phase 1 only. Begin from the complete Candidate-only IN/OUT source, where Reviewer challenge markers are absent. Audit Candidate intervals in candidateHardCarrierAuditOrder and state only actual announcement/notice, bidder or supplier instruction, bid/response/quotation-format, and contract-terms/format roots with compact root->semantic-exit addresses. Candidate need not contain the root title: inspect source ancestors before each Candidate interval when a root begins in OUT. A chapter-level root can end only at a source-proven same-or-higher-rank peer; lower-rank numbered scope, schedule, standard, table, or technical-summary children remain descendants. Mixed or multi-carrier rejects only a whole-source identity and never cancels a named local root. Do not adjudicate outside-carrier price, payment, legal, proof, or work-duty atoms in this field. Keep the entire field under 900 characters and end with one compact hard_hypothesis=<carrier:root->exit or none> clause. The later hard_root_claims must encode every corrected root; the Harness alone derives projections and their union.",
});
const ReleaseResidualReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Phase 2 only. Adversarially test the Phase 1 hard-carrier hypothesis and correct every overbroad or incomplete root/exit decision. A chapter-level root can end only at a source-proven same-or-higher-rank peer; never promote a lower-rank numbered scope, schedule, standard, table, or technical-summary child into its own exit. Candidate omission of the root title is not a retraction: if source proves an OUT ancestor root, its Candidate descendants remain in the Harness-derived hard projection. Every Phase 1 root must either remain in hard_root_claims or be explicitly retracted or narrowed here with a source-proven peer exit; silent omission is forbidden. In releaseAuditMode=reviewer_no_change_terminal_or_hard_veto, then decide only whether an independently proven whole-source terminal identity authorizes exact complete-Candidate outside-carrier deletion; ordinary atom cleanup, residual precision, additions, and duty_survival_attack are unavailable. In other modes, adjudicate every authorized REMOVE_REVIEW or ADD_REVIEW block outside the corrected hard-carrier plan. A non-empty residual cannot be dismissed as already hard-excluded. Apply compact over-deletion, counterexample-first duty, response-wrapper, source-fidelity, and three remainder tests only where authorized. If an authorized residual contains a project overview or equivalent current-project summary, execute the system-defined project_fact_membership_attack and include project_fact_membership_attack=scope:<ranges>;remove:<ranges or none>;survive:<ranges or none>; scope addresses must be completely partitioned and a skipped drafting/filling instruction is incomplete. preamble_peer_reset_test is disabled for numbered children inside a proven notice root. Keep the entire field under 900 characters and end with exactly one compact final_plan=claims:<carrier:root->exit or none>;outside:<ranges or none>;add:<ranges or none> clause. Then submit hard_root_claims, outside_carrier_excluded_ranges, and accepted_add_ranges; never calculate a hard projection array.",
});
type ReviewerIssueType =
	| "material_omission"
	| "wrong_direction"
	| "false_null"
	| "false_non_null"
	| "source_fidelity"
	| "boundary"
	| "operational_precision"
	| "unspecified";
type ReviewerSourceRole =
	| "buyer_issued"
	| "contract"
	| "completed_supplier_response"
	| "non_procurement";
type ReviewerInstantiation = "present" | "absent";
type ReviewerRemoveMode = "exact" | "candidate_complement";

const reviewerSourceRoles: ReviewerSourceRole[] = [
	"buyer_issued",
	"contract",
	"completed_supplier_response",
	"non_procurement",
];
const reviewerIssueTypes: ReviewerIssueType[] = [
	"material_omission",
	"wrong_direction",
	"false_null",
	"false_non_null",
	"source_fidelity",
	"boundary",
	"operational_precision",
	"unspecified",
];

function createReviewerDecisionSchema() {
	const sourceRoleSchema = Type.Unsafe<ReviewerSourceRole>({
		type: "string",
		enum: reviewerSourceRoles,
		description:
			"Exact enum only; put evidence in reason. This field describes the complete source relationship, not one Candidate interval or local chapter. Use contract only when the complete source is a contract-only document; use buyer_issued for a multi-carrier buyer tender even when it contains contract chapters. Judge each local carrier separately. Current-project facts never turn a contract carrier into requirement content.",
	});
	const instantiationSchema = Type.Unsafe<ReviewerInstantiation>({
		type: "string",
		enum: ["present", "absent"],
		description:
			"Exact enum only; put evidence in reason. present proves a real project only; it never grants requirement membership inside a hard-excluded carrier. absent is a terminal null claim: a non-empty Candidate must be challenged to an empty final with no additions.",
	});
	const removalSchema = Type.Union([
		Type.Object(
			{
				mode: Type.Literal("exact", {
					description:
						"Use after semantics settle when the exact remove list is no longer than the Candidate preserve list. Use exact on a tie. This branch intentionally has no preserve_ranges field.",
				}),
				remove_ranges: Type.Array(RangeSchema, {
					maxItems: 64,
					description:
						"Complete exact Candidate blocks to remove. Split around every block that reason keeps. If reason identifies a Candidate block as a hard-carrier descendant, bare external pointer, non-fact shell, or safely separable outside-carrier deletion, include it here unless the final reason explicitly retracts that diagnosis.",
				}),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				mode: Type.Literal("candidate_complement", {
					description:
						"Use after semantics settle when the complete Candidate preserve list is shorter than the exact remove list, including a terminal null with preserve_ranges=[]. This branch intentionally has no remove_ranges field.",
				}),
				preserve_ranges: Type.Array(RangeSchema, {
					maxItems: 64,
					description:
						"Every qualified Candidate island that must remain; the Harness mechanically removes the Candidate complement. Never preserve a block that the final reason still identifies as a hard-carrier descendant, bare external pointer, non-fact shell, or safely separable outside-carrier deletion.",
				}),
			},
			{ additionalProperties: false },
		),
	]);
	return Type.Object(
		{
			reason: ReasonSchema,
			verdict: Type.Unsafe<"pass" | "challenge">({
				type: "string",
				enum: ["pass", "challenge"],
				description:
					"Terminal decision derived from the settled reason. pass is forbidden when reason identifies any Candidate removal, any qualified OUT addition, or any Candidate block inside an affirmed announcement/notice, bidder or supplier instruction, bid/response/quotation-format, or contract-terms/format root. In those cases submit challenge and exactly actuate the settled change. If and only if the settled reason concludes add=none and remove=none, rewrite the final submission to issue_type=none, add_ranges=[], and removal={mode: exact, remove_ranges: []}; never erase a settled change merely to make pass legal.",
			}),
			source_role: sourceRoleSchema,
			instantiation: instantiationSchema,
			issue_type: Type.Unsafe<"none" | ReviewerIssueType>({
				type: "string",
				enum: ["none", ...reviewerIssueTypes],
				description:
					"Use operational_precision only when Candidate is already materially correct and the sole change is remove-only ordinary noise whose removed text is at least 10% of complete Candidate text. Any material missing OUT body, hard-carrier false positive, wrong source/direction, bare external pointer, or source-fidelity break is a correctness issue such as material_omission, boundary, false_non_null, wrong_direction, or source_fidelity, never operational_precision.",
			}),
			add_ranges: Type.Array(RangeSchema, {
				maxItems: 64,
				description:
					"Only qualified blocks marked OUT. A block already marked IN is never an add. This field must exactly actuate the settled reason: if reason identifies any OUT body, table, list, continuation, or appendix as qualified content that belongs in final, include its complete source-fidelity island here. Empty add_ranges is inconsistent with a reason that positively identifies a material qualified OUT omission.",
			}),
			removal: removalSchema,
		},
		{ additionalProperties: false },
	);
}

const ReleaseDecisionSchema = Type.Object(
	{
		hard_carrier_reason: ReleaseHardCarrierReasonSchema,
		residual_reason: ReleaseResidualReasonSchema,
		hard_root_claims: Type.Array(HardRootClaimSchema, {
			maxItems: 64,
			description:
				"Write one corrected semantic claim for every independently proven hard-carrier root. Each claim contains only carrier type, inclusive root block, and exclusive semantic exit; use null only for EOF. The Harness mechanically intersects every claim span with hardRootClaimProjectionUniverseRanges, rejects empty or overlapping derived projections, and derives the complete hard exclusion union. Do not calculate or submit projected ranges.",
		}),
		outside_carrier_excluded_ranges: Type.Array(RangeSchema, {
			maxItems: 64,
			description:
				"Write this bounded outside-carrier deletion authorization after hard_root_claims. If a whole-source identity veto is independently proven, list the runtime-authorized Candidate blocks here and do not run atom-level duty_survival_attack. Otherwise list only blocks outside every submitted hard-root claim whose own primary direct effect is safely separable non-requirement content; run duty_survival_attack first and split around every surviving direct work duty, short normative obligation, necessary heading, or source-fidelity dependency. Ordinary authority is limited to REMOVE_REVIEW or ADD_REVIEW. In releaseAuditMode=reviewer_no_change_terminal_or_hard_veto, this field has all-or-nothing authority only: submit exactly the complete Candidate when an independently proven whole-source non-procurement, completed-supplier-response, contract-only, or uninstantiated-template veto applies; partial Candidate outside-carrier deletion is unauthorized. In full_removal_safety mode, Candidate BASE_KEEP may be listed only when the Harness derives at least one Candidate hard exclusion and every remaining Candidate block forms exactly one non-empty continuous residual island. In reviewer_confirmed_hard mode, the same topology is available only when a derived Candidate hard exclusion also belongs to REMOVE_REVIEW. The Harness derives and clips both scopes mechanically. Never encode a four-carrier block here or include unchallenged OUT. Use [] when no authorized outside-carrier block is safely excludable.",
		}),
		accepted_add_ranges: Type.Array(RangeSchema, {
			maxItems: 64,
			description:
				"Write this positive delta after both reason fields, hard_root_claims, and outside_carrier_excluded_ranges. List only ADD_REVIEW blocks independently approved as qualified requirement content, or BOUNDARY_REVIEW blocks independently proven to be the complete same-Owner body, table, list, continuation, or appendix needed to close an adjacent Candidate shell. Omit rejected additions and reject any partial body whose required continuation extends into ordinary OUT. Candidate blocks and all other OUT are unauthorized and will be clipped mechanically. Do not repeat Candidate keep ranges; every Candidate block remains selected unless a Harness-derived hard projection or an authorized outside-carrier exclusion subtracts it.",
		}),
	},
	{ additionalProperties: false },
);

type RawReviewerDecision = Static<ReturnType<typeof createReviewerDecisionSchema>>;
type RawReleaseDecision = Static<typeof ReleaseDecisionSchema>;
type Role = "reviewer" | "release";
type SubmissionMode = "tool_call" | "strict_json_text" | "embedded_json_text";
type HardBoundaryResidualPrecisionMode =
	| "disabled"
	| "full_removal_safety"
	| "reviewer_confirmed_hard";

export interface RequirementReviewBlock {
	blockId: number;
	text: string;
}

export interface RequirementReviewStructurePathNode {
	level: number;
	blockId: number;
}

export interface RequirementReviewStructureTable {
	rowCount: number;
	cellCount: number;
	paragraphCount: number;
}

export interface RequirementReviewStructureEntry {
	blockId: number;
	matchConfidence: "exact" | "high";
	bodyIndex: number;
	kind: "paragraph" | "table";
	styleId: string | null;
	styleName: string | null;
	outlineLevel: number | null;
	numberingLevel: number | null;
	pageBreakBefore: boolean;
	keepNext: boolean;
	alignment: string | null;
	boldRatio: number;
	fontSizes: number[];
	outlinePath: RequirementReviewStructurePathNode[];
	table: RequirementReviewStructureTable | null;
}

export interface RequirementReviewStructureEvidence {
	schemaVersion: "xique.word-structure-evidence.v1";
	docxSha256: string;
	sourceSha256: string;
	sourceBlockCount: number;
	matchedBlockCount: number;
	exactMatchCount: number;
	entries: RequirementReviewStructureEntry[];
}

export interface RequirementReviewPacket {
	schemaVersion: "xique.word-requirement-review.packet.v1";
	reviewMode: "candidate_protected_residual";
	version: "docx-paragraphs-v1";
	outputField: "完整采购需求编号范围";
	sourceName: string;
	sourceSha256: string;
	blockCount: number;
	candidateId: string;
	candidatePromptSha256: string;
	initialRanges: string[];
	blocks: RequirementReviewBlock[];
	structureEvidence?: RequirementReviewStructureEvidence;
}

export interface RequirementReviewPrompts {
	productPrinciples: string;
	semanticContract: string;
	runtimeContract: string;
	reviewer: string;
	release: string;
	piNativeSemanticContract: string;
	piNativeRuntimeContract: string;
	witness: string;
	finalizer: string;
	hashes: {
		productPrinciples: string;
		semanticContract: string;
		runtimeContract: string;
		reviewer: string;
		release: string;
		piNativeSemanticContract: string;
		piNativeRuntimeContract: string;
		witness: string;
		finalizer: string;
	};
}

interface ParsedRanges {
	ranges: string[];
	blockIds: number[];
}

interface FocusedDuplicate {
	blockCount: number;
	characterCount: number;
	included: boolean;
	source: string;
}

interface FocusSourceRow {
	blockId: number;
	text: string;
}

type ReleaseOverlayMarker =
	| "ADD_REVIEW"
	| "BOUNDARY_REVIEW"
	| "REMOVE_REVIEW"
	| "BASE_KEEP"
	| "OUT";

interface ReleaseSourceRow extends FocusSourceRow {
	marker: ReleaseOverlayMarker;
}

interface ReleasePermissionTransitions {
	totalCount: number;
	renderedCount: number;
	coverage: "none" | "complete" | "partial";
	source: string;
}

interface FocusedSource {
	targetBlockCount: number;
	targetCharacterCount: number;
	includedTargetBlockCount: number;
	contextBlockCount: number;
	renderedBlockCount: number;
	renderedCharacterCount: number;
	coverage: "complete" | "partial" | "omitted";
	source: string;
}

interface StructureMap {
	provided: boolean;
	entryCount: number;
	exactMatchCount: number;
	renderedNodeCount: number;
	renderedCharacterCount: number;
	coverage: "unavailable" | "complete" | "partial";
	source: string;
	renderedRows: readonly FocusSourceRow[];
}

interface StructureOutlineNavigation {
	parentBlockId: number | null;
	exitBlockId: number | null;
}

interface StructureVisualNavigation {
	parentBlockId: number | null;
	exitBlockId: number | null;
}

interface ReleaseAdversarialNavigation {
	keep: FocusedSource;
	change: FocusedSource;
	renderedBlockCount: number;
	renderedCharacterCount: number;
	source: string;
}

interface ReleaseStructureFocus {
	targetNodeCount: number;
	includedNodeCount: number;
	renderedCharacterCount: number;
	coverage: "unavailable" | "complete" | "partial";
	source: string;
}

interface ReviewerPass {
	verdict: "pass";
	sourceRole: ReviewerSourceRole;
	instantiation: ReviewerInstantiation;
	reason: string;
}

interface ReviewerChallenge {
	verdict: "challenge";
	sourceRole: ReviewerSourceRole;
	instantiation: ReviewerInstantiation;
	issueType: ReviewerIssueType;
	addRanges: string[];
	removeMode: ReviewerRemoveMode;
	removeRanges: string[];
	submittedPreserveRanges: string[];
	preserveRanges: string[];
	addBlockIds: number[];
	removeBlockIds: number[];
	preserveBlockIds: number[];
	reason: string;
}

interface ReviewerNoopChallenge {
	verdict: "noop_challenge";
	sourceRole: ReviewerSourceRole;
	instantiation: ReviewerInstantiation;
	issueType: ReviewerIssueType;
	submittedAddRanges: string[];
	removeMode: ReviewerRemoveMode;
	submittedRemoveRanges: string[];
	submittedPreserveRanges: string[];
	preserveRanges: string[];
	reason: string;
}

type ReviewerDecision = ReviewerPass | ReviewerChallenge | ReviewerNoopChallenge;

interface ReleaseHardRootClaim {
	carrierType: HardCarrierType;
	rootBlockId: number;
	exitBlockIdExclusive: number | null;
	projectedRanges: string[];
}

interface ReleaseDecision {
	verdict: "reject" | "publish";
	hardCarrierReason: string;
	hardRootClaims: ReleaseHardRootClaim[];
	restoredRemoveRanges: string[];
	hardExcludedRanges: string[];
	residualReason: string;
	submittedOutsideCarrierExcludedRanges: string[];
	outsideCarrierExcludedRanges: string[];
	hardBoundaryResidualAuthorityRanges: string[];
	submittedAcceptedAddRanges: string[];
	acceptedAddRanges: string[];
	finalRanges: string[];
	finalBlockIds: number[];
	reason: string;
}

interface RoleUsage {
	providerCalls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
	elapsedMs: number;
}

interface RuntimeUsage {
	reviewer: RoleUsage;
	release: RoleUsage;
}

interface RequirementReviewFailure {
	role: Role | "preflight";
	code: "capacity" | "provider_error" | "contract_error" | "timeout" | "aborted";
	message: string;
}

interface RequirementReviewProgress {
	role: Role;
	tool: string;
}

interface RoleRuntime {
	model: Model<Api>;
	streamFunction: StreamFn;
	apiKey: string;
	headers?: ProviderHeaders;
	env?: ProviderEnv;
}

export interface RunRequirementReviewOptions {
	packet: RequirementReviewPacket;
	packetSha256: string;
	prompts: RequirementReviewPrompts;
	reviewerRuntime: RoleRuntime;
	releaseRuntime: RoleRuntime;
	auditNonEmptyReviewerNoChange?: boolean;
	signal?: AbortSignal;
	requestTimeoutMs?: number;
	onProgress?: (progress: RequirementReviewProgress) => void;
}

export interface RequirementReviewResult {
	schemaVersion: "xique.word-requirement-review.result.v1";
	status: "preserved" | "repaired" | "degraded";
	resolution:
		| "reviewer_pass"
		| "reviewer_noop_challenge"
		| "release_confirmed_reviewer_no_change"
		| "release_rejected_challenge"
		| "release_applied_repair"
		| "review_incomplete";
	reviewDegraded: boolean;
	packetSha256: string;
	capabilitySha256: string;
	candidateId: string;
	candidatePromptSha256: string;
	candidateRanges: string[];
	finalRanges: string[];
	patch: null | { addRanges: string[]; removeRanges: string[] };
	reason: string;
	failure: RequirementReviewFailure | null;
	reviewer: ReviewerDecision | null;
	release: ReleaseDecision | null;
	models: {
		reviewer: { provider: string; id: string; contextWindow: number };
		release: { provider: string; id: string; contextWindow: number };
	};
	prompts: RequirementReviewPrompts["hashes"];
	inputs: { reviewerSha256: string | null; releaseSha256: string | null };
	submissions: { reviewer: SubmissionMode | null; release: SubmissionMode | null };
	context: {
		reviewerEstimatedTokens: number;
		releaseEstimatedTokens: number | null;
		reviewerContextWindow: number;
		releaseContextWindow: number;
		structureEvidenceProvided: boolean;
		structureEvidenceEntryCount: number;
		structureMapNodeCount: number;
		structureMapCharacterCount: number;
		structureMapCoverage: StructureMap["coverage"];
		reviewerThinkingLevel: ThinkingLevel;
		releaseThinkingLevel: ThinkingLevel;
		fullRemovalDemotedToHardBoundaryReview: boolean;
		hardBoundaryResidualPrecisionMode: HardBoundaryResidualPrecisionMode;
		reviewerNoChangeHardCarrierAudit: boolean;
		reviewerContractFallbackFailure: RequirementReviewFailure | null;
		releaseBoundaryReviewRanges: string[];
	};
	budget: RoleUsage & { roles: RuntimeUsage };
}

interface StructuredCallOptions<TSchemaType extends TSchema, TResult> extends RoleRuntime {
	role: Role;
	systemPrompt: string;
	userPrompt: string;
	toolName: string;
	toolLabel: string;
	toolDescription: string;
	schema: TSchemaType;
	normalize?: (value: unknown) => unknown;
	parse: (value: Static<TSchemaType>) => TResult;
	maxTokens: number;
	requestTimeoutMs: number;
	usage: RuntimeUsage;
	signal: AbortSignal;
	onProgress?: (progress: RequirementReviewProgress) => void;
}

interface StructuredCallResult<TResult> {
	decision: TResult;
	inputSha256: string;
	submissionMode: SubmissionMode;
}

const FORBIDDEN_PACKET_KEYS = new Set([
	"answer",
	"baseline",
	"baselineranges",
	"evaluation",
	"evaluator",
	"expected",
	"expectedranges",
	"gold",
	"goldranges",
	"historicaloutput",
	"production",
	"productioncalls",
	"productionoutput",
	"referenceanswer",
	"reviewresult",
	"scorecard",
	"winner",
]);

export function parseRequirementReviewPacket(value: unknown): RequirementReviewPacket {
	assertAnswerFreePacketValue(value);
	if (!isRecord(value)) throw new Error("invalid requirement review packet: root must be an object");
	const expectedKeys = new Set([
		"schemaVersion",
		"reviewMode",
		"version",
		"outputField",
		"sourceName",
		"sourceSha256",
		"blockCount",
		"candidateId",
		"candidatePromptSha256",
		"initialRanges",
		"blocks",
		"structureEvidence",
	]);
	for (const key of Object.keys(value)) {
		if (!expectedKeys.has(key)) throw new Error(`invalid requirement review packet: unknown field ${key}`);
	}
	if (value.schemaVersion !== "xique.word-requirement-review.packet.v1") {
		throw new Error("invalid requirement review packet: unsupported schemaVersion");
	}
	if (value.reviewMode !== "candidate_protected_residual") {
		throw new Error("invalid requirement review packet: unsupported reviewMode");
	}
	if (value.version !== "docx-paragraphs-v1") {
		throw new Error("invalid requirement review packet: unsupported version");
	}
	if (value.outputField !== "完整采购需求编号范围") {
		throw new Error("invalid requirement review packet: wrong outputField");
	}
	if (typeof value.sourceName !== "string" || !value.sourceName.trim()) {
		throw new Error("invalid requirement review packet: sourceName is required");
	}
	if (typeof value.candidateId !== "string" || !value.candidateId.trim()) {
		throw new Error("invalid requirement review packet: candidateId is required");
	}
	if (!isSha256(value.sourceSha256)) {
		throw new Error("invalid requirement review packet: sourceSha256 must be lowercase SHA-256");
	}
	if (!isSha256(value.candidatePromptSha256)) {
		throw new Error("invalid requirement review packet: candidatePromptSha256 must be lowercase SHA-256");
	}
	if (!Number.isInteger(value.blockCount) || Number(value.blockCount) < 1) {
		throw new Error("invalid requirement review packet: blockCount must be a positive integer");
	}
	if (!Array.isArray(value.initialRanges) || value.initialRanges.some((item) => typeof item !== "string")) {
		throw new Error("invalid requirement review packet: initialRanges must be a string array");
	}
	if (!Array.isArray(value.blocks) || value.blocks.length !== value.blockCount) {
		throw new Error("invalid requirement review packet: blocks must match blockCount");
	}

	const blocks: RequirementReviewBlock[] = [];
	let previousBlockId = -1;
	for (const rawBlock of value.blocks) {
		if (!isRecord(rawBlock)) throw new Error("invalid requirement review packet: block must be an object");
		if (Object.keys(rawBlock).some((key) => key !== "blockId" && key !== "text")) {
			throw new Error("invalid requirement review packet: block has unknown fields");
		}
		if (!Number.isInteger(rawBlock.blockId) || Number(rawBlock.blockId) < 0) {
			throw new Error("invalid requirement review packet: blockId must be a non-negative integer");
		}
		if (Number(rawBlock.blockId) <= previousBlockId) {
			throw new Error("invalid requirement review packet: blockIds must be unique and strictly increasing");
		}
		if (typeof rawBlock.text !== "string") {
			throw new Error("invalid requirement review packet: block text must be a string");
		}
		previousBlockId = Number(rawBlock.blockId);
		blocks.push({ blockId: Number(rawBlock.blockId), text: rawBlock.text });
	}

	const source = renderSource(blocks);
	if (sha256(source) !== value.sourceSha256) {
		throw new Error("invalid requirement review packet: sourceSha256 does not match canonical blocks");
	}
	parseStrictRanges(value.initialRanges, new Set(blocks.map((block) => block.blockId)));
	const structureEvidence =
		value.structureEvidence === undefined
			? undefined
			: parseStructureEvidence(
					value.structureEvidence,
					value.sourceSha256,
					Number(value.blockCount),
					new Set(blocks.map((block) => block.blockId)),
				);
	return {
		schemaVersion: value.schemaVersion,
		reviewMode: value.reviewMode,
		version: value.version,
		outputField: value.outputField,
		sourceName: value.sourceName,
		sourceSha256: value.sourceSha256,
		blockCount: Number(value.blockCount),
		candidateId: value.candidateId,
		candidatePromptSha256: value.candidatePromptSha256,
		initialRanges: [...value.initialRanges],
		blocks,
		...(structureEvidence ? { structureEvidence } : {}),
	};
}

function parseStructureEvidence(
	value: unknown,
	sourceSha256: string,
	sourceBlockCount: number,
	availableBlockIds: ReadonlySet<number>,
): RequirementReviewStructureEvidence {
	if (!isRecord(value)) {
		throw new Error("invalid requirement review packet: structureEvidence must be an object");
	}
	const expectedKeys = new Set([
		"schemaVersion",
		"docxSha256",
		"sourceSha256",
		"sourceBlockCount",
		"matchedBlockCount",
		"exactMatchCount",
		"entries",
	]);
	for (const key of Object.keys(value)) {
		if (!expectedKeys.has(key)) {
			throw new Error(`invalid requirement review packet: unknown structureEvidence field ${key}`);
		}
	}
	if (value.schemaVersion !== "xique.word-structure-evidence.v1") {
		throw new Error("invalid requirement review packet: unsupported structureEvidence schemaVersion");
	}
	if (!isSha256(value.docxSha256)) {
		throw new Error("invalid requirement review packet: structureEvidence docxSha256 must be lowercase SHA-256");
	}
	if (value.sourceSha256 !== sourceSha256) {
		throw new Error("invalid requirement review packet: structureEvidence sourceSha256 mismatch");
	}
	if (value.sourceBlockCount !== sourceBlockCount) {
		throw new Error("invalid requirement review packet: structureEvidence sourceBlockCount mismatch");
	}
	if (!Array.isArray(value.entries) || value.entries.length === 0) {
		throw new Error("invalid requirement review packet: structureEvidence entries must be non-empty");
	}
	if (value.matchedBlockCount !== value.entries.length) {
		throw new Error("invalid requirement review packet: structureEvidence matchedBlockCount mismatch");
	}

	const entries: RequirementReviewStructureEntry[] = [];
	let previousBlockId = -1;
	let previousBodyIndex = -1;
	let exactMatchCount = 0;
	for (const rawEntry of value.entries) {
		if (!isRecord(rawEntry)) {
			throw new Error("invalid requirement review packet: structureEvidence entry must be an object");
		}
		const entryKeys = new Set([
			"blockId",
			"matchConfidence",
			"bodyIndex",
			"kind",
			"styleId",
			"styleName",
			"outlineLevel",
			"numberingLevel",
			"pageBreakBefore",
			"keepNext",
			"alignment",
			"boldRatio",
			"fontSizes",
			"outlinePath",
			"table",
		]);
		for (const key of Object.keys(rawEntry)) {
			if (!entryKeys.has(key)) {
				throw new Error(`invalid requirement review packet: unknown structureEvidence entry field ${key}`);
			}
		}
		if (!Number.isInteger(rawEntry.blockId) || !availableBlockIds.has(Number(rawEntry.blockId))) {
			throw new Error("invalid requirement review packet: structureEvidence entry blockId is unavailable");
		}
		const blockId = Number(rawEntry.blockId);
		if (blockId <= previousBlockId) {
			throw new Error("invalid requirement review packet: structureEvidence blockIds must be strictly increasing");
		}
		if (!Number.isInteger(rawEntry.bodyIndex) || Number(rawEntry.bodyIndex) < 0) {
			throw new Error("invalid requirement review packet: structureEvidence bodyIndex must be non-negative");
		}
		const bodyIndex = Number(rawEntry.bodyIndex);
		if (bodyIndex <= previousBodyIndex) {
			throw new Error("invalid requirement review packet: structureEvidence bodyIndexes must be strictly increasing");
		}
		if (rawEntry.matchConfidence !== "exact" && rawEntry.matchConfidence !== "high") {
			throw new Error("invalid requirement review packet: structureEvidence matchConfidence must be exact or high");
		}
		if (rawEntry.kind !== "paragraph" && rawEntry.kind !== "table") {
			throw new Error("invalid requirement review packet: structureEvidence kind must be paragraph or table");
		}
		for (const field of ["styleId", "styleName", "alignment"] as const) {
			const fieldValue = rawEntry[field];
			if (fieldValue !== null && (typeof fieldValue !== "string" || fieldValue.length > 200)) {
				throw new Error(`invalid requirement review packet: structureEvidence ${field} is invalid`);
			}
		}
		for (const field of ["outlineLevel", "numberingLevel"] as const) {
			const fieldValue = rawEntry[field];
			if (
				fieldValue !== null &&
				(!Number.isInteger(fieldValue) || Number(fieldValue) < 0 || Number(fieldValue) > 8)
			) {
				throw new Error(`invalid requirement review packet: structureEvidence ${field} is invalid`);
			}
		}
		if (typeof rawEntry.pageBreakBefore !== "boolean" || typeof rawEntry.keepNext !== "boolean") {
			throw new Error("invalid requirement review packet: structureEvidence paragraph flags are invalid");
		}
		if (
			typeof rawEntry.boldRatio !== "number" ||
			!Number.isFinite(rawEntry.boldRatio) ||
			rawEntry.boldRatio < 0 ||
			rawEntry.boldRatio > 1
		) {
			throw new Error("invalid requirement review packet: structureEvidence boldRatio is invalid");
		}
		if (
			!Array.isArray(rawEntry.fontSizes) ||
			rawEntry.fontSizes.length > 3 ||
			rawEntry.fontSizes.some(
				(size) => !Number.isInteger(size) || Number(size) < 1 || Number(size) > 400,
			)
		) {
			throw new Error("invalid requirement review packet: structureEvidence fontSizes are invalid");
		}
		if (!Array.isArray(rawEntry.outlinePath) || rawEntry.outlinePath.length > 9) {
			throw new Error("invalid requirement review packet: structureEvidence outlinePath is invalid");
		}
		const outlinePath: RequirementReviewStructurePathNode[] = [];
		let previousLevel = -1;
		for (const rawNode of rawEntry.outlinePath) {
			if (
				!isRecord(rawNode) ||
				Object.keys(rawNode).some((key) => key !== "level" && key !== "blockId") ||
				!Number.isInteger(rawNode.level) ||
				Number(rawNode.level) < 0 ||
				Number(rawNode.level) > 8 ||
				Number(rawNode.level) <= previousLevel ||
				!Number.isInteger(rawNode.blockId) ||
				!availableBlockIds.has(Number(rawNode.blockId)) ||
				Number(rawNode.blockId) > blockId
			) {
				throw new Error("invalid requirement review packet: structureEvidence outlinePath node is invalid");
			}
			previousLevel = Number(rawNode.level);
			outlinePath.push({ level: Number(rawNode.level), blockId: Number(rawNode.blockId) });
		}
		let table: RequirementReviewStructureTable | null = null;
		if (rawEntry.table !== null) {
			if (
				!isRecord(rawEntry.table) ||
				Object.keys(rawEntry.table).some(
					(key) => key !== "rowCount" && key !== "cellCount" && key !== "paragraphCount",
				)
			) {
				throw new Error("invalid requirement review packet: structureEvidence table is invalid");
			}
			for (const field of ["rowCount", "cellCount", "paragraphCount"] as const) {
				if (!Number.isInteger(rawEntry.table[field]) || Number(rawEntry.table[field]) < 0) {
					throw new Error(`invalid requirement review packet: structureEvidence table ${field} is invalid`);
				}
			}
			table = {
				rowCount: Number(rawEntry.table.rowCount),
				cellCount: Number(rawEntry.table.cellCount),
				paragraphCount: Number(rawEntry.table.paragraphCount),
			};
		}
		if ((rawEntry.kind === "table") !== (table !== null)) {
			throw new Error("invalid requirement review packet: structureEvidence kind/table mismatch");
		}
		if (rawEntry.matchConfidence === "exact") exactMatchCount += 1;
		entries.push({
			blockId,
			matchConfidence: rawEntry.matchConfidence,
			bodyIndex,
			kind: rawEntry.kind,
			styleId: rawEntry.styleId,
			styleName: rawEntry.styleName,
			outlineLevel: rawEntry.outlineLevel === null ? null : Number(rawEntry.outlineLevel),
			numberingLevel:
				rawEntry.numberingLevel === null ? null : Number(rawEntry.numberingLevel),
			pageBreakBefore: rawEntry.pageBreakBefore,
			keepNext: rawEntry.keepNext,
			alignment: rawEntry.alignment,
			boldRatio: rawEntry.boldRatio,
			fontSizes: rawEntry.fontSizes.map(Number),
			outlinePath,
			table,
		});
		previousBlockId = blockId;
		previousBodyIndex = bodyIndex;
	}
	if (value.exactMatchCount !== exactMatchCount) {
		throw new Error("invalid requirement review packet: structureEvidence exactMatchCount mismatch");
	}
	return {
		schemaVersion: value.schemaVersion,
		docxSha256: value.docxSha256,
		sourceSha256,
		sourceBlockCount,
		matchedBlockCount: entries.length,
		exactMatchCount,
		entries,
	};
}

export async function loadRequirementReviewPrompts(
	directory = promptDirectory,
): Promise<RequirementReviewPrompts> {
	const [
		productPrinciples,
		semanticContract,
		runtimeContract,
		reviewer,
		release,
		piNativeSemanticContract,
		piNativeRuntimeContract,
		witness,
		finalizer,
	] = await Promise.all([
		readFile(resolve(directory, "product-principles.md"), "utf8"),
		readFile(resolve(directory, "semantic-contract.md"), "utf8"),
		readFile(resolve(directory, "runtime-contract.md"), "utf8"),
		readFile(resolve(directory, "reviewer.md"), "utf8"),
		readFile(resolve(directory, "release.md"), "utf8"),
		readFile(resolve(directory, "pi-native-semantic-contract.md"), "utf8"),
		readFile(resolve(directory, "pi-native-runtime-contract.md"), "utf8"),
		readFile(resolve(directory, "witness.md"), "utf8"),
		readFile(resolve(directory, "finalizer.md"), "utf8"),
	]);
	return {
		productPrinciples,
		semanticContract,
		runtimeContract,
		reviewer,
		release,
		piNativeSemanticContract,
		piNativeRuntimeContract,
		witness,
		finalizer,
		hashes: {
			productPrinciples: sha256(productPrinciples),
			semanticContract: sha256(semanticContract),
			runtimeContract: sha256(runtimeContract),
			reviewer: sha256(reviewer),
			release: sha256(release),
			piNativeSemanticContract: sha256(piNativeSemanticContract),
			piNativeRuntimeContract: sha256(piNativeRuntimeContract),
			witness: sha256(witness),
			finalizer: sha256(finalizer),
		},
	};
}

export async function runRequirementReview(
	options: RunRequirementReviewOptions,
): Promise<RequirementReviewResult> {
	const timeoutController = new AbortController();
	const timeout = setTimeout(
		() => timeoutController.abort(new Error("requirement review workflow timed out")),
		WORKFLOW_TIMEOUT_MS,
	);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutController.signal])
		: timeoutController.signal;
	const usage: RuntimeUsage = { reviewer: emptyUsage(), release: emptyUsage() };
	const availableBlockIds = new Set(options.packet.blocks.map((block) => block.blockId));
	const candidate = parseStrictRanges(options.packet.initialRanges, availableBlockIds);
	const candidateBlockIdSet = new Set(candidate.blockIds);
	const candidateBoundaryWindowBlockIds = collectCandidateBoundaryWindowBlockIds(
		options.packet.blocks,
		candidateBlockIdSet,
	);
	const candidateIntervalAuditWindowBlockIds = collectCandidateIntervalEdgeWindowBlockIds(
		options.packet.blocks,
		candidateBlockIdSet,
	);
	const structureMap = buildStructureMap(
		options.packet.structureEvidence,
		candidateBlockIdSet,
		options.packet.blocks,
	);
	const reviewerDecisionSchema = createReviewerDecisionSchema();
	const reviewerSystemPrompt = `${options.prompts.runtimeContract.trim()}\n\n${options.prompts.reviewer.trim()}`;
	const reviewerUserPrompt = buildReviewerUserPrompt(
		options.packet.blocks,
		candidateBlockIdSet,
		candidate.ranges,
		structureMap,
		candidateBoundaryWindowBlockIds,
		candidateIntervalAuditWindowBlockIds,
	);
	const reviewerEstimatedTokens = estimateTextTokens(
		`${reviewerSystemPrompt}\n${reviewerUserPrompt}\n${JSON.stringify(reviewerDecisionSchema)}`,
	);
	let releaseEstimatedTokens: number | null = null;
	let reviewerInputSha256: string | null = null;
	let releaseInputSha256: string | null = null;
	let reviewerSubmissionMode: SubmissionMode | null = null;
	let releaseSubmissionMode: SubmissionMode | null = null;
	let reviewerDecision: ReviewerDecision | null = null;
	let releaseDecision: ReleaseDecision | null = null;
	let fullRemovalDemotedToHardBoundaryReview = false;
	let hardBoundaryResidualPrecisionMode: HardBoundaryResidualPrecisionMode = "disabled";
	let reviewerNoChangeHardCarrierAudit = false;
	let reviewerContractFallbackFailure: RequirementReviewFailure | null = null;
	let releaseBoundaryReviewBlockIds: number[] = [];
	const capabilitySha256 = sha256(
		JSON.stringify({
			runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
			packetSha256: options.packetSha256,
			prompts: options.prompts.hashes,
			models: {
				reviewer: modelIdentity(options.reviewerRuntime.model),
				release: modelIdentity(options.releaseRuntime.model),
			},
			reviewerSchema: reviewerDecisionSchema,
			releaseSchema: ReleaseDecisionSchema,
			limits: {
				reviewerMaxTokens: REVIEWER_MAX_TOKENS,
				releaseMaxTokens: RELEASE_MAX_TOKENS,
				reviewerThinkingLevel: REVIEWER_THINKING_LEVEL,
				releaseThinkingLevel: RELEASE_THINKING_LEVEL,
				requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				workflowTimeoutMs: WORKFLOW_TIMEOUT_MS,
				maxProviderCalls: MAX_PROVIDER_CALLS,
				maxRunInputTokens: MAX_RUN_INPUT_TOKENS,
				maxRunOutputTokens: MAX_RUN_OUTPUT_TOKENS,
				maxRunReasoningTokens: MAX_RUN_REASONING_TOKENS,
				auditNonEmptyReviewerNoChange: options.auditNonEmptyReviewerNoChange === true,
				minOperationalPrecisionCandidateCharacterRatio:
					MIN_OPERATIONAL_PRECISION_CANDIDATE_CHARACTER_RATIO,
				maxReviewerBoundaryFocusBlocks: MAX_REVIEWER_BOUNDARY_FOCUS_BLOCKS,
				maxReviewerBoundaryFocusCharacters: MAX_REVIEWER_BOUNDARY_FOCUS_CHARACTERS,
				reviewerBoundaryWindowBlocks: REVIEWER_BOUNDARY_WINDOW_BLOCKS,
				maxReviewerIntervalAuditFocusBlocks: MAX_REVIEWER_INTERVAL_AUDIT_FOCUS_BLOCKS,
				maxReviewerIntervalAuditFocusCharacters:
					MAX_REVIEWER_INTERVAL_AUDIT_FOCUS_CHARACTERS,
				reviewerIntervalEdgeWindowBlocks: REVIEWER_INTERVAL_EDGE_WINDOW_BLOCKS,
				maxStructureMapNodes: MAX_STRUCTURE_MAP_NODES,
				maxStructureMapCharacters: MAX_STRUCTURE_MAP_CHARACTERS,
				maxStructureTextPreviewCharacters: MAX_STRUCTURE_TEXT_PREVIEW_CHARACTERS,
				maxReleaseStructureFocusNodes: MAX_RELEASE_STRUCTURE_FOCUS_NODES,
				maxReleaseStructureFocusCharacters: MAX_RELEASE_STRUCTURE_FOCUS_CHARACTERS,
				maxReleasePermissionTransitions: MAX_RELEASE_PERMISSION_TRANSITIONS,
				hardBoundaryResidualPrecisionModes: [
					"full_removal_safety",
					"reviewer_confirmed_hard",
				],
			},
			terminalContract: "tool-call-or-strict-json-text-v1",
		}),
	);

	const finish = (
		input: Omit<
			RequirementReviewResult,
			| "schemaVersion"
			| "packetSha256"
			| "capabilitySha256"
			| "candidateId"
			| "candidatePromptSha256"
			| "candidateRanges"
			| "reviewer"
			| "release"
			| "models"
			| "prompts"
			| "inputs"
			| "submissions"
			| "context"
			| "budget"
		>,
	): RequirementReviewResult => ({
		schemaVersion: "xique.word-requirement-review.result.v1",
		packetSha256: options.packetSha256,
		capabilitySha256,
		candidateId: options.packet.candidateId,
		candidatePromptSha256: options.packet.candidatePromptSha256,
		candidateRanges: candidate.ranges,
		reviewer: reviewerDecision,
		release: releaseDecision,
		models: {
			reviewer: modelIdentity(options.reviewerRuntime.model),
			release: modelIdentity(options.releaseRuntime.model),
		},
		prompts: options.prompts.hashes,
		inputs: { reviewerSha256: reviewerInputSha256, releaseSha256: releaseInputSha256 },
		submissions: { reviewer: reviewerSubmissionMode, release: releaseSubmissionMode },
		context: {
			reviewerEstimatedTokens,
			releaseEstimatedTokens,
			reviewerContextWindow: options.reviewerRuntime.model.contextWindow,
			releaseContextWindow: options.releaseRuntime.model.contextWindow,
			structureEvidenceProvided: structureMap.provided,
			structureEvidenceEntryCount: structureMap.entryCount,
			structureMapNodeCount: structureMap.renderedNodeCount,
			structureMapCharacterCount: structureMap.renderedCharacterCount,
			structureMapCoverage: structureMap.coverage,
			reviewerThinkingLevel: REVIEWER_THINKING_LEVEL,
			releaseThinkingLevel: RELEASE_THINKING_LEVEL,
			fullRemovalDemotedToHardBoundaryReview,
			hardBoundaryResidualPrecisionMode,
			reviewerNoChangeHardCarrierAudit,
			reviewerContractFallbackFailure,
			releaseBoundaryReviewRanges: compactBlockRanges(releaseBoundaryReviewBlockIds),
		},
		budget: { ...totalUsage(usage), roles: usage },
		...input,
	});

	try {
		if (!fitsContext(options.reviewerRuntime.model, reviewerEstimatedTokens, REVIEWER_MAX_TOKENS)) {
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				finalRanges: candidate.ranges,
				patch: null,
				reason: "Reviewer input exceeds the frozen model context budget; candidate preserved.",
				failure: {
					role: "preflight",
					code: "capacity",
					message: "Reviewer input exceeds the frozen model context budget",
				},
			});
		}

		try {
			const reviewerCall = await structuredCall({
				role: "reviewer",
				systemPrompt: reviewerSystemPrompt,
				userPrompt: reviewerUserPrompt,
				toolName: "submit_requirement_residual_review",
				toolLabel: "Submit requirement residual review",
				toolDescription:
					"Write reason first and settle the whole-document communicative role and instantiation, then audit Candidate intervals in candidateHardCarrierAuditOrder before any categorical or range fields. Finish the longest interval first using compact root-to-exit and keep/remove islands rather than clause narration. A hard-carrier finding is only range-local: after every affirmed hard root, explicitly form Candidate minus all hard root-to-exit ranges, split every surviving residual at each peer heading, numbered subsection, table segment, or equivalent functional boundary, and finish pre-award plus outside-carrier precision closure on each island. An ancestor chapter label is navigation, never a keep verdict for all descendants; a submission that leaves a mixed residual unsplit on that basis is unfinished. Before certifying any multi-block residual keep island, run false_protection_counterexample_attack: find the strongest exact separable non-requirement block or peer subsection, split it out, and repeat on the remaining keep subranges until no counterexample remains. Positive work examples elsewhere in the same chapter cannot prove the rest of a broad keep range. Carrier Owner is decided before block-level primary effect. Treat an aggregate parent as a mixed container and run duty_survival_attack before deleting any outside-carrier block. Then submit exact enum-only source_role and instantiation fields and either pass or one exact challenge. If the settled verdict is pass, discard every draft change and submit issue_type=none, add_ranges=[], removal={mode: exact, remove_ranges: []}. Add may contain only OUT blocks. Before submission, project every qualified OUT block positively identified in reason into add_ranges; empty add_ranges cannot coexist with a reason that says an OUT body, table, list, continuation, or appendix belongs in final. Likewise, never describe a Candidate block as a hard-carrier descendant, bare external pointer, non-fact shell, or safe outside-carrier deletion and then leave it in final: explicitly retract the diagnosis or include the block in removal; temporary preservation is forbidden. A material OUT omission outranks unrelated cleanup. selected_shell_body_closure applies only when the current immutable source actually contains the body; an IN block that merely points to an absent or separately supplied list, drawing, specification, or attachment remains a bare external pointer and must not be protected as source fidelity. operational_precision must pass when it only removes an isolated summary, duplicate snippet, or other small ordinary noise that is neither a complete self-contained nontechnical unit nor an approximately ten-percent Candidate burden. A bare external pointer is a correctness issue, never ordinary short-pointer cleanup, regardless of its character ratio. Compute the complete Candidate remove and keep islands from the settled reason, choose exact when its range list is no longer, choose candidate_complement when preserve_ranges is shorter, and use exact on a tie. Re-read the literal overlay marker for every range and write structural fields last. source_role=non_procurement or instantiation=absent is a terminal null claim and cannot pass or leave any Candidate/add block.",
				schema: reviewerDecisionSchema,
				normalize: (value) =>
					normalizeReviewerSubmission(value, candidate.blockIds.length > 0),
				parse: (raw) =>
					validateReviewerDecision(
						raw,
						candidate.blockIds,
						availableBlockIds,
						options.packet.blocks,
					),
				maxTokens: REVIEWER_MAX_TOKENS,
				...options.reviewerRuntime,
				requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				usage,
				signal,
				onProgress: options.onProgress,
			});
			reviewerDecision = reviewerCall.decision;
			reviewerInputSha256 = reviewerCall.inputSha256;
			reviewerSubmissionMode = reviewerCall.submissionMode;
		} catch (error) {
			const failure = failureFromError("reviewer", error, signal);
			if (
				options.auditNonEmptyReviewerNoChange === true &&
				candidate.blockIds.length > 0 &&
				failure.code === "contract_error"
			) {
				reviewerContractFallbackFailure = failure;
				reviewerNoChangeHardCarrierAudit = true;
			} else {
				return finish({
					status: "degraded",
					resolution: "review_incomplete",
					reviewDegraded: true,
					finalRanges: candidate.ranges,
					patch: null,
					reason: "Reviewer did not complete a contract-valid decision; candidate preserved.",
					failure,
				});
			}
		}

		if (reviewerDecision !== null) {
			reviewerNoChangeHardCarrierAudit =
				options.auditNonEmptyReviewerNoChange === true &&
				(reviewerDecision.verdict === "pass" ||
					reviewerDecision.verdict === "noop_challenge") &&
				candidate.blockIds.length > 0;
			if (
				(reviewerDecision.verdict === "pass" ||
					reviewerDecision.verdict === "noop_challenge") &&
				!reviewerNoChangeHardCarrierAudit
			) {
				return finish({
					status: "preserved",
					resolution:
						reviewerDecision.verdict === "pass"
							? "reviewer_pass"
							: "reviewer_noop_challenge",
					reviewDegraded: false,
					finalRanges: candidate.ranges,
					patch: null,
					reason: reviewerDecision.reason,
					failure: null,
				});
			}
		}
		const challenge = reviewerDecision?.verdict === "challenge" ? reviewerDecision : null;
		fullRemovalDemotedToHardBoundaryReview =
			challenge !== null &&
			candidate.blockIds.length > 0 &&
			challenge.sourceRole === "buyer_issued" &&
			challenge.instantiation === "present" &&
			challenge.removeBlockIds.length === candidate.blockIds.length;
		const releaseRemoveBlockIds = fullRemovalDemotedToHardBoundaryReview
			? []
			: (challenge?.removeBlockIds ?? []);
		const releaseHasRemoval = releaseRemoveBlockIds.length > 0;
		hardBoundaryResidualPrecisionMode = fullRemovalDemotedToHardBoundaryReview
			? "full_removal_safety"
			: releaseHasRemoval
				? "reviewer_confirmed_hard"
				: "disabled";
		const releaseRemoveRanges = compactBlockRanges(releaseRemoveBlockIds);
		const challengeAddBlockIdSet = new Set(challenge?.addBlockIds ?? []);
		releaseBoundaryReviewBlockIds =
			!reviewerNoChangeHardCarrierAudit &&
			challenge?.sourceRole === "buyer_issued" &&
			challenge.instantiation === "present" &&
			!fullRemovalDemotedToHardBoundaryReview
				? [...candidateBoundaryWindowBlockIds]
						.filter(
							(blockId) =>
								!candidateBlockIdSet.has(blockId) && !challengeAddBlockIdSet.has(blockId),
						)
						.sort((left, right) => left - right)
				: [];
		const releaseAllowedAddBlockIds = [
			...(challenge?.addBlockIds ?? []),
			...releaseBoundaryReviewBlockIds,
		];

		const releaseSystemPrompt = `${options.prompts.runtimeContract.trim()}\n\n${options.prompts.release.trim()}`;
		const releaseUserPrompt = reviewerNoChangeHardCarrierAudit
			? buildReviewerNoChangeReleaseUserPrompt(
					options.packet.blocks,
					candidateBlockIdSet,
					candidate.ranges,
					structureMap,
				)
			: buildReleaseUserPrompt(
					options.packet.blocks,
					candidateBlockIdSet,
					challengeAddBlockIdSet,
					new Set(releaseBoundaryReviewBlockIds),
					new Set(releaseRemoveBlockIds),
					new Set(releaseRemoveBlockIds),
					candidate.ranges,
					challenge?.issueType ?? "unspecified",
					challenge?.addRanges ?? [],
					challenge?.removeMode ?? "exact",
					releaseHasRemoval,
					fullRemovalDemotedToHardBoundaryReview,
					hardBoundaryResidualPrecisionMode,
					releaseRemoveRanges,
					releaseRemoveRanges,
					structureMap,
				);
		releaseEstimatedTokens = estimateTextTokens(
			`${releaseSystemPrompt}\n${releaseUserPrompt}\n${JSON.stringify(ReleaseDecisionSchema)}`,
		);
		if (!fitsContext(options.releaseRuntime.model, releaseEstimatedTokens, RELEASE_MAX_TOKENS)) {
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				finalRanges: candidate.ranges,
				patch: null,
				reason: "Release input exceeds the frozen model context budget; candidate preserved.",
				failure: {
					role: "preflight",
					code: "capacity",
					message: "Release input exceeds the frozen model context budget",
				},
			});
		}

		try {
			const releaseCall = await structuredCall({
				role: "release",
				systemPrompt: releaseSystemPrompt,
				userPrompt: releaseUserPrompt,
				toolName: "submit_requirement_release",
				toolLabel: "Submit requirement release",
				toolDescription:
					reviewerNoChangeHardCarrierAudit
						? "Complete one independent terminal-or-hard veto audit. Write hard_carrier_reason and residual_reason, then hard_root_claims, outside_carrier_excluded_ranges, and accepted_add_ranges. For a proven whole-source non-procurement, completed-supplier-response, contract-only, or uninstantiated-template identity, submit exactly the complete Candidate in outside_carrier_excluded_ranges and leave hard_root_claims plus accepted additions empty. Otherwise, submit only carrier_type/root/exit claims for every independently proven four-carrier root; the Harness derives their complete projections and hard exclusion union. Partial outside-carrier deletion, additions, ordinary cleanup, and residual precision are unauthorized. Submit an empty delta when neither veto is proven."
						: "Complete one phased Release submission. Write hard_carrier_reason and residual_reason first, then submit only carrier_type/root/exit hard_root_claims before the two range arrays. The Harness intersects each claim with the explicit projection universe, rejects empty or overlapping projections, and derives the hard exclusion union. Candidate need not contain a hard-carrier root title: inspect source ancestors and submit an affirmed OUT-starting root with its semantic exit. Narrow or retract the claim before retaining any descendant. After the derived hard projection, the Harness may expose exactly one continuous Candidate residual for outside-carrier precision: full-removal safety requires any Candidate hard exclusion, while a normal bounded patch additionally requires at least one hard-excluded REMOVE_REVIEW block. For operational_precision, omit every challenged block that should remain from outside_carrier_excluded_ranges. ADD_REVIEW is the Reviewer-proposed external subset. BOUNDARY_REVIEW is a separate content-blind, address-bounded external subset around Candidate run edges; accept it only when the complete immutable source proves that the entire authorized island is the same qualified body, table, list, continuation, or appendix needed to close an adjacent Candidate shell. It is not permission to search for unrelated omissions, and a partial body extending outside the authorized envelope must be rejected. Other OUT is unavailable. The Harness derives all hard projection, automatic restoration, and final ranges mechanically.",
				schema: ReleaseDecisionSchema,
				normalize: normalizeReleaseSubmission,
				parse: (raw) =>
					validateReleaseDecision(
						raw,
						candidate.blockIds,
						releaseAllowedAddBlockIds,
						releaseRemoveBlockIds,
						availableBlockIds,
						hardBoundaryResidualPrecisionMode,
						reviewerNoChangeHardCarrierAudit,
					),
				maxTokens: RELEASE_MAX_TOKENS,
				...options.releaseRuntime,
				requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				usage,
				signal,
				onProgress: options.onProgress,
			});
			releaseDecision = releaseCall.decision;
			releaseInputSha256 = releaseCall.inputSha256;
			releaseSubmissionMode = releaseCall.submissionMode;
		} catch (error) {
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				finalRanges: candidate.ranges,
				patch: null,
				reason: "Release did not complete a contract-valid decision; candidate preserved.",
				failure: failureFromError("release", error, signal),
			});
		}

		if (releaseDecision.verdict === "reject") {
			return finish({
				status: "preserved",
				resolution: reviewerNoChangeHardCarrierAudit
					? "release_confirmed_reviewer_no_change"
					: "release_rejected_challenge",
				reviewDegraded: false,
				finalRanges: candidate.ranges,
				patch: null,
				reason: releaseDecision.reason,
				failure: null,
			});
		}

		const candidateBlockIds = new Set(candidate.blockIds);
		const finalBlockIds = new Set(releaseDecision.finalBlockIds);
		const addRanges = compactBlockRanges(
			releaseDecision.finalBlockIds.filter((blockId) => !candidateBlockIds.has(blockId)),
		);
		const removeRanges = compactBlockRanges(
			candidate.blockIds.filter((blockId) => !finalBlockIds.has(blockId)),
		);
		return finish({
			status: "repaired",
			resolution: "release_applied_repair",
			reviewDegraded: false,
			finalRanges: releaseDecision.finalRanges,
			patch: { addRanges, removeRanges },
			reason: releaseDecision.reason,
			failure: null,
		});
	} finally {
		clearTimeout(timeout);
	}
}

const requirementReviewTool = defineTool({
	name: "review_word_requirement_extraction_candidate",
	label: "Review Word requirement extraction candidate (V1 legacy overlay)",
	description:
		"Run the V1 legacy candidate-protected overlay baseline over an answer-free xique.word-requirement-review.packet.v1 packet. An empty-candidate pass uses one Doubao call. Every non-empty Candidate receives one independent GLM Release call: bounded patch review after a contract-valid challenge, or a protected terminal-or-hard veto audit after Reviewer pass/no-op/contract failure.",
	promptSnippet: "Run the V1 legacy Word requirement overlay baseline",
	promptGuidelines: [
		"Use only for V1 legacy comparison after the mature single-prompt candidate and complete immutable paragraph packet exist. Report degraded review without changing ranges when the capability fails closed.",
	],
	parameters: Type.Object({
		packetPath: Type.String({
			minLength: 1,
			description:
				"Absolute path or cwd-relative path to an answer-free xique.word-requirement-review.packet.v1 JSON file",
		}),
	}),
	executionMode: "sequential",
	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		const loaded = await loadRequirementReviewPacket(params.packetPath, ctx.cwd);
		const prompts = await loadRequirementReviewPrompts();
		const reviewerModel = ctx.modelRegistry.find(REVIEWER_PROVIDER, REVIEWER_MODEL_ID);
		if (!reviewerModel) {
			throw new Error(
				`registered Doubao requirement reviewer model not found: ${REVIEWER_PROVIDER}/${REVIEWER_MODEL_ID}`,
			);
		}
		const releaseModel = ctx.modelRegistry.find(RELEASE_PROVIDER, RELEASE_MODEL_ID);
		if (!releaseModel) {
			throw new Error(
				`registered GLM requirement release model not found: ${RELEASE_PROVIDER}/${RELEASE_MODEL_ID}`,
			);
		}
		const reviewerAuth = await ctx.modelRegistry.getApiKeyAndHeaders(reviewerModel);
		if (!reviewerAuth.ok) {
			throw new Error(`Doubao requirement reviewer auth failed: ${reviewerAuth.error}`);
		}
		if (!reviewerAuth.apiKey) {
			throw new Error(
				"Doubao requirement reviewer requires PI_REQUIREMENT_REVIEWER_API_KEY or stored credentials",
			);
		}
		const releaseAuth = await ctx.modelRegistry.getApiKeyAndHeaders(releaseModel);
		if (!releaseAuth.ok) {
			throw new Error(`GLM requirement release auth failed: ${releaseAuth.error}`);
		}
		if (!releaseAuth.apiKey) {
			throw new Error(
				"GLM requirement release requires PI_REQUIREMENT_RELEASE_API_KEY or stored credentials",
			);
		}
		const result = await runRequirementReview({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			prompts,
			auditNonEmptyReviewerNoChange: true,
			reviewerRuntime: {
				model: reviewerModel,
				streamFunction: openAiCompletionsStreamFunction,
				apiKey: reviewerAuth.apiKey,
				headers: reviewerAuth.headers,
				env: reviewerAuth.env,
			},
			releaseRuntime: {
				model: releaseModel,
				streamFunction: openAiCompletionsStreamFunction,
				apiKey: releaseAuth.apiKey,
				headers: releaseAuth.headers,
				env: releaseAuth.env,
			},
			signal,
			onProgress: (progress) => {
				onUpdate?.({
					content: [{ type: "text", text: `${progress.role}: ${progress.tool}` }],
					details: progress,
				});
			},
		});
		const ranges = result.finalRanges.length > 0 ? result.finalRanges.join(", ") : "(null)";
		return {
			content: [
				{
					type: "text",
					text: `Word requirement review ${result.status}. Final ranges: ${ranges}. Calls: ${result.budget.providerCalls}. Reason: ${result.reason}`,
				},
			],
			details: result,
		};
	},
});

const piNativeRequirementReviewTool = defineTool({
	name: "review_word_requirement_extraction_candidate_pi_native",
	label: "Review Word requirement extraction candidate with Pi-native Finalizer/Witness",
	description:
		"Run the fixed three-call Pi-native review over an answer-free xique.word-requirement-review.packet.v1 packet: GLM provisional selection, Doubao 2.0 Pro bounded adversarial Witness, then the same GLM Finalizer context for one final selection. The Harness validates addresses and typed-claim consistency only; it never lets Witness or code override semantic membership.",
	promptSnippet: "Review a frozen Word requirement candidate with the Pi-native Finalizer/Witness loop",
	promptGuidelines: [
		"Use this active route only with the same frozen packet used by the mature Candidate. A degraded result preserves Candidate unchanged and is not evidence of a successful review.",
	],
	parameters: Type.Object({
		packetPath: Type.String({
			minLength: 1,
			description:
				"Absolute path or cwd-relative path to an answer-free xique.word-requirement-review.packet.v1 JSON file",
		}),
	}),
	executionMode: "sequential",
	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		const loaded = await loadRequirementReviewPacket(params.packetPath, ctx.cwd);
		const prompts = await loadRequirementReviewPrompts();
		const witnessModel = ctx.modelRegistry.find(REVIEWER_PROVIDER, REVIEWER_MODEL_ID);
		if (!witnessModel) {
			throw new Error(
				`registered Doubao requirement Witness model not found: ${REVIEWER_PROVIDER}/${REVIEWER_MODEL_ID}`,
			);
		}
		const finalizerModel = ctx.modelRegistry.find(RELEASE_PROVIDER, RELEASE_MODEL_ID);
		if (!finalizerModel) {
			throw new Error(
				`registered GLM requirement Finalizer model not found: ${RELEASE_PROVIDER}/${RELEASE_MODEL_ID}`,
			);
		}
		const witnessAuth = await ctx.modelRegistry.getApiKeyAndHeaders(witnessModel);
		if (!witnessAuth.ok) {
			throw new Error(`Doubao requirement Witness auth failed: ${witnessAuth.error}`);
		}
		if (!witnessAuth.apiKey) {
			throw new Error(
				"Doubao requirement Witness requires PI_REQUIREMENT_REVIEWER_API_KEY or stored credentials",
			);
		}
		const finalizerAuth = await ctx.modelRegistry.getApiKeyAndHeaders(finalizerModel);
		if (!finalizerAuth.ok) {
			throw new Error(`GLM requirement Finalizer auth failed: ${finalizerAuth.error}`);
		}
		if (!finalizerAuth.apiKey) {
			throw new Error(
				"GLM requirement Finalizer requires PI_REQUIREMENT_RELEASE_API_KEY or stored credentials",
			);
		}
		const result = await runPiNativeRequirementReview({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			prompts,
			finalizerRuntime: {
				model: finalizerModel,
				streamFunction: piNativeFinalizerStreamFunction,
				apiKey: finalizerAuth.apiKey,
				headers: finalizerAuth.headers,
				env: finalizerAuth.env,
			},
			witnessRuntime: {
				model: witnessModel,
				streamFunction: piNativeWitnessStreamFunction,
				apiKey: witnessAuth.apiKey,
				headers: witnessAuth.headers,
				env: witnessAuth.env,
			},
			signal,
			onProgress: (progress) => {
				onUpdate?.({
					content: [{ type: "text", text: `${progress.role}: ${progress.tool}` }],
					details: progress,
				});
			},
		});
		const ranges = result.finalRanges.length > 0 ? result.finalRanges.join(", ") : "(null)";
		return {
			content: [
				{
					type: "text",
					text: `Pi-native Word requirement review ${result.status}. Final ranges: ${ranges}. Calls: ${result.budget.providerCalls}. Reason: ${result.reason}`,
				},
			],
			details: result,
		};
	},
});

const openAiCompletionsStreamFunction: StreamFn = (model, context, options) => {
	if (model.api !== "openai-completions") {
		throw new Error(`Word requirement review requires openai-completions, received ${model.api}`);
	}
	const { reasoning, ...streamOptions } = options ?? {};
	const tools = context.tools ?? [];
	const toolChoice =
		tools.length === 0
			? ("none" as const)
			: tools.length === 1
				? ({ type: "function", function: { name: tools[0].name } } as const)
				: ("required" as const);
	return stream(model as Model<"openai-completions">, context, {
		...streamOptions,
		toolChoice,
		parallelToolCalls: false,
		reasoningEffort: reasoning === "off" ? undefined : reasoning,
	});
};

export default function (pi: ExtensionAPI) {
	pi.registerProvider(REVIEWER_PROVIDER, {
		name: "Pi Word Requirement Reviewer Doubao Pro",
		baseUrl: process.env.PI_REQUIREMENT_REVIEWER_BASE_URL || DEFAULT_REVIEWER_BASE_URL,
		apiKey: "$PI_REQUIREMENT_REVIEWER_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: REVIEWER_MODEL_ID,
				name: "Doubao Seed 2.0 Pro (Word Requirement Reviewer)",
				api: "openai-completions",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256_000,
				maxTokens: 12_000,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					thinkingFormat: "deepseek",
				},
			},
		],
	});
	pi.registerProvider(RELEASE_PROVIDER, {
		name: "Pi Word Requirement Release GLM",
		baseUrl: process.env.PI_REQUIREMENT_RELEASE_BASE_URL || DEFAULT_RELEASE_BASE_URL,
		apiKey: "$PI_REQUIREMENT_RELEASE_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: RELEASE_MODEL_ID,
				name: "GLM 5.2 (Word Requirement Release)",
				api: "openai-completions",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1_000_000,
				maxTokens: 32_000,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					thinkingFormat: "zai",
					zaiToolStream: true,
				},
			},
		],
	});
	pi.registerTool(requirementReviewTool);
	pi.registerTool(piNativeRequirementReviewTool);
}

async function loadRequirementReviewPacket(
	packetPathInput: string,
	cwd: string,
): Promise<{ packetPath: string; packetSha256: string; packet: RequirementReviewPacket }> {
	const normalizedPath = packetPathInput.startsWith("@")
		? packetPathInput.slice(1)
		: packetPathInput;
	const packetPath = isAbsolute(normalizedPath) ? resolve(normalizedPath) : resolve(cwd, normalizedPath);
	const packetStat = await stat(packetPath);
	if (!packetStat.isFile()) throw new Error("requirement review packet path is not a file");
	if (packetStat.size > MAX_PACKET_BYTES) {
		throw new Error("requirement review packet exceeds the 20 MiB limit");
	}
	const packetText = await readFile(packetPath, "utf8");
	let packetValue: unknown;
	try {
		packetValue = JSON.parse(packetText);
	} catch (error) {
		throw new Error(
			`requirement review packet is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return {
		packetPath,
		packetSha256: sha256(packetText),
		packet: parseRequirementReviewPacket(packetValue),
	};
}

function validateReviewerDecision(
	raw: RawReviewerDecision,
	candidateBlockIds: readonly number[],
	availableBlockIds: ReadonlySet<number>,
	blocks: readonly RequirementReviewBlock[],
): ReviewerDecision {
	if (raw.verdict === "pass") {
		if (
			(raw.source_role === "non_procurement" || raw.instantiation === "absent") &&
			candidateBlockIds.length > 0
		) {
			throw new Error("Reviewer terminal null decision cannot pass a non-empty candidate");
		}
		if (
			raw.issue_type !== "none" ||
			raw.add_ranges.length > 0 ||
			raw.removal.mode !== "exact" ||
			raw.removal.remove_ranges.length > 0
		) {
			throw new Error("Reviewer pass must use issue_type none and empty change ranges");
		}
		return {
			verdict: "pass",
			sourceRole: raw.source_role,
			instantiation: raw.instantiation,
			reason: raw.reason,
		};
	}
	let issueType = raw.issue_type === "none" ? "unspecified" : raw.issue_type;
	const candidate = new Set(candidateBlockIds);
	const submittedAdditions = parseStrictRanges(raw.add_ranges, availableBlockIds);
	const submittedPreservations =
		raw.removal.mode === "candidate_complement"
			? parseStrictRanges(raw.removal.preserve_ranges, availableBlockIds)
			: { ranges: [], blockIds: [] };
	const preserveBlockIds = submittedPreservations.blockIds.filter((blockId) => candidate.has(blockId));
	const preservations = {
		ranges: compactBlockRanges(preserveBlockIds),
		blockIds: preserveBlockIds,
	};
	let submittedRemovals: ParsedRanges;
	if (raw.removal.mode === "exact") {
		submittedRemovals = parseStrictRanges(raw.removal.remove_ranges, availableBlockIds);
	} else {
		if (submittedPreservations.blockIds.length > 0 && preservations.blockIds.length === 0) {
			throw new Error("Reviewer non-empty preserve ranges are entirely outside Candidate");
		}
		const preservedBlockIds = new Set(preservations.blockIds);
		const complementBlockIds = candidateBlockIds.filter((blockId) => !preservedBlockIds.has(blockId));
		submittedRemovals = {
			ranges: compactBlockRanges(complementBlockIds),
			blockIds: complementBlockIds,
		};
	}
	const addBlockIds = submittedAdditions.blockIds.filter((blockId) => !candidate.has(blockId));
	const removeBlockIds = submittedRemovals.blockIds.filter((blockId) => candidate.has(blockId));
	if (issueType === "operational_precision" && addBlockIds.length > 0) {
		issueType = "unspecified";
	}
	if (
		(raw.source_role === "non_procurement" || raw.instantiation === "absent") &&
		(addBlockIds.length > 0 || removeBlockIds.length !== candidateBlockIds.length)
	) {
		throw new Error(
			"Reviewer terminal null decision must remove the complete Candidate and cannot add blocks",
		);
	}
	if (addBlockIds.length === 0 && removeBlockIds.length === 0) {
		return {
			verdict: "noop_challenge",
			sourceRole: raw.source_role,
			instantiation: raw.instantiation,
			issueType,
			submittedAddRanges: submittedAdditions.ranges,
			removeMode: raw.removal.mode,
			submittedRemoveRanges: submittedRemovals.ranges,
			submittedPreserveRanges: submittedPreservations.ranges,
			preserveRanges: preservations.ranges,
			reason: raw.reason,
		};
	}
	if (issueType === "operational_precision") {
		const removeBlockIdSet = new Set(removeBlockIds);
		const candidateCharacterCount = blocks.reduce(
			(sum, block) => sum + (candidate.has(block.blockId) ? block.text.length : 0),
			0,
		);
		const removeCharacterCount = blocks.reduce(
			(sum, block) => sum + (removeBlockIdSet.has(block.blockId) ? block.text.length : 0),
			0,
		);
		const removalRatio =
			candidateCharacterCount === 0 ? 0 : removeCharacterCount / candidateCharacterCount;
		if (removalRatio < MIN_OPERATIONAL_PRECISION_CANDIDATE_CHARACTER_RATIO) {
			return {
				verdict: "noop_challenge",
				sourceRole: raw.source_role,
				instantiation: raw.instantiation,
				issueType,
				submittedAddRanges: submittedAdditions.ranges,
				removeMode: raw.removal.mode,
				submittedRemoveRanges: submittedRemovals.ranges,
				submittedPreserveRanges: submittedPreservations.ranges,
				preserveRanges: preservations.ranges,
				reason: `Operational precision removal covers ${removalRatio.toFixed(4)} of Candidate characters, below the ${MIN_OPERATIONAL_PRECISION_CANDIDATE_CHARACTER_RATIO.toFixed(2)} mechanical materiality floor; candidate preserved.`,
			};
		}
	}
	return {
		verdict: "challenge",
		sourceRole: raw.source_role,
		instantiation: raw.instantiation,
		issueType,
		addRanges: compactBlockRanges(addBlockIds),
		removeMode: raw.removal.mode,
		removeRanges: compactBlockRanges(removeBlockIds),
		submittedPreserveRanges: submittedPreservations.ranges,
		preserveRanges: preservations.ranges,
		addBlockIds,
		removeBlockIds,
		preserveBlockIds: preservations.blockIds,
		reason: raw.reason,
	};
}

function normalizeReviewerSubmission(value: unknown, candidateIsNonEmpty: boolean): unknown {
	if (!isRecord(value)) return value;
	if (value.verdict === "pass") {
		const sourceRole = normalizeReviewerEnum(
			value.source_role,
			reviewerSourceRoles,
			"source_role",
		);
		const instantiation = normalizeReviewerEnum(
			value.instantiation,
			["present", "absent"],
			"instantiation",
		);
		if (
			candidateIsNonEmpty &&
			(sourceRole === "non_procurement" || instantiation === "absent")
		) {
			const normalizedReason = normalizeBoundedReason(value.reason, 1_200);
			return {
				verdict: "challenge",
				source_role: sourceRole,
				instantiation,
				issue_type: "false_non_null",
				add_ranges: [],
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason:
					typeof normalizedReason === "string" && normalizedReason.length > 0
						? normalizedReason
						: "Reviewer returned a terminal null classification for a non-empty Candidate.",
			};
		}
		const nestedRemoval = isRecord(value.removal) ? value.removal : null;
		if (
			("add_ranges" in value && (!Array.isArray(value.add_ranges) || value.add_ranges.length > 0)) ||
			(nestedRemoval !== null &&
				(nestedRemoval.mode !== "exact" ||
					("remove_ranges" in nestedRemoval &&
						(!Array.isArray(nestedRemoval.remove_ranges) ||
							nestedRemoval.remove_ranges.length > 0)) ||
					("preserve_ranges" in nestedRemoval &&
						(!Array.isArray(nestedRemoval.preserve_ranges) ||
							nestedRemoval.preserve_ranges.length > 0)))) ||
			("remove_mode" in value && value.remove_mode !== "exact") ||
			("remove_ranges" in value &&
				(!Array.isArray(value.remove_ranges) || value.remove_ranges.length > 0)) ||
			("preserve_ranges" in value &&
				(!Array.isArray(value.preserve_ranges) || value.preserve_ranges.length > 0))
		) {
			return value;
		}
		const normalizedReason = normalizeBoundedReason(value.reason, 1_200);
		const reason =
			typeof normalizedReason === "string" && normalizedReason.length > 0
				? normalizedReason
				: "Reviewer explicitly returned pass without a contract-valid reason; candidate preserved.";
		return {
			verdict: "pass",
			source_role: sourceRole ?? "buyer_issued",
			instantiation: instantiation ?? "present",
			issue_type: "none",
			add_ranges: [],
			removal: { mode: "exact", remove_ranges: [] },
			reason,
		};
	}
	if (value.verdict !== "challenge") return value;
	let removal: unknown;
	if (isRecord(value.removal)) {
		const removeRanges = normalizeRangeArray(value.removal.remove_ranges ?? []);
		const preserveRanges = normalizeRangeArray(value.removal.preserve_ranges ?? []);
		const hasRemoveRanges = Array.isArray(removeRanges) && removeRanges.length > 0;
		const hasPreserveRanges = Array.isArray(preserveRanges) && preserveRanges.length > 0;
		if (
			(hasRemoveRanges && hasPreserveRanges) ||
			(value.removal.mode === "exact" && hasPreserveRanges) ||
			(value.removal.mode === "candidate_complement" && hasRemoveRanges)
		) {
			return value;
		}
		removal =
			value.removal.mode === "candidate_complement"
				? { mode: value.removal.mode, preserve_ranges: preserveRanges }
				: { mode: value.removal.mode ?? "exact", remove_ranges: removeRanges };
	} else {
		const removeRanges = normalizeRangeArray(value.remove_ranges ?? []);
		const preserveRanges = normalizeRangeArray(value.preserve_ranges ?? []);
		const hasRemoveRanges = Array.isArray(removeRanges) && removeRanges.length > 0;
		const hasPreserveRanges = Array.isArray(preserveRanges) && preserveRanges.length > 0;
		if (hasRemoveRanges && hasPreserveRanges) return value;
		const removeMode = hasPreserveRanges
			? "candidate_complement"
			: hasRemoveRanges
				? "exact"
				: (value.remove_mode ?? "exact");
		removal =
			removeMode === "candidate_complement"
				? { mode: removeMode, preserve_ranges: preserveRanges }
				: { mode: removeMode, remove_ranges: removeRanges };
	}
	return {
		verdict: "challenge",
		source_role: normalizeReviewerEnum(value.source_role, reviewerSourceRoles, "source_role"),
		instantiation: normalizeReviewerEnum(
			value.instantiation,
			["present", "absent"],
			"instantiation",
		),
		issue_type:
			value.issue_type === undefined || value.issue_type === "none"
				? "unspecified"
				: normalizeReviewerEnum(
						value.issue_type,
						[...reviewerIssueTypes, "none"],
						"issue_type",
						"unspecified",
					),
		add_ranges: normalizeRangeArray(value.add_ranges ?? []),
		removal,
		reason: normalizeBoundedReason(value.reason, 1_200),
	};
}

function normalizeReleaseSubmission(value: unknown): unknown {
	if (!isRecord(value)) return value;
	return {
		...value,
		hard_carrier_reason: normalizeBoundedReason(value.hard_carrier_reason, 1_200),
		residual_reason: normalizeBoundedReason(value.residual_reason, 1_200),
		outside_carrier_excluded_ranges: normalizeRangeArray(
			value.outside_carrier_excluded_ranges ?? [],
		),
		accepted_add_ranges: normalizeRangeArray(value.accepted_add_ranges ?? []),
	};
}

function normalizeBoundedReason(value: unknown, maxLength: number): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}

function normalizeRangeArray(value: unknown): unknown {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return value;
	const rawRanges = value as string[];
	if (rawRanges.length === 1 && rawRanges[0].trim() === "[]") return [];
	const hasExplicitPrefix = rawRanges.some((rawRange) => /(?:^|[,，、;；\n]\s*)(?:段落|段)\s*\d/u.test(rawRange));
	const intervals: Array<{ start: number; end: number }> = [];
	for (const rawRange of rawRanges) {
		const pieces = rawRange
			.split(/[,，、;；\n]+/u)
			.map((piece) => piece.trim())
			.filter(Boolean);
		if (pieces.length === 0) continue;
		for (const piece of pieces) {
			const match = /^(?:(段落|段)\s*)?(\d+)\s*(?:(?:-|—|–|~|～|至)\s*(?:(?:段落|段)\s*)?(\d+))?$/.exec(
				piece,
			);
			if (!match || (!match[1] && !hasExplicitPrefix)) return value;
			const start = Number(match[2]);
			const end = Number(match[3] ?? match[2]);
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return value;
			intervals.push({ start, end });
		}
	}
	intervals.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: Array<{ start: number; end: number }> = [];
	for (const interval of intervals) {
		const previous = merged.at(-1);
		if (previous && interval.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, interval.end);
			continue;
		}
		merged.push({ ...interval });
	}
	return merged.map(({ start, end }) =>
		start === end ? `段落${start}` : `段落${start}-段落${end}`,
	);
}

function normalizeReviewerEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fieldName: string,
	fallback?: T,
): T | unknown {
	const prefix = `${fieldName}=`;
	const candidates = Array.isArray(value)
		? value.length === 1
			? value
			: []
		: isRecord(value)
			? Object.entries(value).flatMap(([key, child]) => {
					const selectedEnumKey =
						allowed.some((option) => option === key) &&
						child !== false &&
						child !== null &&
						child !== undefined;
					return selectedEnumKey ? [key, child] : [child];
				})
			: [value];
	const matches = new Set<T>();
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const trimmed = candidate.trim();
		const normalized = trimmed.startsWith(prefix)
			? trimmed.slice(prefix.length).trim()
			: trimmed;
		for (const option of allowed) {
			if (
				normalized === option ||
				normalized.startsWith(`${option}:`) ||
				normalized.startsWith(`${option};`) ||
				normalized.startsWith(`${option},`)
			) {
				matches.add(option);
			}
		}
	}
	if (matches.size === 1) return [...matches][0];
	return fallback ?? value;
}

function validateReleaseDecision(
	raw: RawReleaseDecision,
	candidateBlockIds: readonly number[],
	allowedAddBlockIds: readonly number[],
	removeEnvelopeBlockIds: readonly number[],
	availableBlockIds: ReadonlySet<number>,
	hardBoundaryResidualPrecisionMode: HardBoundaryResidualPrecisionMode,
	allowReviewerNoChangeTerminalVeto: boolean,
): ReleaseDecision {
	const submittedOutsideCarrierExclusions = parseStrictRanges(
		raw.outside_carrier_excluded_ranges,
		availableBlockIds,
	);
	const submittedAcceptedAdditions = parseStrictRanges(
		raw.accepted_add_ranges,
		availableBlockIds,
	);
	const candidate = new Set(candidateBlockIds);
	const allowedAdd = new Set(allowedAddBlockIds);
	const authorizedHardProjection = new Set([...candidateBlockIds, ...allowedAddBlockIds]);
	const claimedHardBlockIds = new Set<number>();
	const hardRootClaims: ReleaseHardRootClaim[] = [];
	for (const [index, claim] of raw.hard_root_claims.entries()) {
		if (!availableBlockIds.has(claim.root_block_id)) {
			throw new Error(
				`hard root claim validation failed at index ${index}: root block ${claim.root_block_id} is unavailable`,
			);
		}
		if (
			claim.exit_block_id_exclusive !== null &&
			(!availableBlockIds.has(claim.exit_block_id_exclusive) ||
				claim.exit_block_id_exclusive <= claim.root_block_id)
		) {
			throw new Error(
				`hard root claim validation failed at index ${index}: invalid exclusive block span`,
			);
		}
		const projectedBlockIds = [...authorizedHardProjection]
			.filter(
				(blockId) =>
					blockId >= claim.root_block_id &&
					(claim.exit_block_id_exclusive === null ||
						blockId < claim.exit_block_id_exclusive),
			)
			.sort((left, right) => left - right);
		if (projectedBlockIds.length === 0) {
			throw new Error(
				`hard root claim validation failed at index ${index}: claim has no authorized Candidate/add projection`,
			);
		}
		for (const blockId of projectedBlockIds) {
			if (claimedHardBlockIds.has(blockId)) {
				throw new Error(
					`hard root claim validation failed at index ${index}: projected block ${blockId} conflicts with another claim`,
				);
			}
			claimedHardBlockIds.add(blockId);
		}
		hardRootClaims.push({
			carrierType: claim.carrier_type,
			rootBlockId: claim.root_block_id,
			exitBlockIdExclusive: claim.exit_block_id_exclusive,
			projectedRanges: compactBlockRanges(projectedBlockIds),
		});
	}
	const hardExcludedBlockIds = [...claimedHardBlockIds].sort((left, right) => left - right);
	const acceptedAddBlockIds = submittedAcceptedAdditions.blockIds.filter((blockId) =>
		allowedAdd.has(blockId),
	);
	const acceptedAdd = new Set(acceptedAddBlockIds);
	if (hardExcludedBlockIds.some((blockId) => acceptedAdd.has(blockId))) {
		throw new Error(
			"hard root claim validation failed: hard exclusions conflict with accepted additions",
		);
	}
	const hardExcluded = new Set(hardExcludedBlockIds);
	if (submittedOutsideCarrierExclusions.blockIds.some((blockId) => hardExcluded.has(blockId))) {
		throw new Error(
			"hard root claim validation failed: hard exclusions conflict with outside-carrier exclusions",
		);
	}
	const removeEnvelope = new Set(removeEnvelopeBlockIds);
	const hardBoundaryResidualUnlocked =
		hardBoundaryResidualPrecisionMode === "full_removal_safety" ||
		(hardBoundaryResidualPrecisionMode === "reviewer_confirmed_hard" &&
			hardExcludedBlockIds.some((blockId) => removeEnvelope.has(blockId)));
	const hardBoundaryResidualAuthorityBlockIds = hardBoundaryResidualUnlocked
		? deriveUniqueCandidateResidualAuthority(candidateBlockIds, hardExcludedBlockIds)
		: [];
	const submittedOutsideCarrierExclusion = new Set(
		submittedOutsideCarrierExclusions.blockIds,
	);
	const reviewerNoChangeTerminalVetoAuthorized =
		allowReviewerNoChangeTerminalVeto &&
		candidateBlockIds.length > 0 &&
		submittedOutsideCarrierExclusion.size === candidateBlockIds.length &&
		candidateBlockIds.every((blockId) => submittedOutsideCarrierExclusion.has(blockId));
	const authorizedOutsideChange = new Set([
		...removeEnvelopeBlockIds,
		...allowedAddBlockIds,
		...hardBoundaryResidualAuthorityBlockIds,
		...(reviewerNoChangeTerminalVetoAuthorized ? candidateBlockIds : []),
	]);
	const outsideCarrierExcludedBlockIds = submittedOutsideCarrierExclusions.blockIds.filter(
		(blockId) =>
			authorizedOutsideChange.has(blockId) &&
			!acceptedAdd.has(blockId) &&
			!hardExcluded.has(blockId),
	);
	const explicitlyExcluded = new Set([
		...hardExcludedBlockIds,
		...outsideCarrierExcludedBlockIds,
	]);
	const restoredRemoveBlockIds = removeEnvelopeBlockIds.filter(
		(blockId) => !explicitlyExcluded.has(blockId),
	);
	const excludedCandidate = new Set(
		[...hardExcludedBlockIds, ...outsideCarrierExcludedBlockIds].filter((blockId) =>
			candidate.has(blockId),
		),
	);
	const orderedFinalBlockIds = [
		...candidateBlockIds.filter((blockId) => !excludedCandidate.has(blockId)),
		...acceptedAddBlockIds,
	].sort((left, right) => left - right);
	const finalRanges = compactBlockRanges(orderedFinalBlockIds);
	const unchanged =
		orderedFinalBlockIds.length === candidateBlockIds.length &&
		orderedFinalBlockIds.every((blockId, index) => blockId === candidateBlockIds[index]);
	return {
		verdict: unchanged ? "reject" : "publish",
		hardCarrierReason: raw.hard_carrier_reason,
		hardRootClaims,
		restoredRemoveRanges: compactBlockRanges(restoredRemoveBlockIds),
		hardExcludedRanges: compactBlockRanges(hardExcludedBlockIds),
		residualReason: raw.residual_reason,
		submittedOutsideCarrierExcludedRanges: submittedOutsideCarrierExclusions.ranges,
		outsideCarrierExcludedRanges: compactBlockRanges(outsideCarrierExcludedBlockIds),
		hardBoundaryResidualAuthorityRanges: compactBlockRanges(
			hardBoundaryResidualAuthorityBlockIds,
		),
		submittedAcceptedAddRanges: submittedAcceptedAdditions.ranges,
		acceptedAddRanges: compactBlockRanges(acceptedAddBlockIds),
		finalRanges,
		finalBlockIds: orderedFinalBlockIds,
		reason: `${raw.hard_carrier_reason}\n\n${raw.residual_reason}`,
	};
}

async function structuredCall<TSchemaType extends TSchema, TResult>(
	input: StructuredCallOptions<TSchemaType, TResult>,
): Promise<StructuredCallResult<TResult>> {
	let parsed: TResult | undefined;
	let parseError: unknown;
	let contractError: string | null = null;
	const inputSha256 = structuredInputSha256(input);
	const submitTool: AgentTool<TSchemaType, Record<string, unknown>> = {
		name: input.toolName,
		label: input.toolLabel,
		description: input.toolDescription,
		parameters: input.schema,
		executionMode: "sequential",
		prepareArguments(args) {
			const normalizedArgs = input.normalize?.(args) ?? args;
			if (!Value.Check(input.schema, normalizedArgs)) {
				contractError = Value.Errors(input.schema, normalizedArgs)
					.slice(0, 8)
					.map((error) => `${error.instancePath || "/"}: ${error.message}`)
					.join("; ");
				throw new Error(`strict schema mismatch: ${contractError}`);
			}
			return normalizedArgs as Static<TSchemaType>;
		},
		async execute(_toolCallId, params) {
			try {
				parsed = input.parse(params);
				return terminalResult({ ok: true, status: "accepted" });
			} catch (error) {
				parseError = error;
				contractError = errorMessage(error);
				throw error;
			}
		},
	};
	const startedAt = Date.now();
	const messages = await runAgentLoop(
		userMessage(input.userPrompt),
		{
			systemPrompt: `${input.systemPrompt.trim()}\n\n运行时合同：只调用唯一工具 ${input.toolName}；不得输出自由文本，没有读取、搜索、纠错或重试轮次。`,
			messages: [],
			tools: [submitTool],
		},
		{
			model: input.model,
			temperature: 0,
			maxTokens: input.maxTokens,
			reasoning:
				input.model.reasoning === true
					? input.role === "reviewer"
						? REVIEWER_THINKING_LEVEL
						: RELEASE_THINKING_LEVEL
					: undefined,
			apiKey: input.apiKey,
			headers: input.headers,
			env: input.env,
			timeoutMs: input.requestTimeoutMs,
			maxRetries: 0,
			toolExecution: "sequential",
			convertToLlm: convertMessages,
			shouldStopAfterTurn: () => true,
		},
		(event) => {
			if (event.type !== "turn_end" || event.message.role !== "assistant") return;
			recordUsage(input.usage[input.role], event.message.usage);
			assertUsageBudget(input.usage);
			input.onProgress?.({ role: input.role, tool: input.toolName });
		},
		input.signal,
		(model, context, streamOptions) => {
			if (totalUsage(input.usage).providerCalls >= MAX_PROVIDER_CALLS) {
				throw new Error("requirement review provider-call budget exhausted");
			}
			input.usage[input.role].providerCalls += 1;
			return input.streamFunction(model, context, streamOptions);
		},
	);
	input.usage[input.role].elapsedMs += Date.now() - startedAt;
	const last = lastAssistant(messages);
	if (last?.stopReason === "error" || last?.stopReason === "aborted") {
		throw new Error(`${input.role} provider failed: ${last.errorMessage ?? last.stopReason}`);
	}
	const terminalCalls = matchingToolCalls(messages, input.toolName);
	const terminalCallCount = terminalCalls.length;
	if (terminalCallCount === 1 && parsed !== undefined) {
		return { decision: parsed, inputSha256, submissionMode: "tool_call" };
	}
	if (terminalCallCount === 1 && last?.stopReason === "length") {
		const normalizedArgs = input.normalize?.(terminalCalls[0].arguments) ?? terminalCalls[0].arguments;
		if (Value.Check(input.schema, normalizedArgs)) {
			try {
				return {
					decision: input.parse(normalizedArgs as Static<TSchemaType>),
					inputSha256,
					submissionMode: "tool_call",
				};
			} catch (error) {
				throw new Error(
					`${input.role} length-stopped tool decision failed mechanical validation: ${errorMessage(error)}`,
				);
			}
		}
	}
	if (parseError !== undefined) {
		throw new Error(`${input.role} decision failed mechanical validation: ${errorMessage(parseError)}`);
	}
	if (terminalCallCount > 1) {
		throw new Error(`${input.role} must submit one terminal decision; received ${terminalCallCount} tool calls`);
	}
	if (terminalCallCount === 0 && last) {
		const jsonTerminal = assistantJsonTerminal(last);
		if (jsonTerminal !== null) {
			let raw: unknown;
			try {
				raw = JSON.parse(jsonTerminal.text);
			} catch (error) {
				throw new Error(`${input.role} JSON-text terminal is not valid JSON: ${errorMessage(error)}`);
			}
			const normalizedRaw = input.normalize?.(raw) ?? raw;
			if (!Value.Check(input.schema, normalizedRaw)) {
				const errors = Value.Errors(input.schema, normalizedRaw)
					.slice(0, 8)
					.map((error) => `${error.instancePath || "/"}: ${error.message}`)
					.join("; ");
				throw new Error(`${input.role} JSON-text terminal schema mismatch: ${errors}`);
			}
			try {
				return {
					decision: input.parse(normalizedRaw as Static<TSchemaType>),
					inputSha256,
					submissionMode: jsonTerminal.submissionMode,
				};
			} catch (error) {
				throw new Error(
					`${input.role} JSON-text decision failed mechanical validation: ${errorMessage(error)}`,
				);
			}
		}
	}
	throw new Error(
		`${input.role} must submit one terminal tool call or one complete schema-valid JSON value: ${contractError ?? "terminal decision not accepted"}`,
	);
}

function buildStructureMap(
	evidence: RequirementReviewStructureEvidence | undefined,
	candidateBlockIds: ReadonlySet<number>,
	blocks: readonly RequirementReviewBlock[],
): StructureMap {
	if (!evidence) {
		const source =
			"structure evidence unavailable; use the complete source text and do not infer missing hierarchy metadata";
		return {
			provided: false,
			entryCount: 0,
			exactMatchCount: 0,
			renderedNodeCount: 0,
			renderedCharacterCount: source.length,
			coverage: "unavailable",
			source,
			renderedRows: [],
		};
	}

	const entryByBlockId = new Map(evidence.entries.map((entry) => [entry.blockId, entry]));
	const textByBlockId = new Map(blocks.map((block) => [block.blockId, block.text]));
	const candidateBoundaries = new Set<number>();
	const orderedCandidateBlockIds = [...candidateBlockIds].sort((left, right) => left - right);
	let runStart: number | null = null;
	let previous: number | null = null;
	for (const blockId of orderedCandidateBlockIds) {
		if (runStart === null || previous === null || blockId !== previous + 1) {
			if (runStart !== null && previous !== null) {
				candidateBoundaries.add(runStart);
				candidateBoundaries.add(previous);
			}
			runStart = blockId;
		}
		previous = blockId;
	}
	if (runStart !== null && previous !== null) {
		candidateBoundaries.add(runStart);
		candidateBoundaries.add(previous);
	}
	for (const blockId of [...candidateBoundaries]) {
		candidateBoundaries.add(blockId - 1);
		candidateBoundaries.add(blockId + 1);
	}

	const firstEntry = evidence.entries[0];
	const lastEntry = evidence.entries.at(-1);
	const priorityBoundaryBlockIds = new Set(candidateBoundaries);
	priorityBoundaryBlockIds.add(firstEntry.blockId);
	if (lastEntry) priorityBoundaryBlockIds.add(lastEntry.blockId);
	const boundaryEntries = [...priorityBoundaryBlockIds]
		.map((blockId) => entryByBlockId.get(blockId))
		.filter((entry): entry is RequirementReviewStructureEntry => entry !== undefined)
		.sort((left, right) => left.blockId - right.blockId);
	const outlineEntries = evidence.entries.filter((entry) => entry.outlineLevel !== null);
	const outlineNavigation = buildOutlineNavigation(evidence.entries);
	const visualNavigation = buildVisualNavigation(evidence.entries);
	const tableEntries = evidence.entries.filter((entry) => entry.kind === "table");
	const formattingEntries = evidence.entries.filter(
		(entry) =>
			entry.boldRatio >= 0.8 ||
			entry.alignment === "center" ||
			entry.pageBreakBefore,
	);
	const poolByBlockId = new Map<number, RequirementReviewStructureEntry>();
	for (const entry of [
		...boundaryEntries,
		...outlineEntries,
		...tableEntries,
		...formattingEntries,
	]) {
		poolByBlockId.set(entry.blockId, entry);
	}
	const pool = [...poolByBlockId.values()].sort((left, right) => left.blockId - right.blockId);
	const header = [
		"structureMapSelection=content-blind candidate-boundary neighbors plus paragraph/table, outline, bold, centered, and page-break nodes; omitted ordinary nodes carry no negative meaning",
		"structureMapLegend=S|blockId|b=Word body index|k=p/t|m=x exact or h high alignment|sty=style|ol=outline level|num=numbering level|pb=page break before|kn=keep-next|a=alignment|br=bold ratio|fs=half-point font sizes|path=outline level@source block|sc=active outline scope@nearest shallower parent~first later same-or-shallower exit, with - for no parent and E for EOF|vc=non-outline visual heading candidate@mechanical parent~next equal-or-larger visual peer, with - for no parent and E for EOF; vc is navigation only, never a confirmed heading or Owner|tbl=rows/cells/paragraphs|tx=exact canonical source prefix selected without reading its meaning",
	].join("\n");
	const completeRows = pool.map((entry) => ({
		blockId: entry.blockId,
		text: renderStructureEntry(
			entry,
			outlineNavigation,
			visualNavigation,
			textByBlockId.get(entry.blockId) ?? "",
		),
	}));
	const completeSource = [header, ...completeRows.map((row) => row.text)].join("\n");
	if (
		pool.length <= MAX_STRUCTURE_MAP_NODES &&
		completeSource.length <= MAX_STRUCTURE_MAP_CHARACTERS
	) {
		return {
			provided: true,
			entryCount: evidence.entries.length,
			exactMatchCount: evidence.exactMatchCount,
			renderedNodeCount: pool.length,
			renderedCharacterCount: completeSource.length,
			coverage: "complete",
			source: completeSource,
			renderedRows: completeRows,
		};
	}

	const selected = new Map<number, string>();
	let renderedCharacterCount = header.length;
	for (const tier of [boundaryEntries, outlineEntries, tableEntries, formattingEntries]) {
		for (const index of spreadIndexes(tier.length)) {
			const entry = tier[index];
			if (selected.has(entry.blockId)) continue;
			const row = renderStructureEntry(
				entry,
				outlineNavigation,
				visualNavigation,
				textByBlockId.get(entry.blockId) ?? "",
			);
			if (
				selected.size >= MAX_STRUCTURE_MAP_NODES ||
				renderedCharacterCount + 1 + row.length > MAX_STRUCTURE_MAP_CHARACTERS
			) {
				continue;
			}
			selected.set(entry.blockId, row);
			renderedCharacterCount += 1 + row.length;
		}
	}
	const selectedRows = [...selected]
		.sort(([left], [right]) => left - right)
		.map(([blockId, text]) => ({ blockId, text }));
	const source = [header, ...selectedRows.map((row) => row.text)].join("\n");
	return {
		provided: true,
		entryCount: evidence.entries.length,
		exactMatchCount: evidence.exactMatchCount,
		renderedNodeCount: selectedRows.length,
		renderedCharacterCount: source.length,
		coverage: selectedRows.length === pool.length ? "complete" : "partial",
		source,
		renderedRows: selectedRows,
	};
}

function buildOutlineNavigation(
	entries: readonly RequirementReviewStructureEntry[],
): ReadonlyMap<number, StructureOutlineNavigation> {
	const navigation = new Map<number, StructureOutlineNavigation>();
	const openHeadings: RequirementReviewStructureEntry[] = [];
	for (const entry of entries) {
		if (entry.outlineLevel === null) continue;
		while (
			openHeadings.length > 0 &&
			(openHeadings.at(-1)?.outlineLevel ?? -1) >= entry.outlineLevel
		) {
			const closed = openHeadings.pop();
			if (!closed) break;
			const current = navigation.get(closed.blockId);
			if (current) navigation.set(closed.blockId, { ...current, exitBlockId: entry.blockId });
		}
		const parent = [...entry.outlinePath]
			.reverse()
			.find((node) => node.level < entry.outlineLevel);
		navigation.set(entry.blockId, {
			parentBlockId: parent?.blockId ?? null,
			exitBlockId: null,
		});
		openHeadings.push(entry);
	}
	return navigation;
}

function buildVisualNavigation(
	entries: readonly RequirementReviewStructureEntry[],
): ReadonlyMap<number, StructureVisualNavigation> {
	const entryByBlockId = new Map(entries.map((entry) => [entry.blockId, entry]));
	const candidates = entries.filter(
		(entry) =>
			entry.kind === "paragraph" &&
			entry.fontSizes.length > 0 &&
			(entry.outlineLevel !== null ||
				entry.boldRatio >= 0.8 ||
				entry.alignment === "center" ||
				entry.pageBreakBefore),
	);
	const navigation = new Map<number, StructureVisualNavigation>();
	for (let index = 0; index < candidates.length; index += 1) {
		const entry = candidates[index];
		if (entry.outlineLevel !== null) continue;
		const fontSize = Math.max(...entry.fontSizes);
		const outlineParentBlockId = entry.outlinePath.at(-1)?.blockId ?? null;
		let parentBlockId = outlineParentBlockId;
		if (parentBlockId === null) {
			for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
				const previous = candidates[previousIndex];
				if (Math.max(...previous.fontSizes) <= fontSize) continue;
				parentBlockId = previous.blockId;
				break;
			}
		}
		const activeOutlineBlockId = entry.outlinePath.at(-1)?.blockId ?? null;
		let exitBlockId: number | null = null;
		for (let nextIndex = index + 1; nextIndex < candidates.length; nextIndex += 1) {
			const next = candidates[nextIndex];
			const nextActiveOutlineBlockId =
				next.outlineLevel !== null ? next.blockId : (next.outlinePath.at(-1)?.blockId ?? null);
			if (
				Math.max(...next.fontSizes) >= fontSize ||
				(activeOutlineBlockId !== null && nextActiveOutlineBlockId !== activeOutlineBlockId)
			) {
				exitBlockId = next.blockId;
				break;
			}
		}
		if (parentBlockId !== null && !entryByBlockId.has(parentBlockId)) parentBlockId = null;
		navigation.set(entry.blockId, { parentBlockId, exitBlockId });
	}
	return navigation;
}

function renderStructureEntry(
	entry: RequirementReviewStructureEntry,
	outlineNavigation: ReadonlyMap<number, StructureOutlineNavigation>,
	visualNavigation: ReadonlyMap<number, StructureVisualNavigation>,
	sourceText: string,
): string {
	const fields = [
		`b=${entry.bodyIndex}`,
		`k=${entry.kind === "paragraph" ? "p" : "t"}`,
		`m=${entry.matchConfidence === "exact" ? "x" : "h"}`,
	];
	if (entry.styleName) fields.push(`sty=${JSON.stringify(entry.styleName)}`);
	else if (entry.styleId) fields.push(`sty=${JSON.stringify(entry.styleId)}`);
	if (entry.outlineLevel !== null) fields.push(`ol=${entry.outlineLevel}`);
	if (entry.numberingLevel !== null) fields.push(`num=${entry.numberingLevel}`);
	if (entry.pageBreakBefore) fields.push("pb=1");
	if (entry.keepNext) fields.push("kn=1");
	if (entry.alignment) fields.push(`a=${entry.alignment}`);
	if (entry.boldRatio > 0) fields.push(`br=${entry.boldRatio.toFixed(3)}`);
	if (entry.fontSizes.length > 0) fields.push(`fs=${entry.fontSizes.join("/")}`);
	if (entry.outlinePath.length > 0) {
		fields.push(
			`path=${entry.outlinePath.map((node) => `${node.level}@${node.blockId}`).join(">")}`,
		);
	}
	const activeScopeBlockId =
		entry.outlineLevel !== null ? entry.blockId : (entry.outlinePath.at(-1)?.blockId ?? null);
	const activeScope =
		activeScopeBlockId === null ? undefined : outlineNavigation.get(activeScopeBlockId);
	if (entry.table) {
		fields.push(
			`tbl=${entry.table.rowCount}/${entry.table.cellCount}/${entry.table.paragraphCount}`,
		);
	}
	if (activeScopeBlockId !== null && activeScope) {
		fields.push(
			`sc=${activeScopeBlockId}@${activeScope.parentBlockId ?? "-"}~${activeScope.exitBlockId ?? "E"}`,
		);
	}
	const visualCandidate = visualNavigation.get(entry.blockId);
	if (visualCandidate) {
		fields.push(
			`vc=${entry.blockId}@${visualCandidate.parentBlockId ?? "-"}~${visualCandidate.exitBlockId ?? "E"}`,
		);
	}
	const textPreview = sourceText
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, MAX_STRUCTURE_TEXT_PREVIEW_CHARACTERS);
	if (textPreview) fields.push(`tx=${JSON.stringify(textPreview)}`);
	return `S|${entry.blockId}|${fields.join("|")}`;
}

function spreadIndexes(length: number): number[] {
	if (length === 0) return [];
	const indexes: number[] = [];
	const seen = new Set<number>();
	for (let denominator = 1; indexes.length < length; denominator *= 2) {
		for (let numerator = 0; numerator <= denominator; numerator += 1) {
			const index = Math.round(((length - 1) * numerator) / denominator);
			if (seen.has(index)) continue;
			seen.add(index);
			indexes.push(index);
		}
	}
	return indexes;
}

function collectCandidateBoundaryWindowBlockIds(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
): Set<number> {
	const blockIds = new Set<number>();
	for (let index = 0; index < blocks.length; index += 1) {
		if (!candidateBlockIds.has(blocks[index].blockId)) continue;
		const previousIsCandidate =
			index > 0 && candidateBlockIds.has(blocks[index - 1].blockId);
		const nextIsCandidate =
			index + 1 < blocks.length && candidateBlockIds.has(blocks[index + 1].blockId);
		if (previousIsCandidate && nextIsCandidate) continue;
		for (
			let neighborIndex = Math.max(0, index - REVIEWER_BOUNDARY_WINDOW_BLOCKS);
			neighborIndex <= Math.min(blocks.length - 1, index + REVIEWER_BOUNDARY_WINDOW_BLOCKS);
			neighborIndex += 1
		) {
			blockIds.add(blocks[neighborIndex].blockId);
		}
	}
	return blockIds;
}

function collectCandidateIntervalEdgeWindowBlockIds(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
): Set<number> {
	const blockIds = new Set<number>();
	let runStartIndex: number | null = null;
	for (let index = 0; index <= blocks.length; index += 1) {
		const isCandidate =
			index < blocks.length && candidateBlockIds.has(blocks[index].blockId);
		if (isCandidate && runStartIndex === null) {
			runStartIndex = index;
			continue;
		}
		if (isCandidate || runStartIndex === null) continue;
		const runEndIndex = index - 1;
		const prefixEndIndex = Math.min(
			runEndIndex,
			runStartIndex + REVIEWER_INTERVAL_EDGE_WINDOW_BLOCKS - 1,
		);
		const suffixStartIndex = Math.max(
			runStartIndex,
			runEndIndex - REVIEWER_INTERVAL_EDGE_WINDOW_BLOCKS + 1,
		);
		for (let blockIndex = runStartIndex; blockIndex <= prefixEndIndex; blockIndex += 1) {
			blockIds.add(blocks[blockIndex].blockId);
		}
		for (let blockIndex = suffixStartIndex; blockIndex <= runEndIndex; blockIndex += 1) {
			blockIds.add(blocks[blockIndex].blockId);
		}
		runStartIndex = null;
	}
	return blockIds;
}

function buildReviewerUserPrompt(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
	candidateRanges: readonly string[],
	structureMap: StructureMap,
	candidateBoundaryWindowBlockIds: ReadonlySet<number>,
	candidateIntervalAuditWindowBlockIds: ReadonlySet<number>,
): string {
	const candidateCoverageRatio = candidateBlockIds.size / blocks.length;
	const sourceCharacterCount = blocks.reduce((sum, block) => sum + block.text.length, 0);
	const candidateCharacterCount = blocks.reduce(
		(sum, block) => sum + (candidateBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const candidateCharacterCoverageRatio =
		sourceCharacterCount === 0 ? 0 : candidateCharacterCount / sourceCharacterCount;
	const candidateHardCarrierAuditOrder = orderRangesByDescendingBlockCount(candidateRanges);
	const focusedCandidate = buildFocusedDuplicate(
		blocks
			.filter((block) => candidateBlockIds.has(block.blockId))
			.map((block) => `IN|段落${block.blockId}：${block.text}`),
		MAX_REVIEWER_FOCUS_BLOCKS,
		MAX_REVIEWER_FOCUS_CHARACTERS,
		"Candidate",
	);
	const sourceRows = blocks.map((block) => ({
		blockId: block.blockId,
		text: `${candidateBlockIds.has(block.blockId) ? "IN" : "OUT"}|段落${block.blockId}：${block.text}`,
	}));
	const candidateBoundaryFocus = buildFocusedSource(
		sourceRows,
		candidateBoundaryWindowBlockIds,
		MAX_REVIEWER_BOUNDARY_FOCUS_BLOCKS,
		MAX_REVIEWER_BOUNDARY_FOCUS_CHARACTERS,
		"CANDIDATE_BOUNDARY_WINDOW",
	);
	const candidateIntervalAuditFocus = buildFocusedSource(
		sourceRows,
		candidateIntervalAuditWindowBlockIds,
		MAX_REVIEWER_INTERVAL_AUDIT_FOCUS_BLOCKS,
		MAX_REVIEWER_INTERVAL_AUDIT_FOCUS_CHARACTERS,
		"CANDIDATE_INTERVAL_AUDIT_WINDOW",
	);
	return [
		"# Run metadata",
		"sourceCoverage=complete",
		"candidateRole=untrusted mature single-prompt output",
		"membershipOverlay=IN means Candidate-selected; OUT means Candidate-external; markers are mechanical and not source text",
		`availableSourceRanges=${JSON.stringify(compactBlockRanges(blocks.map((block) => block.blockId)))}`,
		`candidateRanges=${JSON.stringify(candidateRanges)}`,
		`candidateHardCarrierAuditOrder=${JSON.stringify(candidateHardCarrierAuditOrder)}`,
		"candidateAuditOrderingContract=The Harness orders continuous Candidate intervals by descending block count using addresses only. Apply the system contracts to every interval in this exact order.",
		`candidateBlockCount=${candidateBlockIds.size}`,
		`candidateIsEmpty=${candidateBlockIds.size === 0}`,
		`candidateCoverageRatio=${candidateCoverageRatio.toFixed(4)}`,
		`sourceCharacterCount=${sourceCharacterCount}`,
		`candidateCharacterCount=${candidateCharacterCount}`,
		`candidateCharacterCoverageRatio=${candidateCharacterCoverageRatio.toFixed(4)}`,
		`focusedCandidateBlockCount=${focusedCandidate.blockCount}`,
		`focusedCandidateIncluded=${focusedCandidate.included}`,
		`candidateBoundaryWindowTargetBlockCount=${candidateBoundaryFocus.targetBlockCount}`,
		`candidateBoundaryWindowCoverage=${candidateBoundaryFocus.coverage}`,
		`candidateIntervalAuditWindowTargetBlockCount=${candidateIntervalAuditFocus.targetBlockCount}`,
		`candidateIntervalAuditWindowCoverage=${candidateIntervalAuditFocus.coverage}`,
		`structureEvidenceProvided=${structureMap.provided}`,
		`structureEvidenceEntryCount=${structureMap.entryCount}`,
		`structureMapNodeCount=${structureMap.renderedNodeCount}`,
		`structureMapCoverage=${structureMap.coverage}`,
		"candidateFocusPurpose=Complete mechanical duplicate of Candidate-selected addresses only when the whole duplicate fits. Navigation only; it adds no semantic label, vote, or permission.",
		"navigationEvidenceContract=IN/OUT overlays, structure rows, and focus windows are deterministic answer-free navigation only. They never label Owner, truth, keep, remove, add, or confidence. Complete source controls every semantic decision; continue beyond any focus window to the actual semantic peer exit.",
		"wordStructureEvidenceContract=Optional same-source Word structure describes physical order and hierarchy only. sc, vc, path, styles, numbering, formatting, and bounded tx never prove semantic Owner or membership.",
		"visualNavigationContract=sc=node@parent~exit and vc=node@parent~exit are physical navigation candidates only; vc never proves that node is a heading or assigns Owner.",
		"# Complete immutable source with mechanical membership overlay",
		renderReviewerSource(blocks, candidateBlockIds),
		"# Optional mechanically aligned Word structure map",
		structureMap.source,
		"# Focused Candidate-only review view (complete mechanical duplicate when budget permits)",
		focusedCandidate.source,
		"# Address-only Candidate boundary windows (bounded mechanical duplicate)",
		candidateBoundaryFocus.source,
		"# Address-only Candidate interval edge audit windows (bounded mechanical duplicate)",
		candidateIntervalAuditFocus.source,
		"# Terminal task card",
		"Apply the system runtime and Reviewer contracts as the complete semantic authority. This card fixes execution order only and does not replace those contracts.",
		"1. Read the complete source through its beginning, middle, and end. Settle current_acquisition_gate, source_role, and instantiation before local membership.",
		"2. Audit every Candidate interval in candidateHardCarrierAuditOrder. Establish each source-proven four-carrier root through its semantic exit, then mentally subtract the Harness-derived projection of every affirmed root.",
		"3. On every surviving Candidate island, execute the system residual gates at each peer subsection and addressable block. Run residual_island_completion and false_protection_counterexample_attack: split out the strongest safely removable counterexample and repeat until no system-defined non-requirement island remains. A parent title or representative positive block never proves the whole residual; an indivisible block with a surviving direct work duty remains.",
		"3a. Before preserving any peer-rooted bill-of-quantities, quotation, pricing, measurement, settlement, or price-basis island, execute pricing_basis_role_attack and price_wrapper_empty_remainder_test at each child boundary. Drawings, standards, site facts, quantities, plans, and technical nouns used only to calculate, compile, fill, compare, validate, or allocate price do not survive. Preserve only exact children whose stripped remainder still states concrete current-project work scope, action, resource provision, quantity, safety, delivery, acceptance, or another direct non-price duty. A chapter that only explains how to price or points to an absent schedule is not the schedule itself.",
		"4. Close source fidelity. Re-read literal IN/OUT for every proposed change; any affirmed qualified OUT body island must be in add_ranges, and no unproved OUT block may be added.",
		"5. Settle final = Candidate + add - remove once and project every settled change. source_role=non_procurement or instantiation=absent means null for a non-empty Candidate. Otherwise choose the shorter legal exact/complement encoding, exact on a tie. pass is legal only for canonical add=none and remove=none.",
		"6. TERMINAL_ACTION: Call submit_requirement_residual_review exactly once as the first and only visible output with all seven fields. Do not emit prose, Markdown, partial JSON, or pseudo-tool syntax before or after the call; end immediately after the call.",
	].join("\n\n");
}

function buildReviewerNoChangeReleaseUserPrompt(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
	candidateRanges: readonly string[],
	structureMap: StructureMap,
): string {
	const source = blocks
		.map(
			(block) =>
				`${candidateBlockIds.has(block.blockId) ? "IN" : "OUT"}|段落${block.blockId}：${block.text}`,
		)
		.join("\n");
	const candidateHardCarrierAuditOrder = orderRangesByDescendingBlockCount(candidateRanges);
	return [
		"sourceCoverage=complete",
		"reviewerNarrativeAndEvidenceVisibility=withheld",
		"releaseAuditMode=reviewer_no_change_terminal_or_hard_veto",
		"reviewerNoChangeHardCarrierAudit=true",
		"reviewerNoChangeReleaseAuthority=complete-candidate-terminal-veto-or-candidate-wide-hard-carrier-veto",
		"challengeIssueType=reviewer_no_change_audit",
		"challengeAddRanges=[]",
		"challengeRemoveRanges=[]",
		"releaseRemoveEnvelopeRanges=[]",
		"boundaryReviewRanges=[]",
		`availableSourceRanges=${JSON.stringify(compactBlockRanges(blocks.map((block) => block.blockId)))}`,
		`candidateRanges=${JSON.stringify(candidateRanges)}`,
		`hardRootClaimProjectionUniverseRanges=${JSON.stringify(candidateRanges)}`,
		`candidateHardCarrierAuditOrder=${JSON.stringify(candidateHardCarrierAuditOrder)}`,
		`candidateBlockCount=${candidateBlockIds.size}`,
		"auditContract=This is one independent veto audit after a Reviewer produced no executable net change. It is not a second extraction or an ordinary precision pass. Every Candidate block starts as protected BASE_KEEP. REMOVE_REVIEW, ADD_REVIEW, BOUNDARY_REVIEW, partial outside-carrier cleanup, residual precision, and ordinary OUT additions are unavailable.",
		WHOLE_SOURCE_IDENTITY_VETO_CONTRACT,
		UNINSTANTIATED_TEMPLATE_TERMINAL_CONTRACT,
		HARD_CARRIER_VETO_CONTRACT,
		PEER_ROOT_FRACTURE_CONTRACT,
		HARD_CARRIER_FUNCTION_CONTRACT,
		ANNOUNCEMENT_PREAMBLE_BOUNDARY_CONTRACT,
		EXPLICIT_CHAPTER_HIERARCHY_CONTRACT,
		"candidateAuditOrderingContract=Audit the continuous Candidate intervals in the exact descending-size address order. Reopen Owner at every source-proven peer root and use compact root->semantic-exit addresses. Range order and IN/OUT membership are navigation and authorization only, never semantic evidence.",
		"releaseAuthorization=Choose only between two semantic veto authorities. First, an independently proven whole-source non-procurement, completed-supplier-response, contract-only, or uninstantiated-template identity may delete exactly the complete Candidate through outside_carrier_excluded_ranges. Otherwise, represent every independently proven announcement/notice, bidder/supplier-instruction, bid/response/quotation-format, or contract-terms/format root only through hard_root_claims. The Harness derives their complete Candidate hard exclusions. If neither veto is proven, submit an empty delta. Partial outside-carrier Candidate deletion and all additions are unauthorized.",
		"releaseTerminalContract=Write hard_carrier_reason and residual_reason first. Use hard_carrier_reason for the Candidate-wide four-carrier root hypotheses, including roots whose starts are OUT ancestors of Candidate descendants. Use residual_reason to adversarially test those roots and to state whether the all-or-nothing whole-source terminal identity is proven. Then submit hard_root_claims, outside_carrier_excluded_ranges, and accepted_add_ranges. Every claim contains only carrier_type plus [root_block_id, exit_block_id_exclusive), with null exit meaning EOF. The Harness intersects each span with hardRootClaimProjectionUniverseRanges, rejects empty or overlapping projections, derives the hard exclusion union, and composes the final set mechanically. Never calculate or submit projected ranges.",
		"# Complete immutable source with Candidate-only IN/OUT membership",
		source,
		"# Optional mechanically aligned Word structure map",
		structureMap.source,
		"# Final veto checklist after reading the complete source",
		"1. Inspect the beginning, middle, and true end. A whole-source terminal identity requires affirmative authorship, use, and instantiation evidence plus whole_container_disconfirmation showing no boundary-independent buyer-issued requirement region. A title, completed tone, isolated supplier phrase, copied tender clause, technical density, or future duty is insufficient.",
		"2. If that terminal identity is proven, set outside_carrier_excluded_ranges to exactly the complete Candidate and set hard_root_claims=[] and accepted_add_ranges=[]. Do not run atom-level duty_survival_attack or preserve local technical-looking content.",
		"3. If no terminal identity is proven, set outside_carrier_excluded_ranges=[]. Audit every Candidate interval for the four hard-excluded carriers. Write one hard_root_claim for each independently proven root using only carrier_type, root_block_id, and exit_block_id_exclusive; use null exit only for EOF. This projection universe is Candidate-only in this no-change audit. The Harness derives the complete intersection and rejects empty or overlapping claims. Retract or narrow an overbroad root before retaining any descendant; never carve around useful or technical content inside an affirmed root.",
		"3a. Apply explicitChapterHierarchyContract first. If the source names an actual chapter-level hard-carrier root before a Candidate block and no same-or-higher different-Owner peer intervenes, multi-carrier file identity, useful project facts, technical detail, or a lower-rank numbered subsection cannot keep that descendant. The preamble reset is forbidden inside the named chapter.",
		"4. If neither a whole-source terminal identity nor any four-carrier descendant is proven, submit hard_root_claims=[], outside_carrier_excluded_ranges=[], and accepted_add_ranges=[]. Do not invent an ordinary cleanup to force a change.",
		"5. TERMINAL_ACTION: Rewrite every draft into one complete five-field decision, then call submit_requirement_release exactly once as the first and only visible output. The tool arguments must contain hard_carrier_reason, residual_reason, hard_root_claims, outside_carrier_excluded_ranges, and accepted_add_ranges together. Do not emit analysis, prose, Markdown, pseudo-tool syntax, or partial JSON before or after the tool call; end immediately after the call.",
	].join("\n\n");
}

function buildReleaseUserPrompt(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
	addBlockIds: ReadonlySet<number>,
	boundaryReviewBlockIds: ReadonlySet<number>,
	removeEnvelopeBlockIds: ReadonlySet<number>,
	proposedRemoveBlockIds: ReadonlySet<number>,
	candidateRanges: readonly string[],
	issueType: ReviewerIssueType,
	addRanges: readonly string[],
	removeMode: ReviewerRemoveMode,
	releaseHasRemoval: boolean,
	fullRemovalDemotedToHardBoundaryReview: boolean,
	hardBoundaryResidualPrecisionMode: HardBoundaryResidualPrecisionMode,
	removeEnvelopeRanges: readonly string[],
	proposedRemoveRanges: readonly string[],
	structureMap: StructureMap,
): string {
	const allowedAddBlockIds = new Set([...addBlockIds, ...boundaryReviewBlockIds]);
	const hardRootClaimProjectionUniverseRanges = compactBlockRanges([
		...candidateBlockIds,
		...addBlockIds,
		...boundaryReviewBlockIds,
	]);
	const candidateCharacterCount = blocks.reduce(
		(sum, block) => sum + (candidateBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const challengeAddCharacterCount = blocks.reduce(
		(sum, block) => sum + (addBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const boundaryReviewCharacterCount = blocks.reduce(
		(sum, block) => sum + (boundaryReviewBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const challengeRemoveCharacterCount = blocks.reduce(
		(sum, block) => sum + (proposedRemoveBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const releaseRemoveEnvelopeCharacterCount = blocks.reduce(
		(sum, block) => sum + (removeEnvelopeBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const challengeRemoveCandidateCharacterRatio =
		candidateCharacterCount === 0 ? 0 : challengeRemoveCharacterCount / candidateCharacterCount;
	const candidateHardCarrierAuditOrder = orderRangesByDescendingBlockCount(candidateRanges);
	const sourceRows: ReleaseSourceRow[] = blocks.map((block) => {
		const marker = addBlockIds.has(block.blockId)
			? "ADD_REVIEW"
			: boundaryReviewBlockIds.has(block.blockId)
				? "BOUNDARY_REVIEW"
				: proposedRemoveBlockIds.has(block.blockId)
					? "REMOVE_REVIEW"
					: candidateBlockIds.has(block.blockId)
						? "BASE_KEEP"
						: "OUT";
		return {
			blockId: block.blockId,
			marker,
			text: `${marker}|段落${block.blockId}：${block.text}`,
		};
	});
	const source = blocks
		.map(
			(block) =>
				`${candidateBlockIds.has(block.blockId) ? "IN" : "OUT"}|段落${block.blockId}：${block.text}`,
		)
		.join("\n");
	const permissionTransitions = buildReleasePermissionTransitions(sourceRows);
	const focusedReview = buildReleaseAdversarialNavigation(
		sourceRows,
		proposedRemoveBlockIds,
		allowedAddBlockIds,
	);
	const challengeStructureBlockIds = new Set([
		...proposedRemoveBlockIds,
		...allowedAddBlockIds,
	]);
	const challengeStructureFocus = buildReleaseStructureFocus(
		structureMap,
		challengeStructureBlockIds,
	);
	return [
		"sourceCoverage=complete",
		"reviewerNarrativeAndEvidenceVisibility=withheld",
		"independentSourceContract=The complete source below carries only frozen Candidate IN/OUT membership. Reviewer REMOVE_REVIEW, BASE_KEEP, ADD_REVIEW, and BOUNDARY_REVIEW permissions are intentionally withheld from that source and appear only in the later bounded navigation views. Audit every continuous IN interval for later source-proven four-carrier peer roots before consulting those patch permissions.",
		fullRemovalDemotedToHardBoundaryReview
			? "challengeOverlay=The Reviewer full-Candidate ordinary removal proposal was mechanically demoted before Release. Every Candidate block starts as BASE_KEEP; ADD_REVIEW is the Reviewer-proposed Candidate-external subset. BOUNDARY_REVIEW is disabled in this safety mode; OUT is unavailable. hard_root_claims may identify source-proven four-class roots, whose projection union the Harness derives. Candidate outside-carrier deletion is available only when at least one Candidate block is hard-excluded and every remaining Candidate block forms exactly one non-empty continuous block-address run across the complete Candidate. Markers define authorization, not semantic truth, confidence, or votes."
			: releaseHasRemoval
			? "challengeOverlay=REMOVE_REVIEW means the exact Candidate subset the Reviewer proposes deleting, but it does not encode why. Independently classify each proposed deletion: a four-carrier descendant must be covered by a hard_root_claim, an authorized outside-carrier atom goes only to outside_carrier_excluded_ranges, and a final keep is omitted from outside_carrier_excluded_ranges. BASE_KEEP means every other Candidate block is protected from ordinary deletion, except for the explicit candidate-wide four-carrier veto and one content-blind hard-boundary residual permission: only after at least one REMOVE_REVIEW Candidate block is independently hard-excluded by a derived claim projection may the Harness expose the sole remaining non-empty continuous Candidate run for outside-carrier precision. ADD_REVIEW is the Reviewer-proposed Candidate-external subset; BOUNDARY_REVIEW is a separate content-blind address window around Candidate run edges, authorized only for same-Owner selected-shell body closure; all other OUT is unavailable. Markers define authorization, not semantic truth, confidence, deletion type, or votes."
			: "challengeOverlay=ADD_REVIEW means a Candidate-external block the Reviewer proposes adding; BOUNDARY_REVIEW is a separate content-blind address window around Candidate run edges, authorized only for same-Owner selected-shell body closure; BASE_KEEP means all Candidate content is protected from ordinary deletion, with only the explicit candidate-wide four-carrier veto able to override it through a submitted hard_root_claim and Harness-derived projection. All other OUT is unavailable. Markers define authorization, not semantic truth.",
		`availableSourceRanges=${JSON.stringify(compactBlockRanges(blocks.map((block) => block.blockId)))}`,
		`candidateRanges=${JSON.stringify(candidateRanges)}`,
		`hardRootClaimProjectionUniverseRanges=${JSON.stringify(hardRootClaimProjectionUniverseRanges)}`,
		`candidateHardCarrierAuditOrder=${JSON.stringify(candidateHardCarrierAuditOrder)}`,
		"candidateAuditOrderingContract=The Harness orders continuous Candidate intervals by descending block count using addresses only. Audit them in this exact order before narrating any challenged range. Use compact root->semantic-exit addresses; do not spend the reason budget restating clause contents.",
		`challengeIssueType=${JSON.stringify(issueType)}`,
		`challengeAddRanges=${JSON.stringify(addRanges)}`,
		`boundaryReviewRanges=${JSON.stringify(compactBlockRanges([...boundaryReviewBlockIds]))}`,
		`challengeRemoveMode=${JSON.stringify(removeMode)}`,
		`challengeRemoveRanges=${JSON.stringify(proposedRemoveRanges)}`,
		`releaseRemoveEnvelopeRanges=${JSON.stringify(removeEnvelopeRanges)}`,
		"reviewerPreserveRangesAndRationale=withheld",
		`releaseAuditMode=${fullRemovalDemotedToHardBoundaryReview ? "hard_carrier_boundary_residual" : releaseHasRemoval ? "bounded_patch_with_confirmed_hard_residual" : "add_only"}`,
		`hardBoundaryResidualPrecisionMode=${hardBoundaryResidualPrecisionMode}`,
		"reviewerNoChangeReleaseAuthority=not-applicable",
		`fullRemovalDemotedToHardBoundaryReview=${fullRemovalDemotedToHardBoundaryReview}`,
		"reviewerNoChangeHardCarrierAudit=false",
		fullRemovalDemotedToHardBoundaryReview
			? "reviewerMechanicalPatchVisibility=full-Candidate ordinary removal withdrawn; protected BASE_KEEP Candidate plus bounded ADD_REVIEW, candidate-wide hard-carrier veto, and only a mechanically derived hard-boundary residual precision scope"
			: releaseHasRemoval
			? "reviewerMechanicalPatchVisibility=exact REMOVE_REVIEW envelope for ordinary changes; all other Candidate blocks are protected BASE_KEEP except the explicit four-carrier veto and a sole continuous residual unlocked by a confirmed REMOVE_REVIEW hard exclusion"
			: "reviewerMechanicalPatchVisibility=bounded ADD_REVIEW with protected BASE_KEEP Candidate except the explicit four-carrier veto",
		`candidateBlockCount=${candidateBlockIds.size}`,
		`challengeAddBlockCount=${addBlockIds.size}`,
		`boundaryReviewBlockCount=${boundaryReviewBlockIds.size}`,
		`challengeRemoveBlockCount=${proposedRemoveBlockIds.size}`,
		`releaseRemoveEnvelopeBlockCount=${removeEnvelopeBlockIds.size}`,
		`candidateCharacterCount=${candidateCharacterCount}`,
		`challengeAddCharacterCount=${challengeAddCharacterCount}`,
		`boundaryReviewCharacterCount=${boundaryReviewCharacterCount}`,
		`challengeRemoveCharacterCount=${challengeRemoveCharacterCount}`,
		`releaseRemoveEnvelopeCharacterCount=${releaseRemoveEnvelopeCharacterCount}`,
		`challengeRemoveCandidateCharacterRatio=${challengeRemoveCandidateCharacterRatio.toFixed(4)}`,
		`focusedChangeTargetBlockCount=${focusedReview.change.targetBlockCount}`,
		`focusedChangeIncludedTargetBlockCount=${focusedReview.change.includedTargetBlockCount}`,
		`focusedChangeCoverage=${focusedReview.change.coverage}`,
		`focusedReviewRenderedBlockCount=${focusedReview.renderedBlockCount}`,
		`focusedReviewRenderedCharacterCount=${focusedReview.renderedCharacterCount}`,
		`focusedReviewIncluded=${focusedReview.renderedBlockCount > 0}`,
		`structureEvidenceProvided=${structureMap.provided}`,
		`structureEvidenceEntryCount=${structureMap.entryCount}`,
		`structureMapNodeCount=${structureMap.renderedNodeCount}`,
		`structureMapCharacterCount=${structureMap.renderedCharacterCount}`,
		`structureMapCoverage=${structureMap.coverage}`,
		`releaseChallengeStructureFocusTargetNodeCount=${challengeStructureFocus.targetNodeCount}`,
		`releaseChallengeStructureFocusIncludedNodeCount=${challengeStructureFocus.includedNodeCount}`,
		`releaseChallengeStructureFocusCharacterCount=${challengeStructureFocus.renderedCharacterCount}`,
		`releaseChallengeStructureFocusCoverage=${challengeStructureFocus.coverage}`,
		`permissionTransitionCount=${permissionTransitions.totalCount}`,
		`permissionTransitionRenderedCount=${permissionTransitions.renderedCount}`,
		`permissionTransitionCoverage=${permissionTransitions.coverage}`,
		"focusViewPurpose=Text-blind challenged-side atomic navigation only. The harness repeats only REMOVE_REVIEW, ADD_REVIEW, and BOUNDARY_REVIEW addresses plus deterministic immediate boundary context; oversized change sets use continuous-run boundary windows and recursively layered addresses. It never reads headings or keywords. ATOMIC_CHANGE_TARGET and ATOMIC_CONTEXT add no evidence, semantic label, vote, or permission; the complete source above remains the only truth source.",
		"boundaryReviewContract=BOUNDARY_REVIEW is computed only from fixed address windows around Candidate run edges. It is not a Reviewer claim, confidence signal, semantic label, or general OUT search permission. Accept a BOUNDARY_REVIEW island only when the complete immutable source proves every accepted block is the same qualified body, table, list, continuation, or appendix needed to close an adjacent Candidate-selected shell through the source-proven peer exit, and the complete required island fits inside the authorized BOUNDARY_REVIEW envelope. Reject unrelated adjacent content, hard-excluded carriers, wrong project/package content, bare pointers, and any partial body whose remaining source-fidelity island extends into ordinary OUT.",
		"markerPermissionBoundaryContract=The address-only REMOVE_REVIEW/BASE_KEEP transition list is mechanical navigation, not a semantic label, vote, or exit. For every listed transition, read the actual source before and after both runs. The marker change itself never ends an announcement, bidder-instruction, response-format, quotation-format, or contract-terms Owner. Follow a source-proven hard-carrier root across BASE_KEEP, OUT, attachments, tables, and later marker changes until the first different-Owner peer root or EOF. If residual_reason still affirms that root, submit its complete root/exit claim; the Harness derives every authorized BASE_KEEP descendant inside it. To retain any descendant, first retract or narrow the root or establish an earlier different-Owner exit; the marker itself is never that proof.",
		"wordStructureEvidenceContract=Optional structure is the same answer-free mechanical map seen by Reviewer: body order, paragraph/table form, style/outline, numbering, formatting, page-break, table-size, and outline-ancestry facts only. tx is a bounded exact prefix copied from the same canonical source after content-blind node selection, solely to join structure back to source addresses. It never carries Reviewer conclusions or semantic labels. Use it only to reconstruct true hierarchy and peer exits; complete source text remains authoritative.",
		"outlineNavigationContract=For every S row with sc=node@parent~exit, node is the active mechanically observed outline scope, parent is its nearest shallower ancestor, and exit is the first later same-or-shallower outline node. These fields describe physical scope only. A structural exit never automatically ends Owner: read the exit node from source, and if it continues the same Owner, chain through its scope until the first different-Owner peer root. Before keeping any title, table, or ordinary paragraph inside a hard-excluded scope, require that different-Owner exit; otherwise the root and all nested or same-Owner continuation content remain excluded.",
		"visualNavigationContract=For every S row with vc=node@parent~exit, formatting alone marks node as a non-outline visual heading candidate, parent as its mechanical enclosing candidate, and exit as the next equal-or-larger visual peer. vc is not a semantic heading or Owner label. Read node tx and complete source first; when source semantics confirms a carrier start, use exit as the bounded peer-exit hypothesis and keep descendants under that Owner until source proves otherwise. Ignore vc when source semantics does not confirm a carrier start.",
		"challengeEnvelopeMetrics=Permission-and-budget metadata only. Counts, character ratio, and 100% Candidate coverage do not express a requested deletion amount and are never semantic evidence.",
		"challengeIssueTypeSemantics=challengeIssueType is a non-authoritative label. Adjudicate each challenged paragraph from source and publish any safe subset regardless of the label.",
		...(fullRemovalDemotedToHardBoundaryReview
			? [FULL_REMOVAL_SAFETY_CONTRACT]
			: releaseHasRemoval
				? [CONFIRMED_HARD_RESIDUAL_CONTRACT]
				: []),
		HARD_CARRIER_VETO_CONTRACT,
		PEER_ROOT_FRACTURE_CONTRACT,
		HARD_CARRIER_FUNCTION_CONTRACT,
		ANNOUNCEMENT_PREAMBLE_BOUNDARY_CONTRACT,
		EXPLICIT_CHAPTER_HIERARCHY_CONTRACT,
		SUBSTANTIVE_RESPONSE_WRAPPER_CONTRACT,
		WHOLE_SOURCE_IDENTITY_VETO_CONTRACT,
		UNINSTANTIATED_TEMPLATE_TERMINAL_CONTRACT,
		"remedyTriggerSeparation=Quality error, misconduct, or false deliverables used only as a trigger for deduction, damages, disqualification, termination, replacement procedure, or legal pursuit do not create an independent quality requirement. Strip the remedy itself: if no deliverable accountability, measurable quality threshold, inspection/review/acceptance, correction duty, or work act remains, place that separable atom on the remove side.",
		"prospectiveResponsibilityBoundary=An explicit requirement that the successful supplier bear responsibility for current-project design, construction, safety, quality, or deliverables is prospective performance governance and survives even when paired with economic-loss allocation. Distinguish it from a buyer-only after-the-fact right to deduct, terminate, replace, or pursue legal liability with no independent supplier responsibility or work act.",
		"performanceGovernanceBoundary=Independence, professional-discipline, conflict-of-interest disclosure, and recusal duties that govern the successful supplier or its personnel while performing the current project are direct implementation and quality-governance facts. Treat them as qualification only when their primary effect is proving bidder or proposed-person eligibility before award.",
		"preAwardStageGateContract=After hard_root_claims settle the four-carrier gate and before any outside-carrier block-level duty test, run pre_award_stage_gate. A rooted personnel or mandatory-response subsection with a peer exit is pre-award proof in full when multiple children collectively require credentials, social-insurance evidence, qualification material, commitments, or other proof and use invalid-response, ineligibility, or an equivalent pre-award consequence to define admissibility. Put the root and every child through the peer exit in outside_carrier_excluded_ranges; do not run duty_survival_attack inside merely because one child also describes future staffing. Only a subsection affirmatively proven to be primarily post-award staffing may be split around a separable proof note.",
		"nonFactShellClosureContract=For every rooted subsection with a peer exit, if the title and body contain only an explicit no-content marker, blanks, placeholders, a bare pointer to unavailable material, or a generic comply-with-law/catch-all wrapper that adds no concrete task, workflow, output, deadline, or result, put the root and body together in outside_carrier_excluded_ranges. Membership from a preceding technical table or performance subsection never crosses the peer boundary to preserve this empty shell.",
		"headingMembershipIndependenceContract=Outside the four hard-excluded carriers, a subsection heading and its child blocks carry independent membership. A surviving child duty does not protect a separable heading whose own function is only price, payment, settlement, deduction, penalty, breach, remedy, termination, dispute, or another non-work consequence. Put that heading alone in outside_carrier_excluded_ranges when the child remains understandable; preserve a qualified technical, service, safety, or acceptance heading and any heading indispensable to the child's meaning. Isolated legal wording never creates a contract carrier, and this rule never carves inside an established four-class root.",
		OUTSIDE_CARRIER_PRECISION_CLOSURE_CONTRACT,
		OUTSIDE_CARRIER_COUNTEREXAMPLE_CONTRACT,
		PROJECT_FACT_ATTACK_CLOSURE_CONTRACT,
		PRICING_BASIS_ROLE_CONTRACT,
		PERFORMANCE_TRANSITION_ATTACK_CONTRACT,
		fullRemovalDemotedToHardBoundaryReview
			? "challengeAtom=No raw ordinary Candidate deletion envelope remains. Independently adjudicate ADD_REVIEW and run the candidate-wide four-carrier root-and-exit sweep first. BOUNDARY_REVIEW is disabled. If that typed hard delta removes at least one Candidate block and leaves exactly one non-empty continuous Candidate block-address run, precision-audit only that residual; two residual runs or no residual authority leave every other BASE_KEEP block mandatory."
			: releaseHasRemoval
			? "challengeAtom=Adjudicate REMOVE_REVIEW and ADD_REVIEW. For each proposed outside-carrier deletion, run over_deletion_attack and retain it when a qualified fact, direct duty, necessary heading, or source-fidelity dependency survives. Separately run one candidate-wide four-carrier root-and-exit sweep. If that sweep hard-excludes at least one REMOVE_REVIEW Candidate block and leaves exactly one non-empty continuous Candidate residual, precision-audit every peer subsection and addressable block in that derived residual; otherwise do not search BASE_KEEP for ordinary outside-carrier cleanup. Decide each ADD_REVIEW independently, then apply boundaryReviewContract once to the bounded BOUNDARY_REVIEW set."
			: "challengeAtom=Independently approve or reject each ADD_REVIEW, then apply boundaryReviewContract once to the bounded BOUNDARY_REVIEW set, plus run one candidate-wide four-carrier root-and-exit sweep. BASE_KEEP remains mandatory for every outside-carrier decision.",
		fullRemovalDemotedToHardBoundaryReview
			? "releaseAuthorization=Every Candidate block starts as BASE_KEEP. hard_root_claims may identify any independently proven four-class root, and the Harness derives its exclusion projection. After that typed hard delta, outside_carrier_excluded_ranges may subtract Candidate only when at least one Candidate block is hard-excluded and all remaining Candidate blocks form one Harness-derived non-empty continuous block-address run. The run may be a prefix, suffix, middle island, or one independent Candidate interval after every other Candidate interval is fully hard-excluded. Two residual runs, no Candidate hard exclusion, or no remaining Candidate grants no authority. accepted_add_ranges may add only ADD_REVIEW; BOUNDARY_REVIEW is disabled and other OUT remains unavailable."
			: releaseHasRemoval
			? "releaseAuthorization=Every BASE_KEEP block is mechanically retained unless a submitted hard_root_claim covers it through the Harness-derived projection. outside_carrier_excluded_ranges may subtract REMOVE_REVIEW and, only after at least one REMOVE_REVIEW Candidate block is hard-excluded, exact atoms inside the sole non-empty continuous Candidate run left by all hard exclusions. A hard finding confined to BASE_KEEP does not unlock that run. accepted_add_ranges may add only ADD_REVIEW or BOUNDARY_REVIEW after their separate checks. Other OUT remains unavailable."
			: "releaseAuthorization=Every BASE_KEEP block is mechanically retained unless a submitted hard_root_claim covers it through the Harness-derived projection. accepted_add_ranges may add only ADD_REVIEW or BOUNDARY_REVIEW after their separate checks; outside_carrier_excluded_ranges may only record rejected challenged additions. Other OUT remains unavailable.",
		"releaseTerminalContract=Submit one phased semantic plan in fixed order: hard_carrier_reason -> residual_reason -> hard_root_claims -> outside_carrier_excluded_ranges -> accepted_add_ranges. Phase 1 proposes only four-carrier roots across Candidate, including OUT-starting ancestor roots whose descendants intersect Candidate. Before any structural field, Phase 2 must adversarially test that proposal, correct any overbroad or incomplete root/exit decision, and adjudicate every remaining authorized challenged block or runtime-declared hard-boundary residual. Every actual four-carrier root left affirmed by Phase 2 must become one typed claim containing only carrier_type, root_block_id, and exit_block_id_exclusive; null exit means EOF. The Harness intersects each claim with hardRootClaimProjectionUniverseRanges, rejects empty or overlapping projections, derives the hard exclusion union, mechanically restores every other REMOVE_REVIEW block, and deterministically derives final = Candidate - derived hard exclusions - authorized outside-carrier exclusions + accepted challenged additions. Never calculate or submit projected ranges.",
		"terminalReasonBudget=Keep each phase reason under 900 characters. In hard_carrier_reason cover candidateHardCarrierAuditOrder using compact root->semantic-exit hypotheses only and end with hard_hypothesis=<carrier:root->exit or none>. Before writing structural fields, use residual_reason to attack Phase 1 for peer-root fractures and overbreadth, then end with one final_plan=claims:<carrier:root->exit or none>;outside:<ranges or none>;add:<ranges or none> clause. Copy only those claims and the two explicit range arrays; do not restate Harness-derived projectedRanges or hardExcludedRanges.",
		"Independently adjudicate only this exact envelope, then call submit_requirement_release exactly once.",
		"# Complete immutable source with Candidate-only IN/OUT membership",
		source,
		"# Optional mechanically aligned Word structure map",
		structureMap.source,
		"# Text-blind challenged-side atomic navigation view (bounded mechanical duplicate)",
		focusedReview.source,
			"# Challenged-side structural navigation focus (bounded mechanical duplicate)",
			challengeStructureFocus.source,
			"# Address-only REMOVE_REVIEW/BASE_KEEP permission transitions",
			permissionTransitions.source,
			"# Final release checklist after reading the complete source",
		"0.4. Mandatory whole_source_identity_veto before every local gate: inspect the beginning, middle, and end for affirmative authorship and use evidence. If the complete source is one supplier-authored completed bid, response, technical proposal, implementation plan, or deliverable; one non-procurement document; or one uninstantiated template/form, and no boundary-independent buyer-issued requirement region exists, the identity is terminal. Instantiation requires an already-filled fact that distinguishes this procurement object, scope, work package, quantity, site, or commissioned relationship. Template identifiers, generic supply/quotation rules, drafting instructions, default duties, blank schedules/tables, and pointers to absent notices, lists, or specifications cannot establish it. Once absent is established, local generic supply, pricing, quality, compliance, or future-work clauses cannot reopen membership through primary-effect, normative-incorporation, or duty_survival_attack. Copied tender text, project-specific technical detail, future work duties, response tables, and commitments likewise remain part of that wrong-author or non-fact source. Put all authorized challenged Candidate blocks in outside_carrier_excluded_ranges and leave accepted_add_ranges empty when no BASE_KEEP remains. Do not infer the veto from a title, completed tone, or one supplier phrase; mixed-author handoffs and buyer-provided technical reports require actual Owner partitioning.",
		"0.5. Mandatory pre_award_stage_gate ordering: close the four hard-excluded carrier gate first; then close each boundary-complete pre-award qualification/response-proof subsection from its own root through its peer exit; only after both gates may you run outside-carrier atom-level primary-effect or duty_survival_attack. A future-staffing child never reopens a subsection whose collective function is pre-award admissibility.",
		"0.6. Mandatory non_fact_shell_closure: when a peer-bounded subsection has only an explicit no-content marker, blank/placeholder body, bare unavailable-material pointer, or generic legal/catch-all wrapper with no concrete task, workflow, output, deadline, or result, exclude its root and body together. Do not inherit membership across the peer boundary from the preceding retained table or duty subsection.",
		"0.7. Mandatory heading membership independence outside the four carrier gate: a surviving child duty does not protect a separable price/payment/settlement/deduction/penalty/breach/remedy/termination/dispute heading. Put the heading alone in outside_carrier_excluded_ranges when its removal leaves the child understandable; preserve qualified technical/service/safety/acceptance headings and indispensable context. Never use isolated legal wording to create a contract carrier.",
		"1. Before consulting REMOVE_REVIEW, BASE_KEEP, or ADD_REVIEW permissions, audit the complete Candidate-only IN/OUT source in candidateHardCarrierAuditOrder. Finish the longest interval first. Scan each continuous IN interval from its first block through its last block and reopen Owner at every source-proven peer chapter, subsection, appendix, table root, or equivalent functional boundary. Record only compact root->semantic-exit decisions in reason; an interval is not cleared merely because its first region is qualified.",
		fullRemovalDemotedToHardBoundaryReview
			? "1b. Only after the independent Candidate audit, review the bounded ADD_REVIEW set and any hard-boundary residual. The raw full-Candidate ordinary removal proposal has no Release authority. Submit one hard_root_claim for every true hard-carrier root intersecting Candidate; the Harness derives all affected blocks. Only when that derived hard delta removes at least one Candidate block and all remaining Candidate blocks form exactly one non-empty continuous address run can that residual receive outside-carrier exclusions. This includes one independent Candidate interval only when every other Candidate interval is fully hard-excluded."
			: releaseHasRemoval
			? "1b. Only after the independent Candidate audit, review REMOVE_REVIEW and ADD_REVIEW against the complete source. BASE_KEEP is outside ordinary deletion authority. Independently approve or restore each proposed removal; do not scan BASE_KEEP for any outside-carrier cleanup."
			: "1b. Only after the independent Candidate audit, review the bounded add-only patch. BASE_KEEP remains mandatory for every outside-carrier decision.",
		"1a. Before local partitioning, test the whole-document communicative-role hypothesis from the beginning, middle, and end. A whole-source notice is possible only when an actual notice root governs one uninterrupted, functionally homogeneous outward act through its true end. Run whole_container_disconfirmation before accepting it: a peer qualification, evaluation, contract, response-format, requirement, specification, drawing, list, or technical-appendix root makes the source a multi-carrier procurement container. The physical file or invitation is not itself a hard-excluded root, and all chapters participating in one procurement does not make them one notice.",
		"2. Keeping any disputed block needs affirmative proof that it is outside the four hard-excluded carriers. Current-project facts, unique scope, staffing, quality, service, acceptance, or technical wording inside an open announcement, bidder-instruction, response-format, or contract carrier are never protection evidence. An announcement need not carry an explicit title: a self-contained public-notice sequence covering project synopsis, participation eligibility, acquisition, submission, publication channel, and contacts remains announcement Owner until a source-proven exit. This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region; never stitch those elements across peer response-format, contract, evaluation, technical-chapter, or detailed-technical-appendix boundaries to label the whole physical file a notice. When such heterogeneous peer carriers exist, first treat the file as a multi-carrier procurement container and reopen Owner at every boundary. Do not invent an invitation-body Owner spanning all numbered sections: invitation is the physical container, not a fifth hard-excluded carrier. A top-level functional shift into project scope, procurement content, execution quality or safety, warranty, technical standards, or a detailed technical appendix is itself a source-proven boundary and needs no explicit end-of-invitation sentence. Continuous numbering and later contact information do not erase that boundary. If retaining a project-summary island from a true notice sequence, state its actual regional boundary; otherwise omit it.",
		"3. REMOVE_REVIEW interval boundaries are not carrier boundaries. A wide removal proposal can start inside a contract or format chapter and later cross into peer technical chapters before entering another excluded carrier. Reopen Owner judgment at every top-level heading, chapter transition, appendix, table heading, and short post-carrier island inside the interval; never inherit the first heading across the whole range.",
		fullRemovalDemotedToHardBoundaryReview
			? "3a. When structure navigation is available, use the challenged-side focus only as bounded navigation; use the complete source and full answer-free structure map for the candidate-wide four-carrier sweep. Structure is never an Owner label. BASE_KEEP remains mandatory unless the Harness-derived projection of a submitted hard_root_claim covers the block or it belongs to the one non-empty continuous Candidate address run mechanically left across the complete Candidate by the typed hard delta and is explicitly submitted in outside_carrier_excluded_ranges."
			: "3a. When structure navigation is available, use the challenged-side focus only as bounded navigation; use the complete source and full answer-free structure map for the candidate-wide four-carrier sweep. Structure is never an Owner label. BASE_KEEP remains mandatory unless Release proves the semantic root and submits its hard_root_claim.",
		"3b. A source-proven carrier boundary does not require Word outline metadata. A numbered, bold, centered, or plain-text local subsection that establishes contract terms or formats, response/quotation format, bidder instructions, or an announcement/notice sequence starts a hard-excluded Owner even when nested under a broader chapter. Apply hardCarrierFunctionContract strictly: quotation format is a submitted response-artifact schema, not an ordinary price/quotation/cost subsection; bidder instruction is a rooted participation or submission procedure, not any bidder-addressed sentence; announcement is an uninterrupted notification sequence, not an invitation sentence plus project facts followed by peer requirements. A bounded bidder/supplier commitment, response-commitment, no-deviation commitment, or declaration section is a response-format root only when its boundary-complete operative function is to require the bidder before award to declare, confirm, guarantee, or commit future compliance. It remains root-closed even without blanks, signature fields, or a format/template label and even when child lines restate warranty, quality, service, staffing, or delivery duties. Isolated commitment or guarantee wording does not create that carrier; a buyer's direct post-award command outside it remains a work duty. Carry an actual Owner through all child clauses until the next peer exit. Do not apply primary direct effect to rescue service period, location, quality, acceptance, technical parameters, or unique project facts inside an actual carrier. A detailed technical table remains excluded while its active response or quotation-format scope is open.",
		"3c. Contract-format containment requires an actual source-proven contract agreement, terms/format, performance-assessment template, or contract-appendix root. A local tender section whose stated function is to disclose the main terms of the future procurement contract is itself a contract-terms root; it does not need to be a complete bilateral contract, carry signatures, or make the whole source_role=contract. Isolated contract, breach, confidentiality, intellectual-property, approval, responsibility, or deduction wording does not create that carrier, and a later contract section never expands backward over earlier peer technical chapters. Once a local contract-terms root is source-proven, its embedded attachment, technical list, and detailed child rules inherit that carrier until a peer exit; an attachment label alone does not reopen membership. Within a qualified technical Owner, result/source-code delivery, confidentiality and data handling, cybersecurity, continued maintenance, reports, approval workflow, and replacement obligations remain subject to direct-duty review.",
			"3d. For every four-carrier omission, state carrier_root_exit_attack=<actual four-class root address -> first different-Owner peer root address or EOF>. Apply it to challenged blocks and to any BASE_KEEP block proposed under the candidate-wide hard-carrier veto. A later carrier never expands backward; adjacent different Owners require separate roots and exits.",
			"3d.1. Mandatory marker-transition closure: inspect every address-only REMOVE_REVIEW/BASE_KEEP transition listed above. A permission-marker switch is never a source-proven Owner exit. Start from the actual carrier root, read across both marker runs, and continue through any following OUT or marker change until the first different-Owner peer root or EOF. If residual_reason still affirms the same four-class root across the transition, submit that complete root/exit claim; the Harness derives every authorized Candidate descendant. To retain any descendant, residual_reason must first retract or narrow the root or establish a different-Owner peer exit; never run duty_survival_attack inside an affirmed root.",
		"3e. Mandatory mixed_container_root_sweep before atom review: a parent chapter combining technical, service, contract, business, or other requirements is only a mixed container. Classify every child heading candidate from source. A tentative final that drops payment, guarantee, breach, or other commercial/legal children but keeps service period, location, quality, acceptance, personnel, or technical children after the same local four-class root is a forbidden holey selection; either disprove the root or submit its complete root-to-semantic-exit claim.",
		"3f. Mandatory peer_root_fracture_attack inside every continuous Candidate interval: enumerate each source-proven peer root rather than inheriting the first Owner across the address range. When a qualified requirement island reaches a new announcement/notice, bidder/supplier-instruction, response/quotation-format, or contract-terms peer root, submit that root and its semantic exit in hard_root_claims even when it begins inside BASE_KEEP. A later qualified peer root remains retained. Never use markers, numbering, formatting, keywords, or range continuity alone to establish the root.",
		"3g. Mandatory preamble_peer_reset_test: run this reset only when no source-proven announcement/notice chapter or boundary-complete notification root encloses both regions. A commission/open-invitation/welcome sentence inside a tender-book, requirement, specification, or technical chapter is then at most a local preamble unless an uninterrupted outward-notification sequence continues. Reopen Owner at the next numbered peer root; procurement content, object, scope, site, schedule, quality, specification, drawing, list, or technical requirements can end that tentative preamble Owner without an explicit notice-ending sentence. Once an actual notice root is proven, disable this reset inside it: numbered project synopsis, procurement scope, period, location, standard, and technical-summary children remain notice descendants until a same-or-higher different-Owner peer outside the root. Repetition of the same facts in an earlier separate announcement is not local Owner evidence for a later root.",
		"4. Whole-source terminal identities outrank local technical content. If affirmative source evidence establishes one completed supplier-authored response/proposal/deliverable, one non-procurement document, one uninstantiated template/form, or one actual hard-excluded carrier through its true end, and no boundary-independent buyer-issued qualified region exists, the mechanically derived final is null when every Candidate block is covered by an authorized exclusion and accepted_add_ranges is empty. A supplier response does not become buyer requirement because it copies tender clauses, describes the same project, or contains detailed future duties. Before making that terminal decision, whole_container_disconfirmation must inspect every later top-level boundary and short island; for a four-class carrier, carrier_root_exit_attack must also establish its real root through EOF. Multiple heterogeneous peer roots prove a mixed or multi-carrier source, not a terminal whole-source identity; that finding never cancels any local four-class root or its hard projection. A physical-file title, invitation act, attachment relationship, or notice elements scattered across separate chapters is insufficient evidence for null; completed tone or isolated supplier wording is likewise insufficient.",
		"5. Before a broad removal or null result, inspect every later top-level boundary and short island for independent technical standards, requirements, specifications, drawings, lists, or appendices. Outer containment ends only at a source-proven boundary, not at a local technical label.",
		"6. Distinguish normative incorporation from a bare external pointer. Once the source is instantiated by other project facts, an independent technical chapter outside the four carriers has fact payload when it directly requires work to comply with or reach cited laws, drawings, codes, or current standards, even if generally worded or only a few lines. Do not demand repeated project-specific parameters. Only a heading, empty section, or text that merely says to see an absent document without stating any present duty has no payload. Conversely, when a qualified project-scope, quality, safety, warranty, acceptance, or technical-standard heading has substantive body text before the next peer Owner boundary, do not place the heading or body in either exclusion field. An image placeholder, blank line, page break, or short continuation after that heading does not end the section; never exclude its concrete duties, parameters, measures, response times, or responsibilities. Closure never extends backward across the carrier start: an independent appendix, list, or drawing begins at its own heading, name, or first explicit content block, and never absorbs the preceding carrier's signature party, date, seal, closing line, header/footer, or layout image merely because it is adjacent.",
		"6a. Source-fidelity closure and cross-references never transfer Owner. A qualified requirement sentence that says see an appendix does not make that appendix qualified: adjudicate the referenced appendix at its own structural location. If it is inside a contract, response format, scoring, qualification, announcement, or bidder-instruction carrier, it remains excluded even when detailed, unique, or referenced from the requirement chapter. Only a boundary-independent technical appendix under its own qualified Owner can enter accepted_add_ranges or remain selected.",
		"7. Carrier Owner is the terminal gate before primary effect. Never apply the block-level primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier; internal project-specific duties still follow that hard-excluded Owner until a source-proven exit. A complete source whose parties, agreement language, continuous articles, price/payment, breach, effectiveness, termination, dispute and signature structure jointly form one bilateral contract remains a contract even when its title says service or technical requirements and most articles are technically detailed. If reason establishes that contract-only identity and no boundary-independent qualified source, cover every authorized Candidate block with an exclusion and accept no additions; a later 'but the duties are technical' clause is a direct contradiction. Only outside the four hard-excluded carriers, a heading such as business, fulfillment, delivery, or after-sales requirements is not a pure-commerce verdict. Judge every disputed block by its primary direct effect and state the approved keep/remove address islands in reason. Keep project schedule/service period, location, scope, quality, warranty, delivery, acceptance, implementation, resource-provision and service-response obligations. Remove separately proven price, payment, settlement, deduction, audit, invoice, guarantee, bid-validity or other non-work-content blocks. Engineering quantities, completion, acceptance or quality-retention language used only as a monetary basis, payment condition or settlement trigger is not an acceptance or quality requirement; a direct work duty remains qualified when cost inclusion is merely incidental.",
		"8. In every mixed non-excluded chapter, re-read each numbered sub-item, table row, heading transition, and operative sentence as its own addressable decision. Procurement/evaluation method, price or quotation construction, payment, settlement, guarantee, bid validity, pure breach damages or remedies, termination, dispute resolution, contract formation, governing law, general legal risk allocation, and bare external inspection pointers remain removable when separable and when they impose no direct work duty. Direct construction, supply, configuration, resource, schedule, quality, safety, warranty, acceptance, service-response, or post-award staffing duties remain qualified even when adjacent to commercial or legal text. A new peer heading starts a new Owner decision; range continuity never carries the prior chapter across it.",
		"8b. Mandatory outside-carrier function fracture: within a qualified Candidate interval, a source-proven peer heading or numbered subsection whose primary function is price/quotation construction, payment/settlement, guarantee, or pure legal effect starts a separate remove island through the next peer boundary. Do not let an earlier technical heading or a later work duty protect that island. At the next peer subsection, reopen primary effect; preserve every indivisible child that actually requires implementation, resources, schedule, quality, safety, acceptance, delivery, service, or a result.",
		"8c. Mandatory price_wrapper_empty_remainder_test: when a price or quotation subsection cites standards, drawings, quantities, plans, site facts, work names, resources, risks, or other technical-looking material, decide what the clause makes that material do. If it is only an input or generic component for calculating, compiling, filling, comparing, validating, including, or allocating the bid price, exclude the peer-bounded pricing island; technical nouns do not create normative incorporation. A fixed-price or unit-price clause remains price formation when it merely lists generic labor, materials, machinery, transport, protection, fencing, measures, taxes, risks, rates, or profit as price components. Do not inherit this decision across every child of a broad quotation heading. Reopen at each direct child numbered subsection and addressable list item. Strip the price wrapper and every fee/cost/included wording from each child. Preserve it whenever any concrete current-project work scope, action, resource provision, restoration, safety/environmental measure, delivery, acceptance, or responsible-party command remains, even as a noun phrase without an imperative; the price statement is then incidental. Delete the child only when this stripped remainder is empty of work facts and still merely a generic cost category, price risk, rate, tax, profit, or price-adjustment rule.",
		"8a. Stage Owner outranks future-tense wording. A complete bid/response mandatory-requirements section or mandatory response table remains pre-award proof/commitment Owner even when it lists future roles, headcount, certificates, or mobilization dates. First close personnel Stage Owner at subsection level: when a subsection has its own root and peer exit, and multiple child items collectively require credentials, social-insurance proof, commitments, or invalid-response consequences to establish pre-award admissibility, put the root and every child through that exit in outside_carrier_excluded_ranges. Do not carve out one child merely because it also describes future staffing. Only when source proves the subsection is primarily post-award staffing may a separable note whose operative act tells the response document to fill, attach, or provide personnel names, credentials, certificates, screenshots, social-insurance evidence, or commitments be excluded locally without deleting the staffing duties around it. Outside those proof Owners, a direct requirement on the successful supplier's post-award staffing, resources, submission, review, approval, filing, records, or data handling is performance content. Confidentiality rules governing project-data storage, processing, transmission, copying, disclosure, retention, return, or destruction are direct data-control duties; a platform-execution command remains direct when termination is only the stated consequence.",
		"8d. Mandatory subject_predicate_remainder_test: outside a proven response-format or pre-award proof root, strip only the performative respond/state/confirm/guarantee/commit wrapper and bidder addressee. Preserve the indivisible block when actual offered work, service, product, quality, safety, acceptance, warranty, or result remains the grammatical subject of a requirement to meet, satisfy, or at least reach a substantive baseline; no separate implementation verb or project parameter is required, and it reopens a keep island between commercial or proof blocks. Delete only when stripping leaves an orphaned general-compliance, response, no-deviation, or acceptance phrase that merely serves as the object of a bidder declaration or commitment and predicates no independent property, action, or result of actual work.",
		fullRemovalDemotedToHardBoundaryReview
			? "9. Envelope size and prior-role agreement are not semantic votes. The raw full-Candidate removal envelope has been withdrawn. Candidate-wide hard deletion still requires semantic hard_root_claims; outside-carrier Candidate deletion is limited to the one mechanically derived non-empty continuous address run left across the complete Candidate after at least one Candidate block is hard-excluded."
			: "9. Envelope size and prior-role agreement are not semantic votes. Outside-carrier deletion starts bounded to REMOVE_REVIEW. After the Harness-derived projection of hard_root_claims independently covers at least one REMOVE_REVIEW Candidate block, the Harness may additionally expose exactly one non-empty continuous Candidate residual left by all hard exclusions. No confirmed REMOVE_REVIEW hard block, two residual runs, or no residual leaves every other BASE_KEEP mandatory.",
		"9a. Phase 1 hypothesis: write hard_carrier_reason, scanning each continuous Candidate interval from first through last in candidateHardCarrierAuditOrder and naming only decisive four-class roots with semantic exits. Do not let the interval's first qualified Owner hide a later contract, response-format, bidder-instruction, or announcement root. Do not write any range field yet.",
		"10. Phase 2 adversarial residual gate: before hard_root_claims or either range array, test the Phase 1 hypothesis against every peer root and every authorized challenged block. residual_reason must explicitly correct any Phase 1 root that expands backward over an earlier qualified chapter, crosses a different-Owner peer exit, or absorbs a later qualified peer root. Every Phase 1 root hypothesis must then either remain as a corrected hard_root_claim or be explicitly retracted or narrowed with that source-proven correction; it cannot disappear silently. Then adjudicate the remaining outside-carrier remove/add envelope. A non-empty residual cannot be called already covered.",
		"10a. Before compressing any multi-block outside-carrier deletion, run counterexample_first_duty_attack on the exact proposed interval. Every canonical paragraph/table block is independently addressable despite a shared commercial or legal heading. Find the strongest block whose operative remainder still imposes post-award work after stripping incidental price/payment/settlement/audit/proof/remedy language; restore its complete source-fidelity island, split around it, and repeat only on the remaining subranges. Record compact survivor islands or none, never representative sample addresses or a block ledger.",
		"10a.1. For every authorized project-overview or equivalent current-project-summary residual, execute projectFactAttackClosureContract before compression. residual_reason must include one project_fact_membership_attack=scope:<ranges>;remove:<ranges or none>;survive:<ranges or none> clause whose remove and survive islands cover every address in scope exactly once. A blanket project-facts or parent-heading keep verdict, or omission of a drafting/filling instruction before the first filled fact, is unfinished. This is a compact island closure, not a block ledger.",
		"10a.2. Before restoring any challenged heading, list, appendix, or source-provided-materials island, execute selected_shell_body_closure and non_fact_shell_closure against the current immutable source. Names of drawings, schedules, lists, specifications, or other materials are not body when their actual content is absent. If stripping the heading and external-reference wrapper leaves no present work fact, duty, parameter, or embedded body before the peer exit, exclude the complete shell; source fidelity never protects a bare pointer.",
		"10b. Only after both reasons converge, treat omission from outside_carrier_excluded_ranges as the final-keep expression for a REMOVE_REVIEW island not covered by a hard_root_claim. The Harness mechanically restores every such block. Do not submit a separate keep override or representative keep list; if a block remains a four-carrier descendant, submit its semantic root/exit claim, and if it remains an authorized outside-carrier deletion, put it in outside_carrier_excluded_ranges.",
		"11. Encode the corrected four-carrier plan in hard_root_claims before either range array. For each still-affirmed root, submit exactly one carrier_type, inclusive root_block_id, and exclusive semantic exit; use exit_block_id_exclusive=null only when the same Owner continues through EOF. Do not calculate projected ranges. The Harness intersects every claim with hardRootClaimProjectionUniverseRanges, including Candidate, ADD_REVIEW, and BOUNDARY_REVIEW markers whether or not an add is later accepted; it rejects empty projections and overlap across claims, then derives the hard exclusion union. Technical duties or duty_survival_attack cannot preserve content inside an affirmed root. To retain any descendant, first correct the root or exit in residual_reason. Never submit an ordinary OUT root whose span has no authorized projection.",
		fullRemovalDemotedToHardBoundaryReview
			? "11a. Project the corrected residual plan into outside_carrier_excluded_ranges. Candidate authority exists only when the typed hard delta removes at least one Candidate block and all remaining Candidate blocks form exactly one non-empty continuous address run. The run may be a prefix, suffix, middle island, or the sole surviving Candidate interval after every other Candidate interval is fully hard-excluded. Within that mechanically bounded residual, record compact counterexample-first survivor islands in residual_reason and submit only exact pure budget, pre-award proof/procedure, price/payment/settlement/guarantee, pure legal remedy, or bare-pointer atoms that remain safely separable after duty_survival_attack. Direct implementation, resources, plans/reports, records, data control, delivery, transitions, replacement, response, platform execution, staffing, quality, safety, acceptance, warranty, or result duties survive. Never place a four-carrier, restored block, a second residual run, or OUT here."
			: "11a. Project the corrected residual plan into outside_carrier_excluded_ranges. If whole_source_identity_veto applies, write every authorized challenged Candidate block covered by that terminal identity and do not run duty_survival_attack. Otherwise write exact outside-carrier atoms from REMOVE_REVIEW plus the sole continuous Candidate residual only when the hard delta includes at least one REMOVE_REVIEW Candidate block. In that residual, run peer-level outside_carrier_precision_closure and counterexample-first survival tests before compression; do not protect the range from a parent title or representative positive examples. Pure budget, pre-award proof/procedure, price/payment/settlement/guarantee, pure legal remedy, and bare pointers may be excluded when separable; direct implementation, resources, plans/reports, records, data control, delivery, transitions, replacement, response, platform execution, staffing, quality, safety, acceptance, warranty, or result duties survive. Never place a four-carrier, restored block, a second residual run, or OUT here. When the unlock conditions fail, do not run a global false-protection sweep over BASE_KEEP.",
		"12. Write accepted_add_ranges only for independently approved ADD_REVIEW or BOUNDARY_REVIEW blocks. Apply boundaryReviewContract before accepting any BOUNDARY_REVIEW address; never accept a partial selected-shell body whose remaining required island lies in ordinary OUT. Do not repeat Candidate keep ranges. Recheck that every deletion is authorized by the correct hard_root_claim or outside-carrier field; accepted additions stay inside the two bounded add markers and other OUT stays absent. Any REMOVE_REVIEW block covered by neither a Harness-derived hard projection nor outside_carrier_excluded_ranges is restored by the Harness. The Harness, not this model, composes the final set.",
		"13. TERMINAL_ACTION: Rewrite every draft into one complete five-field decision, then call submit_requirement_release exactly once as the first and only visible output. The tool arguments must contain hard_carrier_reason, residual_reason, hard_root_claims, outside_carrier_excluded_ranges, and accepted_add_ranges together. Do not emit analysis, prose, Markdown, pseudo-tool syntax, or partial JSON before or after the tool call; end immediately after the call.",
	].join("\n\n");
}

function parseStrictRanges(
	ranges: readonly string[],
	availableBlockIds: ReadonlySet<number>,
): ParsedRanges {
	const blockIds = new Set<number>();
	for (const rawRange of ranges) {
		const match = /^段落(\d+)(?:-段落(\d+))?$/.exec(rawRange.trim());
		if (!match) throw new Error(`invalid strict block range: ${rawRange}`);
		const start = Number(match[1]);
		const end = Number(match[2] ?? match[1]);
		if (start > end) throw new Error(`reversed strict block range: ${rawRange}`);
		for (let blockId = start; blockId <= end; blockId += 1) {
			if (!availableBlockIds.has(blockId)) {
				throw new Error(`strict block range references missing block ${blockId}: ${rawRange}`);
			}
			blockIds.add(blockId);
		}
	}
	const orderedBlockIds = [...blockIds].sort((left, right) => left - right);
	return { ranges: compactBlockRanges(orderedBlockIds), blockIds: orderedBlockIds };
}

function compactBlockRanges(blockIds: readonly number[]): string[] {
	const ordered = [...new Set(blockIds)].sort((left, right) => left - right);
	if (ordered.length === 0) return [];
	const ranges: string[] = [];
	let start = ordered[0];
	let end = ordered[0];
	for (const blockId of ordered.slice(1)) {
		if (blockId === end + 1) {
			end = blockId;
			continue;
		}
		ranges.push(start === end ? `段落${start}` : `段落${start}-段落${end}`);
		start = blockId;
		end = blockId;
	}
	ranges.push(start === end ? `段落${start}` : `段落${start}-段落${end}`);
	return ranges;
}

function deriveUniqueCandidateResidualAuthority(
	candidateBlockIds: readonly number[],
	hardExcludedBlockIds: readonly number[],
): number[] {
	const hardExcluded = new Set(hardExcludedBlockIds);
	if (!candidateBlockIds.some((blockId) => hardExcluded.has(blockId))) return [];
	const residualBlockIds = candidateBlockIds.filter((blockId) => !hardExcluded.has(blockId));
	if (residualBlockIds.length === 0) return [];
	const residualIsContinuous = residualBlockIds.every(
		(blockId, index) => index === 0 || blockId === residualBlockIds[index - 1] + 1,
	);
	return residualIsContinuous ? residualBlockIds : [];
}

function orderRangesByDescendingBlockCount(ranges: readonly string[]): string[] {
	return ranges
		.map((range, index) => {
			const match = /^段落(\d+)(?:-段落(\d+))?$/.exec(range);
			if (!match) throw new Error(`invalid compact block range: ${range}`);
			const start = Number(match[1]);
			const end = Number(match[2] ?? match[1]);
			return { range, index, blockCount: end - start + 1 };
		})
		.sort((left, right) => right.blockCount - left.blockCount || left.index - right.index)
		.map(({ range }) => range);
}

function renderSource(blocks: readonly RequirementReviewBlock[]): string {
	return blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n");
}

function renderReviewerSource(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
): string {
	return blocks
		.map(
			(block) =>
				`${candidateBlockIds.has(block.blockId) ? "IN" : "OUT"}|段落${block.blockId}：${block.text}`,
		)
		.join("\n");
}

function buildFocusedDuplicate(
	rows: readonly string[],
	maxBlocks: number,
	maxCharacters: number,
	label: string,
): FocusedDuplicate {
	const characterCount = rows.reduce((sum, row) => sum + row.length, 0);
	const included =
		rows.length > 0 && rows.length <= maxBlocks && characterCount <= maxCharacters;
	return {
		blockCount: rows.length,
		characterCount,
		included,
		source: included
			? rows.join("\n")
			: `focused ${label} duplicate omitted by deterministic all-or-nothing budget; use the complete source above`,
	};
}

function buildReleaseStructureFocus(
	structureMap: StructureMap,
	targetBlockIds: ReadonlySet<number>,
): ReleaseStructureFocus {
	if (!structureMap.provided || targetBlockIds.size === 0) {
		const source = "challenged-side structure focus unavailable for this release mode";
		return {
			targetNodeCount: 0,
			includedNodeCount: 0,
			renderedCharacterCount: source.length,
			coverage: "unavailable",
			source,
		};
	}

	const targetRows = structureMap.renderedRows.filter((row) => targetBlockIds.has(row.blockId));
	if (targetRows.length === 0) {
		const source = "no mechanically selected structure nodes intersect the challenged side";
		return {
			targetNodeCount: 0,
			includedNodeCount: 0,
			renderedCharacterCount: source.length,
			coverage: structureMap.coverage === "complete" ? "complete" : "partial",
			source,
		};
	}

	const render = (row: FocusSourceRow) => `CHANGE_STRUCTURE|${row.text}`;
	const completeSource = targetRows.map(render).join("\n");
	if (
		targetRows.length <= MAX_RELEASE_STRUCTURE_FOCUS_NODES &&
		completeSource.length <= MAX_RELEASE_STRUCTURE_FOCUS_CHARACTERS
	) {
		return {
			targetNodeCount: targetRows.length,
			includedNodeCount: targetRows.length,
			renderedCharacterCount: completeSource.length,
			coverage: structureMap.coverage === "complete" ? "complete" : "partial",
			source: completeSource,
		};
	}

	const selectedRows: FocusSourceRow[] = [];
	let renderedCharacterCount = 0;
	for (const index of spreadIndexes(targetRows.length)) {
		const row = targetRows[index];
		const rendered = render(row);
		const separatorCharacters = selectedRows.length > 0 ? 1 : 0;
		if (
			selectedRows.length >= MAX_RELEASE_STRUCTURE_FOCUS_NODES ||
			renderedCharacterCount + separatorCharacters + rendered.length >
				MAX_RELEASE_STRUCTURE_FOCUS_CHARACTERS
		) {
			continue;
		}
		selectedRows.push(row);
		renderedCharacterCount += separatorCharacters + rendered.length;
	}
	selectedRows.sort((left, right) => left.blockId - right.blockId);
	const source = selectedRows.map(render).join("\n");
	return {
		targetNodeCount: targetRows.length,
		includedNodeCount: selectedRows.length,
		renderedCharacterCount: source.length,
		coverage:
			structureMap.coverage === "complete" && selectedRows.length === targetRows.length
				? "complete"
				: "partial",
		source,
	};
}

function buildReleasePermissionTransitions(
	rows: readonly ReleaseSourceRow[],
): ReleasePermissionTransitions {
	const runs: Array<{ marker: ReleaseOverlayMarker; blockIds: number[] }> = [];
	for (const row of rows) {
		const previous = runs.at(-1);
		if (previous?.marker === row.marker) previous.blockIds.push(row.blockId);
		else runs.push({ marker: row.marker, blockIds: [row.blockId] });
	}
	const transitions: Array<{
		left: { marker: ReleaseOverlayMarker; blockIds: number[] };
		right: { marker: ReleaseOverlayMarker; blockIds: number[] };
	}> = [];
	for (let index = 0; index < runs.length - 1; index += 1) {
		const left = runs[index];
		const right = runs[index + 1];
		if (
			(left.marker === "REMOVE_REVIEW" && right.marker === "BASE_KEEP") ||
			(left.marker === "BASE_KEEP" && right.marker === "REMOVE_REVIEW")
		) {
			transitions.push({ left, right });
		}
	}
	if (transitions.length === 0) {
		return {
			totalCount: 0,
			renderedCount: 0,
			coverage: "none",
			source: "no direct REMOVE_REVIEW/BASE_KEEP permission transition",
		};
	}
	const selectedIndexes = spreadIndexes(transitions.length)
		.slice(0, MAX_RELEASE_PERMISSION_TRANSITIONS)
		.sort((left, right) => left - right);
	const source = selectedIndexes
		.map((index) => {
			const transition = transitions[index];
			return [
				"PERMISSION_TRANSITION",
				transition.left.marker,
				JSON.stringify(compactBlockRanges(transition.left.blockIds)),
				transition.right.marker,
				JSON.stringify(compactBlockRanges(transition.right.blockIds)),
			].join("|");
		})
		.join("\n");
	return {
		totalCount: transitions.length,
		renderedCount: selectedIndexes.length,
		coverage: selectedIndexes.length === transitions.length ? "complete" : "partial",
		source,
	};
}

function buildReleaseAdversarialNavigation(
	rows: readonly FocusSourceRow[],
	proposedRemoveBlockIds: ReadonlySet<number>,
	addBlockIds: ReadonlySet<number>,
): ReleaseAdversarialNavigation {
	const changeBlockIds = new Set([...proposedRemoveBlockIds, ...addBlockIds]);
	const rowCharacterBudget = Math.max(1, MAX_RELEASE_FOCUS_CHARACTERS - 256);
	const change = buildFocusedSource(
		rows,
		changeBlockIds,
		MAX_RELEASE_FOCUS_BLOCKS,
		rowCharacterBudget,
		"ATOMIC_CHANGE_TARGET",
	);
	const keep: FocusedSource = {
		targetBlockCount: 0,
		targetCharacterCount: 0,
		includedTargetBlockCount: 0,
		contextBlockCount: 0,
		renderedBlockCount: 0,
		renderedCharacterCount: 0,
		coverage: "omitted",
		source:
			"BASE_KEEP duplicate text omitted from atomic change navigation; use the complete source and structure map for the candidate-wide four-carrier sweep. Raw ordinary cleanup remains unauthorized; any runtime-declared hard-boundary residual authority is derived only after the typed hard delta.",
	};
	const source =
		change.renderedBlockCount === 0
			? "atomic navigation omitted; use the complete source above"
			: `## PROPOSED_CHANGE_SIDE\n${change.source}`;
	return {
		keep,
		change,
		renderedBlockCount: change.renderedBlockCount,
		renderedCharacterCount: source.length,
		source,
	};
}

function buildFocusedSource(
	rows: readonly FocusSourceRow[],
	targetBlockIds: ReadonlySet<number>,
	maxBlocks: number,
	maxCharacters: number,
	targetLabel:
		| "ATOMIC_KEEP_TARGET"
		| "ATOMIC_CHANGE_TARGET"
		| "CANDIDATE_BOUNDARY_WINDOW"
		| "CANDIDATE_INTERVAL_AUDIT_WINDOW",
): FocusedSource {
	const targetIndexes = rows
		.map((row, index) => (targetBlockIds.has(row.blockId) ? index : -1))
		.filter((index) => index >= 0);
	const targetCharacterCount = targetIndexes.reduce((sum, index) => sum + rows[index].text.length, 0);
	if (targetIndexes.length === 0 || maxBlocks <= 0 || maxCharacters <= 0) {
		return {
			targetBlockCount: targetIndexes.length,
			targetCharacterCount,
			includedTargetBlockCount: 0,
			contextBlockCount: 0,
			renderedBlockCount: 0,
			renderedCharacterCount: 0,
			coverage: "omitted",
			source: "atomic navigation side omitted because the target set is empty or no fixed budget remains",
		};
	}

	const targetRuns: Array<{ start: number; end: number }> = [];
	for (const index of targetIndexes) {
		const previous = targetRuns.at(-1);
		if (previous && index === previous.end + 1) previous.end = index;
		else targetRuns.push({ start: index, end: index });
	}
	const completeContextIndexes = new Set<number>();
	for (const run of targetRuns) {
		for (const index of [run.start - 1, run.end + 1]) {
			if (index >= 0 && index < rows.length && !targetBlockIds.has(rows[index].blockId)) {
				completeContextIndexes.add(index);
			}
		}
	}
	const renderIndexes = (
		targets: ReadonlySet<number>,
		contexts: ReadonlySet<number>,
	): string =>
		[...targets, ...contexts]
			.sort((left, right) => right - left)
			.map(
				(index) =>
					`${targets.has(index) ? targetLabel : "ATOMIC_CONTEXT"}|${rows[index].text}`,
			)
			.join("\n");
	const completeTargets = new Set(targetIndexes);
	const completeSource = renderIndexes(completeTargets, completeContextIndexes);
	if (
		completeTargets.size + completeContextIndexes.size <= maxBlocks &&
		completeSource.length <= maxCharacters
	) {
		return {
			targetBlockCount: targetIndexes.length,
			targetCharacterCount,
			includedTargetBlockCount: completeTargets.size,
			contextBlockCount: completeContextIndexes.size,
			renderedBlockCount: completeTargets.size + completeContextIndexes.size,
			renderedCharacterCount: completeSource.length,
			coverage: "complete",
			source: completeSource,
		};
	}

	const runPriorities = targetRuns.map((run) => {
		const priority: number[] = [];
		const seen = new Set<number>();
		const add = (index: number) => {
			if (index < run.start || index > run.end || seen.has(index)) return;
			seen.add(index);
			priority.push(index);
		};
		for (let distance = 0; distance <= FOCUS_BOUNDARY_WINDOW_BLOCKS; distance += 1) {
			add(run.start + distance);
			add(run.end - distance);
		}
		const length = run.end - run.start + 1;
		for (let denominator = 2; priority.length < length; denominator *= 2) {
			for (let numerator = 1; numerator < denominator; numerator += 2) {
				add(Math.round(run.start + ((run.end - run.start) * numerator) / denominator));
			}
			if (denominator >= length * 2) break;
		}
		for (let index = run.start; index <= run.end; index += 1) add(index);
		return priority;
	});
	const targetPriority: number[] = [];
	for (let offset = 0; ; offset += 1) {
		let found = false;
		for (const priority of runPriorities) {
			if (offset >= priority.length) continue;
			targetPriority.push(priority[offset]);
			found = true;
		}
		if (!found) break;
	}
	const selectedTargets = new Set<number>();
	const selectedContexts = new Set<number>();
	let renderedCharacterCount = 0;
	const addIndex = (
		index: number,
		kind: "target" | "context",
		blockLimit: number,
		characterLimit: number,
	): boolean => {
		if (selectedTargets.has(index) || selectedContexts.has(index)) return true;
		const rendered = `${kind === "target" ? targetLabel : "ATOMIC_CONTEXT"}|${rows[index].text}`;
		const separatorCharacters = selectedTargets.size + selectedContexts.size > 0 ? 1 : 0;
		if (
			selectedTargets.size + selectedContexts.size >= blockLimit ||
			renderedCharacterCount + separatorCharacters + rendered.length > characterLimit
		) {
			return false;
		}
		if (kind === "target") selectedTargets.add(index);
		else selectedContexts.add(index);
		renderedCharacterCount += separatorCharacters + rendered.length;
		return true;
	};
	const contextBlockReserve = Math.min(targetRuns.length * 2, Math.floor(maxBlocks / 8));
	const contextCharacterReserve = Math.floor(maxCharacters / 8);
	for (const index of targetPriority) {
		addIndex(
			index,
			"target",
			Math.max(1, maxBlocks - contextBlockReserve),
			Math.max(1, maxCharacters - contextCharacterReserve),
		);
	}
	for (const run of targetRuns) {
		for (const index of [run.start - 1, run.end + 1]) {
			if (index < 0 || index >= rows.length || targetBlockIds.has(rows[index].blockId)) continue;
			addIndex(index, "context", maxBlocks, maxCharacters);
		}
	}
	for (const index of targetPriority) addIndex(index, "target", maxBlocks, maxCharacters);
	const source = renderIndexes(selectedTargets, selectedContexts);
	return {
		targetBlockCount: targetIndexes.length,
		targetCharacterCount,
		includedTargetBlockCount: selectedTargets.size,
		contextBlockCount: selectedContexts.size,
		renderedBlockCount: selectedTargets.size + selectedContexts.size,
		renderedCharacterCount: source.length,
		coverage: selectedTargets.size === targetIndexes.length ? "complete" : "partial",
		source,
	};
}
function assertAnswerFreePacketValue(value: unknown, path = "$"): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertAnswerFreePacketValue(item, `${path}[${index}]`));
		return;
	}
	if (!isRecord(value)) return;
	for (const [key, child] of Object.entries(value)) {
		const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
		if (FORBIDDEN_PACKET_KEYS.has(normalized)) {
			throw new Error(`answer-bearing field is forbidden in requirement review packet: ${path}.${key}`);
		}
		assertAnswerFreePacketValue(child, `${path}.${key}`);
	}
}

function structuredInputSha256(input: {
	systemPrompt: string;
	userPrompt: string;
	toolName: string;
	toolLabel: string;
	toolDescription: string;
	schema: TSchema;
}): string {
	return sha256(
		JSON.stringify({
			systemPrompt: input.systemPrompt,
			userPrompt: input.userPrompt,
			tool: {
				name: input.toolName,
				label: input.toolLabel,
				description: input.toolDescription,
				parameters: input.schema,
			},
		}),
	);
}

function fitsContext(model: Model<Api>, estimatedInputTokens: number, maxTokens: number): boolean {
	return estimatedInputTokens + maxTokens + CONTEXT_SAFETY_TOKENS <= model.contextWindow;
}

function estimateTextTokens(value: string): number {
	let ascii = 0;
	let nonAscii = 0;
	for (const character of value) {
		if (character.charCodeAt(0) <= 0x7f) ascii += 1;
		else nonAscii += 1;
	}
	return nonAscii + Math.ceil(ascii / 4) + 512;
}

function recordUsage(target: RoleUsage, usage: Usage): void {
	target.inputTokens += usage.input;
	target.outputTokens += usage.output;
	target.cacheReadTokens += usage.cacheRead;
	target.cacheWriteTokens += usage.cacheWrite;
	target.reasoningTokens += usage.reasoning ?? 0;
}

function assertUsageBudget(usage: RuntimeUsage): void {
	const total = totalUsage(usage);
	if (total.inputTokens > MAX_RUN_INPUT_TOKENS) {
		throw new Error("requirement review input-token budget exhausted");
	}
	if (total.outputTokens > MAX_RUN_OUTPUT_TOKENS) {
		throw new Error("requirement review output-token budget exhausted");
	}
	if (total.reasoningTokens > MAX_RUN_REASONING_TOKENS) {
		throw new Error("requirement review reasoning-token budget exhausted");
	}
}

function totalUsage(usage: RuntimeUsage): RoleUsage {
	const total = emptyUsage();
	for (const role of Object.values(usage)) {
		total.providerCalls += role.providerCalls;
		total.inputTokens += role.inputTokens;
		total.outputTokens += role.outputTokens;
		total.cacheReadTokens += role.cacheReadTokens;
		total.cacheWriteTokens += role.cacheWriteTokens;
		total.reasoningTokens += role.reasoningTokens;
		total.elapsedMs += role.elapsedMs;
	}
	return total;
}

function emptyUsage(): RoleUsage {
	return {
		providerCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		elapsedMs: 0,
	};
}

function failureFromError(role: Role, error: unknown, signal: AbortSignal): RequirementReviewFailure {
	const message = errorMessage(error);
	if (signal.aborted) {
		const timeout = /timed out|timeout/iu.test(errorMessage(signal.reason));
		return { role, code: timeout ? "timeout" : "aborted", message };
	}
	if (/timed out|timeout/iu.test(message)) return { role, code: "timeout", message };
	if (/abort/iu.test(message)) return { role, code: "aborted", message };
	if (/schema|contract|json|range|block|budget|tool call|validation/iu.test(message)) {
		return { role, code: "contract_error", message };
	}
	return { role, code: "provider_error", message };
}

function modelIdentity(model: Model<Api>): { provider: string; id: string; contextWindow: number } {
	return { provider: model.provider, id: model.id, contextWindow: model.contextWindow };
}

function userMessage(text: string): Message[] {
	return [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }];
}

function convertMessages(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message): message is Message =>
			typeof message === "object" &&
			message !== null &&
			"role" in message &&
			(message.role === "user" || message.role === "assistant" || message.role === "toolResult"),
	);
}

function matchingToolCalls(
	messages: readonly AgentMessage[],
	toolName: string,
): AgentToolCall[] {
	const calls: AgentToolCall[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const content of message.content) {
			if (content.type === "toolCall" && content.name === toolName) calls.push(content);
		}
	}
	return calls;
}

function assistantJsonTerminal(
	message: AssistantMessage,
): { text: string; submissionMode: "strict_json_text" | "embedded_json_text" } | null {
	const visibleText = message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("")
		.trim();
	const text =
		visibleText ||
		message.content
			.filter((content) => content.type === "thinking")
			.map((content) => content.thinking)
			.join("")
			.trim();
	if (!text) return null;
	const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
	const unfenced = (fenced?.[1] ?? text).trim();
	if (fenced || (unfenced.startsWith("{") && unfenced.endsWith("}"))) {
		return { text: unfenced, submissionMode: "strict_json_text" };
	}
	const embedded = extractSingleJsonObject(unfenced);
	return embedded === null
		? null
		: { text: embedded, submissionMode: "embedded_json_text" };
}

function extractSingleJsonObject(value: string): string | null {
	const start = value.indexOf("{");
	if (start < 0 || value.slice(0, start).includes("}")) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	let end = -1;
	for (let index = start; index < value.length; index += 1) {
		const character = value[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === "{") depth += 1;
		else if (character === "}") {
			depth -= 1;
			if (depth === 0) {
				end = index;
				break;
			}
			if (depth < 0) return null;
		}
	}
	if (end < 0 || inString || value.slice(end + 1).match(/[{}]/u)) return null;
	return value.slice(start, end + 1);
}

function lastAssistant(messages: readonly AgentMessage[]): AssistantMessage | undefined {
	return [...messages].reverse().find((message): message is AssistantMessage => message.role === "assistant");
}

function terminalResult(payload: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		details: payload,
		terminate: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
