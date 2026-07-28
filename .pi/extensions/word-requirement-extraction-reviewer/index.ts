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
const RELEASE_MODEL_ID = "gemini-3.5-flash";
const DEFAULT_REVIEWER_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_RELEASE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_PACKET_BYTES = 20 * 1024 * 1024;
const REVIEWER_MAX_TOKENS = 7_000;
const RELEASE_MAX_TOKENS = 7_000;
const REQUEST_TIMEOUT_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 600_000;
const CONTEXT_SAFETY_TOKENS = 8_000;
const MAX_PROVIDER_CALLS = 2;
const MAX_RUN_INPUT_TOKENS = 480_000;
const MAX_RUN_OUTPUT_TOKENS = 14_000;
const MAX_RUN_REASONING_TOKENS = 30_000;
const MAX_REVIEWER_FOCUS_BLOCKS = 256;
const MAX_REVIEWER_FOCUS_CHARACTERS = 20_000;
const MAX_RELEASE_FOCUS_BLOCKS = 128;
const MAX_RELEASE_FOCUS_CHARACTERS = 20_000;
const FOCUS_CONTEXT_RADIUS_BLOCKS = 16;
const RUNTIME_CONTRACT_VERSION = "candidate-protected-hybrid-v47";
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
		"Settle role_evidence and instantiation_evidence first. Carrier Owner is decided before block-level primary effect: never apply the primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier. If the complete source is one hard-excluded carrier with no source-proven exit, that is a terminal null decision; do not reopen internal blocks by technical usefulness. A qualified cross-reference never transfers membership to a referenced excluded appendix, and a direct must-comply duty in an independent technical chapter is not a bare pointer merely because it is short or general. For every mixed source-proven non-excluded chapter touched by the final patch, include one compact mixed_chapter_audit with literal keep/remove address islands. Then state the case-level impact. Range fields must be an exact projection of this settled reason.",
});
const ReleaseReasonSchema = Type.String({
	minLength: 1,
	maxLength: 1_200,
	description:
		"Reach one settled decision. If reason establishes one hard-excluded carrier with no source-proven exit, final_ranges must be empty; never reopen its internal technical duties by primary effect. A cross-reference cannot transfer membership into an excluded appendix. An independent technical chapter that directly requires compliance with standards has present fact payload even when short, general, or parameter-free. For every disputed mixed non-excluded chapter, state the approved keep/remove address islands by primary direct effect, then mechanically re-read every address named in the final sentence before writing final_ranges.",
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
			remove_mode: Type.Unsafe<ReviewerRemoveMode>({
				type: "string",
				enum: ["exact", "candidate_complement"],
				description:
					"Use exact by default with complete safe remove_ranges, even for a broad mixed Candidate. candidate_complement is an exceptional address-compression fallback only when the complete exact deletion genuinely requires more than 64 disjoint ranges; Candidate width alone is never a reason. In that fallback list every Candidate block that must remain in preserve_ranges and leave remove_ranges empty.",
			}),
			remove_ranges: Type.Array(RangeSchema, {
				maxItems: 64,
				description: "Exact Candidate blocks to remove; leave empty in candidate_complement mode.",
			}),
			preserve_ranges: Type.Array(RangeSchema, {
				maxItems: 64,
				description:
					"Write this structural field last, after reason has reached a settled conclusion. List only qualified IN islands with actual fact payload after outer-carrier containment. Never protect hard-excluded carrier content or a title/external-pointer shell.",
			}),
		},
		{ additionalProperties: false },
	);
}

const ReleaseDecisionSchema = Type.Object(
	{
		reason: ReleaseReasonSchema,
		final_ranges: Type.Array(RangeSchema, {
			maxItems: 128,
			description:
				"Write this field last, after reason has reached one settled conclusion. It is the complete final selected range set, not a delta. Include every Candidate block that should remain and every approved challenged addition; omit every approved removal. Use [] only for an explicit null result.",
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
}

export interface RequirementReviewPrompts {
	productPrinciples: string;
	semanticContract: string;
	reviewer: string;
	release: string;
	hashes: {
		productPrinciples: string;
		semanticContract: string;
		reviewer: string;
		release: string;
	};
}

interface ParsedRanges {
	ranges: string[];
	blockIds: number[];
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
	};
}

export async function loadRequirementReviewPrompts(
	directory = promptDirectory,
): Promise<RequirementReviewPrompts> {
	const [productPrinciples, semanticContract, reviewer, release] = await Promise.all([
		readFile(resolve(directory, "product-principles.md"), "utf8"),
		readFile(resolve(directory, "semantic-contract.md"), "utf8"),
		readFile(resolve(directory, "reviewer.md"), "utf8"),
		readFile(resolve(directory, "release.md"), "utf8"),
	]);
	return {
		productPrinciples,
		semanticContract,
		reviewer,
		release,
		hashes: {
			productPrinciples: sha256(productPrinciples),
			semanticContract: sha256(semanticContract),
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
	const reviewerDecisionSchema = createReviewerDecisionSchema();
	const reviewerSystemPrompt = `${options.prompts.semanticContract.trim()}\n\n${options.prompts.reviewer.trim()}`;
	const reviewerUserPrompt = buildReviewerUserPrompt(
		options.packet.blocks,
		new Set(candidate.blockIds),
		candidate.ranges,
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
				requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
				workflowTimeoutMs: WORKFLOW_TIMEOUT_MS,
				maxProviderCalls: MAX_PROVIDER_CALLS,
				maxRunInputTokens: MAX_RUN_INPUT_TOKENS,
				maxRunOutputTokens: MAX_RUN_OUTPUT_TOKENS,
				maxRunReasoningTokens: MAX_RUN_REASONING_TOKENS,
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
					"Write reason first and settle the complete source relationship and residual judgment before any categorical or range fields. Carrier Owner is decided before block-level primary effect: never apply the primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier. For every mixed source-proven non-excluded chapter touched by the patch, reason must compactly state literal keep/remove address islands before the final impact. Then submit exact enum-only source_role and instantiation fields and either pass or one exact challenge. Add may contain only OUT blocks. Use exact remove_ranges by default and enumerate only blocks already judged safe to delete; never submit a broad mixed envelope for Release to search and restore. Use candidate_complement only if exact removal genuinely exceeds 64 disjoint ranges. Never protect hard-excluded carrier content or a title/external-pointer shell. Re-read the literal overlay marker for every range named in reason, and write range fields last. A non-empty candidate cannot pass when source_role is non_procurement.",
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

		const releaseSystemPrompt = `${options.prompts.semanticContract.trim()}\n\n${options.prompts.release.trim()}`;
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
					"First write one short reason that reaches a settled conclusion. Then write final_ranges last as the only authoritative complete structural decision; it is not a delta.",
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
		thinking: { enabled: true, budgetTokens: 4_096 },
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
				name: "Gemini 3.5 Flash (Word Requirement Release)",
				api: "google-generative-ai",
				reasoning: true,
				input: ["text"],
				cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
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
			raw.remove_mode !== "exact" ||
			raw.remove_ranges.length > 0 ||
			raw.preserve_ranges.length > 0
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
	const submittedPreservations = parseStrictRanges(raw.preserve_ranges, availableBlockIds);
	const preserveBlockIds = submittedPreservations.blockIds.filter((blockId) => candidate.has(blockId));
	const preservations = {
		ranges: compactBlockRanges(preserveBlockIds),
		blockIds: preserveBlockIds,
	};
	let submittedRemovals: ParsedRanges;
	if (raw.remove_mode === "exact") {
		if (submittedPreservations.blockIds.length > 0) {
			throw new Error("Reviewer exact removal must not submit preserve_ranges");
		}
		submittedRemovals = parseStrictRanges(raw.remove_ranges, availableBlockIds);
	} else {
		if (raw.remove_ranges.length > 0) {
			throw new Error("Reviewer candidate_complement removal must leave remove_ranges empty");
		}
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
			removeMode: raw.remove_mode,
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
		removeMode: raw.remove_mode,
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
		if (
			("add_ranges" in value && (!Array.isArray(value.add_ranges) || value.add_ranges.length > 0)) ||
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
			remove_mode: "exact",
			remove_ranges: [],
			preserve_ranges: [],
			reason,
		};
	}
	if (value.verdict !== "challenge") return value;
	let removeRanges = normalizeRangeArray(value.remove_ranges ?? []);
	let preserveRanges = normalizeRangeArray(value.preserve_ranges ?? []);
	let removeMode = value.remove_mode ?? "exact";
	if (Array.isArray(removeRanges) && Array.isArray(preserveRanges)) {
		const hasRemoveRanges = removeRanges.length > 0;
		const hasPreserveRanges = preserveRanges.length > 0;
		if (hasPreserveRanges && !hasRemoveRanges) removeMode = "candidate_complement";
		else if (hasRemoveRanges && !hasPreserveRanges) removeMode = "exact";
		else if (hasRemoveRanges && hasPreserveRanges && removeMode === "exact") {
			preserveRanges = [];
		} else if (
			hasRemoveRanges &&
			hasPreserveRanges &&
			removeMode === "candidate_complement"
		) {
			removeRanges = [];
		}
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
		remove_mode: removeMode,
		remove_ranges: removeRanges,
		preserve_ranges: preserveRanges,
		reason: normalizeBoundedReason(value.reason, 1_200),
	};
}

function normalizeReleaseSubmission(value: unknown): unknown {
	if (!isRecord(value)) return value;
	if (!("final_ranges" in value)) return value;
	return {
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
	const intervals: Array<{ start: number; end: number }> = [];
	for (const rawRange of value) {
		const trimmed = rawRange.trim();
		if (!trimmed) continue;
		const match = /^(?:段落|段)(\d+)(?:-(?:(?:段落|段))?(\d+))?$/.exec(trimmed);
		if (!match) return value;
		const start = Number(match[1]);
		const end = Number(match[2] ?? match[1]);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return value;
		intervals.push({ start, end });
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
	const submitted = parseStrictRanges(raw.final_ranges, availableBlockIds);
	const candidate = new Set(candidateBlockIds);
	const allowedAdd = new Set(allowedAddBlockIds);
	const removeEnvelope = new Set(removeEnvelopeBlockIds);
	const finalBlockIds = new Set<number>();
	for (const blockId of submitted.blockIds) {
		if (candidate.has(blockId) || allowedAdd.has(blockId)) finalBlockIds.add(blockId);
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

function buildReviewerUserPrompt(
	blocks: readonly RequirementReviewBlock[],
	candidateBlockIds: ReadonlySet<number>,
	candidateRanges: readonly string[],
): string {
	const candidateCoverageRatio = candidateBlockIds.size / blocks.length;
	const sourceCharacterCount = blocks.reduce((sum, block) => sum + block.text.length, 0);
	const candidateCharacterCount = blocks.reduce(
		(sum, block) => sum + (candidateBlockIds.has(block.blockId) ? block.text.length : 0),
		0,
	);
	const candidateCharacterCoverageRatio =
		sourceCharacterCount === 0 ? 0 : candidateCharacterCount / sourceCharacterCount;
	const focusedCandidate = buildFocusedSource(
		blocks.map((block) => ({
			blockId: block.blockId,
			text: `${candidateBlockIds.has(block.blockId) ? "IN" : "OUT"}|段落${block.blockId}：${block.text}`,
		})),
		candidateBlockIds,
		MAX_REVIEWER_FOCUS_BLOCKS,
		MAX_REVIEWER_FOCUS_CHARACTERS,
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
		`focusedCandidateBlockCount=${focusedCandidate.targetBlockCount}`,
		`focusedCandidateCharacterCount=${focusedCandidate.targetCharacterCount}`,
		`focusedCandidateIncludedTargetBlockCount=${focusedCandidate.includedTargetBlockCount}`,
		`focusedCandidateContextBlockCount=${focusedCandidate.contextBlockCount}`,
		`focusedCandidateRenderedBlockCount=${focusedCandidate.renderedBlockCount}`,
		`focusedCandidateRenderedCharacterCount=${focusedCandidate.renderedCharacterCount}`,
		`focusedCandidateCoverage=${focusedCandidate.coverage}`,
		`focusedCandidateIncluded=${focusedCandidate.coverage !== "omitted"}`,
		"candidateFocusPurpose=Deterministic boundary-balanced duplicate of Candidate-selected source addresses for terminal false-positive audit only. FOCUS_TARGET identifies the sampled Candidate audit surface; CONTEXT_ONLY supplies fixed adjacent source context and grants no extra direction, evidence, vote, or permission. Partial coverage always defers to the complete source above.",
		"Terminal consistency: source_role=non_procurement with a non-empty Candidate is challenge-only and must remove the complete Candidate; it cannot pass.",
		"Read the complete source to the end, then call submit_requirement_residual_review exactly once.",
		"# Complete immutable source with mechanical membership overlay",
		renderReviewerSource(blocks, candidateBlockIds),
		"# Focused Candidate review view with context-only neighbors (mechanical duplicate of source addresses)",
		focusedCandidate.source,
		"# Final closure checklist after reading the complete source",
		"1. Settle the full reason before writing categorical or range fields. Then re-read the literal IN/OUT marker on every block cited in that reason: add only qualified OUT blocks. A desired IN block is already selected and must be placed in preserve_ranges when using candidate_complement; never describe an IN block as an omitted OUT block.",
		"2. Apply the hard-exclusion terminal gate before preserve: instantiation=present, unique current-project facts, and downstream usefulness never override an open announcement, bidder-instruction, response-format, or contract-format Owner. An announcement carrier need not have an explicit announcement heading: a self-contained public-notice sequence that moves through project synopsis, participation eligibility, document acquisition, submission, publication channel, and contact information keeps announcement Owner until a source-proven exit. This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region; never stitch those elements across peer response-format, contract, evaluation, technical-chapter, or detailed-technical-appendix boundaries to label the whole physical file a notice. When such heterogeneous peer carriers exist, first treat the file as a multi-carrier procurement container and reopen Owner at every boundary. Do not invent an invitation-body Owner spanning all numbered sections: invitation is the physical container, not a fifth hard-excluded carrier. A top-level functional shift into project scope, procurement content, execution quality or safety, warranty, technical standards, or a detailed technical appendix is itself a source-proven boundary and needs no explicit end-of-invitation sentence. Continuous numbering and later contact information do not erase that boundary. If you preserve a project-summary island from a true notice sequence, identify its actual regional boundary; without one, do not preserve it.",
		"3. Candidate interval boundaries are not carrier boundaries. A wide IN interval can cross several peer chapters and Owners. Before claiming that a carrier never exits, inspect every later top-level heading, chapter transition, appendix, table heading, and post-carrier island inside that same IN interval; reopen Owner judgment at each source-proven boundary.",
		"4. A staffing, scope, quality, service, acceptance, or technical subheading inside an open announcement, qualification, bidder-instruction, response-format, or contract carrier retains that outer Owner. Only a boundary-independent post-exit technical source can be protected.",
		"5. Distinguish normative incorporation from a bare external pointer. After global instantiation, an independent standards chapter that says work must comply with or reach cited laws, drawings, codes, or current standards directly imposes an executable duty and has fact payload even without copied parameters. Only a heading, empty section, or text that merely says to see an absent document without stating any present duty is a non-fact shell. Conversely, when a qualified project-scope, quality, safety, warranty, acceptance, or technical-standard heading has substantive body text before the next peer Owner boundary, preserve the heading and that body as one source-fidelity unit. An image placeholder, blank line, page break, or short continuation after that heading does not end the section; never keep the heading while deleting its concrete duties, parameters, measures, response times, or responsibilities. Closure never extends backward across the carrier start: an independent appendix, list, or drawing begins at its own heading, name, or first explicit content block, and never absorbs the preceding carrier's signature party, date, seal, closing line, header/footer, or layout image merely because it is adjacent.",
		"5a. Source-fidelity closure and cross-references never transfer Owner. A qualified requirement sentence that says see an appendix does not make that appendix qualified: adjudicate the referenced appendix at its own structural location. If it is inside a contract, response format, scoring, qualification, announcement, or bidder-instruction carrier, it remains excluded even when detailed, unique, or referenced from the requirement chapter. Only a boundary-independent technical appendix under its own qualified Owner can extend the requirement range.",
		"6. Carrier Owner is the terminal gate before primary effect. Never apply the block-level primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier; every internal technical subheading and project-specific duty still follows that outer Owner until a source-proven exit. A complete source whose parties, agreement language, continuous articles, price/payment, breach, effectiveness, termination, dispute and signature structure jointly form one bilateral contract remains a contract even when its title says service or technical requirements and most articles are technically detailed. If that contract never exits to a boundary-independent qualified source, the final is null. Only for a mixed project, business, performance, or other chapter already proven outside the four hard-excluded carriers, perform a literal block-address primary-effect audit before submitting. In reason, compactly state all keep/remove address islands for every such chapter touched by the patch. Keep blocks whose direct operative effect is schedule/service period, location, scope, quality, warranty, delivery, acceptance, safety, service response, implementation or resource provision. Remove blocks whose direct operative effect is funding source, contract price form, price/quotation, payment, settlement, deduction, audit, invoice, guarantee, bid validity or quotation commitment. Engineering quantities, completion, acceptance or quality-retention language used only as a monetary basis, payment condition or settlement trigger does not turn that block into a technical requirement; conversely, a direct work duty remains qualified when cost inclusion is merely incidental. A technical heading does not grant membership to its body: if the next block only says to inspect, obtain later, or see drawings/specifications/attachments absent from this Word and states no present duty, that pointer block must be removed even when the heading is retained for boundary context.",
		"7. Use exact remove_ranges by default, even when Candidate is wide: enumerate every safe removal island and split around all qualified facts. Every block inside an exact remove range must already be judged safe to delete; exact is never a broad candidate-complement envelope and must not contain qualified blocks for Release to discover and restore. candidate_complement is exceptional address compression only when that complete exact deletion would genuinely exceed 64 disjoint ranges; width, convenience, or a desire to protect a few islands is insufficient. If the fallback is truly necessary, preserve_ranges is a block-level allowlist, never a chapter vote.",
		"8. Compute final = Candidate + add - remove once. After reason is settled, write add/remove/preserve fields as its exact structural projection and write all range fields last. Re-read each literal address in the mixed_chapter_audit and the last retained island before calling the tool. The submitted final must close the whole stated issue; do not delete an IN island that reason says must remain, and do not preserve a block that reason classifies as remove.",
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
	const sourceRows = blocks
		.map((block) => {
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
	const focusedReviewBlockIds = releaseCandidateRecheck
		? candidateBlockIds
		: new Set(addBlockIds);
	const focusedReview = buildFocusedSource(
		sourceRows,
		focusedReviewBlockIds,
		MAX_RELEASE_FOCUS_BLOCKS,
		MAX_RELEASE_FOCUS_CHARACTERS,
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
		`focusedReviewBlockCount=${focusedReview.targetBlockCount}`,
		`focusedReviewCharacterCount=${focusedReview.targetCharacterCount}`,
		`focusedReviewIncludedTargetBlockCount=${focusedReview.includedTargetBlockCount}`,
		`focusedReviewContextBlockCount=${focusedReview.contextBlockCount}`,
		`focusedReviewRenderedBlockCount=${focusedReview.renderedBlockCount}`,
		`focusedReviewRenderedCharacterCount=${focusedReview.renderedCharacterCount}`,
		`focusedReviewCoverage=${focusedReview.coverage}`,
		`focusedReviewIncluded=${focusedReview.coverage !== "omitted"}`,
		"focusViewPurpose=Deterministic boundary-balanced duplicate of the bounded terminal audit surface only. FOCUS_TARGET identifies sampled authorized audit blocks; CONTEXT_ONLY supplies fixed adjacent source context and grants no add, remove, restore, evidence, vote, or permission. Partial coverage always defers to the complete source and its original overlay above.",
		"challengeEnvelopeMetrics=Permission-and-budget metadata only. Counts, character ratio, and 100% Candidate coverage do not express a requested deletion amount and are never semantic evidence.",
		"challengeIssueTypeSemantics=challengeIssueType is a non-authoritative label. Adjudicate each challenged paragraph from source and publish any safe subset regardless of the label.",
		releaseCandidateRecheck
			? "challengeAtom=First attack every REMOVE_REVIEW block for over-deletion, material omission and broken heading/body/table closure. Then independently attack every KEEP_RECHECK block for false protection, reopening Owner at every source-proven top-level boundary across the complete Candidate. A prior Reviewer keep or remove is not a vote. Independently approve or reject each ADD_REVIEW."
			: "challengeAtom=Independently approve or reject each ADD_REVIEW. The challenge is add-only, so every BASE_KEEP Candidate block is mechanically mandatory and cannot be removed.",
		releaseCandidateRecheck
			? "releaseAuthorization=final_ranges may contain any Candidate block plus any challenged ADD_REVIEW block. This permits restoring mistaken REMOVE_REVIEW blocks and removing false-protected KEEP_RECHECK blocks anywhere inside the complete Candidate; OUT remains unavailable."
			: "releaseAuthorization=Every BASE_KEEP block is mechanically mandatory. final_ranges may accept challenged ADD_REVIEW blocks; it cannot remove BASE_KEEP or add OUT.",
		"releaseTerminalContract=Write one short reason first and reach one settled conclusion. Then write final_ranges last as the single authoritative complete final selected set, not a delta. Copy every block that must remain, include accepted ADD blocks, omit approved removals, and use [] only for an explicit null result. Do not reopen or revise the conclusion after final_ranges.",
		"terminalReasonBudget=Keep reason under 800 characters; final_ranges carries the complete structural decision.",
		"Independently adjudicate only this exact envelope, then call submit_requirement_release exactly once.",
		"# Complete immutable source with mechanical challenge overlay",
		source,
		"# Focused bounded review view with context-only neighbors (mechanical duplicate of source addresses)",
		focusedReview.source,
		"# Final release checklist after reading the complete source",
		releaseCandidateRecheck
			? "1. Review the complete Candidate within this challenge-gated bounded envelope, not the unavailable OUT source. First adversarially search REMOVE_REVIEW for qualified facts the proposal would lose, especially project scope, detailed body text after a kept heading, cross-page continuations, table headings/details, quality, safety, warranty, acceptance and technical standards. Then independently attack every KEEP_RECHECK address for false protection, reopening Owner at each source-proven boundary. Decide ADD_REVIEW independently and express the complete final set once in final_ranges."
			: "1. Review only the bounded add-only patch. Start from all mechanically mandatory BASE_KEEP blocks, decide ADD_REVIEW independently, then express the complete final set once in final_ranges.",
		"2. Keeping any disputed block needs affirmative proof that it is outside the four hard-excluded carriers. Current-project facts, unique scope, staffing, quality, service, acceptance, or technical wording inside an open announcement, bidder-instruction, response-format, or contract carrier are never protection evidence. An announcement need not carry an explicit title: a self-contained public-notice sequence covering project synopsis, participation eligibility, acquisition, submission, publication channel, and contacts remains announcement Owner until a source-proven exit. This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region; never stitch those elements across peer response-format, contract, evaluation, technical-chapter, or detailed-technical-appendix boundaries to label the whole physical file a notice. When such heterogeneous peer carriers exist, first treat the file as a multi-carrier procurement container and reopen Owner at every boundary. Do not invent an invitation-body Owner spanning all numbered sections: invitation is the physical container, not a fifth hard-excluded carrier. A top-level functional shift into project scope, procurement content, execution quality or safety, warranty, technical standards, or a detailed technical appendix is itself a source-proven boundary and needs no explicit end-of-invitation sentence. Continuous numbering and later contact information do not erase that boundary. If retaining a project-summary island from a true notice sequence, state its actual regional boundary; otherwise omit it.",
		"3. REMOVE_REVIEW interval boundaries are not carrier boundaries. A wide removal proposal can start inside a contract or format chapter and later cross into peer technical chapters before entering another excluded carrier. Reopen Owner judgment at every top-level heading, chapter transition, appendix, table heading, and short post-carrier island inside the interval; never inherit the first heading across the whole range.",
		"4. If the complete source is one hard-excluded carrier, never exits it, and contains no independent qualified region, the correct final_ranges is [] even when the carrier is fully instantiated and technically detailed. Before submitting [], positively establish that Owner partitioning leaves no peer qualified technical region; a physical-file title, invitation act, attachment relationship, or notice elements scattered across separate chapters is insufficient evidence for a null result.",
		"5. Before a broad removal or null result, inspect every later top-level boundary and short island for independent technical standards, requirements, specifications, drawings, lists, or appendices. Outer containment ends only at a source-proven boundary, not at a local technical label.",
		"6. Distinguish normative incorporation from a bare external pointer. Once the source is instantiated by other project facts, an independent technical chapter outside the four carriers has fact payload when it directly requires work to comply with or reach cited laws, drawings, codes, or current standards, even if generally worded or only a few lines. Do not demand repeated project-specific parameters. Only a heading, empty section, or text that merely says to see an absent document without stating any present duty has no payload. Conversely, when a qualified project-scope, quality, safety, warranty, acceptance, or technical-standard heading has substantive body text before the next peer Owner boundary, final_ranges must keep the heading and that body as one source-fidelity unit. An image placeholder, blank line, page break, or short continuation after that heading does not end the section; never keep the heading while omitting its concrete duties, parameters, measures, response times, or responsibilities. Closure never extends backward across the carrier start: an independent appendix, list, or drawing begins at its own heading, name, or first explicit content block, and never absorbs the preceding carrier's signature party, date, seal, closing line, header/footer, or layout image merely because it is adjacent.",
		"6a. Source-fidelity closure and cross-references never transfer Owner. A qualified requirement sentence that says see an appendix does not make that appendix qualified: adjudicate the referenced appendix at its own structural location. If it is inside a contract, response format, scoring, qualification, announcement, or bidder-instruction carrier, it remains excluded even when detailed, unique, or referenced from the requirement chapter. Only a boundary-independent technical appendix under its own qualified Owner can extend final_ranges.",
		"7. Carrier Owner is the terminal gate before primary effect. Never apply the block-level primary-effect test inside an open announcement, bidder-instruction, response-format, or contract-format carrier; internal project-specific duties still follow that hard-excluded Owner until a source-proven exit. A complete source whose parties, agreement language, continuous articles, price/payment, breach, effectiveness, termination, dispute and signature structure jointly form one bilateral contract remains a contract even when its title says service or technical requirements and most articles are technically detailed. If reason establishes that contract-only identity and no boundary-independent qualified source, final_ranges must be []; a later 'but the duties are technical' clause is a direct contradiction. Only outside the four hard-excluded carriers, a heading such as business, fulfillment, delivery, or after-sales requirements is not a pure-commerce verdict. Judge every disputed block by its primary direct effect and state the approved keep/remove address islands in reason. Keep project schedule/service period, location, scope, quality, warranty, delivery, acceptance, implementation, resource-provision and service-response obligations. Remove separately proven price, payment, settlement, deduction, audit, invoice, guarantee, bid-validity or other non-work-content blocks. Engineering quantities, completion, acceptance or quality-retention language used only as a monetary basis, payment condition or settlement trigger is not an acceptance or quality requirement; a direct work duty remains qualified when cost inclusion is merely incidental.",
		"8. In KEEP_RECHECK, independently split mixed chapters at each literal block address and reopen Owner at every source-proven top-level boundary. Adjacent qualified schedule, quality, warranty, scope, or acceptance duties do not protect separable payment, settlement, guarantee, bid-validity, pure quotation, announcement, bidder-instruction, response-format, or contract-format blocks. A retained technical heading also does not protect a following block whose only content is to inspect later or see drawings/specifications/attachments absent from this Word. Conversely, an outer excluded carrier must stop at a peer project-scope, quality, safety, warranty, technical-standard, or detailed-appendix boundary.",
		"9. Envelope size and prior-role agreement are not semantic votes. Even when the remove envelope covers 100% of Candidate, omit every independently safe excluded paragraph, keep every qualified island, and decide each challenged ADD independently.",
		"10. Perform one terminal consistency check on final_ranges itself: re-read every literal source address in the mixed-chapter audit and final sentence, not the remembered chapter meaning. Every block named as kept must be present, every block named as removed must be absent, no uncited tail block may be absorbed merely by range continuity, and [] means an explicit null result.",
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

function buildFocusedSource(
	rows: readonly FocusSourceRow[],
	targetBlockIds: ReadonlySet<number>,
	maxBlocks: number,
	maxCharacters: number,
): FocusedSource {
	const targetIndexes = rows
		.map((row, index) => (targetBlockIds.has(row.blockId) ? index : -1))
		.filter((index) => index >= 0);
	const targetCharacterCount = targetIndexes.reduce((sum, index) => sum + rows[index].text.length, 0);
	if (targetIndexes.length === 0) {
		return {
			targetBlockCount: 0,
			targetCharacterCount,
			includedTargetBlockCount: 0,
			contextBlockCount: 0,
			renderedBlockCount: 0,
			renderedCharacterCount: 0,
			coverage: "omitted",
			source: "focused duplicate omitted because the bounded audit surface is empty; use the complete source above",
		};
	}

	const targetRuns: Array<{ start: number; end: number }> = [];
	for (const index of targetIndexes) {
		const previous = targetRuns.at(-1);
		if (previous && index === previous.end + 1) previous.end = index;
		else targetRuns.push({ start: index, end: index });
	}
	const runPriorities = targetRuns.map((run) => {
		const priority: number[] = [];
		const seen = new Set<number>();
		const add = (index: number) => {
			if (seen.has(index)) return;
			seen.add(index);
			priority.push(index);
		};
		add(run.start);
		add(run.end);
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

	const selectedTargetIndexes = new Set<number>();
	const selectedContextIndexes = new Set<number>();
	let renderedCharacterCount = 0;
	const targetBlockBudget = Math.max(1, maxBlocks - Math.floor(maxBlocks / 4));
	const targetCharacterBudget = Math.max(1, maxCharacters - Math.floor(maxCharacters / 4));
	const addIndex = (
		index: number,
		kind: "target" | "context",
		blockLimit: number,
		characterLimit: number,
	): boolean => {
		if (selectedTargetIndexes.has(index) || selectedContextIndexes.has(index)) return true;
		const rendered = `${kind === "target" ? "FOCUS_TARGET" : "CONTEXT_ONLY"}|${rows[index].text}`;
		const separatorCharacters = selectedTargetIndexes.size + selectedContextIndexes.size > 0 ? 1 : 0;
		if (
			selectedTargetIndexes.size + selectedContextIndexes.size >= blockLimit ||
			renderedCharacterCount + separatorCharacters + rendered.length > characterLimit
		) {
			return false;
		}
		if (kind === "target") selectedTargetIndexes.add(index);
		else selectedContextIndexes.add(index);
		renderedCharacterCount += separatorCharacters + rendered.length;
		return true;
	};

	for (const index of targetPriority) {
		addIndex(index, "target", targetBlockBudget, targetCharacterBudget);
	}
	for (let distance = 1; distance <= FOCUS_CONTEXT_RADIUS_BLOCKS; distance += 1) {
		for (const run of targetRuns) {
			for (const index of [run.start - distance, run.end + distance]) {
				if (index < 0 || index >= rows.length || targetBlockIds.has(rows[index].blockId)) continue;
				addIndex(index, "context", maxBlocks, maxCharacters);
			}
		}
	}
	for (const index of targetPriority) {
		addIndex(index, "target", maxBlocks, maxCharacters);
	}

	const selectedIndexes = [...selectedTargetIndexes, ...selectedContextIndexes].sort(
		(left, right) => left - right,
	);
	if (selectedIndexes.length === 0) {
		return {
			targetBlockCount: targetIndexes.length,
			targetCharacterCount,
			includedTargetBlockCount: 0,
			contextBlockCount: 0,
			renderedBlockCount: 0,
			renderedCharacterCount: 0,
			coverage: "omitted",
			source: "focused duplicate omitted by deterministic context budget; use the complete source above",
		};
	}
	const source = selectedIndexes
		.map(
			(index) =>
				`${selectedTargetIndexes.has(index) ? "FOCUS_TARGET" : "CONTEXT_ONLY"}|${rows[index].text}`,
		)
		.join("\n");
	return {
		targetBlockCount: targetIndexes.length,
		targetCharacterCount,
		includedTargetBlockCount: selectedTargetIndexes.size,
		contextBlockCount: selectedContextIndexes.size,
		renderedBlockCount: selectedIndexes.length,
		renderedCharacterCount: source.length,
		coverage: selectedTargetIndexes.size === targetIndexes.length ? "complete" : "partial",
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
