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
const REVIEWER_MODEL_ID = "doubao-seed-2-0-lite-260428";
const RELEASE_PROVIDER = "pi-requirement-release-gemini";
const RELEASE_MODEL_ID = "gemini-3.1-pro-preview";
const DEFAULT_REVIEWER_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_RELEASE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_PACKET_BYTES = 20 * 1024 * 1024;
const REVIEWER_MAX_TOKENS = 4_000;
const RELEASE_MAX_TOKENS = 19_000;
const RELEASE_THINKING_BUDGET_TOKENS = 16_384;
const REQUEST_TIMEOUT_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 600_000;
const CONTEXT_SAFETY_TOKENS = 8_000;
const MAX_PROVIDER_CALLS = 2;
const MAX_RUN_INPUT_TOKENS = 480_000;
const MAX_RUN_OUTPUT_TOKENS = 24_000;
const MAX_RUN_REASONING_TOKENS = 30_000;
const MAX_REVIEWER_FOCUS_BLOCKS = 256;
const MAX_REVIEWER_FOCUS_CHARACTERS = 20_000;
const MAX_RELEASE_FOCUS_BLOCKS = 128;
const MAX_RELEASE_FOCUS_CHARACTERS = 20_000;
const FOCUS_BOUNDARY_WINDOW_BLOCKS = 16;
const MAX_STRUCTURE_MAP_NODES = 384;
const MAX_STRUCTURE_MAP_CHARACTERS = 36_000;
const MAX_STRUCTURE_TEXT_PREVIEW_CHARACTERS = 64;
const MAX_RELEASE_STRUCTURE_FOCUS_NODES = 64;
const MAX_RELEASE_STRUCTURE_FOCUS_CHARACTERS = 8_000;
const RUNTIME_CONTRACT_VERSION = "candidate-protected-hybrid-v93-release-profile";
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
		"Settle role_evidence and instantiation_evidence first. Test rather than assume a whole-document communicative role: one notice Owner may govern the source only when an actual notice root begins one uninterrupted, functionally homogeneous outward act through its true end and no peer qualification, evaluation, contract, response-format, requirement, specification, drawing, list, or technical-appendix root disproves it. A physical procurement file or invitation container is never itself a hard-excluded carrier root. Carrier Owner is decided before block-level primary effect: never apply the primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier. For every disputed broad exclusion, include one compact bidirectional carrier_root_exit_attack naming the source-proven carrier root and the first later peer root whose source function changes Owner, or EOF. A structural sc/vc exit closes one physical scope only: if the peer remains the same Owner, chain through that scope and continue searching. Attack both directions: truncate an exclusion that crosses an earlier different-Owner exit, and split a proposed keep when any internal subsection starts a new four-class carrier. No actual root means no carrier. Once a hard-excluded root is established, exclusion is root-closed: the root itself, every child clause and embedded attachment, and every consecutive same-Owner peer continuation remain excluded until the semantic Owner exit; primary-effect and duty-survival tests cannot reopen them. A hard-excluded local carrier can begin at a numbered, bold, centered, or plain-text subsection even when nested inside a chapter mixing technical, service, business, contract, or other requirements. Treat such an aggregate parent as a mixed container, not as one Owner grant: before any block-level effect test, run one mixed_container_root_sweep over its child heading candidates and classify every source-proven local four-class root. If a tentative final drops payment, guarantee, or legal children but keeps service period, location, quality, acceptance, personnel, or technical children after the same local root, that holey selection proves the atom gate ran too early; either disprove the root from source or exclude the complete root-closed interval. If the complete source is one hard-excluded carrier with no source-proven different-Owner exit, that is a terminal null decision; do not reopen internal blocks by technical usefulness. When structure navigation is provided, reconcile every disputed root/exit with sc/path: a deeper attachment, technical title, or table is a child and cannot be an exit; the first same-or-shallower candidate must be read and semantically classified before reopening. A qualified cross-reference never transfers membership to a referenced excluded appendix, and a direct must-comply duty in an independent technical chapter is not a bare pointer merely because it is short or general. For every mixed source-proven non-excluded chapter touched by the final patch, include one compact mixed_chapter_audit with literal keep/remove address islands. Before deleting any outside-carrier block, run duty_survival_attack: strip approval, filing, cost, deduction, breach, termination, damages, or other incidental consequences and preserve the indivisible block if the remaining clause still directly requires implementation, resources, plans/reports, records, delivery, timed replacement or replenishment, response, platform execution, or a result. Direct work effect does not require a supplier imperative: deliverable accuracy, completeness, error or quality accountability; inspection, review or acceptance tied to deliverable quality or correction; and current-version, replacement or precedence rules for applicable technical standards all survive. Grammar is not the gate: when an indivisible block states a direct guarantee, prohibition, quality/result baseline, or a specifically negated supplier-controlled failure before its remedy, strip the remedy and polarity-normalize that antecedent. Preserve the block when the normalized remainder is a concrete executable or verifiable duty such as timely maintenance, a correct stable version, non-infringement, or avoiding rework. Generic breach, noncompliance, misconduct, loss, or quality-problem labels without an action, threshold, deliverable result, or correction duty remain pure remedy triggers. Confidentiality duties that directly control storage, processing, transmission, copying, disclosure, retention, return, or destruction of project data are surviving data-control work duties outside a true contract carrier. A platform-execution command remains a direct duty when termination is only its consequence. Post-award submission, review, approval, filing, and record management are performance workflow, not procurement procedure. A complete bid/response mandatory-requirements section or table remains pre-award response Owner even when it describes future staff. A local proof atom begins at the operative fill, attach, or submit-proof block; adjacency alone never expands it backward over a neutral label or performance block unless source proves a shared response carrier. Pure contract formation, breach remedy, termination, dispute, governing-law, or general legal-risk blocks with no surviving direct work duty belong on the remove side. Then state the case-level impact. Range fields must be an exact projection of this settled reason.",
});
const ReleaseReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Test the whole-document communicative-role hypothesis before local partitioning, then explain the already-settled hard_excluded_ranges carrier gate before discussing block-level primary effect. A whole-source notice conclusion is valid only when an actual notice root governs one uninterrupted, functionally homogeneous outward act through its true end; peer qualification, evaluation, contract, response-format, requirement, specification, drawing, list, or technical-appendix roots disprove that hypothesis and make the physical file a multi-carrier container. The file or invitation container itself is never a hard-excluded root. For every disputed broad exclusion, state one compact bidirectional carrier_root_exit_attack with the actual source root and first later peer root whose source function changes Owner, or EOF. A structural sc/vc exit closes one physical scope only; consecutive peer scopes with the same Owner must be chained until a different-Owner root appears. Attack excluded ranges for overreach past an earlier different-Owner exit and attack every proposed keep island for an internal local four-class root; no root means no carrier. Different adjacent hard-excluded Owners require separate ranges and cannot be stitched into one outer carrier. Once a local four-class root is established, hard exclusion is root-closed: include the root itself and every child, embedded attachment, and same-Owner sibling continuation through the semantic Owner exit. Neither primary effect nor duty survival may rescue any block inside that interval. When structure is provided, reconcile each disputed boundary with sc/path: a deeper attachment, technical title, or table remains a child, while the first same-or-shallower candidate must be read and semantically classified before reopening. A local carrier may begin at a numbered, bold, centered, or plain-text subsection without Word outline metadata, including inside a chapter that combines technical, service, business, contract, or other requirements. Treat that aggregate parent as a mixed container, not a homogeneous Owner: complete a mixed_container_root_sweep over child heading candidates before atom review. Never reopen a declared carrier because its children contain service period, location, quality, acceptance, personnel, technical parameters, or other useful current-project facts. If the tentative final removes some commercial or legal children of one local root but retains other useful children after that same local root, the holey selection is invalid unless source disproves the root; otherwise move the entire root-to-exit interval into hard_excluded_ranges. Contract Owner must come from an actual contract-format root, not isolated legal words or a later contract section that would retroactively absorb earlier peer technical duties. Only outside the declared carrier gate, state compact literal-address false_protection_attack, over_deletion_attack, and duty_survival_attack conclusions for disputed mixed chapters. duty_survival_attack strips incidental approval, filing, cost, deduction, breach, termination, damages, and similar consequences; if the remaining clause directly requires implementation, resources, plans/reports, records, delivery, timed replacement or replenishment, response, platform execution, or a result, preserve it. Direct work effect does not require a supplier imperative: deliverable accuracy, completeness, error or quality accountability; inspection, review or acceptance tied to deliverable quality or correction; and current-version, replacement or precedence rules for applicable technical standards all survive. For a direct guarantee, prohibition, result baseline, or specifically negated supplier-controlled remedy antecedent, strip the remedy and polarity-normalize the antecedent; preserve a concrete executable or verifiable duty such as timely maintenance, a correct stable version, non-infringement, or avoiding rework. Generic breach, noncompliance, misconduct, loss, or quality-problem labels without an action, threshold, deliverable result, or correction duty remain pure remedy triggers. Confidentiality duties that directly control project-data storage, processing, transmission, copying, disclosure, retention, return, or destruction are surviving work duties outside a true contract carrier. A platform-execution command survives when termination is only the consequence. Distinguish pre-award qualification/mandatory response proof from post-award performance duties. A local proof atom begins at the operative fill, attach, or submit-proof block; adjacency alone never expands it backward over a neutral label or performance block unless source proves a shared response carrier. Then explain the case-level final range decision; reason cannot revise the carrier gate.",
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
			"Exact enum only; put evidence in reason. present proves a real project only; it never grants requirement membership inside a hard-excluded carrier.",
	});
	const removalSchema = Type.Union([
		Type.Object(
			{
				mode: Type.Literal("exact", {
					description:
						"Default branch. Enumerate only Candidate blocks already judged safe to delete. This branch intentionally has no preserve_ranges field.",
				}),
				remove_ranges: Type.Array(RangeSchema, {
					maxItems: 64,
					description:
						"Complete exact Candidate blocks to remove. Split around every block that reason keeps.",
				}),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				mode: Type.Literal("candidate_complement", {
					description:
						"Exceptional address-compression branch only when exact deletion genuinely exceeds 64 disjoint ranges. This branch intentionally has no remove_ranges field.",
				}),
				preserve_ranges: Type.Array(RangeSchema, {
					maxItems: 64,
					description:
						"Every qualified Candidate island that must remain; the Harness mechanically removes the Candidate complement.",
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
			}),
			source_role: sourceRoleSchema,
			instantiation: instantiationSchema,
			issue_type: Type.Unsafe<"none" | ReviewerIssueType>({
				type: "string",
				enum: ["none", ...reviewerIssueTypes],
			}),
			add_ranges: Type.Array(RangeSchema, {
				maxItems: 64,
				description: "Only qualified blocks marked OUT. A block already marked IN is never an add.",
			}),
			removal: removalSchema,
		},
		{ additionalProperties: false },
	);
}

const ReleaseDecisionSchema = Type.Object(
	{
		hard_excluded_ranges: Type.Array(RangeSchema, {
			maxItems: 64,
			description:
				"Write this field first after bidirectional carrier_root_exit_attack. List complete authorized-envelope intervals whose actual Owner is announcement/notice, bidder or supplier instructions, bid/response/quotation format, or contract terms/format. Every interval must start at an actual source-proven root and stop before the first later peer root whose source function changes Owner, or at EOF. A structural sc/vc exit only closes one physical scope; chain through consecutive same-Owner peer scopes instead of reopening membership. The interval is root-closed: include the root itself, every nested title, clause, table, embedded attachment, technically useful current-project fact, and same-Owner sibling continuation. Primary-effect and duty-survival tests are forbidden inside it. It cannot start from a physical file/container title, extend backward from a later carrier, or cross a peer requirement, specification, drawing, list, technical appendix, or different hard-excluded Owner. Also scan every proposed keep interval for an internal local four-class root and split it into hard_excluded_ranges through that root's semantic Owner exit. A true single inquiry or quotation notice may reach EOF only when no heterogeneous peer root disproves that identity. A local carrier may start below a wider mixed chapter and without Word outline metadata. A parent chapter aggregating technical, service, contract, and business material is only a mixed container: run mixed_container_root_sweep over its child heading candidates before any atom gate. If one local root would otherwise be kept as a holey selection that drops payment, guarantee, or legal children but reopens useful service or technical children, either disprove that root from source or place its complete root-to-exit interval here. With structure evidence, a deeper attachment/title/table is not an exit; reconcile against sc/path and semantically classify the first same-or-shallower candidate. Use separate ranges for adjacent different Owners. Use [] only when no four-class carrier exists in the envelope.",
		}),
		outside_carrier_excluded_ranges: Type.Array(RangeSchema, {
			maxItems: 64,
			description:
				"Write this field second, after hard_excluded_ranges. List only safely separable authorized-envelope blocks already proven outside all four hard-excluded carriers whose own primary direct effect is non-requirement: pure budget, pre-award qualification or response proof, evaluation/procurement procedure, quotation or price construction, payment, settlement, guarantee, bid validity, pure breach remedy, termination, dispute, contract formation/effectiveness, governing law, general legal risk allocation, or a bare external pointer. Run duty_survival_attack before adding any block: if stripping incidental approval, filing, cost, deduction, breach, termination, damages, or similar consequences leaves a direct implementation, resource, plan/report, record, data-control, delivery, timed replacement/replenishment, response, platform-execution, staffing, quality, safety, acceptance, warranty, or result duty, omit that indivisible block from this field. Deliverable accuracy/completeness/error/quality accountability, quality-linked inspection/review/acceptance or correction, and current-version/replacement/precedence rules for applicable technical standards are surviving duties even without a supplier-imperative syntax. For a direct guarantee, prohibition, result baseline, or specifically negated supplier-controlled remedy antecedent, polarity-normalize the antecedent after stripping the remedy; a concrete duty such as timely maintenance, a correct stable version, non-infringement, or avoiding rework survives, while a generic breach/noncompliance/loss label without an action, threshold, deliverable result, or correction duty does not. A local proof atom begins at its operative fill, attach, or submit-proof block; do not absorb a neighboring neutral label or performance block by address continuity alone. Split around every surviving work-duty block. This field must not overlap hard_excluded_ranges and is one coarse range projection, not a block ledger. Use [] only when no safely separable outside-carrier exclusion exists.",
		}),
		reason: ReleaseReasonSchema,
		final_ranges: Type.Array(RangeSchema, {
			maxItems: 128,
			description:
				"Write this field last, after hard_excluded_ranges, outside_carrier_excluded_ranges, and reason have reached one settled conclusion. It is the complete final selected range set, not a delta. Include every Candidate block that should remain and every approved challenged addition; omit every approved removal and every block already listed in either exclusion field. Use [] only for an explicit null result.",
		}),
	},
	{ additionalProperties: false },
);

type RawReviewerDecision = Static<ReturnType<typeof createReviewerDecisionSchema>>;
type RawReleaseDecision = Static<typeof ReleaseDecisionSchema>;
type Role = "reviewer" | "release";
type SubmissionMode = "tool_call" | "strict_json_text" | "embedded_json_text";

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
	submittedHardExcludedRanges: string[];
	hardExcludedRanges: string[];
	submittedOutsideCarrierExcludedRanges: string[];
	outsideCarrierExcludedRanges: string[];
	submittedFinalRanges: string[];
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
	const structureMap = buildStructureMap(
		options.packet.structureEvidence,
		new Set(candidate.blockIds),
		options.packet.blocks,
	);
	const reviewerDecisionSchema = createReviewerDecisionSchema();
	const reviewerSystemPrompt = `${options.prompts.runtimeContract.trim()}\n\n${options.prompts.reviewer.trim()}`;
	const reviewerUserPrompt = buildReviewerUserPrompt(
		options.packet.blocks,
		new Set(candidate.blockIds),
		candidate.ranges,
		structureMap,
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
				releaseThinkingBudgetTokens: RELEASE_THINKING_BUDGET_TOKENS,
				requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				workflowTimeoutMs: WORKFLOW_TIMEOUT_MS,
				maxProviderCalls: MAX_PROVIDER_CALLS,
				maxRunInputTokens: MAX_RUN_INPUT_TOKENS,
				maxRunOutputTokens: MAX_RUN_OUTPUT_TOKENS,
				maxRunReasoningTokens: MAX_RUN_REASONING_TOKENS,
				maxStructureMapNodes: MAX_STRUCTURE_MAP_NODES,
				maxStructureMapCharacters: MAX_STRUCTURE_MAP_CHARACTERS,
				maxStructureTextPreviewCharacters: MAX_STRUCTURE_TEXT_PREVIEW_CHARACTERS,
				maxReleaseStructureFocusNodes: MAX_RELEASE_STRUCTURE_FOCUS_NODES,
				maxReleaseStructureFocusCharacters: MAX_RELEASE_STRUCTURE_FOCUS_CHARACTERS,
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
					"Write reason first and settle the whole-document communicative role, complete source relationship, and residual judgment before any categorical or range fields. Carrier Owner is decided before block-level primary effect: never apply the primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier. Treat a parent chapter that aggregates technical, service, contract, and business material as a mixed container rather than one Owner grant: run mixed_container_root_sweep over its child heading candidates before the atom gate, and reject any holey selection that drops commercial or legal children but reopens useful service or technical children after the same local root. For every mixed source-proven non-excluded chapter touched by the patch, reason must compactly state literal keep/remove address islands and run duty_survival_attack before the final impact: strip incidental approval, filing, cost, deduction, breach, termination, or damages language and preserve an indivisible block when a direct implementation, resource, plan/report, record, timed replacement/replenishment, data-lifecycle control, delivery, response, platform-execution, or result duty survives. Distinguish pre-award qualification/mandatory response proof from post-award performance workflow. Then submit exact enum-only source_role and instantiation fields and either pass or one exact challenge. Add may contain only OUT blocks. Use removal.mode=exact by default and enumerate only blocks already judged safe to delete in removal.remove_ranges; the exact branch has no preserve field. Use removal.mode=candidate_complement only if exact deletion genuinely exceeds 64 disjoint ranges, and then list every kept Candidate island in removal.preserve_ranges; that branch has no remove field. Never protect hard-excluded carrier content or a title/external-pointer shell. Re-read the literal overlay marker for every range named in reason, and write range fields last. A non-empty candidate cannot pass when source_role is non_procurement.",
				schema: reviewerDecisionSchema,
				normalize: normalizeReviewerSubmission,
				parse: (raw) => validateReviewerDecision(raw, candidate.blockIds, availableBlockIds),
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
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				finalRanges: candidate.ranges,
				patch: null,
				reason: "Reviewer did not complete a contract-valid decision; candidate preserved.",
				failure: failureFromError("reviewer", error, signal),
			});
		}

		if (reviewerDecision.verdict === "pass" || reviewerDecision.verdict === "noop_challenge") {
			return finish({
				status: "preserved",
				resolution:
					reviewerDecision.verdict === "pass" ? "reviewer_pass" : "reviewer_noop_challenge",
				reviewDegraded: false,
				finalRanges: candidate.ranges,
				patch: null,
				reason: reviewerDecision.reason,
				failure: null,
			});
		}
		const challenge = reviewerDecision;
		const releaseCandidateRecheck = challenge.removeBlockIds.length > 0;
		const releaseRemoveBlockIds = releaseCandidateRecheck ? candidate.blockIds : [];
		const releaseRemoveRanges = compactBlockRanges(releaseRemoveBlockIds);

		const releaseSystemPrompt = `${options.prompts.runtimeContract.trim()}\n\n${options.prompts.release.trim()}`;
		const releaseUserPrompt = buildReleaseUserPrompt(
			options.packet.blocks,
			new Set(candidate.blockIds),
			new Set(challenge.addBlockIds),
			new Set(releaseRemoveBlockIds),
			new Set(challenge.removeBlockIds),
			candidate.ranges,
			challenge.issueType,
			challenge.addRanges,
			challenge.removeMode,
			releaseCandidateRecheck,
			releaseRemoveRanges,
			challenge.removeRanges,
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
					"Test the whole-document role hypothesis, then run one compact bidirectional carrier_root_exit_attack. Attack each disputed exclusion for overreach past its first different-Owner peer root, and attack every proposed keep island for a hidden local four-class root. Write hard_excluded_ranges first: each interval starts at an actual root, includes that root and every same-Owner child or peer continuation, and stops before the first different-Owner peer root or at EOF. A structural sc/vc exit is only a physical-scope candidate; chain through it when source function keeps the same Owner. A physical procurement file/invitation is not a root, different adjacent Owners cannot be stitched, and a later carrier cannot expand backward. Reconcile disputed boundaries with sc/path: a deeper attachment/title/table is not an exit, and a local contract/format/instruction/notice subsection inside a mixed chapter starts a root-closed carrier. An aggregate technical/service/contract/business parent is a mixed container, not one Owner grant: run mixed_container_root_sweep before atom review and reject a holey selection that drops commercial or legal children but keeps useful children after the same local root. Then write outside_carrier_excluded_ranges for every safely separable non-requirement atom outside those carriers after duty_survival_attack; split around every surviving direct work duty. Explain both settled gates in one short reason. Write final_ranges last as the only authoritative complete structural decision and omit both exclusion sets.",
				schema: ReleaseDecisionSchema,
				normalize: normalizeReleaseSubmission,
				parse: (raw) =>
					validateReleaseDecision(
						raw,
						candidate.blockIds,
						challenge.addBlockIds,
						releaseRemoveBlockIds,
						availableBlockIds,
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
				resolution: "release_rejected_challenge",
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
		"Run one candidate-protected residual review over an answer-free xique.word-requirement-review.packet.v1 packet. A pass uses one Doubao call; a material challenge uses one independent Gemini Release call.",
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
				`registered Gemini requirement release model not found: ${RELEASE_PROVIDER}/${RELEASE_MODEL_ID}`,
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
			throw new Error(`Gemini requirement release auth failed: ${releaseAuth.error}`);
		}
		if (!releaseAuth.apiKey) {
			throw new Error(
				"Gemini requirement release requires PI_REQUIREMENT_RELEASE_API_KEY or stored credentials",
			);
		}
		const result = await runRequirementReview({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			prompts,
			reviewerRuntime: {
				model: reviewerModel,
				streamFunction: doubaoStreamFunction,
				apiKey: reviewerAuth.apiKey,
				headers: reviewerAuth.headers,
				env: reviewerAuth.env,
			},
			releaseRuntime: {
				model: releaseModel,
				streamFunction: geminiStreamFunction,
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

const doubaoStreamFunction: StreamFn = (model, context, options) => {
	if (model.api !== "openai-completions") {
		throw new Error(`Doubao requirement reviewer requires openai-completions, received ${model.api}`);
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
		reasoningEffort: reasoning,
	});
};

const geminiStreamFunction: StreamFn = (model, context, options) => {
	if (model.api !== "google-generative-ai") {
		throw new Error(`Gemini requirement release requires google-generative-ai, received ${model.api}`);
	}
	const { reasoning: _reasoning, ...streamOptions } = options ?? {};
	return stream(model as Model<"google-generative-ai">, context, {
		...streamOptions,
		toolChoice: context.tools && context.tools.length > 0 ? "any" : "none",
		thinking: { enabled: true, budgetTokens: RELEASE_THINKING_BUDGET_TOKENS },
	});
};

export default function (pi: ExtensionAPI) {
	pi.registerProvider(REVIEWER_PROVIDER, {
		name: "Pi Word Requirement Reviewer Doubao",
		baseUrl: process.env.PI_REQUIREMENT_REVIEWER_BASE_URL || DEFAULT_REVIEWER_BASE_URL,
		apiKey: "$PI_REQUIREMENT_REVIEWER_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: REVIEWER_MODEL_ID,
				name: "Doubao Seed 2.0 Lite (Word Requirement Reviewer)",
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
		name: "Pi Word Requirement Release Gemini",
		baseUrl: process.env.PI_REQUIREMENT_RELEASE_BASE_URL || DEFAULT_RELEASE_BASE_URL,
		apiKey: "$PI_REQUIREMENT_RELEASE_API_KEY",
		api: "google-generative-ai",
		models: [
			{
				id: RELEASE_MODEL_ID,
				name: "Gemini 3.1 Pro Preview (Word Requirement Release)",
				api: "google-generative-ai",
				reasoning: true,
				input: ["text"],
				cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
				contextWindow: 1_048_576,
				maxTokens: 65_536,
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
): ReviewerDecision {
	if (raw.verdict === "pass") {
		if (raw.source_role === "non_procurement" && candidateBlockIds.length > 0) {
			throw new Error("Reviewer non_procurement decision cannot pass a non-empty candidate");
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
	const issueType = raw.issue_type === "none" ? "unspecified" : raw.issue_type;
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
	if (issueType === "operational_precision" && submittedAdditions.blockIds.length > 0) {
		throw new Error("Reviewer operational_precision contract must be remove-only");
	}
	const addBlockIds = submittedAdditions.blockIds.filter((blockId) => !candidate.has(blockId));
	const removeBlockIds = submittedRemovals.blockIds.filter((blockId) => candidate.has(blockId));
	if (
		addBlockIds.length === 0 &&
		removeBlockIds.length === 0
	) {
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

function normalizeReviewerSubmission(value: unknown): unknown {
	if (!isRecord(value)) return value;
	if (value.verdict === "pass") {
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
			source_role:
				normalizeReviewerEnum(value.source_role, reviewerSourceRoles, "source_role") ??
				"buyer_issued",
			instantiation:
				normalizeReviewerEnum(value.instantiation, ["present", "absent"], "instantiation") ??
				"present",
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
				: value.issue_type,
		add_ranges: normalizeRangeArray(value.add_ranges ?? []),
		removal,
		reason: normalizeBoundedReason(value.reason, 1_200),
	};
}

function normalizeReleaseSubmission(value: unknown): unknown {
	if (!isRecord(value)) return value;
	if (!("final_ranges" in value)) return value;
	return {
		hard_excluded_ranges: normalizeRangeArray(value.hard_excluded_ranges ?? []),
		outside_carrier_excluded_ranges: normalizeRangeArray(
			value.outside_carrier_excluded_ranges ?? [],
		),
		reason: normalizeBoundedReason(value.reason, 1_200),
		final_ranges: normalizeRangeArray(value.final_ranges),
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
): T | unknown {
	if (typeof value !== "string") return value;
	const prefix = `${fieldName}=`;
	const normalized = value.trim().startsWith(prefix)
		? value.trim().slice(prefix.length).trim()
		: value.trim();
	for (const option of allowed) {
		if (
			normalized === option ||
			normalized.startsWith(`${option}:`) ||
			normalized.startsWith(`${option};`) ||
			normalized.startsWith(`${option},`)
		) {
			return option;
		}
	}
	return value;
}

function validateReleaseDecision(
	raw: RawReleaseDecision,
	candidateBlockIds: readonly number[],
	allowedAddBlockIds: readonly number[],
	removeEnvelopeBlockIds: readonly number[],
	availableBlockIds: ReadonlySet<number>,
): ReleaseDecision {
	const submittedHardExclusions = parseStrictRanges(raw.hard_excluded_ranges, availableBlockIds);
	const submittedOutsideCarrierExclusions = parseStrictRanges(
		raw.outside_carrier_excluded_ranges,
		availableBlockIds,
	);
	const submitted = parseStrictRanges(raw.final_ranges, availableBlockIds);
	const candidate = new Set(candidateBlockIds);
	const allowedAdd = new Set(allowedAddBlockIds);
	const removeEnvelope = new Set(removeEnvelopeBlockIds);
	const hardExcludedBlockIds = submittedHardExclusions.blockIds.filter(
		(blockId) => candidate.has(blockId) || allowedAdd.has(blockId),
	);
	const hardExcluded = new Set(hardExcludedBlockIds);
	const outsideCarrierExcludedBlockIds = submittedOutsideCarrierExclusions.blockIds.filter(
		(blockId) =>
			(candidate.has(blockId) || allowedAdd.has(blockId)) && !hardExcluded.has(blockId),
	);
	const outsideCarrierExcluded = new Set(outsideCarrierExcludedBlockIds);
	const finalBlockIds = new Set<number>();
	for (const blockId of submitted.blockIds) {
		if (
			(candidate.has(blockId) || allowedAdd.has(blockId)) &&
			!hardExcluded.has(blockId) &&
			!outsideCarrierExcluded.has(blockId)
		) {
			finalBlockIds.add(blockId);
		}
	}
	for (const blockId of candidateBlockIds) {
		if (!removeEnvelope.has(blockId)) finalBlockIds.add(blockId);
	}
	const orderedFinalBlockIds = [...finalBlockIds].sort((left, right) => left - right);
	const finalRanges = compactBlockRanges(orderedFinalBlockIds);
	const unchanged =
		orderedFinalBlockIds.length === candidateBlockIds.length &&
		orderedFinalBlockIds.every((blockId, index) => blockId === candidateBlockIds[index]);
	return {
		verdict: unchanged ? "reject" : "publish",
		submittedHardExcludedRanges: submittedHardExclusions.ranges,
		hardExcludedRanges: compactBlockRanges(hardExcludedBlockIds),
		submittedOutsideCarrierExcludedRanges: submittedOutsideCarrierExclusions.ranges,
		outsideCarrierExcludedRanges: compactBlockRanges(outsideCarrierExcludedBlockIds),
		submittedFinalRanges: submitted.ranges,
		finalRanges,
		finalBlockIds: orderedFinalBlockIds,
		reason: raw.reason,
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
			reasoning: input.model.reasoning ? "medium" : undefined,
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

function buildReviewerUserPrompt(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
	candidateRanges: readonly string[],
	structureMap: StructureMap,
): string {
	const candidateCoverageRatio = candidateBlockIds.size / blocks.length;
	const sourceCharacterCount = blocks.reduce((sum, block) => sum + block.text.length, 0);
	const candidateCharacterCount = blocks.reduce(
		(sum, block) => sum + (candidateBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const candidateCharacterCoverageRatio =
		sourceCharacterCount === 0 ? 0 : candidateCharacterCount / sourceCharacterCount;
	const focusedCandidate = buildFocusedDuplicate(
		blocks
			.filter((block) => candidateBlockIds.has(block.blockId))
			.map((block) => `IN|段落${block.blockId}：${block.text}`),
		MAX_REVIEWER_FOCUS_BLOCKS,
		MAX_REVIEWER_FOCUS_CHARACTERS,
		"Candidate",
	);
	return [
		"sourceCoverage=complete",
		"candidateRole=untrusted mature single-prompt output",
		"membershipOverlay=IN means Candidate-selected; OUT means Candidate-external; markers are mechanical and not source text",
		`availableSourceRanges=${JSON.stringify(compactBlockRanges(blocks.map((block) => block.blockId)))}`,
		`candidateRanges=${JSON.stringify(candidateRanges)}`,
		`candidateBlockCount=${candidateBlockIds.size}`,
		`candidateIsEmpty=${candidateBlockIds.size === 0}`,
		`candidateCoverageRatio=${candidateCoverageRatio.toFixed(4)}`,
		`sourceCharacterCount=${sourceCharacterCount}`,
		`candidateCharacterCount=${candidateCharacterCount}`,
		`candidateCharacterCoverageRatio=${candidateCharacterCoverageRatio.toFixed(4)}`,
		`focusedCandidateBlockCount=${focusedCandidate.blockCount}`,
		`focusedCandidateCharacterCount=${focusedCandidate.characterCount}`,
		`focusedCandidateIncluded=${focusedCandidate.included}`,
		`structureEvidenceProvided=${structureMap.provided}`,
		`structureEvidenceEntryCount=${structureMap.entryCount}`,
		`structureMapNodeCount=${structureMap.renderedNodeCount}`,
		`structureMapCharacterCount=${structureMap.renderedCharacterCount}`,
		`structureMapCoverage=${structureMap.coverage}`,
		"candidateFocusPurpose=Complete mechanical duplicate of Candidate-selected addresses only when the whole duplicate fits the fixed budget. Partial sampling is forbidden because it can distort semantic boundaries. The duplicate adds no evidence, label, vote, or permission; when omitted, use the complete source above.",
		"wordStructureEvidenceContract=Optional structure is mechanically aligned from the same DOCX and contains only body order, paragraph/table form, style/outline, numbering, formatting, page-break, table-size, and outline-ancestry facts. tx is a bounded exact prefix copied from the same canonical source only after content-blind structural-node selection; it is a navigation join, not a label. The map never labels Owner, membership, keep, or drop. Use it to reconstruct source hierarchy and peer boundaries only; absence of a node is not negative evidence, and complete source text remains the only semantic truth.",
		"outlineNavigationContract=For every S row with sc=node@parent~exit, node is the active mechanically observed outline scope, parent is its nearest shallower ancestor, and exit is the first later same-or-shallower outline node. These fields describe physical scope only, not semantic Owner. A structural exit never automatically ends Owner: read the exit node from source, and if it continues the same Owner, chain through its scope until the first different-Owner peer root. Before preserving a title, table, or ordinary paragraph inside a hard-excluded scope, require that different-Owner exit; otherwise the root and all nested or same-Owner continuation content remain excluded.",
		"visualNavigationContract=For every S row with vc=node@parent~exit, formatting alone marks node as a non-outline visual heading candidate, parent as its mechanical enclosing candidate, and exit as the next equal-or-larger visual peer. vc never proves that node is a heading or assigns Owner. Read node tx and complete source first; if source semantics confirms that node starts a carrier, use exit as the bounded peer-exit hypothesis and keep all descendants under that Owner until source proves otherwise. If source semantics does not confirm a carrier start, ignore vc.",
		"Terminal consistency: source_role=non_procurement with a non-empty Candidate is challenge-only and must remove the complete Candidate; it cannot pass.",
		"Read the complete source to the end, then call submit_requirement_residual_review exactly once.",
		"# Complete immutable source with mechanical membership overlay",
		renderReviewerSource(blocks, candidateBlockIds),
		"# Optional mechanically aligned Word structure map",
		structureMap.source,
		"# Focused Candidate-only review view (complete mechanical duplicate when budget permits)",
		focusedCandidate.source,
		"# Final closure checklist after reading the complete source",
		"1. Settle the full reason before writing categorical or range fields. Then re-read the literal IN/OUT marker on every block cited in that reason: add only qualified OUT blocks. A desired IN block is already selected and belongs in removal.preserve_ranges only when using the candidate_complement branch; never describe an IN block as an omitted OUT block.",
		"1a. Test the whole-document communicative-role hypothesis before local Owner partitioning; do not assume it from the physical file. A whole-source notice is possible only when an actual notice root begins one uninterrupted, functionally homogeneous outward act and governs through its true end. Before accepting that hypothesis, run whole_container_disconfirmation across the beginning, middle, and end: any peer qualification, evaluation, contract, response-format, requirement, specification, drawing, list, or technical-appendix root makes the file a multi-carrier container. The outer procurement file or invitation is not itself a fifth hard-excluded Owner.",
		"2. Apply the hard-exclusion terminal gate before preserve: instantiation=present, unique current-project facts, and downstream usefulness never override an open announcement, bidder-instruction, response-format, or contract-format Owner. An announcement carrier need not have an explicit announcement heading: a self-contained public-notice sequence that moves through project synopsis, participation eligibility, document acquisition, submission, publication channel, and contact information keeps announcement Owner until a source-proven exit. This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region; never stitch those elements across peer response-format, contract, evaluation, technical-chapter, or detailed-technical-appendix boundaries to label the whole physical file a notice. When such heterogeneous peer carriers exist, first treat the file as a multi-carrier procurement container and reopen Owner at every boundary. Do not invent an invitation-body Owner spanning all numbered sections: invitation is the physical container, not a fifth hard-excluded carrier. A top-level functional shift into project scope, procurement content, execution quality or safety, warranty, technical standards, or a detailed technical appendix is itself a source-proven boundary and needs no explicit end-of-invitation sentence. Continuous numbering and later contact information do not erase that boundary. If you preserve a project-summary island from a true notice sequence, identify its actual regional boundary; without one, do not preserve it.",
		"3. Candidate interval boundaries are not carrier boundaries. A wide IN interval can cross several peer chapters and Owners. Before claiming that a carrier never exits, inspect every later top-level heading, chapter transition, appendix, table heading, and post-carrier island inside that same IN interval; reopen Owner judgment at each source-proven boundary.",
		"3a. When structure navigation is available, complete one ancestry_closure for every disputed proposed keep: read its sc/path active node, parent, and first same-or-shallower exit, then read those source blocks. A deeper attachment, technical title, ordinary paragraph, or table remains a child before that exit and cannot reopen membership. If a retained interval spans a local visual or outline heading candidate, inspect that heading as a possible new four-class root. State only the decisive scope/root/exit in reason; this is one boundary conclusion, not a block ledger.",
		"3b. Word outline metadata is helpful but not required for a carrier boundary. If source text itself starts a numbered, bold, centered, or plain-text subsection whose function is contract terms or formats, response/quotation format, bidder instructions, or an announcement/notice sequence, establish that local hard-excluded Owner at the subsection start and carry it through its numbered child clauses until the next source-proven peer exit. Do not use service period, location, quality, acceptance, technical parameters, or unique current-project facts inside that local carrier to reopen membership. A detailed technical table still inherits an active response or quotation-format scope.",
		"3c. Contract-format containment must start at an actual source-proven contract agreement, terms/format, performance-assessment template, or contract-appendix root. A local tender section whose stated function is to disclose the main terms of the future procurement contract is itself a contract-terms root; it does not need to be a complete bilateral contract, carry signatures, or make the whole source_role=contract. Isolated words such as contract, breach, confidentiality, intellectual property, approval, responsibility, or deduction do not create that carrier, and a later contract section never expands backward over earlier peer technical chapters. Once a local contract-terms root is source-proven, its embedded attachment, technical list, and detailed child rules inherit that carrier until a peer exit; an attachment label alone does not reopen membership. Inside a qualified technical Owner, source-code/result delivery, confidentiality and data handling, cybersecurity, continued maintenance, reports, approval workflow, and replacement duties remain subject to direct-duty review.",
		"3d. Mandatory bidirectional carrier_root_exit_attack: state carrier_root_exit_attack=<actual four-class root address -> first different-Owner peer root address or EOF>. First attack every disputed exclusion: search backward to falsify its root and forward for an earlier semantic Owner exit. Treat sc/vc exits as physical candidates only; chain through consecutive same-Owner peer scopes. Then attack every proposed keep island: inspect every internal subheading for a local announcement/notice, bidder-instruction, response/quotation-format, or contract-terms root and exclude that root itself plus all same-Owner descendants and peer continuations through its semantic exit. A later carrier never absorbs earlier duties; a deeper attachment/technical child never exits an active carrier; a local contract-main-terms subsection remains a root-closed contract Owner even inside a wider technical/service/business chapter; adjacent different Owners remain separate.",
		"3e. Mandatory mixed_container_root_sweep before the atom gate: a parent chapter that aggregates technical, service, contract, business, or other requirements is only a container and does not grant one Owner to every child. Classify each child heading candidate from source. If the tentative final drops payment, guarantee, breach, or other commercial/legal children but keeps service period, location, quality, acceptance, personnel, or technical children after the same local four-class root, that holey selection is invalid: either disprove the root from source or exclude its complete root-closed interval through the semantic exit.",
		"4. A staffing, scope, quality, service, acceptance, or technical subheading inside an open announcement, qualification, bidder-instruction, response-format, or contract carrier retains that outer Owner. Only a boundary-independent post-exit technical source can be protected.",
		"4a. Stage Owner outranks future-tense wording. A complete bid/response mandatory-requirements section or mandatory response table remains pre-award proof/commitment Owner even when it lists future roles, headcount, certificates, or mobilization dates. Outside those carriers, a buyer requirement that directly controls the successful supplier's post-award staffing, resources, submission, review, approval, filing, or records is performance content and must not be deleted merely because it uses approval, breach, or qualification language.",
		"5. Distinguish normative incorporation from a bare external pointer. After global instantiation, an independent standards chapter that says work must comply with or reach cited laws, drawings, codes, or current standards directly imposes an executable duty and has fact payload even without copied parameters. Only a heading, empty section, or text that merely says to see an absent document without stating any present duty is a non-fact shell. Conversely, when a qualified project-scope, quality, safety, warranty, acceptance, or technical-standard heading has substantive body text before the next peer Owner boundary, preserve the heading and that body as one source-fidelity unit. An image placeholder, blank line, page break, or short continuation after that heading does not end the section; never keep the heading while deleting its concrete duties, parameters, measures, response times, or responsibilities. Closure never extends backward across the carrier start: an independent appendix, list, or drawing begins at its own heading, name, or first explicit content block, and never absorbs the preceding carrier's signature party, date, seal, closing line, header/footer, or layout image merely because it is adjacent.",
		"5a. Source-fidelity closure and cross-references never transfer Owner. A qualified requirement sentence that says see an appendix does not make that appendix qualified: adjudicate the referenced appendix at its own structural location. If it is inside a contract, response format, scoring, qualification, announcement, or bidder-instruction carrier, it remains excluded even when detailed, unique, or referenced from the requirement chapter. Only a boundary-independent technical appendix under its own qualified Owner can extend the requirement range.",
		"6. Carrier Owner is the terminal gate before primary effect. Never apply the block-level primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier; every internal technical subheading and project-specific duty still follows that outer Owner until a source-proven exit. A complete source whose parties, agreement language, continuous articles, price/payment, breach, effectiveness, termination, dispute and signature structure jointly form one bilateral contract remains a contract even when its title says service or technical requirements and most articles are technically detailed. If that contract never exits to a boundary-independent qualified source, the final is null. Only for a mixed project, business, performance, or other chapter already proven outside the four hard-excluded carriers, perform a literal block-address primary-effect audit before submitting. In reason, compactly state all keep/remove address islands for every such chapter touched by the patch. Keep blocks whose direct operative effect is schedule/service period, location, scope, quality, warranty, delivery, acceptance, safety, service response, implementation or resource provision. Remove blocks whose direct operative effect is funding source, contract price form, price/quotation, payment, settlement, deduction, audit, invoice, guarantee, bid validity or quotation commitment. Engineering quantities, completion, acceptance or quality-retention language used only as a monetary basis, payment condition or settlement trigger does not turn that block into a technical requirement; conversely, a direct work duty remains qualified when cost inclusion is merely incidental. A technical heading does not grant membership to its body: if the next block only says to inspect, obtain later, or see drawings/specifications/attachments absent from this Word and states no present duty, that pointer block must be removed even when the heading is retained for boundary context.",
		"6a. Mandatory duty_survival_attack for every proposed outside-carrier removal: mentally remove approval, filing, cost allocation, deduction, breach, termination, damages, and similar incidental consequences. If the remaining clause still directly requires implementation, resource configuration, a plan/scheme/report, a record, delivery, timed replacement or replenishment, response, platform execution, or an outcome, keep the indivisible block. Grammar is not the gate: when the block first states a direct guarantee, prohibition, quality/result baseline, or a specifically negated supplier-controlled failure as the remedy antecedent, polarity-normalize that antecedent after stripping the consequence. Timely maintenance, a correct stable product/version, non-infringement, avoiding rework, and other concrete executable or verifiable results survive; generic breach, noncompliance, misconduct, loss, or quality-problem labels without an action, threshold, deliverable result, or correction duty do not. Confidentiality language survives as a direct data-control duty when it governs storage, processing, transmission, copying, disclosure, retention, return, or destruction of project information. A command to execute according to a designated platform survives when contract termination is only the consequence. Post-award submission, review, approval, filing, and record management are implementation workflow, not procurement procedure. Delete only when no direct work duty survives or when the actual Owner is pre-award proof/response.",
		"6b. Mandatory consequence_cluster_attack whenever Candidate IN covers a penalty, deduction, or remedy cluster: first protect every concrete duty island that survives polarity normalization, then separately attack generic breach/nonconformance triggers, penalty-basis pointers, definitions whose only function is to delimit a penalty event, confirmation/deduction/payment mechanics, and a duplicate comply-with-the-above wrapper that adds no action, threshold, deliverable result, or correction duty beyond adjacent detailed rules. One surviving duty never protects the whole cluster. Submit only Candidate IN pure-consequence islands as removal; if every non-requirement atom you found is OUT, pass instead of creating a noop challenge. State only the decisive address islands, not a ledger.",
		"6c. Finish with a global pure-legal-wrapper sweep across all Candidate IN, not only the challenged penalty cluster. A block that only says a specification, appendix, or deliverable becomes part of the contract, has equal legal effect, or is governed by the contract, without adding a technical standard, work action, deliverable result, or correction duty, is a removable legal-effect wrapper. A catch-all saying unspecified matters will be negotiated or otherwise resolved by the parties, without a concrete project task, workflow, output, or response deadline, is a removable contract-gap/dispute fallback rather than implementation coordination.",
		"7. Use removal.mode=exact by default, even when Candidate is wide: enumerate every safe removal island in removal.remove_ranges and split around all qualified facts. The exact branch has no preserve field, so every block inside an exact remove range must already be judged safe to delete; exact is never a broad candidate-complement envelope and must not contain qualified blocks for Release to discover and restore. removal.mode=candidate_complement is exceptional address compression only when that complete exact deletion would genuinely exceed 64 disjoint ranges; width, convenience, or a desire to protect a few islands is insufficient. If the fallback is truly necessary, removal.preserve_ranges is a block-level allowlist and that branch has no remove field.",
		"8. Compute final = Candidate + add - remove once. After reason is settled, choose exactly one removal branch and write its sole range field as the exact structural projection; write all range fields last. Re-read each literal address in the mixed_chapter_audit and the last retained island before calling the tool. The submitted final must close the whole stated issue; do not delete an IN island that reason says must remain, and do not protect a block that reason classifies as remove.",
	].join("\n\n");
}

function buildReleaseUserPrompt(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
	addBlockIds: ReadonlySet<number>,
	removeEnvelopeBlockIds: ReadonlySet<number>,
	proposedRemoveBlockIds: ReadonlySet<number>,
	candidateRanges: readonly string[],
	issueType: ReviewerIssueType,
	addRanges: readonly string[],
	removeMode: ReviewerRemoveMode,
	releaseCandidateRecheck: boolean,
	removeEnvelopeRanges: readonly string[],
	proposedRemoveRanges: readonly string[],
	structureMap: StructureMap,
): string {
	const candidateCharacterCount = blocks.reduce(
		(sum, block) => sum + (candidateBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const challengeAddCharacterCount = blocks.reduce(
		(sum, block) => sum + (addBlockIds.has(block.blockId) ? block.text.length : 0),
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
	const sourceRows = blocks.map((block) => {
			const marker = addBlockIds.has(block.blockId)
				? "ADD_REVIEW"
				: proposedRemoveBlockIds.has(block.blockId)
					? "REMOVE_REVIEW"
					: releaseCandidateRecheck && candidateBlockIds.has(block.blockId)
						? "KEEP_RECHECK"
						: candidateBlockIds.has(block.blockId)
							? "BASE_KEEP"
							: "OUT";
			return {
				blockId: block.blockId,
				text: `${marker}|段落${block.blockId}：${block.text}`,
			};
		});
	const source = sourceRows.map((row) => row.text).join("\n");
	const focusedReview = buildReleaseAdversarialNavigation(
		sourceRows,
		candidateBlockIds,
		proposedRemoveBlockIds,
		addBlockIds,
	);
	const keepStructureBlockIds = new Set(
		[...candidateBlockIds].filter((blockId) => !proposedRemoveBlockIds.has(blockId)),
	);
	const keepStructureFocus = buildReleaseStructureFocus(
		structureMap,
		releaseCandidateRecheck ? keepStructureBlockIds : new Set<number>(),
	);
	return [
		"sourceCoverage=complete",
		"reviewerNarrativeAndEvidenceVisibility=withheld",
		releaseCandidateRecheck
			? "challengeOverlay=REMOVE_REVIEW means a Candidate block the Reviewer proposes removing; KEEP_RECHECK means other Candidate content independently reopened because the Reviewer proposed at least one deletion; ADD_REVIEW means a Candidate-external block the Reviewer proposes adding; OUT is unavailable external source. Markers define priority and mechanical permission, not semantic truth, confidence, or votes."
			: "challengeOverlay=ADD_REVIEW means a Candidate-external block the Reviewer proposes adding; BASE_KEEP means all Candidate content is mechanically mandatory because the challenge is add-only. OUT is unavailable external source. Markers are permissions, not semantic truth.",
		`availableSourceRanges=${JSON.stringify(compactBlockRanges(blocks.map((block) => block.blockId)))}`,
		`candidateRanges=${JSON.stringify(candidateRanges)}`,
		`challengeIssueType=${JSON.stringify(issueType)}`,
		`challengeAddRanges=${JSON.stringify(addRanges)}`,
		`challengeRemoveMode=${JSON.stringify(removeMode)}`,
		`challengeRemoveRanges=${JSON.stringify(proposedRemoveRanges)}`,
		`releaseRemoveEnvelopeRanges=${JSON.stringify(removeEnvelopeRanges)}`,
		"reviewerPreserveRangesAndRationale=withheld",
		`releaseAuditMode=${releaseCandidateRecheck ? "candidate_recheck" : "add_only"}`,
		releaseCandidateRecheck
			? "reviewerMechanicalPatchVisibility=prioritized REMOVE_REVIEW followed by independent KEEP_RECHECK audit across the complete Candidate"
			: "reviewerMechanicalPatchVisibility=bounded ADD_REVIEW with mechanically mandatory BASE_KEEP Candidate",
		`candidateBlockCount=${candidateBlockIds.size}`,
		`challengeAddBlockCount=${addBlockIds.size}`,
		`challengeRemoveBlockCount=${proposedRemoveBlockIds.size}`,
		`releaseRemoveEnvelopeBlockCount=${removeEnvelopeBlockIds.size}`,
		`candidateCharacterCount=${candidateCharacterCount}`,
		`challengeAddCharacterCount=${challengeAddCharacterCount}`,
		`challengeRemoveCharacterCount=${challengeRemoveCharacterCount}`,
		`releaseRemoveEnvelopeCharacterCount=${releaseRemoveEnvelopeCharacterCount}`,
		`challengeRemoveCandidateCharacterRatio=${challengeRemoveCandidateCharacterRatio.toFixed(4)}`,
		`focusedKeepTargetBlockCount=${focusedReview.keep.targetBlockCount}`,
		`focusedKeepIncludedTargetBlockCount=${focusedReview.keep.includedTargetBlockCount}`,
		`focusedKeepCoverage=${focusedReview.keep.coverage}`,
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
		`releaseKeepStructureFocusTargetNodeCount=${keepStructureFocus.targetNodeCount}`,
		`releaseKeepStructureFocusIncludedNodeCount=${keepStructureFocus.includedNodeCount}`,
		`releaseKeepStructureFocusCharacterCount=${keepStructureFocus.renderedCharacterCount}`,
		`releaseKeepStructureFocusCoverage=${keepStructureFocus.coverage}`,
		"focusViewPurpose=Text-blind dual-side atomic navigation only. For a deletion challenge, the harness exposes both Candidate keep and proposed-change sides. It first tries to include the mechanically smaller side completely, then uses the remaining fixed budget for the other side; oversized sides use continuous-run boundary windows, recursively layered addresses, and immediate source neighbors. Add-only review exposes only challenged ADD addresses. The harness never reads headings or keywords. ATOMIC_KEEP_TARGET, ATOMIC_CHANGE_TARGET, and ATOMIC_CONTEXT add no evidence, semantic label, vote, or permission; the complete source above remains the only truth source.",
		"wordStructureEvidenceContract=Optional structure is the same answer-free mechanical map seen by Reviewer: body order, paragraph/table form, style/outline, numbering, formatting, page-break, table-size, and outline-ancestry facts only. tx is a bounded exact prefix copied from the same canonical source after content-blind node selection, solely to join structure back to source addresses. It never carries Reviewer conclusions or semantic labels. Use it only to reconstruct true hierarchy and peer exits; complete source text remains authoritative.",
		"outlineNavigationContract=For every S row with sc=node@parent~exit, node is the active mechanically observed outline scope, parent is its nearest shallower ancestor, and exit is the first later same-or-shallower outline node. These fields describe physical scope only. A structural exit never automatically ends Owner: read the exit node from source, and if it continues the same Owner, chain through its scope until the first different-Owner peer root. Before keeping any title, table, or ordinary paragraph inside a hard-excluded scope, require that different-Owner exit; otherwise the root and all nested or same-Owner continuation content remain excluded.",
		"visualNavigationContract=For every S row with vc=node@parent~exit, formatting alone marks node as a non-outline visual heading candidate, parent as its mechanical enclosing candidate, and exit as the next equal-or-larger visual peer. vc is not a semantic heading or Owner label. Read node tx and complete source first; when source semantics confirms a carrier start, use exit as the bounded peer-exit hypothesis and keep descendants under that Owner until source proves otherwise. Ignore vc when source semantics does not confirm a carrier start.",
		"challengeEnvelopeMetrics=Permission-and-budget metadata only. Counts, character ratio, and 100% Candidate coverage do not express a requested deletion amount and are never semantic evidence.",
		"challengeIssueTypeSemantics=challengeIssueType is a non-authoritative label. Adjudicate each challenged paragraph from source and publish any safe subset regardless of the label.",
		"remedyTriggerSeparation=Quality error, misconduct, or false deliverables used only as a trigger for deduction, damages, disqualification, termination, replacement procedure, or legal pursuit do not create an independent quality requirement. Strip the remedy itself: if no deliverable accountability, measurable quality threshold, inspection/review/acceptance, correction duty, or work act remains, place that separable atom on the remove side.",
		"prospectiveResponsibilityBoundary=An explicit requirement that the successful supplier bear responsibility for current-project design, construction, safety, quality, or deliverables is prospective performance governance and survives even when paired with economic-loss allocation. Distinguish it from a buyer-only after-the-fact right to deduct, terminate, replace, or pursue legal liability with no independent supplier responsibility or work act.",
		"performanceGovernanceBoundary=Independence, professional-discipline, conflict-of-interest disclosure, and recusal duties that govern the successful supplier or its personnel while performing the current project are direct implementation and quality-governance facts. Treat them as qualification only when their primary effect is proving bidder or proposed-person eligibility before award.",
		releaseCandidateRecheck
			? "challengeAtom=Form one neutral atomic partition of the complete Candidate by actual Owner and each block's primary direct effect. Then answer two bounded counterexample questions on that same partition: false_protection_attack identifies literal kept address islands that must be removed, and over_deletion_attack identifies literal removed address islands that must be restored. Do not generate competing whole-document drafts or vote between hypotheses. A chapter heading, adjacent qualified island, or continuous range never decides another block. Decide each ADD_REVIEW independently."
			: "challengeAtom=Independently approve or reject each ADD_REVIEW. The challenge is add-only, so every BASE_KEEP Candidate block is mechanically mandatory and cannot be removed.",
		releaseCandidateRecheck
			? "releaseAuthorization=final_ranges may contain any Candidate block plus any challenged ADD_REVIEW block. This permits restoring mistaken REMOVE_REVIEW blocks and removing false-protected KEEP_RECHECK blocks anywhere inside the complete Candidate; OUT remains unavailable."
			: "releaseAuthorization=Every BASE_KEEP block is mechanically mandatory. final_ranges may accept challenged ADD_REVIEW blocks; it cannot remove BASE_KEEP or add OUT.",
		"releaseTerminalContract=Run bidirectional carrier_root_exit_attack first with same-Owner peer continuity and root-closed exclusion: truncate overreaching exclusions only at a different-Owner peer root, and split proposed keeps at hidden local four-class roots. For every aggregate technical/service/contract/business parent, run mixed_container_root_sweep before the atom gate and reject any holey selection inside one local root. Write hard_excluded_ranges from each actual root through every same-Owner child and peer continuation to its semantic exit. Then, only outside those carriers, write outside_carrier_excluded_ranges for every safely separable non-requirement atom after duty_survival_attack; split around every surviving direct work duty. Never use the physical file as a root or treat a structural exit as an automatic Owner exit. Write one short reason that explains but cannot revise either gate. Finally write final_ranges as the single authoritative complete final selected set, omitting both exclusion sets; use [] only for an explicit null result.",
		"terminalReasonBudget=Keep reason under 800 characters; final_ranges carries the complete structural decision.",
		"Independently adjudicate only this exact envelope, then call submit_requirement_release exactly once.",
		"# Complete immutable source with mechanical challenge overlay",
		source,
		"# Optional mechanically aligned Word structure map",
		structureMap.source,
		"# Text-blind dual-side atomic navigation view (bounded mechanical duplicate)",
		focusedReview.source,
		"# Candidate keep-side structural navigation focus (bounded mechanical duplicate)",
		keepStructureFocus.source,
		"# Final release checklist after reading the complete source",
		releaseCandidateRecheck
			? "1. Review the complete Candidate once. Build one neutral Owner partition, then classify every block in each mixed non-excluded chapter by its own primary direct effect. Run one counterexample check over both kept and removed decisions; do not let a chapter title, neighboring technical duty, continuous address range, or Reviewer marker vote for another block. Decide ADD_REVIEW independently and express the complete final set once."
			: "1. Review only the bounded add-only patch. Start from all mechanically mandatory BASE_KEEP blocks, decide ADD_REVIEW independently, then express the complete final set once in final_ranges.",
		"1a. Before local partitioning, test the whole-document communicative-role hypothesis from the beginning, middle, and end. A whole-source notice is possible only when an actual notice root governs one uninterrupted, functionally homogeneous outward act through its true end. Run whole_container_disconfirmation before accepting it: a peer qualification, evaluation, contract, response-format, requirement, specification, drawing, list, or technical-appendix root makes the source a multi-carrier procurement container. The physical file or invitation is not itself a hard-excluded root, and all chapters participating in one procurement does not make them one notice.",
		"2. Keeping any disputed block needs affirmative proof that it is outside the four hard-excluded carriers. Current-project facts, unique scope, staffing, quality, service, acceptance, or technical wording inside an open announcement, bidder-instruction, response-format, or contract carrier are never protection evidence. An announcement need not carry an explicit title: a self-contained public-notice sequence covering project synopsis, participation eligibility, acquisition, submission, publication channel, and contacts remains announcement Owner until a source-proven exit. This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region; never stitch those elements across peer response-format, contract, evaluation, technical-chapter, or detailed-technical-appendix boundaries to label the whole physical file a notice. When such heterogeneous peer carriers exist, first treat the file as a multi-carrier procurement container and reopen Owner at every boundary. Do not invent an invitation-body Owner spanning all numbered sections: invitation is the physical container, not a fifth hard-excluded carrier. A top-level functional shift into project scope, procurement content, execution quality or safety, warranty, technical standards, or a detailed technical appendix is itself a source-proven boundary and needs no explicit end-of-invitation sentence. Continuous numbering and later contact information do not erase that boundary. If retaining a project-summary island from a true notice sequence, state its actual regional boundary; otherwise omit it.",
		"3. REMOVE_REVIEW interval boundaries are not carrier boundaries. A wide removal proposal can start inside a contract or format chapter and later cross into peer technical chapters before entering another excluded carrier. Reopen Owner judgment at every top-level heading, chapter transition, appendix, table heading, and short post-carrier island inside the interval; never inherit the first heading across the whole range.",
		"3a. When structure navigation is available, start from every row in the Candidate keep-side structural navigation focus before declaring that a kept region contains no local four-class root. The focus is a content-blind duplicate, not an Owner label; read each row's tx and its complete source, then perform one ancestry_closure for the disputed kept island using sc/path active node, parent, and first same-or-shallower exit. Before that exit, a deeper attachment, technical title, ordinary paragraph, or table remains a child. If focus coverage is partial, continue through the full structure map. Put only the decisive scope/root/exit in reason; do not produce a ledger.",
		"3b. A source-proven carrier boundary does not require Word outline metadata. A numbered, bold, centered, or plain-text local subsection that establishes contract terms or formats, response/quotation format, bidder instructions, or an announcement/notice sequence starts a hard-excluded Owner even when nested under a broader chapter. Carry that Owner through all child clauses until the next peer exit. Do not apply primary direct effect to rescue service period, location, quality, acceptance, technical parameters, or unique project facts inside it. A detailed technical table remains excluded while its active response or quotation-format scope is open.",
		"3c. Contract-format containment requires an actual source-proven contract agreement, terms/format, performance-assessment template, or contract-appendix root. A local tender section whose stated function is to disclose the main terms of the future procurement contract is itself a contract-terms root; it does not need to be a complete bilateral contract, carry signatures, or make the whole source_role=contract. Isolated contract, breach, confidentiality, intellectual-property, approval, responsibility, or deduction wording does not create that carrier, and a later contract section never expands backward over earlier peer technical chapters. Once a local contract-terms root is source-proven, its embedded attachment, technical list, and detailed child rules inherit that carrier until a peer exit; an attachment label alone does not reopen membership. Within a qualified technical Owner, result/source-code delivery, confidentiality and data handling, cybersecurity, continued maintenance, reports, approval workflow, and replacement obligations remain subject to direct-duty review.",
		"3d. Mandatory bidirectional carrier_root_exit_attack: state carrier_root_exit_attack=<actual four-class root address -> first different-Owner peer root address or EOF>. First attack every disputed hard exclusion for a false root or earlier semantic Owner exit. Treat sc/vc exits as physical candidates only and chain through consecutive same-Owner peer scopes. Then attack every proposed keep island by checking each internal subheading for a local announcement/notice, bidder-instruction, response/quotation-format, or contract-terms root and exclude that root itself plus all same-Owner descendants and peer continuations through its semantic exit. A later carrier never expands backward; a deeper attachment/technical child never exits an active carrier; a local contract-main-terms subsection remains a root-closed contract Owner even inside a wider technical/service/business chapter; adjacent different Owners require separate ranges.",
		"3e. Mandatory mixed_container_root_sweep before atom review: a parent chapter combining technical, service, contract, business, or other requirements is only a mixed container. Classify every child heading candidate from source. A tentative final that drops payment, guarantee, breach, or other commercial/legal children but keeps service period, location, quality, acceptance, personnel, or technical children after the same local four-class root is a forbidden holey selection; either disprove the root or put its complete root-to-semantic-exit interval in hard_excluded_ranges.",
		"4. If the complete source is one actual hard-excluded carrier, never exits it, and contains no independent qualified region, the correct final_ranges is [] even when technically detailed. Before submitting [], carrier_root_exit_attack must establish one real root through EOF and whole_container_disconfirmation must find no heterogeneous peer root. Multiple peer carrier roots prove a multi-carrier container, not one whole-source notice or contract. A physical-file title, invitation act, attachment relationship, or notice elements scattered across separate chapters is insufficient evidence for null.",
		"5. Before a broad removal or null result, inspect every later top-level boundary and short island for independent technical standards, requirements, specifications, drawings, lists, or appendices. Outer containment ends only at a source-proven boundary, not at a local technical label.",
		"6. Distinguish normative incorporation from a bare external pointer. Once the source is instantiated by other project facts, an independent technical chapter outside the four carriers has fact payload when it directly requires work to comply with or reach cited laws, drawings, codes, or current standards, even if generally worded or only a few lines. Do not demand repeated project-specific parameters. Only a heading, empty section, or text that merely says to see an absent document without stating any present duty has no payload. Conversely, when a qualified project-scope, quality, safety, warranty, acceptance, or technical-standard heading has substantive body text before the next peer Owner boundary, final_ranges must keep the heading and that body as one source-fidelity unit. An image placeholder, blank line, page break, or short continuation after that heading does not end the section; never keep the heading while omitting its concrete duties, parameters, measures, response times, or responsibilities. Closure never extends backward across the carrier start: an independent appendix, list, or drawing begins at its own heading, name, or first explicit content block, and never absorbs the preceding carrier's signature party, date, seal, closing line, header/footer, or layout image merely because it is adjacent.",
		"6a. Source-fidelity closure and cross-references never transfer Owner. A qualified requirement sentence that says see an appendix does not make that appendix qualified: adjudicate the referenced appendix at its own structural location. If it is inside a contract, response format, scoring, qualification, announcement, or bidder-instruction carrier, it remains excluded even when detailed, unique, or referenced from the requirement chapter. Only a boundary-independent technical appendix under its own qualified Owner can extend final_ranges.",
		"7. Carrier Owner is the terminal gate before primary effect. Never apply the block-level primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier; internal project-specific duties still follow that hard-excluded Owner until a source-proven exit. A complete source whose parties, agreement language, continuous articles, price/payment, breach, effectiveness, termination, dispute and signature structure jointly form one bilateral contract remains a contract even when its title says service or technical requirements and most articles are technically detailed. If reason establishes that contract-only identity and no boundary-independent qualified source, final_ranges must be []; a later 'but the duties are technical' clause is a direct contradiction. Only outside the four hard-excluded carriers, a heading such as business, fulfillment, delivery, or after-sales requirements is not a pure-commerce verdict. Judge every disputed block by its primary direct effect and state the approved keep/remove address islands in reason. Keep project schedule/service period, location, scope, quality, warranty, delivery, acceptance, implementation, resource-provision and service-response obligations. Remove separately proven price, payment, settlement, deduction, audit, invoice, guarantee, bid-validity or other non-work-content blocks. Engineering quantities, completion, acceptance or quality-retention language used only as a monetary basis, payment condition or settlement trigger is not an acceptance or quality requirement; a direct work duty remains qualified when cost inclusion is merely incidental.",
		"8. In every mixed non-excluded chapter, re-read each numbered sub-item, table row, heading transition, and operative sentence as its own addressable decision. Procurement/evaluation method, price or quotation construction, payment, settlement, guarantee, bid validity, pure breach damages or remedies, termination, dispute resolution, contract formation, governing law, general legal risk allocation, and bare external inspection pointers remain removable when separable and when they impose no direct work duty. Direct construction, supply, configuration, resource, schedule, quality, safety, warranty, acceptance, service-response, or post-award staffing duties remain qualified even when adjacent to commercial or legal text. A new peer heading starts a new Owner decision; range continuity never carries the prior chapter across it.",
		"8a. Stage Owner outranks future-tense wording. A complete bid/response mandatory-requirements section or mandatory response table remains pre-award proof/commitment Owner even when it lists future roles, headcount, certificates, or mobilization dates. A separable note or block whose operative act tells the response document to fill, attach, or provide personnel names, credentials, certificates, screenshots, social-insurance evidence, or commitments is likewise pre-award response proof even when it immediately follows qualified post-award staffing duties; put that block in outside_carrier_excluded_ranges without deleting the staffing duties around it. Outside those proof blocks, a direct requirement on the successful supplier's post-award staffing, resources, submission, review, approval, filing, records, or data handling is performance content. Confidentiality rules governing project-data storage, processing, transmission, copying, disclosure, retention, return, or destruction are direct data-control duties; a platform-execution command remains direct when termination is only the stated consequence.",
		"9. Envelope size and prior-role agreement are not semantic votes. Even when the remove envelope covers 100% of Candidate, omit every independently safe excluded paragraph, keep every qualified island, and decide each challenged ADD independently.",
		"10. Before final_ranges, write hard_excluded_ranges from the settled bidirectional carrier_root_exit_attack: start at each actual root, include the root itself and every same-Owner child or peer continuation, and stop only before the first different-Owner peer root or at EOF. Add every hidden local four-class root found inside proposed keeps as a root-closed interval, and reconcile disputed boundaries with sc/path. Never treat a structural exit or deeper attachment as an automatic Owner exit, begin before a root, cross a peer requirement/technical source, or stitch different adjacent Owners.",
		"11. Next write outside_carrier_excluded_ranges for every safely separable non-requirement atom outside hard_excluded_ranges. Mandatory terminal adversarial checks for each disputed mixed non-excluded chapter: false_protection_attack=<literal kept ranges to remove or none>; over_deletion_attack=<literal removed ranges to restore or none>; duty_survival_attack=<literal removed ranges whose direct duty survives after stripping incidental approval/filing/cost/deduction/breach/termination/damages language and polarity-normalizing any specific negative remedy antecedent, or none>; consequence_cluster_attack=<literal surviving duty islands versus separable pure-consequence islands, or none>. Pure budget, pre-award response proof, procedure, quotation/price/payment/settlement/guarantee, pure legal remedy/termination/dispute/formation/risk allocation, and bare pointers enter outside_carrier_excluded_ranges when separable. Direct implementation, resource, plan/report, record, project-data lifecycle control, delivery, timed replacement/replenishment, response, platform execution, staffing, quality, safety, acceptance, warranty, or result duties do not. A concrete guarantee/prohibition or supplier-controlled negative antecedent survives when normalization yields an executable or verifiable duty such as timely maintenance, a correct stable version, non-infringement, or avoiding rework; a generic breach/noncompliance/loss label without such content remains removable. In a penalty/deduction/remedy cluster, one surviving duty does not protect generic triggers, penalty-only pointers or definitions, confirmation/deduction/payment mechanics, or a duplicate compliance wrapper that adds no new duty beyond adjacent detailed rules. Finally sweep the complete Candidate for legal-effect wrappers that only make a specification/appendix/deliverable part of the contract or grant equal legal effect without adding a technical duty, and catch-all negotiation/resolution clauses with no concrete task, workflow, output, or deadline; remove them even when far from the challenge cluster. This is one coarse range projection, not a ledger.",
		"12. Check final_ranges itself: every kept block is present, every block in either exclusion field is absent, no uncited tail is absorbed by continuity, and [] is explicit null. Do not call the tool with only a whole-chapter conclusion.",
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
	keepBlockIds: ReadonlySet<number>,
): ReleaseStructureFocus {
	if (!structureMap.provided || keepBlockIds.size === 0) {
		const source = "keep-side structure focus unavailable for this release mode";
		return {
			targetNodeCount: 0,
			includedNodeCount: 0,
			renderedCharacterCount: source.length,
			coverage: "unavailable",
			source,
		};
	}

	const targetRows = structureMap.renderedRows.filter((row) => keepBlockIds.has(row.blockId));
	if (targetRows.length === 0) {
		const source = "no mechanically selected structure nodes intersect the Candidate keep side";
		return {
			targetNodeCount: 0,
			includedNodeCount: 0,
			renderedCharacterCount: source.length,
			coverage: structureMap.coverage === "complete" ? "complete" : "partial",
			source,
		};
	}

	const render = (row: FocusSourceRow) => `KEEP_STRUCTURE|${row.text}`;
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

function buildReleaseAdversarialNavigation(
	rows: readonly FocusSourceRow[],
	candidateBlockIds: ReadonlySet<number>,
	proposedRemoveBlockIds: ReadonlySet<number>,
	addBlockIds: ReadonlySet<number>,
): ReleaseAdversarialNavigation {
	const candidateKeepBlockIds = new Set(
		[...candidateBlockIds].filter((blockId) => !proposedRemoveBlockIds.has(blockId)),
	);
	const changeBlockIds = new Set([...proposedRemoveBlockIds, ...addBlockIds]);
	const rowCharacterBudget = Math.max(1, MAX_RELEASE_FOCUS_CHARACTERS - 256);
	if (proposedRemoveBlockIds.size === 0) {
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
			source: "atomic navigation keep side omitted for add-only review",
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

	const sideSpecs = [
		{ key: "keep" as const, blockIds: candidateKeepBlockIds, label: "ATOMIC_KEEP_TARGET" },
		{ key: "change" as const, blockIds: changeBlockIds, label: "ATOMIC_CHANGE_TARGET" },
	].sort(
		(left, right) =>
			left.blockIds.size - right.blockIds.size || left.key.localeCompare(right.key),
	);
	const [primary, secondary] = sideSpecs;
	const primaryIsMateriallySmaller = primary.blockIds.size * 2 <= secondary.blockIds.size;
	const primaryBlockBudget = primaryIsMateriallySmaller
		? Math.floor((MAX_RELEASE_FOCUS_BLOCKS * 3) / 4)
		: Math.floor(MAX_RELEASE_FOCUS_BLOCKS / 2);
	const primaryCharacterBudget = primaryIsMateriallySmaller
		? Math.floor((rowCharacterBudget * 3) / 4)
		: Math.floor(rowCharacterBudget / 2);
	const primaryFocus = buildFocusedSource(
		rows,
		primary.blockIds,
		primaryBlockBudget,
		primaryCharacterBudget,
		primary.label,
	);
	const secondaryFocus = buildFocusedSource(
		rows,
		secondary.blockIds,
		Math.max(0, MAX_RELEASE_FOCUS_BLOCKS - primaryFocus.renderedBlockCount),
		Math.max(0, rowCharacterBudget - primaryFocus.renderedCharacterCount),
		secondary.label,
	);
	const keep = primary.key === "keep" ? primaryFocus : secondaryFocus;
	const change = primary.key === "change" ? primaryFocus : secondaryFocus;
	const sections: string[] = [];
	if (keep.renderedBlockCount > 0) sections.push(`## CANDIDATE_KEEP_SIDE\n${keep.source}`);
	if (change.renderedBlockCount > 0) sections.push(`## PROPOSED_CHANGE_SIDE\n${change.source}`);
	const source = sections.join("\n") || "atomic navigation omitted; use the complete source above";
	return {
		keep,
		change,
		renderedBlockCount: keep.renderedBlockCount + change.renderedBlockCount,
		renderedCharacterCount: source.length,
		source,
	};
}

function buildFocusedSource(
	rows: readonly FocusSourceRow[],
	targetBlockIds: ReadonlySet<number>,
	maxBlocks: number,
	maxCharacters: number,
	targetLabel: "ATOMIC_KEEP_TARGET" | "ATOMIC_CHANGE_TARGET",
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
