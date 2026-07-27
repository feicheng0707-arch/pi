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
	buildPiNativeEvidencePacket,
	type PiNativeEvidencePacket,
} from "./native.ts";
import {
	compactBlockRanges,
	parseStrictRanges,
	type ReviewPatch,
	type ScoreReviewPacket,
} from "./reviewer.ts";

const OWNER_MAX_TOKENS = 2_500;
const BOUNDARY_MAX_TOKENS = 4_000;
const REQUEST_TIMEOUT_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 600_000;
const MAX_PROVIDER_CALLS = 2;
const MAX_RUN_INPUT_TOKENS = 520_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_REASONING_TOKENS = 30_000;
const MAX_CONTEXT_CHARACTERS = 900_000;
const CONTEXT_SAFETY_TOKENS = 8_000;
const OWNER_GATE_TRACE_RESERVE_CHARACTERS = 12_000;
const RANGE_ADDRESS_CONTRACT =
	'Canonical range addresses come only from each block\'s range_id="段落N". Source numbering inside text is content, never an address.';

const ExactQuoteSchema = Type.Object({
	block_id: Type.Integer({ minimum: 0 }),
	quote: Type.String({ minLength: 2, maxLength: 600 }),
});
const OwnerClaimSchema = Type.Union([
	Type.Object({
		kind: Type.Literal("positive"),
		controller: ExactQuoteSchema,
		target: ExactQuoteSchema,
		effect: ExactQuoteSchema,
	}),
	Type.Object({
		kind: Type.Literal("none"),
		evidence_quotes: Type.Array(ExactQuoteSchema, { minItems: 1, maxItems: 8 }),
	}),
	Type.Object({
		kind: Type.Literal("uncertain"),
		evidence_quotes: Type.Array(ExactQuoteSchema, { minItems: 1, maxItems: 8 }),
	}),
]);
const OwnerGateDecisionSchema = Type.Object({
	owner_claim: OwnerClaimSchema,
	reason: Type.String({ minLength: 1, maxLength: 2_000 }),
});
const BoundaryNeighborDecisionSchema = Type.Object({
	block_id: Type.Integer({ minimum: 0 }),
	decision: Type.Union([Type.Literal("include"), Type.Literal("exclude")]),
});
const PositiveBoundaryDecisionCommonSchema = {
	neighbor_decisions: Type.Array(BoundaryNeighborDecisionSchema, { maxItems: 64 }),
	evidence_block_ids: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 8 }),
	reason: Type.String({ minLength: 1, maxLength: 3_000 }),
};
const NoneBoundaryDecisionCommonSchema = {
	evidence_block_ids: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 8 }),
	reason: Type.String({ minLength: 1, maxLength: 3_000 }),
};
const BoundaryNeedsReviewOutcomeSchema = Type.Union([
	Type.Literal("needs_review_owner_conflict"),
	Type.Literal("needs_review_boundary_uncertain"),
]);
const PositiveBoundaryGateDecisionSchema = Type.Union([
	Type.Object({
		...PositiveBoundaryDecisionCommonSchema,
		outcome: Type.Literal("publish_positive"),
		final_ranges: Type.Array(Type.String({ pattern: "^段落\\d+(?:-段落\\d+)?$" }), {
			minItems: 1,
		}),
	}),
	Type.Object({
		...PositiveBoundaryDecisionCommonSchema,
		outcome: BoundaryNeedsReviewOutcomeSchema,
		final_ranges: Type.Array(Type.String({ pattern: "^段落\\d+(?:-段落\\d+)?$" }), {
			maxItems: 0,
		}),
	}),
]);
const NoneBoundaryGateDecisionSchema = Type.Union([
	Type.Object({
		...NoneBoundaryDecisionCommonSchema,
		outcome: Type.Literal("publish_empty"),
	}),
	Type.Object({
		...NoneBoundaryDecisionCommonSchema,
		outcome: BoundaryNeedsReviewOutcomeSchema,
	}),
]);

type RawOwnerGateDecision = Static<typeof OwnerGateDecisionSchema>;
type RawOwnerClaim = Static<typeof OwnerClaimSchema>;
interface RawBoundaryGateDecision {
	outcome:
		| "publish_positive"
		| "publish_empty"
		| "needs_review_owner_conflict"
		| "needs_review_boundary_uncertain";
	final_ranges?: string[];
	neighbor_decisions?: Array<{
		block_id: number;
		decision: "include" | "exclude";
	}>;
	evidence_block_ids: number[];
	reason: string;
}

interface BoundaryEvidenceBlock {
	blockId: number;
	sourceText: string;
}
export type PiNativeOwnerBoundaryRole = "owner" | "boundary";

interface ValidatedOwnerGateDecision {
	raw: RawOwnerGateDecision;
	sha256: string;
}

interface ValidatedBoundaryGateDecision {
	raw: RawBoundaryGateDecision;
	blockIds: number[];
}

export interface PiNativeOwnerBoundaryPrompts {
	architecture: string;
	candidate: string;
	owner: string;
	boundary: string;
	boundaryNone: string;
	hashes: {
		architecture: string;
		candidate: string;
		owner: string;
		boundary: string;
		boundaryNone: string;
	};
}

interface RoleUsage {
	providerCalls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
}

interface RuntimeUsage {
	roles: Record<PiNativeOwnerBoundaryRole, RoleUsage>;
}

export interface PiNativeOwnerBoundaryPreflight {
	ownerEstimatedInputTokens: number;
	boundaryEstimatedInputTokens: number;
	worstCaseEstimatedInputTokens: number;
	estimatedRunInputTokens: number;
	contextWindow: number;
	outputReserveTokens: number;
	safetyReserveTokens: number;
	fit: boolean;
	routeReason: "default_profile_capacity_fit" | "context_capacity_exceeded";
}

export interface PiNativeOwnerBoundaryProgress {
	status: "running";
	role: PiNativeOwnerBoundaryRole;
	turn: 1;
	tool: string;
}

export interface PiNativeOwnerBoundaryResult {
	schemaVersion: "xique.score-review.pi-native-owner-boundary-result.v5";
	contractVersion: "score-extraction-reviewer.pi-native.owner-boundary.v5";
	capabilitySha256: string;
	packetSha256: string;
	sourceName: string;
	sourceSha256: string;
	outputField: string;
	status: "complete" | "needs_review";
	resolution: "boundary_published" | "owner_uncertain" | "context_capacity" | "unresolved";
	reason: string;
	initialRanges: string[];
	finalRanges: string[] | null;
	finalBlockIds: number[] | null;
	candidatePreserved: boolean | null;
	patch: ReviewPatch | null;
	decisions: {
		ownerGate: RawOwnerGateDecision | null;
		ownerGateSha256: string | null;
		boundaryGate: RawBoundaryGateDecision | null;
		boundaryEvidenceBlocks: BoundaryEvidenceBlock[] | null;
		boundaryFocusRanges: string[];
		boundaryNeighborBlockIds: number[];
	};
	context: {
		coverage: "full_source";
		ownerSha256: string;
		ownerCharacters: number;
		boundarySha256: string;
		boundaryCharacters: number;
		sourceCharacters: number;
		blockCount: number;
		preflight: PiNativeOwnerBoundaryPreflight;
	};
	prompts: PiNativeOwnerBoundaryPrompts["hashes"];
	model: { provider: string; id: string };
	budget: RoleUsage & {
		maxProviderCalls: 2;
		contextCharacters: number;
		roles: Record<PiNativeOwnerBoundaryRole, RoleUsage>;
	};
	latencyMs: number;
}

export interface RunPiNativeOwnerBoundaryOptions {
	packet: ScoreReviewPacket;
	packetSha256: string;
	prompts: PiNativeOwnerBoundaryPrompts;
	model: Model<Api>;
	streamFunction: StreamFn;
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: ProviderEnv;
	signal?: AbortSignal;
	onProgress?: (progress: PiNativeOwnerBoundaryProgress) => void;
}

export class PiNativeOwnerBoundaryContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PiNativeOwnerBoundaryContractError";
	}
}

export async function loadPiNativeOwnerBoundaryPrompts(
	directory: string,
): Promise<PiNativeOwnerBoundaryPrompts> {
	const [architecture, candidate, owner, boundary, boundaryNone] = await Promise.all([
		readFile(join(directory, "pi-native-owner-boundary-agent.md"), "utf8"),
		readFile(join(directory, "accepted-score-candidate-v019.txt"), "utf8"),
		readFile(join(directory, "pi-native-owner-gate.md"), "utf8"),
		readFile(join(directory, "pi-native-boundary-gate.md"), "utf8"),
		readFile(join(directory, "pi-native-owner-none-boundary-gate.md"), "utf8"),
	]);
	return {
		architecture,
		candidate,
		owner,
		boundary,
		boundaryNone,
		hashes: {
			architecture: sha256(architecture),
			candidate: sha256(candidate),
			owner: sha256(owner),
			boundary: sha256(boundary),
			boundaryNone: sha256(boundaryNone),
		},
	};
}

export async function runPiNativeOwnerBoundaryReview(
	options: RunPiNativeOwnerBoundaryOptions,
): Promise<PiNativeOwnerBoundaryResult> {
	if (options.packet.reviewMode !== "completeness") {
		throw new Error("Pi-native Owner/Boundary review requires reviewMode=completeness");
	}
	if (!options.packet.locatorContext?.completeSourceCoverage) {
		throw new Error("Pi-native Owner/Boundary review requires explicit complete-source coverage");
	}
	const startedAt = Date.now();
	const ownerContext = buildPiNativeEvidencePacket(options.packet, {
		exposeCandidate: false,
		exposeReviewContext: false,
		title: "# Immutable candidate-blind Owner evidence packet",
	});
	const positiveBoundaryContext = buildPiNativeEvidencePacket(options.packet, {
		title: "# Immutable candidate-first Boundary evidence packet",
	});
	const noneBoundaryContext = buildPiNativeEvidencePacket(options.packet, {
		exposeCandidate: false,
		exposeReviewContext: false,
		title: "# Immutable candidate-blind Owner-none Boundary evidence packet",
	});
	const positiveBoundaryNeighborBlockIds = buildBoundaryNeighborBlockIds(positiveBoundaryContext);
	const positiveBoundaryFocusRanges = compactBlockRanges(
		buildBoundaryFocusBlockIds(positiveBoundaryContext),
	);
	const preflight = buildPreflight(
		options,
		ownerContext,
		positiveBoundaryContext,
		noneBoundaryContext,
		positiveBoundaryFocusRanges,
		positiveBoundaryNeighborBlockIds,
	);
	const usage: RuntimeUsage = {
		roles: { owner: emptyUsage(), boundary: emptyUsage() },
	};
	if (
		!preflight.fit ||
		ownerContext.characterCount > MAX_CONTEXT_CHARACTERS ||
		positiveBoundaryContext.characterCount > MAX_CONTEXT_CHARACTERS ||
		noneBoundaryContext.characterCount > MAX_CONTEXT_CHARACTERS
	) {
		return result(
			options,
			ownerContext,
			positiveBoundaryContext,
			positiveBoundaryFocusRanges,
			positiveBoundaryNeighborBlockIds,
			preflight,
			usage,
			startedAt,
			{
				status: "needs_review",
				resolution: "context_capacity",
				reason: `调用前容量预检失败：Owner Gate 估算 ${preflight.ownerEstimatedInputTokens} tokens，Boundary Gate 估算 ${preflight.boundaryEstimatedInputTokens} tokens，模型窗口 ${preflight.contextWindow}。未调用模型。`,
				finalBlockIds: null,
				ownerGate: null,
				boundaryGate: null,
			},
		);
	}

	const timeoutController = new AbortController();
	const timeout = setTimeout(
		() => timeoutController.abort(new Error("Pi-native Owner/Boundary workflow timed out")),
		WORKFLOW_TIMEOUT_MS,
	);
	timeout.unref();
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutController.signal])
		: timeoutController.signal;
	try {
		const ownerGate = await structuredCall({
			role: "owner",
			systemPrompt: roleSystemPrompt(options.prompts, "owner"),
			userPrompt: ownerPrompt(ownerContext),
			toolName: "submit_pi_native_owner_gate",
			toolLabel: "Submit score Owner gate",
			toolDescription: "Submit only the candidate-blind score Owner status and exact source atoms. No ranges.",
			schema: OwnerGateDecisionSchema,
			parse: (raw) => validateOwnerGate(raw, ownerContext),
			maxTokens: OWNER_MAX_TOKENS,
			options,
			usage,
			signal,
		});
		if (ownerGate.raw.owner_claim.kind === "uncertain") {
			return result(
				options,
				ownerContext,
				positiveBoundaryContext,
				positiveBoundaryFocusRanges,
				positiveBoundaryNeighborBlockIds,
				preflight,
				usage,
				startedAt,
				{
					status: "needs_review",
					resolution: "owner_uncertain",
					reason: `候选盲 Owner Gate 无法闭合有效评价 Owner；为避免用边界角色代替 Owner 猜测，未发布 ranges。${ownerGate.raw.reason}`,
					finalBlockIds: null,
					ownerGate,
					boundaryGate: null,
				},
			);
		}

		const positiveOwner = ownerGate.raw.owner_claim.kind === "positive";
		const boundaryMode = positiveOwner ? "positive_candidate_review" : "owner_none_confirmation";
		const boundaryContext = positiveOwner ? positiveBoundaryContext : noneBoundaryContext;
		const boundaryFocusRanges = positiveOwner ? positiveBoundaryFocusRanges : [];
		const boundaryNeighborBlockIds = positiveOwner ? positiveBoundaryNeighborBlockIds : [];
		const boundarySchema: TSchema = positiveOwner
			? PositiveBoundaryGateDecisionSchema
			: NoneBoundaryGateDecisionSchema;
		const boundaryGate = await structuredCall({
			role: "boundary",
			systemPrompt: roleSystemPrompt(options.prompts, "boundary", boundaryMode),
			userPrompt: boundaryPrompt(
				boundaryMode,
				boundaryContext,
				boundaryFocusRanges,
				boundaryNeighborBlockIds,
				JSON.stringify(ownerGate.raw.owner_claim),
			),
			toolName: "submit_pi_native_boundary_gate",
			toolLabel: "Submit final score boundary",
			toolDescription: positiveOwner
				? "Confirm or dispute the positive Owner signal, then publish exact final ranges from the full source or return needs_review."
				: "Independently confirm the Owner-none signal from the full source or return needs_review.",
			schema: boundarySchema,
			parse: (raw) =>
				validateBoundaryGate(
					raw as RawBoundaryGateDecision,
					boundaryContext,
					boundaryNeighborBlockIds,
				),
			maxTokens: BOUNDARY_MAX_TOKENS,
			options,
			usage,
			signal,
		});
		const published = isBoundaryPublished(boundaryGate.raw);
		return result(
			options,
			ownerContext,
			boundaryContext,
			boundaryFocusRanges,
			boundaryNeighborBlockIds,
			preflight,
			usage,
			startedAt,
			{
				status: published ? "complete" : "needs_review",
				resolution: published ? "boundary_published" : "unresolved",
				reason: published
					? `独立 Boundary Gate 确认 Owner 信号并发布最终范围。${boundaryGate.raw.reason}`
					: `独立 Boundary Gate 未能安全发布：${boundaryGate.raw.reason}`,
				finalBlockIds: published ? boundaryGate.blockIds : null,
				ownerGate,
				boundaryGate: boundaryGate.raw,
			},
		);
	} finally {
		clearTimeout(timeout);
	}
}

interface StructuredCallOptions<TSchemaType extends TSchema, TResult> {
	role: PiNativeOwnerBoundaryRole;
	systemPrompt: string;
	userPrompt: string;
	toolName: string;
	toolLabel: string;
	toolDescription: string;
	schema: TSchemaType;
	parse: (value: Static<TSchemaType>) => TResult;
	maxTokens: number;
	options: RunPiNativeOwnerBoundaryOptions;
	usage: RuntimeUsage;
	signal: AbortSignal;
}

async function structuredCall<TSchemaType extends TSchema, TResult>(
	input: StructuredCallOptions<TSchemaType, TResult>,
): Promise<TResult> {
	let parsed: TResult | null = null;
	let contractError: string | null = null;
	const submitTool: AgentTool<TSchemaType, Record<string, unknown>> = {
		name: input.toolName,
		label: input.toolLabel,
		description: input.toolDescription,
		parameters: input.schema,
		executionMode: "sequential",
		prepareArguments(args) {
			if (!Value.Check(input.schema, args)) {
				contractError = Value.Errors(input.schema, args)
					.slice(0, 8)
					.map((error) => `${error.instancePath || "/"}: ${error.message}`)
					.join("; ");
				throw new Error(`strict schema mismatch: ${contractError}`);
			}
			return args as Static<TSchemaType>;
		},
		async execute(_toolCallId, params) {
			try {
				parsed = input.parse(params);
				return terminalResult({ ok: true, status: "accepted" });
			} catch (error) {
				contractError = errorMessage(error);
				throw error;
			}
		},
	};
	const messages = await runAgentLoop(
		userMessage(input.userPrompt),
		{
			systemPrompt: `${input.systemPrompt.trim()}\n\n运行时合同：只调用唯一工具 ${input.toolName}；不得输出自由文本，没有读取、搜索、重试或第二次提交。`,
			messages: [],
			tools: [submitTool],
		},
		{
			model: input.options.model,
			temperature: 0,
			maxTokens: input.maxTokens,
			reasoning: input.options.model.reasoning ? "medium" : undefined,
			apiKey: input.options.apiKey,
			headers: input.options.headers,
			env: input.options.env,
			timeoutMs: REQUEST_TIMEOUT_MS,
			maxRetries: 0,
			toolExecution: "sequential",
			convertToLlm: convertMessages,
			shouldStopAfterTurn: () => true,
		},
		(event) => {
			if (event.type !== "turn_end" || event.message.role !== "assistant") return;
			recordUsage(input.usage.roles[input.role], event.message.usage);
			assertUsageBudget(input.usage);
			input.options.onProgress?.({
				status: "running",
				role: input.role,
				turn: 1,
				tool: input.toolName,
			});
		},
		input.signal,
		(model, context, streamOptions) => {
			const total = totalUsage(input.usage);
			if (total.providerCalls >= MAX_PROVIDER_CALLS) {
				throw new Error("Pi-native Owner/Boundary provider-call budget exhausted");
			}
			input.usage.roles[input.role].providerCalls += 1;
			return input.options.streamFunction(model, context, streamOptions);
		},
	);
	if (parsed !== null) return parsed;
	const last = lastAssistant(messages);
	if (last?.stopReason === "error") {
		throw new Error(`${input.role} provider failed: ${last.errorMessage ?? "unknown error"}`);
	}
	throw new PiNativeOwnerBoundaryContractError(
		`${input.role} structured decision failed in its single allowed call: ${contractError ?? "terminal tool not accepted"}`,
	);
}

function validateOwnerGate(
	raw: RawOwnerGateDecision,
	context: PiNativeEvidencePacket,
): ValidatedOwnerGateDecision {
	validateOwnerClaim(raw.owner_claim, context);
	return { raw, sha256: sha256(JSON.stringify(raw)) };
}

function validateBoundaryGate(
	raw: RawBoundaryGateDecision,
	context: PiNativeEvidencePacket,
	boundaryNeighborBlockIds: readonly number[],
): ValidatedBoundaryGateDecision {
	const final = parseStrictRanges(raw.final_ranges ?? [], context.availableBlockIds);
	const neighborDecisions = raw.neighbor_decisions ?? [];
	validateBoundaryNeighborDecisions(neighborDecisions, boundaryNeighborBlockIds);
	validateBoundaryEvidenceBlockIds(raw.evidence_block_ids, context);
	if (isBoundaryPublished(raw)) {
		const finalSet = new Set(final.blockIds);
		for (const decision of neighborDecisions) {
			if (decision.decision === "include" && !finalSet.has(decision.block_id)) {
				throw new Error(`included boundary neighbor ${decision.block_id} is absent from final_ranges`);
			}
			if (decision.decision === "exclude" && finalSet.has(decision.block_id)) {
				throw new Error(`excluded boundary neighbor ${decision.block_id} is present in final_ranges`);
			}
		}
	}
	return { raw, blockIds: isBoundaryPublished(raw) ? final.blockIds : [] };
}

function validateBoundaryNeighborDecisions(
	decisions: readonly { block_id: number; decision: "include" | "exclude" }[],
	expectedBlockIds: readonly number[],
): void {
	const expected = new Set(expectedBlockIds);
	const seen = new Set<number>();
	for (const decision of decisions) {
		if (!expected.has(decision.block_id)) {
			throw new Error(`boundary neighbor decision references unexpected block ${decision.block_id}`);
		}
		if (seen.has(decision.block_id)) {
			throw new Error(`boundary neighbor decision duplicates block ${decision.block_id}`);
		}
		seen.add(decision.block_id);
	}
	for (const blockId of expectedBlockIds) {
		if (!seen.has(blockId)) throw new Error(`boundary neighbor decision is missing block ${blockId}`);
	}
}

function validateBoundaryEvidenceBlockIds(
	blockIds: readonly number[],
	context: PiNativeEvidencePacket,
): void {
	const seen = new Set<number>();
	for (const blockId of blockIds) {
		if (!context.availableBlockIds.has(blockId)) {
			throw new Error(`boundary evidence references missing block ${blockId}`);
		}
		if (seen.has(blockId)) throw new Error(`boundary evidence duplicates block ${blockId}`);
		seen.add(blockId);
	}
}

function validateOwnerClaim(claim: RawOwnerClaim, context: PiNativeEvidencePacket): void {
	if (claim.kind === "positive") {
		validateQuotes([claim.controller, claim.target, claim.effect], context);
		return;
	}
	validateQuotes(claim.evidence_quotes, context);
}

function validateQuotes(
	quotes: readonly { block_id: number; quote: string }[],
	context: PiNativeEvidencePacket,
): void {
	for (const quote of quotes) {
		const source = context.blocksById.get(quote.block_id)?.sourceText;
		if (source === undefined) throw new Error(`exact quote references missing block ${quote.block_id}`);
		if (!source.includes(quote.quote)) {
			throw new Error(
				`quote is not a literal exact substring of block ${quote.block_id}: ${JSON.stringify(quote.quote)}`,
			);
		}
	}
}

function buildBoundaryFocusBlockIds(context: PiNativeEvidencePacket): number[] {
	const focus = new Set(context.candidateBlockIds);
	for (const blockId of context.candidateBlockIds) {
		if (context.availableBlockIds.has(blockId - 1)) focus.add(blockId - 1);
		if (context.availableBlockIds.has(blockId + 1)) focus.add(blockId + 1);
	}
	return [...focus].sort((left, right) => left - right);
}

function buildBoundaryNeighborBlockIds(context: PiNativeEvidencePacket): number[] {
	const candidate = new Set(context.candidateBlockIds);
	return buildBoundaryFocusBlockIds(context).filter((blockId) => !candidate.has(blockId));
}

function buildPreflight(
	options: RunPiNativeOwnerBoundaryOptions,
	ownerContext: PiNativeEvidencePacket,
	positiveBoundaryContext: PiNativeEvidencePacket,
	noneBoundaryContext: PiNativeEvidencePacket,
	boundaryFocusRanges: readonly string[],
	boundaryNeighborBlockIds: readonly number[],
): PiNativeOwnerBoundaryPreflight {
	const ownerEstimatedInputTokens = estimateTokens([
		roleSystemPrompt(options.prompts, "owner"),
		ownerPrompt(ownerContext),
		JSON.stringify(OwnerGateDecisionSchema),
	]);
	const positiveBoundaryEstimatedInputTokens = estimateTokens([
		roleSystemPrompt(options.prompts, "boundary", "positive_candidate_review"),
		boundaryPrompt(
			"positive_candidate_review",
			positiveBoundaryContext,
			boundaryFocusRanges,
			boundaryNeighborBlockIds,
			"x".repeat(OWNER_GATE_TRACE_RESERVE_CHARACTERS),
		),
		JSON.stringify(PositiveBoundaryGateDecisionSchema),
	]);
	const noneBoundaryEstimatedInputTokens = estimateTokens([
		roleSystemPrompt(options.prompts, "boundary", "owner_none_confirmation"),
		boundaryPrompt(
			"owner_none_confirmation",
			noneBoundaryContext,
			[],
			[],
			"x".repeat(OWNER_GATE_TRACE_RESERVE_CHARACTERS),
		),
		JSON.stringify(NoneBoundaryGateDecisionSchema),
	]);
	const boundaryEstimatedInputTokens = Math.max(
		positiveBoundaryEstimatedInputTokens,
		noneBoundaryEstimatedInputTokens,
	);
	const worstCaseEstimatedInputTokens = Math.max(ownerEstimatedInputTokens, boundaryEstimatedInputTokens);
	const estimatedRunInputTokens = ownerEstimatedInputTokens + boundaryEstimatedInputTokens;
	const fit =
		worstCaseEstimatedInputTokens + BOUNDARY_MAX_TOKENS + CONTEXT_SAFETY_TOKENS <=
			options.model.contextWindow && estimatedRunInputTokens <= MAX_RUN_INPUT_TOKENS;
	return {
		ownerEstimatedInputTokens,
		boundaryEstimatedInputTokens,
		worstCaseEstimatedInputTokens,
		estimatedRunInputTokens,
		contextWindow: options.model.contextWindow,
		outputReserveTokens: BOUNDARY_MAX_TOKENS,
		safetyReserveTokens: CONTEXT_SAFETY_TOKENS,
		fit,
		routeReason: fit ? "default_profile_capacity_fit" : "context_capacity_exceeded",
	};
}

function roleSystemPrompt(
	prompts: PiNativeOwnerBoundaryPrompts,
	role: PiNativeOwnerBoundaryRole,
	boundaryMode: "positive_candidate_review" | "owner_none_confirmation" =
		"positive_candidate_review",
): string {
	const rolePrompt =
		role === "owner"
			? prompts.owner
			: boundaryMode === "positive_candidate_review"
				? prompts.boundary
				: prompts.boundaryNone;
	return [
		prompts.architecture.trim(),
		"# Frozen accepted single-prompt semantic contract",
		prompts.candidate.trim(),
		"# Isolated role contract",
		rolePrompt.trim(),
	].join("\n\n");
}

function ownerPrompt(context: PiNativeEvidencePacket): string {
	return [
		RANGE_ADDRESS_CONTRACT,
		"The candidate, Locator outcome, and review history are intentionally hidden. Submit only one candidate-blind Owner claim through the terminal tool; no ranges or boundary recommendation.",
		context.text,
	].join("\n");
}

function boundaryPrompt(
	mode: "positive_candidate_review" | "owner_none_confirmation",
	context: PiNativeEvidencePacket,
	boundaryFocusRanges: readonly string[],
	boundaryNeighborBlockIds: readonly number[],
	ownerClaimJson: string,
): string {
	if (mode === "owner_none_confirmation") {
		return [
			"boundaryMode=owner_none_confirmation",
			`ownerGateClaim=${ownerClaimJson}`,
			"The candidate, Locator outcome, review history, and all candidate-relative boundary focus are intentionally hidden. Do not reconstruct or infer them.",
			"Independently verify from the complete source whether the Owner-none signal is correct. Publish only the empty result when no valid Owner exists; otherwise return needs_review_owner_conflict or needs_review_boundary_uncertain.",
			"Submit a small evidence_block_ids list. The runtime will attach the immutable source text for those block IDs; do not transcribe quotes.",
			RANGE_ADDRESS_CONTRACT,
			"Submit the sole authoritative Owner-none confirmation through the terminal tool. No later repair call exists.",
			context.text,
		].join("\n");
	}
	return [
		"boundaryMode=positive_candidate_review",
		`candidateRanges=${JSON.stringify(context.candidateRanges)}`,
		`boundaryFocusRanges=${JSON.stringify(boundaryFocusRanges)}`,
		`boundaryNeighborBlockIds=${JSON.stringify(boundaryNeighborBlockIds)}`,
		`ownerGateClaim=${ownerClaimJson}`,
		"Owner Gate reason and all range opinions are intentionally absent. Its typed claim is an untrusted review signal, not an answer. Independently confirm it from source before publication.",
		"boundaryFocusRanges is only a constant-size reading priority built from candidate and direct neighbors. It is not a range restriction. Audit the complete source for distant omissions, multiple containers, cross-references, and a null candidate.",
		"Submit exactly one neighbor_decisions entry for every boundaryNeighborBlockIds member. This constant-size edge audit is not a full block ledger. Include a neighbor when source proves it is a missing part of the same authored evaluator; exclude it only when source proves an affirmative boundary.",
		"Submit a small evidence_block_ids list for the decisive Owner or boundary evidence. The runtime will attach immutable source text for those block IDs; do not transcribe quotes.",
		RANGE_ADDRESS_CONTRACT,
		"Submit the sole authoritative final boundary through the terminal tool. No later repair call exists.",
		context.text,
	].join("\n");
}

interface ResultDecision {
	status: "complete" | "needs_review";
	resolution: PiNativeOwnerBoundaryResult["resolution"];
	reason: string;
	finalBlockIds: number[] | null;
	ownerGate: ValidatedOwnerGateDecision | null;
	boundaryGate: RawBoundaryGateDecision | null;
}

function result(
	options: RunPiNativeOwnerBoundaryOptions,
	ownerContext: PiNativeEvidencePacket,
	boundaryContext: PiNativeEvidencePacket,
	boundaryFocusRanges: string[],
	boundaryNeighborBlockIds: number[],
	preflight: PiNativeOwnerBoundaryPreflight,
	usage: RuntimeUsage,
	startedAt: number,
	decision: ResultDecision,
): PiNativeOwnerBoundaryResult {
	const finalRanges = decision.finalBlockIds ? compactBlockRanges(decision.finalBlockIds) : null;
	return {
		schemaVersion: "xique.score-review.pi-native-owner-boundary-result.v5",
		contractVersion: "score-extraction-reviewer.pi-native.owner-boundary.v5",
		capabilitySha256: sha256(
			JSON.stringify({
				contract: "score-extraction-reviewer.pi-native.owner-boundary.v5",
				prompts: options.prompts.hashes,
				model: { provider: options.model.provider, id: options.model.id },
				schemas: {
					owner: OwnerGateDecisionSchema,
					positiveBoundary: PositiveBoundaryGateDecisionSchema,
					noneBoundary: NoneBoundaryGateDecisionSchema,
				},
				focus:
					"positive_candidate_and_direct_neighbors_or_candidate_blind_none_with_full_source_and_id_evidence",
				limits: {
					maxProviderCalls: MAX_PROVIDER_CALLS,
					maxRunInputTokens: MAX_RUN_INPUT_TOKENS,
					maxOutputTokens: MAX_OUTPUT_TOKENS,
					maxReasoningTokens: MAX_REASONING_TOKENS,
					maxContextCharacters: MAX_CONTEXT_CHARACTERS,
					contextSafetyTokens: CONTEXT_SAFETY_TOKENS,
				},
			}),
		),
		packetSha256: options.packetSha256,
		sourceName: options.packet.sourceName,
		sourceSha256: options.packet.sourceSha256,
		outputField: options.packet.outputField,
		status: decision.status,
		resolution: decision.resolution,
		reason: decision.reason,
		initialRanges: boundaryContext.candidateRanges,
		finalRanges,
		finalBlockIds: decision.finalBlockIds,
		candidatePreserved:
			decision.finalBlockIds === null
				? null
				: sameBlockIds(boundaryContext.candidateBlockIds, decision.finalBlockIds),
		patch:
			decision.finalBlockIds === null
				? null
				: aggregatePatch(boundaryContext.candidateBlockIds, decision.finalBlockIds, decision.reason),
		decisions: {
			ownerGate: decision.ownerGate?.raw ?? null,
			ownerGateSha256: decision.ownerGate?.sha256 ?? null,
			boundaryGate: decision.boundaryGate,
			boundaryEvidenceBlocks: decision.boundaryGate
				? buildBoundaryEvidenceBlocks(decision.boundaryGate, boundaryContext)
				: null,
			boundaryFocusRanges,
			boundaryNeighborBlockIds,
		},
		context: {
			coverage: "full_source",
			ownerSha256: ownerContext.sha256,
			ownerCharacters: ownerContext.characterCount,
			boundarySha256: boundaryContext.sha256,
			boundaryCharacters: boundaryContext.characterCount,
			sourceCharacters: boundaryContext.sourceCharacterCount,
			blockCount: options.packet.blocks.length,
			preflight,
		},
		prompts: options.prompts.hashes,
		model: { provider: options.model.provider, id: options.model.id },
		budget: {
			...totalUsage(usage),
			maxProviderCalls: 2,
			contextCharacters: ownerContext.characterCount + boundaryContext.characterCount,
			roles: usage.roles,
		},
		latencyMs: Date.now() - startedAt,
	};
}

function buildBoundaryEvidenceBlocks(
	decision: RawBoundaryGateDecision,
	context: PiNativeEvidencePacket,
): BoundaryEvidenceBlock[] {
	const blockIds = new Set([
		...decision.evidence_block_ids,
		...(decision.neighbor_decisions ?? []).map((neighbor) => neighbor.block_id),
	]);
	return [...blockIds]
		.sort((left, right) => left - right)
		.map((blockId) => {
			const sourceText = context.blocksById.get(blockId)?.sourceText;
			if (sourceText === undefined) throw new Error(`boundary evidence references missing block ${blockId}`);
			return { blockId, sourceText };
		});
}

function aggregatePatch(
	candidateBlockIds: readonly number[],
	finalBlockIds: readonly number[],
	reason: string,
): ReviewPatch | null {
	const candidate = new Set(candidateBlockIds);
	const final = new Set(finalBlockIds);
	const addedBlockIds = finalBlockIds.filter((blockId) => !candidate.has(blockId));
	const removedBlockIds = candidateBlockIds.filter((blockId) => !final.has(blockId));
	if (addedBlockIds.length === 0 && removedBlockIds.length === 0) return null;
	return {
		missingRanges: compactBlockRanges(addedBlockIds),
		removeRanges: compactBlockRanges(removedBlockIds),
		addedBlockIds,
		removedBlockIds,
		reason,
	};
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
		throw new Error("Pi-native Owner/Boundary input-token budget exhausted");
	}
	if (total.outputTokens > MAX_OUTPUT_TOKENS) {
		throw new Error("Pi-native Owner/Boundary output-token budget exhausted");
	}
	if (total.reasoningTokens > MAX_REASONING_TOKENS) {
		throw new Error("Pi-native Owner/Boundary reasoning-token budget exhausted");
	}
}

function totalUsage(usage: RuntimeUsage): RoleUsage {
	const total = emptyUsage();
	for (const role of Object.values(usage.roles)) {
		total.providerCalls += role.providerCalls;
		total.inputTokens += role.inputTokens;
		total.outputTokens += role.outputTokens;
		total.cacheReadTokens += role.cacheReadTokens;
		total.cacheWriteTokens += role.cacheWriteTokens;
		total.reasoningTokens += role.reasoningTokens;
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
			(message.role === "user" || message.role === "assistant" || message.role === "toolResult"),
	);
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

function isBoundaryPublished(raw: RawBoundaryGateDecision): boolean {
	return raw.outcome === "publish_positive" || raw.outcome === "publish_empty";
}

function sameBlockIds(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((blockId, index) => blockId === right[index]);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
