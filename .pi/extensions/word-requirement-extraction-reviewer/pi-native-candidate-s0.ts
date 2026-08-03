import { createHash } from "node:crypto";
import {
	runAgentLoop,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
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
import type { RequirementReviewPacket, RequirementReviewPrompts } from "./index.ts";
import {
	piNativeFinalizerStreamFunction,
	type PiNativeWitnessThinkingMode,
} from "./pi-native.ts";

const CHALLENGER_MAX_TOKENS = 6_000;
const FINALIZER_MAX_TOKENS = 12_000;
const CONTEXT_SAFETY_TOKENS = 8_000;
const REQUEST_TIMEOUT_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 600_000;
const MAX_REMOVE_PARTITIONS = 8;
const MAX_REMOVE_AUDIT_PARTITIONS = 2;
const MAX_ADD_PARTITIONS = 2;
const MAX_TARGET_RANGES_PER_PARTITION = 16;
const MAX_AUDIT_RANGES_PER_PARTITION = 32;
const MAX_AUDIT_BLOCKS_PER_PARTITION = 96;
const MAX_TOTAL_AUDIT_BLOCKS =
	MAX_REMOVE_AUDIT_PARTITIONS * MAX_AUDIT_BLOCKS_PER_PARTITION;
const MAX_SUPPORTING_BLOCK_IDS_PER_PARTITION = 96;
const MAX_HARD_CARRIER_ROOT_VETOES = 32;
const MAX_FINAL_REMOVE_RANGES =
	MAX_REMOVE_PARTITIONS * MAX_TARGET_RANGES_PER_PARTITION + MAX_TOTAL_AUDIT_BLOCKS;
const MAX_FINAL_ADD_RANGES = MAX_ADD_PARTITIONS * MAX_TARGET_RANGES_PER_PARTITION;
const FINALIZER_TOOL_NAME = "submit_final_selection";
const RUNTIME_VERSION = "pi-native-candidate-s0-challenger-finalizer-v6";

export const PiNativeCandidateS0RangeSchema = Type.String({
	pattern: "^段落\\d+(?:-(?:段落)?\\d+)?$",
});

const PiNativeCandidateS0ChallengeRangeSchema = Type.String({
	minLength: 1,
	maxLength: 64,
	description:
		"One canonical top-level source range such as 段落12 or 段落12-段落18. The Harness rejects an invalid partition independently.",
});

export const PiNativeCandidateS0ChallengePartitionSchema = Type.Object(
	{
		target_ranges: Type.Array(PiNativeCandidateS0ChallengeRangeSchema, {
			minItems: 1,
			maxItems: MAX_TARGET_RANGES_PER_PARTITION,
			description:
				"One or more exact source-address ranges governed by the same conclusion and supporting evidence.",
		}),
		source_conclusion: Type.String({
			minLength: 1,
			maxLength: 300,
			description:
				"One source-grounded conclusion shared by every target range in this partition.",
		}),
		supporting_block_ids: Type.Array(Type.Integer({ minimum: 0 }), {
			minItems: 1,
			maxItems: MAX_SUPPORTING_BLOCK_IDS_PER_PARTITION,
			description:
				"Existing top-level source block IDs shared as evidence for every target range in this partition.",
		}),
	},
	{ additionalProperties: false },
);

export const PiNativeCandidateS0RemoveAuditPartitionSchema = Type.Object(
	{
		audit_kind: Type.Union([
			Type.Literal("mixed_atomic_scope"),
			Type.Literal("recovery_boundary_scope"),
		]),
		target_ranges: Type.Array(PiNativeCandidateS0ChallengeRangeSchema, {
			minItems: 1,
			maxItems: MAX_AUDIT_RANGES_PER_PARTITION,
			description:
				"A bounded Candidate-S0 scope whose exact atomic membership requires independent Finalizer audit.",
		}),
		audit_basis: Type.String({
			minLength: 1,
			maxLength: 300,
			description:
				"Source-grounded reason the selected scope may contain mixed atomic membership; this is not a remove conclusion.",
		}),
		supporting_block_ids: Type.Array(Type.Integer({ minimum: 0 }), {
			minItems: 1,
			maxItems: MAX_SUPPORTING_BLOCK_IDS_PER_PARTITION,
			description:
				"Existing top-level source block IDs that locate the scope and its competing membership evidence.",
		}),
	},
	{ additionalProperties: false },
);

export const PiNativeCandidateS0ChallengeSchema = Type.Object(
	{
		remove_partitions: Type.Array(PiNativeCandidateS0ChallengePartitionSchema, {
			maxItems: MAX_REMOVE_PARTITIONS,
		}),
		remove_audit_partitions: Type.Array(
			PiNativeCandidateS0RemoveAuditPartitionSchema,
			{
				maxItems: MAX_REMOVE_AUDIT_PARTITIONS,
				description:
					"At most one mixed_atomic_scope and one recovery_boundary_scope; both share the mechanical total audit-block budget.",
			},
		),
		add_partitions: Type.Array(PiNativeCandidateS0ChallengePartitionSchema, {
			maxItems: MAX_ADD_PARTITIONS,
		}),
	},
	{ additionalProperties: false },
);

export const PiNativeCandidateS0HardCarrierTypeSchema = Type.Union([
	Type.Literal("announcement_notice"),
	Type.Literal("bidder_instructions"),
	Type.Literal("response_format"),
	Type.Literal("contract_terms_and_formats"),
]);

export const PiNativeCandidateS0HardCarrierRootVetoSchema = Type.Object(
	{
		carrier_type: PiNativeCandidateS0HardCarrierTypeSchema,
		root_block_id: Type.Integer({ minimum: 0 }),
		exit_block_id_exclusive: Type.Union([
			Type.Integer({ minimum: 0 }),
			Type.Literal("EOF"),
		]),
		projected_s0_anchor_block_id: Type.Integer({
			minimum: 0,
			description:
				"One exact Candidate-S0 block ID inside the submitted root span, proving the veto has a non-empty mechanical projection.",
		}),
	},
	{ additionalProperties: false },
);

export const PiNativeCandidateS0FinalSubmissionSchema = Type.Object(
	{
		accepted_remove_ranges: Type.Array(PiNativeCandidateS0RangeSchema, {
			maxItems: MAX_FINAL_REMOVE_RANGES,
			description:
				"Maximally compact exact subset of the mechanically authorized Challenger remove envelope. Do not enumerate non-challenge Candidate descendants removed only by a hard-carrier root veto. Every challenged block covered by a valid veto must still appear here; omission declares a challenged survivor and fails the decision. Mechanically tolerated root-covered redundancy is canonicalized separately and never expands authority.",
		}),
		accepted_add_ranges: Type.Array(PiNativeCandidateS0RangeSchema, {
			maxItems: MAX_FINAL_ADD_RANGES,
			description: "Exact subset of the mechanically authorized add challenge envelope.",
		}),
		hard_carrier_root_vetoes: Type.Array(
			PiNativeCandidateS0HardCarrierRootVetoSchema,
			{
				maxItems: MAX_HARD_CARRIER_ROOT_VETOES,
				description:
					"Minimal set of maximal non-overlapping whole-source hard-carrier roots whose Candidate-S0 descendants must be removed after recovery and peer-exit adjudication; never enumerate descendants as separate vetoes.",
			},
		),
	},
	{ additionalProperties: false },
);

export type PiNativeCandidateS0ChallengeSubmission = Static<
	typeof PiNativeCandidateS0ChallengeSchema
>;
export type PiNativeCandidateS0FinalSubmission = Static<
	typeof PiNativeCandidateS0FinalSubmissionSchema
>;
export type PiNativeCandidateS0HardCarrierType = Static<
	typeof PiNativeCandidateS0HardCarrierTypeSchema
>;

export interface CanonicalPiNativeCandidateS0ChallengePartition {
	direction: "remove" | "add";
	partitionIndex: number;
	targetRanges: string[];
	targetBlockIds: number[];
	sourceConclusion: string;
	supportingBlockIds: number[];
}

export interface CanonicalPiNativeCandidateS0RemoveAuditPartition {
	partitionIndex: number;
	auditKind: "mixed_atomic_scope" | "recovery_boundary_scope";
	targetRanges: string[];
	targetBlockIds: number[];
	targetBlockCount: number;
	auditBasis: string;
	supportingBlockIds: number[];
}

export interface CanonicalPiNativeCandidateS0Challenge {
	removePartitions: CanonicalPiNativeCandidateS0ChallengePartition[];
	removeAuditPartitions: CanonicalPiNativeCandidateS0RemoveAuditPartition[];
	addPartitions: CanonicalPiNativeCandidateS0ChallengePartition[];
	removeExactEnvelopeRanges: string[];
	removeExactEnvelopeBlockIds: number[];
	removeAuditEnvelopeRanges: string[];
	removeAuditEnvelopeBlockIds: number[];
	removeEnvelopeRanges: string[];
	removeEnvelopeBlockIds: number[];
	addEnvelopeRanges: string[];
	addEnvelopeBlockIds: number[];
}

export interface PiNativeCandidateS0RejectedChallengePartition {
	direction: "remove" | "remove_audit" | "add";
	partitionIndex: number;
	reason: string;
}

export interface PiNativeCandidateS0AuxiliaryTextTrace {
	blockCount: number;
	characterCount: number;
	sha256: string | null;
	forwarded: false;
}

export interface CanonicalPiNativeCandidateS0HardCarrierRootVeto {
	vetoIndex: number;
	carrierType: PiNativeCandidateS0HardCarrierType;
	rootBlockId: number;
	exitBlockIdExclusive: number | "EOF";
	projectedS0AnchorBlockId: number;
	projectedRanges: string[];
	projectedBlockIds: number[];
}

export interface PiNativeCandidateS0RejectedHardCarrierRootVeto {
	vetoIndex: number;
	reason: string;
}

export interface CanonicalPiNativeCandidateS0FinalDecision {
	submittedRemoveRanges: string[];
	submittedAddRanges: string[];
	hardCarrierRootVetoes: CanonicalPiNativeCandidateS0HardCarrierRootVeto[];
	rejectedHardCarrierRootVetoes: PiNativeCandidateS0RejectedHardCarrierRootVeto[];
	challengeRemoveRanges: string[];
	challengeRemoveBlockIds: number[];
	rootCoveredRedundantRemoveRanges: string[];
	rootCoveredRedundantRemoveBlockIds: number[];
	hardCarrierRemoveRanges: string[];
	hardCarrierRemoveBlockIds: number[];
	removeRanges: string[];
	removeBlockIds: number[];
	addRanges: string[];
	addBlockIds: number[];
	finalRanges: string[];
	finalBlockIds: number[];
}

export interface PiNativeCandidateS0RoleRuntime {
	model: Model<Api>;
	apiKey: string;
	streamFunction?: StreamFn;
	transportProfile?: string;
	headers?: ProviderHeaders;
	env?: ProviderEnv;
}

export interface PiNativeCandidateS0ChallengerRuntime
	extends PiNativeCandidateS0RoleRuntime {
	thinkingMode?: PiNativeWitnessThinkingMode;
}

export interface RunPiNativeCandidateS0ReviewOptions {
	packet: RequirementReviewPacket;
	packetSha256: string;
	prompts: RequirementReviewPrompts;
	candidateS0RuntimeContract: string;
	candidateS0RuntimeContractSha256: string;
	challengerPrompt: string;
	challengerPromptSha256: string;
	finalizerPrompt: string;
	finalizerPromptSha256: string;
	challengerRuntime: PiNativeCandidateS0ChallengerRuntime;
	finalizerRuntime: PiNativeCandidateS0RoleRuntime;
	signal?: AbortSignal;
	requestTimeoutMs?: number;
	onProgress?: (progress: {
		role: "challenger" | "finalizer";
		tool: typeof FINALIZER_TOOL_NAME;
	}) => void;
}

export interface PiNativeCandidateS0RoleUsage {
	providerCalls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
	elapsedMs: number;
}

interface PiNativeCandidateS0RuntimeUsage {
	challenger: PiNativeCandidateS0RoleUsage;
	finalizer: PiNativeCandidateS0RoleUsage;
}

type PiNativeCandidateS0FailureRole = "preflight" | "challenger" | "finalizer";
type PiNativeCandidateS0FailureCode =
	| "capacity"
	| "provider_error"
	| "contract_error"
	| "timeout"
	| "aborted";

export interface PiNativeCandidateS0ReviewResult {
	schemaVersion: "xique.word-requirement-review.pi-native-candidate-s0-result.v3";
	architecture: "pi_native_candidate_s0_challenger_finalizer";
	status: "preserved" | "repaired" | "degraded";
	resolution:
		| "challenger_no_change"
		| "finalizer_preserved"
		| "finalizer_applied_repair"
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
	failure: null | {
		role: PiNativeCandidateS0FailureRole;
		code: PiNativeCandidateS0FailureCode;
		message: string;
	};
	challenge: CanonicalPiNativeCandidateS0Challenge | null;
	decision: CanonicalPiNativeCandidateS0FinalDecision | null;
	models: {
		challenger: {
			provider: string;
			id: string;
			contextWindow: number;
			thinkingMode: PiNativeWitnessThinkingMode;
		};
		finalizer: { provider: string; id: string; contextWindow: number };
	};
	prompts: {
		productPrinciples: string;
		piNativeSemanticContract: string;
		candidateS0RuntimeContract: string;
		challengerRole: string;
		finalizerRole: string;
	};
	inputs: {
		challengerSha256: string | null;
		finalizerSha256: string | null;
	};
	context: {
		sourceBlockCount: number;
		sourceTextCharacterCount: number;
		fullSourceSerializedCharacterCount: number;
		finalizerSourceBlockCount: number;
		finalizerSourceSerializedCharacterCount: number;
		challengerEstimatedTokens: number;
		challengerContextWindow: number;
		finalizerPreflightEstimatedTokens: number;
		finalizerEstimatedTokens: number | null;
		finalizerContextWindow: number;
	};
	coverage: {
		challenger: "complete" | "partial" | "none" | "not_run";
		rejectedPartitionCount: number;
	};
	trace: {
		challengerRawResponse: string | null;
		challengerNormalizedResponse: unknown;
		challengerRejectedPartitions: PiNativeCandidateS0RejectedChallengePartition[];
		finalizerRawSubmissions: unknown[];
		finalizerAuxiliaryText: PiNativeCandidateS0AuxiliaryTextTrace;
		validatorFailure: string | null;
		challengerStopReason: string | null;
		finalizerStopReason: string | null;
	};
	budget: PiNativeCandidateS0RoleUsage & { roles: PiNativeCandidateS0RuntimeUsage };
}

interface PreparedCandidateS0Review {
	availableBlockIds: Set<number>;
	sourceOrderedBlockIds: number[];
	sourceIndexByBlockId: Map<number, number>;
	candidateBlockIds: number[];
	candidateRanges: string[];
	fullSource: string;
	fullSourceSerializedCharacterCount: number;
	sourceTextCharacterCount: number;
	challengerSystemPrompt: string;
	challengerUserPrompt: string;
}

interface PreparedTargetedFinalizer {
	systemPrompt: string;
	userPrompt: string;
	finalizerSourceBlockCount: number;
	finalizerSourceSerializedCharacterCount: number;
}

interface ChallengerCallResult {
	challenge: CanonicalPiNativeCandidateS0Challenge;
	rejectedPartitions: PiNativeCandidateS0RejectedChallengePartition[];
	rawResponse: string;
	normalizedResponse: unknown;
	inputSha256: string;
	stopReason: string;
}

interface FinalizerCallResult {
	decision: CanonicalPiNativeCandidateS0FinalDecision;
	rawSubmissions: unknown[];
	auxiliaryText: PiNativeCandidateS0AuxiliaryTextTrace;
	inputSha256: string;
	stopReason: string;
}

class CandidateS0ContractError extends Error {}
class CandidateS0ProviderError extends Error {}
class CandidateS0ChallengerContractError extends CandidateS0ContractError {
	readonly rawResponse: string | null;
	readonly normalizedResponse: unknown;
	readonly stopReason: string | null;

	constructor(
		message: string,
		rawResponse: string | null,
		normalizedResponse: unknown,
		stopReason: string | null,
	) {
		super(message);
		this.name = "CandidateS0ChallengerContractError";
		this.rawResponse = rawResponse;
		this.normalizedResponse = normalizedResponse;
		this.stopReason = stopReason;
	}
}
class CandidateS0FinalizerContractError extends CandidateS0ContractError {
	readonly rawSubmissions: unknown[];
	readonly auxiliaryText: PiNativeCandidateS0AuxiliaryTextTrace;
	readonly stopReason: string | null;
	readonly inputSha256: string;

	constructor(
		message: string,
		rawSubmissions: readonly unknown[],
		auxiliaryText: PiNativeCandidateS0AuxiliaryTextTrace,
		stopReason: string | null,
		inputSha256: string,
	) {
		super(message);
		this.name = "CandidateS0FinalizerContractError";
		this.rawSubmissions = [...rawSubmissions];
		this.auxiliaryText = auxiliaryText;
		this.stopReason = stopReason;
		this.inputSha256 = inputSha256;
	}
}

export async function runPiNativeCandidateS0Review(
	options: RunPiNativeCandidateS0ReviewOptions,
): Promise<PiNativeCandidateS0ReviewResult> {
	const timeoutController = new AbortController();
	const timeout = setTimeout(
		() =>
			timeoutController.abort(
				new Error("Pi-native Candidate S0 review workflow timed out"),
			),
		WORKFLOW_TIMEOUT_MS,
	);
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutController.signal])
		: timeoutController.signal;
	const thinkingMode = options.challengerRuntime.thinkingMode ?? "disabled";
	const usage: PiNativeCandidateS0RuntimeUsage = {
		challenger: emptyUsage(),
		finalizer: emptyUsage(),
	};
	const promptHashes = {
		productPrinciples: options.prompts.hashes.productPrinciples,
		piNativeSemanticContract: options.prompts.hashes.piNativeSemanticContract,
		candidateS0RuntimeContract: options.candidateS0RuntimeContractSha256,
		challengerRole: options.challengerPromptSha256,
		finalizerRole: options.finalizerPromptSha256,
	};
	const capabilitySha256 = sha256(
		JSON.stringify({
			runtimeVersion: RUNTIME_VERSION,
			architecture:
				"candidate-initialRanges-as-S0->complete-source-plus-mechanical-S0-projection->one-strict-tool-challenger->nonempty-S0-or-envelope-finalizer-with-global-hard-carrier-veto",
			models: {
				challenger: {
					...runtimeCapabilityIdentity(
						options.challengerRuntime,
						"pi_native_challenger_strict_tool_v1",
					),
					thinkingMode,
				},
				finalizer: runtimeCapabilityIdentity(
					options.finalizerRuntime,
					"pi_native_finalizer_strict_tool_v1",
				),
			},
			prompts: promptHashes,
			schemas: {
				challenge: PiNativeCandidateS0ChallengeSchema,
				final: PiNativeCandidateS0FinalSubmissionSchema,
			},
			limits: {
				challengerMaxTokens: CHALLENGER_MAX_TOKENS,
				finalizerMaxTokens: FINALIZER_MAX_TOKENS,
				contextSafetyTokens: CONTEXT_SAFETY_TOKENS,
				requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				workflowTimeoutMs: WORKFLOW_TIMEOUT_MS,
				maxProviderCalls: 2,
				maxRemovePartitions: MAX_REMOVE_PARTITIONS,
				maxRemoveAuditPartitions: MAX_REMOVE_AUDIT_PARTITIONS,
				maxAddPartitions: MAX_ADD_PARTITIONS,
				maxTargetRangesPerPartition: MAX_TARGET_RANGES_PER_PARTITION,
				maxAuditRangesPerPartition: MAX_AUDIT_RANGES_PER_PARTITION,
				maxAuditBlocksPerPartition: MAX_AUDIT_BLOCKS_PER_PARTITION,
				maxTotalAuditBlocks: MAX_TOTAL_AUDIT_BLOCKS,
				maxSupportingBlockIdsPerPartition:
					MAX_SUPPORTING_BLOCK_IDS_PER_PARTITION,
				maxHardCarrierRootVetoes: MAX_HARD_CARRIER_ROOT_VETOES,
				hardCarrierProjection:
					"candidate-S0-intersection-with-source-order-inclusive-root-exclusive-exit",
				hardCarrierProjectionWitness:
					"one-submitted-candidate-S0-anchor-inside-each-root-span",
			},
		}),
	);

	let candidateRanges = [...options.packet.initialRanges];
	let finalRanges = [...candidateRanges];
	let challenge: CanonicalPiNativeCandidateS0Challenge | null = null;
	let decision: CanonicalPiNativeCandidateS0FinalDecision | null = null;
	let challengerInputSha256: string | null = null;
	let finalizerInputSha256: string | null = null;
	let challengerRawResponse: string | null = null;
	let challengerNormalizedResponse: unknown = null;
	let challengerRejectedPartitions: PiNativeCandidateS0RejectedChallengePartition[] = [];
	let finalizerRawSubmissions: unknown[] = [];
	let finalizerAuxiliaryText: PiNativeCandidateS0AuxiliaryTextTrace = {
		blockCount: 0,
		characterCount: 0,
		sha256: null,
		forwarded: false,
	};
	let validatorFailure: string | null = null;
	let challengerStopReason: string | null = null;
	let finalizerStopReason: string | null = null;
	let challengerCompleted = false;
	let sourceTextCharacterCount = options.packet.blocks.reduce(
		(total, block) => total + block.text.length,
		0,
	);
	let fullSourceSerializedCharacterCount = 0;
	let finalizerSourceBlockCount = 0;
	let finalizerSourceSerializedCharacterCount = 0;
	let challengerEstimatedTokens = 0;
	let finalizerPreflightEstimatedTokens = 0;
	let finalizerEstimatedTokens: number | null = null;

	const finish = (
		input: Pick<
			PiNativeCandidateS0ReviewResult,
			| "status"
			| "resolution"
			| "reviewDegraded"
			| "patch"
			| "reason"
			| "failure"
		>,
	): PiNativeCandidateS0ReviewResult => ({
		schemaVersion: "xique.word-requirement-review.pi-native-candidate-s0-result.v3",
		architecture: "pi_native_candidate_s0_challenger_finalizer",
		packetSha256: options.packetSha256,
		capabilitySha256,
		candidateId: options.packet.candidateId,
		candidatePromptSha256: options.packet.candidatePromptSha256,
		candidateRanges,
		finalRanges,
		challenge,
		decision,
		models: {
			challenger: {
				...modelIdentity(options.challengerRuntime.model),
				thinkingMode,
			},
			finalizer: modelIdentity(options.finalizerRuntime.model),
		},
		prompts: promptHashes,
		inputs: {
			challengerSha256: challengerInputSha256,
			finalizerSha256: finalizerInputSha256,
		},
		context: {
			sourceBlockCount: options.packet.blocks.length,
			sourceTextCharacterCount,
			fullSourceSerializedCharacterCount,
			finalizerSourceBlockCount,
			finalizerSourceSerializedCharacterCount,
			challengerEstimatedTokens,
			challengerContextWindow: options.challengerRuntime.model.contextWindow,
			finalizerPreflightEstimatedTokens,
			finalizerEstimatedTokens,
			finalizerContextWindow: options.finalizerRuntime.model.contextWindow,
		},
		coverage: {
			challenger: usage.challenger.providerCalls === 0
				? "not_run"
				: !challengerCompleted
					? "none"
					: challengerRejectedPartitions.length === 0
						? "complete"
						: challenge !== null &&
							(challenge.removePartitions.length > 0 ||
								challenge.removeAuditPartitions.length > 0 ||
								challenge.addPartitions.length > 0)
							? "partial"
							: "none",
			rejectedPartitionCount: challengerRejectedPartitions.length,
		},
		trace: {
			challengerRawResponse,
			challengerNormalizedResponse,
			challengerRejectedPartitions,
			finalizerRawSubmissions,
			finalizerAuxiliaryText,
			validatorFailure,
			challengerStopReason,
			finalizerStopReason,
		},
		budget: { ...totalUsage(usage), roles: usage },
		...input,
	});

	try {
		throwIfAborted(signal);
		let prepared: PreparedCandidateS0Review;
		try {
			prepared = prepareCandidateS0Review(
				options.packet,
				options.prompts,
				options.candidateS0RuntimeContract,
				options.candidateS0RuntimeContractSha256,
				options.challengerPrompt,
				options.challengerPromptSha256,
				options.finalizerPrompt,
				options.finalizerPromptSha256,
			);
		} catch (error) {
			validatorFailure = errorMessage(error);
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason: "Candidate S0 preflight failed; original Candidate preserved.",
				failure: {
					role: "preflight",
					code: "contract_error",
					message: validatorFailure,
				},
			});
		}
		candidateRanges = prepared.candidateRanges;
		finalRanges = prepared.candidateRanges;
		sourceTextCharacterCount = prepared.sourceTextCharacterCount;
		fullSourceSerializedCharacterCount =
			prepared.fullSourceSerializedCharacterCount;
		finalizerSourceBlockCount = options.packet.blocks.length;
		finalizerSourceSerializedCharacterCount = prepared.fullSource.length;
		challengerEstimatedTokens =
			estimateTextTokens(
				`${prepared.challengerSystemPrompt}\n${prepared.challengerUserPrompt}\n${JSON.stringify({
					name: FINALIZER_TOOL_NAME,
					parameters: PiNativeCandidateS0ChallengeSchema,
				})}`,
			) +
			CHALLENGER_MAX_TOKENS +
			CONTEXT_SAFETY_TOKENS;
		if (challengerEstimatedTokens > options.challengerRuntime.model.contextWindow) {
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason: "Complete-source Challenger input exceeds model capacity; Candidate preserved.",
				failure: {
					role: "preflight",
					code: "capacity",
					message: `estimated ${challengerEstimatedTokens} tokens exceeds context window ${options.challengerRuntime.model.contextWindow}`,
				},
			});
		}
		finalizerPreflightEstimatedTokens =
			estimateTextTokens(
				`${[
					options.prompts.piNativeSemanticContract.trim(),
					options.finalizerPrompt.trim(),
				].join("\n\n")}\nCANDIDATE_S0_RANGES=${JSON.stringify(
					prepared.candidateRanges,
				)}\n\nCOMPLETE_IMMUTABLE_SOURCE_JSON=${prepared.fullSource}\n\nFINALIZER_TOOL_SCHEMA=${JSON.stringify(
					PiNativeCandidateS0FinalSubmissionSchema,
				)}\n\nGLOBAL_HARD_CARRIER_VETO_AUTHORIZATION=${JSON.stringify({
					candidate_s0_ranges: prepared.candidateRanges,
					candidate_s0_block_ids: prepared.candidateBlockIds,
					projection:
						"S0 intersection source-order [inclusive root, exclusive exit or EOF)",
					root_may_be_outside_s0: true,
					projection_must_be_nonempty: true,
					anchor_must_be_in_s0_and_span: true,
					max_vetoes: MAX_HARD_CARRIER_ROOT_VETOES,
				})}`,
			) +
			CHALLENGER_MAX_TOKENS +
			FINALIZER_MAX_TOKENS +
			CONTEXT_SAFETY_TOKENS;
		if (
			finalizerPreflightEstimatedTokens >
			options.finalizerRuntime.model.contextWindow
		) {
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason:
					"Worst-case complete-source Finalizer input exceeds model capacity; Candidate preserved.",
				failure: {
					role: "preflight",
					code: "capacity",
					message: `estimated ${finalizerPreflightEstimatedTokens} tokens exceeds context window ${options.finalizerRuntime.model.contextWindow}`,
				},
			});
		}

		let challengerResult: ChallengerCallResult;
		try {
			throwIfAborted(signal);
			challengerResult = await runCandidateS0Challenger(
				prepared,
				options.challengerRuntime,
				thinkingMode,
				usage,
				signal,
				options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				(inputSha256) => {
					challengerInputSha256 = inputSha256;
				},
			);
			throwIfAborted(signal);
		} catch (error) {
			if (error instanceof CandidateS0ChallengerContractError) {
				challengerRawResponse = error.rawResponse;
				challengerNormalizedResponse = error.normalizedResponse;
				challengerStopReason = error.stopReason;
			}
			validatorFailure =
				error instanceof CandidateS0ContractError ? error.message : null;
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason: "Candidate S0 Challenger failed; original Candidate preserved.",
				failure: failureFromError("challenger", error, signal, options.signal),
			});
		}
		challenge = challengerResult.challenge;
		challengerCompleted = true;
		challengerRejectedPartitions = challengerResult.rejectedPartitions;
		challengerInputSha256 = challengerResult.inputSha256;
		challengerRawResponse = challengerResult.rawResponse;
		challengerNormalizedResponse = challengerResult.normalizedResponse;
		challengerStopReason = challengerResult.stopReason;
		options.onProgress?.({ role: "challenger", tool: FINALIZER_TOOL_NAME });
		throwIfAborted(signal);
		if (
			challengerRejectedPartitions.length > 0 &&
			challenge.removePartitions.length === 0 &&
			challenge.removeAuditPartitions.length === 0 &&
			challenge.addPartitions.length === 0
		) {
			validatorFailure = `${challengerRejectedPartitions.length} Challenger partition(s) failed mechanical authorization`;
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason:
					"Every submitted Challenger partition failed mechanical authorization; Candidate S0 preserved.",
				failure: {
					role: "challenger",
					code: "contract_error",
					message: validatorFailure,
				},
			});
		}

		if (
			prepared.candidateBlockIds.length === 0 &&
			challenge.removeEnvelopeBlockIds.length === 0 &&
			challenge.addEnvelopeBlockIds.length === 0
		) {
			return finish({
				status: "preserved",
				resolution: "challenger_no_change",
				reviewDegraded: false,
				patch: null,
				reason:
					"The empty Candidate S0 and one-call Challenger produced no bounded add challenge; Candidate S0 preserved.",
				failure: null,
			});
		}

		const targeted = prepareTargetedFinalizer(
			options.packet,
			options.prompts,
			options.finalizerPrompt,
			prepared,
			challenge,
		);
		finalizerSourceBlockCount = targeted.finalizerSourceBlockCount;
		finalizerSourceSerializedCharacterCount =
			targeted.finalizerSourceSerializedCharacterCount;
		finalizerEstimatedTokens =
			estimateTextTokens(
				`${targeted.systemPrompt}\n${targeted.userPrompt}\n${JSON.stringify({
					name: FINALIZER_TOOL_NAME,
					parameters: PiNativeCandidateS0FinalSubmissionSchema,
				})}`,
			) +
			FINALIZER_MAX_TOKENS +
			CONTEXT_SAFETY_TOKENS;
		if (finalizerEstimatedTokens > options.finalizerRuntime.model.contextWindow) {
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason: "Targeted Finalizer input exceeds model capacity; Candidate preserved.",
				failure: {
					role: "preflight",
					code: "capacity",
					message: `estimated ${finalizerEstimatedTokens} tokens exceeds context window ${options.finalizerRuntime.model.contextWindow}`,
				},
			});
		}

		let finalizerResult: FinalizerCallResult;
		try {
			throwIfAborted(signal);
			finalizerResult = await runCandidateS0Finalizer(
				targeted,
				prepared,
				challenge,
				options.finalizerRuntime,
				usage,
				signal,
				options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				(inputSha256) => {
					finalizerInputSha256 = inputSha256;
				},
			);
			throwIfAborted(signal);
		} catch (error) {
			if (error instanceof CandidateS0FinalizerContractError) {
				finalizerRawSubmissions = error.rawSubmissions;
				finalizerAuxiliaryText = error.auxiliaryText;
				finalizerStopReason = error.stopReason;
				finalizerInputSha256 = error.inputSha256;
			}
			validatorFailure =
				error instanceof CandidateS0ContractError ? error.message : null;
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason: "Targeted Finalizer failed; original Candidate preserved.",
				failure: failureFromError("finalizer", error, signal, options.signal),
			});
		}
		finalizerInputSha256 = finalizerResult.inputSha256;
		finalizerRawSubmissions = finalizerResult.rawSubmissions;
		finalizerAuxiliaryText = finalizerResult.auxiliaryText;
		finalizerStopReason = finalizerResult.stopReason;
		options.onProgress?.({ role: "finalizer", tool: FINALIZER_TOOL_NAME });
		throwIfAborted(signal);
		decision = finalizerResult.decision;
		finalRanges = decision.finalRanges;
		const changed =
			decision.removeBlockIds.length > 0 || decision.addBlockIds.length > 0;
		return finish({
			status: changed ? "repaired" : "preserved",
			resolution: changed ? "finalizer_applied_repair" : "finalizer_preserved",
			reviewDegraded: false,
			patch: changed
				? { addRanges: decision.addRanges, removeRanges: decision.removeRanges }
				: null,
			reason: changed
				? "Finalizer applied a mechanically valid targeted delta and/or hard-carrier root veto."
				: "Finalizer preserved Candidate S0 after targeted and hard-carrier review.",
			failure: null,
		});
	} catch (error) {
		finalRanges = candidateRanges;
		decision = null;
		validatorFailure ??= errorMessage(error);
		return finish({
			status: "degraded",
			resolution: "review_incomplete",
			reviewDegraded: true,
			patch: null,
			reason: "Candidate S0 review failed closed; original Candidate preserved.",
			failure: failureFromError("preflight", error, signal, options.signal),
		});
	} finally {
		clearTimeout(timeout);
	}
}

function prepareCandidateS0Review(
	packet: RequirementReviewPacket,
	prompts: RequirementReviewPrompts,
	candidateS0RuntimeContract: string,
	candidateS0RuntimeContractSha256: string,
	challengerPrompt: string,
	challengerPromptSha256: string,
	finalizerPrompt: string,
	finalizerPromptSha256: string,
): PreparedCandidateS0Review {
	validateExternalPrompt(
		"candidateS0RuntimeContract",
		candidateS0RuntimeContract,
		candidateS0RuntimeContractSha256,
	);
	validateExternalPrompt("challengerPrompt", challengerPrompt, challengerPromptSha256);
	validateExternalPrompt("finalizerPrompt", finalizerPrompt, finalizerPromptSha256);
	validateExternalPrompt(
		"prompts.productPrinciples",
		prompts.productPrinciples,
		prompts.hashes.productPrinciples,
	);
	validateExternalPrompt(
		"prompts.piNativeSemanticContract",
		prompts.piNativeSemanticContract,
		prompts.hashes.piNativeSemanticContract,
	);
	if (packet.blockCount !== packet.blocks.length) {
		throw new CandidateS0ContractError(
			`packet.blockCount ${packet.blockCount} does not match blocks.length ${packet.blocks.length}`,
		);
	}
	const availableBlockIds = new Set<number>();
	const sourceOrderedBlockIds: number[] = [];
	const sourceIndexByBlockId = new Map<number, number>();
	for (const [index, block] of packet.blocks.entries()) {
		if (!Number.isSafeInteger(block.blockId) || block.blockId < 0) {
			throw new CandidateS0ContractError(`packet.blocks[${index}] has invalid blockId`);
		}
		if (availableBlockIds.has(block.blockId)) {
			throw new CandidateS0ContractError(`packet.blocks duplicates blockId ${block.blockId}`);
		}
		availableBlockIds.add(block.blockId);
		sourceOrderedBlockIds.push(block.blockId);
		sourceIndexByBlockId.set(block.blockId, index);
	}
	const candidateBlockIds = expandRanges(
		packet.initialRanges,
		availableBlockIds,
		"packet.initialRanges",
		false,
	);
	const candidateRanges = compactRanges(candidateBlockIds);
	const candidateBlockIdSet = new Set(candidateBlockIds);
	const candidateSourceProjection = JSON.stringify({
		candidate_s0_ranges: candidateRanges,
		semantic_authority: false,
		blocks: packet.blocks
			.filter((block) => candidateBlockIdSet.has(block.blockId))
			.map((block) => ({ block_id: block.blockId, text: block.text })),
	});
	const targetAuthorization = JSON.stringify({
		remove_ranges: candidateRanges,
		add_ranges: compactRanges(
			[...availableBlockIds].filter((blockId) => !candidateBlockIdSet.has(blockId)),
		),
	});
	const fullSourceObject = {
		source_name: packet.sourceName,
		source_sha256: packet.sourceSha256,
		block_count: packet.blockCount,
		blocks: packet.blocks.map((block) => ({ block_id: block.blockId, text: block.text })),
		structure_evidence: packet.structureEvidence ?? null,
	};
	const fullSource = JSON.stringify(fullSourceObject);
	const challengerSystemPrompt = [
		prompts.piNativeSemanticContract.trim(),
		challengerPrompt.trim(),
	].join("\n\n");
	const challengerUserPrompt = `COMPLETE_IMMUTABLE_SOURCE_JSON=${fullSource}

CANDIDATE_S0_RANGES=${JSON.stringify(candidateRanges)}

CANDIDATE_S0_SOURCE_PROJECTION_JSON=${candidateSourceProjection}

MECHANICAL_AUDIT_BUDGET=${JSON.stringify({
	max_partitions: MAX_REMOVE_AUDIT_PARTITIONS,
	max_one_partition_per_kind: true,
	max_ranges_per_partition: MAX_AUDIT_RANGES_PER_PARTITION,
	max_blocks_per_partition: MAX_AUDIT_BLOCKS_PER_PARTITION,
	max_total_unique_blocks: MAX_TOTAL_AUDIT_BLOCKS,
	candidate_s0_runs: candidateRanges.map((range) => ({
		range,
		block_count: expandRanges(
			[range],
			availableBlockIds,
			"candidate_s0_runs",
			false,
		).length,
	})),
})}

MECHANICAL_TARGET_AUTHORIZATION=${targetAuthorization}
`;
	return {
		availableBlockIds,
		sourceOrderedBlockIds,
		sourceIndexByBlockId,
		candidateBlockIds,
		candidateRanges,
		fullSource,
		fullSourceSerializedCharacterCount: fullSource.length,
		sourceTextCharacterCount: packet.blocks.reduce(
			(total, block) => total + block.text.length,
			0,
		),
		challengerSystemPrompt,
		challengerUserPrompt,
	};
}

function prepareTargetedFinalizer(
	packet: RequirementReviewPacket,
	prompts: RequirementReviewPrompts,
	finalizerPrompt: string,
	prepared: PreparedCandidateS0Review,
	challenge: CanonicalPiNativeCandidateS0Challenge,
): PreparedTargetedFinalizer {
	const envelope = JSON.stringify({
		remove_review_ranges: challenge.removeEnvelopeRanges,
		add_review_ranges: challenge.addEnvelopeRanges,
		remove_review_groups: [
			...challenge.removePartitions.map((partition) => ({
				review_kind: "exact_remove_claim",
				target_ranges: partition.targetRanges,
				untrusted_challenger_claim: partition.sourceConclusion,
				supporting_block_ids: partition.supportingBlockIds,
			})),
			...challenge.removeAuditPartitions.map((partition) => ({
				review_kind: partition.auditKind,
				target_ranges: partition.targetRanges,
				mechanical_target_block_count: partition.targetBlockCount,
				untrusted_challenger_claim: partition.auditBasis,
				supporting_block_ids: partition.supportingBlockIds,
			})),
		],
		add_review_groups: challenge.addPartitions.map((partition) => ({
			review_kind: "exact_add_claim",
			target_ranges: partition.targetRanges,
			untrusted_challenger_claim: partition.sourceConclusion,
			supporting_block_ids: partition.supportingBlockIds,
		})),
		challenger_partition_kind_forwarded: true,
		challenger_claims_forwarded_as_untrusted: true,
	});
	return {
		systemPrompt: [
			prompts.piNativeSemanticContract.trim(),
			finalizerPrompt.trim(),
		].join("\n\n"),
		userPrompt: `COMPLETE_IMMUTABLE_SOURCE_JSON=${prepared.fullSource}

CANDIDATE_S0_RANGES=${JSON.stringify(prepared.candidateRanges)}

CHALLENGE_ENVELOPE=${envelope}

GLOBAL_HARD_CARRIER_VETO_AUTHORIZATION=${JSON.stringify({
		candidate_s0_ranges: prepared.candidateRanges,
		candidate_s0_block_ids: prepared.candidateBlockIds,
		projection:
			"S0 intersection source-order [inclusive root, exclusive exit or EOF)",
		root_may_be_outside_s0: true,
		projection_must_be_nonempty: true,
		anchor_must_be_in_s0_and_span: true,
		max_vetoes: MAX_HARD_CARRIER_ROOT_VETOES,
	})}

FINALIZER_TOOL_SCHEMA=${JSON.stringify(PiNativeCandidateS0FinalSubmissionSchema)}`,
		finalizerSourceBlockCount: packet.blocks.length,
		finalizerSourceSerializedCharacterCount: prepared.fullSource.length,
	};
}

async function runCandidateS0Challenger(
	prepared: PreparedCandidateS0Review,
	runtime: PiNativeCandidateS0ChallengerRuntime,
	thinkingMode: PiNativeWitnessThinkingMode,
	usage: PiNativeCandidateS0RuntimeUsage,
	signal: AbortSignal,
	requestTimeoutMs: number,
	onInputSha256: (inputSha256: string) => void,
): Promise<ChallengerCallResult> {
	let providerCalls = 0;
	let inputSha256 = sha256(
		JSON.stringify({
			systemPrompt: prepared.challengerSystemPrompt,
			userPrompt: prepared.challengerUserPrompt,
			schema: PiNativeCandidateS0ChallengeSchema,
		}),
	);
	let challengeResult:
		| ReturnType<typeof validateChallengeSubmission>
		| undefined;
	let contractError: string | null = null;
	const rawSubmissions: unknown[] = [];
	const submitTool: AgentTool<
		typeof PiNativeCandidateS0ChallengeSchema,
		Record<string, unknown>
	> = {
		name: FINALIZER_TOOL_NAME,
		label: "Submit bounded Candidate S0 challenge",
		description:
			"Submit the complete bounded Candidate S0 challenge once through this strict structured tool.",
		parameters: PiNativeCandidateS0ChallengeSchema,
		executionMode: "sequential",
		prepareArguments(args) {
			rawSubmissions.push(args);
			if (!Value.Check(PiNativeCandidateS0ChallengeSchema, args)) {
				contractError = schemaErrors(PiNativeCandidateS0ChallengeSchema, args);
				throw new CandidateS0ContractError(contractError);
			}
			return args as PiNativeCandidateS0ChallengeSubmission;
		},
		async execute(_toolCallId, params) {
			try {
				if (challengeResult !== undefined) {
					throw new CandidateS0ContractError(
						"received more than one Challenger submission",
					);
				}
				challengeResult = validateChallengeSubmission(params, prepared);
				return terminalResult({ ok: true, status: "accepted" });
			} catch (error) {
				contractError = errorMessage(error);
				return terminalResult({
					ok: false,
					status: "contract_failure",
					validationError: contractError,
				});
			}
		},
	};
	const streamFunction = runtime.streamFunction ?? piNativeFinalizerStreamFunction;
	const boundedStreamFunction: StreamFn = (model, context, streamOptions) => {
		if (providerCalls >= 1) {
			throw new CandidateS0ProviderError(
				"Candidate S0 Challenger provider-call limit exceeded",
			);
		}
		providerCalls += 1;
		usage.challenger.providerCalls = providerCalls;
		inputSha256 = sha256(JSON.stringify(context));
		onInputSha256(inputSha256);
		return streamFunction(model, context, streamOptions);
	};
	const startedAt = Date.now();
	let messages: AgentMessage[];
	try {
		messages = await runAgentLoop(
			userMessage(prepared.challengerUserPrompt),
			{
				systemPrompt: prepared.challengerSystemPrompt,
				messages: [],
				tools: [submitTool],
			},
			{
				model: runtime.model,
				temperature: 0,
				maxTokens: CHALLENGER_MAX_TOKENS,
				reasoning: thinkingMode === "enabled" ? "medium" : undefined,
				apiKey: runtime.apiKey,
				headers: runtime.headers,
				env: runtime.env,
				timeoutMs: requestTimeoutMs,
				maxRetries: 0,
				toolExecution: "sequential",
				convertToLlm: convertMessages,
				shouldStopAfterTurn: () => true,
			},
			() => {},
			signal,
			boundedStreamFunction,
		);
	} catch (error) {
		throw new CandidateS0ProviderError(errorMessage(error));
	} finally {
		usage.challenger.elapsedMs += Date.now() - startedAt;
	}
	const assistantMessages = messages.filter(
		(message): message is AssistantMessage => message.role === "assistant",
	);
	for (const message of assistantMessages) recordUsage(usage.challenger, message.usage);
	if (providerCalls !== 1 || assistantMessages.length !== 1) {
		throw new CandidateS0ChallengerContractError(
			`expected one Challenger provider call and response; received ${providerCalls} call(s) and ${assistantMessages.length} response(s)`,
			rawSubmissions.length === 0 ? null : JSON.stringify(rawSubmissions[0]),
			rawSubmissions[0] ?? null,
			null,
		);
	}
	const last = assistantMessages[0];
	const rawResponse =
		rawSubmissions.length === 0 ? null : JSON.stringify(rawSubmissions[0]);
	const turnError = validateChallengerTurnShape(
		last,
		thinkingMode,
		submitTool.name,
	);
	if (turnError !== null) {
		if (last.stopReason === "error" || last.stopReason === "aborted") {
			throw new CandidateS0ProviderError(last.errorMessage ?? turnError);
		}
		throw new CandidateS0ChallengerContractError(
			turnError,
			rawResponse,
			rawSubmissions[0] ?? null,
			last.stopReason,
		);
	}
	if (contractError !== null) {
		throw new CandidateS0ChallengerContractError(
			contractError,
			rawResponse,
			rawSubmissions[0] ?? null,
			last.stopReason,
		);
	}
	if (challengeResult === undefined || rawSubmissions.length !== 1) {
		throw new CandidateS0ChallengerContractError(
			"Challenger tool call did not produce one mechanically valid submission",
			rawResponse,
			rawSubmissions[0] ?? null,
			last.stopReason,
		);
	}
	return {
		challenge: challengeResult.challenge,
		rejectedPartitions: challengeResult.rejectedPartitions,
		rawResponse,
		normalizedResponse: rawSubmissions[0],
		inputSha256,
		stopReason: last.stopReason,
	};
}

async function runCandidateS0Finalizer(
	preparedTargeted: PreparedTargetedFinalizer,
	prepared: PreparedCandidateS0Review,
	challenge: CanonicalPiNativeCandidateS0Challenge,
	runtime: PiNativeCandidateS0RoleRuntime,
	usage: PiNativeCandidateS0RuntimeUsage,
	signal: AbortSignal,
	requestTimeoutMs: number,
	onInputSha256: (inputSha256: string) => void,
): Promise<FinalizerCallResult> {
	let providerCalls = 0;
	let inputSha256 = sha256(
		JSON.stringify({
			systemPrompt: preparedTargeted.systemPrompt,
			userPrompt: preparedTargeted.userPrompt,
			schema: PiNativeCandidateS0FinalSubmissionSchema,
		}),
	);
	let decision: CanonicalPiNativeCandidateS0FinalDecision | undefined;
	let contractError: string | null = null;
	const rawSubmissions: unknown[] = [];
	const submitTool: AgentTool<
		typeof PiNativeCandidateS0FinalSubmissionSchema,
		Record<string, unknown>
	> = {
		name: FINALIZER_TOOL_NAME,
		label: "Submit targeted delta and hard-carrier vetoes",
		description:
			"Submit accepted remove/add subsets of the Challenger envelope plus independently adjudicated hard-carrier root vetoes over Candidate S0.",
		parameters: PiNativeCandidateS0FinalSubmissionSchema,
		executionMode: "sequential",
		prepareArguments(args) {
			rawSubmissions.push(args);
			if (!Value.Check(PiNativeCandidateS0FinalSubmissionSchema, args)) {
				contractError = schemaErrors(PiNativeCandidateS0FinalSubmissionSchema, args);
				throw new CandidateS0ContractError(contractError);
			}
			return args as PiNativeCandidateS0FinalSubmission;
		},
		async execute(_toolCallId, params) {
			try {
				if (decision !== undefined) {
					throw new CandidateS0ContractError(
						"received more than one Finalizer decision",
					);
				}
				decision = validateFinalSubmission(params, prepared, challenge);
				return terminalResult({ ok: true, status: "accepted" });
			} catch (error) {
				contractError = errorMessage(error);
				return terminalResult({
					ok: false,
					status: "contract_failure",
					validationError: contractError,
				});
			}
		},
	};
	const streamFunction = runtime.streamFunction ?? piNativeFinalizerStreamFunction;
	const boundedStreamFunction: StreamFn = (model, context, streamOptions) => {
		if (providerCalls >= 1) {
			throw new CandidateS0ProviderError(
				"Candidate S0 Finalizer provider-call limit exceeded",
			);
		}
		providerCalls += 1;
		usage.finalizer.providerCalls = providerCalls;
		inputSha256 = sha256(JSON.stringify(context));
		onInputSha256(inputSha256);
		return streamFunction(model, context, streamOptions);
	};
	const startedAt = Date.now();
	let messages: AgentMessage[];
	try {
		messages = await runAgentLoop(
			userMessage(preparedTargeted.userPrompt),
			{
				systemPrompt: preparedTargeted.systemPrompt,
				messages: [],
				tools: [submitTool],
			},
			{
				model: runtime.model,
				temperature: 0,
				maxTokens: FINALIZER_MAX_TOKENS,
				reasoning: undefined,
				apiKey: runtime.apiKey,
				headers: runtime.headers,
				env: runtime.env,
				timeoutMs: requestTimeoutMs,
				maxRetries: 0,
				toolExecution: "sequential",
				convertToLlm: convertMessages,
				shouldStopAfterTurn: () => true,
			},
			() => {},
			signal,
			boundedStreamFunction,
		);
	} catch (error) {
		if (error instanceof CandidateS0ContractError) {
			throw new CandidateS0FinalizerContractError(
				error.message,
				rawSubmissions,
				{
					blockCount: 0,
					characterCount: 0,
					sha256: null,
					forwarded: false,
				},
				null,
				inputSha256,
			);
		}
		throw new CandidateS0ProviderError(errorMessage(error));
	} finally {
		usage.finalizer.elapsedMs += Date.now() - startedAt;
	}
	const assistantMessages = messages.filter(
		(message): message is AssistantMessage => message.role === "assistant",
	);
	for (const message of assistantMessages) recordUsage(usage.finalizer, message.usage);
	if (providerCalls !== 1 || assistantMessages.length !== 1) {
		throw new CandidateS0FinalizerContractError(
			`expected one Finalizer provider call and response; received ${providerCalls} call(s) and ${assistantMessages.length} response(s)`,
			rawSubmissions,
			{
				blockCount: 0,
				characterCount: 0,
				sha256: null,
				forwarded: false,
			},
			null,
			inputSha256,
		);
	}
	const last = assistantMessages[0];
	const auxiliaryText = summarizeAuxiliaryText(last);
	if (last.stopReason === "error" || last.stopReason === "aborted") {
		throw new CandidateS0ProviderError(last.errorMessage ?? last.stopReason);
	}
	const turnError = validateFinalizerTurnShape(last, submitTool.name);
	if (turnError !== null) {
		throw new CandidateS0FinalizerContractError(
			turnError,
			rawSubmissions,
			auxiliaryText,
			last.stopReason,
			inputSha256,
		);
	}
	if (contractError !== null) {
		throw new CandidateS0FinalizerContractError(
			contractError,
			rawSubmissions,
			auxiliaryText,
			last.stopReason,
			inputSha256,
		);
	}
	if (decision === undefined) {
		throw new CandidateS0FinalizerContractError(
			"Finalizer tool call did not produce a mechanically valid decision",
			rawSubmissions,
			auxiliaryText,
			last.stopReason,
			inputSha256,
		);
	}
	return {
		decision,
		rawSubmissions,
		auxiliaryText,
		inputSha256,
		stopReason: last.stopReason,
	};
}

function validateChallengeSubmission(
	raw: PiNativeCandidateS0ChallengeSubmission,
	prepared: PreparedCandidateS0Review,
): {
	challenge: CanonicalPiNativeCandidateS0Challenge;
	rejectedPartitions: PiNativeCandidateS0RejectedChallengePartition[];
} {
	const candidate = new Set(prepared.candidateBlockIds);
	const removeSeen = new Set<number>();
	const removeAuditSeen = new Set<number>();
	const addSeen = new Set<number>();
	const rejectedPartitions: PiNativeCandidateS0RejectedChallengePartition[] = [];
	const validateExactPartitions = (
		direction: "remove" | "add",
		partitions: PiNativeCandidateS0ChallengeSubmission[
			| "remove_partitions"
			| "add_partitions"
		],
	): CanonicalPiNativeCandidateS0ChallengePartition[] => {
		const validated: CanonicalPiNativeCandidateS0ChallengePartition[] = [];
		for (const [partitionIndex, partition] of partitions.entries()) {
			try {
				if (partition.source_conclusion.trim().length === 0) {
					throw new CandidateS0ContractError(
						`${direction}_partitions[${partitionIndex}].source_conclusion is blank`,
					);
				}
				const targetBlockIds = expandRanges(
					partition.target_ranges,
					prepared.availableBlockIds,
					`${direction}_partitions[${partitionIndex}].target_ranges`,
					true,
				);
				const directionSeen = direction === "remove" ? removeSeen : addSeen;
				for (const blockId of targetBlockIds) {
					if (directionSeen.has(blockId)) {
						throw new CandidateS0ContractError(
							`${direction} challenge duplicates block ${blockId} across partitions`,
						);
					}
					if (direction === "remove" && !candidate.has(blockId)) {
						throw new CandidateS0ContractError(
							`remove challenge block ${blockId} is outside Candidate S0`,
						);
					}
					if (direction === "add" && candidate.has(blockId)) {
						throw new CandidateS0ContractError(
							`add challenge block ${blockId} already belongs to Candidate S0`,
						);
					}
				}
				const supportingBlockIds = validateSupportingBlockIds(
					partition.supporting_block_ids,
					prepared.availableBlockIds,
					`${direction}_partitions[${partitionIndex}].supporting_block_ids`,
				);
				for (const blockId of targetBlockIds) directionSeen.add(blockId);
				validated.push({
					direction,
					partitionIndex,
					targetRanges: compactRanges(targetBlockIds),
					targetBlockIds,
					sourceConclusion: partition.source_conclusion.trim(),
					supportingBlockIds,
				});
			} catch (error) {
				rejectedPartitions.push({
					direction,
					partitionIndex,
					reason: errorMessage(error),
				});
			}
		}
		return validated;
	};
	const removePartitions = validateExactPartitions("remove", raw.remove_partitions);
	const addPartitions = validateExactPartitions("add", raw.add_partitions);
	const removeAuditPartitions: CanonicalPiNativeCandidateS0RemoveAuditPartition[] = [];
	const auditKindsSeen = new Set<
		CanonicalPiNativeCandidateS0RemoveAuditPartition["auditKind"]
	>();
	for (const [partitionIndex, partition] of raw.remove_audit_partitions.entries()) {
		try {
			if (auditKindsSeen.has(partition.audit_kind)) {
				throw new CandidateS0ContractError(
					`remove_audit_partitions[${partitionIndex}] duplicates audit kind ${partition.audit_kind}`,
				);
			}
			if (partition.audit_basis.trim().length === 0) {
				throw new CandidateS0ContractError(
					`remove_audit_partitions[${partitionIndex}].audit_basis is blank`,
				);
			}
			const targetBlockIds = expandRanges(
				partition.target_ranges,
				prepared.availableBlockIds,
				`remove_audit_partitions[${partitionIndex}].target_ranges`,
				true,
			);
			if (targetBlockIds.length > MAX_AUDIT_BLOCKS_PER_PARTITION) {
				throw new CandidateS0ContractError(
					`remove_audit_partitions[${partitionIndex}] expands to ${targetBlockIds.length} blocks; maximum is ${MAX_AUDIT_BLOCKS_PER_PARTITION}`,
				);
			}
			const nextAuditSeen = new Set(removeAuditSeen);
			for (const blockId of targetBlockIds) {
				if (!candidate.has(blockId)) {
					throw new CandidateS0ContractError(
						`remove audit block ${blockId} is outside Candidate S0`,
					);
				}
				if (removeSeen.has(blockId)) {
					throw new CandidateS0ContractError(
						`remove audit block ${blockId} already belongs to an exact remove challenge`,
					);
				}
				if (removeAuditSeen.has(blockId)) {
					throw new CandidateS0ContractError(
						`remove audit duplicates block ${blockId} across audit partitions`,
					);
				}
				nextAuditSeen.add(blockId);
			}
			if (nextAuditSeen.size > MAX_TOTAL_AUDIT_BLOCKS) {
				throw new CandidateS0ContractError(
					`remove audit envelope expands to ${nextAuditSeen.size} blocks; maximum is ${MAX_TOTAL_AUDIT_BLOCKS}`,
				);
			}
			const supportingBlockIds = validateSupportingBlockIds(
				partition.supporting_block_ids,
				prepared.availableBlockIds,
				`remove_audit_partitions[${partitionIndex}].supporting_block_ids`,
			);
			for (const blockId of targetBlockIds) removeAuditSeen.add(blockId);
			auditKindsSeen.add(partition.audit_kind);
			removeAuditPartitions.push({
				partitionIndex,
				auditKind: partition.audit_kind,
				targetRanges: compactRanges(targetBlockIds),
				targetBlockIds,
				targetBlockCount: targetBlockIds.length,
				auditBasis: partition.audit_basis.trim(),
				supportingBlockIds,
			});
		} catch (error) {
			rejectedPartitions.push({
				direction: "remove_audit",
				partitionIndex,
				reason: errorMessage(error),
			});
		}
	}
	const removeEnvelopeBlockIds = [
		...new Set([...removeSeen, ...removeAuditSeen]),
	].sort((left, right) => left - right);
	return {
		challenge: {
			removePartitions,
			removeAuditPartitions,
			addPartitions,
			removeExactEnvelopeRanges: compactRanges([...removeSeen]),
			removeExactEnvelopeBlockIds: [...removeSeen].sort(
				(left, right) => left - right,
			),
			removeAuditEnvelopeRanges: compactRanges([...removeAuditSeen]),
			removeAuditEnvelopeBlockIds: [...removeAuditSeen].sort(
				(left, right) => left - right,
			),
			removeEnvelopeRanges: compactRanges(removeEnvelopeBlockIds),
			removeEnvelopeBlockIds,
			addEnvelopeRanges: compactRanges([...addSeen]),
			addEnvelopeBlockIds: [...addSeen].sort((left, right) => left - right),
		},
		rejectedPartitions,
	};
}

function validateFinalSubmission(
	raw: PiNativeCandidateS0FinalSubmission,
	prepared: PreparedCandidateS0Review,
	challenge: CanonicalPiNativeCandidateS0Challenge,
): CanonicalPiNativeCandidateS0FinalDecision {
	const submittedRemoveBlockIds = expandRanges(
		raw.accepted_remove_ranges,
		prepared.availableBlockIds,
		"accepted_remove_ranges",
		true,
	);
	const addBlockIds = expandRanges(
		raw.accepted_add_ranges,
		prepared.availableBlockIds,
		"accepted_add_ranges",
		true,
	);
	const removeEnvelope = new Set(challenge.removeEnvelopeBlockIds);
	const addEnvelope = new Set(challenge.addEnvelopeBlockIds);
	for (const blockId of addBlockIds) {
		if (!addEnvelope.has(blockId)) {
			throw new CandidateS0ContractError(
				`Finalizer add block ${blockId} is outside the Challenger envelope`,
			);
		}
	}
	const rootValidation = validateHardCarrierRootVetoes(
		raw.hard_carrier_root_vetoes,
		prepared,
		addBlockIds,
	);
	const hardCarrierRemoveBlockIds = [
		...new Set(
			rootValidation.hardCarrierRootVetoes.flatMap(
				(veto) => veto.projectedBlockIds,
			),
		),
	].sort((left, right) => left - right);
	const hardCarrierRemove = new Set(hardCarrierRemoveBlockIds);
	const challengeRemoveBlockIds: number[] = [];
	const rootCoveredRedundantRemoveBlockIds: number[] = [];
	for (const blockId of submittedRemoveBlockIds) {
		if (removeEnvelope.has(blockId)) {
			challengeRemoveBlockIds.push(blockId);
			continue;
		}
		if (hardCarrierRemove.has(blockId)) {
			rootCoveredRedundantRemoveBlockIds.push(blockId);
			continue;
		}
		throw new CandidateS0ContractError(
			`Finalizer remove block ${blockId} is outside the Challenger envelope and every valid hard-carrier root veto`,
		);
	}
	if (
		rootValidation.rejectedHardCarrierRootVetoes.length > 0 &&
		rootValidation.hardCarrierRootVetoes.length === 0 &&
		challengeRemoveBlockIds.length === 0 &&
		addBlockIds.length === 0
	) {
		throw new CandidateS0ContractError(
			`all submitted hard-carrier root vetoes failed mechanical authorization: ${rootValidation.rejectedHardCarrierRootVetoes
				.map((rejected) => rejected.reason)
				.join("; ")}`,
		);
	}
	const acceptedChallengeRemove = new Set(challengeRemoveBlockIds);
	const challengedSurvivors = new Set(
		[
			...challenge.removeExactEnvelopeBlockIds,
			...challenge.removeAuditEnvelopeBlockIds,
		].filter(
			(blockId) => !acceptedChallengeRemove.has(blockId),
		),
	);
	for (const blockId of hardCarrierRemoveBlockIds) {
		if (challengedSurvivors.has(blockId)) {
			throw new CandidateS0ContractError(
				`hard-carrier root veto removes challenged survivor block ${blockId}`,
			);
		}
	}
	const removeBlockIds = [
		...new Set([...challengeRemoveBlockIds, ...hardCarrierRemoveBlockIds]),
	].sort((left, right) => left - right);
	const remove = new Set(removeBlockIds);
	const finalBlockIds = [
		...prepared.candidateBlockIds.filter((blockId) => !remove.has(blockId)),
		...addBlockIds,
	].sort((left, right) => left - right);
	return {
		submittedRemoveRanges: raw.accepted_remove_ranges,
		submittedAddRanges: raw.accepted_add_ranges,
		hardCarrierRootVetoes: rootValidation.hardCarrierRootVetoes,
		rejectedHardCarrierRootVetoes:
			rootValidation.rejectedHardCarrierRootVetoes,
		challengeRemoveRanges: compactRanges(challengeRemoveBlockIds),
		challengeRemoveBlockIds,
		rootCoveredRedundantRemoveRanges: compactRanges(
			rootCoveredRedundantRemoveBlockIds,
		),
		rootCoveredRedundantRemoveBlockIds,
		hardCarrierRemoveRanges: compactRanges(hardCarrierRemoveBlockIds),
		hardCarrierRemoveBlockIds,
		removeRanges: compactRanges(removeBlockIds),
		removeBlockIds,
		addRanges: compactRanges(addBlockIds),
		addBlockIds,
		finalRanges: compactRanges(finalBlockIds),
		finalBlockIds,
	};
}

function validateHardCarrierRootVetoes(
	rawVetoes: readonly Static<typeof PiNativeCandidateS0HardCarrierRootVetoSchema>[],
	prepared: PreparedCandidateS0Review,
	addBlockIds: readonly number[],
): {
	hardCarrierRootVetoes: CanonicalPiNativeCandidateS0HardCarrierRootVeto[];
	rejectedHardCarrierRootVetoes: PiNativeCandidateS0RejectedHardCarrierRootVeto[];
} {
	const candidate = new Set(prepared.candidateBlockIds);
	const candidates: Array<{
		veto: CanonicalPiNativeCandidateS0HardCarrierRootVeto;
		rootIndex: number;
		exitIndex: number;
	}> = [];
	const rejectedHardCarrierRootVetoes: PiNativeCandidateS0RejectedHardCarrierRootVeto[] = [];
	for (const [vetoIndex, raw] of rawVetoes.entries()) {
		try {
			const rootIndex = prepared.sourceIndexByBlockId.get(raw.root_block_id);
			if (rootIndex === undefined) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${vetoIndex}] references unavailable root block ${raw.root_block_id}`,
				);
			}
			const exitIndex = raw.exit_block_id_exclusive === "EOF"
				? prepared.sourceOrderedBlockIds.length
				: prepared.sourceIndexByBlockId.get(raw.exit_block_id_exclusive);
			if (exitIndex === undefined) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${vetoIndex}] references unavailable exit block ${raw.exit_block_id_exclusive}`,
				);
			}
			if (exitIndex <= rootIndex) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${vetoIndex}] exit position ${exitIndex} must follow root position ${rootIndex} in source order`,
				);
			}
			const anchorIndex = prepared.sourceIndexByBlockId.get(
				raw.projected_s0_anchor_block_id,
			);
			if (anchorIndex === undefined) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${vetoIndex}] references unavailable Candidate-S0 anchor block ${raw.projected_s0_anchor_block_id}`,
				);
			}
			if (!candidate.has(raw.projected_s0_anchor_block_id)) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${vetoIndex}] anchor block ${raw.projected_s0_anchor_block_id} is outside Candidate S0`,
				);
			}
			if (anchorIndex < rootIndex || anchorIndex >= exitIndex) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${vetoIndex}] anchor block ${raw.projected_s0_anchor_block_id} is outside the submitted root span`,
				);
			}
			const projectedBlockIds = prepared.sourceOrderedBlockIds
				.slice(rootIndex, exitIndex)
				.filter((blockId) => candidate.has(blockId));
			if (projectedBlockIds.length === 0) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${vetoIndex}] has an empty Candidate-S0 projection`,
				);
			}
			candidates.push({
				rootIndex,
				exitIndex,
				veto: {
					vetoIndex,
					carrierType: raw.carrier_type,
					rootBlockId: raw.root_block_id,
					exitBlockIdExclusive: raw.exit_block_id_exclusive,
					projectedS0AnchorBlockId: raw.projected_s0_anchor_block_id,
					projectedRanges: compactRanges(projectedBlockIds),
					projectedBlockIds,
				},
			});
		} catch (error) {
			rejectedHardCarrierRootVetoes.push({
				vetoIndex,
				reason: errorMessage(error),
			});
		}
	}
	for (const [index, candidateVeto] of candidates.entries()) {
		for (const existing of candidates.slice(0, index)) {
			if (
				candidateVeto.rootIndex < existing.exitIndex &&
				existing.rootIndex < candidateVeto.exitIndex
			) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_vetoes[${candidateVeto.veto.vetoIndex}] overlaps veto ${existing.veto.vetoIndex} in source order`,
				);
			}
		}
		for (const blockId of addBlockIds) {
			const blockIndex = prepared.sourceIndexByBlockId.get(blockId);
			if (
				blockIndex !== undefined &&
				blockIndex >= candidateVeto.rootIndex &&
				blockIndex < candidateVeto.exitIndex
			) {
				throw new CandidateS0ContractError(
					`Finalizer add block ${blockId} conflicts with hard-carrier root veto ${candidateVeto.veto.vetoIndex}`,
				);
			}
		}
	}
	return {
		hardCarrierRootVetoes: candidates.map((candidateVeto) => candidateVeto.veto),
		rejectedHardCarrierRootVetoes,
	};
}

function validateSupportingBlockIds(
	blockIds: readonly number[],
	availableBlockIds: ReadonlySet<number>,
	fieldName: string,
): number[] {
	const seen = new Set<number>();
	for (const blockId of blockIds) {
		if (!availableBlockIds.has(blockId)) {
			throw new CandidateS0ContractError(
				`${fieldName} references unavailable block ${blockId}`,
			);
		}
		if (seen.has(blockId)) {
			throw new CandidateS0ContractError(`${fieldName} duplicates block ${blockId}`);
		}
		seen.add(blockId);
	}
	return [...seen].sort((left, right) => left - right);
}

function expandRanges(
	ranges: readonly string[],
	availableBlockIds: ReadonlySet<number>,
	fieldName: string,
	rejectDuplicates: boolean,
): number[] {
	const blockIds = new Set<number>();
	for (const range of ranges) {
		const match = /^段落(\d+)(?:-(?:段落)?(\d+))?$/u.exec(range.trim());
		if (!match) throw new CandidateS0ContractError(`invalid range in ${fieldName}: ${range}`);
		const start = Number(match[1]);
		const end = Number(match[2] ?? match[1]);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
			throw new CandidateS0ContractError(`invalid range bounds in ${fieldName}: ${range}`);
		}
		for (let blockId = start; blockId <= end; blockId += 1) {
			if (!availableBlockIds.has(blockId)) {
				throw new CandidateS0ContractError(
					`${fieldName} references unavailable block ${blockId}`,
				);
			}
			if (rejectDuplicates && blockIds.has(blockId)) {
				throw new CandidateS0ContractError(`${fieldName} duplicates block ${blockId}`);
			}
			blockIds.add(blockId);
		}
	}
	return [...blockIds].sort((left, right) => left - right);
}

function compactRanges(blockIds: readonly number[]): string[] {
	const ordered = [...new Set(blockIds)].sort((left, right) => left - right);
	if (ordered.length === 0) return [];
	const ranges: string[] = [];
	let start = ordered[0];
	let end = start;
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

function validateChallengerTurnShape(
	message: AssistantMessage,
	thinkingMode: PiNativeWitnessThinkingMode,
	toolName: string,
): string | null {
	if (message.stopReason === "length") {
		return "Challenger tool call was truncated by the output-token limit";
	}
	const thinkingBlockCount = message.content.filter(
		(content) => content.type === "thinking",
	).length;
	if (thinkingMode === "disabled" && thinkingBlockCount > 0) {
		return "Challenger turn must not contain thinking content";
	}
	if (thinkingMode === "enabled" && thinkingBlockCount > 1) {
		return `Challenger turn may contain at most one thinking block; received ${thinkingBlockCount}`;
	}
	const toolCalls = message.content.filter((content) => content.type === "toolCall");
	if (toolCalls.length !== 1) {
		return `Challenger turn must contain exactly one tool call; received ${toolCalls.length}`;
	}
	if (toolCalls[0].name !== toolName) {
		return `Challenger turn called unexpected tool ${toolCalls[0].name}`;
	}
	if (!Value.Check(PiNativeCandidateS0ChallengeSchema, toolCalls[0].arguments)) {
		return schemaErrors(PiNativeCandidateS0ChallengeSchema, toolCalls[0].arguments);
	}
	if (message.stopReason !== "toolUse") {
		return `Challenger tool response must stop after tool use; received ${message.stopReason}`;
	}
	const textBlockCount = message.content.filter((content) => content.type === "text").length;
	if (
		textBlockCount !== 0 ||
		message.content.length !== toolCalls.length + thinkingBlockCount
	) {
		return `Challenger turn must contain only its tool call and allowed thinking block; received ${textBlockCount} text and ${thinkingBlockCount} thinking block(s)`;
	}
	return null;
}

function validateFinalizerTurnShape(
	message: AssistantMessage,
	toolName: string,
): string | null {
	if (message.stopReason === "length") {
		return "Finalizer tool call was truncated by the output-token limit";
	}
	if (message.content.some((content) => content.type === "thinking")) {
		return "Finalizer turn must not contain thinking content";
	}
	const toolCalls = message.content.filter((content) => content.type === "toolCall");
	if (toolCalls.length !== 1) {
		return `Finalizer turn must contain exactly one tool call; received ${toolCalls.length}`;
	}
	if (toolCalls[0].name !== toolName) {
		return `Finalizer turn called unexpected tool ${toolCalls[0].name}`;
	}
	if (!Value.Check(PiNativeCandidateS0FinalSubmissionSchema, toolCalls[0].arguments)) {
		return schemaErrors(
			PiNativeCandidateS0FinalSubmissionSchema,
			toolCalls[0].arguments,
		);
	}
	return null;
}

function summarizeAuxiliaryText(
	message: AssistantMessage,
): PiNativeCandidateS0AuxiliaryTextTrace {
	const textBlocks = message.content.filter((content) => content.type === "text");
	const combined = textBlocks.map((content) => content.text).join("");
	return {
		blockCount: textBlocks.length,
		characterCount: combined.length,
		sha256: textBlocks.length === 0 ? null : sha256(combined),
		forwarded: false,
	};
}

function schemaErrors(schema: TSchema, value: unknown): string {
	return Value.Errors(schema, value)
		.slice(0, 12)
		.map((error) => `${error.instancePath || "/"}: ${error.message}`)
		.join("; ");
}

function terminalResult(payload: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		details: payload,
		terminate: true,
	};
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

function estimateTextTokens(value: string): number {
	let ascii = 0;
	let nonAscii = 0;
	for (const character of value) {
		if (character.charCodeAt(0) <= 0x7f) ascii += 1;
		else nonAscii += 1;
	}
	return nonAscii + Math.ceil(ascii / 4) + 512;
}

function validateExternalPrompt(name: string, prompt: string, expectedSha256: string): void {
	if (prompt.trim().length === 0) {
		throw new CandidateS0ContractError(`${name} must not be blank`);
	}
	const actualSha256 = sha256(prompt);
	if (actualSha256 !== expectedSha256) {
		throw new CandidateS0ContractError(
			`${name} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`,
		);
	}
}

function recordUsage(target: PiNativeCandidateS0RoleUsage, source: Usage): void {
	target.inputTokens += source.input;
	target.outputTokens += source.output;
	target.cacheReadTokens += source.cacheRead;
	target.cacheWriteTokens += source.cacheWrite;
	target.reasoningTokens += source.reasoning ?? 0;
}

function totalUsage(usage: PiNativeCandidateS0RuntimeUsage): PiNativeCandidateS0RoleUsage {
	return addUsage(usage.challenger, usage.finalizer);
}

function addUsage(
	left: PiNativeCandidateS0RoleUsage,
	right: PiNativeCandidateS0RoleUsage,
): PiNativeCandidateS0RoleUsage {
	return {
		providerCalls: left.providerCalls + right.providerCalls,
		inputTokens: left.inputTokens + right.inputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
		reasoningTokens: left.reasoningTokens + right.reasoningTokens,
		elapsedMs: left.elapsedMs + right.elapsedMs,
	};
}

function emptyUsage(): PiNativeCandidateS0RoleUsage {
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

function failureFromError(
	role: PiNativeCandidateS0FailureRole,
	error: unknown,
	signal: AbortSignal,
	externalSignal: AbortSignal | undefined,
): NonNullable<PiNativeCandidateS0ReviewResult["failure"]> {
	if (signal.aborted) {
		return {
			role,
			code: externalSignal?.aborted ? "aborted" : "timeout",
			message: errorMessage(signal.reason ?? error),
		};
	}
	return {
		role,
		code: error instanceof CandidateS0ContractError ? "contract_error" : "provider_error",
		message: errorMessage(error),
	};
}

function modelIdentity(model: Model<Api>): {
	provider: string;
	id: string;
	contextWindow: number;
} {
	return { provider: model.provider, id: model.id, contextWindow: model.contextWindow };
}

function runtimeCapabilityIdentity(
	runtime: PiNativeCandidateS0RoleRuntime,
	defaultTransportProfile: string,
): Record<string, unknown> {
	return {
		provider: runtime.model.provider,
		id: runtime.model.id,
		api: runtime.model.api,
		baseUrlSha256: sha256(runtime.model.baseUrl),
		contextWindow: runtime.model.contextWindow,
		modelMaxTokens: runtime.model.maxTokens,
		reasoning: runtime.model.reasoning,
		input: runtime.model.input,
		thinkingLevelMap: runtime.model.thinkingLevelMap ?? null,
		compat: runtime.model.compat ?? null,
		transportProfile:
			runtime.transportProfile ??
			(runtime.streamFunction === undefined
				? defaultTransportProfile
				: "custom_stream_function"),
		headerNames: Object.keys(runtime.headers ?? {}).sort(),
		envNames: Object.keys(runtime.env ?? {}).sort(),
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new Error("operation aborted");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
