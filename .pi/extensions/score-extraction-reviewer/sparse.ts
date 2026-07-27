import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	Api,
	AssistantMessage,
	Message,
	Model,
	ProviderEnv,
	ProviderHeaders,
	Usage,
} from "@earendil-works/pi-ai";
import {
	runAgentLoop,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
	type StreamFn,
} from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import {
	compactBlockRanges,
	parseStrictRanges,
	type ReviewPatch,
	type ScoreReviewLocatorContext,
	type ScoreReviewPacket,
} from "./reviewer.ts";

const FINALIZER_MAX_TOKENS = 4_000;
const CHALLENGER_MAX_TOKENS = 3_500;
const REPAIR_MAX_TOKENS = 3_000;
const REQUEST_TIMEOUT_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 720_000;
const MAX_CHALLENGER_CONTEXT_CHARACTERS = 120_000;
const MAX_REPAIR_CONTEXT_CHARACTERS = 40_000;
const SOURCE_FRAGMENT_CHARACTERS = 600;
const STRICT_RANGE_PATTERN = "^段落\\d+(?:-段落\\d+)?$";
const RECALL_PROBE_PATTERN =
	/(?:评分|得分|分值|分数|满分|打分|加分|扣分|赋分|权重|评审因素|评审标准|评分细则|技术评分|技术评审|内容构成|重大偏差|偏离|通过|不通过|否决|无效投标|档次|等级|排名|折算|比较|优劣|完整|缺陷|不提供)/u;
const CROSS_REFERENCE_PATTERN =
	/(?:详见|参见|见第|见本章|对照表|评分表|评审表|附表|附件|第\s*[一二三四五六七八九十百\d]+\s*章|2\s*\.\s*2\s*\.\s*3)/u;
const PRECISION_PROBE_PATTERN =
	/(?:投标报价|报价得分|价格评分|最低价|低于成本|异常低价|价格扣除|本国产品|政府采购政策|中标候选|推荐中标|评标报告|得分汇总|签字|纪律|澄清|复核|复议|合同履约|履约考核|绩效考核)/u;

const StrictRangeSchema = Type.String({ pattern: STRICT_RANGE_PATTERN });
const EvidenceQuoteSchema = Type.Object({
	block_id: Type.Integer({ minimum: 0 }),
	quote: Type.String({ minLength: 2, maxLength: 600 }),
});
const ScopeWitnessSchema = Type.Object({
	range: StrictRangeSchema,
	leaf_block_id: Type.Integer({ minimum: 0 }),
	leaf_quote: Type.String({ minLength: 2, maxLength: 600 }),
});
const DecisionEnvelopeSchema = {
	packet_sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
	source_sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
	context_sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
};
const FinalizerDecisionSchema = Type.Object({
	...DecisionEnvelopeSchema,
	outcome: Type.Union([Type.Literal("publish"), Type.Literal("needs_review")]),
	final_ranges: Type.Array(StrictRangeSchema),
	scope_witnesses: Type.Array(ScopeWitnessSchema, { maxItems: 12 }),
	evidence_quotes: Type.Array(EvidenceQuoteSchema, { minItems: 1, maxItems: 12 }),
	reason: Type.String({ minLength: 1, maxLength: 4_000 }),
});
const ChallengerDecisionSchema = Type.Object({
	...DecisionEnvelopeSchema,
	decision: Type.Union([
		Type.Literal("agree"),
		Type.Literal("challenge"),
		Type.Literal("needs_review"),
	]),
	recommended_ranges: Type.Array(StrictRangeSchema),
	disputed_ranges: Type.Array(StrictRangeSchema),
	scope_witnesses: Type.Array(ScopeWitnessSchema, { maxItems: 12 }),
	evidence_quotes: Type.Array(EvidenceQuoteSchema, { minItems: 1, maxItems: 12 }),
	reason: Type.String({ minLength: 1, maxLength: 4_000 }),
});
const RepairDecisionSchema = Type.Object({
	...DecisionEnvelopeSchema,
	decision: Type.Union([Type.Literal("resolved"), Type.Literal("needs_review")]),
	final_ranges: Type.Array(StrictRangeSchema),
	scope_witnesses: Type.Array(ScopeWitnessSchema, { maxItems: 12 }),
	evidence_quotes: Type.Array(EvidenceQuoteSchema, { minItems: 1, maxItems: 12 }),
	reason: Type.String({ minLength: 1, maxLength: 4_000 }),
});

type RawFinalizerDecision = Static<typeof FinalizerDecisionSchema>;
type RawChallengerDecision = Static<typeof ChallengerDecisionSchema>;
type RawRepairDecision = Static<typeof RepairDecisionSchema>;
type SparseBlock = ScoreReviewPacket["blocks"][number];
export type SparseReviewRole = "finalizer" | "challenger" | "repair";

export interface SparseEvidenceQuote {
	blockId: number;
	quote: string;
}

export interface SparseScopeWitness {
	range: string;
	leafBlockId: number;
	leafQuote: string;
}

export interface SparseFinalizerDecision {
	outcome: "publish" | "needs_review";
	finalRanges: string[];
	finalBlockIds: number[];
	scopeWitnesses: SparseScopeWitness[];
	evidenceQuotes: SparseEvidenceQuote[];
	reason: string;
}

export interface SparseChallengerDecision {
	decision: "agree" | "challenge" | "needs_review";
	recommendedRanges: string[];
	recommendedBlockIds: number[];
	disputedRanges: string[];
	disputedBlockIds: number[];
	scopeWitnesses: SparseScopeWitness[];
	evidenceQuotes: SparseEvidenceQuote[];
	reason: string;
}

export interface SparseRepairDecision {
	decision: "resolved" | "needs_review";
	finalRanges: string[];
	finalBlockIds: number[];
	scopeWitnesses: SparseScopeWitness[];
	evidenceQuotes: SparseEvidenceQuote[];
	reason: string;
}

export interface SparseReviewPrompts {
	finalizer: string;
	challenger: string;
	repair: string;
	hashes: {
		finalizer: string;
		challenger: string;
		repair: string;
	};
}

export interface SparseReviewBudgetLimits {
	maxProviderCalls: number;
	maxInputTokens: number;
	maxOutputTokens: number;
	maxReasoningTokens: number;
	maxContextCharacters: number;
	maxWallClockMs: number;
}

interface SparseRoleUsage {
	providerCalls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
}

export interface SparseReviewBudgetSnapshot extends SparseRoleUsage {
	limits: SparseReviewBudgetLimits;
	contextCharacters: number;
	elapsedMs: number;
	exceededReason: string | null;
	roles: Record<SparseReviewRole, SparseRoleUsage>;
}

const DEFAULT_BUDGET_LIMITS: SparseReviewBudgetLimits = {
	maxProviderCalls: 3,
	maxInputTokens: 240_000,
	maxOutputTokens: 16_000,
	maxReasoningTokens: 12_000,
	maxContextCharacters: 160_000,
	maxWallClockMs: WORKFLOW_TIMEOUT_MS,
};

export class SparseReviewBudgetExceededError extends Error {
	readonly snapshot: SparseReviewBudgetSnapshot;

	constructor(message: string, snapshot: SparseReviewBudgetSnapshot) {
		super(message);
		this.name = "SparseReviewBudgetExceededError";
		this.snapshot = snapshot;
	}
}

export class SparseReviewContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SparseReviewContractError";
	}
}

class SparseReviewBudget {
	readonly limits: SparseReviewBudgetLimits;
	private readonly startedAt = Date.now();
	private readonly roles: Record<SparseReviewRole, SparseRoleUsage> = {
		finalizer: emptyRoleUsage(),
		challenger: emptyRoleUsage(),
		repair: emptyRoleUsage(),
	};
	private contextCharactersValue = 0;
	private exceededReasonValue: string | null = null;

	constructor(overrides: Partial<SparseReviewBudgetLimits> = {}) {
		this.limits = {
			maxProviderCalls: boundedLimit(DEFAULT_BUDGET_LIMITS.maxProviderCalls, overrides.maxProviderCalls),
			maxInputTokens: boundedLimit(DEFAULT_BUDGET_LIMITS.maxInputTokens, overrides.maxInputTokens),
			maxOutputTokens: boundedLimit(DEFAULT_BUDGET_LIMITS.maxOutputTokens, overrides.maxOutputTokens),
			maxReasoningTokens: boundedLimit(DEFAULT_BUDGET_LIMITS.maxReasoningTokens, overrides.maxReasoningTokens),
			maxContextCharacters: boundedLimit(
				DEFAULT_BUDGET_LIMITS.maxContextCharacters,
				overrides.maxContextCharacters,
			),
			maxWallClockMs: boundedLimit(DEFAULT_BUDGET_LIMITS.maxWallClockMs, overrides.maxWallClockMs),
		};
	}

	recordContextCharacters(count: number): void {
		this.contextCharactersValue = count;
		this.checkLimits();
	}

	reserveProviderCall(role: SparseReviewRole): void {
		this.checkLimits();
		this.throwIfExceeded();
		if (this.snapshot().providerCalls >= this.limits.maxProviderCalls) {
			this.fail("sparse review provider-call budget exhausted");
			this.throwIfExceeded();
		}
		this.roles[role].providerCalls += 1;
	}

	recordUsage(role: SparseReviewRole, usage: Usage): void {
		const target = this.roles[role];
		target.inputTokens += usage.input;
		target.outputTokens += usage.output;
		target.cacheReadTokens += usage.cacheRead;
		target.cacheWriteTokens += usage.cacheWrite;
		target.reasoningTokens += usage.reasoning ?? 0;
		this.checkLimits();
	}

	throwIfExceeded(): void {
		if (this.exceededReasonValue) {
			throw new SparseReviewBudgetExceededError(this.exceededReasonValue, this.snapshot());
		}
	}

	snapshot(): SparseReviewBudgetSnapshot {
		const total = emptyRoleUsage();
		for (const usage of Object.values(this.roles)) {
			total.providerCalls += usage.providerCalls;
			total.inputTokens += usage.inputTokens;
			total.outputTokens += usage.outputTokens;
			total.cacheReadTokens += usage.cacheReadTokens;
			total.cacheWriteTokens += usage.cacheWriteTokens;
			total.reasoningTokens += usage.reasoningTokens;
		}
		return {
			...total,
			limits: { ...this.limits },
			contextCharacters: this.contextCharactersValue,
			elapsedMs: Date.now() - this.startedAt,
			exceededReason: this.exceededReasonValue,
			roles: {
				finalizer: { ...this.roles.finalizer },
				challenger: { ...this.roles.challenger },
				repair: { ...this.roles.repair },
			},
		};
	}

	private checkLimits(): void {
		if (this.exceededReasonValue) return;
		const snapshot = this.snapshot();
		if (snapshot.elapsedMs > this.limits.maxWallClockMs) {
			this.fail("sparse review wall-clock budget exhausted");
		} else if (snapshot.inputTokens > this.limits.maxInputTokens) {
			this.fail("sparse review input-token budget exhausted");
		} else if (snapshot.outputTokens > this.limits.maxOutputTokens) {
			this.fail("sparse review output-token budget exhausted");
		} else if (snapshot.reasoningTokens > this.limits.maxReasoningTokens) {
			this.fail("sparse review reasoning-token budget exhausted");
		} else if (snapshot.contextCharacters > this.limits.maxContextCharacters) {
			this.fail("sparse review compact-context character budget exhausted");
		}
	}

	private fail(reason: string): void {
		this.exceededReasonValue ??= reason;
	}
}

interface SparseContextBlock {
	block: SparseBlock;
	sourceText: string;
	rendered: string;
	position: number;
}

export interface SparseReviewContext {
	text: string;
	sha256: string;
	characterCount: number;
	sourceCharacterCount: number;
	initialBlockIds: number[];
	initialRanges: string[];
	availableBlockIds: ReadonlySet<number>;
	blocksById: ReadonlyMap<number, SparseContextBlock>;
	blockIdsByPosition: readonly number[];
	headingBlockIds: readonly number[];
	recallProbeBlockIds: readonly number[];
	crossReferenceBlockIds: readonly number[];
	crossScoreBridgeBlockIds: readonly number[];
	precisionProbeBlockIds: readonly number[];
}

interface SparseEvidenceSlice {
	text: string;
	sha256: string;
	characterCount: number;
	blockIds: number[];
}

export interface SparseReviewProgress {
	status: "running";
	role: SparseReviewRole;
	turn: 1;
}

export interface SparseReviewResult {
	schemaVersion: "xique.score-review.sparse-result.v1";
	contractVersion: "score-extraction-reviewer.sparse.v1";
	packetSha256: string;
	sourceName: string;
	sourceSha256: string;
	outputField: string;
	status: "complete" | "needs_review";
	resolution: "locator_null" | "agreement" | "targeted_repair" | "unresolved";
	reason: string;
	initialRanges: string[];
	finalRanges: string[] | null;
	finalBlockIds: number[] | null;
	patch: ReviewPatch | null;
	decisions: {
		finalizer: SparseFinalizerDecision | null;
		challenger: SparseChallengerDecision | null;
		repair: SparseRepairDecision | null;
	};
	context: {
		buildCount: 0 | 1;
		coverage: "locator_null" | "full_source";
		sha256: string;
		characters: number;
		sourceCharacters: number;
		blockCount: number;
		challengerCharacters: number;
		repairCharacters: number;
	};
	prompts: SparseReviewPrompts["hashes"];
	model: { provider: string; id: string };
	budget: SparseReviewBudgetSnapshot;
	latencyMs: number;
}

export interface RunSparseScoreReviewOptions {
	packet: ScoreReviewPacket;
	packetSha256: string;
	prompts: SparseReviewPrompts;
	model: Model<Api>;
	streamFunction: StreamFn;
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: ProviderEnv;
	signal?: AbortSignal;
	budgetLimits?: Partial<SparseReviewBudgetLimits>;
	onProgress?: (progress: SparseReviewProgress) => void;
}

export async function loadSparseReviewPrompts(directory: string): Promise<SparseReviewPrompts> {
	const [finalizer, challenger, repair] = await Promise.all([
		readFile(join(directory, "dual-review-finalizer.md"), "utf8"),
		readFile(join(directory, "dual-review-challenger.md"), "utf8"),
		readFile(join(directory, "dual-review-repair.md"), "utf8"),
	]);
	return {
		finalizer,
		challenger,
		repair,
		hashes: {
			finalizer: sha256(finalizer),
			challenger: sha256(challenger),
			repair: sha256(repair),
		},
	};
}

export function buildSparseReviewContext(packet: ScoreReviewPacket): SparseReviewContext {
	const availableBlockIds = new Set(packet.blocks.map((block) => block.blockId));
	const initial = parseStrictRanges(packet.initialRanges, availableBlockIds);
	const selected = new Set(initial.blockIds);
	const blocksById = new Map<number, SparseContextBlock>();
	const headingBlockIds: number[] = [];
	const recallProbeBlockIds: number[] = [];
	const crossReferenceBlockIds: number[] = [];
	const crossScoreBridgeBlockIds: number[] = [];
	const precisionProbeBlockIds: number[] = [];
	let sourceCharacterCount = 0;

	for (const [position, block] of packet.blocks.entries()) {
		const sourceText = blockSourceText(block);
		const rendered = renderContextBlock(block, sourceText, selected.has(block.blockId));
		blocksById.set(block.blockId, { block, sourceText, rendered, position });
		sourceCharacterCount += sourceText.length;
		if (block.structure.headingCandidateLevel !== null) headingBlockIds.push(block.blockId);
		const recallProbe = RECALL_PROBE_PATTERN.test(sourceText);
		const crossReferenceProbe = CROSS_REFERENCE_PATTERN.test(sourceText);
		if (recallProbe) recallProbeBlockIds.push(block.blockId);
		if (crossReferenceProbe) crossReferenceBlockIds.push(block.blockId);
		if (recallProbe && crossReferenceProbe) crossScoreBridgeBlockIds.push(block.blockId);
		if (PRECISION_PROBE_PATTERN.test(sourceText)) precisionProbeBlockIds.push(block.blockId);
	}

	const header = [
		"# Frozen compact score-review context",
		`sourceName=${JSON.stringify(packet.sourceName)}`,
		`sourceSha256=${packet.sourceSha256}`,
		`reviewMode=${packet.reviewMode}`,
		`initialRanges=${JSON.stringify(initial.ranges)}`,
		`locatorContext=${JSON.stringify(packet.locatorContext ?? null)}`,
		`crossScoreBridgeProbeRanges=${JSON.stringify(compactBlockRanges(crossScoreBridgeBlockIds))}`,
		"Legend: S=Locator selected; T=table; Hn=heading candidate; Pn=candidate parent; Gn=sequence group; An=nearest ancestors.",
		"A large table or long atomic block is split into 段落N#K fragments only for reading; every fragment still belongs to one indivisible block N.",
		"<UNTRUSTED_SOURCE>",
	].join("\n");
	const body = packet.blocks.map((block) => blocksById.get(block.blockId)?.rendered ?? "").join("\n");
	const text = `${header}\n${body}\n</UNTRUSTED_SOURCE>`;
	return {
		text,
		sha256: sha256(text),
		characterCount: text.length,
		sourceCharacterCount,
		initialBlockIds: initial.blockIds,
		initialRanges: initial.ranges,
		availableBlockIds,
		blocksById,
		blockIdsByPosition: packet.blocks.map((block) => block.blockId),
		headingBlockIds,
		recallProbeBlockIds,
		crossReferenceBlockIds,
		crossScoreBridgeBlockIds,
		precisionProbeBlockIds,
	};
}

export async function runSparseScoreReview(options: RunSparseScoreReviewOptions): Promise<SparseReviewResult> {
	if (options.packet.reviewMode !== "completeness") {
		throw new Error("sparse dual review requires a completeness packet from the accepted Locator boundary");
	}
	const locatorContext = requireLocatorContext(options.packet);
	const startedAt = Date.now();
	const budget = new SparseReviewBudget(options.budgetLimits);
	if (isAcceptedWindowedLocatorNull(locatorContext)) {
		return locatorNullResult(options, budget, startedAt);
	}

	const context = buildSparseReviewContext(options.packet);
	budget.recordContextCharacters(context.characterCount);
	if (context.characterCount > budget.limits.maxContextCharacters) {
		return unresolvedResult({
			options,
			budget,
			startedAt,
			context,
			finalizer: null,
			challenger: null,
			repair: null,
			challengerCharacters: 0,
			repairCharacters: 0,
			reason: `完整 compact context 为 ${context.characterCount} 字符，超过硬上限 ${budget.limits.maxContextCharacters}；未调用模型，也不发布不完整证据上的范围。`,
		});
	}
	budget.throwIfExceeded();

	const timeoutController = new AbortController();
	const timeout = setTimeout(
		() => timeoutController.abort(new Error("sparse dual-review workflow timed out")),
		budget.limits.maxWallClockMs,
	);
	timeout.unref();
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutController.signal])
		: timeoutController.signal;

	try {
		const finalizer = await runStructuredDecision({
			role: "finalizer",
			systemPrompt: options.prompts.finalizer,
			userPrompt: finalizerUserPrompt(options, context),
			toolName: "submit_score_review_finalizer",
			toolLabel: "Submit score review finalizer",
			toolDescription: "Submit the main source-first range judgment. This is the only terminal path.",
			schema: FinalizerDecisionSchema,
			parse: (raw) => normalizeFinalizer(raw, options, context),
			maxTokens: FINALIZER_MAX_TOKENS,
			options,
			budget,
			signal,
		});

		let challengerEvidence = buildChallengerEvidence(context, finalizer);
		if (challengerEvidence.characterCount > MAX_CHALLENGER_CONTEXT_CHARACTERS) {
			challengerEvidence = {
				text: context.text,
				sha256: context.sha256,
				characterCount: context.characterCount,
				blockIds: [...context.blockIdsByPosition],
			};
		}
		const challenger = await runStructuredDecision({
			role: "challenger",
			systemPrompt: options.prompts.challenger,
			userPrompt: challengerUserPrompt(options, context, challengerEvidence, finalizer),
			toolName: "submit_score_review_challenger",
			toolLabel: "Submit score review challenger",
			toolDescription: "Submit the independent adversarial verdict. This is the only terminal path.",
			schema: ChallengerDecisionSchema,
			parse: (raw) => normalizeChallenger(raw, options, context, finalizer),
			maxTokens: CHALLENGER_MAX_TOKENS,
			options,
			budget,
			signal,
		});

		if (
			finalizer.outcome === "publish" &&
			challenger.decision === "agree" &&
			sameBlockIds(finalizer.finalBlockIds, challenger.recommendedBlockIds)
		) {
			return completedResult({
				options,
				budget,
				startedAt,
				context,
				resolution: "agreement",
				finalBlockIds: finalizer.finalBlockIds,
				finalizer,
				challenger,
				repair: null,
				challengerCharacters: challengerEvidence.characterCount,
				repairCharacters: 0,
				reason: `Finalizer 与 Challenger 独立一致。Finalizer: ${finalizer.reason}\nChallenger: ${challenger.reason}`,
			});
		}

		if (challenger.disputedBlockIds.length === 0) {
			return unresolvedResult({
				options,
				budget,
				startedAt,
				context,
				finalizer,
				challenger,
				repair: null,
				challengerCharacters: challengerEvidence.characterCount,
				repairCharacters: 0,
				reason: "双判断未形成可发布一致结论，且 Challenger 没有给出可定向修复的 disputed_ranges。",
			});
		}

		const repairEvidence = buildRepairEvidence(context, finalizer, challenger);
		if (repairEvidence.characterCount > MAX_REPAIR_CONTEXT_CHARACTERS) {
			return unresolvedResult({
				options,
				budget,
				startedAt,
				context,
				finalizer,
				challenger,
				repair: null,
				challengerCharacters: challengerEvidence.characterCount,
				repairCharacters: repairEvidence.characterCount,
				reason: `分歧证据为 ${repairEvidence.characterCount} 字符，超过单次 targeted repair 上限 ${MAX_REPAIR_CONTEXT_CHARACTERS}；不扩大调用或发布不安全范围。`,
			});
		}
		let repair: SparseRepairDecision;
		try {
			repair = await runStructuredDecision({
				role: "repair",
				systemPrompt: options.prompts.repair,
				userPrompt: repairUserPrompt(options, context, repairEvidence, finalizer, challenger),
				toolName: "submit_score_review_repair",
				toolLabel: "Submit score review repair",
				toolDescription: "Submit the one targeted disagreement repair. This is the only terminal path.",
				schema: RepairDecisionSchema,
				parse: (raw) => normalizeRepair(raw, options, context, repairEvidence, finalizer, challenger),
				maxTokens: REPAIR_MAX_TOKENS,
				options,
				budget,
				signal,
			});
		} catch (error) {
			if (!(error instanceof SparseReviewContractError)) throw error;
			return unresolvedResult({
				options,
				budget,
				startedAt,
				context,
				finalizer,
				challenger,
				repair: null,
				challengerCharacters: challengerEvidence.characterCount,
				repairCharacters: repairEvidence.characterCount,
				reason: `一次 targeted repair 暴露了未被 Challenger 完整声明的分歧，按 fail-closed 返回 needs_review：${error.message}`,
			});
		}
		if (repair.decision === "resolved") {
			return completedResult({
				options,
				budget,
				startedAt,
				context,
				resolution: "targeted_repair",
				finalBlockIds: repair.finalBlockIds,
				finalizer,
				challenger,
				repair,
				challengerCharacters: challengerEvidence.characterCount,
				repairCharacters: repairEvidence.characterCount,
				reason: `一次 targeted repair 已闭合双判断分歧。${repair.reason}`,
			});
		}
		return unresolvedResult({
			options,
			budget,
			startedAt,
			context,
			finalizer,
			challenger,
			repair,
			challengerCharacters: challengerEvidence.characterCount,
			repairCharacters: repairEvidence.characterCount,
			reason: `一次 targeted repair 后仍未闭合：${repair.reason}`,
		});
	} finally {
		clearTimeout(timeout);
	}
}

interface StructuredDecisionOptions<TSchemaType extends TSchema, TResult> {
	role: SparseReviewRole;
	systemPrompt: string;
	userPrompt: string;
	toolName: string;
	toolLabel: string;
	toolDescription: string;
	schema: TSchemaType;
	parse: (value: Static<TSchemaType>) => TResult;
	maxTokens: number;
	options: RunSparseScoreReviewOptions;
	budget: SparseReviewBudget;
	signal: AbortSignal;
}

async function runStructuredDecision<TSchemaType extends TSchema, TResult>(
	input: StructuredDecisionOptions<TSchemaType, TResult>,
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
				const errors = Value.Errors(input.schema, args)
					.slice(0, 8)
					.map((error) => `${error.instancePath || "/"}: ${error.message}`);
				contractError = `strict schema mismatch: ${errors.join("; ")}`;
				throw new Error(contractError);
			}
			return args as Static<TSchemaType>;
		},
		async execute(_toolCallId, params) {
			try {
				parsed = input.parse(params);
				return toolResult({ ok: true, status: "accepted" }, true);
			} catch (error) {
				contractError = errorMessage(error);
				throw error;
			}
		},
	};
	const messages = await runAgentLoop(
		userMessage(input.userPrompt),
		{
			systemPrompt: `${input.systemPrompt.trim()}\n\n运行时 structured-output 契约：只调用唯一工具 ${input.toolName}；不得输出自由文本，也没有重试轮次。`,
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
			convertToLlm: convertAgentMessages,
			shouldStopAfterTurn: () => true,
		},
		(event) => {
			if (event.type !== "turn_end" || event.message.role !== "assistant") return;
			input.budget.recordUsage(input.role, event.message.usage);
			input.options.onProgress?.({ status: "running", role: input.role, turn: 1 });
		},
		input.signal,
		budgetedStreamFunction(input.options.streamFunction, input.budget, input.role),
	);
	input.budget.throwIfExceeded();
	if (parsed !== null) return parsed;
	const last = lastAssistant(messages);
	if (last?.stopReason === "error") {
		throw new Error(`${input.role} provider failed: ${last.errorMessage ?? "unknown error"}`);
	}
	throw new SparseReviewContractError(
		`${input.role} structured decision failed in its single allowed call: ${contractError ?? "terminal tool not accepted"}`,
	);
}

function normalizeFinalizer(
	raw: RawFinalizerDecision,
	options: RunSparseScoreReviewOptions,
	context: SparseReviewContext,
): SparseFinalizerDecision {
	validateEnvelope(raw, options, context);
	const final = parseStrictRanges(raw.final_ranges, context.availableBlockIds);
	return {
		outcome: raw.outcome,
		finalRanges: final.ranges,
		finalBlockIds: final.blockIds,
		scopeWitnesses: validateScopeWitnesses(raw.scope_witnesses, final.blockIds, context),
		evidenceQuotes: validateEvidenceQuotes(raw.evidence_quotes, context),
		reason: raw.reason.trim(),
	};
}

function normalizeChallenger(
	raw: RawChallengerDecision,
	options: RunSparseScoreReviewOptions,
	context: SparseReviewContext,
	finalizer: SparseFinalizerDecision,
): SparseChallengerDecision {
	validateEnvelope(raw, options, context);
	const recommended = parseStrictRanges(raw.recommended_ranges, context.availableBlockIds);
	const disputed = parseStrictRanges(raw.disputed_ranges, context.availableBlockIds);
	const changed = symmetricDifference(finalizer.finalBlockIds, recommended.blockIds);
	const disputedSet = new Set(disputed.blockIds);
	if (changed.some((blockId) => !disputedSet.has(blockId))) {
		throw new Error("Challenger disputed_ranges must cover every difference from Finalizer ranges");
	}
	if (raw.decision === "agree") {
		if (!sameBlockIds(finalizer.finalBlockIds, recommended.blockIds)) {
			throw new Error("Challenger agree requires the exact Finalizer ranges");
		}
		if (disputed.blockIds.length > 0) {
			throw new Error("Challenger agree forbids disputed_ranges");
		}
	} else if (disputed.blockIds.length === 0) {
		throw new Error("Challenger challenge or needs_review requires a non-empty disagreement scope");
	}
	return {
		decision: raw.decision,
		recommendedRanges: recommended.ranges,
		recommendedBlockIds: recommended.blockIds,
		disputedRanges: disputed.ranges,
		disputedBlockIds: disputed.blockIds,
		scopeWitnesses: validateScopeWitnesses(raw.scope_witnesses, recommended.blockIds, context),
		evidenceQuotes: validateEvidenceQuotes(raw.evidence_quotes, context),
		reason: raw.reason.trim(),
	};
}

function normalizeRepair(
	raw: RawRepairDecision,
	options: RunSparseScoreReviewOptions,
	context: SparseReviewContext,
	evidence: SparseEvidenceSlice,
	finalizer: SparseFinalizerDecision,
	challenger: SparseChallengerDecision,
): SparseRepairDecision {
	validateEnvelope(raw, options, context);
	const final = parseStrictRanges(raw.final_ranges, context.availableBlockIds);
	const changedFromMain = symmetricDifference(finalizer.finalBlockIds, final.blockIds);
	const disputed = new Set(challenger.disputedBlockIds);
	const outsideDisagreement = changedFromMain.filter((blockId) => !disputed.has(blockId));
	if (outsideDisagreement.length > 0) {
		throw new Error(
			`targeted repair may change Finalizer membership only inside disputed_ranges; outside=${compactBlockRanges(outsideDisagreement).join(", ")}`,
		);
	}
	const evidenceBlockIds = new Set(evidence.blockIds);
	const evidenceQuotes = validateEvidenceQuotes(raw.evidence_quotes, context);
	if (evidenceQuotes.some((quote) => !evidenceBlockIds.has(quote.blockId))) {
		throw new Error("targeted repair cited source outside its injected disagreement evidence");
	}
	return {
		decision: raw.decision,
		finalRanges: final.ranges,
		finalBlockIds: final.blockIds,
		scopeWitnesses: validateScopeWitnesses(raw.scope_witnesses, final.blockIds, context),
		evidenceQuotes,
		reason: raw.reason.trim(),
	};
}

function validateEnvelope(
	raw: { packet_sha256: string; source_sha256: string; context_sha256: string },
	options: RunSparseScoreReviewOptions,
	context: SparseReviewContext,
): void {
	if (raw.packet_sha256 !== options.packetSha256) throw new Error("packet_sha256 echo mismatch");
	if (raw.source_sha256 !== options.packet.sourceSha256) throw new Error("source_sha256 echo mismatch");
	if (raw.context_sha256 !== context.sha256) throw new Error("context_sha256 echo mismatch");
}

function validateEvidenceQuotes(
	rawQuotes: readonly { block_id: number; quote: string }[],
	context: SparseReviewContext,
): SparseEvidenceQuote[] {
	return rawQuotes.map((raw) => {
		const source = context.blocksById.get(raw.block_id)?.sourceText;
		if (source === undefined) throw new Error(`evidence quote references missing block ${raw.block_id}`);
		const quote = anchorEvidenceQuote(source, raw.quote);
		if (!quote) {
			throw new Error(
				`evidence quote cannot be anchored to exact source from block ${raw.block_id}: ${JSON.stringify(raw.quote)}`,
			);
		}
		return { blockId: raw.block_id, quote };
	});
}

function validateScopeWitnesses(
	rawWitnesses: readonly { range: string; leaf_block_id: number; leaf_quote: string }[],
	finalBlockIds: readonly number[],
	context: SparseReviewContext,
): SparseScopeWitness[] {
	const expectedRanges = compactBlockRanges(finalBlockIds);
	if (rawWitnesses.length !== expectedRanges.length) {
		throw new Error("scope_witnesses must contain exactly one direct-leaf witness per final range");
	}
	return rawWitnesses.map((raw, index) => {
		const parsedRange = parseStrictRanges([raw.range], context.availableBlockIds);
		const expectedRange = expectedRanges[index];
		if (parsedRange.ranges.length !== 1 || parsedRange.ranges[0] !== expectedRange) {
			throw new Error(`scope_witnesses must follow final range order; expected ${expectedRange}`);
		}
		if (!parsedRange.blockIds.includes(raw.leaf_block_id)) {
			throw new Error(`scope witness leaf block ${raw.leaf_block_id} is outside ${expectedRange}`);
		}
		const source = context.blocksById.get(raw.leaf_block_id)?.sourceText;
		if (source === undefined) throw new Error(`scope witness references missing block ${raw.leaf_block_id}`);
		const leafQuote = anchorEvidenceQuote(source, raw.leaf_quote);
		if (!leafQuote) {
			throw new Error(
				`scope witness cannot be anchored to exact source from block ${raw.leaf_block_id}: ${JSON.stringify(raw.leaf_quote)}`,
			);
		}
		return { range: expectedRange, leafBlockId: raw.leaf_block_id, leafQuote };
	});
}

function buildChallengerEvidence(
	context: SparseReviewContext,
	finalizer: SparseFinalizerDecision,
): SparseEvidenceSlice {
	const seedBlockIds = new Set<number>([
		...context.initialBlockIds,
		...finalizer.finalBlockIds,
		...context.headingBlockIds,
		...context.recallProbeBlockIds,
		...context.crossReferenceBlockIds,
		...context.crossScoreBridgeBlockIds,
		...finalizer.scopeWitnesses.map((witness) => witness.leafBlockId),
		...finalizer.evidenceQuotes.map((quote) => quote.blockId),
	]);
	const final = new Set(finalizer.finalBlockIds);
	for (const blockId of context.precisionProbeBlockIds) {
		if (final.has(blockId)) seedBlockIds.add(blockId);
	}
	for (const blockId of expandLocalEvidence(context, [...context.initialBlockIds, ...finalizer.finalBlockIds], 1)) {
		seedBlockIds.add(blockId);
	}
	return renderEvidenceSlice(context, seedBlockIds);
}

function buildRepairEvidence(
	context: SparseReviewContext,
	finalizer: SparseFinalizerDecision,
	challenger: SparseChallengerDecision,
): SparseEvidenceSlice {
	const seeds = new Set<number>([
		...challenger.disputedBlockIds,
		...finalizer.scopeWitnesses.map((witness) => witness.leafBlockId),
		...challenger.scopeWitnesses.map((witness) => witness.leafBlockId),
		...finalizer.evidenceQuotes.map((quote) => quote.blockId),
		...challenger.evidenceQuotes.map((quote) => quote.blockId),
	]);
	for (const blockId of expandLocalEvidence(context, [...seeds], 2)) seeds.add(blockId);
	const involved = new Set([...finalizer.finalBlockIds, ...challenger.recommendedBlockIds]);
	for (const blockId of context.crossReferenceBlockIds) {
		if (involved.has(blockId)) seeds.add(blockId);
	}
	return renderEvidenceSlice(context, seeds);
}

function expandLocalEvidence(
	context: SparseReviewContext,
	seedBlockIds: readonly number[],
	radius: number,
): number[] {
	const expanded = new Set(seedBlockIds.filter((blockId) => context.availableBlockIds.has(blockId)));
	for (const blockId of seedBlockIds) {
		const entry = context.blocksById.get(blockId);
		if (!entry) continue;
		const structure = entry.block.structure;
		for (const relatedId of [
			...structure.ancestorBlockIds,
			...(structure.candidateAncestorBlockIds ?? []),
			...structure.previousBlockIds,
			...structure.nextBlockIds,
			...(structure.candidateParentBlockId === undefined || structure.candidateParentBlockId === null
				? []
				: [structure.candidateParentBlockId]),
		]) {
			if (context.availableBlockIds.has(relatedId)) expanded.add(relatedId);
		}
		for (
			let position = Math.max(0, entry.position - radius);
			position <= Math.min(context.blockIdsByPosition.length - 1, entry.position + radius);
			position += 1
		) {
			expanded.add(context.blockIdsByPosition[position]);
		}
		for (let position = entry.position - 1; position >= Math.max(0, entry.position - 40); position -= 1) {
			const candidateId = context.blockIdsByPosition[position];
			const candidate = context.blocksById.get(candidateId);
			if (candidate?.block.structure.headingCandidateLevel === null) continue;
			expanded.add(candidateId);
			break;
		}
	}
	return [...expanded].sort((left, right) => left - right);
}

function renderEvidenceSlice(
	context: SparseReviewContext,
	blockIds: ReadonlySet<number>,
): SparseEvidenceSlice {
	const ordered = [...blockIds]
		.filter((blockId) => context.availableBlockIds.has(blockId))
		.sort((left, right) => left - right);
	const text = [
		`rootContextSha256=${context.sha256}`,
		`evidenceRanges=${JSON.stringify(compactBlockRanges(ordered))}`,
		"<UNTRUSTED_TARGETED_EVIDENCE>",
		...ordered.map((blockId) => context.blocksById.get(blockId)?.rendered ?? ""),
		"</UNTRUSTED_TARGETED_EVIDENCE>",
	].join("\n");
	return {
		text,
		sha256: sha256(text),
		characterCount: text.length,
		blockIds: ordered,
	};
}

function finalizerUserPrompt(options: RunSparseScoreReviewOptions, context: SparseReviewContext): string {
	return [
		"请对 accepted Locator 候选做一次主判断。",
		`packetSha256=${options.packetSha256}`,
		`sourceSha256=${options.packet.sourceSha256}`,
		`contextSha256=${context.sha256}`,
		"你可以在完整 compact source 中新增遗漏 block，也可以删除误收 block。",
		context.text,
	].join("\n");
}

function challengerUserPrompt(
	options: RunSparseScoreReviewOptions,
	context: SparseReviewContext,
	evidence: SparseEvidenceSlice,
	finalizer: SparseFinalizerDecision,
): string {
	return [
		"请对 Finalizer 结论做独立对抗性审查。Finalizer 结论只是待推翻假设。",
		`packetSha256=${options.packetSha256}`,
		`sourceSha256=${options.packet.sourceSha256}`,
		`contextSha256=${context.sha256}`,
		`targetedEvidenceSha256=${evidence.sha256}`,
		`initialRanges=${JSON.stringify(context.initialRanges)}`,
		`finalizerDecision=${JSON.stringify(finalizer)}`,
		`crossScoreBridgeProbesOutsideFinalizer=${JSON.stringify(compactBlockRanges(context.crossScoreBridgeBlockIds.filter((blockId) => !finalizer.finalBlockIds.includes(blockId))))}`,
		`precisionRiskProbesInsideFinalizer=${JSON.stringify(compactBlockRanges(context.precisionProbeBlockIds.filter((blockId) => finalizer.finalBlockIds.includes(blockId))))}`,
		"targeted evidence 由运行时从同一冻结 context 一次性索引：包含 Locator/Finalizer 范围、标题、评分与 pass/fail 探针、跨章引用探针，以及拟保留范围中的价格/程序尾部探针。探针只负责定位，不是语义结论。",
		evidence.text,
	].join("\n");
}

function repairUserPrompt(
	options: RunSparseScoreReviewOptions,
	context: SparseReviewContext,
	evidence: SparseEvidenceSlice,
	finalizer: SparseFinalizerDecision,
	challenger: SparseChallengerDecision,
): string {
	return [
		"请只裁决双判断的 disputed_ranges。Finalizer 在 disputed_ranges 之外的成员关系已锁定，不得扩大审查范围。",
		`packetSha256=${options.packetSha256}`,
		`sourceSha256=${options.packet.sourceSha256}`,
		`contextSha256=${context.sha256}`,
		`targetedEvidenceSha256=${evidence.sha256}`,
		`finalizerDecision=${JSON.stringify(finalizer)}`,
		`challengerDecision=${JSON.stringify(challenger)}`,
		`lockedMainRanges=${JSON.stringify(compactBlockRanges(finalizer.finalBlockIds.filter((blockId) => !challenger.disputedBlockIds.includes(blockId))))}`,
		"若这份局部 source 仍不足以安全裁决，必须 decision=needs_review；不得请求第四次调用。",
		evidence.text,
	].join("\n");
}

function completedResult(input: {
	options: RunSparseScoreReviewOptions;
	budget: SparseReviewBudget;
	startedAt: number;
	context: SparseReviewContext;
	resolution: "agreement" | "targeted_repair";
	finalBlockIds: readonly number[];
	finalizer: SparseFinalizerDecision;
	challenger: SparseChallengerDecision;
	repair: SparseRepairDecision | null;
	challengerCharacters: number;
	repairCharacters: number;
	reason: string;
}): SparseReviewResult {
	input.budget.throwIfExceeded();
	const finalBlockIds = [...input.finalBlockIds].sort((left, right) => left - right);
	const finalRanges = compactBlockRanges(finalBlockIds);
	const patch = aggregatePatch(input.context.initialBlockIds, finalBlockIds, input.reason);
	return {
		schemaVersion: "xique.score-review.sparse-result.v1",
		contractVersion: "score-extraction-reviewer.sparse.v1",
		packetSha256: input.options.packetSha256,
		sourceName: input.options.packet.sourceName,
		sourceSha256: input.options.packet.sourceSha256,
		outputField: input.options.packet.outputField,
		status: "complete",
		resolution: input.resolution,
		reason: input.reason,
		initialRanges: input.context.initialRanges,
		finalRanges,
		finalBlockIds,
		patch,
		decisions: {
			finalizer: input.finalizer,
			challenger: input.challenger,
			repair: input.repair,
		},
		context: contextResult(
			input.context,
			input.challengerCharacters,
			input.repairCharacters,
		),
		prompts: input.options.prompts.hashes,
		model: { provider: input.options.model.provider, id: input.options.model.id },
		budget: input.budget.snapshot(),
		latencyMs: Date.now() - input.startedAt,
	};
}

function unresolvedResult(input: {
	options: RunSparseScoreReviewOptions;
	budget: SparseReviewBudget;
	startedAt: number;
	context: SparseReviewContext;
	finalizer: SparseFinalizerDecision | null;
	challenger: SparseChallengerDecision | null;
	repair: SparseRepairDecision | null;
	challengerCharacters: number;
	repairCharacters: number;
	reason: string;
}): SparseReviewResult {
	return {
		schemaVersion: "xique.score-review.sparse-result.v1",
		contractVersion: "score-extraction-reviewer.sparse.v1",
		packetSha256: input.options.packetSha256,
		sourceName: input.options.packet.sourceName,
		sourceSha256: input.options.packet.sourceSha256,
		outputField: input.options.packet.outputField,
		status: "needs_review",
		resolution: "unresolved",
		reason: input.reason,
		initialRanges: input.context.initialRanges,
		finalRanges: null,
		finalBlockIds: null,
		patch: null,
		decisions: {
			finalizer: input.finalizer,
			challenger: input.challenger,
			repair: input.repair,
		},
		context: contextResult(
			input.context,
			input.challengerCharacters,
			input.repairCharacters,
		),
		prompts: input.options.prompts.hashes,
		model: { provider: input.options.model.provider, id: input.options.model.id },
		budget: input.budget.snapshot(),
		latencyMs: Date.now() - input.startedAt,
	};
}

function locatorNullResult(
	options: RunSparseScoreReviewOptions,
	budget: SparseReviewBudget,
	startedAt: number,
): SparseReviewResult {
	const contextHash = sha256(
		JSON.stringify({
			packetSha256: options.packetSha256,
			sourceSha256: options.packet.sourceSha256,
			locatorContext: options.packet.locatorContext,
		}),
	);
	return {
		schemaVersion: "xique.score-review.sparse-result.v1",
		contractVersion: "score-extraction-reviewer.sparse.v1",
		packetSha256: options.packetSha256,
		sourceName: options.packet.sourceName,
		sourceSha256: options.packet.sourceSha256,
		outputField: options.packet.outputField,
		status: "complete",
		resolution: "locator_null",
		reason: "窗口化 accepted Locator 已完整覆盖 source 且返回 null；post-Locator 双判断不重复扫描全文。",
		initialRanges: [],
		finalRanges: [],
		finalBlockIds: [],
		patch: null,
		decisions: { finalizer: null, challenger: null, repair: null },
		context: {
			buildCount: 0,
			coverage: "locator_null",
			sha256: contextHash,
			characters: 0,
			sourceCharacters: 0,
			blockCount: options.packet.blocks.length,
			challengerCharacters: 0,
			repairCharacters: 0,
		},
		prompts: options.prompts.hashes,
		model: { provider: options.model.provider, id: options.model.id },
		budget: budget.snapshot(),
		latencyMs: Date.now() - startedAt,
	};
}

function contextResult(
	context: SparseReviewContext,
	challengerCharacters: number,
	repairCharacters: number,
): SparseReviewResult["context"] {
	return {
		buildCount: 1,
		coverage: "full_source",
		sha256: context.sha256,
		characters: context.characterCount,
		sourceCharacters: context.sourceCharacterCount,
		blockCount: context.blockIdsByPosition.length,
		challengerCharacters,
		repairCharacters,
	};
}

function aggregatePatch(
	initialBlockIds: readonly number[],
	finalBlockIds: readonly number[],
	reason: string,
): ReviewPatch | null {
	const initial = new Set(initialBlockIds);
	const final = new Set(finalBlockIds);
	const addedBlockIds = finalBlockIds.filter((blockId) => !initial.has(blockId));
	const removedBlockIds = initialBlockIds.filter((blockId) => !final.has(blockId));
	if (addedBlockIds.length === 0 && removedBlockIds.length === 0) return null;
	return {
		missingRanges: compactBlockRanges(addedBlockIds),
		removeRanges: compactBlockRanges(removedBlockIds),
		addedBlockIds,
		removedBlockIds,
		reason,
	};
}

function renderContextBlock(block: SparseBlock, sourceText: string, selected: boolean): string {
	const flags = [
		selected ? "S" : "",
		block.kind === "table" ? "T" : "",
		block.structure.headingCandidateLevel === null
			? ""
			: `H${block.structure.headingCandidateLevel}`,
		block.structure.candidateParentBlockId === undefined || block.structure.candidateParentBlockId === null
			? ""
			: `P${block.structure.candidateParentBlockId}`,
		block.structure.sequenceGroupStartBlockId === undefined ||
		block.structure.sequenceGroupStartBlockId === null
			? ""
			: `G${block.structure.sequenceGroupStartBlockId}`,
		block.structure.ancestorBlockIds.length === 0
			? ""
			: `A${block.structure.ancestorBlockIds.slice(-3).join(">")}`,
	].filter(Boolean);
	const prefix = `段落${block.blockId}|${flags.join(",") || "-"}`;
	if (!sourceText.includes("<table>") && sourceText.length <= 1_200) {
		return `${prefix}|${normalizePromptText(sourceText) || "(empty)"}`;
	}
	return [
		`${prefix}|BEGIN`,
		...sourceFragments(sourceText).map((fragment, index) => `段落${block.blockId}#${index + 1}|${fragment}`),
		`段落${block.blockId}|END`,
	].join("\n");
}

function blockSourceText(block: SparseBlock): string {
	if (block.text.trim()) return block.text.trim();
	return (block.rows ?? []).map((row) => row.filter(Boolean).join(" | ")).filter(Boolean).join("\n");
}

function sourceFragments(value: string): string[] {
	const fragments: string[] = [];
	for (const rawPart of value.split(/[\t\r\n]+/u).map(normalizePromptText).filter(Boolean)) {
		for (let offset = 0; offset < rawPart.length; offset += SOURCE_FRAGMENT_CHARACTERS) {
			fragments.push(rawPart.slice(offset, offset + SOURCE_FRAGMENT_CHARACTERS));
		}
	}
	return fragments.length > 0 ? fragments : ["(empty)"];
}

function normalizePromptText(value: string): string {
	return value.split(/\s+/u).filter(Boolean).join(" ").trim();
}

function anchorEvidenceQuote(source: string, proposedQuote: string): string | null {
	const normalizedSource = normalizeEvidenceText(source);
	const normalizedQuote = normalizeEvidenceText(proposedQuote);
	if (normalizedQuote.text.length < 2) return null;
	const directStart = normalizedSource.text.indexOf(normalizedQuote.text);
	if (directStart >= 0) {
		return originalSourceSlice(source, normalizedSource.sourceIndexes, directStart, normalizedQuote.text.length);
	}
	const proposedSegments = proposedQuote
		.split(/[\s,，、;；:：|/]+/u)
		.map((segment) => normalizeEvidenceText(segment).text)
		.filter((segment) => segment.length >= 4)
		.sort((left, right) => right.length - left.length);
	for (const segment of proposedSegments) {
		const sourceStart = normalizedSource.text.indexOf(segment);
		if (sourceStart < 0) continue;
		return originalSourceSlice(source, normalizedSource.sourceIndexes, sourceStart, segment.length);
	}

	const maximumAnchorLength = Math.min(80, normalizedQuote.text.length);
	for (let length = maximumAnchorLength; length >= 8; length -= 1) {
		for (let start = 0; start + length <= normalizedQuote.text.length; start += 1) {
			const candidate = normalizedQuote.text.slice(start, start + length);
			const sourceStart = normalizedSource.text.indexOf(candidate);
			if (sourceStart < 0) continue;
			return originalSourceSlice(source, normalizedSource.sourceIndexes, sourceStart, length);
		}
	}
	return null;
}

function normalizeEvidenceText(value: string): { text: string; sourceIndexes: number[] } {
	let text = "";
	const sourceIndexes: number[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (/^[\s\p{P}\p{S}]$/u.test(character)) continue;
		text += character;
		sourceIndexes.push(index);
	}
	return { text, sourceIndexes };
}

function originalSourceSlice(
	source: string,
	sourceIndexes: readonly number[],
	start: number,
	length: number,
): string {
	const firstIndex = sourceIndexes[start];
	const lastIndex = sourceIndexes[start + length - 1];
	return source.slice(firstIndex, lastIndex + 1);
}

function requireLocatorContext(packet: ScoreReviewPacket): ScoreReviewLocatorContext {
	if (!packet.locatorContext) {
		throw new Error("sparse dual-review packet requires explicit locatorContext outcome and coverage");
	}
	return packet.locatorContext;
}

function isAcceptedWindowedLocatorNull(locatorContext: ScoreReviewLocatorContext): boolean {
	return (
		locatorContext.mode === "windowed_accepted_prompt" &&
		locatorContext.outcome === "null" &&
		locatorContext.completeSourceCoverage
	);
}

function budgetedStreamFunction(
	inner: StreamFn,
	budget: SparseReviewBudget,
	role: SparseReviewRole,
): StreamFn {
	return (model, context, options) => {
		budget.reserveProviderCall(role);
		return inner(model, context, options);
	};
}

function userMessage(text: string): Message[] {
	return [
		{
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		},
	];
}

function convertAgentMessages(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message): message is Message =>
			typeof message === "object" &&
			message !== null &&
			"role" in message &&
			(message.role === "user" || message.role === "assistant" || message.role === "toolResult"),
	);
}

function lastAssistant(messages: readonly AgentMessage[]): AssistantMessage | undefined {
	return [...messages]
		.reverse()
		.find((message): message is AssistantMessage => message.role === "assistant");
}

function toolResult(payload: Record<string, unknown>, terminate = false): AgentToolResult<Record<string, unknown>> {
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
		details: payload,
		terminate,
	};
}

function symmetricDifference(left: readonly number[], right: readonly number[]): number[] {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	return [
		...left.filter((blockId) => !rightSet.has(blockId)),
		...right.filter((blockId) => !leftSet.has(blockId)),
	].sort((leftBlockId, rightBlockId) => leftBlockId - rightBlockId);
}

function sameBlockIds(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((blockId, index) => blockId === right[index]);
}

function emptyRoleUsage(): SparseRoleUsage {
	return {
		providerCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
	};
}

function boundedLimit(defaultValue: number, override: number | undefined): number {
	return override === undefined ? defaultValue : Math.max(0, Math.min(defaultValue, override));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
