import { readFile } from "node:fs/promises";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
	parseScoreReviewPacket,
	runScoreReviewLoop,
	runScoreReviewPass,
	ScoreReviewWorkspace,
	type ScoreReviewPacket,
} from "./reviewer.ts";

const reviewerContract = await readFile(
	new URL("../../skills/score-extraction-reviewer/references/reviewer-contract.md", import.meta.url),
	"utf8",
);

function packet(reviewMode: ScoreReviewPacket["reviewMode"] = "completeness"): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode,
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "review.docx",
		sourceSha256: "a".repeat(64),
		blockCount: 4,
		initialRanges: ["段落0-段落1"],
		reviewContext: { checkerSignal: null },
		blocks: [
			block(0, "第三章 评审办法", [], [1]),
			block(1, "技术方案完整性：10分。", [0], [2]),
			block(2, "售后响应时限：8小时。", [0], [3]),
			block(3, "第四章 合同条款", [], []),
		],
	});
}

function block(blockId: number, text: string, ancestorBlockIds: number[], nextBlockIds: number[]) {
	return {
		blockId,
		kind: "paragraph",
		text,
		structure: {
			styleId: "",
			styleName: blockId === 0 ? "标题 1" : "",
			outlineLevel: null,
			numberingId: null,
			numberingLevel: null,
			headingCandidateLevel: blockId === 0 ? 1 : null,
			headingCandidateSource: blockId === 0 ? "style_name" : "none",
			tocLevel: null,
			ancestorBlockIds,
			previousBlockIds: blockId > 0 ? [blockId - 1] : [],
			nextBlockIds,
		},
	};
}

function keepOnlyScoringLeafDecisions() {
	return [
		{
			blockId: 0,
			decision: "remove" as const,
			sourceQuote: "第三章 评审办法",
			supportingLeafBlockIds: [],
		},
		{
			blockId: 1,
			decision: "keep_target_leaf" as const,
			sourceQuote: "技术方案完整性：10分。",
			supportingLeafBlockIds: [],
		},
	];
}

function keepHeadingAndScoringLeafDecisions() {
	return [
		{
			blockId: 0,
			decision: "keep_local_container" as const,
			sourceQuote: "第三章 评审办法",
			supportingLeafBlockIds: [1],
		},
		{
			blockId: 1,
			decision: "keep_target_leaf" as const,
			sourceQuote: "技术方案完整性：10分。",
			supportingLeafBlockIds: [],
		},
	];
}

function keepOnlyHeadingDecisions() {
	return [
		{
			blockId: 0,
			decision: "keep_target_leaf" as const,
			sourceQuote: "第三章 评审办法",
			supportingLeafBlockIds: [],
		},
		{
			blockId: 1,
			decision: "remove" as const,
			sourceQuote: "技术方案完整性：10分。",
			supportingLeafBlockIds: [],
		},
	];
}

const fauxModel: Model<"openai-completions"> = {
	id: "score-reviewer-faux",
	name: "Score Reviewer Faux",
	api: "openai-completions",
	provider: "score-reviewer-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 8_192,
};

function scriptedStream(responses: readonly AssistantMessage[], onTools?: (toolNames: string[]) => void) {
	let responseIndex = 0;
	const streamFunction: StreamFn = (_model, context) => {
		onTools?.(context.tools?.map((tool) => tool.name) ?? []);
		const message = responses[responseIndex++];
		if (!message) throw new Error("scripted reviewer response exhausted");
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
		});
		return stream;
	};
	return { streamFunction, responseCount: () => responseIndex };
}

describe("score extraction reviewer workspace", () => {
	it("uses deterministic 400-block structure pages", () => {
		const sourcePacket = packet();
		const blocks = Array.from({ length: 401 }, (_, blockId) =>
			block(blockId, `评分证据 ${blockId}`, [], blockId < 400 ? [blockId + 1] : []),
		);
		const workspace = new ScoreReviewWorkspace(
			parseScoreReviewPacket({
				...sourcePacket,
				blockCount: blocks.length,
				initialRanges: [],
				blocks,
			}),
		);

		const firstPage = workspace.readStructureMap();
		expect(firstPage).toEqual(
			expect.objectContaining({
				complete: false,
				blockIds: expect.arrayContaining([0, 399]),
			}),
		);
		expect(workspace.mapBlockIdsRead.size).toBe(400);
		const secondPage = workspace.readStructureMap();
		expect(secondPage).toEqual(expect.objectContaining({ complete: true, blockIds: [400] }));
	});

	it("keeps evidence gaps inside the loop without consuming the patch budget", () => {
		const workspace = new ScoreReviewWorkspace(packet());
		workspace.readStructureMap();
		workspace.readBlockRanges(["段落0-段落1"]);

		const needsEvidence = workspace.applyPatch({
			missingRanges: ["段落2"],
			removeRanges: [],
			reason: "补回同一评分组方向。",
		});
		expect(needsEvidence.status).toBe("needs_more_evidence");
		expect(needsEvidence.patchCallsRemaining).toBe(1);
		expect(workspace.patchCalls).toBe(0);

		workspace.readBlockRanges(["段落2"]);
		workspace.applyPatch({
			missingRanges: ["段落2"],
			removeRanges: [],
			reason: "补回同一评分组方向。",
		});
		const needsBoundaryEvidence = workspace.requestCompletion({
			reason: "完整 map 和最终候选均已核对。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});
		expect(needsBoundaryEvidence.status).toBe("needs_more_evidence");
		expect(needsBoundaryEvidence.gaps).toContainEqual(
			expect.objectContaining({
				code: "decision_context_source_unread",
				unreadDecisionContextRanges: ["段落3"],
			}),
		);
		workspace.readBlockRanges(["段落3"]);
		const gatewayChallenge = workspace.requestCompletion({
			reason: "完整 map 和最终候选均已核对。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});
		expect(gatewayChallenge.status).toBe("needs_more_evidence");
		expect(gatewayChallenge.gaps).toContainEqual(
			expect.objectContaining({ code: "positive_gateway_challenge_required" }),
		);
		const precisionChallenge = workspace.requestCompletion({
			reason: "正向 gateway 已逐项核对。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});
		expect(precisionChallenge.gaps).toContainEqual(
			expect.objectContaining({ code: "final_precision_challenge_required" }),
		);
		const completed = workspace.requestCompletion({
			reason: "逐块 precision 复核后未发现可分离的资格、价格或程序污染。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});

		expect(completed.status).toBe("complete");
		expect(workspace.currentRanges()).toEqual(["段落0-段落2"]);
	});

	it("enforces remove-only release review", () => {
		const workspace = new ScoreReviewWorkspace(packet("release"));
		workspace.readStructureMap();
		workspace.readBlockRanges(["段落0-段落2"]);
		expect(() =>
			workspace.applyPatch({
				missingRanges: ["段落2"],
				removeRanges: [],
				reason: "发现遗漏。",
			}),
		).toThrow("remove-only");
	});

	it("challenges release deletions and retained containers before locking a patch", () => {
		const workspace = new ScoreReviewWorkspace(packet("release"));
		workspace.readStructureMap();
		workspace.readBlockRanges(["段落0-段落2"]);

		const challenge = workspace.requestCompletion({
			reason: "拟删除段落0。",
			finalRanges: ["段落1"],
			outcome: "complete",
		});

		expect(challenge.gaps).toContainEqual(
			expect.objectContaining({
				code: "release_deletion_safety_challenge_required",
				provisionalFinalRanges: ["段落1"],
				proposedRemoveRanges: ["段落0"],
			}),
		);
		expect(workspace.pendingPatch).toBeNull();

		const precisionChallenge = workspace.requestCompletion({
			reason: "逐块反证后，段落0是可分离标题，段落1是有效评分叶子。",
			finalRanges: ["段落1"],
			outcome: "complete",
		});
		expect(precisionChallenge.gaps).toContainEqual(
			expect.objectContaining({
				code: "release_retained_precision_challenge_required",
				deletionAuditedFinalRanges: ["段落1"],
			}),
		);
		expect(workspace.pendingPatch).toBeNull();

		const lockPatch = workspace.requestCompletion({
			reason: "独立 retained-precision 审计确认只保留段落1。",
			finalRanges: ["段落1"],
			blockDecisions: keepOnlyScoringLeafDecisions(),
			outcome: "complete",
		});

		expect(lockPatch.gaps).toContainEqual(
			expect.objectContaining({
				code: "candidate_patch_required",
				removeRanges: ["段落0"],
			}),
		);
		expect(workspace.pendingPatch).toEqual({ missingRanges: [], removeRanges: ["段落0"] });
	});

	it("rejects an adjacent duplicate addition without consuming the patch budget", () => {
		const sourcePacket = packet();
		const workspace = new ScoreReviewWorkspace({
			...sourcePacket,
			blocks: sourcePacket.blocks.map((sourceBlock) => {
				if (sourceBlock.blockId === 1) {
					return { ...sourceBlock, text: "技术方案完整性：10分。未列入本评分细则的其他条件不作为评分内容。" };
				}
				if (sourceBlock.blockId === 2) {
					return { ...sourceBlock, text: "未列入本评分细则的其他条件不作为评分内容。" };
				}
				return sourceBlock;
			}),
		});
		workspace.readStructureMap();
		workspace.readBlockRanges(["段落0-段落2"]);

		const rejected = workspace.applyPatch({
			missingRanges: ["段落2"],
			removeRanges: [],
			reason: "补入评分细则边界。",
		});

		expect(rejected).toEqual(
			expect.objectContaining({
				status: "patch_rejected",
				patchCallsRemaining: 1,
			}),
		);
		expect(workspace.patchCalls).toBe(0);
		expect(workspace.currentRanges()).toEqual(["段落0-段落1"]);
	});

	it("uses deterministic full-source probes before completing an empty candidate", () => {
		const sourcePacket = packet();
		const workspace = new ScoreReviewWorkspace(
			parseScoreReviewPacket({
				...sourcePacket,
				initialRanges: [],
				blocks: [
					block(0, "第三章 评审办法", [], [1]),
					block(1, "技术评分细则", [0], [2]),
					block(2, "服务方案完整得5分。", [0], [3]),
					block(3, "第四章 合同条款", [], []),
				],
			}),
		);

		workspace.readStructureMap();
		expect(workspace.stage).toBe("source_read");
		expect(workspace.decisionEvidenceBlockIds()).toEqual([0, 1, 2, 3]);

		const premature = workspace.requestCompletion({
			reason: "未发现评分内容。",
			finalRanges: [],
			outcome: "complete",
		});
		expect(premature.status).toBe("needs_more_evidence");
		expect(premature.gaps).toContainEqual(
			expect.objectContaining({
				code: "decision_context_source_unread",
				unreadDecisionContextRanges: ["段落0-段落3"],
			}),
		);

		const sourcePage = workspace.readNextRequiredSourceBlocks();
		expect(sourcePage).toEqual(
			expect.objectContaining({ complete: true, ranges: ["段落0-段落3"] }),
		);
		expect(workspace.stage).toBe("decision");
	});

	it("reads the complete small source when an empty candidate has no scoring probes", () => {
		const sourcePacket = packet();
		const workspace = new ScoreReviewWorkspace(
			parseScoreReviewPacket({
				...sourcePacket,
				initialRanges: [],
				blocks: [
					block(0, "卫生间装修改造项目邀标函", [], [1]),
					block(1, "投标确认函", [], [2]),
					block(2, "公司简介", [], [3]),
					block(3, "近三年无重大违法记录声明函", [], []),
				],
			}),
		);

		workspace.readStructureMap();
		expect(workspace.decisionEvidenceBlockIds()).toEqual([0, 1, 2, 3]);
		expect(workspace.readNextRequiredSourceBlocks()).toEqual(
			expect.objectContaining({ complete: true, blockIds: [0, 1, 2, 3] }),
		);
		expect(workspace.stage).toBe("decision");
	});

	it("returns to deterministic source read after a completion declares an unread target", () => {
		const workspace = new ScoreReviewWorkspace(packet());
		workspace.readStructureMap();
		workspace.readNextRequiredSourceBlocks();
		expect(workspace.stage).toBe("decision");

		const needsDeclaredSource = workspace.requestCompletion({
			reason: "拟扩展到新的目标与边界。",
			finalRanges: ["段落0-段落3"],
			outcome: "complete",
		});
		expect(needsDeclaredSource.gaps).toContainEqual(
			expect.objectContaining({
				code: "declared_final_context_source_unread",
				unreadDeclaredContextRanges: ["段落3"],
			}),
		);
		expect(workspace.stage).toBe("source_read");

		expect(workspace.readNextRequiredSourceBlocks()).toEqual(
			expect.objectContaining({ complete: true, blockIds: [3] }),
		);
		expect(workspace.stage).toBe("decision");
	});

	it("rejects redundant additions and removals outside the candidate", () => {
		const workspace = new ScoreReviewWorkspace(packet());
		workspace.readStructureMap();
		workspace.readBlockRanges(["段落0-段落1"]);

		const rejected = workspace.applyPatch({
			missingRanges: ["段落1"],
			removeRanges: ["段落3"],
			reason: "无效 delta。",
		});

		expect(rejected).toEqual(
			expect.objectContaining({
				status: "patch_rejected",
				patchCallsRemaining: 1,
			}),
		);
		expect(rejected.gaps).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "patch_addition_already_selected", ranges: ["段落1"] }),
				expect.objectContaining({ code: "patch_removal_not_selected", ranges: ["段落3"] }),
			]),
		);
		expect(workspace.patchCalls).toBe(0);
	});

	it("audits a declared target and its boundary before locking the patch", () => {
		const workspace = new ScoreReviewWorkspace(packet());
		workspace.readStructureMap();
		workspace.readBlockRanges(["段落0-段落2"]);

		const needsTargetBoundary = workspace.requestCompletion({
			reason: "拟补回同一评分组方向。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});
		expect(needsTargetBoundary.gaps).toContainEqual(
			expect.objectContaining({
				code: "declared_final_context_source_unread",
				unreadDeclaredContextRanges: ["段落3"],
			}),
		);
		expect(workspace.pendingPatch).toBeNull();

		workspace.readBlockRanges(["段落3"]);
		const gatewayChallenge = workspace.requestCompletion({
			reason: "目标与边界 source 已闭合。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});
		expect(gatewayChallenge.gaps).toContainEqual(
			expect.objectContaining({
				code: "positive_gateway_challenge_required",
				provisionalFinalRanges: ["段落0-段落2"],
			}),
		);
		expect(workspace.pendingPatch).toBeNull();

		const precisionChallenge = workspace.requestCompletion({
			reason: "正向 gateway 复核后，段落2仍是有效同组叶子。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});
		expect(precisionChallenge.gaps).toContainEqual(
			expect.objectContaining({
				code: "final_precision_challenge_required",
				gatewayAuditedFinalRanges: ["段落0-段落2"],
			}),
		);
		expect(workspace.pendingPatch).toBeNull();

		const lockPatch = workspace.requestCompletion({
			reason: "逐块 precision 复核后，段落2仍是有效同组叶子。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});
		expect(lockPatch.gaps).toContainEqual(
			expect.objectContaining({
				code: "candidate_patch_required",
				missingRanges: ["段落2"],
			}),
		);
		expect(workspace.pendingPatch).toEqual({ missingRanges: ["段落2"], removeRanges: [] });
		expect(workspace.patchCalls).toBe(0);
	});

	it("rejects a duplicate declared addition before consuming or locking the patch", () => {
		const sourcePacket = packet();
		const workspace = new ScoreReviewWorkspace({
			...sourcePacket,
			blocks: sourcePacket.blocks.map((sourceBlock) => {
				if (sourceBlock.blockId === 1) {
					return { ...sourceBlock, text: "技术方案完整性：10分。未列入本评分细则的其他条件不作为评分内容。" };
				}
				if (sourceBlock.blockId === 2) {
					return { ...sourceBlock, text: "未列入本评分细则的其他条件不作为评分内容。" };
				}
				return sourceBlock;
			}),
		});
		workspace.readStructureMap();
		workspace.readBlockRanges(["段落0-段落3"]);

		const rejected = workspace.requestCompletion({
			reason: "拟补入评分细则边界。",
			finalRanges: ["段落0-段落2"],
			outcome: "complete",
		});

		expect(rejected.gaps).toContainEqual(
			expect.objectContaining({ code: "declared_adjacent_duplicate_addition" }),
		);
		expect(workspace.pendingPatch).toBeNull();
		expect(workspace.patchCalls).toBe(0);
	});
});

describe("score extraction reviewer loop", () => {
	it("runs an isolated four-tool loop and terminates on the completion tool", async () => {
		const responses: AssistantMessage[] = [
			fauxAssistantMessage("I will review the packet.", { stopReason: "stop" }),
			fauxAssistantMessage(
					fauxToolCall("read_document_structure_map", {}, { id: "map" }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall("read_document_block_ranges", { ranges: ["段落0-段落2"] }, { id: "read" }),
					{ stopReason: "toolUse" },
				),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "发现同组遗漏。", finalRanges: ["段落0-段落2"], outcome: "complete" },
					{ id: "declare-target" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", { ranges: ["段落3"] }, { id: "boundary" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "候选目标及边界证据已闭合。", finalRanges: ["段落0-段落2"], outcome: "complete" },
					{ id: "provisional-complete" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "正向 gateway 复核后，段落2仍是同一评分组有效叶子。",
						finalRanges: ["段落0-段落2"],
						outcome: "complete",
					},
					{ id: "gateway-audit" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "逐块 precision 复核后，段落2仍是同一评分组有效叶子。",
						finalRanges: ["段落0-段落2"],
						outcome: "complete",
					},
					{ id: "declare-delta" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"propose_extraction_range_patch",
					{ missingRanges: ["段落2"], removeRanges: [], reason: "应用运行时锁定的同组补回 delta。" },
					{ id: "patch" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "patch 后最终候选与已审计目标一致，边界证据完整。",
						finalRanges: ["段落0-段落2"],
						outcome: "complete",
					},
					{ id: "complete" },
				),
				{ stopReason: "toolUse" },
			),
		];
		const scripted = scriptedStream(responses);
		const result = await runScoreReviewPass({
				packet: packet(),
				packetSha256: "b".repeat(64),
				reviewerContract,
				reviewerContractSha256: "c".repeat(64),
				model: fauxModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
		});

		expect(result.status).toBe("complete");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.patch?.addedBlockIds).toEqual([2]);
		expect(result.turns).toBe(10);
		expect(result.evidence.mapBlockIdsRead).toEqual([0, 1, 2, 3]);
		expect(result.observations).toContainEqual(
			expect.objectContaining({
				tool: "runtime_tool_nudge",
				stage: "structure_map",
				attempt: 1,
			}),
		);
		expect(scripted.responseCount()).toBe(10);
	});

	it("ignores malformed model range arguments during deterministic source reads", async () => {
		const sourcePacket = packet();
		const emptyPacket = parseScoreReviewPacket({
			...sourcePacket,
			initialRanges: [],
			blockCount: 3,
			blocks: [
				block(0, "卫生间装修改造项目邀标函", [], [1]),
				block(1, "投标确认函与公司简介", [], [2]),
				block(2, "近三年无重大违法记录声明函", [], []),
			],
		});
		const scripted = scriptedStream([
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"read_document_block_ranges",
					{ ranges: [{ ranges: ["0", "2"] }] },
					{ id: "malformed-provider-read" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "未发现评价规则。", finalRanges: [], outcome: "complete" },
					{ id: "provisional" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "positive gateway 审计未发现有效叶子。", finalRanges: [], outcome: "complete" },
					{ id: "gateway" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "negative precision 审计确认最终范围为空。", finalRanges: [], outcome: "complete" },
					{ id: "complete" },
				),
				{ stopReason: "toolUse" },
			),
		]);

		const result = await runScoreReviewPass({
			packet: emptyPacket,
			packetSha256: "b".repeat(64),
			reviewerContract,
			reviewerContractSha256: "c".repeat(64),
			model: fauxModel,
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(result.status).toBe("complete");
		expect(result.finalRanges).toEqual([]);
		expect(result.evidence.sourceBlockIdsRead).toEqual([0, 1, 2]);
		expect(result.turns).toBe(5);
	});

	it("runs an independent remove-only release checker and returns one aggregate delta", async () => {
		const scripted = scriptedStream([
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "review-map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", { ranges: ["段落0-段落2"] }, { id: "review-read" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "初始候选证据闭合。", finalRanges: ["段落0-段落1"], outcome: "complete" },
					{ id: "review-provisional" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "positive gateway 审计通过。", finalRanges: ["段落0-段落1"], outcome: "complete" },
					{ id: "review-gateway" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "negative precision 审计通过。", finalRanges: ["段落0-段落1"], outcome: "complete" },
					{ id: "review-complete" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "release-map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", { ranges: ["段落0-段落2"] }, { id: "release-read" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "独立 checker 判定段落1应移除。", finalRanges: ["段落0"], outcome: "complete" },
					{ id: "release-provisional" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "逐块反证确认段落1可安全删除，段落0仍有有效叶子支撑。",
						finalRanges: ["段落0"],
						outcome: "complete",
					},
					{ id: "release-delta" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "独立 retained-precision 审计确认段落0是有效叶子且没有孤儿容器。",
						finalRanges: ["段落0"],
						blockDecisions: keepOnlyHeadingDecisions(),
						outcome: "complete",
					},
					{ id: "release-lock-delta" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"propose_extraction_range_patch",
					{ missingRanges: [], removeRanges: ["段落1"], reason: "应用独立 checker 锁定的移除。" },
					{ id: "release-patch" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "独立 checker 最终候选已闭合。", finalRanges: ["段落0"], outcome: "complete" },
					{ id: "release-complete" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "adjudication-map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", {}, { id: "adjudication-read" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "终审初判段落1应移除。", finalRanges: ["段落0"], outcome: "complete" },
					{ id: "adjudication-provisional" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "终审逐块核对后确认段落1无有效叶子或单块 precision debt。",
						finalRanges: ["段落0"],
						outcome: "complete",
					},
					{ id: "adjudication-delta" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "终审 retained-precision 确认段落0有效且段落1应删除。",
						finalRanges: ["段落0"],
						blockDecisions: keepOnlyHeadingDecisions(),
						outcome: "complete",
					},
					{ id: "adjudication-lock-delta" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("propose_extraction_range_patch", {}, { id: "adjudication-patch" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "终审 patch 后范围与 source 证据一致。", finalRanges: ["段落0"], outcome: "complete" },
					{ id: "adjudication-complete" },
				),
				{ stopReason: "toolUse" },
			),
		]);

		const result = await runScoreReviewLoop({
			packet: packet(),
			packetSha256: "b".repeat(64),
			reviewerContract,
			reviewerContractSha256: "c".repeat(64),
			model: fauxModel,
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(result.status).toBe("complete");
		expect(result.reviewMode).toBe("completeness");
		expect(result.initialRanges).toEqual(["段落0-段落1"]);
		expect(result.finalRanges).toEqual(["段落0"]);
		expect(result.patch).toEqual(
			expect.objectContaining({
				missingRanges: [],
				removeRanges: ["段落1"],
				addedBlockIds: [],
				removedBlockIds: [1],
			}),
		);
		expect(result.reason).toContain("运行时聚合 delta：add=(empty); remove=段落1; final=段落0");
		expect(result.turns).toBe(19);
		expect(result.runtime.maxTurns).toBe(72);
		expect(result.observations).toContainEqual(
			expect.objectContaining({
				tool: "review_pass_boundary",
				reviewPass: "source_first_final_adjudicator",
			}),
		);
		expect(scripted.responseCount()).toBe(19);
	});

	it("lets the source-first final adjudicator restore a checker deletion", async () => {
		const scripted = scriptedStream([
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "review-map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", {}, { id: "review-read" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "Reviewer 候选证据闭合。", finalRanges: ["段落0-段落1"], outcome: "complete" },
					{ id: "review-provisional" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "Reviewer positive gateway 通过。", finalRanges: ["段落0-段落1"], outcome: "complete" },
					{ id: "review-gateway" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "Reviewer negative precision 通过。", finalRanges: ["段落0-段落1"], outcome: "complete" },
					{ id: "review-complete" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "release-map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", {}, { id: "release-read" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "Checker 初判删除段落1。", finalRanges: ["段落0"], outcome: "complete" },
					{ id: "release-provisional" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "Checker 反证后仍删除段落1。", finalRanges: ["段落0"], outcome: "complete" },
					{ id: "release-delta" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "Checker retained-precision 确认段落0有效。",
						finalRanges: ["段落0"],
						blockDecisions: keepOnlyHeadingDecisions(),
						outcome: "complete",
					},
					{ id: "release-lock-delta" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("propose_extraction_range_patch", {}, { id: "release-patch" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "Checker patch 已闭合。", finalRanges: ["段落0"], outcome: "complete" },
					{ id: "release-complete" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "adjudication-map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", {}, { id: "adjudication-read" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "终审发现段落1含有效叶子，恢复 Reviewer 完整候选。",
						finalRanges: ["段落0-段落1"],
						outcome: "complete",
					},
					{ id: "adjudication-provisional" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "终审逐块反证确认段落1是不可删除的有效目标叶子。",
						finalRanges: ["段落0-段落1"],
						outcome: "complete",
					},
					{ id: "adjudication-precision" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "终审 retained-precision 确认两个 block 均为最终有效范围。",
						finalRanges: ["段落0-段落1"],
						blockDecisions: keepHeadingAndScoringLeafDecisions(),
						outcome: "complete",
					},
					{ id: "adjudication-complete" },
				),
				{ stopReason: "toolUse" },
			),
		]);

		const result = await runScoreReviewLoop({
			packet: packet(),
			packetSha256: "b".repeat(64),
			reviewerContract,
			reviewerContractSha256: "c".repeat(64),
			model: fauxModel,
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(result.status).toBe("complete");
		expect(result.finalRanges).toEqual(["段落0-段落1"]);
		expect(result.patch).toBeNull();
		expect(result.reason).toContain("运行时聚合 delta：add=(empty); remove=(empty); final=段落0-段落1");
		expect(result.reason).toContain("source-first final adjudicator");
		expect(result.turns).toBe(17);
		expect(scripted.responseCount()).toBe(17);
	});

	it("resets the no-tool retry budget after every successful tool call", async () => {
		const scripted = scriptedStream([
			fauxAssistantMessage("I will inspect the map.", { stopReason: "stop" }),
			fauxAssistantMessage(
				fauxToolCall("read_document_structure_map", {}, { id: "map" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I will inspect the selected source.", { stopReason: "stop" }),
			fauxAssistantMessage(
				fauxToolCall("read_document_block_ranges", { ranges: ["段落0-段落2"] }, { id: "read" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("I will finish the review.", { stopReason: "stop" }),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{ reason: "候选及边界证据已闭合。", finalRanges: ["段落0-段落1"], outcome: "complete" },
					{ id: "provisional-complete" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "正向 gateway 复核后当前候选均有有效评价关系。",
						finalRanges: ["段落0-段落1"],
						outcome: "complete",
					},
					{ id: "gateway-audit" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"complete_extraction_range_review",
					{
						reason: "逐块 precision 复核后当前候选不含独立的资格、价格或程序块。",
						finalRanges: ["段落0-段落1"],
						outcome: "complete",
					},
					{ id: "complete" },
				),
				{ stopReason: "toolUse" },
			),
		]);

		const result = await runScoreReviewPass({
			packet: packet(),
			packetSha256: "b".repeat(64),
			reviewerContract,
			reviewerContractSha256: "c".repeat(64),
			model: fauxModel,
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(result.status).toBe("complete");
		expect(result.finalRanges).toEqual(["段落0-段落1"]);
		expect(
			result.observations
				.filter((observation) => observation.tool === "runtime_tool_nudge")
				.map((observation) => ({ stage: observation.stage, attempt: observation.attempt })),
		).toEqual([
			{ stage: "structure_map", attempt: 1 },
			{ stage: "source_read", attempt: 1 },
			{ stage: "decision", attempt: 1 },
		]);
		expect(scripted.responseCount()).toBe(8);
	});

	it("stops after four consecutive no-tool retries", async () => {
		const scripted = scriptedStream(
			Array.from({ length: 5 }, () => fauxAssistantMessage("I will continue.", { stopReason: "stop" })),
		);

		await expect(
			runScoreReviewPass({
				packet: packet(),
				packetSha256: "b".repeat(64),
				reviewerContract,
				reviewerContractSha256: "c".repeat(64),
				model: fauxModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
			}),
		).rejects.toThrow("after exhausting 4 consecutive no-tool retries at structure_map");
		expect(scripted.responseCount()).toBe(5);
	});

	it("removes the read tool after a remove-only review reaches decision", async () => {
		const toolSets: string[][] = [];
		const scripted = scriptedStream(
			[
				fauxAssistantMessage(
					fauxToolCall("read_document_structure_map", {}, { id: "map" }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall("read_document_block_ranges", { ranges: ["段落0-段落2"] }, { id: "read" }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{ reason: "应移除非目标块。", finalRanges: ["段落0"], outcome: "complete" },
						{ id: "declare-provisional" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{
							reason: "逐块反证后确认删除安全且保留块仍有有效叶子。",
							finalRanges: ["段落0"],
							outcome: "complete",
						},
						{ id: "deletion-audit" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{
							reason: "独立 retained-precision 审计确认最终范围。",
							finalRanges: ["段落0"],
							blockDecisions: keepOnlyHeadingDecisions(),
							outcome: "complete",
						},
						{ id: "lock-delta" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"propose_extraction_range_patch",
						{ missingRanges: [], removeRanges: ["段落1"], reason: "应用运行时锁定的 delta。" },
						{ id: "patch" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{ reason: "remove-only 证据已闭合。", finalRanges: ["段落0"], outcome: "complete" },
						{ id: "complete" },
					),
					{ stopReason: "toolUse" },
				),
			],
			(toolNames) => toolSets.push(toolNames),
		);

		const result = await runScoreReviewLoop({
			packet: packet("release"),
			packetSha256: "b".repeat(64),
			reviewerContract,
			reviewerContractSha256: "c".repeat(64),
			model: fauxModel,
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(result.status).toBe("complete");
		expect(toolSets).toEqual([
			["read_document_structure_map"],
			["read_document_block_ranges"],
			["complete_extraction_range_review"],
			["complete_extraction_range_review"],
			["complete_extraction_range_review"],
			["propose_extraction_range_patch"],
			["complete_extraction_range_review"],
		]);
	});

	it("forces the exact pending patch after remove-only completion declares a delta", async () => {
		const toolSets: string[][] = [];
		const scripted = scriptedStream(
			[
				fauxAssistantMessage(
					fauxToolCall("read_document_structure_map", {}, { id: "map" }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall("read_document_block_ranges", { ranges: ["段落0-段落2"] }, { id: "read" }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{ reason: "应移除非目标块。", finalRanges: ["段落0"], outcome: "complete" },
						{ id: "provisional-before-patch" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{
							reason: "逐块反证后确认 exact remove delta。",
							finalRanges: ["段落0"],
							outcome: "complete",
						},
						{ id: "deletion-audit" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{
							reason: "独立 retained-precision 审计确认 exact remove delta。",
							finalRanges: ["段落0"],
							blockDecisions: keepOnlyHeadingDecisions(),
							outcome: "complete",
						},
						{ id: "complete-before-patch" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"propose_extraction_range_patch",
						{ missingRanges: [], removeRanges: ["段落1"], reason: "应用已声明 delta。" },
						{ id: "patch" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall(
						"complete_extraction_range_review",
						{ reason: "remove-only 证据已闭合。", finalRanges: ["段落0"], outcome: "complete" },
						{ id: "complete" },
					),
					{ stopReason: "toolUse" },
				),
			],
			(toolNames) => toolSets.push(toolNames),
		);

		const result = await runScoreReviewLoop({
			packet: packet("release"),
			packetSha256: "b".repeat(64),
			reviewerContract,
			reviewerContractSha256: "c".repeat(64),
			model: fauxModel,
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(result.status).toBe("complete");
		expect(toolSets).toEqual([
			["read_document_structure_map"],
			["read_document_block_ranges"],
			["complete_extraction_range_review"],
			["complete_extraction_range_review"],
			["complete_extraction_range_review"],
			["propose_extraction_range_patch"],
			["complete_extraction_range_review"],
		]);
	});

	it("requires a concrete scoring leaf for checker-invalid gateway proof", async () => {
		const contract = await readFile(
			new URL("../../skills/score-extraction-reviewer/references/reviewer-contract.md", import.meta.url),
			"utf8",
		);
		expect(contract).toContain("商务技术评审");
		expect(contract).toContain("若实际标准只有资格性、符合性、价格或行政程序，gateway 不成立");
		expect(contract).toContain("投标人详细阐述");
		expect(contract).toContain("对照商务/技术要求响应偏离说明表进行综合评价");
		expect(contract).toContain("exact block id");
		expect(contract).toContain("逐字重复另一已读 block");
		expect(contract).toContain("提供/不提供状态都继承该机制");
		expect(contract).toContain("不得继续搜索候选 scope 外");
		expect(contract).toContain("两个阶段后的 completion 才会锁定 exact delta");
		expect(contract).toContain("每次最多400 blocks");
		expect(contract).toContain("map preview 只用于定位");
		expect(contract).toContain("评分/评价词探针");
		expect(contract).toContain("零参数动作");
		expect(contract).toContain("decision 阶段只允许 completion");
		expect(contract).toContain("provisional target");
		expect(contract).toContain("优选资质/优选指标");
		expect(contract).toContain("可独立增删的原子块");
		expect(contract).toContain("`remove` 只能包含当前候选中的 block");
		expect(contract).toContain("得分汇总、评标结果汇总、评标报告编制和签署");
		expect(contract).toContain("deletion-safety");
		expect(contract).toContain("retained-precision");
		expect(contract).toContain("`checkerFinalRanges` 和 `checkerRemoveRanges` 只是待核对信号");
		expect(contract).toContain("`final-adjudication`");
		expect(contract).toContain("三组 ranges 权重相同");
		expect(contract).toContain("真实 aggregate delta");
	});
});
