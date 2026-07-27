import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import {
	buildPiNativeLiteralInspectionEvidence,
	loadPiNativeAtomicRemovalPrompts,
	loadPiNativeBoundedMembershipPrompts,
	loadPiNativeCompleteDeltaPrompts,
	runPiNativeAtomicRemovalReview,
	runPiNativeBoundedMembershipReview,
	runPiNativeCompleteDeltaReview,
} from "./native-bounded-membership.ts";
import { buildPiNativeDeltaEvidencePacket } from "./native.ts";
import { parseScoreReviewPacket, type ScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadPiNativeBoundedMembershipPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const atomicPrompts = await loadPiNativeAtomicRemovalPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const completeDeltaPrompts = await loadPiNativeCompleteDeltaPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);

const reviewerModel: Model<"openai-completions"> = {
	id: "doubao-lite-faux",
	name: "Doubao Lite Faux",
	api: "openai-completions",
	provider: "reviewer-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};

const primaryModel: Model<"openai-completions"> = {
	...reviewerModel,
	id: "doubao-pro-faux",
	name: "Doubao Pro Faux",
	provider: "primary-faux",
	contextWindow: 128_000,
	maxTokens: 6_000,
};

interface ScriptStep {
	modelId: string;
	response: AssistantMessage;
}

interface CapturedCall {
	modelId: string;
	systemPrompt: string;
	userPrompt: string;
	toolNames: string[];
}

function tool(
	name: string,
	args: Record<string, unknown>,
	id: string,
): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), {
		stopReason: "toolUse",
	});
}

function scriptedStream(steps: readonly ScriptStep[]): {
	streamFunction: StreamFn;
	callCount: () => number;
	calls: CapturedCall[];
} {
	let index = 0;
	const calls: CapturedCall[] = [];
	return {
		streamFunction(selectedModel, context) {
			const step = steps[index];
			if (!step) throw new Error(`unexpected provider call ${index + 1}`);
			expect(selectedModel.id).toBe(step.modelId);
			const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
			for (const content of step.response.content) {
				if (content.type === "toolCall") expect(toolNames).toContain(content.name);
			}
			calls.push({
				modelId: selectedModel.id,
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
				toolNames,
			});
			index += 1;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: step.response });
				stream.push({
					type: "done",
					reason: step.response.stopReason,
					message: step.response,
				});
				stream.end(step.response);
			});
			return stream;
		},
		callCount: () => index,
		calls,
	};
}

function packet(input: {
	texts: readonly string[];
	initialRanges?: readonly string[];
}): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "bounded-membership-fixture.docx",
		sourceSha256: "a".repeat(64),
		blockCount: input.texts.length,
		initialRanges: input.initialRanges ?? [],
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: (input.initialRanges?.length ?? 0) > 0 ? "ranges" : "null",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: null,
		blocks: input.texts.map((text, blockId) => ({
			blockId,
			kind: "paragraph",
			text,
			structure: {
				styleId: "",
				styleName: "",
				outlineLevel: null,
				numberingId: null,
				numberingLevel: null,
				headingCandidateLevel: null,
				headingCandidateSource: "none",
				tocLevel: null,
				ancestorBlockIds: [],
				previousBlockIds: blockId > 0 ? [blockId - 1] : [],
				nextBlockIds: blockId < input.texts.length - 1 ? [blockId + 1] : [],
				textMarkerKind: "none",
				textMarkerToken: "",
				sequenceGroupStartBlockId: null,
				candidateParentBlockId: null,
				candidateAncestorBlockIds: [],
			},
		})),
	});
}

async function run(
	sourcePacket: ScoreReviewPacket,
	streamFunction: StreamFn,
	models: {
		reviewer?: Model<"openai-completions">;
		primary?: Model<"openai-completions">;
	} = {},
) {
	return runPiNativeBoundedMembershipReview({
		packet: sourcePacket,
		packetSha256: "b".repeat(64),
		prompts,
		reviewerRuntime: {
			model: models.reviewer ?? reviewerModel,
			streamFunction,
			apiKey: "reviewer-key",
		},
		primaryRuntime: {
			model: models.primary ?? primaryModel,
			streamFunction,
			apiKey: "primary-key",
		},
	});
}

async function runAtomic(
	sourcePacket: ScoreReviewPacket,
	streamFunction: StreamFn,
) {
	return runPiNativeAtomicRemovalReview({
		packet: sourcePacket,
		packetSha256: "c".repeat(64),
		prompts: atomicPrompts,
		reviewerRuntime: {
			model: reviewerModel,
			streamFunction,
			apiKey: "reviewer-key",
		},
		primaryRuntime: {
			model: primaryModel,
			streamFunction,
			apiKey: "primary-key",
		},
	});
}

async function runCompleteDelta(
	sourcePacket: ScoreReviewPacket,
	streamFunction: StreamFn,
) {
	return runPiNativeCompleteDeltaReview({
		packet: sourcePacket,
		packetSha256: "d".repeat(64),
		prompts: completeDeltaPrompts,
		reviewerRuntime: {
			model: reviewerModel,
			streamFunction,
			apiKey: "reviewer-key",
		},
		primaryRuntime: {
			model: primaryModel,
			streamFunction,
			apiKey: "primary-key",
		},
	});
}

test("v89 filters remote additions outside the mechanical envelope and traces them", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v55_complete_delta_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "MIXED_COMPLETE_DELTA",
					change_block_ids: [1, 40],
				},
				"complete-delta-reviewer",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v55_bounded_membership",
				{ included_difference_block_ids: [1] },
				"complete-delta-primary",
			),
		},
	]);

	const result = await runCompleteDelta(
		packet({
			texts: Array.from({ length: 41 }, (_, blockId) => `段落内容${blockId}`),
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.contractVersion).toBe(
		"score-extraction-reviewer.pi-native.candidate-protecting-complete-delta.v89",
	);
	expect(result.schemaVersion).toBe(
		"xique.score-review.pi-native-candidate-protecting-complete-delta-result.v89",
	);
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.decisions.reviewer).toEqual({
		verdict: "CHALLENGE",
		challenge_type: "MIXED_COMPLETE_DELTA",
		change_block_ids: [1],
		ignored_out_of_envelope_block_ids: [40],
	});
	expect(scripted.calls[0].userPrompt).toContain(
		'candidateAbsentAdditionEnvelopeRanges=["段落0-段落20"]',
	);
	expect(scripted.calls[1].userPrompt).toContain("setBOnlyBlockIds=[1]");
	expect(scripted.calls[1].userPrompt).not.toContain("setBOnlyBlockIds=[1,40]");
	expect(result.budget.maxProviderCalls).toBe(2);
	expect(result.budget.providerCalls).toBe(2);
});

test("v89 admits an addition at the inclusive envelope edge into the A/B delta", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v55_complete_delta_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "EDGE_OR_LOCAL_GROUP_COMPLETION",
					change_block_ids: [20],
				},
				"complete-delta-edge-reviewer",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v55_bounded_membership",
				{ included_difference_block_ids: [20] },
				"complete-delta-edge-primary",
			),
		},
	]);

	const result = await runCompleteDelta(
		packet({
			texts: Array.from({ length: 21 }, (_, blockId) => `段落内容${blockId}`),
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0", "段落20"]);
	expect(result.decisions.reviewer).toEqual(
		expect.objectContaining({
			change_block_ids: [20],
			ignored_out_of_envelope_block_ids: [],
		}),
	);
	expect(scripted.calls.map((call) => call.toolNames)).toEqual([
		["submit_pi_native_v55_complete_delta_review"],
		["submit_pi_native_v55_bounded_membership"],
	]);
	expect(scripted.calls[1].systemPrompt).toContain(
		"extends bidirectionally to an immediately adjacent terse leading or trailing peer",
	);
	expect(result.calls.map((call) => call.role)).toEqual(["reviewer", "primary"]);
	expect(result.budget.providerCalls).toBe(2);
});

test("empty candidate uses its mode-specific one-call Reviewer contract", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{ verdict: "PASS", challenge_type: "NONE", change_block_ids: [] },
				"empty-pass",
			),
		},
	]);

	const result = await run(
		packet({ texts: ["本项目采用最低报价法。"] }),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual([]);
	expect(result.resolution).toBe("candidate_preserved_by_empty_reviewer");
	expect(result.budget.providerCalls).toBe(1);
	expect(scripted.calls[0].systemPrompt).toContain("Empty-Candidate Omission Auditor");
	expect(scripted.calls[0].systemPrompt).not.toContain(
		"Edge-First Bounded-Challenge Reviewer",
	);
	expect(scripted.calls[0].userPrompt).toContain("本项目采用最低报价法");
});

test("Primary can select a strict bounded subset and redundant common IDs are ignored", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE",
					change_block_ids: [2, 3],
				},
				"reviewer-add",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_bounded_membership",
				{
					included_difference_block_ids: [0, 2],
					evidence_block_ids: [1, 2, 3],
				},
				"primary-partial",
			),
		},
	]);

	const result = await run(
		packet({
			texts: ["技术评分", "实施方案评价", "质量保障评价", "合同签署"],
			initialRanges: ["段落0-段落1"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.decisions.primary?.included_difference_block_ids).toEqual([2]);
	expect(result.resolution).toBe("pairwise_partial_membership_selected");
	expect(result.budget.providerCalls).toBe(2);
	expect(scripted.calls[1].modelId).toBe(primaryModel.id);
	expect(scripted.calls[1].userPrompt).toContain("setAOnlyBlockIds=[]");
	expect(scripted.calls[1].userPrompt).toContain("setBOnlyBlockIds=[2,3]");
	expect(scripted.calls[1].userPrompt).not.toContain(
		"ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE",
	);
});

test("oversized atomic difference uses one Planner and mechanically searched excerpts", async () => {
	const largeText = `${"前".repeat(4_200)}ＡＢＣ，技术 方案按照优良档评价。结果，通知后进入合同阶段。`;
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE",
					change_block_ids: [1],
				},
				"reviewer-large-add",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_literal_inspection_plan",
				{
					focus_block_ids: [1],
					target_literal_queries: ["ABC技术方案"],
					boundary_literal_queries: ["结果通知"],
				},
				"planner",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_bounded_membership",
				{
					included_difference_block_ids: [1],
					evidence_block_ids: [0, 1],
				},
				"primary-large",
			),
		},
	]);

	const result = await run(
		packet({
			texts: ["技术评分表", largeText],
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.budget.providerCalls).toBe(3);
	expect(result.budget.roles.inspection_planner.providerCalls).toBe(1);
	expect(result.decisions.inspectionEvidence).toContain(
		'totalLiteralMatches=1|excerptedMatches=1',
	);
	expect(result.decisions.inspectionEvidence).toContain(
		'"matchStart":4200,"matchEnd":4209',
	);
	expect(result.decisions.inspectionEvidence).toContain(
		"ＡＢＣ，技术 方案按照优良档评价",
	);
	expect(scripted.calls[2].userPrompt).toContain("<LITERAL_MATCH_EXCERPT");
	expect(result.calls.map((call) => call.role)).toEqual([
		"reviewer",
		"inspection_planner",
		"primary",
	]);
});

test("literal inspection preserves original offsets after NFKC and punctuation normalization", () => {
	const sourcePacket = packet({ texts: ["前缀ＡＢＣ，技术 方案后缀"] });
	const context = buildPiNativeDeltaEvidencePacket(sourcePacket);
	const evidence = buildPiNativeLiteralInspectionEvidence(context, {
		focus_block_ids: [0],
		target_literal_queries: ["ABC技术方案"],
		boundary_literal_queries: ["不存在的边界"],
	});

	expect(evidence).toContain('"matchStart":2,"matchEnd":11');
	expect(evidence).toContain("前缀ＡＢＣ，技术 方案后缀");
	expect(evidence).toContain("totalLiteralMatches=0|excerptedMatches=0");
});

test("identical duplicate terminal tool calls are mechanically normalized", async () => {
	const decision = { verdict: "PASS", challenge_type: "NONE", change_block_ids: [] };
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: fauxAssistantMessage(
				[
					fauxToolCall("submit_pi_native_v51_action_review", decision, {
						id: "duplicate-1",
					}),
					fauxToolCall("submit_pi_native_v51_action_review", decision, {
						id: "duplicate-2",
					}),
				],
				{ stopReason: "toolUse" },
			),
		},
	]);

	const result = await run(packet({ texts: ["价格评审"] }), scripted.streamFunction);

	expect(result.status).toBe("complete");
	expect(result.calls[0].terminalMode).toBe("identical_duplicate_tool_calls");
	expect(result.calls[0].terminalCallCount).toBe(2);
});

test("one complete schema-valid JSON text terminal is accepted without a retry", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: fauxAssistantMessage(
				'```json\n{"verdict":"PASS","challenge_type":"NONE","change_block_ids":[]}\n```',
				{ stopReason: "stop" },
			),
		},
	]);

	const result = await run(packet({ texts: ["价格评审"] }), scripted.streamFunction);

	expect(result.status).toBe("complete");
	expect(result.calls[0].terminalMode).toBe("strict_json_text");
	expect(result.budget.providerCalls).toBe(1);
});

test("conflicting duplicate tool calls fail closed", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: fauxAssistantMessage(
				[
					fauxToolCall(
						"submit_pi_native_v51_action_review",
						{ verdict: "PASS", challenge_type: "NONE", change_block_ids: [] },
						{ id: "conflict-pass" },
					),
					fauxToolCall(
						"submit_pi_native_v51_action_review",
						{
							verdict: "CHALLENGE",
							challenge_type: "ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE",
							change_block_ids: [0],
						},
						{ id: "conflict-challenge" },
					),
				],
				{ stopReason: "toolUse" },
			),
		},
	]);

	const result = await run(packet({ texts: ["技术方案得5分"] }), scripted.streamFunction);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual([]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.failure?.message).toContain("conflicting terminal tool calls");
});

test("Primary membership outside the A/B envelope fails closed", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "REMOVE_ALL_NO_VALID_EVALUATOR",
					change_block_ids: [0],
				},
				"reviewer-remove",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_bounded_membership",
				{ included_difference_block_ids: [1], evidence_block_ids: [0, 1] },
				"primary-outside",
			),
		},
	]);

	const result = await run(
		packet({ texts: ["技术评分", "无关附件"], initialRanges: ["段落0"] }),
		scripted.streamFunction,
	);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.failure?.message).toContain("outside the bounded A/B membership");
	expect(result.budget.providerCalls).toBe(2);
});

test("deterministic input preflight stops an over-budget run before provider access", async () => {
	const scripted = scriptedStream([]);
	const largeReviewerModel: Model<"openai-completions"> = {
		...reviewerModel,
		contextWindow: 500_000,
	};
	const result = await run(
		packet({ texts: ["评".repeat(210_000)] }),
		scripted.streamFunction,
		{ reviewer: largeReviewerModel },
	);

	expect(result.status).toBe("degraded");
	expect(result.failure?.code).toBe("run_budget");
	expect(result.budget.providerCalls).toBe(0);
	expect(scripted.callCount()).toBe(0);
});

test("v53 routes one oversized removal to the independent Atomic Removal Verifier", async () => {
	const targetQuote = "定标委员会对施工方案的安全、质量和进度措施进行评审";
	const targetQuery = "定标委员会对施工方案的安全质量和进度措施进行评审";
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "REMOVE_ALL_NO_VALID_EVALUATOR",
					change_block_ids: [0],
				},
				"atomic-reviewer-remove",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v53_atomic_removal_verification",
				{
					verdict: "RETAIN_ATOMIC_BLOCK",
					source_literal_query: targetQuery,
				},
				"atomic-retain",
			),
		},
	]);

	const result = await runAtomic(
		packet({
			texts: [`${"普通条款".repeat(1_100)}${targetQuote}。`],
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.resolution).toBe("atomic_block_retained");
	expect(result.budget.providerCalls).toBe(2);
	expect(result.decisions.inspectionPlan).toBeNull();
	expect(result.decisions.primary).toBeNull();
	expect(result.decisions.atomicRemovalVerifier).toEqual(
		expect.objectContaining({
			verdict: "RETAIN_ATOMIC_BLOCK",
			sourceLiteralQuery: targetQuery,
			exactQuote: targetQuote,
		}),
	);
	expect(result.calls.map((call) => call.role)).toEqual([
		"reviewer",
		"atomic_removal_verifier",
	]);
	expect(scripted.calls[1].systemPrompt).toContain(
		"Independent Atomic Removal Verifier",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"challengedAtomicBlockId=0",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"<ATOMIC_BLOCK_CHUNK index=0",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"<ATOMIC_BLOCK_CHUNK index=2",
	);
});

test("v53 authorizes only the oversized atomic block and locks bundled short removals", async () => {
	const boundaryQuote = "本表仅说明合同签订后的月度履约考核";
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "REMOVE_ALL_NO_VALID_EVALUATOR",
					change_block_ids: [0, 1],
				},
				"atomic-reviewer-remove",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v53_atomic_removal_verification",
				{
					verdict: "AUTHORIZE_REMOVAL",
					source_literal_query: boundaryQuote,
				},
				"atomic-authorize",
			),
		},
	]);

	const result = await runAtomic(
		packet({
			texts: [
				`${boundaryQuote}。${"履约记录".repeat(1_100)}`,
				"另一条短候选内容",
			],
			initialRanges: ["段落0-段落1"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.resolution).toBe("atomic_block_removal_authorized");
	expect(result.patch?.removedBlockIds).toEqual([0]);
	expect(result.budget.providerCalls).toBe(2);
});

test("v53 fails closed when the Verifier literal query has no block match", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "REMOVE_ALL_NO_VALID_EVALUATOR",
					change_block_ids: [0],
				},
				"atomic-reviewer-remove",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v53_atomic_removal_verification",
				{
					verdict: "AUTHORIZE_REMOVAL",
					source_literal_query: "不存在于原子块的边界证据",
				},
				"atomic-invalid-quote",
			),
		},
	]);

	const result = await runAtomic(
		packet({
			texts: ["合同履约".repeat(1_000)],
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.failure?.message).toContain("exactly one normalized literal match");
	expect(result.budget.providerCalls).toBe(2);
});

test("v53 keeps short removals on the existing bounded Primary path", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "REMOVE_ALL_NO_VALID_EVALUATOR",
					change_block_ids: [0],
				},
				"short-reviewer-remove",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_bounded_membership",
				{ included_difference_block_ids: [], evidence_block_ids: [0] },
				"short-primary-remove",
			),
		},
	]);

	const result = await runAtomic(
		packet({ texts: ["合同履约考核"], initialRanges: ["段落0"] }),
		scripted.streamFunction,
	);

	expect(result.status).toBe("complete");
	expect(result.finalRanges).toEqual([]);
	expect(result.resolution).toBe("pairwise_set_b_selected");
	expect(result.calls.map((call) => call.role)).toEqual(["reviewer", "primary"]);
});

test("v53 uses its edge-specific Primary for one immediate leading addition", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE",
					change_block_ids: [0],
				},
				"edge-reviewer-add",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_bounded_membership",
				{ included_difference_block_ids: [0], evidence_block_ids: [0, 1, 2] },
				"edge-primary-include",
			),
		},
	]);

	const result = await runAtomic(
		packet({
			texts: [
				"1.响应时限：承诺在接到通知后及时响应",
				"2.实施方案：方案内容不完整或有明显缺陷",
				"3.保障方案：方案存在明显缺失",
			],
			initialRanges: ["段落1-段落2"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(scripted.calls[1].systemPrompt).toContain(
		"Independent single immediate-edge addition judge",
	);
	expect(scripted.calls[1].systemPrompt).not.toContain(
		"Isolated direction-blind pairwise judge",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"challengedImmediateEdgeBlockId=0",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"edgeRelation=BEFORE_CANDIDATE_INTERVAL",
	);
});

test("v53 edge-specific Primary can reject an adjacent block across a positive boundary", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE",
					change_block_ids: [0],
				},
				"boundary-reviewer-add",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_bounded_membership",
				{ included_difference_block_ids: [], evidence_block_ids: [0, 1] },
				"boundary-primary-reject",
			),
		},
	]);

	const result = await runAtomic(
		packet({
			texts: [
				"合同签订后按月开展服务响应时限考核",
				"技术方案得分：方案完整得5分",
			],
			initialRanges: ["段落1"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(scripted.calls[1].systemPrompt).toContain(
		"affirmative new controller",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"edgeRelation=BEFORE_CANDIDATE_INTERVAL",
	);
});

test("v53 keeps a non-edge addition on the generic direction-blind Primary path", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE",
					change_block_ids: [2],
				},
				"remote-reviewer-add",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v51_bounded_membership",
				{ included_difference_block_ids: [2], evidence_block_ids: [0, 2] },
				"remote-primary-include",
			),
		},
	]);

	const result = await runAtomic(
		packet({
			texts: ["技术方案得5分", "合同条款", "服务保障得3分"],
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0", "段落2"]);
	expect(scripted.calls[1].systemPrompt).toContain(
		"Isolated direction-blind pairwise judge",
	);
	expect(scripted.calls[1].systemPrompt).not.toContain(
		"Independent single immediate-edge addition judge",
	);
});

test("v53 verifies the oversized removal block even when a short removal sorts first", async () => {
	const targetQuote = "定标委员会对服务方案的质量和进度措施进行评审";
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v51_action_review",
				{
					verdict: "CHALLENGE",
					challenge_type: "REMOVE_ALL_NO_VALID_EVALUATOR",
					change_block_ids: [0, 1],
				},
				"sorted-reviewer-remove",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v53_atomic_removal_verification",
				{
					verdict: "RETAIN_ATOMIC_BLOCK",
					source_literal_query: targetQuote,
				},
				"sorted-atomic-retain",
			),
		},
	]);

	const result = await runAtomic(
		packet({
			texts: [
				"短候选内容",
				`${"普通条款".repeat(1_100)}${targetQuote}。`,
			],
			initialRanges: ["段落0-段落1"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.context.atomicRemovalBlockId).toBe(1);
	expect(scripted.calls[1].userPrompt).toContain("challengedAtomicBlockId=1");
});
