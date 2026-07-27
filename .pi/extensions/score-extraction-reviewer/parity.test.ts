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
import {
	loadXqParityPrompts,
	runXqParityReview,
	WorkflowBudgetExceededError,
	type XqParityRole,
} from "./parity.ts";
import { parseScoreReviewPacket, type ScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadXqParityPrompts(
	new URL("../../skills/score-extraction-reviewer/references/xq-parity", import.meta.url).pathname,
);

const reviewerModel: Model<"openai-completions"> = {
	id: "doubao-seed-2-0-lite-260428",
	name: "Reviewer Faux",
	api: "openai-completions",
	provider: "reviewer-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};

const checkerModel: Model<"openai-completions"> = {
	...reviewerModel,
	id: "doubao-seed-1-6-251015",
	name: "Checker Faux",
};

interface CapturedCall {
	role: XqParityRole;
	toolNames: string[];
	messageRoles: string[];
	systemPrompt: string;
	userPrompt: string;
	maxTokens: number | undefined;
}

function packet(initialRanges: string[] = ["段落0-段落3"]): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "parity-review.docx",
		sourceSha256: "a".repeat(64),
		blockCount: 4,
		initialRanges,
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: initialRanges.length > 0 ? "ranges" : "null",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: null,
		blocks: [
			block(0, "第三章 评审办法", [], [1]),
			block(1, "评审委员会根据实施方案完整性评分，满分10分。", [0], [2]),
			block(2, "售后服务响应时限：8小时。", [0], [3]),
			block(3, "第四章 合同履约考核", [], []),
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
			styleName: blockId === 0 || blockId === 3 ? "标题 1" : "",
			outlineLevel: null,
			numberingId: null,
			numberingLevel: null,
			headingCandidateLevel: blockId === 0 || blockId === 3 ? 1 : null,
			headingCandidateSource: blockId === 0 || blockId === 3 ? "style_name" : "none",
			tocLevel: null,
			ancestorBlockIds,
			previousBlockIds: blockId > 0 ? [blockId - 1] : [],
			nextBlockIds,
			textMarkerKind: "none",
			textMarkerToken: "",
			sequenceGroupStartBlockId: null,
			candidateParentBlockId: null,
			candidateAncestorBlockIds: [],
		},
	};
}

function sameSequencePacket(): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "same-sequence.docx",
		sourceSha256: "c".repeat(64),
		blockCount: 6,
		initialRanges: ["段落1-段落5"],
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: "ranges",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: null,
		blocks: Array.from({ length: 6 }, (_, blockId) => ({
			...block(
				blockId,
				blockId === 0
					? "1.响应时限：承诺在接到报修通知后8小时内响应并开始处理"
					: `${blockId + 1}.技术服务响应方向${blockId + 1}：方案存在明显缺陷。`,
				[],
				blockId < 5 ? [blockId + 1] : [],
			),
			structure: {
				...block(blockId, "", [], []).structure,
				previousBlockIds: blockId > 0 ? [blockId - 1] : [],
				nextBlockIds: blockId < 5 ? [blockId + 1] : [],
				textMarkerKind: "arabic_list",
				textMarkerToken: `${blockId + 1}.`,
				sequenceGroupStartBlockId: 0,
			},
		})),
	});
}

function windowedNullPacket(): ScoreReviewPacket {
	return parseScoreReviewPacket({
		...packet([]),
		locatorContext: {
			mode: "windowed_accepted_prompt",
			outcome: "null",
			completeSourceCoverage: true,
			windowCount: 5,
		},
	});
}

function tool(name: string, args: Record<string, unknown>, id: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function textJson(value: unknown): AssistantMessage {
	return fauxAssistantMessage(JSON.stringify(value), { stopReason: "stop" });
}

function validChecker(): AssistantMessage {
	return textJson({
		执行结果: {
			评标方式: "综合评分法",
			是否存在技术评分表: "1",
			是否存在技术内容构成审查项: "0",
			评分标准提取结果是否合理: "1",
			"引用章节、附件、附表名称": null,
		},
	});
}

function invalidChecker(): AssistantMessage {
	return textJson({
		执行结果: {
			评标方式: "null",
			是否存在技术评分表: "0",
			是否存在技术内容构成审查项: "0",
			评分标准提取结果是否合理: "0",
			"引用章节、附件、附表名称": null,
		},
	});
}

let gateToolCallId = 0;

function ownerFailed(): AssistantMessage {
	return tool(
		"submit_score_owner_gate_verdict",
		{
			owner_gate: "failed",
			accepted_basis: "none",
			controller_role: "post_award",
			controller_block_id: 3,
			evaluated_object_class: "post_award",
			target_object_specificity: "not_applicable",
			evaluation_effect_class: "none",
			target_object_block_id: null,
			explicit_evaluator_effect_block_id: null,
			repeated_result_block_ids: [],
			issue_codes: ["post_award_only"],
			reason: "当前候选只剩履约考核。",
		},
		"owner-verdict-" + gateToolCallId++,
	);
}

function ownerPassed(): AssistantMessage {
	return tool(
		"submit_score_owner_gate_verdict",
		{
			owner_gate: "passed",
			accepted_basis: "explicit_evaluator",
			controller_role: "evaluation_rule",
			controller_block_id: 1,
			evaluated_object_class: "technical_service_response",
			target_object_specificity: "named_substantive_direction",
			evaluation_effect_class: "score_or_deduction",
			target_object_block_id: 1,
			explicit_evaluator_effect_block_id: 1,
			repeated_result_block_ids: [],
			issue_codes: [],
			reason: "实施方案由评审委员会评分。",
		},
		"owner-verdict-" + gateToolCallId++,
	);
}

function boundary(recommendedRanges: string[], evidence: unknown[], decision = "rejected"): AssistantMessage {
	return tool(
		"submit_score_removal_boundary_verdict",
		{
			removal_boundary_evidence: evidence,
			decision,
			recommended_ranges: recommendedRanges,
			issue_codes: decision === "approved" ? [] : ["post_award_tail_kept"],
			reason: "合同履约考核是新的生命周期边界。",
		},
		"boundary-verdict-" + gateToolCallId++,
	);
}

function scriptedStream(responses: readonly AssistantMessage[]) {
	let responseIndex = 0;
	const calls: CapturedCall[] = [];
	const streamFunction: StreamFn = (_model, context, options) => {
		const response = responses[responseIndex++];
		if (!response) throw new Error("scripted parity response exhausted");
		const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
		const calledTool = response.content.find((content) => content.type === "toolCall");
		if (calledTool?.type === "toolCall" && !toolNames.includes(calledTool.name)) {
			throw new Error("script called unavailable tool " + calledTool.name + " from " + toolNames.join(","));
		}
		calls.push({
			role: roleFromContext(context),
			toolNames,
			messageRoles: context.messages.map((message) => message.role),
			systemPrompt: context.systemPrompt ?? "",
			userPrompt: context.messages
				.filter((message) => message.role === "user")
				.flatMap((message) => message.content)
				.filter((content) => content.type === "text")
				.map((content) => content.text)
				.join("\n"),
			maxTokens: options?.maxTokens,
		});
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			stream.push({ type: "start", partial: response });
			stream.push({
				type: "done",
				reason: response.stopReason === "toolUse" ? "toolUse" : "stop",
				message: response,
			});
		});
		return stream;
	};
	return { streamFunction, calls, responseCount: () => responseIndex };
}

function roleFromContext(context: Context): XqParityRole {
	const systemPrompt = context.systemPrompt ?? "";
	if (systemPrompt.startsWith("你是正常单包 Word 评分办法最终发布中的独立 Owner Gate。")) {
		return "owner_gate";
	}
	if (systemPrompt.startsWith("你是正常单包 Word 评分办法最终发布中的独立 Boundary/Removal Gate。")) {
		return "boundary_gate";
	}
	if (systemPrompt.includes("评分标准有效性审查任务")) return "production_checker";
	if (systemPrompt.includes("候选构造 Agent")) return "completeness";
	return "release";
}

async function run(responses: readonly AssistantMessage[], sourcePacket = packet(), maxProviderCalls?: number) {
	const scripted = scriptedStream(responses);
	const result = await runXqParityReview({
		packet: sourcePacket,
		packetSha256: "b".repeat(64),
		prompts,
		reviewerModel,
		checkerModel,
		streamFunction: scripted.streamFunction,
		apiKey: "faux-key",
		budgetLimits: maxProviderCalls === undefined ? undefined : { maxProviderCalls },
	});
	return { result, ...scripted };
}

describe("xq-parity score extraction capability", () => {
	it("loads the frozen xq prompts with their governed hashes", () => {
		expect(prompts.hashes).toEqual({
			completeness: "2243d55d30df253c8988826d25c9bcb5d763cd96827dd946b5fa4ab0d33409bc",
			release: "4b7077187131aa92df21564b030ac425d89811976c9738afb6467abde039624f",
			checkerInvalidRelease: "d1a9823291c168bb64ba0b67388f7924e7abf297a0e3a62fef1a4f0fdf63a226",
			ownerGate: "045359f3a285567db9b31a62b461df08662cc7eb0e294efa70c1542c0f3d6cd0",
			boundaryGate: "617e85e2b712e3b3899e647c12829ae2bf5adb10d88c64f805f8298575c523b8",
			productionChecker: "1513d9a5678bbc6d786f78652ca788fa30efd8d706ffdd05ae8e9cc136d72ed1",
		});
	});

	it("short-circuits a complete windowed Locator null without Reviewer calls", async () => {
		const { result, responseCount } = await run([], windowedNullPacket());

		expect(responseCount()).toBe(0);
		expect(result.status).toBe("complete");
		expect(result.provisionalDecision).toBe("windowed_locator_null");
		expect(result.finalRanges).toEqual([]);
		expect(result.checker.status).toBe("not_run");
		expect(result.passes.completeness.turns).toBe(0);
		expect(result.passes.release).toBeNull();
		expect(result.budget.providerCalls).toBe(0);
	});

	it("forces add-only recall of an omitted member from the same structural sequence", async () => {
		const { result } = await run(
			[
				tool("read_document_structure_map", {}, "complete-map"),
				tool(
					"submit_extraction_range_review",
					{ reason: "误判首项为履约要求。", final_ranges: ["段落1-段落5"], outcome: "complete" },
					"complete-noop",
				),
				tool("read_document_block_ranges", { ranges: ["段落0"] }, "read-sequence-head"),
				tool(
					"submit_extraction_range_review",
					{ reason: "完整原文确认首项属于同一评价序列。", final_ranges: ["段落0-段落5"], outcome: "complete" },
					"complete-recall",
				),
				validChecker(),
				tool("read_document_structure_map", {}, "release-map"),
				tool("verify_score_owner_gate", {}, "owner"),
				ownerPassed(),
				tool(
					"verify_score_removal_boundaries",
					{ proposed_final_ranges: ["段落0-段落5"] },
					"boundary",
				),
				boundary(["段落0-段落5"], [], "approved"),
				tool(
					"submit_extraction_range_review",
					{ reason: "完整序列通过发布审查。", final_ranges: ["段落0-段落5"], outcome: "complete" },
					"release-submit",
				),
			],
			sameSequencePacket(),
		);

		expect(result.passes.completeness.observations).toContainEqual(
			expect.objectContaining({
				tool: "submit_extraction_range_review",
				status: "needs_more_evidence",
				gapCodes: ["same_sequence_recall_unresolved"],
			}),
		);
		expect(result.passes.completeness.evidence.sourceBlockIdsRead).toContain(0);
		expect(result.passes.completeness.patch?.addedBlockIds).toEqual([0]);
		expect(result.finalRanges).toEqual(["段落0-段落5"]);
	});

	it("allows one bounded completion recovery per changed tool contract", async () => {
		const { result, responseCount } = await run(
			[
				tool("read_document_structure_map", {}, "complete-map"),
				fauxAssistantMessage("尚未提交。", { stopReason: "stop" }),
				tool(
					"submit_extraction_range_review",
					{ reason: "先核对既有候选。", final_ranges: ["段落1-段落5"], outcome: "complete" },
					"complete-noop",
				),
				fauxAssistantMessage("尚未读取缺口。", { stopReason: "stop" }),
				tool("read_document_block_ranges", { ranges: ["段落0"] }, "read-sequence-head"),
				tool(
					"submit_extraction_range_review",
					{ reason: "补齐同一序列。", final_ranges: ["段落0-段落5"], outcome: "complete" },
					"complete-recall",
				),
				validChecker(),
				tool("read_document_structure_map", {}, "release-map"),
				tool("verify_score_owner_gate", {}, "owner"),
				ownerPassed(),
				tool(
					"verify_score_removal_boundaries",
					{ proposed_final_ranges: ["段落0-段落5"] },
					"boundary",
				),
				boundary(["段落0-段落5"], [], "approved"),
				tool(
					"submit_extraction_range_review",
					{ reason: "完整序列通过发布审查。", final_ranges: ["段落0-段落5"], outcome: "complete" },
					"release-submit",
				),
			],
			sameSequencePacket(),
		);

		expect(responseCount()).toBe(13);
		expect(result.finalRanges).toEqual(["段落0-段落5"]);
	});

	it("keeps Completeness add-only and leaves deletion to Release", async () => {
		const { result } = await run([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "尝试提前删除履约块。", final_ranges: ["段落0-段落2"], outcome: "complete" },
				"complete-illegal-remove",
			),
			tool(
				"submit_extraction_range_review",
				{ reason: "add-only 保留当前候选。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			invalidChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			ownerFailed(),
			tool(
				"submit_extraction_range_review",
				{ reason: "Owner 不成立，清空。", final_ranges: [], outcome: "complete" },
				"release-submit",
			),
		]);

		expect(result.passes.completeness.finalRanges).toEqual(["段落0-段落3"]);
		expect(result.passes.completeness.patch).toBeNull();
		expect(result.finalRanges).toEqual([]);
	});

	it("selects the checker-invalid Release prompt and skips Boundary when Owner fails", async () => {
		const { result, calls } = await run([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			invalidChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			ownerFailed(),
			tool(
				"submit_extraction_range_review",
				{ reason: "Owner 不成立。", final_ranges: [], outcome: "complete" },
				"release-submit",
			),
		]);

		expect(result.checker.status).toBe("invalid");
		expect(result.passes.release?.decisionVerification.owner?.ownerGate).toBe("failed");
		expect(result.passes.release?.decisionVerification.boundary).toBeNull();
		expect(calls.some((call) => call.role === "boundary_gate")).toBe(false);
		expect(calls.find((call) => call.role === "release")?.systemPrompt).toContain(
			"处理 Production Checker invalid 信号",
		);
	});

	it("retries the frozen Checker once only for a JSON contract failure", async () => {
		const { result, calls } = await run([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			fauxAssistantMessage("非 JSON 响应", { stopReason: "stop" }),
			validChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			ownerPassed(),
			tool(
				"verify_score_removal_boundaries",
				{ proposed_final_ranges: ["段落0-段落3"] },
				"boundary",
			),
			boundary(["段落0-段落3"], [], "approved"),
			tool(
				"submit_extraction_range_review",
				{ reason: "完整保留。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"release-submit",
			),
		]);

		const checkerCalls = calls.filter((call) => call.role === "production_checker");
		expect(checkerCalls).toHaveLength(2);
		expect(checkerCalls[1].userPrompt).toContain("协议恢复");
		expect(result.checker.status).toBe("valid");
		expect(result.budget.roles.production_checker.providerCalls).toBe(2);
	});

	it("requires Boundary after Owner passes and publishes its exact recommendation", async () => {
		const { result, calls } = await run([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			validChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			ownerPassed(),
			tool(
				"verify_score_removal_boundaries",
				{ proposed_final_ranges: ["段落0-段落3"] },
				"boundary",
			),
			boundary(
				["段落0-段落2"],
				[
					{
						removed_ranges: ["段落3"],
						boundary_type: "lifecycle",
						boundary_quotes: ["第四章 合同履约考核"],
					},
				],
			),
			tool(
				"submit_extraction_range_review",
				{ reason: "原样采用 Boundary 推荐。", final_ranges: ["段落0-段落2"], outcome: "complete" },
				"release-submit",
			),
		]);

		expect(result.checker.status).toBe("valid");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.patch?.removeRanges).toEqual(["段落3"]);
		expect(result.passes.release?.decisionVerification.boundary?.recommendedRanges).toEqual(["段落0-段落2"]);
		expect(calls.find((call) => call.role === "release")?.systemPrompt).toContain("独立最终发布 Agent");
		const boundaryCall = calls.find((call) => call.role === "boundary_gate");
		expect(boundaryCall?.userPrompt).toContain("父 Release Agent 的提议只是待核对假设");
		expect(boundaryCall?.userPrompt).toContain("没有就恢复");
		expect(boundaryCall?.userPrompt).toContain("每条不超过600字符");
		expect(boundaryCall?.maxTokens).toBe(4_000);
	});

	it("retries Boundary once when deletion coverage is incomplete", async () => {
		const { result, calls } = await run([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			validChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			ownerPassed(),
			tool(
				"verify_score_removal_boundaries",
				{ proposed_final_ranges: ["段落0-段落1"] },
				"boundary",
			),
			boundary(
				["段落0-段落1"],
				[
					{
						removed_ranges: ["段落3"],
						boundary_type: "lifecycle",
						boundary_quotes: ["第四章 合同履约考核"],
					},
				],
			),
			boundary(
				["段落0-段落1"],
				[
					{
						removed_ranges: ["段落2"],
						boundary_type: "peer_controller",
						boundary_quotes: ["售后服务响应时限：8小时。"],
					},
					{
						removed_ranges: ["段落3"],
						boundary_type: "lifecycle",
						boundary_quotes: ["第四章 合同履约考核"],
					},
				],
			),
			tool(
				"submit_extraction_range_review",
				{ reason: "采用闭合 ledger。", final_ranges: ["段落0-段落1"], outcome: "complete" },
				"release-submit",
			),
		]);

		expect(calls.filter((call) => call.role === "boundary_gate")).toHaveLength(2);
		expect(result.finalRanges).toEqual(["段落0-段落1"]);
	});

	it("retries Boundary once when an evidence quote is not in source", async () => {
		const { result, calls } = await run([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			validChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			ownerPassed(),
			tool(
				"verify_score_removal_boundaries",
				{ proposed_final_ranges: ["段落0-段落2"] },
				"boundary",
			),
			boundary(
				["段落0-段落2"],
				[
					{
						removed_ranges: ["段落3"],
						boundary_type: "lifecycle",
						boundary_quotes: ["不存在的原文"],
					},
				],
			),
			boundary(
				["段落0-段落2"],
				[
					{
						removed_ranges: ["段落3"],
						boundary_type: "lifecycle",
						boundary_quotes: ["第四章 合同履约考核"],
					},
				],
			),
			tool(
				"submit_extraction_range_review",
				{ reason: "采用 source quote。", final_ranges: ["段落0-段落2"], outcome: "complete" },
				"release-submit",
			),
		]);

		expect(calls.filter((call) => call.role === "boundary_gate")).toHaveLength(2);
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
	});

	it("starts every semantic role with a fresh context", async () => {
		const { calls } = await run([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			validChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			ownerPassed(),
			tool(
				"verify_score_removal_boundaries",
				{ proposed_final_ranges: ["段落0-段落3"] },
				"boundary",
			),
			boundary(["段落0-段落3"], [], "approved"),
			tool(
				"submit_extraction_range_review",
				{ reason: "完整保留。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"release-submit",
			),
		]);

		for (const role of ["completeness", "production_checker", "release", "owner_gate", "boundary_gate"] as const) {
			const first = calls.find((call) => call.role === role);
			expect(first?.messageRoles).toEqual(["user"]);
		}
	});

	it("propagates a nested Gate contract failure without re-entering the parent loop", async () => {
		const scripted = scriptedStream([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
			validChecker(),
			tool("read_document_structure_map", {}, "release-map"),
			tool("verify_score_owner_gate", {}, "owner"),
			tool(
				"submit_score_owner_gate_verdict",
				{
					owner_gate: "failed",
					accepted_basis: "none",
					controller_role: "post_award",
					controller_block_id: 3,
					evaluated_object_class: "post_award",
					target_object_specificity: "not_applicable",
					evaluation_effect_class: "none",
					target_object_block_id: null,
					explicit_evaluator_effect_block_id: null,
					repeated_result_block_ids: [],
					issue_codes: "post_award_only",
					reason: "当前候选只剩履约考核。",
				},
				"owner-invalid-1",
			),
			tool(
				"submit_score_owner_gate_verdict",
				{
					owner_gate: "failed",
					accepted_basis: "none",
					controller_role: "post_award",
					controller_block_id: 3,
					evaluated_object_class: "post_award",
					target_object_specificity: "not_applicable",
					evaluation_effect_class: "none",
					target_object_block_id: null,
					explicit_evaluator_effect_block_id: null,
					repeated_result_block_ids: [],
					issue_codes: "post_award_only",
					reason: "当前候选只剩履约考核。",
				},
				"owner-invalid-2",
			),
		]);

		await expect(
			runXqParityReview({
				packet: packet(),
				packetSha256: "b".repeat(64),
				prompts,
				reviewerModel,
				checkerModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
			}),
		).rejects.toThrow("owner_gate typed evidence contract failed after two turns");
		expect(scripted.responseCount()).toBe(7);
	});

	it("stops before additional provider calls when the workflow budget is exhausted", async () => {
		const scripted = scriptedStream([
			tool("read_document_structure_map", {}, "complete-map"),
			tool(
				"submit_extraction_range_review",
				{ reason: "候选完整。", final_ranges: ["段落0-段落3"], outcome: "complete" },
				"complete-submit",
			),
		]);

		await expect(
			runXqParityReview({
				packet: packet(),
				packetSha256: "b".repeat(64),
				prompts,
				reviewerModel,
				checkerModel,
				streamFunction: scripted.streamFunction,
				apiKey: "faux-key",
				budgetLimits: { maxProviderCalls: 2 },
			}),
		).rejects.toBeInstanceOf(WorkflowBudgetExceededError);
		expect(scripted.responseCount()).toBe(2);
	});
});
