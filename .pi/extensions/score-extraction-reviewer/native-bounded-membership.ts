import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type AgentMessage,
	type AgentTool,
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
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import {
	buildPiNativeDeltaEvidencePacket,
	type PiNativeDeltaEvidencePacket,
} from "./native.ts";
import {
	compactBlockRanges,
	parseStrictRanges,
	type ReviewPatch,
	type ScoreReviewPacket,
} from "./reviewer.ts";

const CONTRACT_VERSION =
	"score-extraction-reviewer.pi-native.common-id-normalized-membership.v51";
const SCHEMA_VERSION = "xique.score-review.pi-native-common-id-normalized-result.v51";
const ATOMIC_REMOVAL_CONTRACT_VERSION =
	"score-extraction-reviewer.pi-native.atomic-removal-verifier.v53";
const ATOMIC_REMOVAL_SCHEMA_VERSION =
	"xique.score-review.pi-native-atomic-removal-result.v53";
const COMPLETE_DELTA_CONTRACT_VERSION =
	"score-extraction-reviewer.pi-native.candidate-protecting-complete-delta.v89";
const COMPLETE_DELTA_SCHEMA_VERSION =
	"xique.score-review.pi-native-candidate-protecting-complete-delta-result.v89";
const EDITABLE_UNION_CONTRACT_VERSION =
	"score-extraction-reviewer.pi-native.hypothesis-terminal-adjudication.v91";
const EDITABLE_UNION_SCHEMA_VERSION =
	"xique.score-review.pi-native-hypothesis-terminal-adjudication-result.v91";
const MAX_PROVIDER_CALLS = 3;
const TWO_CALL_MAX_PROVIDER_CALLS = 2;
const MAX_RUN_INPUT_TOKENS = 200_000;
const COMPLETE_DELTA_MAX_RUN_INPUT_TOKENS = 2_000_000;
const MAX_OUTPUT_TOKENS = 8_000;
const EDITABLE_UNION_MAX_OUTPUT_TOKENS = 14_000;
const MAX_REASONING_TOKENS = 30_000;
const CONTEXT_SAFETY_TOKENS = 8_000;
const REVIEWER_MAX_TOKENS = 800;
const COMPLETE_DELTA_REVIEWER_MAX_TOKENS = 4_500;
const EDITABLE_UNION_REVIEWER_MAX_TOKENS = 7_000;
const INSPECTION_PLANNER_MAX_TOKENS = 1_200;
const PRIMARY_MAX_TOKENS = 2_000;
const COMPLETE_DELTA_PRIMARY_MAX_TOKENS = 3_500;
const EDITABLE_UNION_PRIMARY_MAX_TOKENS = 7_000;
const ATOMIC_REMOVAL_VERIFIER_MAX_TOKENS = 1_200;
const REQUEST_TIMEOUT_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 600_000;
const LARGE_DIFFERENCE_BLOCK_CHARACTERS = 4_000;
const ATOMIC_BLOCK_CHUNK_CHARACTERS = 1_800;
const MAX_LITERAL_MATCHES_PER_QUERY_BLOCK = 3;
const LITERAL_MATCH_CONTEXT_CHARACTERS = 600;
const MAX_LITERAL_EVIDENCE_CHARACTERS = 12_000;
const CANDIDATE_LINKED_REFERENCE_RADIUS_BLOCKS = 20;
const MAX_CANDIDATE_LINKED_REFERENCE_CHARACTERS = 24_000;
const MAX_CANDIDATE_LINKED_REFERENCE_BLOCK_CHARACTERS = 4_000;
const REVIEWER_TOOL_NAME = "submit_pi_native_v51_action_review";
const INSPECTION_PLANNER_TOOL_NAME =
	"submit_pi_native_v51_literal_inspection_plan";
const PRIMARY_TOOL_NAME = "submit_pi_native_v51_bounded_membership";
const ATOMIC_REMOVAL_VERIFIER_TOOL_NAME =
	"submit_pi_native_v53_atomic_removal_verification";
const COMPLETE_DELTA_REVIEWER_TOOL_NAME =
	"submit_pi_native_v55_complete_delta_review";
const COMPLETE_DELTA_PRIMARY_TOOL_NAME =
	"submit_pi_native_v55_bounded_membership";
const EDITABLE_UNION_REVIEWER_TOOL_NAME =
	"submit_pi_native_v57_complete_candidate_delta";
const EDITABLE_UNION_PRIMARY_TOOL_NAME =
	"submit_pi_native_v57_editable_union_membership";

const EvidenceBlockIdsSchema = Type.Array(Type.Integer({ minimum: 0 }), {
	minItems: 1,
	maxItems: 64,
});

const ReviewerDecisionSchema = Type.Object(
	{
		verdict: Type.Union([Type.Literal("PASS"), Type.Literal("CHALLENGE")]),
		challenge_type: Type.Union([
			Type.Literal("NONE"),
			Type.Literal("ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE"),
			Type.Literal("REMOVE_ALL_NO_VALID_EVALUATOR"),
			Type.Literal("REMOVE_SEPARABLE_NON_TARGET_OR_BOUNDARY_OVERRUN"),
		]),
		change_block_ids: Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 64 }),
	},
	{ additionalProperties: false },
);

const CompleteDeltaReviewerDecisionSchema = Type.Object(
	{
		verdict: Type.Union([Type.Literal("PASS"), Type.Literal("CHALLENGE")]),
		challenge_type: Type.Union([
			Type.Literal("NONE"),
			Type.Literal("EDGE_OR_LOCAL_GROUP_COMPLETION"),
			Type.Literal("REMOVE_ALL_NO_VALID_EVALUATOR"),
			Type.Literal("REMOVE_SEPARABLE_NON_TARGET_OR_BOUNDARY_OVERRUN"),
			Type.Literal("ADD_REMOTE_OMITTED_TARGET_OR_REQUIRED_CLOSURE"),
			Type.Literal("MIXED_COMPLETE_DELTA"),
		]),
		change_block_ids: Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 512 }),
	},
	{ additionalProperties: false },
);

const InspectionPlanSchema = Type.Object(
	{
		focus_block_ids: Type.Array(Type.Integer({ minimum: 0 }), {
			minItems: 1,
			maxItems: 8,
		}),
		target_literal_queries: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
			minItems: 1,
			maxItems: 3,
		}),
		boundary_literal_queries: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
			minItems: 1,
			maxItems: 3,
		}),
	},
	{ additionalProperties: false },
);

const PrimaryDecisionSchema = Type.Object(
	{
		included_difference_block_ids: Type.Array(Type.Integer({ minimum: 0 }), {
			maxItems: 64,
		}),
		evidence_block_ids: EvidenceBlockIdsSchema,
	},
	{ additionalProperties: false },
);

const CompleteDeltaPrimaryDecisionSchema = Type.Object(
	{
		included_difference_block_ids: Type.Array(Type.Integer({ minimum: 0 }), {
			maxItems: 512,
		}),
	},
	{ additionalProperties: false },
);

const EditableUnionReviewerDecisionSchema = Type.Object(
	{
		change_block_ids: Type.Array(Type.Integer({ minimum: 0 }), {
			maxItems: 512,
		}),
	},
	{ additionalProperties: false },
);

type PiNativeEditableUnionReviewerSubmission = Static<
	typeof EditableUnionReviewerDecisionSchema
>;

const EditableUnionPrimaryDecisionSchema = Type.Object(
	{
		included_review_universe_block_ids: Type.Array(
			Type.Integer({ minimum: 0 }),
			{ maxItems: 512 },
		),
	},
	{ additionalProperties: false },
);

const AtomicRemovalVerifierDecisionSchema = Type.Object(
	{
		verdict: Type.Union([
			Type.Literal("RETAIN_ATOMIC_BLOCK"),
			Type.Literal("AUTHORIZE_REMOVAL"),
		]),
		source_literal_query: Type.String({ minLength: 4, maxLength: 120 }),
	},
	{ additionalProperties: false },
);

export type PiNativeBoundedMembershipReviewerDecision = Static<
	typeof ReviewerDecisionSchema
>;
type PiNativeCompleteDeltaReviewerSubmission = Static<
	typeof CompleteDeltaReviewerDecisionSchema
>;
export interface PiNativeCompleteDeltaReviewerDecision {
	verdict: PiNativeCompleteDeltaReviewerSubmission["verdict"];
	challenge_type: PiNativeCompleteDeltaReviewerSubmission["challenge_type"];
	change_block_ids: number[];
	ignored_out_of_envelope_block_ids: number[];
}
export type PiNativeBoundedMembershipInspectionPlan = Static<
	typeof InspectionPlanSchema
>;
export type PiNativeBoundedMembershipPrimaryDecision = Static<
	typeof PrimaryDecisionSchema
>;
export type PiNativeCompleteDeltaPrimaryDecision = Static<
	typeof CompleteDeltaPrimaryDecisionSchema
>;
export interface PiNativeEditableUnionReviewerDecision {
	change_block_ids: number[];
	ignored_out_of_envelope_block_ids: number[];
}
export type PiNativeEditableUnionPrimaryDecision = Static<
	typeof EditableUnionPrimaryDecisionSchema
>;
type PiNativeAtomicRemovalVerifierSubmission = Static<
	typeof AtomicRemovalVerifierDecisionSchema
>;

export interface PiNativeAtomicRemovalVerifierDecision {
	verdict: PiNativeAtomicRemovalVerifierSubmission["verdict"];
	sourceLiteralQuery: string;
	exactQuote: string;
	quoteStart: number;
	quoteEnd: number;
}

export interface PiNativeBoundedMembershipPrompts {
	architecture: string;
	candidate: string;
	reviewer: string;
	reviewerTask: string;
	emptyReviewer: string;
	emptyReviewerTask: string;
	primary: string;
	primaryTask: string;
	inspectionPlanner: string;
	inspectionPlannerTask: string;
	hashes: {
		architecture: string;
		candidate: string;
		reviewer: string;
		reviewerTask: string;
		emptyReviewer: string;
		emptyReviewerTask: string;
		primary: string;
		primaryTask: string;
		inspectionPlanner: string;
		inspectionPlannerTask: string;
	};
}

export interface PiNativeAtomicRemovalPrompts
	extends PiNativeBoundedMembershipPrompts {
	atomicRemovalVerifier: string;
	atomicRemovalVerifierTask: string;
	edgeAdditionPrimary: string;
	edgeAdditionPrimaryTask: string;
	hashes: PiNativeBoundedMembershipPrompts["hashes"] & {
		atomicRemovalVerifier: string;
		atomicRemovalVerifierTask: string;
		edgeAdditionPrimary: string;
		edgeAdditionPrimaryTask: string;
	};
}

export interface PiNativeCompleteDeltaPrompts
	extends PiNativeBoundedMembershipPrompts {}

export interface PiNativeEditableUnionPrompts
	extends PiNativeBoundedMembershipPrompts {
	semanticCore: string;
	hashes: PiNativeBoundedMembershipPrompts["hashes"] & {
		semanticCore: string;
	};
}

export interface PiNativeBoundedMembershipRuntime {
	model: Model<Api>;
	streamFunction: StreamFn;
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: ProviderEnv;
}

export type PiNativeBoundedMembershipRole =
	| "reviewer"
	| "inspection_planner"
	| "primary"
	| "atomic_removal_verifier";

export interface PiNativeBoundedMembershipProgress {
	status: "running";
	role: PiNativeBoundedMembershipRole;
	tool: string;
}

interface RoleUsage {
	providerCalls: number;
	estimatedInputTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
}

interface RuntimeUsage {
	roles: Record<PiNativeBoundedMembershipRole, RoleUsage>;
}

export type PiNativeBoundedMembershipFailureCode =
	| "contract_error"
	| "context_capacity"
	| "run_budget"
	| "provider_error"
	| "timeout"
	| "aborted";

export interface PiNativeBoundedMembershipFailure {
	role: PiNativeBoundedMembershipRole | "preflight";
	code: PiNativeBoundedMembershipFailureCode;
	message: string;
}

interface StructuredCallPlan<TSchemaType extends TSchema, TResult> {
	role: PiNativeBoundedMembershipRole;
	toolName: string;
	toolLabel: string;
	toolDescription: string;
	schema: TSchemaType;
	maxTokens: number;
	reasoning: "off" | "medium";
	systemPrompt: string;
	userPrompt: string;
	fullSystemPrompt: string;
	inputSha256: string;
	estimatedInputTokens: number;
	parse: (raw: Static<TSchemaType>) => TResult;
}

interface StructuredCallResult<TResult> {
	value: TResult;
	terminalMode:
		| "tool_call"
		| "identical_duplicate_tool_calls"
		| "strict_json_text";
	terminalCallCount: number;
}

export interface PiNativeBoundedMembershipCallTrace {
	role: PiNativeBoundedMembershipRole;
	tool: string;
	model: { provider: string; id: string; contextWindow: number };
	inputSha256: string;
	estimatedInputTokens: number;
	terminalMode:
		| "tool_call"
		| "identical_duplicate_tool_calls"
		| "strict_json_text";
	terminalCallCount: number;
}

export interface PiNativeBoundedMembershipResult {
	schemaVersion:
		| typeof SCHEMA_VERSION
		| typeof ATOMIC_REMOVAL_SCHEMA_VERSION
		| typeof COMPLETE_DELTA_SCHEMA_VERSION
		| typeof EDITABLE_UNION_SCHEMA_VERSION;
	contractVersion:
		| typeof CONTRACT_VERSION
		| typeof ATOMIC_REMOVAL_CONTRACT_VERSION
		| typeof COMPLETE_DELTA_CONTRACT_VERSION
		| typeof EDITABLE_UNION_CONTRACT_VERSION;
	capabilitySha256: string;
	packetSha256: string;
	sourceName: string;
	sourceSha256: string;
	outputField: string;
	status: "complete" | "degraded";
	resolution:
		| "candidate_preserved_by_empty_reviewer"
		| "candidate_preserved_by_reviewer_pass"
		| "pairwise_set_a_selected"
		| "pairwise_set_b_selected"
		| "pairwise_partial_membership_selected"
		| "editable_union_membership_selected"
		| "atomic_block_retained"
		| "atomic_block_removal_authorized"
		| "degraded_candidate_fallback";
	reason: string;
	initialRanges: string[];
	finalRanges: string[];
	finalBlockIds: number[];
	candidatePreserved: boolean;
	reviewDegraded: boolean;
	failure: PiNativeBoundedMembershipFailure | null;
	patch: ReviewPatch | null;
	decisions: {
		reviewer:
			| PiNativeBoundedMembershipReviewerDecision
			| PiNativeCompleteDeltaReviewerDecision
			| PiNativeEditableUnionReviewerDecision
			| null;
		inspectionPlan: PiNativeBoundedMembershipInspectionPlan | null;
		inspectionEvidence: string | null;
		primary:
			| PiNativeBoundedMembershipPrimaryDecision
			| PiNativeCompleteDeltaPrimaryDecision
			| PiNativeEditableUnionPrimaryDecision
			| null;
		atomicRemovalVerifier: PiNativeAtomicRemovalVerifierDecision | null;
	};
	context: {
		coverage:
			| "full_source_reviewer_bounded_pairwise_primary"
			| "full_source_reviewer_focused_union_primary"
			| "full_source_reviewer_atomic_removal_verifier";
		fullSourceSha256: string;
		fullSourceCharacters: number;
		sourceCharacters: number;
		blockCount: number;
		sequenceCount: number;
		explicitReferenceCount: number;
		reviewerInputSha256: string | null;
		inspectionPlannerInputSha256: string | null;
		pairwiseSourceSha256: string | null;
		primaryInputSha256: string | null;
		atomicRemovalVerifierInputSha256: string | null;
		atomicRemovalBlockId: number | null;
		inspectionEvidenceSha256: string | null;
		representationLimitCharacters: number | null;
		representationFit: boolean;
	};
	prompts:
		| PiNativeBoundedMembershipPrompts["hashes"]
		| PiNativeAtomicRemovalPrompts["hashes"]
		| PiNativeEditableUnionPrompts["hashes"];
	models: {
		reviewer: { provider: string; id: string; contextWindow: number };
		inspectionPlanner: { provider: string; id: string; contextWindow: number };
		primary: { provider: string; id: string; contextWindow: number };
		atomicRemovalVerifier: {
			provider: string;
			id: string;
			contextWindow: number;
		};
	};
	calls: PiNativeBoundedMembershipCallTrace[];
	budget: RoleUsage & {
		maxProviderCalls: number;
		maxRunInputTokens: number;
		maxOutputTokens: number;
		maxReasoningTokens: number;
		roles: Record<PiNativeBoundedMembershipRole, RoleUsage>;
	};
	latencyMs: number;
}

export interface RunPiNativeBoundedMembershipOptions {
	packet: ScoreReviewPacket;
	packetSha256: string;
	prompts: PiNativeBoundedMembershipPrompts;
	reviewerRuntime: PiNativeBoundedMembershipRuntime;
	primaryRuntime: PiNativeBoundedMembershipRuntime;
	signal?: AbortSignal;
	requestTimeoutMs?: number;
	workflowTimeoutMs?: number;
	onProgress?: (progress: PiNativeBoundedMembershipProgress) => void;
}

export interface RunPiNativeAtomicRemovalOptions
	extends Omit<RunPiNativeBoundedMembershipOptions, "prompts"> {
	prompts: PiNativeAtomicRemovalPrompts;
}

export interface RunPiNativeCompleteDeltaOptions
	extends Omit<RunPiNativeBoundedMembershipOptions, "prompts"> {
	prompts: PiNativeCompleteDeltaPrompts;
}

export interface RunPiNativeEditableUnionOptions
	extends Omit<RunPiNativeBoundedMembershipOptions, "prompts"> {
	prompts: PiNativeEditableUnionPrompts;
}

interface PiNativeBoundedMembershipRoute {
	contractVersion:
		| typeof CONTRACT_VERSION
		| typeof ATOMIC_REMOVAL_CONTRACT_VERSION
		| typeof COMPLETE_DELTA_CONTRACT_VERSION
		| typeof EDITABLE_UNION_CONTRACT_VERSION;
	schemaVersion:
		| typeof SCHEMA_VERSION
		| typeof ATOMIC_REMOVAL_SCHEMA_VERSION
		| typeof COMPLETE_DELTA_SCHEMA_VERSION
		| typeof EDITABLE_UNION_SCHEMA_VERSION;
	atomicRemovalVerifier: boolean;
	completeDelta: boolean;
	editableUnion: boolean;
}

class BoundedMembershipContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BoundedMembershipContractError";
	}
}

class BoundedMembershipContextCapacityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BoundedMembershipContextCapacityError";
	}
}

class BoundedMembershipRunBudgetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BoundedMembershipRunBudgetError";
	}
}

export async function loadPiNativeBoundedMembershipPrompts(
	directory: string,
): Promise<PiNativeBoundedMembershipPrompts> {
	const [
		architecture,
		candidate,
		reviewer,
		reviewerTask,
		emptyReviewer,
		emptyReviewerTask,
		primary,
		primaryTask,
		inspectionPlanner,
		inspectionPlannerTask,
	] = await Promise.all([
			readFile(join(directory, "pi-native-bounded-membership-agent.md"), "utf8"),
			readFile(join(directory, "accepted-score-candidate-v019.txt"), "utf8"),
			readFile(join(directory, "pi-native-bounded-membership-reviewer.md"), "utf8"),
			readFile(
				join(directory, "pi-native-bounded-membership-reviewer-task.md"),
				"utf8",
			),
			readFile(
				join(directory, "pi-native-bounded-membership-empty-reviewer.md"),
				"utf8",
			),
			readFile(
				join(directory, "pi-native-bounded-membership-empty-reviewer-task.md"),
				"utf8",
			),
			readFile(join(directory, "pi-native-bounded-membership-primary.md"), "utf8"),
			readFile(
				join(directory, "pi-native-bounded-membership-primary-task.md"),
				"utf8",
			),
			readFile(
				join(directory, "pi-native-bounded-membership-inspection-planner.md"),
				"utf8",
			),
			readFile(
				join(directory, "pi-native-bounded-membership-inspection-planner-task.md"),
				"utf8",
			),
		]);
	return {
		architecture,
		candidate,
		reviewer,
		reviewerTask,
		emptyReviewer,
		emptyReviewerTask,
		primary,
		primaryTask,
		inspectionPlanner,
		inspectionPlannerTask,
		hashes: {
			architecture: sha256(architecture),
			candidate: sha256(candidate),
			reviewer: sha256(reviewer),
			reviewerTask: sha256(reviewerTask),
			emptyReviewer: sha256(emptyReviewer),
			emptyReviewerTask: sha256(emptyReviewerTask),
			primary: sha256(primary),
			primaryTask: sha256(primaryTask),
			inspectionPlanner: sha256(inspectionPlanner),
			inspectionPlannerTask: sha256(inspectionPlannerTask),
		},
	};
}

export async function loadPiNativeAtomicRemovalPrompts(
	directory: string,
): Promise<PiNativeAtomicRemovalPrompts> {
	const [
		base,
		architecture,
		atomicRemovalVerifier,
		atomicRemovalVerifierTask,
		edgeAdditionPrimary,
		edgeAdditionPrimaryTask,
	] =
		await Promise.all([
			loadPiNativeBoundedMembershipPrompts(directory),
			readFile(join(directory, "pi-native-atomic-removal-agent.md"), "utf8"),
			readFile(
				join(directory, "pi-native-atomic-removal-verifier.md"),
				"utf8",
			),
			readFile(
				join(directory, "pi-native-atomic-removal-verifier-task.md"),
				"utf8",
			),
			readFile(join(directory, "pi-native-edge-addition-primary.md"), "utf8"),
			readFile(
				join(directory, "pi-native-edge-addition-primary-task.md"),
				"utf8",
			),
		]);
	return {
		...base,
		architecture,
		atomicRemovalVerifier,
		atomicRemovalVerifierTask,
		edgeAdditionPrimary,
		edgeAdditionPrimaryTask,
		hashes: {
			...base.hashes,
			architecture: sha256(architecture),
			atomicRemovalVerifier: sha256(atomicRemovalVerifier),
			atomicRemovalVerifierTask: sha256(atomicRemovalVerifierTask),
			edgeAdditionPrimary: sha256(edgeAdditionPrimary),
			edgeAdditionPrimaryTask: sha256(edgeAdditionPrimaryTask),
		},
	};
}

export async function loadPiNativeCompleteDeltaPrompts(
	directory: string,
): Promise<PiNativeCompleteDeltaPrompts> {
	const [base, architecture, reviewer, reviewerTask, primary, primaryTask] =
		await Promise.all([
			loadPiNativeBoundedMembershipPrompts(directory),
			readFile(join(directory, "pi-native-complete-delta-agent.md"), "utf8"),
			readFile(join(directory, "pi-native-complete-delta-reviewer.md"), "utf8"),
			readFile(
				join(directory, "pi-native-complete-delta-reviewer-task.md"),
				"utf8",
			),
			readFile(join(directory, "pi-native-complete-delta-primary.md"), "utf8"),
			readFile(
				join(directory, "pi-native-complete-delta-primary-task.md"),
				"utf8",
			),
		]);
	return {
		...base,
		architecture,
		reviewer,
		reviewerTask,
		primary,
		primaryTask,
		hashes: {
			...base.hashes,
			architecture: sha256(architecture),
			reviewer: sha256(reviewer),
			reviewerTask: sha256(reviewerTask),
			primary: sha256(primary),
			primaryTask: sha256(primaryTask),
		},
	};
}

export async function loadPiNativeEditableUnionPrompts(
	directory: string,
): Promise<PiNativeEditableUnionPrompts> {
	const [
		base,
		semanticCore,
		architecture,
		reviewer,
		reviewerTask,
		primary,
		primaryTask,
	] =
		await Promise.all([
			loadPiNativeBoundedMembershipPrompts(directory),
			readFile(
				join(directory, "accepted-score-candidate-semantic-core-v019.txt"),
				"utf8",
			),
			readFile(join(directory, "pi-native-editable-union-agent.md"), "utf8"),
			readFile(join(directory, "pi-native-editable-union-reviewer.md"), "utf8"),
			readFile(
				join(directory, "pi-native-editable-union-reviewer-task.md"),
				"utf8",
			),
			readFile(join(directory, "pi-native-editable-union-primary.md"), "utf8"),
			readFile(
				join(directory, "pi-native-editable-union-primary-task.md"),
				"utf8",
			),
		]);
	return {
		...base,
		semanticCore,
		architecture,
		reviewer,
		reviewerTask,
		primary,
		primaryTask,
		hashes: {
			...base.hashes,
			semanticCore: sha256(semanticCore),
			architecture: sha256(architecture),
			reviewer: sha256(reviewer),
			reviewerTask: sha256(reviewerTask),
			primary: sha256(primary),
			primaryTask: sha256(primaryTask),
		},
	};
}

export async function runPiNativeBoundedMembershipReview(
	options: RunPiNativeBoundedMembershipOptions,
): Promise<PiNativeBoundedMembershipResult> {
	return runPiNativeBoundedMembershipReviewRoute(options, {
		contractVersion: CONTRACT_VERSION,
		schemaVersion: SCHEMA_VERSION,
		atomicRemovalVerifier: false,
		completeDelta: false,
		editableUnion: false,
	});
}

export async function runPiNativeAtomicRemovalReview(
	options: RunPiNativeAtomicRemovalOptions,
): Promise<PiNativeBoundedMembershipResult> {
	return runPiNativeBoundedMembershipReviewRoute(options, {
		contractVersion: ATOMIC_REMOVAL_CONTRACT_VERSION,
		schemaVersion: ATOMIC_REMOVAL_SCHEMA_VERSION,
		atomicRemovalVerifier: true,
		completeDelta: false,
		editableUnion: false,
	});
}

export async function runPiNativeCompleteDeltaReview(
	options: RunPiNativeCompleteDeltaOptions,
): Promise<PiNativeBoundedMembershipResult> {
	return runPiNativeBoundedMembershipReviewRoute(options, {
		contractVersion: COMPLETE_DELTA_CONTRACT_VERSION,
		schemaVersion: COMPLETE_DELTA_SCHEMA_VERSION,
		atomicRemovalVerifier: false,
		completeDelta: true,
		editableUnion: false,
	});
}

export async function runPiNativeEditableUnionReview(
	options: RunPiNativeEditableUnionOptions,
): Promise<PiNativeBoundedMembershipResult> {
	return runPiNativeBoundedMembershipReviewRoute(options, {
		contractVersion: EDITABLE_UNION_CONTRACT_VERSION,
		schemaVersion: EDITABLE_UNION_SCHEMA_VERSION,
		atomicRemovalVerifier: false,
		completeDelta: false,
		editableUnion: true,
	});
}

async function runPiNativeBoundedMembershipReviewRoute(
	options:
		| RunPiNativeBoundedMembershipOptions
		| RunPiNativeAtomicRemovalOptions
		| RunPiNativeCompleteDeltaOptions
		| RunPiNativeEditableUnionOptions,
	route: PiNativeBoundedMembershipRoute,
): Promise<PiNativeBoundedMembershipResult> {
	const startedAt = Date.now();
	const context = buildPiNativeDeltaEvidencePacket(options.packet, {
		includeSequenceFacts: !route.completeDelta && !route.editableUnion,
	});
	const usage = emptyRuntimeUsage();
	const calls: PiNativeBoundedMembershipCallTrace[] = [];
	let activeRole: PiNativeBoundedMembershipRole | "preflight" = "preflight";
	let reviewerDecision:
		| PiNativeBoundedMembershipReviewerDecision
		| PiNativeCompleteDeltaReviewerDecision
		| PiNativeEditableUnionReviewerDecision
		| null = null;
	let inspectionPlan: PiNativeBoundedMembershipInspectionPlan | null = null;
	let inspectionEvidence: string | null = null;
	let primaryDecision:
		| PiNativeBoundedMembershipPrimaryDecision
		| PiNativeCompleteDeltaPrimaryDecision
		| PiNativeEditableUnionPrimaryDecision
		| null = null;
	let atomicRemovalVerifierDecision: PiNativeAtomicRemovalVerifierDecision | null =
		null;
	let reviewerInputSha256: string | null = null;
	let inspectionPlannerInputSha256: string | null = null;
	let pairwiseSourceSha256: string | null = null;
	let primaryInputSha256: string | null = null;
	let atomicRemovalVerifierInputSha256: string | null = null;
	let atomicRemovalBlockId: number | null = null;
	let finalBlockIds = context.candidateBlockIds;
	let resolution: PiNativeBoundedMembershipResult["resolution"] =
		"degraded_candidate_fallback";
	let reason = "The bounded-membership review did not start.";
	let failure: PiNativeBoundedMembershipFailure | null = null;

	const finish = (): PiNativeBoundedMembershipResult =>
		buildResult({
			options,
			route,
			context,
			usage,
			calls,
			startedAt,
			finalBlockIds,
			resolution,
			reason,
			failure,
			reviewerDecision,
			inspectionPlan,
			inspectionEvidence,
			primaryDecision,
			atomicRemovalVerifierDecision,
			reviewerInputSha256,
			inspectionPlannerInputSha256,
			pairwiseSourceSha256,
			primaryInputSha256,
			atomicRemovalVerifierInputSha256,
			atomicRemovalBlockId,
		});

	if (options.packet.reviewMode !== "completeness") {
		failure = {
			role: "preflight",
			code: "contract_error",
			message:
				"Bounded-membership review requires reviewMode=completeness. No model was called; the candidate was preserved.",
		};
		reason = failure.message;
		return finish();
	}
	if (!options.packet.locatorContext?.completeSourceCoverage) {
		failure = {
			role: "preflight",
			code: "contract_error",
			message:
				"Bounded-membership review requires explicit complete-source coverage. No model was called; the candidate was preserved.",
		};
		reason = failure.message;
		return finish();
	}
	if (!route.completeDelta && !route.editableUnion && !context.representationFit) {
		failure = {
			role: "preflight",
			code: "run_budget",
			message: `The full-source representation exceeded its deterministic character budget ${context.representationLimitCharacters ?? "unknown"}. No model was called; the candidate was preserved.`,
		};
		reason = failure.message;
		return finish();
	}

	const timeoutController = new AbortController();
	const timeout = setTimeout(
		() =>
			timeoutController.abort(
				new Error("Pi-native bounded-membership workflow timed out"),
			),
		options.workflowTimeoutMs ?? WORKFLOW_TIMEOUT_MS,
	);
	timeout.unref();
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutController.signal])
		: timeoutController.signal;

	try {
		const emptyCandidate = context.candidateBlockIds.length === 0;
		const reviewerPlan = route.editableUnion
			? createStructuredCallPlan({
					role: "reviewer",
					toolName: EDITABLE_UNION_REVIEWER_TOOL_NAME,
					toolLabel: "Submit complete candidate delta",
					toolDescription:
						"Submit every canonical block ID whose membership must change relative to the mature candidate.",
					schema: EditableUnionReviewerDecisionSchema,
					maxTokens: EDITABLE_UNION_REVIEWER_MAX_TOKENS,
					reasoning: "medium",
					systemPrompt: reviewerSystemPrompt(
						options.prompts,
						emptyCandidate,
						route,
					),
					userPrompt: reviewerPrompt(
						context,
						options.prompts,
						emptyCandidate,
						route,
					),
					parse(raw) {
						return validateEditableUnionReviewerDecision(raw, context);
					},
				})
			: route.completeDelta
				? createStructuredCallPlan({
					role: "reviewer",
					toolName: COMPLETE_DELTA_REVIEWER_TOOL_NAME,
					toolLabel: "Submit complete residual delta",
					toolDescription:
						"Pass the candidate or submit every source-address membership change required by one corrected answer.",
					schema: CompleteDeltaReviewerDecisionSchema,
					maxTokens: COMPLETE_DELTA_REVIEWER_MAX_TOKENS,
					reasoning: "medium",
					systemPrompt: reviewerSystemPrompt(
						options.prompts,
						emptyCandidate,
						route,
					),
					userPrompt: reviewerPrompt(
						context,
						options.prompts,
						emptyCandidate,
						route,
					),
					parse(raw) {
						return validateCompleteDeltaReviewerDecision(raw, context);
					},
					})
				: createStructuredCallPlan({
					role: "reviewer",
					toolName: REVIEWER_TOOL_NAME,
					toolLabel: "Submit bounded score-review challenge",
					toolDescription: "Submit the schema-validated Reviewer decision.",
					schema: ReviewerDecisionSchema,
					maxTokens: REVIEWER_MAX_TOKENS,
					reasoning: "medium",
					systemPrompt: reviewerSystemPrompt(
						options.prompts,
						emptyCandidate,
						route,
					),
					userPrompt: reviewerPrompt(
						context,
						options.prompts,
						emptyCandidate,
						route,
					),
					parse(raw) {
						return validateReviewerDecision(raw, context);
					},
				});
		reviewerInputSha256 = reviewerPlan.inputSha256;
		activeRole = "reviewer";
		const reviewerCall = await structuredCall({
			plan: reviewerPlan,
			runtime: options.reviewerRuntime,
			usage,
			signal,
			requestTimeoutMs: options.requestTimeoutMs,
			onProgress: options.onProgress,
			maxRunInputTokens: runInputTokenLimit(route),
			maxRunOutputTokens: runOutputTokenLimit(route),
			maxProviderCalls: providerCallLimit(route),
		});
		reviewerDecision = reviewerCall.value;
		calls.push(callTrace(reviewerPlan, options.reviewerRuntime, reviewerCall));

		if (!("verdict" in reviewerDecision)) {
			const proposedBlockIds = applyToggle(
				context.candidateBlockIds,
				reviewerDecision.change_block_ids,
			);
			if (
				context.candidateBlockIds.length === 0 &&
				sameIds(proposedBlockIds, context.candidateBlockIds)
			) {
				resolution = "candidate_preserved_by_reviewer_pass";
				reason =
					"The Reviewer found no source-grounded membership change for the empty candidate.";
				return finish();
			}
			const reviewUniverseBlockIds = [
				...new Set([...context.candidateBlockIds, ...proposedBlockIds]),
			].sort((left, right) => left - right);
			const reviewUniverse = new Set(reviewUniverseBlockIds);
			const primaryPlan = createStructuredCallPlan({
				role: "primary",
				toolName: EDITABLE_UNION_PRIMARY_TOOL_NAME,
				toolLabel: "Submit editable-union membership",
				toolDescription:
					"Independently publish the complete final membership as a subset of the mechanically bounded review universe.",
				schema: EditableUnionPrimaryDecisionSchema,
				maxTokens: EDITABLE_UNION_PRIMARY_MAX_TOKENS,
				reasoning: "medium",
				systemPrompt: primarySystemPrompt(options.prompts, route),
				userPrompt: editableUnionPrimaryPrompt(
					reviewUniverseBlockIds,
					context.candidateBlockIds,
					proposedBlockIds,
					renderEditableUnionSourceSlice(
						options.packet,
						context,
						reviewUniverseBlockIds,
						context.candidateBlockIds,
						proposedBlockIds,
					),
					options.prompts.primaryTask,
				),
				parse(raw) {
					const submittedMembershipIds = validateIds(
						raw.included_review_universe_block_ids,
						context.availableBlockIds,
						"included_review_universe_block_ids",
						true,
					);
					if (
						submittedMembershipIds.some(
							(blockId) => !reviewUniverse.has(blockId),
						)
					) {
						throw new BoundedMembershipContractError(
							"included_review_universe_block_ids contains an ID outside the editable review universe",
						);
					}
					return {
						included_review_universe_block_ids: submittedMembershipIds,
					};
				},
			});
			primaryInputSha256 = primaryPlan.inputSha256;
			activeRole = "primary";
			const primaryCall = await structuredCall({
				plan: primaryPlan,
				runtime: options.primaryRuntime,
				usage,
				signal,
				requestTimeoutMs: options.requestTimeoutMs,
				onProgress: options.onProgress,
				maxRunInputTokens: runInputTokenLimit(route),
				maxRunOutputTokens: runOutputTokenLimit(route),
				maxProviderCalls: providerCallLimit(route),
			});
			primaryDecision = primaryCall.value;
			calls.push(callTrace(primaryPlan, options.primaryRuntime, primaryCall));
			finalBlockIds = primaryDecision.included_review_universe_block_ids;
			resolution = "editable_union_membership_selected";
			reason =
				"The independent Finalizer published one complete membership inside the candidate-plus-delta review universe.";
			return finish();
		}

		if (reviewerDecision.verdict === "PASS") {
			resolution = route.completeDelta
				? "candidate_preserved_by_reviewer_pass"
				: "candidate_preserved_by_empty_reviewer";
			reason = route.completeDelta
				? "The orthogonal Reviewer found no complete source-grounded residual delta."
				: "The empty-candidate Reviewer returned PASS under its frozen contract.";
			return finish();
		}

		const proposedBlockIds = applyToggle(
			context.candidateBlockIds,
			reviewerDecision.change_block_ids,
		);
		const proposedSet = new Set(proposedBlockIds);
		const candidateSet = new Set(context.candidateBlockIds);
		const candidateOnlyBlockIds = context.candidateBlockIds.filter(
			(blockId) => !proposedSet.has(blockId),
		);
		const proposedOnlyBlockIds = proposedBlockIds.filter(
			(blockId) => !candidateSet.has(blockId),
		);
		const differenceBlockIds = [
			...candidateOnlyBlockIds,
			...proposedOnlyBlockIds,
		].sort((left, right) => left - right);
		const differenceBlockIdSet = new Set(differenceBlockIds);
		const commonBlockIds = context.candidateBlockIds.filter((blockId) =>
			proposedSet.has(blockId),
		);
		const allowedSubmittedMembershipIds = new Set([
			...differenceBlockIds,
			...commonBlockIds,
		]);
		const pairwiseSource = renderPairwiseSourceSlice(
			options.packet,
			context,
			context.candidateBlockIds,
			proposedBlockIds,
			differenceBlockIds,
		);
		pairwiseSourceSha256 = sha256(pairwiseSource);
		const largeDifferenceBlockIds = differenceBlockIds.filter((blockId) => {
			const sourceText = context.blocksById.get(blockId)?.sourceText;
			return (
				sourceText !== undefined &&
				sourceText.length >= LARGE_DIFFERENCE_BLOCK_CHARACTERS
			);
		});
		const atomicRemovalPrompts = atomicRemovalPromptsForRoute(
			options.prompts,
			route,
		);
		if (
			atomicRemovalPrompts !== null &&
			"challenge_type" in reviewerDecision &&
			reviewerDecision.challenge_type !==
				"ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE" &&
			candidateOnlyBlockIds.length > 0 &&
			proposedOnlyBlockIds.length === 0 &&
			largeDifferenceBlockIds.length === 1
		) {
			atomicRemovalBlockId = largeDifferenceBlockIds[0] ?? null;
			if (atomicRemovalBlockId === null) {
				throw new BoundedMembershipContractError(
					"atomic removal route lost its challenged block",
				);
			}
			const atomicProposedBlockIds = context.candidateBlockIds.filter(
				(blockId) => blockId !== atomicRemovalBlockId,
			);
			const atomicRemovalSource = renderPairwiseSourceSlice(
				options.packet,
				context,
				[atomicRemovalBlockId],
				[],
				[atomicRemovalBlockId],
				ATOMIC_BLOCK_CHUNK_CHARACTERS,
			);
			pairwiseSourceSha256 = sha256(atomicRemovalSource);
			const verifierPlan = createStructuredCallPlan({
				role: "atomic_removal_verifier",
				toolName: ATOMIC_REMOVAL_VERIFIER_TOOL_NAME,
				toolLabel: "Verify one atomic-block removal",
				toolDescription:
					"Submit the schema-validated retain-or-remove decision and one distinctive source literal query.",
				schema: AtomicRemovalVerifierDecisionSchema,
				maxTokens: ATOMIC_REMOVAL_VERIFIER_MAX_TOKENS,
				reasoning: "medium",
				systemPrompt: atomicRemovalVerifierSystemPrompt(
					atomicRemovalPrompts,
				),
				userPrompt: atomicRemovalVerifierPrompt(
					context.candidateBlockIds,
					atomicProposedBlockIds,
					atomicRemovalBlockId,
					atomicRemovalSource,
					atomicRemovalPrompts.atomicRemovalVerifierTask,
				),
				parse(raw) {
					return validateAtomicRemovalVerifierDecision(
						raw,
						atomicRemovalBlockId,
						context,
					);
				},
			});
			atomicRemovalVerifierInputSha256 = verifierPlan.inputSha256;
			activeRole = "atomic_removal_verifier";
			const verifierCall = await structuredCall({
				plan: verifierPlan,
				runtime: options.primaryRuntime,
				usage,
				signal,
				requestTimeoutMs: options.requestTimeoutMs,
				onProgress: options.onProgress,
				maxRunInputTokens: runInputTokenLimit(route),
				maxRunOutputTokens: runOutputTokenLimit(route),
				maxProviderCalls: providerCallLimit(route),
			});
			atomicRemovalVerifierDecision = verifierCall.value;
			calls.push(
				callTrace(verifierPlan, options.primaryRuntime, verifierCall),
			);
			if (
				atomicRemovalVerifierDecision.verdict === "RETAIN_ATOMIC_BLOCK"
			) {
				finalBlockIds = context.candidateBlockIds;
				resolution = "atomic_block_retained";
				reason =
					"The independent Atomic Removal Verifier retained the indivisible challenged block.";
			} else {
				finalBlockIds = atomicProposedBlockIds;
				resolution = "atomic_block_removal_authorized";
				reason =
					"The independent Atomic Removal Verifier authorized the exact one-block removal.";
			}
			return finish();
		}

		if (!route.completeDelta && largeDifferenceBlockIds.length > 0) {
			const plannerPlan = createStructuredCallPlan({
				role: "inspection_planner",
				toolName: INSPECTION_PLANNER_TOOL_NAME,
				toolLabel: "Plan literal inspection",
				toolDescription: "Submit a schema-validated literal inspection plan.",
				schema: InspectionPlanSchema,
				maxTokens: INSPECTION_PLANNER_MAX_TOKENS,
				reasoning: "medium",
				systemPrompt: inspectionPlannerSystemPrompt(options.prompts),
				userPrompt: inspectionPlannerPrompt(
					context.candidateBlockIds,
					proposedBlockIds,
					largeDifferenceBlockIds,
					options.packet,
					context,
					options.prompts.inspectionPlannerTask,
				),
				parse(raw) {
					return validateInspectionPlan(raw, largeDifferenceBlockIds);
				},
			});
			inspectionPlannerInputSha256 = plannerPlan.inputSha256;
			activeRole = "inspection_planner";
			const plannerCall = await structuredCall({
				plan: plannerPlan,
				runtime: options.primaryRuntime,
				usage,
				signal,
				requestTimeoutMs: options.requestTimeoutMs,
				onProgress: options.onProgress,
				maxRunInputTokens: runInputTokenLimit(route),
				maxRunOutputTokens: runOutputTokenLimit(route),
				maxProviderCalls: providerCallLimit(route),
			});
			inspectionPlan = plannerCall.value;
			calls.push(callTrace(plannerPlan, options.primaryRuntime, plannerCall));
			inspectionEvidence = buildPiNativeLiteralInspectionEvidence(
				context,
				inspectionPlan,
			);
		}
		const onlyProposedBlockId = proposedOnlyBlockIds[0];
		const edgeAdditionBlockId =
			atomicRemovalPrompts !== null &&
			largeDifferenceBlockIds.length === 0 &&
			candidateOnlyBlockIds.length === 0 &&
			proposedOnlyBlockIds.length === 1 &&
			onlyProposedBlockId !== undefined &&
			isImmediateCandidateEdge(
				onlyProposedBlockId,
				context.candidateBlockIds,
			)
				? onlyProposedBlockId
				: null;

		const primaryPlan = createStructuredCallPlan({
			role: "primary",
			toolName: route.completeDelta
				? COMPLETE_DELTA_PRIMARY_TOOL_NAME
				: PRIMARY_TOOL_NAME,
			toolLabel: "Submit bounded difference membership",
			toolDescription: "Submit the schema-validated bounded membership decision.",
			schema: route.completeDelta
				? CompleteDeltaPrimaryDecisionSchema
				: PrimaryDecisionSchema,
			maxTokens: route.completeDelta
				? COMPLETE_DELTA_PRIMARY_MAX_TOKENS
				: PRIMARY_MAX_TOKENS,
			reasoning: "medium",
			systemPrompt:
				edgeAdditionBlockId === null || atomicRemovalPrompts === null
					? primarySystemPrompt(options.prompts, route)
					: edgeAdditionPrimarySystemPrompt(atomicRemovalPrompts),
			userPrompt:
				edgeAdditionBlockId === null || atomicRemovalPrompts === null
					? primaryPrompt(
							context.candidateBlockIds,
							proposedBlockIds,
							candidateOnlyBlockIds,
							proposedOnlyBlockIds,
							pairwiseSource,
							inspectionEvidence,
							options.prompts.primaryTask,
						)
					: edgeAdditionPrimaryPrompt(
							context.candidateBlockIds,
							proposedBlockIds,
							edgeAdditionBlockId,
							pairwiseSource,
							atomicRemovalPrompts.edgeAdditionPrimaryTask,
						),
			parse(raw) {
				if ("evidence_block_ids" in raw) {
					validateIds(
						raw.evidence_block_ids,
						context.availableBlockIds,
						"evidence_block_ids",
					);
				}
				const submittedMembershipIds = validateIds(
					raw.included_difference_block_ids,
					context.availableBlockIds,
					"included_difference_block_ids",
					true,
				);
				if (
					submittedMembershipIds.some(
						(blockId) => !allowedSubmittedMembershipIds.has(blockId),
					)
				) {
					throw new BoundedMembershipContractError(
						"included_difference_block_ids contains an ID outside the bounded A/B membership",
					);
				}
				return {
					...raw,
					included_difference_block_ids: submittedMembershipIds.filter((blockId) =>
						differenceBlockIdSet.has(blockId),
					),
				};
			},
		});
		primaryInputSha256 = primaryPlan.inputSha256;
		activeRole = "primary";
		const primaryCall = await structuredCall({
			plan: primaryPlan,
			runtime: options.primaryRuntime,
			usage,
			signal,
			requestTimeoutMs: options.requestTimeoutMs,
			onProgress: options.onProgress,
			maxRunInputTokens: runInputTokenLimit(route),
			maxRunOutputTokens: runOutputTokenLimit(route),
			maxProviderCalls: providerCallLimit(route),
		});
		primaryDecision = primaryCall.value;
		calls.push(callTrace(primaryPlan, options.primaryRuntime, primaryCall));
		finalBlockIds = [
			...commonBlockIds,
			...primaryDecision.included_difference_block_ids,
		].sort((left, right) => left - right);
		if (sameIds(primaryDecision.included_difference_block_ids, candidateOnlyBlockIds)) {
			resolution = "pairwise_set_a_selected";
			reason = "The direction-blind Primary selected Set A membership.";
		} else if (
			sameIds(primaryDecision.included_difference_block_ids, proposedOnlyBlockIds)
		) {
			resolution = "pairwise_set_b_selected";
			reason = "The direction-blind Primary selected Set B membership.";
		} else {
			resolution = "pairwise_partial_membership_selected";
			reason =
				"The direction-blind Primary selected a strict subset inside the bounded difference envelope.";
		}
		return finish();
	} catch (error) {
		failure = failureFromError(activeRole, error, signal);
		finalBlockIds = context.candidateBlockIds;
		resolution = "degraded_candidate_fallback";
		reason = failure.message;
		return finish();
	} finally {
		clearTimeout(timeout);
	}
}

function createStructuredCallPlan<TSchemaType extends TSchema, TResult>(input: {
	role: PiNativeBoundedMembershipRole;
	toolName: string;
	toolLabel: string;
	toolDescription: string;
	schema: TSchemaType;
	maxTokens: number;
	reasoning: "off" | "medium";
	systemPrompt: string;
	userPrompt: string;
	parse: (raw: Static<TSchemaType>) => TResult;
}): StructuredCallPlan<TSchemaType, TResult> {
	const fullSystemPrompt = `${input.systemPrompt.trim()}\n\nRuntime contract: call the one terminal tool ${input.toolName} exactly once. Do not output free text and do not retry.`;
	const inputSha256 = sha256(
		stableJson({
			systemPrompt: fullSystemPrompt,
			userPrompt: input.userPrompt,
			tool: {
				name: input.toolName,
				label: input.toolLabel,
				description: input.toolDescription,
				parameters: input.schema,
			},
		}),
	);
	return {
		...input,
		fullSystemPrompt,
		inputSha256,
		estimatedInputTokens: estimateTokens([
			fullSystemPrompt,
			input.userPrompt,
			input.toolName,
			input.toolLabel,
			input.toolDescription,
			JSON.stringify(input.schema),
		]),
	};
}

async function structuredCall<TSchemaType extends TSchema, TResult>(input: {
	plan: StructuredCallPlan<TSchemaType, TResult>;
	runtime: PiNativeBoundedMembershipRuntime;
	usage: RuntimeUsage;
	signal: AbortSignal;
	requestTimeoutMs?: number;
	onProgress?: (progress: PiNativeBoundedMembershipProgress) => void;
	maxRunInputTokens: number;
	maxRunOutputTokens: number;
	maxProviderCalls: number;
}): Promise<StructuredCallResult<TResult>> {
	assertCallPreflight(
		input.plan,
		input.runtime.model,
		input.usage,
		input.maxRunInputTokens,
		input.maxRunOutputTokens,
	);
	const submitTool: AgentTool<TSchemaType, Record<string, unknown>> = {
		name: input.plan.toolName,
		label: input.plan.toolLabel,
		description: input.plan.toolDescription,
		parameters: input.plan.schema,
		executionMode: "sequential",
		prepareArguments(args) {
			if (!Value.Check(input.plan.schema, args)) {
				throw new BoundedMembershipContractError(
					`strict schema mismatch: ${schemaErrors(input.plan.schema, args)}`,
				);
			}
			return args as Static<TSchemaType>;
		},
		async execute() {
			return terminalResult({ ok: true, status: "accepted" });
		},
	};
	const messages = await runAgentLoop(
		userMessage(input.plan.userPrompt),
		{
			systemPrompt: input.plan.fullSystemPrompt,
			messages: [],
			tools: [submitTool],
		},
		{
			model: input.runtime.model,
			temperature: 0,
			maxTokens: input.plan.maxTokens,
			reasoning: input.runtime.model.reasoning ? input.plan.reasoning : undefined,
			apiKey: input.runtime.apiKey,
			headers: input.runtime.headers,
			env: input.runtime.env,
			timeoutMs: input.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
			maxRetries: 0,
			toolExecution: "sequential",
			convertToLlm: convertMessages,
			shouldStopAfterTurn: () => true,
		},
		(event) => {
			if (event.type !== "turn_end" || event.message.role !== "assistant") return;
			recordUsage(input.usage.roles[input.plan.role], event.message.usage);
			assertUsageBudget(
				input.usage,
				input.maxRunInputTokens,
				input.maxRunOutputTokens,
			);
			input.onProgress?.({
				status: "running",
				role: input.plan.role,
				tool: input.plan.toolName,
			});
		},
		input.signal,
		(model, context, options) => {
			if (totalUsage(input.usage).providerCalls >= input.maxProviderCalls) {
				throw new BoundedMembershipRunBudgetError(
					"Pi-native bounded-membership provider-call budget exhausted",
				);
			}
			input.usage.roles[input.plan.role].providerCalls += 1;
			return input.runtime.streamFunction(model, context, options);
		},
	);
	const last = lastAssistant(messages);
	if (last?.stopReason === "error" || last?.stopReason === "aborted") {
		throw new Error(
			`${input.plan.role} provider failed: ${last.errorMessage ?? last.stopReason}`,
		);
	}
	const terminalCalls = matchingToolCalls(messages, input.plan.toolName);
	if (terminalCalls.length > 0) {
		const parsed = terminalCalls.map((toolCall) => {
			if (!Value.Check(input.plan.schema, toolCall.arguments)) {
				throw new BoundedMembershipContractError(
					`${input.plan.role} terminal schema mismatch: ${schemaErrors(
						input.plan.schema,
						toolCall.arguments,
					)}`,
				);
			}
			return input.plan.parse(toolCall.arguments as Static<TSchemaType>);
		});
		const unique = new Map(parsed.map((value) => [stableJson(value), value]));
		if (unique.size !== 1) {
			throw new BoundedMembershipContractError(
				`${input.plan.role} submitted ${terminalCalls.length} conflicting terminal tool calls`,
			);
		}
		const value = unique.values().next().value;
		if (value === undefined) {
			throw new BoundedMembershipContractError(
				`${input.plan.role} submitted no parseable terminal decision`,
			);
		}
		return {
			value,
			terminalMode:
				terminalCalls.length === 1
					? "tool_call"
					: "identical_duplicate_tool_calls",
			terminalCallCount: terminalCalls.length,
		};
	}
	const jsonText = last ? strictAssistantJsonText(last) : null;
	if (jsonText !== null) {
		let raw: unknown;
		try {
			raw = JSON.parse(jsonText);
		} catch (error) {
			throw new BoundedMembershipContractError(
				`${input.plan.role} JSON-text terminal is not valid JSON: ${errorMessage(error)}`,
			);
		}
		if (!Value.Check(input.plan.schema, raw)) {
			throw new BoundedMembershipContractError(
				`${input.plan.role} JSON-text terminal schema mismatch: ${schemaErrors(
					input.plan.schema,
					raw,
				)}`,
			);
		}
		return {
			value: input.plan.parse(raw as Static<TSchemaType>),
			terminalMode: "strict_json_text",
			terminalCallCount: 0,
		};
	}
	throw new BoundedMembershipContractError(
		`${input.plan.role} must submit a terminal tool call or one complete schema-valid JSON value`,
	);
}

function assertCallPreflight(
	plan: StructuredCallPlan<TSchema, unknown>,
	model: Model<Api>,
	usage: RuntimeUsage,
	maxRunInputTokens: number,
	maxRunOutputTokens: number,
): void {
	if (
		plan.estimatedInputTokens + plan.maxTokens + CONTEXT_SAFETY_TOKENS >
		model.contextWindow
	) {
		throw new BoundedMembershipContextCapacityError(
			`${plan.role} estimated input ${plan.estimatedInputTokens} plus reserves does not fit model context ${model.contextWindow}`,
		);
	}
	const total = totalUsage(usage);
	if (total.estimatedInputTokens + plan.estimatedInputTokens > maxRunInputTokens) {
		throw new BoundedMembershipRunBudgetError(
			`Estimated run input would exceed the frozen ${maxRunInputTokens}-token budget before ${plan.role}`,
		);
	}
	if (total.outputTokens + plan.maxTokens > maxRunOutputTokens) {
		throw new BoundedMembershipRunBudgetError(
			`Reserved output would exceed the frozen ${maxRunOutputTokens}-token budget before ${plan.role}`,
		);
	}
	usage.roles[plan.role].estimatedInputTokens += plan.estimatedInputTokens;
}

function reviewerSystemPrompt(
	prompts: PiNativeBoundedMembershipPrompts,
	emptyCandidate: boolean,
	route: PiNativeBoundedMembershipRoute,
): string {
	if (route.editableUnion) {
		return [
			"# Frozen accepted single-prompt semantic contract",
			editableUnionSemanticCore(prompts),
			"# Candidate-aware complete-delta audit",
			prompts.reviewer.trim(),
		].join("\n\n");
	}
	if (route.completeDelta) {
		return [
			prompts.architecture.trim(),
			"# Edge-first complete-delta audit",
			prompts.reviewer.trim(),
		].join("\n\n");
	}
	return emptyCandidate
		? [
				"# Frozen accepted single-prompt semantic contract",
				prompts.candidate.trim(),
				"# Isolated empty-candidate Reviewer role",
				prompts.emptyReviewer.trim(),
			].join("\n\n")
		: [
				prompts.architecture.trim(),
				"# Frozen accepted single-prompt semantic contract",
				prompts.candidate.trim(),
				"# Isolated v34 optional explicit-action Reviewer role",
				prompts.reviewer.trim(),
			].join("\n\n");
}

function reviewerPrompt(
	context: PiNativeDeltaEvidencePacket,
	prompts: PiNativeBoundedMembershipPrompts,
	emptyCandidate: boolean,
	route: PiNativeBoundedMembershipRoute,
): string {
	if (route.editableUnion) {
		const additionEnvelope = buildCandidateAdditionEnvelope(context);
		return [
			"Canonical address contract: source id=N is the only block address. Printed numbering inside text is content.",
			context.text,
			renderCandidateLinkedReferenceNeighborhoods(context),
			"<UNTRUSTED_LOCATOR_CANDIDATE>",
			`untrustedCandidateRanges=${JSON.stringify(context.candidateRanges)}`,
			`untrustedCandidateBlockIds=${JSON.stringify(context.candidateBlockIds)}`,
			context.candidateBlockIds.length === 0
				? "candidateAbsentAdditionEnvelope=FULL_SOURCE_FOR_EMPTY_CANDIDATE"
				: `candidateAbsentAdditionEnvelopeRanges=${JSON.stringify(compactBlockRanges([...additionEnvelope]))}`,
			"</UNTRUSTED_LOCATOR_CANDIDATE>",
			prompts.reviewerTask.trim(),
		].join("\n");
	}
	if (route.completeDelta) {
		const additionEnvelope = buildCandidateAdditionEnvelope(context);
		return [
			`untrustedCandidateRanges=${JSON.stringify(context.candidateRanges)}`,
			`untrustedCandidateBlockIds=${JSON.stringify(context.candidateBlockIds)}`,
			context.candidateBlockIds.length === 0
				? "candidateAbsentAdditionEnvelope=FULL_SOURCE_FOR_EMPTY_CANDIDATE"
				: `candidateAbsentAdditionEnvelopeRanges=${JSON.stringify(compactBlockRanges([...additionEnvelope]))}`,
			"Canonical address contract: source id=N is the only block address. Printed numbering inside text is content.",
			context.text,
			prompts.reviewerTask.trim(),
		].join("\n");
	}
	return [
		`untrustedCandidateRanges=${JSON.stringify(context.candidateRanges)}`,
		`untrustedCandidateBlockIds=${JSON.stringify(context.candidateBlockIds)}`,
		"Canonical address contract: source id=N is the only block address. Printed numbering inside text is content.",
		context.text,
		(route.completeDelta
			? prompts.reviewerTask
			: emptyCandidate
				? prompts.emptyReviewerTask
				: prompts.reviewerTask
		).trim(),
	].join("\n");
}

function inspectionPlannerSystemPrompt(
	prompts: PiNativeBoundedMembershipPrompts,
): string {
	return [
		"# Frozen accepted single-prompt semantic contract",
		prompts.candidate.trim(),
		"# Independent literal inspection planner",
		prompts.inspectionPlanner.trim(),
	].join("\n\n");
}

function inspectionPlannerPrompt(
	setABlockIds: readonly number[],
	setBBlockIds: readonly number[],
	largeDifferenceBlockIds: readonly number[],
	packet: ScoreReviewPacket,
	context: PiNativeDeltaEvidencePacket,
	taskPrompt: string,
): string {
	const blocksById = new Map(packet.blocks.map((block) => [block.blockId, block]));
	const renderedBlocks = largeDifferenceBlockIds.map((blockId) => {
		const block = blocksById.get(blockId);
		const sourceText = context.blocksById.get(blockId)?.sourceText;
		if (!block || sourceText === undefined) {
			throw new BoundedMembershipContractError(
				`inspection planner references missing block ${blockId}`,
			);
		}
		return [
			`id=${blockId}|range=段落${blockId}|kind=${block.kind}|structure=${JSON.stringify(block.structure)}`,
			sourceText || "(empty)",
		].join("\n");
	});
	return [
		`setARanges=${JSON.stringify(compactBlockRanges(setABlockIds))}`,
		`setABlockIds=${JSON.stringify(setABlockIds)}`,
		`setBRanges=${JSON.stringify(compactBlockRanges(setBBlockIds))}`,
		`setBBlockIds=${JSON.stringify(setBBlockIds)}`,
		`allowedFocusBlockIds=${JSON.stringify(largeDifferenceBlockIds)}`,
		taskPrompt.trim(),
		"<OVERSIZED_EXACT_DIFFERENCE_BLOCKS>",
		...renderedBlocks,
		"</OVERSIZED_EXACT_DIFFERENCE_BLOCKS>",
	].join("\n");
}


function primarySystemPrompt(
	prompts: PiNativeBoundedMembershipPrompts,
	route: PiNativeBoundedMembershipRoute,
): string {
	if (route.editableUnion) {
		return [
			"# Frozen accepted single-prompt semantic contract",
			editableUnionSemanticCore(prompts),
			"# Independent editable-union release judgment",
			prompts.primary.trim(),
		].join("\n\n");
	}
	if (route.completeDelta) {
		return [
			prompts.architecture.trim(),
			"# Orthogonal bounded release judgment",
			prompts.primary.trim(),
		].join("\n\n");
	}
	return [
		"# Frozen accepted single-prompt semantic contract",
		prompts.candidate.trim(),
		"# Isolated direction-blind pairwise judge",
		prompts.primary.trim(),
	].join("\n\n");
}

function editableUnionSemanticCore(
	prompts: PiNativeBoundedMembershipPrompts,
): string {
	if (!("semanticCore" in prompts) || typeof prompts.semanticCore !== "string") {
		throw new BoundedMembershipContractError(
			"editable-union route requires its frozen semantic core",
		);
	}
	return prompts.semanticCore.trim();
}

function editableUnionPrimaryPrompt(
	reviewUniverseBlockIds: readonly number[],
	hypothesisABlockIds: readonly number[],
	hypothesisBBlockIds: readonly number[],
	reviewUniverseSource: string,
	taskPrompt: string,
): string {
	return [
		`reviewUniverseRanges=${JSON.stringify(compactBlockRanges(reviewUniverseBlockIds))}`,
		`reviewUniverseBlockIds=${JSON.stringify(reviewUniverseBlockIds)}`,
		`hypothesisARanges=${JSON.stringify(compactBlockRanges(hypothesisABlockIds))}`,
		`hypothesisBRanges=${JSON.stringify(compactBlockRanges(hypothesisBBlockIds))}`,
		"The review universe is a mechanical recall ceiling. A and B are unlabeled, fallible membership hypotheses; agreement, disagreement, width, and origin are not source evidence or votes. Use one-sided membership only as an adversarial attention map, independently audit every universe member from source, and publish any supported subset including neither complete hypothesis.",
		reviewUniverseSource,
		taskPrompt.trim(),
	].join("\n");
}

function primaryPrompt(
	setABlockIds: readonly number[],
	setBBlockIds: readonly number[],
	setAOnlyBlockIds: readonly number[],
	setBOnlyBlockIds: readonly number[],
	pairwiseSource: string,
	inspectionEvidence: string | null,
	taskPrompt: string,
): string {
	return [
		`setARanges=${JSON.stringify(compactBlockRanges(setABlockIds))}`,
		`setABlockIds=${JSON.stringify(setABlockIds)}`,
		`setBRanges=${JSON.stringify(compactBlockRanges(setBBlockIds))}`,
		`setBBlockIds=${JSON.stringify(setBBlockIds)}`,
		`setAOnlyBlockIds=${JSON.stringify(setAOnlyBlockIds)}`,
		`setBOnlyBlockIds=${JSON.stringify(setBOnlyBlockIds)}`,
		pairwiseSource,
		inspectionEvidence ??
			'<LITERAL_INSPECTION_EVIDENCE status="not-required">No exact-difference atomic block crossed the deterministic size threshold.</LITERAL_INSPECTION_EVIDENCE>',
		taskPrompt.trim(),
	].join("\n");
}

function isImmediateCandidateEdge(
	blockId: number,
	candidateBlockIds: readonly number[],
): boolean {
	const candidate = new Set(candidateBlockIds);
	return candidate.has(blockId - 1) || candidate.has(blockId + 1);
}

function edgeAdditionPrimarySystemPrompt(
	prompts: PiNativeAtomicRemovalPrompts,
): string {
	return [
		"# Frozen accepted single-prompt semantic contract",
		prompts.candidate.trim(),
		"# Independent single immediate-edge addition judge",
		prompts.edgeAdditionPrimary.trim(),
	].join("\n\n");
}

function edgeAdditionPrimaryPrompt(
	candidateBlockIds: readonly number[],
	proposedBlockIds: readonly number[],
	edgeBlockId: number,
	pairwiseSource: string,
	taskPrompt: string,
): string {
	const candidate = new Set(candidateBlockIds);
	const hasPreviousCandidateMember = candidate.has(edgeBlockId - 1);
	const hasNextCandidateMember = candidate.has(edgeBlockId + 1);
	const edgeRelation =
		hasPreviousCandidateMember && hasNextCandidateMember
			? "BRIDGES_TWO_CANDIDATE_INTERVALS"
			: hasNextCandidateMember
				? "BEFORE_CANDIDATE_INTERVAL"
				: "AFTER_CANDIDATE_INTERVAL";
	return [
		`candidateWithoutEdgeRanges=${JSON.stringify(compactBlockRanges(candidateBlockIds))}`,
		`candidateWithoutEdgeBlockIds=${JSON.stringify(candidateBlockIds)}`,
		`candidateWithEdgeRanges=${JSON.stringify(compactBlockRanges(proposedBlockIds))}`,
		`candidateWithEdgeBlockIds=${JSON.stringify(proposedBlockIds)}`,
		`challengedImmediateEdgeBlockId=${edgeBlockId}`,
		`edgeRelation=${edgeRelation}`,
		pairwiseSource,
		taskPrompt.trim(),
	].join("\n");
}

function atomicRemovalPromptsForRoute(
	prompts: PiNativeBoundedMembershipPrompts | PiNativeAtomicRemovalPrompts,
	route: PiNativeBoundedMembershipRoute,
): PiNativeAtomicRemovalPrompts | null {
	if (!route.atomicRemovalVerifier) return null;
	if (
		!("atomicRemovalVerifier" in prompts) ||
		!("atomicRemovalVerifierTask" in prompts)
	) {
		throw new BoundedMembershipContractError(
			"atomic removal route requires its frozen Verifier prompts",
		);
	}
	return prompts;
}

function atomicRemovalVerifierSystemPrompt(
	prompts: PiNativeAtomicRemovalPrompts,
): string {
	return [
		"# Frozen accepted single-prompt semantic contract",
		prompts.candidate.trim(),
		"# Independent one-block Atomic Removal Verifier",
		prompts.atomicRemovalVerifier.trim(),
	].join("\n\n");
}

function atomicRemovalVerifierPrompt(
	candidateBlockIds: readonly number[],
	proposedBlockIds: readonly number[],
	challengedBlockId: number,
	pairwiseSource: string,
	taskPrompt: string,
): string {
	return [
		`candidateRanges=${JSON.stringify(compactBlockRanges(candidateBlockIds))}`,
		`candidateBlockIds=${JSON.stringify(candidateBlockIds)}`,
		`proposedAfterRemovalRanges=${JSON.stringify(compactBlockRanges(proposedBlockIds))}`,
		`proposedAfterRemovalBlockIds=${JSON.stringify(proposedBlockIds)}`,
		`challengedAtomicBlockId=${challengedBlockId}`,
		pairwiseSource,
		taskPrompt.trim(),
	].join("\n");
}

function validateReviewerDecision(
	raw: PiNativeBoundedMembershipReviewerDecision,
	context: PiNativeDeltaEvidencePacket,
): PiNativeBoundedMembershipReviewerDecision {
	if (raw.verdict === "PASS") {
		validateIds(raw.change_block_ids, context.availableBlockIds, "change_block_ids", true);
		if (raw.challenge_type !== "NONE" || raw.change_block_ids.length !== 0) {
			throw new BoundedMembershipContractError(
				"PASS requires challenge_type NONE and empty change_block_ids",
			);
		}
		if (context.candidateBlockIds.length > 0) {
			throw new BoundedMembershipContractError(
				"PASS is allowed only for an empty candidate",
			);
		}
		return raw;
	}
	if (raw.challenge_type === "NONE") {
		throw new BoundedMembershipContractError(
			"CHALLENGE requires a non-NONE challenge_type",
		);
	}
	const changeBlockIds = validateIds(
		raw.change_block_ids,
		context.availableBlockIds,
		"change_block_ids",
	);
	const candidate = new Set(context.candidateBlockIds);
	if (raw.challenge_type === "ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE") {
		if (changeBlockIds.some((blockId) => candidate.has(blockId))) {
			throw new BoundedMembershipContractError(
				"ADD challenge contains candidate-present block",
			);
		}
	} else {
		if (changeBlockIds.some((blockId) => !candidate.has(blockId))) {
			throw new BoundedMembershipContractError(
				"REMOVE challenge contains candidate-absent block",
			);
		}
		if (
			raw.challenge_type === "REMOVE_ALL_NO_VALID_EVALUATOR" &&
			!sameIds(changeBlockIds, context.candidateBlockIds)
		) {
			throw new BoundedMembershipContractError(
				"REMOVE_ALL challenge must cover the complete candidate",
			);
		}
	}
	return { ...raw, change_block_ids: changeBlockIds };
}

function validateCompleteDeltaReviewerDecision(
	raw: PiNativeCompleteDeltaReviewerSubmission,
	context: PiNativeDeltaEvidencePacket,
): PiNativeCompleteDeltaReviewerDecision {
	const changeBlockIds = validateIds(
		raw.change_block_ids,
		context.availableBlockIds,
		"change_block_ids",
		raw.verdict === "PASS",
	);
	if (raw.verdict === "PASS" && changeBlockIds.length !== 0) {
		throw new BoundedMembershipContractError(
			"PASS requires empty change_block_ids",
		);
	}
	if (raw.verdict === "PASS" && raw.challenge_type !== "NONE") {
		throw new BoundedMembershipContractError(
			"PASS requires challenge_type NONE",
		);
	}
	if (raw.verdict === "PASS" && context.candidateBlockIds.length > 0) {
		throw new BoundedMembershipContractError(
			"PASS is allowed only for an empty candidate",
		);
	}
	if (raw.verdict === "CHALLENGE" && changeBlockIds.length === 0) {
		throw new BoundedMembershipContractError(
			"CHALLENGE requires non-empty change_block_ids",
		);
	}
	if (raw.verdict === "CHALLENGE" && raw.challenge_type === "NONE") {
		throw new BoundedMembershipContractError(
			"CHALLENGE requires a non-NONE challenge_type",
		);
	}
	const candidate = new Set(context.candidateBlockIds);
	const additionEnvelope = buildCandidateAdditionEnvelope(context);
	const acceptedChangeBlockIds: number[] = [];
	const ignoredOutOfEnvelopeBlockIds: number[] = [];
	for (const blockId of changeBlockIds) {
		if (candidate.has(blockId) || additionEnvelope.has(blockId)) {
			acceptedChangeBlockIds.push(blockId);
		} else {
			ignoredOutOfEnvelopeBlockIds.push(blockId);
		}
	}
	return {
		verdict: raw.verdict,
		challenge_type: raw.challenge_type,
		change_block_ids: acceptedChangeBlockIds,
		ignored_out_of_envelope_block_ids: ignoredOutOfEnvelopeBlockIds,
	};
}

function validateEditableUnionReviewerDecision(
	raw: PiNativeEditableUnionReviewerSubmission,
	context: PiNativeDeltaEvidencePacket,
): PiNativeEditableUnionReviewerDecision {
	const changeBlockIds = validateIds(
		raw.change_block_ids,
		context.availableBlockIds,
		"change_block_ids",
		true,
	);
	const candidate = new Set(context.candidateBlockIds);
	const additionEnvelope = buildCandidateAdditionEnvelope(context);
	const acceptedChangeBlockIds: number[] = [];
	const ignoredOutOfEnvelopeBlockIds: number[] = [];
	for (const blockId of changeBlockIds) {
		if (candidate.has(blockId) || additionEnvelope.has(blockId)) {
			acceptedChangeBlockIds.push(blockId);
		} else {
			ignoredOutOfEnvelopeBlockIds.push(blockId);
		}
	}
	return {
		change_block_ids: acceptedChangeBlockIds,
		ignored_out_of_envelope_block_ids: ignoredOutOfEnvelopeBlockIds,
	};
}

function validateAtomicRemovalVerifierDecision(
	raw: PiNativeAtomicRemovalVerifierSubmission,
	challengedBlockId: number,
	context: PiNativeDeltaEvidencePacket,
): PiNativeAtomicRemovalVerifierDecision {
	const sourceText = context.blocksById.get(challengedBlockId)?.sourceText;
	if (sourceText === undefined) {
		throw new BoundedMembershipContractError(
			`atomic removal verifier references missing block ${challengedBlockId}`,
		);
	}
	const sourceLiteralQuery = raw.source_literal_query.normalize("NFKC").trim();
	if (Array.from(sourceLiteralQuery).length < 4) {
		throw new BoundedMembershipContractError(
			"atomic removal verifier source_literal_query must contain at least four non-edge-whitespace characters",
		);
	}
	const needle = normalizeLiteralSearchNeedle(sourceLiteralQuery);
	if (!needle) {
		throw new BoundedMembershipContractError(
			"atomic removal verifier source_literal_query is empty after search normalization",
		);
	}
	const searchable = buildNormalizedLiteralSearchIndex(sourceText);
	const normalizedMatchStarts: number[] = [];
	let searchFrom = 0;
	while (searchFrom <= searchable.text.length - needle.length) {
		const normalizedMatchStart = searchable.text.indexOf(needle, searchFrom);
		if (normalizedMatchStart < 0) break;
		normalizedMatchStarts.push(normalizedMatchStart);
		if (normalizedMatchStarts.length > 1) break;
		searchFrom = normalizedMatchStart + Math.max(needle.length, 1);
	}
	if (normalizedMatchStarts.length !== 1) {
		throw new BoundedMembershipContractError(
			`atomic removal verifier source_literal_query must have exactly one normalized literal match in the challenged block; found ${normalizedMatchStarts.length}`,
		);
	}
	const normalizedMatchStart = normalizedMatchStarts[0];
	if (normalizedMatchStart === undefined) {
		throw new BoundedMembershipContractError(
			"atomic removal verifier lost its normalized literal match",
		);
	}
	const normalizedMatchEnd = normalizedMatchStart + needle.length;
	const quoteStart = searchable.originalStarts[normalizedMatchStart];
	const quoteEnd = searchable.originalEnds[normalizedMatchEnd - 1];
	if (quoteStart === undefined || quoteEnd === undefined) {
		throw new BoundedMembershipContractError(
			"atomic removal verifier normalization lost source offsets",
		);
	}
	return {
		verdict: raw.verdict,
		sourceLiteralQuery,
		exactQuote: sourceText.slice(quoteStart, quoteEnd),
		quoteStart,
		quoteEnd,
	};
}

function validateInspectionPlan(
	raw: PiNativeBoundedMembershipInspectionPlan,
	largeDifferenceBlockIds: readonly number[],
): PiNativeBoundedMembershipInspectionPlan {
	const focusBlockIds = validateSubset(
		raw.focus_block_ids,
		largeDifferenceBlockIds,
		"focus_block_ids",
	);
	if (focusBlockIds.length === 0) {
		throw new BoundedMembershipContractError("focus_block_ids must not be empty");
	}
	return {
		focus_block_ids: focusBlockIds,
		target_literal_queries: normalizeLiteralQueries(raw.target_literal_queries),
		boundary_literal_queries: normalizeLiteralQueries(raw.boundary_literal_queries),
	};
}

function normalizeLiteralQueries(queries: readonly string[]): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const query of queries) {
		const trimmed = query.normalize("NFKC").trim();
		if (Array.from(trimmed).length < 2) {
			throw new BoundedMembershipContractError(
				"literal_queries must contain at least two characters",
			);
		}
		const key = trimmed.toLocaleLowerCase("zh-CN");
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push(trimmed);
	}
	if (normalized.length === 0) {
		throw new BoundedMembershipContractError(
			"literal_queries must not be empty after normalization",
		);
	}
	return normalized;
}

function buildNormalizedLiteralSearchIndex(value: string): {
	text: string;
	originalStarts: number[];
	originalEnds: number[];
} {
	let text = "";
	const originalStarts: number[] = [];
	const originalEnds: number[] = [];
	for (let originalStart = 0; originalStart < value.length; ) {
		const codePoint = value.codePointAt(originalStart);
		if (codePoint === undefined) break;
		const sourceCharacter = String.fromCodePoint(codePoint);
		const originalEnd = originalStart + sourceCharacter.length;
		const normalizedCharacter = sourceCharacter
			.normalize("NFKC")
			.toLocaleLowerCase("zh-CN");
		for (const searchCharacter of normalizedCharacter) {
			if (isIgnoredLiteralSearchCharacter(searchCharacter)) continue;
			text += searchCharacter;
			for (let index = 0; index < searchCharacter.length; index += 1) {
				originalStarts.push(originalStart);
				originalEnds.push(originalEnd);
			}
		}
		originalStart = originalEnd;
	}
	return { text, originalStarts, originalEnds };
}

function normalizeLiteralSearchNeedle(value: string): string {
	return [...value.normalize("NFKC").toLocaleLowerCase("zh-CN")]
		.filter((character) => !isIgnoredLiteralSearchCharacter(character))
		.join("");
}

function isIgnoredLiteralSearchCharacter(character: string): boolean {
	return /[\p{P}\p{Z}\s]/u.test(character);
}

export function buildPiNativeLiteralInspectionEvidence(
	context: PiNativeDeltaEvidencePacket,
	plan: PiNativeBoundedMembershipInspectionPlan,
): string {
	interface MatchWindow {
		blockId: number;
		query: string;
		matchStart: number;
		matchEnd: number;
		windowStart: number;
		windowEnd: number;
	}
	interface MergedWindow {
		blockId: number;
		start: number;
		end: number;
		matches: MatchWindow[];
	}

	const summaries: string[] = [];
	const windows: MatchWindow[] = [];
	const queryGroups = [
		{ intent: "TARGET", queries: plan.target_literal_queries },
		{ intent: "BOUNDARY", queries: plan.boundary_literal_queries },
	] as const;
	for (const blockId of plan.focus_block_ids) {
		const sourceText = context.blocksById.get(blockId)?.sourceText;
		if (sourceText === undefined) {
			throw new BoundedMembershipContractError(
				`literal inspection references missing block ${blockId}`,
			);
		}
		const searchable = buildNormalizedLiteralSearchIndex(sourceText);
		for (const group of queryGroups) {
			for (const query of group.queries) {
				const needle = normalizeLiteralSearchNeedle(query);
				if (!needle) {
					throw new BoundedMembershipContractError(
						"literal query is empty after search normalization",
					);
				}
				let searchFrom = 0;
				let totalMatches = 0;
				while (searchFrom <= searchable.text.length - needle.length) {
					const normalizedMatchStart = searchable.text.indexOf(needle, searchFrom);
					if (normalizedMatchStart < 0) break;
					totalMatches += 1;
					if (totalMatches <= MAX_LITERAL_MATCHES_PER_QUERY_BLOCK) {
						const normalizedMatchEnd = normalizedMatchStart + needle.length;
						const matchStart = searchable.originalStarts[normalizedMatchStart];
						const matchEnd = searchable.originalEnds[normalizedMatchEnd - 1];
						if (matchStart === undefined || matchEnd === undefined) {
							throw new BoundedMembershipContractError(
								"literal inspection normalization lost source offsets",
							);
						}
						windows.push({
							blockId,
							query,
							matchStart,
							matchEnd,
							windowStart: Math.max(
								0,
								matchStart - LITERAL_MATCH_CONTEXT_CHARACTERS,
							),
							windowEnd: Math.min(
								sourceText.length,
								matchEnd + LITERAL_MATCH_CONTEXT_CHARACTERS,
							),
						});
					}
					searchFrom = normalizedMatchStart + Math.max(needle.length, 1);
				}
				summaries.push(
					`blockId=${blockId}|intent=${group.intent}|query=${JSON.stringify(query)}|totalLiteralMatches=${totalMatches}|excerptedMatches=${Math.min(totalMatches, MAX_LITERAL_MATCHES_PER_QUERY_BLOCK)}`,
				);
			}
		}
	}

	const merged: MergedWindow[] = [];
	for (const window of windows.sort(
		(left, right) =>
			left.blockId - right.blockId || left.windowStart - right.windowStart,
	)) {
		const previous = merged.at(-1);
		if (
			previous &&
			previous.blockId === window.blockId &&
			window.windowStart <= previous.end
		) {
			previous.end = Math.max(previous.end, window.windowEnd);
			previous.matches.push(window);
		} else {
			merged.push({
				blockId: window.blockId,
				start: window.windowStart,
				end: window.windowEnd,
				matches: [window],
			});
		}
	}

	const lines = [
		'<LITERAL_INSPECTION_EVIDENCE method="NFKC case-folded punctuation-and-whitespace-insensitive literal sequence search">',
		"Queries were chosen by an independent model; excerpts were returned mechanically. This evidence is incomplete and makes no semantic keep/drop decision.",
		...summaries,
	];
	let renderedCharacters = lines.join("\n").length;
	for (const region of merged) {
		const sourceText = context.blocksById.get(region.blockId)?.sourceText;
		if (sourceText === undefined) {
			throw new BoundedMembershipContractError(
				`literal inspection lost block ${region.blockId}`,
			);
		}
		const metadata = region.matches.map((match) => ({
			query: match.query,
			matchStart: match.matchStart,
			matchEnd: match.matchEnd,
		}));
		const segment = [
			`<LITERAL_MATCH_EXCERPT blockId=${region.blockId} start=${region.start} end=${region.end} matches=${JSON.stringify(metadata)}>`,
			sourceText.slice(region.start, region.end),
			"</LITERAL_MATCH_EXCERPT>",
		].join("\n");
		if (
			renderedCharacters + segment.length + 1 >
			MAX_LITERAL_EVIDENCE_CHARACTERS
		) {
			lines.push('<LITERAL_EVIDENCE_TRUNCATED reason="character-budget" />');
			break;
		}
		lines.push(segment);
		renderedCharacters += segment.length + 1;
	}
	lines.push("</LITERAL_INSPECTION_EVIDENCE>");
	return lines.join("\n");
}

function renderEditableUnionSourceSlice(
	packet: ScoreReviewPacket,
	context: PiNativeDeltaEvidencePacket,
	reviewUniverseBlockIds: readonly number[],
	hypothesisABlockIds: readonly number[],
	hypothesisBBlockIds: readonly number[],
): string {
	const universe = new Set(reviewUniverseBlockIds);
	const hypothesisA = new Set(hypothesisABlockIds);
	const hypothesisB = new Set(hypothesisBBlockIds);
	const included = new Set(reviewUniverseBlockIds);
	for (const block of packet.blocks) {
		if (!universe.has(block.blockId)) continue;
		for (const blockId of [
			...block.structure.ancestorBlockIds,
			...(block.structure.candidateAncestorBlockIds ?? []),
			...(block.structure.previousBlockIds ?? []),
			...(block.structure.nextBlockIds ?? []),
		]) {
			included.add(blockId);
		}
		const candidateParentBlockId = block.structure.candidateParentBlockId ?? null;
		if (candidateParentBlockId !== null) included.add(candidateParentBlockId);
	}
	for (const reference of context.explicitReferences) {
		if (included.has(reference.fromBlockId) || included.has(reference.toBlockId)) {
			included.add(reference.fromBlockId);
			included.add(reference.toBlockId);
		}
	}
	const blocksById = new Map(packet.blocks.map((block) => [block.blockId, block]));
	const renderBlock = (blockId: number): string => {
		const block = blocksById.get(blockId);
		const sourceText = context.blocksById.get(blockId)?.sourceText;
		if (!block || sourceText === undefined) {
			throw new BoundedMembershipContractError(
				`editable-union slice references missing block ${blockId}`,
			);
		}
		return [
			`id=${blockId}|range=段落${blockId}|outputEligible=${universe.has(blockId)}|hypothesisA=${hypothesisA.has(blockId)}|hypothesisB=${hypothesisB.has(blockId)}|kind=${block.kind}|structure=${JSON.stringify(block.structure)}`,
			sourceText || "(empty)",
		].join("\n");
	};
	const sourceOrderBlockIds = [...included]
		.filter((blockId) => blocksById.has(blockId))
		.sort((left, right) => left - right);
	return [
		"<EDITABLE_UNION_MECHANICAL_SOURCE_SLICE>",
		"This slice preserves source order across every output-eligible universe block and mechanically connected context. Only outputEligible=true blocks may be submitted; false blocks are boundary evidence only. hypothesisA and hypothesisB expose unlabeled mechanical membership without semantic authority.",
		"<SOURCE_ORDER_BLOCKS>",
		...sourceOrderBlockIds.map(renderBlock),
		"</SOURCE_ORDER_BLOCKS>",
		"</EDITABLE_UNION_MECHANICAL_SOURCE_SLICE>",
	].join("\n");
}

function renderCandidateLinkedReferenceNeighborhoods(
	context: PiNativeDeltaEvidencePacket,
): string {
	const candidate = new Set(context.candidateBlockIds);
	const linkedReferences = context.explicitReferences.filter(
		(reference) =>
			candidate.has(reference.fromBlockId) || candidate.has(reference.toBlockId),
	);
	if (linkedReferences.length === 0) {
		return '<CANDIDATE_LINKED_REFERENCE_NEIGHBORHOODS status="none" />';
	}
	const orderedBlockIds = context.blockFacts.map((fact) => fact.blockId);
	const indexByBlockId = new Map(
		orderedBlockIds.map((blockId, index) => [blockId, index]),
	);
	const focusDistanceByBlockId = new Map<number, number>();
	for (const reference of linkedReferences) {
		const endpoints = [
			...(candidate.has(reference.fromBlockId)
				? [reference.toBlockId]
				: []),
			...(candidate.has(reference.toBlockId)
				? [reference.fromBlockId]
				: []),
		];
		for (const endpoint of endpoints) {
			const center = indexByBlockId.get(endpoint);
			if (center === undefined) continue;
			const start = Math.max(
				0,
				center - CANDIDATE_LINKED_REFERENCE_RADIUS_BLOCKS,
			);
			const end = Math.min(
				orderedBlockIds.length - 1,
				center + CANDIDATE_LINKED_REFERENCE_RADIUS_BLOCKS,
			);
			for (let index = start; index <= end; index += 1) {
				const blockId = orderedBlockIds[index];
				if (blockId === undefined || candidate.has(blockId)) continue;
				const distance = Math.abs(index - center);
				const previous = focusDistanceByBlockId.get(blockId);
				if (previous === undefined || distance < previous) {
					focusDistanceByBlockId.set(blockId, distance);
				}
			}
		}
	}
	const lines = [
		"<CANDIDATE_LINKED_REFERENCE_NEIGHBORHOODS>",
		"This is a mechanical attention copy made only from literal-reference endpoints and fixed source-order windows. It does not prove owner, target identity, closure, keep, or drop.",
		...linkedReferences.map(
			(reference) =>
				`R|from=段落${reference.fromBlockId}|to=段落${reference.toBlockId}|anchor=${JSON.stringify(reference.anchor)}`,
		),
	];
	let characters = lines.join("\n").length;
	let omittedBlocks = 0;
	for (const [blockId] of [...focusDistanceByBlockId].sort(
		([leftId, leftDistance], [rightId, rightDistance]) =>
			leftDistance - rightDistance || leftId - rightId,
	)) {
		const sourceText = context.blocksById.get(blockId)?.sourceText;
		if (sourceText === undefined) {
			throw new BoundedMembershipContractError(
				`candidate-linked reference neighborhood lost block ${blockId}`,
			);
		}
		if (sourceText.length > MAX_CANDIDATE_LINKED_REFERENCE_BLOCK_CHARACTERS) {
			lines.push(
				`<REFERENCE_NEIGHBORHOOD_BLOCK_OMITTED id=${blockId} characters=${sourceText.length} reason="per-block-character-budget" />`,
			);
			continue;
		}
		const segment = `id=${blockId}|range=段落${blockId}\n${sourceText || "(empty)"}`;
		if (
			characters + segment.length + 1 >
			MAX_CANDIDATE_LINKED_REFERENCE_CHARACTERS
		) {
			omittedBlocks += 1;
			continue;
		}
		lines.push(segment);
		characters += segment.length + 1;
	}
	if (omittedBlocks > 0) {
		lines.push(
			`<REFERENCE_NEIGHBORHOODS_TRUNCATED omittedBlocks=${omittedBlocks} reason="total-character-budget" />`,
		);
	}
	lines.push("</CANDIDATE_LINKED_REFERENCE_NEIGHBORHOODS>");
	return lines.join("\n");
}

function buildCandidateAdditionEnvelope(
	context: PiNativeDeltaEvidencePacket,
): Set<number> {
	if (context.candidateBlockIds.length === 0) {
		return new Set(context.availableBlockIds);
	}
	const orderedBlockIds = context.blockFacts.map((fact) => fact.blockId);
	const indexByBlockId = new Map(
		orderedBlockIds.map((blockId, index) => [blockId, index]),
	);
	const envelope = new Set<number>();
	const addWindow = (centerBlockId: number): void => {
		const center = indexByBlockId.get(centerBlockId);
		if (center === undefined) return;
		const start = Math.max(
			0,
			center - CANDIDATE_LINKED_REFERENCE_RADIUS_BLOCKS,
		);
		const end = Math.min(
			orderedBlockIds.length - 1,
			center + CANDIDATE_LINKED_REFERENCE_RADIUS_BLOCKS,
		);
		for (let index = start; index <= end; index += 1) {
			const blockId = orderedBlockIds[index];
			if (blockId !== undefined) envelope.add(blockId);
		}
	};
	const candidate = new Set(context.candidateBlockIds);
	for (const blockId of context.candidateBlockIds) addWindow(blockId);
	for (const reference of context.explicitReferences) {
		if (candidate.has(reference.fromBlockId)) addWindow(reference.toBlockId);
		if (candidate.has(reference.toBlockId)) addWindow(reference.fromBlockId);
	}
	return envelope;
}

function renderPairwiseSourceSlice(
	packet: ScoreReviewPacket,
	context: PiNativeDeltaEvidencePacket,
	setABlockIds: readonly number[],
	setBBlockIds: readonly number[],
	differenceBlockIds: readonly number[],
	differenceBlockChunkCharacters: number | null = null,
): string {
	const difference = new Set(differenceBlockIds);
	const members = new Set([...setABlockIds, ...setBBlockIds]);
	const included = new Set(members);
	for (const block of packet.blocks) {
		if (!members.has(block.blockId)) continue;
		for (const blockId of [
			...block.structure.ancestorBlockIds,
			...(block.structure.candidateAncestorBlockIds ?? []),
			...(block.structure.previousBlockIds ?? []),
			...(block.structure.nextBlockIds ?? []),
		]) {
			included.add(blockId);
		}
		const candidateParentBlockId = block.structure.candidateParentBlockId ?? null;
		if (candidateParentBlockId !== null) included.add(candidateParentBlockId);
	}
	for (const reference of context.explicitReferences) {
		if (included.has(reference.fromBlockId) || included.has(reference.toBlockId)) {
			included.add(reference.fromBlockId);
			included.add(reference.toBlockId);
		}
	}
	const blocksById = new Map(packet.blocks.map((block) => [block.blockId, block]));
	const renderBlock = (blockId: number): string => {
		const block = blocksById.get(blockId);
		const sourceText = context.blocksById.get(blockId)?.sourceText;
		if (!block || sourceText === undefined) {
			throw new BoundedMembershipContractError(
				`pairwise slice references missing block ${blockId}`,
			);
		}
		const metadata = `id=${blockId}|range=段落${blockId}|kind=${block.kind}|structure=${JSON.stringify(block.structure)}`;
		if (
			differenceBlockChunkCharacters === null ||
			!difference.has(blockId) ||
			sourceText.length <= differenceBlockChunkCharacters
		) {
			return [metadata, sourceText || "(empty)"].join("\n");
		}
		const chunkCount = Math.ceil(
			sourceText.length / differenceBlockChunkCharacters,
		);
		const chunks: string[] = [];
		for (let index = 0; index < chunkCount; index += 1) {
			const start = index * differenceBlockChunkCharacters;
			const end = Math.min(
				sourceText.length,
				start + differenceBlockChunkCharacters,
			);
			chunks.push(
				[
					`<ATOMIC_BLOCK_CHUNK index=${index} count=${chunkCount} start=${start} end=${end}>`,
					sourceText.slice(start, end),
					"</ATOMIC_BLOCK_CHUNK>",
				].join("\n"),
			);
		}
		return [metadata, ...chunks].join("\n");
	};
	const differenceIds = [...difference].sort((left, right) => left - right);
	const contextIds = [...included]
		.filter((blockId) => !difference.has(blockId) && blocksById.has(blockId))
		.sort((left, right) => left - right);
	return [
		"<PAIRWISE_MECHANICAL_SOURCE_SLICE>",
		"This slice is determined only from Set A/B membership, exact differences, structural ancestors, immediate neighbors, and literal references. It makes no semantic keep/drop decision.",
		"<EXACT_DIFFERENCE_BLOCKS>",
		...differenceIds.map(renderBlock),
		"</EXACT_DIFFERENCE_BLOCKS>",
		"<MEMBER_AND_STRUCTURAL_CONTEXT>",
		...contextIds.map(renderBlock),
		"</MEMBER_AND_STRUCTURAL_CONTEXT>",
		"</PAIRWISE_MECHANICAL_SOURCE_SLICE>",
	].join("\n");
}

function buildResult(input: {
	options:
		| RunPiNativeBoundedMembershipOptions
		| RunPiNativeAtomicRemovalOptions
		| RunPiNativeCompleteDeltaOptions
		| RunPiNativeEditableUnionOptions;
	route: PiNativeBoundedMembershipRoute;
	context: PiNativeDeltaEvidencePacket;
	usage: RuntimeUsage;
	calls: PiNativeBoundedMembershipCallTrace[];
	startedAt: number;
	finalBlockIds: readonly number[];
	resolution: PiNativeBoundedMembershipResult["resolution"];
	reason: string;
	failure: PiNativeBoundedMembershipFailure | null;
	reviewerDecision:
		| PiNativeBoundedMembershipReviewerDecision
		| PiNativeCompleteDeltaReviewerDecision
		| PiNativeEditableUnionReviewerDecision
		| null;
	inspectionPlan: PiNativeBoundedMembershipInspectionPlan | null;
	inspectionEvidence: string | null;
	primaryDecision:
		| PiNativeBoundedMembershipPrimaryDecision
		| PiNativeCompleteDeltaPrimaryDecision
		| PiNativeEditableUnionPrimaryDecision
		| null;
	atomicRemovalVerifierDecision: PiNativeAtomicRemovalVerifierDecision | null;
	reviewerInputSha256: string | null;
	inspectionPlannerInputSha256: string | null;
	pairwiseSourceSha256: string | null;
	primaryInputSha256: string | null;
	atomicRemovalVerifierInputSha256: string | null;
	atomicRemovalBlockId: number | null;
}): PiNativeBoundedMembershipResult {
	const finalBlockIds = [...input.finalBlockIds].sort((left, right) => left - right);
	const candidateSet = new Set(input.context.candidateBlockIds);
	const finalSet = new Set(finalBlockIds);
	const addedBlockIds = finalBlockIds.filter((blockId) => !candidateSet.has(blockId));
	const removedBlockIds = input.context.candidateBlockIds.filter(
		(blockId) => !finalSet.has(blockId),
	);
	const total = totalUsage(input.usage);
	const reviewerModel = modelTrace(input.options.reviewerRuntime.model);
	const primaryModel = modelTrace(input.options.primaryRuntime.model);
	return {
		schemaVersion: input.route.schemaVersion,
		contractVersion: input.route.contractVersion,
		capabilitySha256: sha256(
			stableJson({
				contractVersion: input.route.contractVersion,
				prompts: input.options.prompts.hashes,
				schemas: {
					reviewer: input.route.editableUnion
						? EditableUnionReviewerDecisionSchema
						: input.route.completeDelta
							? CompleteDeltaReviewerDecisionSchema
							: ReviewerDecisionSchema,
					inspectionPlanner: InspectionPlanSchema,
					primary: input.route.editableUnion
						? EditableUnionPrimaryDecisionSchema
						: input.route.completeDelta
							? CompleteDeltaPrimaryDecisionSchema
							: PrimaryDecisionSchema,
					...(input.route.atomicRemovalVerifier
						? { atomicRemovalVerifier: AtomicRemovalVerifierDecisionSchema }
						: {}),
				},
				models: { reviewer: reviewerModel, primary: primaryModel },
				budgets: {
					maxProviderCalls: providerCallLimit(input.route),
					maxRunInputTokens: runInputTokenLimit(input.route),
					maxOutputTokens: runOutputTokenLimit(input.route),
					maxReasoningTokens: MAX_REASONING_TOKENS,
					largeDifferenceBlockCharacters:
						LARGE_DIFFERENCE_BLOCK_CHARACTERS,
					maxLiteralMatchesPerQueryBlock:
						MAX_LITERAL_MATCHES_PER_QUERY_BLOCK,
					literalMatchContextCharacters: LITERAL_MATCH_CONTEXT_CHARACTERS,
					maxLiteralEvidenceCharacters: MAX_LITERAL_EVIDENCE_CHARACTERS,
					candidateLinkedReferenceRadiusBlocks:
						CANDIDATE_LINKED_REFERENCE_RADIUS_BLOCKS,
					maxCandidateLinkedReferenceCharacters:
						MAX_CANDIDATE_LINKED_REFERENCE_CHARACTERS,
					maxCandidateLinkedReferenceBlockCharacters:
						MAX_CANDIDATE_LINKED_REFERENCE_BLOCK_CHARACTERS,
					...(input.route.atomicRemovalVerifier
						? {
								atomicRemovalVerifierMaxTokens:
									ATOMIC_REMOVAL_VERIFIER_MAX_TOKENS,
								atomicBlockChunkCharacters:
									ATOMIC_BLOCK_CHUNK_CHARACTERS,
								otherRemovalDifferencePolicy: "lock_to_candidate",
							}
						: {}),
				},
			}),
		),
		packetSha256: input.options.packetSha256,
		sourceName: input.options.packet.sourceName,
		sourceSha256: input.options.packet.sourceSha256,
		outputField: input.options.packet.outputField,
		status: input.failure ? "degraded" : "complete",
		resolution: input.resolution,
		reason: input.reason,
		initialRanges: input.context.candidateRanges,
		finalRanges: compactBlockRanges(finalBlockIds),
		finalBlockIds,
		candidatePreserved: sameIds(finalBlockIds, input.context.candidateBlockIds),
		reviewDegraded: input.failure !== null,
		failure: input.failure,
		patch:
			addedBlockIds.length === 0 && removedBlockIds.length === 0
				? null
				: {
						missingRanges: compactBlockRanges(addedBlockIds),
						removeRanges: compactBlockRanges(removedBlockIds),
						addedBlockIds,
						removedBlockIds,
						reason: input.reason,
					},
		decisions: {
			reviewer: input.reviewerDecision,
			inspectionPlan: input.inspectionPlan,
			inspectionEvidence: input.inspectionEvidence,
			primary: input.primaryDecision,
			atomicRemovalVerifier: input.atomicRemovalVerifierDecision,
		},
		context: {
			coverage:
				input.route.editableUnion
					? "full_source_reviewer_focused_union_primary"
					: input.atomicRemovalVerifierDecision === null
						? "full_source_reviewer_bounded_pairwise_primary"
						: "full_source_reviewer_atomic_removal_verifier",
			fullSourceSha256: input.context.sha256,
			fullSourceCharacters: input.context.characterCount,
			sourceCharacters: input.context.sourceCharacterCount,
			blockCount: input.options.packet.blocks.length,
			sequenceCount: input.context.sequenceFacts.length,
			explicitReferenceCount: input.context.explicitReferences.length,
			reviewerInputSha256: input.reviewerInputSha256,
			inspectionPlannerInputSha256: input.inspectionPlannerInputSha256,
			pairwiseSourceSha256: input.pairwiseSourceSha256,
			primaryInputSha256: input.primaryInputSha256,
			atomicRemovalVerifierInputSha256:
				input.atomicRemovalVerifierInputSha256,
			atomicRemovalBlockId: input.atomicRemovalBlockId,
			inspectionEvidenceSha256:
				input.inspectionEvidence === null ? null : sha256(input.inspectionEvidence),
			representationLimitCharacters: input.context.representationLimitCharacters,
			representationFit: input.context.representationFit,
		},
		prompts: input.options.prompts.hashes,
		models: {
			reviewer: reviewerModel,
			inspectionPlanner: primaryModel,
			primary: primaryModel,
			atomicRemovalVerifier: primaryModel,
		},
		calls: input.calls,
		budget: {
			...total,
			maxProviderCalls: providerCallLimit(input.route),
			maxRunInputTokens: runInputTokenLimit(input.route),
			maxOutputTokens: runOutputTokenLimit(input.route),
			maxReasoningTokens: MAX_REASONING_TOKENS,
			roles: input.usage.roles,
		},
		latencyMs: Date.now() - input.startedAt,
	};
}

function callTrace<TResult>(
	plan: StructuredCallPlan<TSchema, TResult>,
	runtime: PiNativeBoundedMembershipRuntime,
	result: StructuredCallResult<TResult>,
): PiNativeBoundedMembershipCallTrace {
	return {
		role: plan.role,
		tool: plan.toolName,
		model: modelTrace(runtime.model),
		inputSha256: plan.inputSha256,
		estimatedInputTokens: plan.estimatedInputTokens,
		terminalMode: result.terminalMode,
		terminalCallCount: result.terminalCallCount,
	};
}

function modelTrace(model: Model<Api>): {
	provider: string;
	id: string;
	contextWindow: number;
} {
	return {
		provider: model.provider,
		id: model.id,
		contextWindow: model.contextWindow,
	};
}

function validateIds(
	ids: readonly number[],
	available: ReadonlySet<number>,
	label: string,
	allowEmpty = false,
): number[] {
	if (!allowEmpty && ids.length === 0) {
		throw new BoundedMembershipContractError(`${label} must not be empty`);
	}
	const unique = new Set<number>();
	for (const id of ids) {
		if (!available.has(id)) {
			throw new BoundedMembershipContractError(
				`${label} references missing block ${id}`,
			);
		}
		if (unique.has(id)) {
			throw new BoundedMembershipContractError(
				`${label} contains duplicate block ${id}`,
			);
		}
		unique.add(id);
	}
	return [...unique].sort((left, right) => left - right);
}

function validateSubset(
	ids: readonly number[],
	allowedIds: readonly number[],
	label: string,
): number[] {
	const allowed = new Set(allowedIds);
	const unique = new Set<number>();
	for (const id of ids) {
		if (!allowed.has(id)) {
			throw new BoundedMembershipContractError(
				`${label} references out-of-envelope block ${id}`,
			);
		}
		if (unique.has(id)) {
			throw new BoundedMembershipContractError(
				`${label} contains duplicate block ${id}`,
			);
		}
		unique.add(id);
	}
	return [...unique].sort((left, right) => left - right);
}

function applyToggle(candidateIds: readonly number[], changedIds: readonly number[]): number[] {
	const result = new Set(candidateIds);
	for (const id of changedIds) {
		if (result.has(id)) result.delete(id);
		else result.add(id);
	}
	return [...result].sort((left, right) => left - right);
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function emptyRoleUsage(): RoleUsage {
	return {
		providerCalls: 0,
		estimatedInputTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
	};
}

function emptyRuntimeUsage(): RuntimeUsage {
	return {
		roles: {
			reviewer: emptyRoleUsage(),
			inspection_planner: emptyRoleUsage(),
			primary: emptyRoleUsage(),
			atomic_removal_verifier: emptyRoleUsage(),
		},
	};
}

function recordUsage(target: RoleUsage, usage: Usage): void {
	target.inputTokens += usage.input;
	target.outputTokens += usage.output;
	target.cacheReadTokens += usage.cacheRead;
	target.cacheWriteTokens += usage.cacheWrite;
	target.reasoningTokens += usage.reasoning ?? 0;
}

function totalUsage(usage: RuntimeUsage): RoleUsage {
	const total = emptyRoleUsage();
	for (const role of Object.values(usage.roles)) {
		total.providerCalls += role.providerCalls;
		total.estimatedInputTokens += role.estimatedInputTokens;
		total.inputTokens += role.inputTokens;
		total.outputTokens += role.outputTokens;
		total.cacheReadTokens += role.cacheReadTokens;
		total.cacheWriteTokens += role.cacheWriteTokens;
		total.reasoningTokens += role.reasoningTokens;
	}
	return total;
}

function assertUsageBudget(
	usage: RuntimeUsage,
	maxRunInputTokens: number,
	maxRunOutputTokens: number,
): void {
	const total = totalUsage(usage);
	if (total.inputTokens > maxRunInputTokens) {
		throw new BoundedMembershipRunBudgetError("input-token budget exhausted");
	}
	if (total.outputTokens > maxRunOutputTokens) {
		throw new BoundedMembershipRunBudgetError("output-token budget exhausted");
	}
	if (total.reasoningTokens > MAX_REASONING_TOKENS) {
		throw new BoundedMembershipRunBudgetError("reasoning-token budget exhausted");
	}
}

function runInputTokenLimit(route: PiNativeBoundedMembershipRoute): number {
	return route.completeDelta || route.editableUnion
		? COMPLETE_DELTA_MAX_RUN_INPUT_TOKENS
		: MAX_RUN_INPUT_TOKENS;
}

function runOutputTokenLimit(route: PiNativeBoundedMembershipRoute): number {
	return route.editableUnion
		? EDITABLE_UNION_MAX_OUTPUT_TOKENS
		: MAX_OUTPUT_TOKENS;
}

function providerCallLimit(route: PiNativeBoundedMembershipRoute): number {
	return route.completeDelta || route.editableUnion
		? TWO_CALL_MAX_PROVIDER_CALLS
		: MAX_PROVIDER_CALLS;
}

function failureFromError(
	role: PiNativeBoundedMembershipRole | "preflight",
	error: unknown,
	signal: AbortSignal,
): PiNativeBoundedMembershipFailure {
	const message = errorMessage(error);
	if (signal.aborted) {
		return {
			role,
			code: /timed out|timeout/iu.test(errorMessage(signal.reason))
				? "timeout"
				: "aborted",
			message,
		};
	}
	if (error instanceof BoundedMembershipContextCapacityError) {
		return { role, code: "context_capacity", message };
	}
	if (error instanceof BoundedMembershipRunBudgetError) {
		return { role, code: "run_budget", message };
	}
	if (error instanceof BoundedMembershipContractError) {
		return { role, code: "contract_error", message };
	}
	return { role, code: "provider_error", message };
}

function schemaErrors(schema: TSchema, value: unknown): string {
	return Value.Errors(schema, value)
		.slice(0, 8)
		.map((error) => `${error.instancePath || "/"}: ${error.message}`)
		.join("; ");
}

function estimateTokens(values: readonly string[]): number {
	let ascii = 0;
	let nonAscii = 0;
	for (const value of values) {
		for (const character of value) {
			const codePoint = character.codePointAt(0);
			if (codePoint !== undefined && codePoint <= 0x7f) ascii += 1;
			else nonAscii += 1;
		}
	}
	return nonAscii + Math.ceil(ascii / 4) + 512;
}

function matchingToolCalls(
	messages: readonly AgentMessage[],
	toolName: string,
): Array<{ arguments: unknown }> {
	const matches: Array<{ arguments: unknown }> = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const content of message.content) {
			if (content.type === "toolCall" && content.name === toolName) {
				matches.push({ arguments: content.arguments });
			}
		}
	}
	return matches;
}

function strictAssistantJsonText(message: AssistantMessage): string | null {
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
	return (fenced?.[1] ?? text).trim();
}

function lastAssistant(messages: readonly AgentMessage[]): AssistantMessage | undefined {
	return [...messages]
		.reverse()
		.find((message): message is AssistantMessage => message.role === "assistant");
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
			(message.role === "user" ||
				message.role === "assistant" ||
				message.role === "toolResult"),
	);
}

function terminalResult(
	payload: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		details: payload,
		terminate: true,
	};
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableJson(item)).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
