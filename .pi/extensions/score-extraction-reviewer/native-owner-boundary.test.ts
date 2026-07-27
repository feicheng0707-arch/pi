import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	loadPiNativeOwnerBoundaryPrompts,
	PiNativeOwnerBoundaryContractError,
	type PiNativeOwnerBoundaryRole,
	runPiNativeOwnerBoundaryReview,
} from "./native-owner-boundary.ts";
import { buildPiNativeEvidencePacket } from "./native.ts";
import { parseScoreReviewPacket, type ScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadPiNativeOwnerBoundaryPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const packetSha256 = "b".repeat(64);
const reviewerModel: Model<"openai-completions"> = {
	id: "doubao-seed-2-0-lite-260428",
	name: "Pi-native Owner/Boundary Faux",
	api: "openai-completions",
	provider: "pi-native-owner-boundary-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};

interface CapturedCall {
	role: PiNativeOwnerBoundaryRole;
	toolNames: string[];
	toolParameterText: string;
	systemPrompt: string;
	userPrompt: string;
}

function packet(initialRanges: string[] = ["段落0-段落2"]): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "pi-native-owner-boundary.docx",
		sourceSha256: "a".repeat(64),
		blockCount: 6,
		initialRanges,
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: initialRanges.length > 0 ? "ranges" : "null",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: { source: "hidden-from-owner" },
		blocks: [
			block(0, "第三章 评标办法", true),
			block(1, "评标委员会根据实施方案完整性评分，满分10分。"),
			block(2, "售后服务响应时限：8小时内得5分。"),
			block(3, "投标报价按最低价法计算价格得分。"),
			block(4, "第四章 合同履约考核", true),
			block(5, "另一个远端技术方案评分项，满分3分。"),
		],
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

function contexts(sourcePacket: ScoreReviewPacket) {
	return {
		owner: buildPiNativeEvidencePacket(sourcePacket, {
			exposeCandidate: false,
			exposeReviewContext: false,
			title: "# Immutable candidate-blind Owner evidence packet",
		}),
		boundary: buildPiNativeEvidencePacket(sourcePacket, {
			title: "# Immutable candidate-first Boundary evidence packet",
		}),
	};
}

function positiveOwner() {
	return {
		kind: "positive",
		controller: { block_id: 0, quote: "第三章 评标办法" },
		target: { block_id: 1, quote: "实施方案完整性" },
		effect: { block_id: 1, quote: "评分，满分10分" },
	};
}

function ownerDecision(
	ownerClaim: Record<string, unknown>,
	reason: string,
) {
	return { owner_claim: ownerClaim, reason };
}

function boundaryDecision(
	input: {
		outcome:
			| "publish_positive"
			| "publish_empty"
			| "needs_review_owner_conflict"
			| "needs_review_boundary_uncertain";
		finalRanges?: string[];
		neighborDecisions?: Array<{
			block_id: number;
			decision: "include" | "exclude";
		}>;
		evidenceBlockIds: number[];
		reason: string;
	},
) {
	return {
		outcome: input.outcome,
		...(input.finalRanges === undefined ? {} : { final_ranges: input.finalRanges }),
		...(input.neighborDecisions === undefined
			? {}
			: { neighbor_decisions: input.neighborDecisions }),
		evidence_block_ids: input.evidenceBlockIds,
		reason: input.reason,
	};
}

function tool(name: string, args: Record<string, unknown>, id: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function scriptedStream(responses: readonly AssistantMessage[]) {
	let responseIndex = 0;
	const calls: CapturedCall[] = [];
	const streamFunction: StreamFn = (_model, context) => {
		const response = responses[responseIndex++];
		if (!response) throw new Error("scripted Pi-native Owner/Boundary response exhausted");
		const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
		const calledTool = response.content.find((content) => content.type === "toolCall");
		if (calledTool?.type === "toolCall" && !toolNames.includes(calledTool.name)) {
			throw new Error(`script called unavailable tool ${calledTool.name}`);
		}
		calls.push({
			role: toolNames.includes("submit_pi_native_boundary_gate") ? "boundary" : "owner",
			toolNames,
			toolParameterText: JSON.stringify(context.tools?.[0]?.parameters ?? null),
			systemPrompt: context.systemPrompt ?? "",
			userPrompt: context.messages
				.filter((message) => message.role === "user")
				.flatMap((message) =>
					typeof message.content === "string"
						? [message.content]
						: message.content
								.filter((content) => content.type === "text")
								.map((content) => content.text),
				)
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

async function run(responses: readonly AssistantMessage[], sourcePacket = packet()) {
	const scripted = scriptedStream(responses);
	const result = await runPiNativeOwnerBoundaryReview({
		packet: sourcePacket,
		packetSha256,
		prompts,
		model: reviewerModel,
		streamFunction: scripted.streamFunction,
		apiKey: "faux-key",
	});
	return { result, ...scripted };
}

describe("Pi-native Owner/Boundary v5 score review", () => {
	it("keeps Owner candidate-blind and lets Boundary publish a protected candidate", async () => {
		const sourcePacket = packet();
		const owner = ownerDecision(positiveOwner(), "private owner rationale");
		const { result, calls, responseCount } = await run(
			[
				tool("submit_pi_native_owner_gate", owner, "owner"),
				tool(
					"submit_pi_native_boundary_gate",
					boundaryDecision({
						outcome: "publish_positive",
						finalRanges: ["段落0-段落2"],
						neighborDecisions: [
							{ block_id: 3, decision: "exclude" },
						],
						evidenceBlockIds: [3],
						reason: "Candidate 已在价格边界前闭合。",
					}),
					"boundary",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(2);
		expect(result.status).toBe("complete");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.candidatePreserved).toBe(true);
		expect(result.budget.providerCalls).toBe(2);
		expect(calls.map((call) => call.role)).toEqual(["owner", "boundary"]);
		expect(calls[0].toolParameterText).not.toContain("ranges");
		expect(calls[0].userPrompt).not.toContain("candidateRanges=");
		expect(calls[0].userPrompt).not.toContain("locatorContext=");
		expect(calls[0].userPrompt).not.toContain("hidden-from-owner");
		expect(calls[1].userPrompt).toContain('candidateRanges=["段落0-段落2"]');
		expect(calls[1].userPrompt).toContain('boundaryFocusRanges=["段落0-段落3"]');
		expect(calls[1].userPrompt).toContain("boundaryNeighborBlockIds=[3]");
		expect(calls[1].userPrompt).not.toContain("private owner rationale");
		expect(calls[1].toolParameterText).not.toContain('"quote"');
		expect(calls[1].toolParameterText).not.toContain("evidence_quotes");
		expect(calls[1].systemPrompt).toContain("编号不连续");
		expect(result.decisions.boundaryEvidenceBlocks).toEqual([
			{ blockId: 3, sourceText: "投标报价按最低价法计算价格得分。" },
		]);
		expect(prompts.hashes.candidate).toBe("7953936e9d1b0cb940977fdc6b36465b0b173f2d640c79b6a47cd18ff87a85f7");
	});

	it("lets Boundary restore a missing direct predecessor", async () => {
		const sourcePacket = packet(["段落1-段落2"]);
		const owner = ownerDecision(positiveOwner(), "Owner closed");
		const { result } = await run(
			[
				tool("submit_pi_native_owner_gate", owner, "owner-add"),
				tool(
					"submit_pi_native_boundary_gate",
					boundaryDecision({
						outcome: "publish_positive",
						finalRanges: ["段落0-段落2"],
						neighborDecisions: [
							{ block_id: 0, decision: "include" },
							{ block_id: 3, decision: "exclude" },
						],
						evidenceBlockIds: [0],
						reason: "恢复缺失的直接评价标题。",
					}),
					"boundary-add",
				),
			],
			sourcePacket,
		);

		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.patch?.missingRanges).toEqual(["段落0"]);
	});

	it("publishes empty only after both roles confirm that no Owner exists", async () => {
		const sourcePacket = packet(["段落4"]);
		const owner = ownerDecision(
			{ kind: "none", evidence_quotes: [{ block_id: 4, quote: "合同履约考核" }] },
			"No bid-stage Owner",
		);
		const { result, calls } = await run(
			[
				tool("submit_pi_native_owner_gate", owner, "owner-none"),
				tool(
					"submit_pi_native_boundary_gate",
					boundaryDecision({
						outcome: "publish_empty",
						evidenceBlockIds: [4],
						reason: "确认只有签约后考核。",
					}),
					"boundary-none",
				),
			],
			sourcePacket,
		);

		expect(result.status).toBe("complete");
		expect(result.finalRanges).toEqual([]);
		expect(result.patch?.removeRanges).toEqual(["段落4"]);
		expect(result.decisions.boundaryFocusRanges).toEqual([]);
		expect(result.decisions.boundaryNeighborBlockIds).toEqual([]);
		expect(calls[1].userPrompt).toContain("boundaryMode=owner_none_confirmation");
		expect(calls[1].userPrompt).not.toContain("candidateRanges=");
		expect(calls[1].userPrompt).not.toContain("boundaryFocusRanges=");
		expect(calls[1].userPrompt).not.toContain("boundaryNeighborBlockIds=");
		expect(calls[1].userPrompt).not.toContain("locatorContext=");
		expect(calls[1].userPrompt).not.toContain("hidden-from-owner");
		expect(calls[1].userPrompt).toContain("另一个远端技术方案评分项");
		expect(calls[1].toolParameterText).not.toContain("final_ranges");
		expect(calls[1].toolParameterText).not.toContain("neighbor_decisions");
	});

	it("fails closed after one call when Owner is uncertain", async () => {
		const sourcePacket = packet();
		const owner = ownerDecision(
			{ kind: "uncertain", evidence_quotes: [{ block_id: 0, quote: "第三章 评标办法" }] },
			"Source role cannot be closed",
		);
		const { result, responseCount } = await run(
			[tool("submit_pi_native_owner_gate", owner, "owner-uncertain")],
			sourcePacket,
		);

		expect(responseCount()).toBe(1);
		expect(result.status).toBe("needs_review");
		expect(result.resolution).toBe("owner_uncertain");
		expect(result.finalRanges).toBeNull();
		expect(result.budget.roles.boundary.providerCalls).toBe(0);
	});

	it("decouples Owner evidence location from the published range", async () => {
		const sourcePacket = packet(["段落1-段落2"]);
		const owner = ownerDecision(positiveOwner(), "Owner title is outside final leaf range");
		const { result } = await run(
			[
				tool("submit_pi_native_owner_gate", owner, "owner-outside"),
				tool(
					"submit_pi_native_boundary_gate",
					boundaryDecision({
						outcome: "publish_positive",
						finalRanges: ["段落1-段落2"],
						neighborDecisions: [
							{ block_id: 0, decision: "exclude" },
							{ block_id: 3, decision: "exclude" },
						],
						evidenceBlockIds: [3],
						reason: "Owner evidence need not be selected output.",
					}),
					"boundary-outside",
				),
			],
			sourcePacket,
		);

		expect(result.finalRanges).toEqual(["段落1-段落2"]);
	});

	it("treats direct neighbors as reading focus rather than a hard range envelope", async () => {
		const sourcePacket = packet(["段落0"]);
		const ownerClaim = {
			kind: "positive",
			controller: { block_id: 5, quote: "远端技术方案评分项" },
			target: { block_id: 5, quote: "技术方案" },
			effect: { block_id: 5, quote: "满分3分" },
		};
		const owner = ownerDecision(ownerClaim, "Distant evaluator exists");
		const { result } = await run(
			[
				tool("submit_pi_native_owner_gate", owner, "owner-distant"),
				tool(
					"submit_pi_native_boundary_gate",
					boundaryDecision({
						outcome: "publish_positive",
						finalRanges: ["段落5"],
						neighborDecisions: [
							{ block_id: 1, decision: "exclude" },
						],
						evidenceBlockIds: [5],
						reason: "完整 source 中存在远端评分容器。",
					}),
					"boundary-distant",
				),
			],
			sourcePacket,
		);

		expect(result.decisions.boundaryFocusRanges).toEqual(["段落0-段落1"]);
		expect(result.finalRanges).toEqual(["段落5"]);
	});

	it("returns needs_review instead of choosing between conflicting Owner judgments", async () => {
		const sourcePacket = packet();
		const owner = ownerDecision(positiveOwner(), "Owner closed");
		const { result } = await run(
			[
				tool("submit_pi_native_owner_gate", owner, "owner-conflict"),
				tool(
					"submit_pi_native_boundary_gate",
					boundaryDecision({
						outcome: "needs_review_owner_conflict",
						finalRanges: [],
						neighborDecisions: [
							{ block_id: 3, decision: "exclude" },
						],
						evidenceBlockIds: [4],
						reason: "Boundary disagrees with the Owner claim.",
					}),
					"boundary-conflict",
				),
			],
			sourcePacket,
		);

		expect(result.status).toBe("needs_review");
		expect(result.finalRanges).toBeNull();
		expect(result.budget.providerCalls).toBe(2);
	});

	it("rejects a wrong-block Owner quote without a retry", async () => {
		const sourcePacket = packet();
		const badOwner = ownerDecision(
			{
				...positiveOwner(),
				controller: { block_id: 0, quote: "实施方案完整性" },
			},
			"wrong quote",
		);
		const scripted = scriptedStream([tool("submit_pi_native_owner_gate", badOwner, "owner-wrong")]);

		await expect(
			runPiNativeOwnerBoundaryReview({
				packet: sourcePacket,
				packetSha256,
				prompts,
				model: reviewerModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
			}),
		).rejects.toBeInstanceOf(PiNativeOwnerBoundaryContractError);
		expect(scripted.responseCount()).toBe(1);
	});

	it("keeps an Owner-none conflict candidate-blind and fails closed", async () => {
		const sourcePacket = packet(["段落4"]);
		const owner = ownerDecision(
			{ kind: "none", evidence_quotes: [{ block_id: 4, quote: "合同履约考核" }] },
			"No bid-stage Owner",
		);
		const { result, calls } = await run(
			[
				tool("submit_pi_native_owner_gate", owner, "owner-none-conflict"),
				tool(
					"submit_pi_native_boundary_gate",
					boundaryDecision({
						outcome: "needs_review_owner_conflict",
						evidenceBlockIds: [5],
						reason: "完整 source 中仍存在有效评价 Owner。",
					}),
					"boundary-none-conflict",
				),
			],
			sourcePacket,
		);

		expect(result.status).toBe("needs_review");
		expect(result.finalRanges).toBeNull();
		expect(result.budget.providerCalls).toBe(2);
		expect(calls[1].userPrompt).not.toContain("candidateRanges=");
		expect(result.decisions.boundaryEvidenceBlocks).toEqual([
			{ blockId: 5, sourceText: "另一个远端技术方案评分项，满分3分。" },
		]);
	});

	it("rejects an unknown Boundary evidence block without a third call", async () => {
		const sourcePacket = packet();
		const owner = ownerDecision(positiveOwner(), "Owner closed");
		const scripted = scriptedStream([
			tool("submit_pi_native_owner_gate", owner, "owner-before-bad-evidence"),
			tool(
				"submit_pi_native_boundary_gate",
				boundaryDecision({
					outcome: "publish_positive",
					finalRanges: ["段落0-段落2"],
					neighborDecisions: [{ block_id: 3, decision: "exclude" }],
					evidenceBlockIds: [99],
					reason: "Unknown evidence ID",
				}),
				"boundary-bad-evidence",
			),
		]);

		await expect(
			runPiNativeOwnerBoundaryReview({
				packet: sourcePacket,
				packetSha256,
				prompts,
				model: reviewerModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
			}),
		).rejects.toBeInstanceOf(PiNativeOwnerBoundaryContractError);
		expect(scripted.responseCount()).toBe(2);
	});

	it("does not make a third call after an invalid Boundary submission", async () => {
		const sourcePacket = packet();
		const owner = ownerDecision(positiveOwner(), "Owner closed");
		const invalidBoundary = boundaryDecision({
			outcome: "publish_empty",
			evidenceBlockIds: [3],
			reason: "Invalid publication shape",
		});
		const scripted = scriptedStream([
			tool("submit_pi_native_owner_gate", owner, "owner-before-invalid"),
			tool("submit_pi_native_boundary_gate", invalidBoundary, "boundary-invalid"),
		]);

		await expect(
			runPiNativeOwnerBoundaryReview({
				packet: sourcePacket,
				packetSha256,
				prompts,
				model: reviewerModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
			}),
		).rejects.toBeInstanceOf(PiNativeOwnerBoundaryContractError);
		expect(scripted.responseCount()).toBe(2);
	});

	it("fails capacity preflight before any semantic call", async () => {
		const sourcePacket = parseScoreReviewPacket({
			...packet(),
			sourceName: "oversized.docx",
			blockCount: 1,
			initialRanges: [],
			locatorContext: {
				mode: "windowed_accepted_prompt",
				outcome: "null",
				completeSourceCoverage: true,
				windowCount: 1,
			},
			blocks: [block(0, "评".repeat(20_000))],
		});
		const scripted = scriptedStream([]);
		const result = await runPiNativeOwnerBoundaryReview({
			packet: sourcePacket,
			packetSha256,
			prompts,
			model: { ...reviewerModel, contextWindow: 8_000 },
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(scripted.responseCount()).toBe(0);
		expect(result.status).toBe("needs_review");
		expect(result.resolution).toBe("context_capacity");
		expect(result.context.preflight.fit).toBe(false);
		expect(result.budget.providerCalls).toBe(0);
	});
});
