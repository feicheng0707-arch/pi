import { createHash } from "node:crypto";
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
	loadRequirementReviewPrompts,
	parseRequirementReviewPacket,
	runRequirementReview,
	type RequirementReviewBlock,
} from "./index.ts";

const model: Model<"openai-completions"> = {
	id: "doubao-lite-faux",
	name: "Doubao Lite Faux",
	api: "openai-completions",
	provider: "requirement-review-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};

const prompts = await loadRequirementReviewPrompts(
	new URL("../../skills/word-requirement-extraction-reviewer/references", import.meta.url).pathname,
);
const buyerIssuedReviewFields = {
	source_role: "buyer_issued" as const,
	instantiation: "present" as const,
};

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function renderSource(blocks: readonly RequirementReviewBlock[]): string {
	return blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n");
}

function packetValue(blocks: RequirementReviewBlock[], initialRanges: string[]) {
	return {
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: "blind.docx",
		sourceSha256: sha256(renderSource(blocks)),
		blockCount: blocks.length,
		candidateId: "requirement_candidate_v120",
		candidatePromptSha256: "7".repeat(64),
		initialRanges,
		blocks,
	};
}

function tool(name: string, args: Record<string, unknown>, id: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function release(finalRanges: string[], reason: string): Record<string, unknown> {
	return { final_ranges: finalRanges, reason };
}

function scriptedStream(responses: AssistantMessage[]): {
	streamFunction: StreamFn;
	callCount: () => number;
	userPrompts: string[];
	toolParameterKeys: string[][];
} {
	let calls = 0;
	const userPrompts: string[] = [];
	const toolParameterKeys: string[][] = [];
	return {
		streamFunction(selectedModel, context) {
			expect(selectedModel.id).toBe(model.id);
			const response = responses[calls];
			if (!response) throw new Error(`unexpected provider call ${calls + 1}`);
			const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
			const parameters = context.tools?.[0]?.parameters as {
				properties?: Record<string, unknown>;
			} | undefined;
			toolParameterKeys.push(Object.keys(parameters?.properties ?? {}));
			for (const content of response.content) {
				if (content.type === "toolCall") expect(toolNames).toContain(content.name);
			}
			userPrompts.push(
				context.messages
					.filter((message) => message.role === "user")
					.flatMap((message) =>
						typeof message.content === "string"
							? [message.content]
							: message.content
									.filter((content) => content.type === "text")
									.map((content) => content.text),
					)
					.join("\n"),
			);
			calls += 1;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const reason =
					response.stopReason === "length" ||
					response.stopReason === "stop" ||
					response.stopReason === "toolUse"
						? response.stopReason
						: "stop";
				stream.push({ type: "start", partial: response });
				stream.push({ type: "done", reason, message: response });
				stream.end(response);
			});
			return stream;
		},
		callCount: () => calls,
		userPrompts,
		toolParameterKeys,
	};
}

function roleRuntime(streamFunction: StreamFn) {
	return { model, streamFunction, apiKey: "test-key" };
}

test("rejects answer-bearing packet fields", () => {
	const blocks = [{ blockId: 0, text: "采购人要求提供网络安全服务。" }];
	expect(() =>
		parseRequirementReviewPacket({
			...packetValue(blocks, ["段落0"]),
			expectedRanges: ["段落0"],
		}),
	).toThrow("answer-bearing field is forbidden");
});

test("preserves the candidate after one contract-valid Reviewer pass", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装、调试和验收。" },
				{ blockId: 2, text: "技术评分满分十分。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				...buyerIssuedReviewFields,
				reason: "The candidate keeps the complete requirement and excludes the independent score text.",
			},
			"reviewer-pass",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "a".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.reviewDegraded).toBe(false);
	expect(result.budget.providerCalls).toBe(1);
	expect(result.submissions.reviewer).toBe("tool_call");
	expect(scripted.userPrompts[0]).toContain('availableSourceRanges=["段落0-段落2"]');
	expect(scripted.userPrompts[0]).toContain("candidateBlockCount=1");
	expect(scripted.userPrompts[0]).toContain("candidateCoverageRatio=0.3333");
	expect(scripted.userPrompts[0]).toMatch(/sourceCharacterCount=\d+/u);
	expect(scripted.userPrompts[0]).toMatch(/candidateCharacterCount=\d+/u);
	expect(scripted.userPrompts[0]).toMatch(/candidateCharacterCoverageRatio=0\.\d{4}/u);
	expect(scripted.userPrompts[0]).toContain("focusedCandidateBlockCount=1");
	expect(scripted.userPrompts[0]).toContain("focusedCandidateIncludedTargetBlockCount=1");
	expect(scripted.userPrompts[0]).toContain("focusedCandidateContextBlockCount=2");
	expect(scripted.userPrompts[0]).toContain("focusedCandidateCoverage=complete");
	expect(scripted.userPrompts[0]).toContain("focusedCandidateIncluded=true");
	expect(scripted.userPrompts[0]).toContain(
		"# Focused Candidate review view with context-only neighbors (mechanical duplicate of source addresses)",
	);
	expect(scripted.userPrompts[0]).toContain(
		"candidateFocusPurpose=Deterministic boundary-balanced duplicate of Candidate-selected source addresses",
	);
	expect(scripted.userPrompts[0]).toContain("FOCUS_TARGET|IN|段落1：");
	expect(scripted.userPrompts[0]).toContain("CONTEXT_ONLY|OUT|段落0：");
	expect(scripted.userPrompts[0]).toContain("IN|段落1：");
	expect(scripted.userPrompts[0]).toContain("OUT|段落2：");
	expect(scripted.userPrompts[0].lastIndexOf("# Final closure checklist")).toBeGreaterThan(
		scripted.userPrompts[0].lastIndexOf("OUT|段落2："),
	);
});

test("normalizes a Reviewer pass with redundant empty challenge fields", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				...buyerIssuedReviewFields,
				issue_type: "material_omission",
				add_ranges: [],
				remove_ranges: [],
				reason: "source_role=buyer_issued; the candidate is complete.",
			},
			"reviewer-pass-redundant-fields",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "1".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.failure).toBeNull();
	expect(result.reviewer).toEqual({
		verdict: "pass",
		sourceRole: "buyer_issued",
		instantiation: "present",
		reason: "source_role=buyer_issued; the candidate is complete.",
	});
});

test("normalizes a Reviewer pass without a reason", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				...buyerIssuedReviewFields,
			},
			"reviewer-pass-without-reason",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "2".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.failure).toBeNull();
	expect(result.reason).toBe(
		"Reviewer explicitly returned pass without a contract-valid reason; candidate preserved.",
	);
});

test("fails closed when a non-procurement role passes a non-empty candidate", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "未实例化的通用采购模板。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				source_role: "non_procurement",
				instantiation: "absent",
				reason: "The source is not a procurement fact source, but the candidate was passed.",
			},
			"reviewer-inconsistent-non-procurement-pass",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "a".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("degraded");
	expect(result.resolution).toBe("review_incomplete");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.failure?.code).toBe("contract_error");
});

test("allows a non-procurement role to pass an empty candidate", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "未实例化的通用采购模板。" }], []),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				source_role: "non_procurement",
				instantiation: "absent",
				reason: "The source has no procurement facts and the candidate is already null.",
			},
			"reviewer-consistent-non-procurement-pass",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "b".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.finalRanges).toEqual([]);
	expect(result.reviewer).toMatchObject({
		verdict: "pass",
		sourceRole: "non_procurement",
		instantiation: "absent",
	});
});

test("normalizes an explicit Reviewer pass with non-canonical annotation fields", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				issue_type: "not_applicable",
				add_ranges: [],
				confidence: "high",
				source_role: "buyer_issued",
				instantiation: "present",
				reason: "The candidate is complete.",
			},
			"reviewer-pass-annotations",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "4".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.failure).toBeNull();
	expect(result.reviewer).toEqual({
		verdict: "pass",
		sourceRole: "buyer_issued",
		instantiation: "present",
		reason: "The candidate is complete.",
	});
});

test("does not normalize an explicit Reviewer pass with a non-empty canonical change", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" },
				{ blockId: 1, text: "投标报价不得超过最高限价。" },
			],
			["段落0"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				...buyerIssuedReviewFields,
				add_ranges: ["段落1"],
				reason: "Contradictory pass submission.",
			},
			"reviewer-pass-with-change",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "5".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("degraded");
	expect(result.resolution).toBe("review_incomplete");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.failure?.code).toBe("contract_error");
});

test("accepts one schema-valid terminal tool call after a length stop", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		fauxAssistantMessage(
			fauxToolCall(
				"submit_requirement_residual_review",
				{
					verdict: "pass",
					...buyerIssuedReviewFields,
					reason: "source_role=buyer_issued; the candidate is complete.",
				},
				{ id: "reviewer-length-stop" },
			),
			{ stopReason: "length" },
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "3".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.failure).toBeNull();
	expect(result.submissions.reviewer).toBe("tool_call");
});

test("accepts one strict schema-valid JSON text decision without another provider call", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装、调试和验收。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		fauxAssistantMessage(
			JSON.stringify({
				verdict: "pass",
				...buyerIssuedReviewFields,
				reason: "The candidate already contains the complete source-supported requirement.",
			}),
			{ stopReason: "stop" },
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "f".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.submissions).toEqual({ reviewer: "strict_json_text", release: null });
});

test("accepts one schema-valid JSON object wrapped in terminal prose", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		fauxAssistantMessage(
			`Decision follows: ${JSON.stringify({
				verdict: "pass",
				...buyerIssuedReviewFields,
				issue_type: "none",
				add_ranges: [],
				remove_ranges: [],
				reason: "The candidate is complete.",
			})} End of decision.`,
			{ stopReason: "stop" },
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "9".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_pass");
	expect(result.submissions.reviewer).toBe("embedded_json_text");
});

test("preserves the candidate when the independent Release rejects a challenge", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
				{ blockId: 2, text: "独立评分办法。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "material_omission",
				add_ranges: ["段落2"],
				remove_ranges: [],
				reason: "The external patch claims the score block is missing.",
			},
			"reviewer-score-challenge",
		),
		tool(
			"submit_requirement_release",
			release(["段落1"], "The challenged block is independently owned by scoring."),
			"release-reject",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "e".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("release_rejected_challenge");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.release).toEqual({
		verdict: "reject",
		submittedFinalRanges: ["段落1"],
		finalRanges: ["段落1"],
		finalBlockIds: [1],
		reason: "The challenged block is independently owned by scoring.",
	});
	expect(result.budget.providerCalls).toBe(2);
});

test("mechanically truncates overlong Reviewer and Release reasons", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "采购人要求完成系统安装和验收。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段落0"],
				preserve_ranges: [],
				reason: "审".repeat(1_300),
			},
			"reviewer-overlong-reason",
		),
		tool(
			"submit_requirement_release",
			release(["段落0"], "总".repeat(2_500)),
			"release-overlong-reasons",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "2".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("release_rejected_challenge");
	expect(result.reviewer?.reason).toHaveLength(1_200);
	expect(result.release?.reason).toHaveLength(1_200);
});

test("uses final ranges as the sole Release structural verdict", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
				{ blockId: 2, text: "采购人还要求完成调试和验收。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "material_omission",
				add_ranges: ["段落2"],
				remove_ranges: [],
				reason: "The second requirement is missing.",
			},
			"reviewer-overall-normalization",
		),
		tool(
			"submit_requirement_release",
			release(["段落1-段落2"], "The final range set independently accepts the challenged addition."),
			"release-authoritative-final",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "1".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.release).toMatchObject({
		verdict: "publish",
		finalRanges: ["段落1-段落2"],
		finalBlockIds: [1, 2],
	});
	expect(scripted.toolParameterKeys[1]).toEqual(["reason", "final_ranges"]);
});

test("normalizes non-authoritative Reviewer issue metadata without degrading a valid challenge", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
				{ blockId: 2, text: "独立评分办法。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "none",
				add_ranges: ["段落2"],
				reason: "The external score block is proposed as an omission.",
			},
			"reviewer-missing-remove-ranges",
		),
		tool(
			"submit_requirement_release",
			release(["段落1"], "The block is independently owned by scoring, so Candidate remains unchanged."),
			"release-reject-normalized-direction",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "0".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("release_rejected_challenge");
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		issueType: "unspecified",
		addRanges: ["段落2"],
		removeRanges: [],
	});
});

test("uses a narrative-blind Release to apply a bounded repair", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
				{ blockId: 2, text: "采购人还要求完成调试、培训和验收。" },
				{ blockId: 3, text: "投标报价不得超过最高限价。" },
			],
			["段落1"],
		),
	);
	const hiddenReviewerNarrative = "unique hidden reviewer narrative";
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "material_omission",
				add_ranges: ["段落2"],
				remove_ranges: [],
				reason: hiddenReviewerNarrative,
			},
			"reviewer-challenge",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落1-段落2"],
				"The omitted block independently adds commissioning, training, and acceptance obligations.",
			),
			"release-publish",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "b".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(2);
	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.patch).toEqual({ addRanges: ["段落2"], removeRanges: [] });
	expect(scripted.userPrompts[1]).toContain('challengeAddRanges=["段落2"]');
	expect(scripted.userPrompts[1]).toContain('challengeIssueType="material_omission"');
	expect(scripted.userPrompts[1]).toContain('availableSourceRanges=["段落0-段落3"]');
	expect(scripted.userPrompts[1]).toContain("candidateBlockCount=1");
	expect(scripted.userPrompts[1]).toContain("challengeAddBlockCount=1");
	expect(scripted.userPrompts[1]).toContain("challengeRemoveBlockCount=0");
	expect(scripted.userPrompts[1]).toContain("BASE_KEEP|段落1：");
	expect(scripted.userPrompts[1]).toContain("ADD_REVIEW|段落2：");
	expect(scripted.userPrompts[1]).toContain("OUT|段落3：");
	expect(scripted.userPrompts[1]).toContain(
		"releaseTerminalContract=Write one short reason first and reach one settled conclusion",
	);
	expect(scripted.userPrompts[1].lastIndexOf("# Final release checklist")).toBeGreaterThan(
		scripted.userPrompts[1].lastIndexOf("OUT|段落3："),
	);
	expect(scripted.userPrompts[1]).not.toContain(hiddenReviewerNarrative);
	expect(result.budget.providerCalls).toBe(2);
});

test("renders an oversized Release focus as a boundary-balanced partial view with context-only neighbors", async () => {
	const blocks = Array.from({ length: 180 }, (_, blockId) => ({
		blockId,
		text: `原子段落${blockId}。`,
	}));
	const packet = parseRequirementReviewPacket(
		packetValue(blocks, ["段落20", "段落40-段落179"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段落20", "段落40-段落179"],
				preserve_ranges: [],
				reason: "The exact challenge covers two mechanically distinct Candidate intervals.",
			},
			"reviewer-oversized-focus",
		),
		tool(
			"submit_requirement_release",
			release([], "The bounded exact challenge is independently approved."),
			"release-oversized-focus",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "3".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(scripted.userPrompts[1]).toContain("focusedReviewBlockCount=141");
	expect(scripted.userPrompts[1]).toContain("focusedReviewIncludedTargetBlockCount=96");
	expect(scripted.userPrompts[1]).toContain("focusedReviewContextBlockCount=32");
	expect(scripted.userPrompts[1]).toContain("focusedReviewRenderedBlockCount=128");
	expect(scripted.userPrompts[1]).toContain("focusedReviewCoverage=partial");
	expect(scripted.userPrompts[1]).toContain("FOCUS_TARGET|REMOVE_REVIEW|段落20：");
	expect(scripted.userPrompts[1]).toContain("CONTEXT_ONLY|OUT|段落19：");
	expect(scripted.userPrompts[1]).toContain("CONTEXT_ONLY|OUT|段落39：");
});

test("mechanically applies an independently approved operational precision removal", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" },
				{ blockId: 1, text: "技术参数和设备清单。" },
				{ blockId: 2, text: "通用投标文件封面格式。" },
				{ blockId: 3, text: "空白签章页和报价封面。" },
			],
			["段落0-段落3"],
		),
	);
	const hiddenReviewerNarrative = "operational precision evidence must stay hidden";
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "operational_precision",
				add_ranges: [],
				remove_ranges: ["段落2-段落3"],
				reason: hiddenReviewerNarrative,
			},
			"reviewer-operational-precision",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落0-段落1"],
				"The exact range is independently safe and materially reduces the evidence pool.",
			),
			"release-operational-precision",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "6".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落2-段落3"] });
	expect(scripted.userPrompts[1]).toContain('challengeIssueType="operational_precision"');
	const candidateCharacterCount = packet.blocks.reduce((sum, block) => sum + block.text.length, 0);
	const removeCharacterCount = packet.blocks
		.filter((block) => block.blockId === 2 || block.blockId === 3)
		.reduce((sum, block) => sum + block.text.length, 0);
	expect(scripted.userPrompts[1]).toContain(`candidateCharacterCount=${candidateCharacterCount}`);
	expect(scripted.userPrompts[1]).toContain(
		`challengeRemoveCharacterCount=${removeCharacterCount}`,
	);
	expect(scripted.userPrompts[1]).toContain(
		`challengeRemoveCandidateCharacterRatio=${(removeCharacterCount / candidateCharacterCount).toFixed(4)}`,
	);
	expect(scripted.userPrompts[1]).not.toContain(hiddenReviewerNarrative);
});

test("fails closed when operational precision submits an addition", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统安装、调试和验收。" },
				{ blockId: 1, text: "空白投标文件格式。" },
			],
			["段落0"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "operational_precision",
				add_ranges: ["段落1"],
				remove_ranges: [],
				reason: "Invalid operational addition for regression coverage.",
			},
			"reviewer-invalid-operational-add",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "7".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(scripted.callCount()).toBe(1);
});

test("applies only the independently approved direction from a mixed challenge", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
				{ blockId: 2, text: "采购人还要求完成调试和验收。" },
				{ blockId: 3, text: "空白响应文件格式。" },
			],
			["段落1", "段落3"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: ["段落2"],
				remove_ranges: ["段落3"],
				reason: "The challenge contains one omission and one cleanup proposal.",
			},
			"reviewer-mixed-challenge",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落1-段落3"],
				"Accept the material addition and preserve the neutral Candidate width.",
			),
			"release-directional-subset",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "8".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落3"]);
	expect(result.patch).toEqual({ addRanges: ["段落2"], removeRanges: [] });
	expect(result.release).toMatchObject({
		verdict: "publish",
		finalRanges: ["段落1-段落3"],
	});
});

test("mechanically preserves a Reviewer challenge with no net directional change", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "material_omission",
				add_ranges: ["段落1"],
				remove_ranges: [],
				reason: "Invalid direction for regression coverage.",
			},
			"reviewer-invalid-direction",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "c".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_noop_challenge");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.failure).toBeNull();
	expect(result.reviewer).toMatchObject({
		verdict: "noop_challenge",
		submittedAddRanges: ["段落1"],
		submittedRemoveRanges: [],
	});
});

test("mechanically clips Reviewer ranges to the declared candidate direction", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "项目概况。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
				{ blockId: 2, text: "采购人还要求完成调试和验收。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "material_omission",
				add_ranges: ["段落1-段落2"],
				remove_ranges: ["段落0-段落1"],
				reason: "The exact ranges overlap the candidate boundary by one block.",
			},
			"reviewer-overlap",
		),
		tool(
			"submit_requirement_release",
			release(["段落2"], "The mechanically normalized add/remove envelope is source-supported."),
			"release-clipped",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "d".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		addRanges: ["段落2"],
		removeRanges: ["段落1"],
	});
	expect(scripted.userPrompts[1]).toContain('challengeAddRanges=["段落2"]');
	expect(scripted.userPrompts[1]).toContain('challengeRemoveRanges=["段落1"]');
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落1：");
	expect(scripted.userPrompts[1]).toContain("ADD_REVIEW|段落2：");
	expect(result.finalRanges).toEqual(["段落2"]);
});

test("mechanically clips Release ranges to the authorized direction envelope", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "Candidate 外的项目概况。" },
				{ blockId: 1, text: "Candidate 内的响应文件格式。" },
				{ blockId: 2, text: "Candidate 外的技术要求。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段落1"],
				preserve_ranges: [],
				reason: "The Candidate contains one independently excluded response-format block.",
			},
			"reviewer-release-envelope-clipping",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落0", "段落2"],
				"The challenged response-format block is safe to remove; unauthorized external ranges must be clipped.",
			),
			"release-crosses-envelope-gap",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "e".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落1"] });
	expect(result.release).toMatchObject({
		verdict: "publish",
		submittedFinalRanges: ["段落0", "段落2"],
		finalRanges: [],
	});
});

test("mechanically expands a broad Candidate complement from protected technical islands", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "邀请前言。" },
				{ blockId: 1, text: "项目范围。" },
				{ blockId: 2, text: "技术参数。" },
				{ blockId: 3, text: "资格要求。" },
				{ blockId: 4, text: "报价程序。" },
				{ blockId: 5, text: "质量和安全要求。" },
				{ blockId: 6, text: "响应文件格式。" },
				{ blockId: 7, text: "合同格式。" },
			],
			["段落0-段落7"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "candidate_complement",
				remove_ranges: [],
				preserve_ranges: ["段落1-段落2", "段落5"],
				reason: "Protect the complete technical islands and remove the remaining excluded carriers.",
			},
			"reviewer-candidate-complement",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落1-段落2", "段落5"],
				"The complete final set keeps only independently qualified technical islands.",
			),
			"release-candidate-complement",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "6".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2", "段落5"]);
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		removeMode: "candidate_complement",
		removeRanges: ["段落0", "段落3-段落4", "段落6-段落7"],
		preserveRanges: ["段落1-段落2", "段落5"],
	});
	expect(scripted.userPrompts[1]).toContain('challengeRemoveMode="candidate_complement"');
	expect(scripted.userPrompts[1]).toContain(
		'challengeRemoveRanges=["段落0","段落3-段落4","段落6-段落7"]',
	);
	expect(scripted.userPrompts[1]).toContain(
		'releaseRemoveEnvelopeRanges=["段落0-段落7"]',
	);
	expect(scripted.userPrompts[1]).toContain("reviewerPreserveRangesAndRationale=withheld");
	expect(scripted.userPrompts[1]).toContain(
		"reviewerMechanicalPatchVisibility=prioritized REMOVE_REVIEW followed by independent KEEP_RECHECK audit across the complete Candidate",
	);
	expect(scripted.userPrompts[1]).not.toContain("challengePreserveRanges=");
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落0：");
	expect(scripted.userPrompts[1]).toContain("KEEP_RECHECK|段落1：");
	expect(scripted.userPrompts[1]).not.toContain("PROPOSED_REMOVE|");
	expect(scripted.userPrompts[1]).not.toContain("AUDIT_KEEP|");
	expect(scripted.userPrompts[1]).not.toContain("CANDIDATE_REVIEW|");
	expect(scripted.userPrompts[1]).not.toContain("REMOVE_REVIEW|段落1：");
	expect(scripted.userPrompts[1]).toContain(
		"independently attack every KEEP_RECHECK block for false protection",
	);
	expect(scripted.userPrompts[1]).toContain(
		"challengeEnvelopeMetrics=Permission-and-budget metadata only",
	);
	expect(scripted.userPrompts[1]).toContain("focusedReviewBlockCount=8");
	expect(scripted.userPrompts[1]).toContain("focusedReviewIncludedTargetBlockCount=8");
	expect(scripted.userPrompts[1]).toContain("focusedReviewContextBlockCount=0");
	expect(scripted.userPrompts[1]).toContain("focusedReviewCoverage=complete");
	expect(scripted.userPrompts[1]).toContain("focusedReviewIncluded=true");
	expect(scripted.userPrompts[1]).toContain(
		"# Focused bounded review view with context-only neighbors (mechanical duplicate of source addresses)",
	);
	expect(scripted.userPrompts[1]).toContain(
		"focusViewPurpose=Deterministic boundary-balanced duplicate of the bounded terminal audit surface only",
	);
	expect(scripted.userPrompts[1]).toContain("FOCUS_TARGET|KEEP_RECHECK|段落1：");
	expect(scripted.userPrompts[1]).toContain("FOCUS_TARGET|REMOVE_REVIEW|段落0：");
	expect(scripted.userPrompts[1]).toContain(
		"an independent technical chapter outside the four carriers has fact payload",
	);
	expect(scripted.userPrompts[1]).toContain(
		"a heading such as business, fulfillment, delivery, or after-sales requirements is not a pure-commerce verdict",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Even when the remove envelope covers 100% of Candidate, omit every independently safe excluded paragraph",
	);
	expect(scripted.userPrompts[0]).toContain(
		"This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region",
	);
	expect(scripted.userPrompts[1]).toContain(
		"This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region",
	);
	expect(scripted.userPrompts[1]).toContain(
		"a physical-file title, invitation act, attachment relationship, or notice elements scattered across separate chapters is insufficient evidence for a null result",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Do not invent an invitation-body Owner spanning all numbered sections",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Do not invent an invitation-body Owner spanning all numbered sections",
	);
	expect(scripted.userPrompts[0]).toContain(
		"preserve the heading and that body as one source-fidelity unit",
	);
	expect(scripted.userPrompts[1]).toContain(
		"final_ranges must keep the heading and that body as one source-fidelity unit",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Closure never extends backward across the carrier start",
	);
	expect(scripted.userPrompts[0]).toContain(
		"preserve_ranges is a block-level allowlist, never a chapter vote",
	);
	expect(scripted.userPrompts[0]).toContain(
		"candidate_complement is exceptional address compression only when that complete exact deletion would genuinely exceed 64 disjoint ranges",
	);
	expect(scripted.userPrompts[0]).toContain(
		"that pointer block must be removed even when the heading is retained for boundary context",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Source-fidelity closure and cross-references never transfer Owner",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Carrier Owner is the terminal gate before primary effect",
	);
	expect(scripted.userPrompts[0]).toContain(
		"A complete source whose parties, agreement language, continuous articles, price/payment, breach, effectiveness, termination, dispute and signature structure jointly form one bilateral contract remains a contract",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Every block inside an exact remove range must already be judged safe to delete",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Engineering quantities, completion, acceptance or quality-retention language used only as a monetary basis",
	);
	expect(scripted.userPrompts[1]).toContain(
		"a later 'but the duties are technical' clause is a direct contradiction",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A qualified requirement sentence that says see an appendix does not make that appendix qualified",
	);
	expect(scripted.userPrompts[1]).toContain(
		"no uncited tail block may be absorbed merely by range continuity",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Closure never extends backward across the carrier start",
	);
});

test("mechanically applies complement restores and false-protection removals", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "响应文件格式。" },
				{ blockId: 1, text: "独立技术要求。" },
				{ blockId: 2, text: "合同附件范本。" },
			],
			["段落0-段落2"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "candidate_complement",
				remove_ranges: [],
				preserve_ranges: ["段落2"],
				reason: "The proposal intentionally contains one over-deletion and one false protection.",
			},
			"reviewer-complement-corrections",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落1"],
				"Keep the qualified technical block and remove the contract-template false protection.",
			),
			"release-complement-corrections",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "5".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落0", "段落2"] });
	expect(result.release).toMatchObject({
		verdict: "publish",
		submittedFinalRanges: ["段落1"],
		finalRanges: ["段落1"],
	});
});

test("allows local complement review to remove a self-proving false protection", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "公告前言。" },
				{ blockId: 1, text: "公告内部采购范围。" },
				{ blockId: 2, text: "公告内部技术摘要。" },
				{ blockId: 3, text: "公告联系方式。" },
			],
			["段落0-段落3"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "candidate_complement",
				remove_ranges: [],
				preserve_ranges: ["段落1-段落2"],
				reason: "The Reviewer incorrectly protects two announcement-owned blocks.",
			},
			"reviewer-false-protection",
		),
		tool(
			"submit_requirement_release",
			release([], "Every Candidate block independently inherits the announcement Owner."),
			"release-overrides-false-protection",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "e".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		removeMode: "candidate_complement",
		removeRanges: ["段落0", "段落3"],
		preserveRanges: ["段落1-段落2"],
	});
	expect(result.release).toMatchObject({
		verdict: "publish",
		submittedFinalRanges: [],
		finalRanges: [],
	});
	expect(scripted.userPrompts[1]).toContain(
		'challengeRemoveRanges=["段落0","段落3"]',
	);
	expect(scripted.userPrompts[1]).toContain(
		'releaseRemoveEnvelopeRanges=["段落0-段落3"]',
	);
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落0：");
	expect(scripted.userPrompts[1]).toContain("KEEP_RECHECK|段落1：");
	expect(scripted.userPrompts[1]).not.toContain("PROPOSED_REMOVE|");
	expect(scripted.userPrompts[1]).not.toContain("AUDIT_KEEP|");
	expect(scripted.userPrompts[1]).not.toContain("CANDIDATE_REVIEW|");
});

test("allows an independent Release to remove false-protected Candidate blocks after an exact deletion challenge", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "独立技术要求。" },
				{ blockId: 1, text: "响应文件格式。" },
			],
			["段落0-段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段落1"],
				preserve_ranges: [],
				reason: "Only the response-format block is challenged.",
			},
			"reviewer-exact-base-keep",
		),
		tool(
			"submit_requirement_release",
			release([], "The complete Candidate recheck independently rejects both blocks."),
			"release-exact-base-keep",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "1".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(scripted.userPrompts[1]).toContain("KEEP_RECHECK|段落0：");
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落1：");
	expect(scripted.userPrompts[1]).toContain("releaseAuditMode=candidate_recheck");
});

test("does not run Release when a complement proposal has no net patch", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购对象。" },
				{ blockId: 1, text: "技术要求。" },
				{ blockId: 2, text: "验收要求。" },
			],
			["段落0-段落2"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "source_fidelity",
				add_ranges: ["段落1"],
				remove_mode: "candidate_complement",
				remove_ranges: [],
				preserve_ranges: ["段落0-段落2"],
				reason: "The submitted add is already IN and the preserve proposal covers the Candidate.",
			},
			"reviewer-whole-candidate-preserve",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "f".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("reviewer_noop_challenge");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.reviewer).toMatchObject({
		verdict: "noop_challenge",
		submittedAddRanges: ["段落1"],
		removeMode: "candidate_complement",
		submittedRemoveRanges: [],
		preserveRanges: ["段落0-段落2"],
	});
	expect(result.release).toBeNull();
});

test("infers candidate complement mode from a preserve-only Reviewer challenge", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "公告前言。" },
				{ blockId: 1, text: "独立技术要求。" },
				{ blockId: 2, text: "质量和验收义务。" },
				{ blockId: 3, text: "响应文件格式。" },
			],
			["段落0-段落3"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: [],
				preserve_ranges: ["段落1-段落2"],
				reason: "The preserve-only payload expresses the qualified Candidate island.",
			},
			"reviewer-inferred-complement",
		),
		tool(
			"submit_requirement_release",
			release(["段落1-段落2"], "The exact Candidate complement is independently safe."),
			"release-inferred-complement",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "b".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		removeMode: "candidate_complement",
		removeRanges: ["段落0", "段落3"],
		preserveRanges: ["段落1-段落2"],
	});
});

test("infers exact mode from a remove-only Reviewer challenge", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购对象。" },
				{ blockId: 1, text: "实施要求。" },
				{ blockId: 2, text: "响应文件格式。" },
			],
			["段落0-段落2"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "candidate_complement",
				remove_ranges: ["段落2"],
				preserve_ranges: [],
				reason: "The remove-only payload expresses one exact excluded block.",
			},
			"reviewer-inferred-exact",
		),
		tool(
			"submit_requirement_release",
			release(["段落0-段落1"], "The exact excluded block is independently safe to remove."),
			"release-inferred-exact",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "c".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		removeMode: "exact",
		removeRanges: ["段落2"],
		preserveRanges: [],
	});
});

test("uses explicit exact mode when Reviewer redundantly submits preserve ranges", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购对象。" },
				{ blockId: 1, text: "实施要求。" },
				{ blockId: 2, text: "响应文件格式。" },
			],
			["段落0-段落2"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段落2"],
				preserve_ranges: ["段落0-段落1"],
				reason: "Ambiguous dual removal representation for fail-closed coverage.",
			},
			"reviewer-ambiguous-removal-mode",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落0-段落1"],
				"The exact response-format block is independently safe to remove.",
			),
			"release-explicit-exact-mode",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "d".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(2);
	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.failure).toBeNull();
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		removeMode: "exact",
		removeRanges: ["段落2"],
		preserveRanges: [],
	});
});

test("compacts many shorthand preserve ranges before schema validation", async () => {
	const blocks = Array.from({ length: 36 }, (_, blockId) => ({
		blockId,
		text: `原子段落${blockId}。`,
	}));
	const packet = parseRequirementReviewPacket(packetValue(blocks, ["段落0-段落35"]));
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "candidate_complement",
				remove_ranges: [],
				preserve_ranges: Array.from({ length: 30 }, (_, blockId) => `段${blockId}`),
				reason: "The protected contiguous technical region is submitted atomically.",
			},
			"reviewer-many-preserve-ranges",
		),
		tool(
			"submit_requirement_release",
			release(["段落0-段落29"], "The compact exact complement is independently safe."),
			"release-many-preserve-ranges",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "7".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落0-段落29"]);
	expect(result.reviewer).toMatchObject({
		removeMode: "candidate_complement",
		removeRanges: ["段落30-段落35"],
		preserveRanges: ["段落0-段落29"],
	});
});

test("fails closed when a protected range is outside the Candidate", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "Candidate 外段落。" },
				{ blockId: 1, text: "Candidate 技术段落。" },
			],
			["段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "candidate_complement",
				remove_ranges: [],
				preserve_ranges: ["段落0"],
				reason: "Invalid protected range for fail-closed coverage.",
			},
			"reviewer-preserve-outside-candidate",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "8".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.failure?.message).toContain("entirely outside Candidate");
});

test("mechanically clips a protected source range at Candidate OUT gaps", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "邀请前言。" },
				{ blockId: 1, text: "项目范围。" },
				{ blockId: 2, text: "技术参数。" },
				{ blockId: 3, text: "Candidate 外图片占位。" },
				{ blockId: 4, text: "质量要求。" },
				{ blockId: 5, text: "安全要求。" },
				{ blockId: 6, text: "响应格式。" },
			],
			["段落0-段落2", "段落4-段落6"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "candidate_complement",
				remove_ranges: [],
				preserve_ranges: ["段落1-段落5"],
				reason: "Protect the technical source region; the harness must not add its OUT gap.",
			},
			"reviewer-crossing-out-gap",
		),
		tool(
			"submit_requirement_release",
			release(
				["段落1-段落2", "段落4-段落5"],
				"The exact complement removes only the excluded boundary blocks.",
			),
			"release-crossing-out-gap",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "a".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2", "段落4-段落5"]);
	expect(result.reviewer).toMatchObject({
		removeMode: "candidate_complement",
		submittedPreserveRanges: ["段落1-段落5"],
		preserveRanges: ["段落1-段落2", "段落4-段落5"],
		removeRanges: ["段落0", "段落6"],
	});
});

test("does not normalize a misspelled paragraph address", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "采购人要求完成系统安装。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段模0"],
				preserve_ranges: [],
				reason: "Invalid address spelling for fail-closed coverage.",
			},
			"reviewer-invalid-address-spelling",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "9".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.failure?.code).toBe("contract_error");
});
