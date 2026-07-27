import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type AssistantMessage,
	type Context,
	type Model,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { parseScoreReviewPacket, type ScoreReviewPacket } from "./reviewer.ts";
import {
	buildSparseReviewContext,
	loadSparseReviewPrompts,
	runSparseScoreReview,
	SparseReviewBudgetExceededError,
	SparseReviewContractError,
	type SparseReviewRole,
} from "./sparse.ts";

const prompts = await loadSparseReviewPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const packetSha256 = "b".repeat(64);
const reviewerModel: Model<"openai-completions"> = {
	id: "doubao-seed-2-0-lite-260428",
	name: "Sparse Reviewer Faux",
	api: "openai-completions",
	provider: "sparse-reviewer-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};

interface CapturedCall {
	role: SparseReviewRole;
	toolNames: string[];
	messageRoles: string[];
	userPrompt: string;
}

function packet(initialRanges: string[] = ["段落0-段落3"]): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "sparse-review.docx",
		sourceSha256: "a".repeat(64),
		blockCount: 5,
		initialRanges,
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: initialRanges.length > 0 ? "ranges" : "null",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: null,
		blocks: [
			block(0, "第三章 评标办法", true),
			block(1, "评标委员会根据实施方案完整性评分，满分10分。"),
			block(2, "售后服务响应时限：8小时内得5分。"),
			block(3, "投标报价按最低价法计算价格得分。"),
			block(4, "第四章 合同履约考核", true),
		],
	});
}

function longPacket(): ScoreReviewPacket {
	const blocks = Array.from({ length: 2_050 }, (_, blockId) =>
		block(
			blockId,
			blockId === 100
				? "技术方案完整性评分，满分10分。"
				: `UNRELATED-${blockId} 普通采购说明。`,
			blockId % 500 === 0,
		),
	);
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "long-review.docx",
		sourceSha256: "c".repeat(64),
		blockCount: blocks.length,
		initialRanges: ["段落100"],
		locatorContext: {
			mode: "windowed_accepted_prompt",
			outcome: "ranges",
			completeSourceCoverage: true,
			windowCount: 3,
		},
		reviewContext: null,
		blocks,
	});
}

function block(blockId: number, text: string, heading = false) {
	return {
		blockId,
		kind: "paragraph" as const,
		text,
		structure: {
			styleId: "",
			styleName: heading ? "标题 1" : "",
			outlineLevel: null,
			numberingId: null,
			numberingLevel: null,
			headingCandidateLevel: heading ? 1 : null,
			headingCandidateSource: heading ? "style_name" : "none",
			tocLevel: null,
			ancestorBlockIds: [],
			previousBlockIds: blockId > 0 ? [blockId - 1] : [],
			nextBlockIds: [],
			textMarkerKind: "none",
			textMarkerToken: "",
			sequenceGroupStartBlockId: null,
			candidateParentBlockId: null,
			candidateAncestorBlockIds: [],
		},
	};
}

function envelope(sourcePacket: ScoreReviewPacket) {
	const context = buildSparseReviewContext(sourcePacket);
	return {
		packet_sha256: packetSha256,
		source_sha256: sourcePacket.sourceSha256,
		context_sha256: context.sha256,
	};
}

function tool(name: string, args: Record<string, unknown>, id: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function withInputUsage(message: AssistantMessage, input: number): AssistantMessage {
	return {
		...message,
		usage: {
			...message.usage,
			input,
			totalTokens: input + message.usage.output,
		},
	};
}

function scriptedStream(responses: readonly AssistantMessage[]) {
	let responseIndex = 0;
	const calls: CapturedCall[] = [];
	const streamFunction: StreamFn = (_model, context) => {
		const response = responses[responseIndex++];
		if (!response) throw new Error("scripted sparse response exhausted");
		const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
		const calledTool = response.content.find((content) => content.type === "toolCall");
		if (calledTool?.type === "toolCall" && !toolNames.includes(calledTool.name)) {
			throw new Error(`script called unavailable tool ${calledTool.name}`);
		}
		calls.push({
			role: roleFromContext(context),
			toolNames,
			messageRoles: context.messages.map((message) => message.role),
			userPrompt: context.messages
				.filter((message) => message.role === "user")
				.flatMap((message) => message.content)
				.filter((content) => content.type === "text")
				.map((content) => content.text)
				.join("\n"),
		});
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			stream.push({ type: "start", partial: response });
			stream.push({ type: "done", reason: "toolUse", message: response });
		});
		return stream;
	};
	return { streamFunction, calls, responseCount: () => responseIndex };
}

function roleFromContext(context: Context): SparseReviewRole {
	const systemPrompt = context.systemPrompt ?? "";
	if (systemPrompt.includes("对抗性判断 Challenger")) return "challenger";
	if (systemPrompt.includes("唯一一次定向修复裁决者")) return "repair";
	return "finalizer";
}

async function run(
	responses: readonly AssistantMessage[],
	sourcePacket = packet(),
	budgetLimits?: Parameters<typeof runSparseScoreReview>[0]["budgetLimits"],
) {
	const scripted = scriptedStream(responses);
	const result = await runSparseScoreReview({
		packet: sourcePacket,
		packetSha256,
		prompts,
		model: reviewerModel,
		streamFunction: scripted.streamFunction,
		apiKey: "faux-key",
		budgetLimits,
	});
	return { result, ...scripted };
}

describe("sparse dual-review score extraction capability", () => {
	it("publishes clean agreement in exactly two fresh model calls", async () => {
		const sourcePacket = packet();
		const hashes = envelope(sourcePacket);
		const { result, calls, responseCount } = await run(
			[
				tool(
					"submit_score_review_finalizer",
					{
						...hashes,
						outcome: "publish",
						final_ranges: ["段落0-段落2"],
						scope_witnesses: [
							{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "实施方案完整性评分" },
						],
						evidence_quotes: [{ block_id: 1, quote: "实施方案完整性评分，满分10分" }],
						reason: "保留技术评分组，删除独立价格块。",
					},
					"finalizer",
				),
				tool(
					"submit_score_review_challenger",
					{
						...hashes,
						decision: "agree",
						recommended_ranges: ["段落0-段落2"],
						disputed_ranges: [],
						scope_witnesses: [
							{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "实施方案完整性评分" },
						],
						evidence_quotes: [{ block_id: 3, quote: "最低价法计算价格得分" }],
						reason: "价格块可分离，未发现 recall 或 boundary 错误。",
					},
					"challenger",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(2);
		expect(result.status).toBe("complete");
		expect(result.resolution).toBe("agreement");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.budget.providerCalls).toBe(2);
		expect(result.budget.roles.repair.providerCalls).toBe(0);
		expect(calls.map((call) => call.messageRoles)).toEqual([["user"], ["user"]]);
	});

	it("uses one targeted third call when Challenger changes the range", async () => {
		const sourcePacket = packet();
		const hashes = envelope(sourcePacket);
		const { result, responseCount } = await run(
			[
				tool(
					"submit_score_review_finalizer",
					{
						...hashes,
						outcome: "publish",
						final_ranges: ["段落0-段落3"],
						scope_witnesses: [
							{ range: "段落0-段落3", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 1, quote: "满分10分" }],
						reason: "初稿保留评标办法局部范围。",
					},
					"finalizer",
				),
				tool(
					"submit_score_review_challenger",
					{
						...hashes,
						decision: "challenge",
						recommended_ranges: ["段落0-段落2"],
						disputed_ranges: ["段落3"],
						scope_witnesses: [
							{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 3, quote: "投标报价按最低价法" }],
						reason: "段落3是可分离纯价格块。",
					},
					"challenger",
				),
				tool(
					"submit_score_review_repair",
					{
						...hashes,
						decision: "resolved",
						final_ranges: ["段落0-段落2"],
						scope_witnesses: [
							{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 3, quote: "最低价法计算价格得分" }],
						reason: "分歧块只含价格评价，应删除。",
					},
					"repair",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(3);
		expect(result.status).toBe("complete");
		expect(result.resolution).toBe("targeted_repair");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.patch?.removeRanges).toEqual(["段落3"]);
		expect(result.budget.providerCalls).toBe(3);
	});

	it("returns needs_review instead of publishing unresolved disagreement", async () => {
		const sourcePacket = packet();
		const hashes = envelope(sourcePacket);
		const { result } = await run(
			[
				tool(
					"submit_score_review_finalizer",
					{
						...hashes,
						outcome: "publish",
						final_ranges: ["段落0-段落3"],
						scope_witnesses: [
							{ range: "段落0-段落3", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 1, quote: "满分10分" }],
						reason: "保留局部评标办法范围。",
					},
					"finalizer",
				),
				tool(
					"submit_score_review_challenger",
					{
						...hashes,
						decision: "needs_review",
						recommended_ranges: ["段落0-段落2"],
						disputed_ranges: ["段落3"],
						scope_witnesses: [
							{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 3, quote: "最低价法" }],
						reason: "价格块与局部标题关系仍需裁决。",
					},
					"challenger",
				),
				tool(
					"submit_score_review_repair",
					{
						...hashes,
						decision: "needs_review",
						final_ranges: ["段落0-段落3"],
						scope_witnesses: [
							{ range: "段落0-段落3", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 3, quote: "投标报价" }],
						reason: "局部证据仍不足以安全选择。",
					},
					"repair",
				),
			],
			sourcePacket,
		);

		expect(result.status).toBe("needs_review");
		expect(result.resolution).toBe("unresolved");
		expect(result.finalRanges).toBeNull();
		expect(result.finalBlockIds).toBeNull();
		expect(result.patch).toBeNull();
	});

	it("fails closed when Repair changes membership outside Challenger disputed ranges", async () => {
		const sourcePacket = packet();
		const hashes = envelope(sourcePacket);
		const { result, responseCount } = await run(
			[
				tool(
					"submit_score_review_finalizer",
					{
						...hashes,
						outcome: "publish",
						final_ranges: ["段落0-段落3"],
						scope_witnesses: [
							{ range: "段落0-段落3", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 1, quote: "满分10分" }],
						reason: "保留局部评标办法范围。",
					},
					"finalizer",
				),
				tool(
					"submit_score_review_challenger",
					{
						...hashes,
						decision: "challenge",
						recommended_ranges: ["段落0-段落2"],
						disputed_ranges: ["段落3"],
						scope_witnesses: [
							{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 3, quote: "最低价法" }],
						reason: "只声明段落3为纯价格分歧。",
					},
					"challenger",
				),
				tool(
					"submit_score_review_repair",
					{
						...hashes,
						decision: "resolved",
						final_ranges: ["段落0-段落1"],
						scope_witnesses: [
							{ range: "段落0-段落1", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 3, quote: "投标报价" }],
						reason: "错误地同时删除未声明争议的段落2。",
					},
					"repair",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(3);
		expect(result.status).toBe("needs_review");
		expect(result.resolution).toBe("unresolved");
		expect(result.finalRanges).toBeNull();
		expect(result.decisions.repair).toBeNull();
		expect(result.reason).toContain("outside=段落2");
	});

	it("builds long-document source once and gives Challenger only indexed evidence", async () => {
		const sourcePacket = longPacket();
		const hashes = envelope(sourcePacket);
		const { result, calls } = await run(
			[
				tool(
					"submit_score_review_finalizer",
					{
						...hashes,
						outcome: "publish",
						final_ranges: ["段落100"],
						scope_witnesses: [
							{ range: "段落100", leaf_block_id: 100, leaf_quote: "技术方案完整性评分" },
						],
						evidence_quotes: [{ block_id: 100, quote: "技术方案完整性评分" }],
						reason: "只保留技术评分叶子。",
					},
					"finalizer",
				),
				tool(
					"submit_score_review_challenger",
					{
						...hashes,
						decision: "agree",
						recommended_ranges: ["段落100"],
						disputed_ranges: [],
						scope_witnesses: [
							{ range: "段落100", leaf_block_id: 100, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 100, quote: "满分10分" }],
						reason: "未发现遗漏或污染。",
					},
					"challenger",
				),
			],
			sourcePacket,
		);

		expect(result.context.buildCount).toBe(1);
		expect(result.context.blockCount).toBe(2_050);
		expect(result.budget.contextCharacters).toBe(result.context.characters);
		expect(calls[0].userPrompt).toContain("UNRELATED-2049");
		expect(calls[1].userPrompt).not.toContain("UNRELATED-2049");
		expect(calls[0].userPrompt).toContain(hashes.context_sha256);
		expect(calls[1].userPrompt).toContain(hashes.context_sha256);
	});

	it("stops before a third provider call when the hard call budget is two", async () => {
		const sourcePacket = packet();
		const hashes = envelope(sourcePacket);
		const scripted = scriptedStream([
			tool(
				"submit_score_review_finalizer",
				{
					...hashes,
					outcome: "publish",
					final_ranges: ["段落0-段落3"],
					scope_witnesses: [
						{ range: "段落0-段落3", leaf_block_id: 1, leaf_quote: "满分10分" },
					],
					evidence_quotes: [{ block_id: 1, quote: "满分10分" }],
					reason: "初稿。",
				},
				"finalizer",
			),
			tool(
				"submit_score_review_challenger",
				{
					...hashes,
					decision: "challenge",
					recommended_ranges: ["段落0-段落2"],
					disputed_ranges: ["段落3"],
					scope_witnesses: [
						{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "满分10分" },
					],
					evidence_quotes: [{ block_id: 3, quote: "最低价法" }],
					reason: "删除纯价格。",
				},
				"challenger",
			),
		]);

		await expect(
			runSparseScoreReview({
				packet: sourcePacket,
				packetSha256,
				prompts,
				model: reviewerModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
				budgetLimits: { maxProviderCalls: 2 },
			}),
		).rejects.toBeInstanceOf(SparseReviewBudgetExceededError);
		expect(scripted.responseCount()).toBe(2);
	});

	it("fails closed after reported input tokens exceed the hard budget", async () => {
		const sourcePacket = packet();
		const hashes = envelope(sourcePacket);
		const scripted = scriptedStream([
			withInputUsage(
				tool(
					"submit_score_review_finalizer",
					{
						...hashes,
						outcome: "publish",
						final_ranges: ["段落0-段落2"],
						scope_witnesses: [
							{ range: "段落0-段落2", leaf_block_id: 1, leaf_quote: "满分10分" },
						],
						evidence_quotes: [{ block_id: 1, quote: "满分10分" }],
						reason: "主判断。",
					},
					"finalizer",
				),
				11,
			),
		]);

		await expect(
			runSparseScoreReview({
				packet: sourcePacket,
				packetSha256,
				prompts,
				model: reviewerModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
				budgetLimits: { maxInputTokens: 10 },
			}),
		).rejects.toBeInstanceOf(SparseReviewBudgetExceededError);
		expect(scripted.responseCount()).toBe(1);
	});

	it("rejects a published range without exactly one anchored scope witness", async () => {
		const sourcePacket = packet();
		const hashes = envelope(sourcePacket);
		await expect(
			run([
				tool(
					"submit_score_review_finalizer",
					{
						...hashes,
						outcome: "publish",
						final_ranges: ["段落0-段落2"],
						scope_witnesses: [],
						evidence_quotes: [{ block_id: 1, quote: "满分10分" }],
						reason: "缺少连续范围的直接叶子证明。",
					},
					"finalizer",
				),
			]),
		).rejects.toBeInstanceOf(SparseReviewContractError);
	});
});
