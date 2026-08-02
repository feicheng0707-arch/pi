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
const MAX_HARD_RESIDUAL_ISLANDS = 3;
const MAX_HARD_RESIDUAL_BLOCKS = 64;
const MAX_HARD_RESIDUAL_CANDIDATE_RATIO = 0.1;
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
	"candidate-protected-hybrid-v176-off-release-root-payload-closure";
const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const promptDirectory = resolve(
	extensionDirectory,
	"../../skills/word-requirement-extraction-reviewer/references",
);
const RangeSchema = Type.String({ pattern: "^段落\\d+(?:-段落\\d+)?$" });
const ReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Settle role_evidence and instantiation_evidence first, then audit Candidate intervals in the address-only candidateHardCarrierAuditOrder before narrating smaller ranges. Apply concise_root_grouping: Candidate intervals sharing one actual source-proven ancestor root are one root->peer-exit judgment, and every Candidate intersection of that root must be projected together. A hard-carrier hit clears only its own root-to-exit range: explicitly form the surviving Candidate residual and split it at every peer heading, subsection, table segment, or equivalent functional boundary. Never use an ancestor chapter label as a keep verdict for all residual descendants. Use compact root->semantic-exit decisions and complete outside_carrier_precision_closure on every surviving residual island. Instantiation requires at least one already-filled fact that distinguishes the current procurement object, scope, work package, quantity, site, or commissioned relationship; a template/version number, procuring organization, generic batch label, platform operation, bid timetable, default clause, blank table, or external pointer cannot establish it alone. Test rather than assume a whole-document communicative role: one notice Owner may govern the source only when an actual notice root begins one uninterrupted, functionally homogeneous outward act through its true end and no peer qualification, evaluation, contract, response-format, requirement, specification, drawing, list, or technical-appendix root disproves it. A physical procurement file or invitation container is never itself a hard-excluded carrier root. Carrier Owner is decided before block-level primary effect: never apply the primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier. For every disputed broad exclusion, include one compact bidirectional carrier_root_exit_attack naming the source-proven carrier root and the first later peer root whose source function changes Owner, or EOF. A structural sc/vc exit closes one physical scope only: if the peer remains the same Owner, chain through that scope and continue searching. Attack both directions: truncate an exclusion that crosses an earlier different-Owner exit, and split a proposed keep when any internal subsection starts a new four-class carrier. No actual root means no carrier. Once a hard-excluded root is established, exclusion is root-closed: the root itself, every child clause and embedded attachment, and every consecutive same-Owner peer continuation remain excluded until the semantic Owner exit; primary-effect and duty-survival tests cannot reopen them. Consecutively numbered contract attachments remain in that contract Owner until the next source-proven same-or-higher-rank different-Owner peer; a signature block or one attachment ending never truncates the sequence. An explicit chapter-level announcement or notice root remains active through every numbered child subsection until the next source-proven peer chapter; a child project-overview, scope, period, location, quality, or technical table can never be its exit. A hard-excluded local carrier can begin at a numbered, bold, centered, or plain-text subsection even when nested inside a chapter mixing technical, service, business, contract, or other requirements. Treat such an aggregate parent as a mixed container, not as one Owner grant: before any block-level effect test, run one mixed_container_root_sweep over its child heading candidates and classify every source-proven local four-class root. If a tentative final drops payment, guarantee, or legal children but keeps service period, location, quality, acceptance, personnel, or technical children after the same local root, that holey selection proves the atom gate ran too early; either disprove the root from source or exclude the complete root-closed interval. If the complete source is one hard-excluded carrier with no source-proven different-Owner exit, that is a terminal null decision; do not reopen internal blocks by technical usefulness. When structure navigation is provided, reconcile every disputed root/exit with sc/path: a deeper attachment, technical title, or table is a child and cannot be an exit; the first same-or-shallower candidate must be read and semantically classified before reopening. A qualified cross-reference never transfers membership to a referenced excluded appendix, and a direct must-comply duty in an independent technical chapter is not a bare pointer merely because it is short or general. For every mixed source-proven non-excluded chapter touched by the final patch, include one compact mixed_chapter_audit with literal keep/remove address islands. Before deleting any outside-carrier block, run duty_survival_attack: strip approval, filing, cost, deduction, breach, termination, damages, or other incidental consequences and preserve the indivisible block if the remaining clause still directly requires implementation, resources, plans/reports, records, delivery, timed replacement or replenishment, response, platform execution, or a result. Direct work effect does not require a supplier imperative: deliverable accuracy, completeness, error or quality accountability; inspection, review or acceptance tied to deliverable quality or correction; and current-version, replacement or precedence rules for applicable technical standards all survive. Grammar is not the gate: when an indivisible block states a direct guarantee, prohibition, quality/result baseline, or a specifically negated supplier-controlled failure before its remedy, strip the remedy and polarity-normalize that antecedent. Preserve the block when the normalized remainder is a concrete executable or verifiable duty such as timely maintenance, a correct stable version, non-infringement, or avoiding rework. Generic breach, noncompliance, misconduct, loss, or quality-problem labels without an action, threshold, deliverable result, or correction duty remain pure remedy triggers. Confidentiality duties that directly control storage, processing, transmission, copying, disclosure, retention, return, or destruction of project data are surviving data-control work duties outside a true contract carrier. A platform-execution command remains a direct duty when termination is only its consequence. Post-award submission, review, approval, filing, and record management are performance workflow, not procurement procedure. A complete bid/response mandatory-requirements section or table remains pre-award response Owner even when it describes future staff. Close personnel Stage Owner at subsection level first: when a rooted subsection with a peer exit jointly uses multiple credentials, social-insurance proofs, commitments, or invalid-response consequences to define pre-award admissibility, its root and all children inherit that Owner through the exit; one future-staffing child cannot carve out a keep island. Only when source proves the subsection is primarily post-award staffing may a separable proof note begin at its operative fill, attach, or submit-proof block; adjacency alone never expands that local atom backward. Pure contract formation, breach remedy, termination, dispute, governing-law, or general legal-risk blocks with no surviving direct work duty belong on the remove side. Then state the case-level impact. Apply final_payload_closure: if no substantive current-project payload survives, a pure title, document identity, cover, or navigation shell cannot remain as the only final payload. Compute the settled Candidate keep islands and remove islands once, choose the valid removal branch with fewer disjoint ranges, and use exact on a tie. Every exact remove range must contain only blocks already judged safe to delete; every complement preserve range must be a block already judged necessary. source_role=non_procurement or instantiation=absent is a terminal null claim and must leave no Candidate or add block. Range fields must be an exact projection of this settled reason.",
});
const ReleaseHardCarrierReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Phase 1 only. Begin from the complete Candidate-only IN/OUT source, where Reviewer challenge markers are absent. Audit Candidate intervals in candidateHardCarrierAuditOrder and state only actual announcement/notice, bidder or supplier instruction, bid/response/quotation-format, and contract-terms/format roots with compact root->semantic-exit addresses. Apply concise_root_grouping before listing ranges: Candidate intervals sharing one actual source-proven ancestor root are one root->peer-exit judgment, and hard_hypothesis must list every Candidate intersection of that root together. Candidate need not contain the root title: inspect source ancestors before each Candidate interval and include the Candidate intersection when a root begins in OUT. A chapter-level root can end only at a source-proven same-or-higher-rank peer; lower-rank numbered scope, schedule, standard, table, or technical-summary children remain descendants. Consecutively numbered contract attachments remain in the same contract Owner until the next source-proven same-or-higher-rank different-Owner peer; neither a signature block nor the end of one attachment is an exit. Mixed or multi-carrier rejects only a whole-source identity and never cancels a named local root. Do not adjudicate outside-carrier price, payment, legal, proof, or work-duty atoms in this field. Keep the entire field under 900 characters and end with one compact hard_hypothesis=<ranges or none> clause listing every Candidate intersection of the named roots. The later hard_excluded_ranges field must exactly project the corrected four-carrier plan and may be empty only when no root remains affirmed.",
});
const ReleaseResidualReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Phase 2 only. Adversarially test the Phase 1 hard-carrier hypothesis and correct every overbroad or incomplete root/exit decision. A chapter-level root can end only at a source-proven same-or-higher-rank peer; never promote a lower-rank numbered scope, schedule, standard, table, or technical-summary child into its own exit. Candidate omission of the root title is not a retraction: if source proves an OUT ancestor root, its Candidate descendants remain in the hard projection. Every Phase 1 hard range must either remain in the final hard projection or be explicitly retracted or narrowed here with a source-proven peer exit; silent omission is forbidden. Adjudicate every authorized REMOVE_REVIEW or ADD_REVIEW block outside the corrected hard-carrier plan. When the typed hard projection satisfies boundedMinorityResidualContract for the current mode, also audit the complete mechanically derived residual scope; in reviewer_no_change_hard mode this is the only partial outside-carrier authority. A non-empty residual cannot be dismissed as already hard-excluded. Apply boundedResidualPartitionInvariant: when a derived residual is authorized, state one compact bounded_residual_partition=scope:<ranges>;outside:<ranges or none>;survive:<ranges or none> clause that completely partitions every residual address before other Phase 2 detail. Apply compact over-deletion, counterexample-first duty, response-wrapper, source-fidelity, and three remainder tests only where authorized. If an authorized residual contains a project overview or equivalent current-project summary, execute the system-defined project_fact_membership_attack and include project_fact_membership_attack=scope:<ranges>;remove:<ranges or none>;survive:<ranges or none>; scope addresses must be completely partitioned and a skipped drafting/filling instruction is incomplete. preamble_peer_reset_test is disabled for numbered children inside a proven notice root. Before final_projection, apply survivorProjectionInvariant and state one compact survivor_projection=<ranges or none> covering every authorized block this reason says must remain; neither exclusion field may overlap it. Then apply final_payload_closure within the authorized envelope: when no substantive current-project payload survives, a pure title, document identity, cover, or navigation shell cannot remain as the only final payload. Keep the entire field under 900 characters and end with exactly one compact final_projection=hard:<ranges or none>;outside:<ranges or none>;add:<ranges or none> clause. The following three range fields must copy that corrected projection without overlap or omission.",
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
		hard_excluded_ranges: Type.Array(RangeSchema, {
			maxItems: 64,
			description:
				"After both reason fields have converged, exactly project the settled four-carrier plan. Candidate need not contain the root title: when an actual root starts in OUT, include every authorized Candidate, ADD_REVIEW, or BOUNDARY_REVIEW descendant in its root-to-semantic-exit intersection. For every actual announcement/notice, bidder or supplier instruction, bid/response/quotation format, or contract terms/format root still affirmed by residual_reason, list every authorized block from that root through its semantic peer exit, regardless of REMOVE_REVIEW or BASE_KEEP. An affirmed root and a partial descendant subset is forbidden: technical duties, usefulness, primary effect, and duty_survival_attack cannot preserve a block inside it. If any descendant should remain, first retract or narrow the root or establish an earlier different-Owner exit in residual_reason. A range described as outside-carrier, retracted from the hard plan, or included in survivor_projection is forbidden here even when it belongs to REMOVE_REVIEW. This is the only field that may delete BASE_KEEP. Never include ordinary OUT. The Harness clips this field to Candidate or an authorized add marker and subtracts authorized Candidate blocks mechanically. Use [] only when the corrected plan affirms no four-carrier block.",
		}),
		outside_carrier_excluded_ranges: Type.Array(RangeSchema, {
			maxItems: 64,
			description:
				"Write this bounded outside-carrier deletion authorization after hard_excluded_ranges. If a whole-source identity veto is independently proven, list the runtime-authorized Candidate blocks here and do not run atom-level duty_survival_attack. Otherwise list only blocks already proven outside all four hard-excluded carriers whose own primary direct effect is safely separable non-requirement content; run duty_survival_attack first and split around every surviving direct work duty, short normative obligation, necessary heading, or source-fidelity dependency. This field must be disjoint from survivor_projection. Ordinary authority is limited to REMOVE_REVIEW or ADD_REVIEW. Candidate BASE_KEEP may additionally be listed only inside a runtime-declared hard-boundary residual scope: the typed hard projection must unlock the current mode, and Candidate minus hard exclusions must satisfy boundedMinorityResidualContract. In reviewer_no_change_hard mode, this is the only partial outside-carrier authority; full-Candidate terminal veto remains separately available. The Harness derives and clips both scopes mechanically. Never encode a four-carrier block here or include unchallenged OUT. Use [] when no authorized outside-carrier block is safely excludable.",
		}),
		accepted_add_ranges: Type.Array(RangeSchema, {
			maxItems: 64,
			description:
				"Write this positive delta after both reason fields and both exclusion deltas. List only ADD_REVIEW blocks independently approved as qualified requirement content, or BOUNDARY_REVIEW blocks independently proven to be the complete same-Owner body, table, list, continuation, or appendix needed to close an adjacent Candidate shell. Omit rejected additions and reject any partial body whose required continuation extends into ordinary OUT. Candidate blocks and all other OUT are unauthorized and will be clipped mechanically. Do not repeat Candidate keep ranges; every Candidate block remains selected unless an authorized exclusion field subtracts it.",
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
	| "reviewer_confirmed_hard"
	| "reviewer_no_change_hard";

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
	hashes: {
		productPrinciples: string;
		semanticContract: string;
		runtimeContract: string;
		reviewer: string;
		release: string;
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

interface ReleaseDecision {
	verdict: "reject" | "publish";
	hardCarrierReason: string;
	restoredRemoveRanges: string[];
	submittedHardExcludedRanges: string[];
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
	const [productPrinciples, semanticContract, runtimeContract, reviewer, release] = await Promise.all([
		readFile(resolve(directory, "product-principles.md"), "utf8"),
		readFile(resolve(directory, "semantic-contract.md"), "utf8"),
		readFile(resolve(directory, "runtime-contract.md"), "utf8"),
		readFile(resolve(directory, "reviewer.md"), "utf8"),
		readFile(resolve(directory, "release.md"), "utf8"),
	]);
	return {
		productPrinciples,
		semanticContract,
		runtimeContract,
		reviewer,
		release,
		hashes: {
			productPrinciples: sha256(productPrinciples),
			semanticContract: sha256(semanticContract),
			runtimeContract: sha256(runtimeContract),
			reviewer: sha256(reviewer),
			release: sha256(release),
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
				maxHardResidualIslands: MAX_HARD_RESIDUAL_ISLANDS,
				maxHardResidualBlocks: MAX_HARD_RESIDUAL_BLOCKS,
				maxHardResidualCandidateRatio: MAX_HARD_RESIDUAL_CANDIDATE_RATIO,
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
					"reviewer_no_change_hard",
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
		hardBoundaryResidualPrecisionMode = reviewerNoChangeHardCarrierAudit
			? "reviewer_no_change_hard"
			: fullRemovalDemotedToHardBoundaryReview
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
						? "Complete one independent terminal-or-hard audit. Write hard_carrier_reason and residual_reason before every range field. For a proven whole-source non-procurement, completed-supplier-response, contract-only, or uninstantiated-template identity, submit exactly the complete Candidate in outside_carrier_excluded_ranges and leave all other deltas empty. Otherwise, submit independently proven four-carrier Candidate descendants in hard_excluded_ranges. Only after that typed hard projection may outside_carrier_excluded_ranges contain exact atoms from the complete address-derived residual authorized by boundedMinorityResidualContract; additions and ordinary Candidate-wide cleanup remain unauthorized. Submit an empty delta when no terminal veto, hard carrier, or authorized residual exclusion is proven."
						: "Complete one phased Release submission. Write hard_carrier_reason and residual_reason before every range field so the residual adversarial pass can correct an overbroad or incomplete four-carrier hypothesis. Then write the two deletion authorizations and accepted additions. Candidate need not contain a hard-carrier root title: inspect source ancestors and project every Candidate descendant of an affirmed OUT-starting root. Every actual four-carrier root still affirmed by residual_reason must be projected root-closed through its semantic exit in hard_excluded_ranges regardless of marker; narrow or retract the root before omitting any descendant. After the typed hard projection, the Harness may expose the complete address-derived residual allowed by boundedMinorityResidualContract for outside-carrier precision: full-removal safety requires any Candidate hard exclusion, while a normal bounded patch additionally requires at least one hard-excluded REMOVE_REVIEW block. For operational_precision, omit every challenged block that should remain from both exclusion fields. ADD_REVIEW is the Reviewer-proposed external subset. BOUNDARY_REVIEW is a separate content-blind, address-bounded external subset around Candidate run edges; accept it only when the complete immutable source proves that the entire authorized island is the same qualified body, table, list, continuation, or appendix needed to close an adjacent Candidate shell. It is not permission to search for unrelated omissions, and a partial body extending outside the authorized envelope must be rejected. Other OUT is unavailable. The Harness derives all executable authority, automatic restoration, and final ranges mechanically.",
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
	label: "Review Word requirement extraction candidate",
	description:
		"Run one candidate-protected residual review over an answer-free xique.word-requirement-review.packet.v1 packet. An empty-candidate pass uses one Doubao call. Every non-empty Candidate receives one independent GLM Release call: bounded patch review after a contract-valid challenge, or a protected terminal-or-hard veto audit after Reviewer pass/no-op/contract failure.",
	promptSnippet: "Review a frozen Word requirement extraction candidate",
	promptGuidelines: [
		"Call this tool once after the mature single-prompt candidate and complete immutable paragraph packet exist. Report degraded review without changing ranges when the capability fails closed.",
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
		hard_excluded_ranges: normalizeRangeArray(value.hard_excluded_ranges ?? []),
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
	const submittedHardExclusions = parseStrictRanges(raw.hard_excluded_ranges, availableBlockIds);
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
	const acceptedAddBlockIds = submittedAcceptedAdditions.blockIds.filter((blockId) =>
		allowedAdd.has(blockId),
	);
	const acceptedAdd = new Set(acceptedAddBlockIds);
	const hardExcludedBlockIds = submittedHardExclusions.blockIds.filter(
		(blockId) =>
			(candidate.has(blockId) || allowedAdd.has(blockId)) &&
			!acceptedAdd.has(blockId),
	);
	const hardExcluded = new Set(hardExcludedBlockIds);
	const removeEnvelope = new Set(removeEnvelopeBlockIds);
	const hardBoundaryResidualUnlocked =
		hardBoundaryResidualPrecisionMode === "full_removal_safety" ||
		hardBoundaryResidualPrecisionMode === "reviewer_no_change_hard" ||
		(hardBoundaryResidualPrecisionMode === "reviewer_confirmed_hard" &&
			hardExcludedBlockIds.some((blockId) => removeEnvelope.has(blockId)));
	const hardBoundaryResidualAuthorityBlockIds = hardBoundaryResidualUnlocked
		? deriveBoundedCandidateResidualAuthority(candidateBlockIds, hardExcludedBlockIds)
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
		restoredRemoveRanges: compactBlockRanges(restoredRemoveBlockIds),
		submittedHardExcludedRanges: submittedHardExclusions.ranges,
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
		"2. Audit every Candidate interval in candidateHardCarrierAuditOrder. Apply concise_root_grouping: intervals sharing one actual source-proven ancestor root are one root-to-peer-exit judgment and all Candidate intersections must be projected together. Consecutively numbered contract attachments remain in that root until the next same-or-higher-rank different-Owner peer; a signature block or one attachment ending is not an exit. Then mentally subtract all affirmed hard ranges.",
		"3. On every surviving Candidate island, execute the system residual gates at each peer subsection and addressable block. Run residual_island_completion and false_protection_counterexample_attack: split out the strongest safely removable counterexample and repeat until no system-defined non-requirement island remains. A parent title or representative positive block never proves the whole residual; an indivisible block with a surviving direct work duty remains.",
		"3a. Before preserving any peer-rooted bill-of-quantities, quotation, pricing, measurement, settlement, or price-basis island, execute pricing_basis_role_attack and price_wrapper_empty_remainder_test at each child boundary. Drawings, standards, site facts, quantities, plans, and technical nouns used only to calculate, compile, fill, compare, validate, or allocate price do not survive. Preserve only exact children whose stripped remainder still states concrete current-project work scope, action, resource provision, quantity, safety, delivery, acceptance, or another direct non-price duty. A chapter that only explains how to price or points to an absent schedule is not the schedule itself.",
		"4. Close source fidelity. Re-read literal IN/OUT for every proposed change; any affirmed qualified OUT body island must be in add_ranges, and no unproved OUT block may be added.",
		"5. Settle final = Candidate + add - remove once and apply final_payload_closure: when no substantive current-project payload survives, do not leave a pure title, document identity, cover, or navigation shell as the only final payload. source_role=non_procurement or instantiation=absent means null for a non-empty Candidate. Otherwise choose the shorter legal exact/complement encoding, exact on a tie. pass is legal only for canonical add=none and remove=none.",
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
		"# Mechanical Release context",
		"sourceCoverage=complete",
		"reviewerNarrativeAndEvidenceVisibility=withheld",
		"releaseAuditMode=reviewer_no_change_terminal_or_hard_veto",
		"hardBoundaryResidualPrecisionMode=reviewer_no_change_hard",
		"reviewerNoChangeHardCarrierAudit=true",
		"survivorProjectionInvariant=system",
		"boundedResidualPartitionInvariant=system",
		"reviewerNoChangeReleaseAuthority=complete-candidate-terminal-veto-or-candidate-wide-hard-carrier-veto-plus-address-bounded-hard-residual",
		"challengeIssueType=reviewer_no_change_audit",
		"challengeAddRanges=[]",
		"challengeRemoveRanges=[]",
		"releaseRemoveEnvelopeRanges=[]",
		"boundaryReviewRanges=[]",
		`availableSourceRanges=${JSON.stringify(compactBlockRanges(blocks.map((block) => block.blockId)))}`,
		`candidateRanges=${JSON.stringify(candidateRanges)}`,
		`candidateHardCarrierAuditOrder=${JSON.stringify(candidateHardCarrierAuditOrder)}`,
		`candidateBlockCount=${candidateBlockIds.size}`,
		"permissionSummary=Every Candidate block is BASE_KEEP. The selected system mode alone defines terminal, hard-carrier, and derived residual authority; there is no Reviewer patch or ordinary OUT authority.",
		"# Complete immutable source with Candidate-only IN/OUT membership",
		source,
		"# Optional mechanically aligned Word structure map",
		structureMap.source,
		"# Compact Release task card",
		"Apply runtime-contract.md and release.md from the system prompt as the sole semantic authority. This user turn supplies only immutable evidence, dynamic permissions, and execution order.",
		"1. Read the complete source through beginning, middle, and end, then audit Candidate intervals in candidateHardCarrierAuditOrder.",
		"2. Write hard_carrier_reason first. Apply concise_root_grouping: intervals sharing one actual source-proven ancestor root are one root-to-peer-exit judgment and all Candidate intersections must be projected together. Consecutively numbered contract attachments continue until the next same-or-higher-rank different-Owner peer; a signature block or one attachment ending is not an exit. Do not write any range field until the Candidate-wide hypothesis is complete.",
		"3. Write residual_reason second. Adversarially correct Phase 1. If the hard projection unlocks a residual, begin with a complete bounded_residual_partition and enforce boundedResidualPartitionInvariant; then state survivor_projection, enforce survivorProjectionInvariant, apply final_payload_closure so a pure title or identity shell cannot be the only survivor after substantive payload reaches zero, and end with one final_projection clause.",
		"4. Copy that settled projection exactly into hard_excluded_ranges, outside_carrier_excluded_ranges, and accepted_add_ranges. If no authorized change survives, submit three empty arrays.",
		"5. TERMINAL_ACTION: Call submit_requirement_release exactly once as the first and only visible output with all five fields, then end.",
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
		"# Mechanical Release context",
		"sourceCoverage=complete",
		"reviewerNarrativeAndEvidenceVisibility=withheld",
		"independentSourceMembership=Candidate-only-IN-OUT",
		`availableSourceRanges=${JSON.stringify(compactBlockRanges(blocks.map((block) => block.blockId)))}`,
		`candidateRanges=${JSON.stringify(candidateRanges)}`,
		`candidateHardCarrierAuditOrder=${JSON.stringify(candidateHardCarrierAuditOrder)}`,
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
			? "permissionSummary=The ordinary full-Candidate removal envelope is withdrawn. Candidate is BASE_KEEP; ADD_REVIEW remains bounded; BOUNDARY_REVIEW is disabled; system hard-carrier and derived-residual rules control all Candidate deletion."
			: releaseHasRemoval
				? "permissionSummary=REMOVE_REVIEW is the exact Reviewer-proposed Candidate subset; ADD_REVIEW and BOUNDARY_REVIEW are the only external add envelopes; all other Candidate is BASE_KEEP and all other OUT is unavailable."
				: "permissionSummary=The patch is add-only. Candidate is BASE_KEEP; ADD_REVIEW and BOUNDARY_REVIEW are the only external add envelopes; all other OUT is unavailable.",
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
		"navigationPurpose=Source, structure, focus, and permission-transition views are answer-free navigation. Markers, metrics, formatting, and missing rows are not semantic evidence, confidence, votes, or Owner exits.",
		"boundaryReviewDirectionContract=system",
		"contractAttachmentSequenceContract=system",
		"survivorProjectionInvariant=system",
		"boundedResidualPartitionInvariant=system",
		"# Complete immutable source with Candidate-only IN/OUT membership",
		source,
		"# Optional mechanically aligned Word structure map",
		structureMap.source,
		"# Text-blind challenged-side atomic navigation view",
		focusedReview.source,
		"# Challenged-side structural navigation focus",
		challengeStructureFocus.source,
		"# Address-only REMOVE_REVIEW/BASE_KEEP permission transitions",
		permissionTransitions.source,
		"# Compact Release task card",
		"Apply runtime-contract.md and release.md from the system prompt as the sole semantic authority. This user turn supplies only immutable evidence, dynamic permissions, and execution order.",
		"1. Read the complete source before the bounded navigation views. Audit Candidate intervals in candidateHardCarrierAuditOrder; markers and metrics never decide semantics.",
		"2. Write hard_carrier_reason first and complete the Candidate-wide four-carrier hypothesis. Apply concise_root_grouping: intervals sharing one actual source-proven ancestor root are one root-to-peer-exit judgment and all Candidate intersections must be projected together. Consecutively numbered contract attachments continue until the next same-or-higher-rank different-Owner peer; a signature block or one attachment ending is not an exit. Do not write any range field yet.",
		"3. Write residual_reason second. Adversarially correct Phase 1 and adjudicate only the authorized envelope. If the hard projection unlocks a residual, begin with a complete bounded_residual_partition and enforce boundedResidualPartitionInvariant. Explicitly apply the system boundaryReviewDirectionContract and contractAttachmentSequenceContract where relevant, then state survivor_projection, enforce survivorProjectionInvariant, and apply final_payload_closure so a pure title or identity shell cannot be the only survivor after substantive payload reaches zero. End with one final_projection clause.",
		"4. Copy the settled projection exactly into hard_excluded_ranges, outside_carrier_excluded_ranges, and accepted_add_ranges. Omit final keeps from both exclusion fields and never add ordinary OUT.",
		"5. TERMINAL_ACTION: Call submit_requirement_release exactly once as the first and only visible output with all five fields, then end.",
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

function deriveBoundedCandidateResidualAuthority(
	candidateBlockIds: readonly number[],
	hardExcludedBlockIds: readonly number[],
): number[] {
	const hardExcluded = new Set(hardExcludedBlockIds);
	if (!candidateBlockIds.some((blockId) => hardExcluded.has(blockId))) return [];
	const residualBlockIds = candidateBlockIds.filter((blockId) => !hardExcluded.has(blockId));
	if (residualBlockIds.length === 0) return [];
	const residualIslandCount = compactBlockRanges(residualBlockIds).length;
	if (residualIslandCount === 1) return residualBlockIds;
	const residualCandidateRatio = residualBlockIds.length / candidateBlockIds.length;
	return residualIslandCount <= MAX_HARD_RESIDUAL_ISLANDS &&
		residualBlockIds.length <= MAX_HARD_RESIDUAL_BLOCKS &&
		residualCandidateRatio <= MAX_HARD_RESIDUAL_CANDIDATE_RATIO
		? residualBlockIds
		: [];
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
