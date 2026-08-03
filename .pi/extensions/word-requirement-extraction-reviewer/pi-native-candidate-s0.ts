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
	piNativeWitnessStreamFunction,
} from "./pi-native.ts";

const CHALLENGER_MAX_TOKENS = 12_000;
const CHALLENGER_OUTPUT_RESERVE_TOKENS = 2_000;
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
const MAX_EXACT_SUPPORTING_BLOCK_IDS_PER_PARTITION = 8;
const MAX_ROOT_OR_AUDIT_SUPPORTING_BLOCK_IDS = 12;
const MAX_CHALLENGE_CONCLUSION_CHARACTERS = 96;
const MAX_HARD_CARRIER_ROOT_CHALLENGES = 8;
const MAX_HARD_CARRIER_ROOT_VETOES = 32;
const MAX_CHALLENGE_RANGE_CHARACTERS = 32;
const MAX_EXACT_DELIMITED_STRING_SEEDS = 256;
const MAX_EXACT_DELIMITED_STRING_OCCURRENCE_ENTRIES = 24;
const MAX_EXACT_DELIMITED_STRING_BLOCK_IDS_PER_SIDE = 8;
const MAX_EXACT_DELIMITED_STRING_TOTAL_BLOCK_OCCURRENCES = 8;
const MAX_FINAL_REMOVE_RANGES =
	MAX_REMOVE_PARTITIONS * MAX_TARGET_RANGES_PER_PARTITION + MAX_TOTAL_AUDIT_BLOCKS;
const MAX_FINAL_ADD_RANGES = MAX_ADD_PARTITIONS * MAX_TARGET_RANGES_PER_PARTITION;
const CHALLENGER_OUTPUT_NAME = "json_object";
const FINALIZER_TOOL_NAME = "submit_final_selection";
const RUNTIME_VERSION = "pi-native-candidate-s0-challenger-finalizer-v20";

export const PiNativeCandidateS0RangeSchema = Type.String({
	pattern: "^段落\\d+(?:-(?:段落)?\\d+)?$",
});

const PiNativeCandidateS0ChallengeRangeSchema = Type.String({
	minLength: 1,
	maxLength: MAX_CHALLENGE_RANGE_CHARACTERS,
	pattern: "^段落\\d+(?:-(?:段落)?\\d+)?$",
	description:
		"One canonical top-level source range such as 段落12 or 段落12-段落18. Invalid syntax fails the whole Challenger response before partition-level authorization.",
});

const PiNativeCandidateS0BlockIdSchema = Type.Integer({
	minimum: 0,
	maximum: Number.MAX_SAFE_INTEGER,
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
			maxLength: MAX_CHALLENGE_CONCLUSION_CHARACTERS,
			description:
				"One source-grounded conclusion shared by every target range in this partition.",
		}),
		supporting_block_ids: Type.Array(PiNativeCandidateS0BlockIdSchema, {
			minItems: 1,
			maxItems: MAX_EXACT_SUPPORTING_BLOCK_IDS_PER_PARTITION,
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
			maxLength: MAX_CHALLENGE_CONCLUSION_CHARACTERS,
			description:
				"Source-grounded reason the selected scope may contain mixed atomic membership; this is not a remove conclusion.",
		}),
		supporting_block_ids: Type.Array(PiNativeCandidateS0BlockIdSchema, {
			minItems: 1,
			maxItems: MAX_ROOT_OR_AUDIT_SUPPORTING_BLOCK_IDS,
			description:
				"Existing top-level source block IDs that locate the scope and its competing membership evidence.",
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

export const PiNativeCandidateS0HardCarrierRootChallengeSchema = Type.Object(
	{
		carrier_type: PiNativeCandidateS0HardCarrierTypeSchema,
		root_block_id: PiNativeCandidateS0BlockIdSchema,
		exit_block_id_exclusive: Type.Union([
			PiNativeCandidateS0BlockIdSchema,
			Type.Literal("EOF"),
		]),
		projected_s0_anchor_block_id: PiNativeCandidateS0BlockIdSchema,
		source_conclusion: Type.String({
			minLength: 1,
			maxLength: MAX_CHALLENGE_CONCLUSION_CHARACTERS,
			description:
				"One source-grounded root-boundary conclusion retained in trace but never forwarded to the Finalizer.",
		}),
		supporting_block_ids: Type.Array(PiNativeCandidateS0BlockIdSchema, {
			minItems: 1,
			maxItems: MAX_ROOT_OR_AUDIT_SUPPORTING_BLOCK_IDS,
			description:
				"Existing top-level source block IDs that locate the proposed root, boundary, projection, and counterevidence.",
		}),
	},
	{ additionalProperties: false },
);

export const PiNativeCandidateS0ChallengeSchema = Type.Object(
	{
		hard_carrier_root_challenges: Type.Array(
			PiNativeCandidateS0HardCarrierRootChallengeSchema,
			{
				maxItems: MAX_HARD_CARRIER_ROOT_CHALLENGES,
				description:
					"Typed hard-carrier root challenges for independent Finalizer review. They grant no deletion authority by themselves.",
			},
		),
		remove_partitions: Type.Array(PiNativeCandidateS0ChallengePartitionSchema, {
			maxItems: MAX_REMOVE_PARTITIONS,
			description:
				"Ordinary exact-remove challenges outside every source-proven hard-carrier root. A source-certain sparse hole may also remain inside one complete typed audit scope, but the accepted exact overlap must be a strict subset of that audit target. Hard-root descendants must remain absent and are owned exclusively by the Finalizer veto channel.",
		}),
		remove_audit_partitions: Type.Array(
			PiNativeCandidateS0RemoveAuditPartitionSchema,
			{
				maxItems: MAX_REMOVE_AUDIT_PARTITIONS,
				description:
					"At most one mixed_atomic_scope and one recovery_boundary_scope outside every source-proven hard-carrier root; both share the mechanical total audit-block budget. Each complete audit scope may partially overlap source-certain exact-remove holes, but the overlap must remain a strict subset of the audit target and grants no additional authority. Hard-root descendants must remain absent.",
			},
		),
		add_partitions: Type.Array(PiNativeCandidateS0ChallengePartitionSchema, {
			maxItems: MAX_ADD_PARTITIONS,
			description:
				"Ordinary exact-add challenges outside Candidate S0 and outside every source-proven hard-carrier root.",
		}),
	},
	{ additionalProperties: false },
);

export const PiNativeCandidateS0HardCarrierRootVetoSchema = Type.Object(
	{
		carrier_type: PiNativeCandidateS0HardCarrierTypeSchema,
		root_block_id: PiNativeCandidateS0BlockIdSchema,
		exit_block_id_exclusive: Type.Union([
			PiNativeCandidateS0BlockIdSchema,
			Type.Literal("EOF"),
		]),
		projected_s0_anchor_block_id: Type.Integer({
			minimum: 0,
			maximum: Number.MAX_SAFE_INTEGER,
			description:
				"One exact Candidate-S0 block ID inside the submitted root span, proving the veto has a non-empty mechanical projection.",
		}),
	},
	{ additionalProperties: false },
);

export const PiNativeCandidateS0FinalSubmissionSchema = Type.Object(
	{
		hard_carrier_root_vetoes: Type.Array(
			PiNativeCandidateS0HardCarrierRootVetoSchema,
			{
				maxItems: MAX_HARD_CARRIER_ROOT_VETOES,
				description:
					"Submit the minimal maximal non-overlapping source-proven hard-carrier roots first. Their Candidate-S0 descendants are removed exclusively by this channel and must never be copied into ordinary_remove_ranges; a challenge address covered by a veto is mechanically shadowed by the root channel.",
			},
		),
		ordinary_remove_ranges: Type.Array(PiNativeCandidateS0RangeSchema, {
			maxItems: MAX_FINAL_REMOVE_RANGES,
			description:
				"Ordinary full-Candidate-S0 delta, never a final removal inventory. Submit a maximally compact exact subset of Candidate S0. Every mixed_atomic_scope and recovery_boundary_scope must remain a strict sparse subset and must not be copied wholesale through this ordinary channel. A source-proven categorical hard-carrier span must use hard_carrier_root_vetoes instead. Any block covered by a submitted hard-carrier root veto is owned exclusively by that veto and must be omitted here. Any address outside Candidate S0 is a contract failure.",
		}),
		ordinary_add_ranges: Type.Array(PiNativeCandidateS0RangeSchema, {
			maxItems: MAX_FINAL_ADD_RANGES,
			description:
				"Ordinary Challenger-envelope add delta only: exact subset of the mechanically authorized add envelope.",
		}),
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
	targetRangeGroups: Array<{
		rangeIndex: number;
		targetRange: string;
		targetBlockIds: number[];
	}>;
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

export interface CanonicalPiNativeCandidateS0HardCarrierRootChallenge {
	challengeIndex: number;
	carrierType: PiNativeCandidateS0HardCarrierType;
	rootBlockId: number;
	exitBlockIdExclusive: number | "EOF";
	projectedS0AnchorBlockId: number;
	projectedRanges: string[];
	projectedBlockIds: number[];
	sourceConclusion: string;
	supportingBlockIds: number[];
}

export interface CanonicalPiNativeCandidateS0Challenge {
	hardCarrierRootChallenges: CanonicalPiNativeCandidateS0HardCarrierRootChallenge[];
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
	direction: "hard_root" | "remove" | "remove_audit" | "add";
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
	hardCarrierRootChallengeMatches: Array<{
		challengeIndex: number;
		matchedVetoIndices: number[];
	}>;
	ordinaryRemoveRanges: string[];
	ordinaryRemoveBlockIds: number[];
	challengedOrdinaryRemoveRanges: string[];
	challengedOrdinaryRemoveBlockIds: number[];
	independentOrdinaryRemoveRanges: string[];
	independentOrdinaryRemoveBlockIds: number[];
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

export type PiNativeCandidateS0ChallengerRuntime = PiNativeCandidateS0RoleRuntime;

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
		tool: typeof CHALLENGER_OUTPUT_NAME | typeof FINALIZER_TOOL_NAME;
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
	schemaVersion: "xique.word-requirement-review.pi-native-candidate-s0-result.v4";
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
			thinkingMode: "disabled";
			responseFormat: typeof CHALLENGER_OUTPUT_NAME;
			transportProfile: string;
		};
		finalizer: {
			provider: string;
			id: string;
			contextWindow: number;
			transportProfile: string;
		};
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
		exactDelimitedStringScannedSeedCount: number;
		exactDelimitedStringSeedScanTruncated: boolean;
		exactDelimitedStringEligibleEntryCount: number;
		exactDelimitedStringEntryScanTruncated: boolean;
		exactDelimitedStringCandidateSideTruncatedEntryCount: number;
		exactDelimitedStringOutsideSideTruncatedEntryCount: number;
		exactDelimitedStringFanoutOmittedEntryCount: number;
		exactDelimitedStringOccurrenceEntryCount: number;
		exactDelimitedStringOccurrenceSerializedCharacterCount: number;
		candidateS0SourceProjectionBlockCount: number;
		candidateS0SourceProjectionSerializedCharacterCount: number;
		candidateS0SourceProjectionSha256: string | null;
		finalizerSourceBlockCount: number;
		finalizerSourceSerializedCharacterCount: number;
		finalizerSourceContextSerializedCharacterCount: number;
		challengerEstimatedTokens: number;
		challengerWorstCaseOutputTokens: number;
		challengerOutputReserveTokens: number;
		challengerOutputTokenLimit: number;
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
		challengerClaimsForwarded: false;
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
	candidateRunQueue: Array<{
		range: string;
		block_count: number;
		start_block_id: number;
		end_block_id: number;
		singleton: boolean;
	}>;
	fullSource: string;
	candidateSourceProjection: string;
	exactDelimitedStringOccurrenceIndex: string;
	exactDelimitedStringScannedSeedCount: number;
	exactDelimitedStringSeedScanTruncated: boolean;
	exactDelimitedStringEligibleEntryCount: number;
	exactDelimitedStringEntryScanTruncated: boolean;
	exactDelimitedStringCandidateSideTruncatedEntryCount: number;
	exactDelimitedStringOutsideSideTruncatedEntryCount: number;
	exactDelimitedStringFanoutOmittedEntryCount: number;
	exactDelimitedStringOccurrenceEntryCount: number;
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
	finalizerSourceContextSerializedCharacterCount: number;
}

interface ChallengerCallResult {
	challenge: CanonicalPiNativeCandidateS0Challenge;
	rejectedPartitions: PiNativeCandidateS0RejectedChallengePartition[];
	rejectedRecoveryBoundary: boolean;
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

export interface PiNativeCandidateS0ExactDelimitedStringOccurrence {
	matchedSourceText: string;
	candidateS0BlockIds: number[];
	candidateS0BlockIdsTruncated: boolean;
	outsideCandidateS0BlockIds: number[];
	outsideCandidateS0BlockIdsTruncated: boolean;
}

interface PiNativeCandidateS0ExactDelimitedStringOccurrenceIndexBuild {
	entries: PiNativeCandidateS0ExactDelimitedStringOccurrence[];
	scannedSeedCount: number;
	seedScanTruncated: boolean;
	eligibleEntryCount: number;
	entryScanTruncated: boolean;
	candidateSideTruncatedEntryCount: number;
	outsideSideTruncatedEntryCount: number;
	fanoutOmittedEntryCount: number;
}

export function buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
	blocks: readonly { blockId: number; text: string }[],
	candidateBlockIds: ReadonlySet<number>,
): PiNativeCandidateS0ExactDelimitedStringOccurrence[] {
	return buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndexReport(
		blocks,
		candidateBlockIds,
	).entries;
}

function buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndexReport(
	blocks: readonly { blockId: number; text: string }[],
	candidateBlockIds: ReadonlySet<number>,
): PiNativeCandidateS0ExactDelimitedStringOccurrenceIndexBuild {
	const delimitedStrings = new Set<string>();
	const patterns = [
		/《[^《》]{2,80}》/gu,
		/“[^“”]{2,80}”/gu,
		/「[^「」]{2,80}」/gu,
		/『[^『』]{2,80}』/gu,
		/"[^"]{2,80}"/gu,
	];
	let seedScanTruncated = false;
	let reachedSeedLimit = false;
	const seedScanBlocks = [
		...blocks.filter((block) => candidateBlockIds.has(block.blockId)),
		...blocks.filter((block) => !candidateBlockIds.has(block.blockId)),
	];
	for (const block of seedScanBlocks) {
		const blockDelimitedStrings: Array<{
			sourceIndex: number;
			matchedSourceText: string;
		}> = [];
		for (const pattern of patterns) {
			for (const match of block.text.matchAll(pattern)) {
				const matchedSourceText = match[0]
					.slice(1, -1)
					.replace(/\s+/gu, " ")
					.trim();
				if (matchedSourceText.length >= 2) {
					blockDelimitedStrings.push({
						sourceIndex: match.index ?? Number.MAX_SAFE_INTEGER,
						matchedSourceText,
					});
				}
			}
		}
		blockDelimitedStrings.sort(
			(left, right) => left.sourceIndex - right.sourceIndex,
		);
		for (const entry of blockDelimitedStrings) {
			if (delimitedStrings.has(entry.matchedSourceText)) continue;
			if (delimitedStrings.size >= MAX_EXACT_DELIMITED_STRING_SEEDS) {
				seedScanTruncated = true;
				reachedSeedLimit = true;
				break;
			}
			delimitedStrings.add(entry.matchedSourceText);
		}
		if (reachedSeedLimit) break;
	}
	const normalizedBlocks = blocks.map((block) => ({
		blockId: block.blockId,
		text: block.text.replace(/\s+/gu, " ").trim(),
	}));
	const eligibleEntries = [...delimitedStrings]
		.flatMap((matchedSourceText) => {
			const candidateS0BlockIds: number[] = [];
			const outsideCandidateS0BlockIds: number[] = [];
			let candidateS0BlockIdsTruncated = false;
			let outsideCandidateS0BlockIdsTruncated = false;
			let totalOccurrenceBlockCount = 0;
			for (const block of normalizedBlocks) {
				if (!block.text.includes(matchedSourceText)) continue;
				totalOccurrenceBlockCount += 1;
				if (candidateBlockIds.has(block.blockId)) {
					if (
						candidateS0BlockIds.length <
						MAX_EXACT_DELIMITED_STRING_BLOCK_IDS_PER_SIDE
					) {
						candidateS0BlockIds.push(block.blockId);
					} else {
						candidateS0BlockIdsTruncated = true;
					}
				} else if (
					outsideCandidateS0BlockIds.length <
					MAX_EXACT_DELIMITED_STRING_BLOCK_IDS_PER_SIDE
				) {
					outsideCandidateS0BlockIds.push(block.blockId);
				} else {
					outsideCandidateS0BlockIdsTruncated = true;
				}
			}
			if (candidateS0BlockIds.length === 0 || totalOccurrenceBlockCount < 2) {
				return [];
			}
			return [
				{
					entry: {
						matchedSourceText,
						candidateS0BlockIds,
						candidateS0BlockIdsTruncated,
						outsideCandidateS0BlockIds,
						outsideCandidateS0BlockIdsTruncated,
					},
					totalOccurrenceBlockCount,
				},
			];
		});
	const boundedFanoutEntries = eligibleEntries.filter(
		(entry) =>
			entry.totalOccurrenceBlockCount <=
			MAX_EXACT_DELIMITED_STRING_TOTAL_BLOCK_OCCURRENCES,
	);
	return {
		entries: boundedFanoutEntries
			.slice(0, MAX_EXACT_DELIMITED_STRING_OCCURRENCE_ENTRIES)
			.map((entry) => entry.entry),
		scannedSeedCount: delimitedStrings.size,
		seedScanTruncated,
		eligibleEntryCount: eligibleEntries.length,
		entryScanTruncated:
			boundedFanoutEntries.length >
			MAX_EXACT_DELIMITED_STRING_OCCURRENCE_ENTRIES,
		candidateSideTruncatedEntryCount: eligibleEntries.filter(
			(entry) => entry.entry.candidateS0BlockIdsTruncated,
		).length,
		outsideSideTruncatedEntryCount: eligibleEntries.filter(
			(entry) => entry.entry.outsideCandidateS0BlockIdsTruncated,
		).length,
		fanoutOmittedEntryCount:
			eligibleEntries.length - boundedFanoutEntries.length,
	};
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
	const thinkingMode = "disabled" as const;
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
				"candidate-initialRanges-as-S0->both-roles-complete-source-plus-shared-flat-mechanical-S0-projection-run-boundary-queue-and-exact-delimited-string-occurrence-index->one-json-object-challenger-with-typed-root-review-and-partial-exact-audit-dual-channel->full-S0-finalizer-with-global-hard-carrier-veto-and-strict-audit-subset-checksum",
			models: {
				challenger: {
					...runtimeCapabilityIdentity(
						options.challengerRuntime,
						"pi_native_challenger_json_object_thinking_disabled_v1",
					),
					thinkingMode,
					responseFormat: CHALLENGER_OUTPUT_NAME,
					localValidation: "json-parse+typebox+cross-field",
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
				challengerEffectiveMaxTokens: Math.min(
					CHALLENGER_MAX_TOKENS,
					options.challengerRuntime.model.maxTokens,
				),
				challengerOutputReserveTokens: CHALLENGER_OUTPUT_RESERVE_TOKENS,
				challengerOutputBoundEstimator:
					"canonical-normalized-schema-max-items-max-length-json-stringify-fixed-estimator-and-packet-max-block-id-v3",
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
				maxExactSupportingBlockIdsPerPartition:
					MAX_EXACT_SUPPORTING_BLOCK_IDS_PER_PARTITION,
				maxRootOrAuditSupportingBlockIds:
					MAX_ROOT_OR_AUDIT_SUPPORTING_BLOCK_IDS,
				maxChallengeConclusionCharacters:
					MAX_CHALLENGE_CONCLUSION_CHARACTERS,
				maxHardCarrierRootChallenges: MAX_HARD_CARRIER_ROOT_CHALLENGES,
				maxHardCarrierRootVetoes: MAX_HARD_CARRIER_ROOT_VETOES,
				maxExactDelimitedStringSeeds: MAX_EXACT_DELIMITED_STRING_SEEDS,
				maxExactDelimitedStringOccurrenceEntries:
					MAX_EXACT_DELIMITED_STRING_OCCURRENCE_ENTRIES,
				maxExactDelimitedStringBlockIdsPerSide:
					MAX_EXACT_DELIMITED_STRING_BLOCK_IDS_PER_SIDE,
				maxExactDelimitedStringTotalBlockOccurrences:
					MAX_EXACT_DELIMITED_STRING_TOTAL_BLOCK_OCCURRENCES,
				exactDelimitedStringOccurrenceIndex:
					"S0-first-seed-scan-paired-delimiter-whitespace-collapsed-exact-literal-source-block-occurrences-with-bounded-total-fanout",
				candidateS0SourceProjection: {
					version: 1,
					selection: "all-and-only-candidate-S0-blocks",
					order: "packet-source-order",
					fields: ["block_id", "text"],
					serialization: "compact-JSON.stringify",
					roleDelivery: "identical-payload-to-challenger-and-finalizer",
				},
				exactDelimitedStringOccurrenceAlgorithm: {
					version: 2,
					delimiters: ["《》", "“”", "「」", "『』", '\"\"'],
					seedInnerCharacterLength: { minimum: 2, maximum: 80 },
					seedMaySpanBlockLineBreaks: true,
					normalization:
						"collapse-unicode-whitespace-to-one-ascii-space-and-trim",
					matching: "case-sensitive-literal-substring-in-normalized-block",
					perBlockDedupe: true,
					order:
						"S0-blocks-first-seed-scan-then-OUT-blocks-then-packet-block-source-order-occurrences",
					eligibility:
						"at-least-one-candidate-S0-occurrence-and-two-to-eight-total-distinct-source-block-occurrences",
					highFanoutPolicy:
						"omit-the-entire-entry-when-total-distinct-source-block-occurrences-exceed-eight",
				},
				ordinaryRemoveAuthorization: "all-candidate-S0",
				removeAuditOrdinaryDeltaPolicy:
					"strict-subset-per-typed-audit-partition",
				removeAuditExactOverlapPolicy:
					"partial-exact-remove-overlap-allowed-only-when-strict-subset-of-complete-audit-target",
				exactRangeMechanicalContextNeighborsPerSide: 2,
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
	let exactDelimitedStringScannedSeedCount = 0;
	let exactDelimitedStringSeedScanTruncated = false;
	let exactDelimitedStringEligibleEntryCount = 0;
	let exactDelimitedStringEntryScanTruncated = false;
	let exactDelimitedStringCandidateSideTruncatedEntryCount = 0;
	let exactDelimitedStringOutsideSideTruncatedEntryCount = 0;
	let exactDelimitedStringFanoutOmittedEntryCount = 0;
	let exactDelimitedStringOccurrenceEntryCount = 0;
	let exactDelimitedStringOccurrenceSerializedCharacterCount = 0;
	let candidateS0SourceProjectionBlockCount = 0;
	let candidateS0SourceProjectionSerializedCharacterCount = 0;
	let candidateS0SourceProjectionSha256: string | null = null;
	let finalizerSourceBlockCount = 0;
	let finalizerSourceSerializedCharacterCount = 0;
	let finalizerSourceContextSerializedCharacterCount = 0;
	let challengerEstimatedTokens = 0;
	let challengerWorstCaseOutputTokens = 0;
	const challengerOutputTokenLimit = Math.min(
		CHALLENGER_MAX_TOKENS,
		options.challengerRuntime.model.maxTokens,
	);
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
		schemaVersion: "xique.word-requirement-review.pi-native-candidate-s0-result.v4",
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
				responseFormat: CHALLENGER_OUTPUT_NAME,
				transportProfile: resolvedTransportProfile(
					options.challengerRuntime,
					"pi_native_challenger_json_object_thinking_disabled_v1",
				),
			},
			finalizer: {
				...modelIdentity(options.finalizerRuntime.model),
				transportProfile: resolvedTransportProfile(
					options.finalizerRuntime,
					"pi_native_finalizer_strict_tool_v1",
				),
			},
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
			exactDelimitedStringScannedSeedCount,
			exactDelimitedStringSeedScanTruncated,
			exactDelimitedStringEligibleEntryCount,
			exactDelimitedStringEntryScanTruncated,
			exactDelimitedStringCandidateSideTruncatedEntryCount,
			exactDelimitedStringOutsideSideTruncatedEntryCount,
			exactDelimitedStringFanoutOmittedEntryCount,
			exactDelimitedStringOccurrenceEntryCount,
			exactDelimitedStringOccurrenceSerializedCharacterCount,
			candidateS0SourceProjectionBlockCount,
			candidateS0SourceProjectionSerializedCharacterCount,
			candidateS0SourceProjectionSha256,
			finalizerSourceBlockCount,
			finalizerSourceSerializedCharacterCount,
			finalizerSourceContextSerializedCharacterCount,
			challengerEstimatedTokens,
			challengerWorstCaseOutputTokens,
			challengerOutputReserveTokens: CHALLENGER_OUTPUT_RESERVE_TOKENS,
			challengerOutputTokenLimit,
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
							(challenge.hardCarrierRootChallenges.length > 0 ||
								challenge.removePartitions.length > 0 ||
								challenge.removeAuditPartitions.length > 0 ||
								challenge.addPartitions.length > 0)
							? "partial"
							: "none",
			rejectedPartitionCount: challengerRejectedPartitions.length,
		},
		trace: {
			challengerRawResponse,
			challengerNormalizedResponse,
			challengerClaimsForwarded: false,
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
		if (
			options.challengerRuntime.streamFunction !== undefined &&
			(options.challengerRuntime.transportProfile === undefined ||
				options.challengerRuntime.transportProfile.trim().length === 0)
		) {
			validatorFailure =
				"Custom Challenger streamFunction requires an explicit transportProfile";
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason:
					"Candidate S0 Challenger transport profile was not frozen; original Candidate preserved.",
				failure: {
					role: "preflight",
					code: "contract_error",
					message: validatorFailure,
				},
			});
		}
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
		exactDelimitedStringScannedSeedCount =
			prepared.exactDelimitedStringScannedSeedCount;
		exactDelimitedStringSeedScanTruncated =
			prepared.exactDelimitedStringSeedScanTruncated;
		exactDelimitedStringEligibleEntryCount =
			prepared.exactDelimitedStringEligibleEntryCount;
		exactDelimitedStringEntryScanTruncated =
			prepared.exactDelimitedStringEntryScanTruncated;
		exactDelimitedStringCandidateSideTruncatedEntryCount =
			prepared.exactDelimitedStringCandidateSideTruncatedEntryCount;
		exactDelimitedStringOutsideSideTruncatedEntryCount =
			prepared.exactDelimitedStringOutsideSideTruncatedEntryCount;
		exactDelimitedStringFanoutOmittedEntryCount =
			prepared.exactDelimitedStringFanoutOmittedEntryCount;
		exactDelimitedStringOccurrenceEntryCount =
			prepared.exactDelimitedStringOccurrenceEntryCount;
		exactDelimitedStringOccurrenceSerializedCharacterCount =
			prepared.exactDelimitedStringOccurrenceIndex.length;
		candidateS0SourceProjectionBlockCount = prepared.candidateBlockIds.length;
		candidateS0SourceProjectionSerializedCharacterCount =
			prepared.candidateSourceProjection.length;
		candidateS0SourceProjectionSha256 = sha256(
			prepared.candidateSourceProjection,
		);
		finalizerSourceBlockCount = options.packet.blocks.length;
		finalizerSourceSerializedCharacterCount = prepared.fullSource.length;
		finalizerSourceContextSerializedCharacterCount =
			prepared.fullSource.length + prepared.candidateSourceProjection.length;
		challengerWorstCaseOutputTokens =
			estimateWorstCaseCanonicalChallengePayloadTokens();
		if (
			challengerWorstCaseOutputTokens + CHALLENGER_OUTPUT_RESERVE_TOKENS >
			challengerOutputTokenLimit
		) {
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason:
					"Bounded Challenger canonical JSON payload exceeds the effective model output-token budget; Candidate preserved.",
				failure: {
					role: "preflight",
					code: "capacity",
					message: `fixed canonical Challenger output estimate ${challengerWorstCaseOutputTokens} tokens plus reserve ${CHALLENGER_OUTPUT_RESERVE_TOKENS} exceeds effective max ${challengerOutputTokenLimit} (runtime cap ${CHALLENGER_MAX_TOKENS}, model maxTokens ${options.challengerRuntime.model.maxTokens})`,
				},
			});
		}
		challengerEstimatedTokens =
			estimateTextTokens(
				`${prepared.challengerSystemPrompt}\n${prepared.challengerUserPrompt}`,
			) +
			challengerOutputTokenLimit +
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
				)}\n\nCOMPLETE_IMMUTABLE_SOURCE_JSON=${prepared.fullSource}\n\nCANDIDATE_S0_SOURCE_PROJECTION_JSON=${prepared.candidateSourceProjection}\n\nMECHANICAL_S0_RUN_QUEUE_JSON=${JSON.stringify({
					semantic_authority: false,
					runs: prepared.candidateRunQueue,
				})}\n\nMECHANICAL_EXACT_DELIMITED_STRING_OCCURRENCE_INDEX_JSON=${prepared.exactDelimitedStringOccurrenceIndex}\n\nGLOBAL_HARD_CARRIER_VETO_AUTHORIZATION=${JSON.stringify({
					candidate_s0_ranges: prepared.candidateRanges,
					candidate_s0_block_ids: prepared.candidateBlockIds,
					projection:
						"S0 intersection source-order [inclusive root, exclusive exit or EOF)",
					root_may_be_outside_s0: true,
					projection_must_be_nonempty: true,
					anchor_must_be_in_s0_and_span: true,
					max_vetoes: MAX_HARD_CARRIER_ROOT_VETOES,
				})}\n\nFINALIZER_TOOL_SCHEMA=${JSON.stringify(
					PiNativeCandidateS0FinalSubmissionSchema,
				)}`,
			) +
			challengerOutputTokenLimit +
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
		options.onProgress?.({ role: "challenger", tool: CHALLENGER_OUTPUT_NAME });
		throwIfAborted(signal);
		if (challengerResult.rejectedRecoveryBoundary) {
			validatorFailure =
				"A submitted recovery_boundary_scope failed mechanical authorization";
			return finish({
				status: "degraded",
				resolution: "review_incomplete",
				reviewDegraded: true,
				patch: null,
				reason:
					"Recovery-boundary authorization was incomplete; Candidate S0 preserved.",
				failure: {
					role: "challenger",
					code: "contract_error",
					message: validatorFailure,
				},
			});
		}
		if (
			challengerRejectedPartitions.some(
				(partition) => partition.direction !== "hard_root",
			) &&
			challenge.hardCarrierRootChallenges.length === 0 &&
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
		finalizerSourceContextSerializedCharacterCount =
			targeted.finalizerSourceContextSerializedCharacterCount;
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
	const candidateRunQueue = candidateRanges.map((range) => {
		const runBlockIds = expandRanges(
			[range],
			availableBlockIds,
			"candidateRunQueue",
			false,
		);
		const startBlockId = runBlockIds[0];
		const endBlockId = runBlockIds[runBlockIds.length - 1];
		if (startBlockId === undefined || endBlockId === undefined) {
			throw new CandidateS0ContractError(
				`Candidate S0 run queue produced an empty range ${range}`,
			);
		}
		return {
			range,
			block_count: runBlockIds.length,
			start_block_id: startBlockId,
			end_block_id: endBlockId,
			singleton: runBlockIds.length === 1,
		};
	});
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
	const exactDelimitedStringOccurrenceIndexBuild =
		buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndexReport(
			packet.blocks,
			candidateBlockIdSet,
		);
	const exactDelimitedStringOccurrenceIndex = JSON.stringify({
		semantic_authority: false,
		matching_rule:
			"seed inner text from explicit paired delimiters, collapse whitespace only, then locate exact case-sensitive literal occurrences in source blocks",
		eligibility_rule:
			"seed scan prioritizes Candidate-S0 blocks before outside blocks; an emitted seed appears in at least one Candidate-S0 block and two to eight distinct source blocks total",
		bounded_and_non_exhaustive: true,
		absence_is_not_evidence: true,
		max_scanned_seeds: MAX_EXACT_DELIMITED_STRING_SEEDS,
		scanned_seed_count: exactDelimitedStringOccurrenceIndexBuild.scannedSeedCount,
		seed_scan_truncated:
			exactDelimitedStringOccurrenceIndexBuild.seedScanTruncated,
		max_entries: MAX_EXACT_DELIMITED_STRING_OCCURRENCE_ENTRIES,
		eligible_entry_count:
			exactDelimitedStringOccurrenceIndexBuild.eligibleEntryCount,
		entry_scan_truncated:
			exactDelimitedStringOccurrenceIndexBuild.entryScanTruncated,
		max_block_ids_per_side: MAX_EXACT_DELIMITED_STRING_BLOCK_IDS_PER_SIDE,
		max_total_occurrence_blocks:
			MAX_EXACT_DELIMITED_STRING_TOTAL_BLOCK_OCCURRENCES,
		fanout_omitted_entry_count:
			exactDelimitedStringOccurrenceIndexBuild.fanoutOmittedEntryCount,
		candidate_side_truncated_entry_count:
			exactDelimitedStringOccurrenceIndexBuild.candidateSideTruncatedEntryCount,
		outside_side_truncated_entry_count:
			exactDelimitedStringOccurrenceIndexBuild.outsideSideTruncatedEntryCount,
		entries: exactDelimitedStringOccurrenceIndexBuild.entries,
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

MECHANICAL_S0_RUN_QUEUE_JSON=${JSON.stringify({
	semantic_authority: false,
	runs: candidateRunQueue,
})}

MECHANICAL_EXACT_DELIMITED_STRING_OCCURRENCE_INDEX_JSON=${exactDelimitedStringOccurrenceIndex}

CANDIDATE_S0_SOURCE_PROJECTION_JSON=${candidateSourceProjection}

MECHANICAL_AUDIT_BUDGET=${JSON.stringify({
	max_partitions: MAX_REMOVE_AUDIT_PARTITIONS,
	max_one_partition_per_kind: true,
	max_ranges_per_partition: MAX_AUDIT_RANGES_PER_PARTITION,
	max_blocks_per_partition: MAX_AUDIT_BLOCKS_PER_PARTITION,
	max_total_unique_blocks: MAX_TOTAL_AUDIT_BLOCKS,
	candidate_s0_runs: candidateRunQueue.map(({ range, block_count }) => ({
		range,
		block_count,
	})),
})}

MECHANICAL_TARGET_AUTHORIZATION=${targetAuthorization}

CHALLENGER_JSON_SCHEMA=${JSON.stringify(PiNativeCandidateS0ChallengeSchema)}
`;
	return {
		availableBlockIds,
		sourceOrderedBlockIds,
		sourceIndexByBlockId,
		candidateBlockIds,
		candidateRanges,
		candidateRunQueue,
		fullSource,
		candidateSourceProjection,
		exactDelimitedStringOccurrenceIndex,
		exactDelimitedStringScannedSeedCount:
			exactDelimitedStringOccurrenceIndexBuild.scannedSeedCount,
		exactDelimitedStringSeedScanTruncated:
			exactDelimitedStringOccurrenceIndexBuild.seedScanTruncated,
		exactDelimitedStringEligibleEntryCount:
			exactDelimitedStringOccurrenceIndexBuild.eligibleEntryCount,
		exactDelimitedStringEntryScanTruncated:
			exactDelimitedStringOccurrenceIndexBuild.entryScanTruncated,
		exactDelimitedStringCandidateSideTruncatedEntryCount:
			exactDelimitedStringOccurrenceIndexBuild.candidateSideTruncatedEntryCount,
		exactDelimitedStringOutsideSideTruncatedEntryCount:
			exactDelimitedStringOccurrenceIndexBuild.outsideSideTruncatedEntryCount,
		exactDelimitedStringFanoutOmittedEntryCount:
			exactDelimitedStringOccurrenceIndexBuild.fanoutOmittedEntryCount,
		exactDelimitedStringOccurrenceEntryCount:
			exactDelimitedStringOccurrenceIndexBuild.entries.length,
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
	const exactReviewGroups = (
		partitions: readonly CanonicalPiNativeCandidateS0ChallengePartition[],
		reviewKind: "exact_remove_claim" | "exact_add_claim",
	) =>
		partitions.flatMap((partition) =>
			partition.targetRangeGroups.map((rangeGroup) => ({
				review_kind: reviewKind,
				partition_index: partition.partitionIndex,
				range_index: rangeGroup.rangeIndex,
				target_ranges: [rangeGroup.targetRange],
				mechanical_context_block_ids: mechanicalContextBlockIds(
					prepared,
					rangeGroup.targetBlockIds,
				),
			})),
		);
	const envelope = JSON.stringify({
		remove_review_ranges: prepared.candidateRanges,
		add_review_ranges: challenge.addEnvelopeRanges,
		hard_root_review_groups: challenge.hardCarrierRootChallenges.map(
			(rootChallenge) => ({
				challenge_index: rootChallenge.challengeIndex,
				carrier_type: rootChallenge.carrierType,
				root_block_id: rootChallenge.rootBlockId,
				exit_block_id_exclusive: rootChallenge.exitBlockIdExclusive,
				projected_s0_anchor_block_id:
					rootChallenge.projectedS0AnchorBlockId,
				supporting_block_ids: rootChallenge.supportingBlockIds,
			}),
		),
		remove_review_groups: [
			...exactReviewGroups(challenge.removePartitions, "exact_remove_claim"),
			...challenge.removeAuditPartitions.map((partition) => ({
				review_kind: partition.auditKind,
				target_ranges: partition.targetRanges,
				mechanical_target_block_count: partition.targetBlockCount,
				ordinary_remove_must_be_strict_subset: true,
				supporting_block_ids: partition.supportingBlockIds,
			})),
		],
		add_review_groups: exactReviewGroups(
			challenge.addPartitions,
			"exact_add_claim",
		),
		challenger_partition_kind_forwarded: true,
		challenger_claims_forwarded_as_untrusted: false,
		exact_partition_supporting_ids_forwarded: false,
	});
	return {
		systemPrompt: [
			prompts.piNativeSemanticContract.trim(),
			finalizerPrompt.trim(),
		].join("\n\n"),
		userPrompt: `COMPLETE_IMMUTABLE_SOURCE_JSON=${prepared.fullSource}

CANDIDATE_S0_RANGES=${JSON.stringify(prepared.candidateRanges)}

CANDIDATE_S0_SOURCE_PROJECTION_JSON=${prepared.candidateSourceProjection}

MECHANICAL_S0_RUN_QUEUE_JSON=${JSON.stringify({
	semantic_authority: false,
	runs: prepared.candidateRunQueue,
})}

MECHANICAL_EXACT_DELIMITED_STRING_OCCURRENCE_INDEX_JSON=${prepared.exactDelimitedStringOccurrenceIndex}

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
		finalizerSourceContextSerializedCharacterCount:
			prepared.fullSource.length + prepared.candidateSourceProjection.length,
	};
}

function mechanicalContextBlockIds(
	prepared: PreparedCandidateS0Review,
	targetBlockIds: readonly number[],
): number[] {
	const sourceIndices = targetBlockIds.map((blockId) => {
		const sourceIndex = prepared.sourceIndexByBlockId.get(blockId);
		if (sourceIndex === undefined) {
			throw new CandidateS0ContractError(
				`mechanical context references unavailable block ${blockId}`,
			);
		}
		return sourceIndex;
	});
	const firstSourceIndex = Math.min(...sourceIndices);
	const lastSourceIndex = Math.max(...sourceIndices);
	const context = new Set([
		...prepared.sourceOrderedBlockIds.slice(
			Math.max(0, firstSourceIndex - 2),
			firstSourceIndex,
		),
		...prepared.sourceOrderedBlockIds.slice(
			lastSourceIndex + 1,
			lastSourceIndex + 3,
		),
	]);
	return prepared.sourceOrderedBlockIds.filter((blockId) => context.has(blockId));
}

async function runCandidateS0Challenger(
	prepared: PreparedCandidateS0Review,
	runtime: PiNativeCandidateS0ChallengerRuntime,
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
	const streamFunction = runtime.streamFunction ?? piNativeWitnessStreamFunction;
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
				tools: [],
			},
			{
				model: runtime.model,
				temperature: 0,
				maxTokens: Math.min(CHALLENGER_MAX_TOKENS, runtime.model.maxTokens),
				reasoning: "off",
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
			null,
			null,
			null,
		);
	}
	const last = assistantMessages[0];
	const textBlocks = last.content.filter((content) => content.type === "text");
	const rawResponse = textBlocks.length === 0
		? null
		: textBlocks.map((content) => content.text).join("");
	const turnError = validateChallengerTurnShape(last);
	if (turnError !== null) {
		if (last.stopReason === "error" || last.stopReason === "aborted") {
			throw new CandidateS0ProviderError(last.errorMessage ?? turnError);
		}
		throw new CandidateS0ChallengerContractError(
			turnError,
			rawResponse,
			null,
			last.stopReason,
		);
	}
	if (rawResponse === null) {
		throw new CandidateS0ChallengerContractError(
			"Challenger turn did not expose its validated JSON text block",
			null,
			null,
			last.stopReason,
		);
	}
	let normalizedResponse: unknown;
	try {
		normalizedResponse = JSON.parse(rawResponse);
	} catch (error) {
		throw new CandidateS0ChallengerContractError(
			`Challenger JSON parse failed: ${errorMessage(error)}`,
			rawResponse,
			null,
			last.stopReason,
		);
	}
	if (!Value.Check(PiNativeCandidateS0ChallengeSchema, normalizedResponse)) {
		throw new CandidateS0ChallengerContractError(
			schemaErrors(PiNativeCandidateS0ChallengeSchema, normalizedResponse),
			rawResponse,
			normalizedResponse,
			last.stopReason,
		);
	}
	let challengeResult: ReturnType<typeof validateChallengeSubmission>;
	try {
		challengeResult = validateChallengeSubmission(normalizedResponse, prepared);
	} catch (error) {
		throw new CandidateS0ChallengerContractError(
			errorMessage(error),
			rawResponse,
			normalizedResponse,
			last.stopReason,
		);
	}
	return {
		challenge: challengeResult.challenge,
		rejectedPartitions: challengeResult.rejectedPartitions,
		rejectedRecoveryBoundary: challengeResult.rejectedRecoveryBoundary,
		rawResponse,
		normalizedResponse,
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
		description: `Submit hard-carrier root vetoes plus ordinary remove/add subsets. ordinary_remove_ranges is limited exactly to Candidate S0 ${JSON.stringify(
			prepared.candidateRanges,
		)}; ordinary_add_ranges is limited exactly to ${JSON.stringify(
			challenge.addEnvelopeRanges,
		)}. Every typed audit partition must remain a strict subset in ordinary_remove_ranges; use a source-proven hard-carrier root veto for a categorical span. Every block covered by a submitted root veto, including a challenged address, must be omitted from ordinary_remove_ranges; never submit a final removal inventory.`,
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
	rejectedRecoveryBoundary: boolean;
} {
	const candidate = new Set(prepared.candidateBlockIds);
	const removeSeen = new Set<number>();
	const removeAuditSeen = new Set<number>();
	const addSeen = new Set<number>();
	const rejectedPartitions: PiNativeCandidateS0RejectedChallengePartition[] = [];
	const hardCarrierRootChallenges: CanonicalPiNativeCandidateS0HardCarrierRootChallenge[] = [];
	for (const [challengeIndex, rootChallenge] of raw.hard_carrier_root_challenges.entries()) {
		try {
			if (rootChallenge.source_conclusion.trim().length === 0) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}].source_conclusion is blank`,
				);
			}
			const rootIndex = prepared.sourceIndexByBlockId.get(
				rootChallenge.root_block_id,
			);
			if (rootIndex === undefined) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}] references unavailable root block ${rootChallenge.root_block_id}`,
				);
			}
			const exitIndex = rootChallenge.exit_block_id_exclusive === "EOF"
				? prepared.sourceOrderedBlockIds.length
				: prepared.sourceIndexByBlockId.get(
						rootChallenge.exit_block_id_exclusive,
					);
			if (exitIndex === undefined) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}] references unavailable exit block ${rootChallenge.exit_block_id_exclusive}`,
				);
			}
			if (exitIndex <= rootIndex) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}] exit position ${exitIndex} must follow root position ${rootIndex} in source order`,
				);
			}
			const anchorIndex = prepared.sourceIndexByBlockId.get(
				rootChallenge.projected_s0_anchor_block_id,
			);
			if (anchorIndex === undefined) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}] references unavailable Candidate-S0 anchor block ${rootChallenge.projected_s0_anchor_block_id}`,
				);
			}
			if (!candidate.has(rootChallenge.projected_s0_anchor_block_id)) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}] anchor block ${rootChallenge.projected_s0_anchor_block_id} is outside Candidate S0`,
				);
			}
			if (anchorIndex < rootIndex || anchorIndex >= exitIndex) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}] anchor block ${rootChallenge.projected_s0_anchor_block_id} is outside the submitted root span`,
				);
			}
			const projectedBlockIds = prepared.sourceOrderedBlockIds
				.slice(rootIndex, exitIndex)
				.filter((blockId) => candidate.has(blockId));
			if (projectedBlockIds.length === 0) {
				throw new CandidateS0ContractError(
					`hard_carrier_root_challenges[${challengeIndex}] has an empty Candidate-S0 projection`,
				);
			}
			const supportingBlockIds = validateSupportingBlockIds(
				rootChallenge.supporting_block_ids,
				prepared.availableBlockIds,
				`hard_carrier_root_challenges[${challengeIndex}].supporting_block_ids`,
			);
			hardCarrierRootChallenges.push({
				challengeIndex,
				carrierType: rootChallenge.carrier_type,
				rootBlockId: rootChallenge.root_block_id,
				exitBlockIdExclusive: rootChallenge.exit_block_id_exclusive,
				projectedS0AnchorBlockId: rootChallenge.projected_s0_anchor_block_id,
				projectedRanges: compactRanges(projectedBlockIds),
				projectedBlockIds,
				sourceConclusion: rootChallenge.source_conclusion.trim(),
				supportingBlockIds,
			});
		} catch (error) {
			rejectedPartitions.push({
				direction: "hard_root",
				partitionIndex: challengeIndex,
				reason: errorMessage(error),
			});
		}
	}
	const rejectHardCarrierRootOverlap = (
		blockIds: readonly number[],
		fieldName: string,
	): void => {
		for (const blockId of blockIds) {
			const blockIndex = prepared.sourceIndexByBlockId.get(blockId);
			if (blockIndex === undefined) continue;
			for (const rootChallenge of hardCarrierRootChallenges) {
				const rootIndex = prepared.sourceIndexByBlockId.get(
					rootChallenge.rootBlockId,
				);
				const exitIndex = rootChallenge.exitBlockIdExclusive === "EOF"
					? prepared.sourceOrderedBlockIds.length
					: prepared.sourceIndexByBlockId.get(
							rootChallenge.exitBlockIdExclusive,
						);
				if (
					rootIndex !== undefined &&
					exitIndex !== undefined &&
					blockIndex >= rootIndex &&
					blockIndex < exitIndex
				) {
					throw new CandidateS0ContractError(
						`${fieldName} block ${blockId} overlaps hard_carrier_root_challenges[${rootChallenge.challengeIndex}]`,
					);
				}
			}
		}
	};
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
				const partitionSeen = new Set<number>();
				const targetRangeGroups = partition.target_ranges.map(
					(targetRange, rangeIndex) => {
						const targetBlockIds = expandRanges(
							[targetRange],
							prepared.availableBlockIds,
							`${direction}_partitions[${partitionIndex}].target_ranges[${rangeIndex}]`,
							false,
						);
						for (const blockId of targetBlockIds) {
							if (partitionSeen.has(blockId)) {
								throw new CandidateS0ContractError(
									`${direction}_partitions[${partitionIndex}].target_ranges duplicates block ${blockId}`,
								);
							}
							partitionSeen.add(blockId);
						}
						const canonicalRange = compactRanges(targetBlockIds)[0];
						if (canonicalRange === undefined) {
							throw new CandidateS0ContractError(
								`${direction}_partitions[${partitionIndex}].target_ranges[${rangeIndex}] is empty`,
							);
						}
						return { rangeIndex, targetRange: canonicalRange, targetBlockIds };
					},
				);
				const targetBlockIds = targetRangeGroups
					.flatMap((rangeGroup) => rangeGroup.targetBlockIds)
					.sort((left, right) => left - right);
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
				rejectHardCarrierRootOverlap(
					targetBlockIds,
					`${direction}_partitions[${partitionIndex}]`,
				);
				const supportingBlockIds = validateSupportingBlockIds(
					partition.supporting_block_ids,
					prepared.availableBlockIds,
					`${direction}_partitions[${partitionIndex}].supporting_block_ids`,
				);
				for (const blockId of targetBlockIds) directionSeen.add(blockId);
				validated.push({
					direction,
					partitionIndex,
					targetRanges: targetRangeGroups.map(
						(rangeGroup) => rangeGroup.targetRange,
					),
					targetBlockIds,
					targetRangeGroups,
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
	let rejectedRecoveryBoundary = false;
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
				if (removeAuditSeen.has(blockId)) {
					throw new CandidateS0ContractError(
						`remove audit duplicates block ${blockId} across audit partitions`,
					);
				}
				nextAuditSeen.add(blockId);
			}
			if (targetBlockIds.every((blockId) => removeSeen.has(blockId))) {
				throw new CandidateS0ContractError(
					`remove_audit_partitions[${partitionIndex}] exact remove overlap must remain a strict subset of the complete audit target`,
				);
			}
			rejectHardCarrierRootOverlap(
				targetBlockIds,
				`remove_audit_partitions[${partitionIndex}]`,
			);
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
			if (partition.audit_kind === "recovery_boundary_scope") {
				rejectedRecoveryBoundary = true;
			}
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
			hardCarrierRootChallenges,
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
		rejectedRecoveryBoundary,
	};
}

function validateFinalSubmission(
	raw: PiNativeCandidateS0FinalSubmission,
	prepared: PreparedCandidateS0Review,
	challenge: CanonicalPiNativeCandidateS0Challenge,
): CanonicalPiNativeCandidateS0FinalDecision {
	const submittedRemoveBlockIds = expandRanges(
		raw.ordinary_remove_ranges,
		prepared.availableBlockIds,
		"ordinary_remove_ranges",
		true,
	);
	const addBlockIds = expandRanges(
		raw.ordinary_add_ranges,
		prepared.availableBlockIds,
		"ordinary_add_ranges",
		true,
	);
	const candidate = new Set(prepared.candidateBlockIds);
	const challengedRemoveEnvelope = new Set(challenge.removeEnvelopeBlockIds);
	const addEnvelope = new Set(challenge.addEnvelopeBlockIds);
	for (const blockId of submittedRemoveBlockIds) {
		if (!candidate.has(blockId)) {
			throw new CandidateS0ContractError(
				`Finalizer remove block ${blockId} is outside Candidate S0`,
			);
		}
	}
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
	const hardCarrierRootChallengeMatches = challenge.hardCarrierRootChallenges.map(
		(rootChallenge) => ({
			challengeIndex: rootChallenge.challengeIndex,
			matchedVetoIndices: rootValidation.hardCarrierRootVetoes
				.filter(
					(veto) =>
						veto.carrierType === rootChallenge.carrierType &&
						veto.rootBlockId === rootChallenge.rootBlockId &&
						veto.exitBlockIdExclusive === rootChallenge.exitBlockIdExclusive,
				)
				.map((veto) => veto.vetoIndex),
		}),
	);
	const hardCarrierRemoveBlockIds = [
		...new Set(
			rootValidation.hardCarrierRootVetoes.flatMap(
				(veto) => veto.projectedBlockIds,
			),
		),
	].sort((left, right) => left - right);
	const hardCarrierRemove = new Set(hardCarrierRemoveBlockIds);
	const ordinaryRemoveBlockIds = submittedRemoveBlockIds;
	for (const blockId of ordinaryRemoveBlockIds) {
		if (hardCarrierRemove.has(blockId)) {
			throw new CandidateS0ContractError(
				`ordinary remove block ${blockId} duplicates a hard-carrier root veto`,
			);
		}
	}
	const submittedRemove = new Set(ordinaryRemoveBlockIds);
	for (const partition of challenge.removeAuditPartitions) {
		if (
			partition.targetBlockIds.every((blockId) => submittedRemove.has(blockId))
		) {
			throw new CandidateS0ContractError(
				`${partition.auditKind} partition ${partition.partitionIndex} cannot be removed wholesale through ordinary_remove_ranges`,
			);
		}
	}
	if (
		prepared.candidateBlockIds.length > 0 &&
		ordinaryRemoveBlockIds.length === prepared.candidateBlockIds.length
	) {
		throw new CandidateS0ContractError(
			"ordinary_remove_ranges cannot remove the entire non-empty Candidate S0 without a participating hard-carrier root veto",
		);
	}
	if (
		rootValidation.rejectedHardCarrierRootVetoes.length > 0 &&
		rootValidation.hardCarrierRootVetoes.length === 0 &&
		ordinaryRemoveBlockIds.length === 0 &&
		addBlockIds.length === 0
	) {
		throw new CandidateS0ContractError(
			`all submitted hard-carrier root vetoes failed mechanical authorization: ${rootValidation.rejectedHardCarrierRootVetoes
				.map((rejected) => rejected.reason)
				.join("; ")}`,
		);
	}
	const challengedOrdinaryRemoveBlockIds = ordinaryRemoveBlockIds.filter((blockId) =>
		challengedRemoveEnvelope.has(blockId),
	);
	const independentOrdinaryRemoveBlockIds = ordinaryRemoveBlockIds.filter(
		(blockId) => !challengedRemoveEnvelope.has(blockId),
	);
	const removeBlockIds = [
		...new Set([...ordinaryRemoveBlockIds, ...hardCarrierRemoveBlockIds]),
	].sort((left, right) => left - right);
	const remove = new Set(removeBlockIds);
	const finalBlockIds = [
		...prepared.candidateBlockIds.filter((blockId) => !remove.has(blockId)),
		...addBlockIds,
	].sort((left, right) => left - right);
	return {
		submittedRemoveRanges: raw.ordinary_remove_ranges,
		submittedAddRanges: raw.ordinary_add_ranges,
		hardCarrierRootVetoes: rootValidation.hardCarrierRootVetoes,
		rejectedHardCarrierRootVetoes:
			rootValidation.rejectedHardCarrierRootVetoes,
		hardCarrierRootChallengeMatches,
		ordinaryRemoveRanges: compactRanges(ordinaryRemoveBlockIds),
		ordinaryRemoveBlockIds,
		challengedOrdinaryRemoveRanges: compactRanges(
			challengedOrdinaryRemoveBlockIds,
		),
		challengedOrdinaryRemoveBlockIds,
		independentOrdinaryRemoveRanges: compactRanges(
			independentOrdinaryRemoveBlockIds,
		),
		independentOrdinaryRemoveBlockIds,
		rootCoveredRedundantRemoveRanges: [],
		rootCoveredRedundantRemoveBlockIds: [],
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

function validateChallengerTurnShape(message: AssistantMessage): string | null {
	if (message.stopReason === "length") {
		return "Challenger JSON response was truncated by the output-token limit";
	}
	const thinkingBlockCount = message.content.filter(
		(content) => content.type === "thinking",
	).length;
	if (thinkingBlockCount > 0) {
		return "Challenger turn must not contain thinking content";
	}
	const toolCalls = message.content.filter((content) => content.type === "toolCall");
	if (toolCalls.length > 0) {
		return `Challenger turn must not contain tool calls; received ${toolCalls.length}`;
	}
	if (message.stopReason !== "stop") {
		return `Challenger JSON response must stop normally; received ${message.stopReason}`;
	}
	const textBlockCount = message.content.filter((content) => content.type === "text").length;
	if (
		textBlockCount !== 1 ||
		message.content.length !== textBlockCount + thinkingBlockCount
	) {
		return `Challenger turn must contain exactly one JSON text block and only its allowed thinking block; received ${textBlockCount} text and ${thinkingBlockCount} thinking block(s)`;
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

function estimateWorstCaseCanonicalChallengePayloadTokens(): number {
	const rangeCandidates = [
		`段落${"9".repeat(MAX_CHALLENGE_RANGE_CHARACTERS - "段落".length)}`,
		`段落${"9".repeat(13)}-段落${"9".repeat(14)}`,
	];
	const conclusion = "\u0000".repeat(MAX_CHALLENGE_CONCLUSION_CHARACTERS);
	const exactSupportingBlockIds = Array.from(
		{ length: MAX_EXACT_SUPPORTING_BLOCK_IDS_PER_PARTITION },
		() => Number.MAX_SAFE_INTEGER,
	);
	const rootOrAuditSupportingBlockIds = Array.from(
		{ length: MAX_ROOT_OR_AUDIT_SUPPORTING_BLOCK_IDS },
		() => Number.MAX_SAFE_INTEGER,
	);
	const rootChallenge = {
		carrier_type: "contract_terms_and_formats" as const,
		root_block_id: Number.MAX_SAFE_INTEGER,
		exit_block_id_exclusive: Number.MAX_SAFE_INTEGER,
		projected_s0_anchor_block_id: Number.MAX_SAFE_INTEGER,
		source_conclusion: conclusion,
		supporting_block_ids: rootOrAuditSupportingBlockIds,
	};
	return Math.max(
		...rangeCandidates.map((range) => {
			const exactPartition = {
				target_ranges: Array.from(
					{ length: MAX_TARGET_RANGES_PER_PARTITION },
					() => range,
				),
				source_conclusion: conclusion,
				supporting_block_ids: exactSupportingBlockIds,
			};
			const auditPartition = {
				audit_kind: "recovery_boundary_scope" as const,
				target_ranges: Array.from(
					{ length: MAX_AUDIT_RANGES_PER_PARTITION },
					() => range,
				),
				audit_basis: conclusion,
				supporting_block_ids: rootOrAuditSupportingBlockIds,
			};
			const worstCase: PiNativeCandidateS0ChallengeSubmission = {
				hard_carrier_root_challenges: Array.from(
					{ length: MAX_HARD_CARRIER_ROOT_CHALLENGES },
					() => rootChallenge,
				),
				remove_partitions: Array.from(
					{ length: MAX_REMOVE_PARTITIONS },
					() => exactPartition,
				),
				remove_audit_partitions: [
					{ ...auditPartition, audit_kind: "mixed_atomic_scope" },
					auditPartition,
				],
				add_partitions: Array.from(
					{ length: MAX_ADD_PARTITIONS },
					() => exactPartition,
				),
			};
			return estimateTextTokens(JSON.stringify(worstCase));
		}),
	);
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
		transportProfile: resolvedTransportProfile(runtime, defaultTransportProfile),
		headerNames: Object.keys(runtime.headers ?? {}).sort(),
		envNames: Object.keys(runtime.env ?? {}).sort(),
	};
}

function resolvedTransportProfile(
	runtime: PiNativeCandidateS0RoleRuntime,
	defaultTransportProfile: string,
): string {
	return runtime.transportProfile ??
		(runtime.streamFunction === undefined
			? defaultTransportProfile
			: "custom_stream_function");
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
