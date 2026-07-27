import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	loadPiNativeDualAxisBlindDebateReleasePrompts,
	loadPiNativeDualAxisDebateReleasePrompts,
	loadPiNativeDualAxisReleasePrompts,
	runPiNativeScoreReview,
} from "./native.ts";
import { parseScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadPiNativeDualAxisReleasePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const debatePrompts = await loadPiNativeDualAxisDebateReleasePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const blindDebatePrompts = await loadPiNativeDualAxisBlindDebateReleasePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);

const model: Model<"openai-completions"> = {
	id: "dual-axis-faux",
	name: "Dual Axis Faux",
	api: "openai-completions",
	provider: "dual-axis-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};

function packet(
	blockCount = 5,
	initialRanges: string[] = ["段落1-段落3"],
) {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "dual-axis.docx",
		sourceSha256: "a".repeat(64),
		blockCount,
		initialRanges,
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: "ranges",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: null,
		blocks: Array.from({ length: blockCount }, (_, blockId) => ({
			blockId,
			kind: "paragraph",
			text: `${blockId + 1}. 技术服务评价维度 ${blockId}`,
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
				nextBlockIds: blockId < blockCount - 1 ? [blockId + 1] : [],
				textMarkerKind: "none",
				textMarkerToken: "",
				sequenceGroupStartBlockId: null,
				candidateParentBlockId: null,
				candidateAncestorBlockIds: [],
			},
		})),
	});
}

function tool(name: string, args: Record<string, unknown>, id: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), {
		stopReason: "toolUse",
	});
}

function scriptedStream(responses: readonly AssistantMessage[]) {
	let index = 0;
	const calls: Array<{ toolName: string; systemPrompt: string; userPrompt: string }> = [];
	const streamFunction: StreamFn = (_selectedModel, context) => {
		const response = responses[index++];
		if (!response) throw new Error("scripted dual-axis response exhausted");
		const toolName = context.tools?.[0]?.name ?? "";
		for (const content of response.content) {
			if (content.type === "toolCall") expect(content.name).toBe(toolName);
		}
		calls.push({
			toolName,
			systemPrompt: context.systemPrompt,
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
			stream.push({ type: "done", reason: response.stopReason, message: response });
			stream.end(response);
		});
		return stream;
	};
	return { streamFunction, calls, responseCount: () => index };
}

async function run(responses: readonly AssistantMessage[]) {
	const scripted = scriptedStream(responses);
	const result = await runPiNativeScoreReview({
		packet: packet(),
		packetSha256: "b".repeat(64),
		prompts,
		model,
		streamFunction: scripted.streamFunction,
		apiKey: "faux-key",
		profile: "dual_axis_release",
	});
	return { result, ...scripted };
}

async function runDebate(
	responses: readonly AssistantMessage[],
	casePacket = packet(),
) {
	const scripted = scriptedStream(responses);
	const result = await runPiNativeScoreReview({
		packet: casePacket,
		packetSha256: "b".repeat(64),
		prompts: debatePrompts,
		model,
		streamFunction: scripted.streamFunction,
		apiKey: "faux-key",
		profile: "dual_axis_debate_release",
	});
	return { result, ...scripted };
}

async function runBlindDebate(responses: readonly AssistantMessage[]) {
	const scripted = scriptedStream(responses);
	const result = await runPiNativeScoreReview({
		packet: packet(),
		packetSha256: "b".repeat(64),
		prompts: blindDebatePrompts,
		model,
		streamFunction: scripted.streamFunction,
		apiKey: "faux-key",
		profile: "dual_axis_blind_debate_release",
	});
	return { result, ...scripted };
}

function issue(ranges: string[], claim: string, evidenceBlockIds: number[]) {
	return {
		challenge_ranges: ranges,
		issue_claim: claim,
		evidence_block_ids: evidenceBlockIds,
	};
}

function primary(
	verdict: "preserve_candidate" | "apply_precision" | "apply_recall" | "degraded",
	reason: string,
) {
	return {
		verdict,
		evidence_block_ids: verdict === "degraded" ? [] : [0, 1, 2, 3],
		reason,
	};
}

function release(
	verdict: "approve_change" | "reject_change" | "degraded",
	reason: string,
) {
	return {
		verdict,
		evidence_block_ids: verdict === "degraded" ? [] : [0, 1, 2, 3],
		reason,
	};
}

describe("dual-axis adversarial release v23", () => {
	it("preserves the candidate after one Reviewer pass", async () => {
		const { result, calls, responseCount } = await run([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "pass",
					evidence_block_ids: [1, 2, 3],
					reason: "Neither residual axis proves a material membership defect.",
				},
				"dual-axis-pass",
			),
		]);

		expect(responseCount()).toBe(1);
		expect(calls.map((call) => call.toolName)).toEqual([
			"submit_pi_native_dual_axis_review",
		]);
		expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v23");
		expect(result.contractVersion).toBe(
			"score-extraction-reviewer.pi-native.dual-axis-adversarial-release-review.v23",
		);
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.resolution).toBe("candidate_preserved_by_reviewer_pass");
		expect(result.budget.maxProviderCalls).toBe(3);
		expect(result.context.format).toBe(
			"compact_mechanical_neutral_source_v4_no_sequences",
		);
	});

	it("lets Primary choose recall without combining the precision issue", async () => {
		const precisionClaim = "SENTINEL_FALSE_PRECISION";
		const recallClaim = "SENTINEL_TRUE_RECALL";
		const { result, calls, responseCount } = await run([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], precisionClaim, [2, 3]),
					recall_issue: issue(["段落0"], recallClaim, [0, 1, 2]),
				},
				"dual-axis-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("apply_recall", "Only the recall issue survives source review."),
				"dual-axis-primary",
			),
			tool(
				"submit_pi_native_dual_axis_release",
				release("approve_change", "The exact recall issue survives regression review."),
				"dual-axis-release",
			),
		]);

		expect(responseCount()).toBe(3);
		expect(calls.map((call) => call.toolName)).toEqual([
			"submit_pi_native_dual_axis_review",
			"submit_pi_native_dual_axis_primary",
			"submit_pi_native_dual_axis_release",
		]);
		expect(calls[1].userPrompt).toContain(precisionClaim);
		expect(calls[1].userPrompt).toContain(recallClaim);
		expect(calls[2].userPrompt).toContain(
			'selectedIssueDesiredMembership="include"',
		);
		expect(calls[2].userPrompt).toContain('selectedIssueRanges=["段落0"]');
		expect(calls[2].userPrompt).not.toContain(precisionClaim);
		expect(calls[2].userPrompt).not.toContain(recallClaim);
		expect(result.finalRanges).toEqual(["段落0-段落3"]);
		expect(result.patch?.addedBlockIds).toEqual([0]);
		expect(result.patch?.removedBlockIds).toEqual([]);
		expect(result.resolution).toBe("dual_axis_repair_applied");
	});

	it("stops after Primary preserves the candidate", async () => {
		const { result, responseCount } = await run([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], "Test precision.", [2, 3]),
					recall_issue: issue(["段落0"], "Test recall.", [0, 1]),
				},
				"dual-axis-review-preserve",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("preserve_candidate", "Neither exact issue is fully proven."),
				"dual-axis-primary-preserve",
			),
		]);

		expect(responseCount()).toBe(2);
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.resolution).toBe("candidate_preserved_by_primary_rejection");
		expect(result.decisions.releaseSkippedReason).toBe(
			"primary_preserved_candidate",
		);
		expect(result.context.releaseInputSha256).toBeNull();
	});

	it("fails closed for an issue with invalid candidate membership", async () => {
		const { result, responseCount } = await run([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(
						["段落0"],
						"Invalid precision issue outside the candidate.",
						[0],
					),
					recall_issue: null,
				},
				"dual-axis-invalid-membership",
			),
		]);

		expect(responseCount()).toBe(1);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.failure).toMatchObject({
			role: "reviewer",
			code: "contract_error",
		});
	});

	it("fails closed when Primary selects an unavailable axis", async () => {
		const { result, responseCount } = await run([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], "Only precision exists.", [2, 3]),
					recall_issue: null,
				},
				"dual-axis-single-axis",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("apply_recall", "Attempt to select a missing recall issue."),
				"dual-axis-missing-axis",
			),
		]);

		expect(responseCount()).toBe(2);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.failure).toMatchObject({
			role: "adjudicator",
			code: "contract_error",
		});
	});

	it("lets Release veto the selected exact issue", async () => {
		const { result, responseCount } = await run([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: null,
					recall_issue: issue(["段落0"], "Test one recall issue.", [0, 1]),
				},
				"dual-axis-release-veto-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("apply_recall", "Primary selects the recall issue."),
				"dual-axis-release-veto-primary",
			),
			tool(
				"submit_pi_native_dual_axis_release",
				release("reject_change", "The proposed addition would regress precision."),
				"dual-axis-release-veto",
			),
		]);

		expect(responseCount()).toBe(3);
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.resolution).toBe("candidate_preserved_by_release_rejection");
	});
});

describe("dual-axis adversarial debate release v24", () => {
	it("accepts a detailed issue claim and up to sixteen decisive evidence IDs", async () => {
		const detailedClaim = "A".repeat(900);
		const evidenceBlockIds = Array.from({ length: 12 }, (_, index) => index);
		const { result, responseCount } = await runDebate(
			[
				tool(
					"submit_pi_native_dual_axis_review",
					{
						verdict: "review",
						precision_issue: issue(
							["段落1-段落12"],
							detailedClaim,
							evidenceBlockIds,
						),
						recall_issue: null,
					},
					"dual-axis-detailed-review",
				),
				tool(
					"submit_pi_native_dual_axis_primary",
					{
						verdict: "preserve_candidate",
						evidence_block_ids: evidenceBlockIds,
						reason: "The detailed precision attack is not source-supported.",
					},
					"dual-axis-detailed-primary",
				),
			],
			packet(17, ["段落1-段落12"]),
		);

		expect(responseCount()).toBe(2);
		expect(result.status).toBe("complete");
		expect(result.finalRanges).toEqual(["段落1-段落12"]);
		expect(result.resolution).toBe("candidate_preserved_by_primary_rejection");
	});

	it("lets Release replace Primary's precision choice with the open recall issue", async () => {
		const precisionClaim = "SENTINEL_PRECISION_ATTACK";
		const recallClaim = "SENTINEL_RECALL_ATTACK";
		const primaryReason = "SENTINEL_PRIMARY_RESPONSE";
		const { result, calls, responseCount } = await runDebate([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], precisionClaim, [2, 3]),
					recall_issue: issue(["段落0"], recallClaim, [0, 1]),
				},
				"dual-axis-debate-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("apply_precision", primaryReason),
				"dual-axis-debate-primary",
			),
			tool(
				"submit_pi_native_dual_axis_debate_release",
				primary("apply_recall", "Recall is the only source-supported override."),
				"dual-axis-debate-release",
			),
		]);

		expect(responseCount()).toBe(3);
		expect(calls.map((call) => call.toolName)).toEqual([
			"submit_pi_native_dual_axis_review",
			"submit_pi_native_dual_axis_primary",
			"submit_pi_native_dual_axis_debate_release",
		]);
		expect(calls[2].userPrompt).toContain(precisionClaim);
		expect(calls[2].userPrompt).toContain(recallClaim);
		expect(calls[2].userPrompt).toContain(primaryReason);
		expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v24");
		expect(result.contractVersion).toBe(
			"score-extraction-reviewer.pi-native.dual-axis-debate-release-review.v24",
		);
		expect(result.finalRanges).toEqual(["段落0-段落3"]);
		expect(result.patch?.addedBlockIds).toEqual([0]);
		expect(result.patch?.removedBlockIds).toEqual([]);
		expect(result.resolution).toBe("dual_axis_debate_repair_applied");
		expect(result.context.releaseInputSha256).not.toBeNull();
	});

	it("runs Release when Primary preserves a two-axis dispute", async () => {
		const { result, responseCount } = await runDebate([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], "Precision attack.", [2, 3]),
					recall_issue: issue(["段落0"], "Recall attack.", [0, 1]),
				},
				"dual-axis-debate-preserve-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("preserve_candidate", "Both issues remain disputed."),
				"dual-axis-debate-preserve-primary",
			),
			tool(
				"submit_pi_native_dual_axis_debate_release",
				primary("apply_recall", "The recall issue survives independent review."),
				"dual-axis-debate-preserve-release",
			),
		]);

		expect(responseCount()).toBe(3);
		expect(result.finalRanges).toEqual(["段落0-段落3"]);
		expect(result.resolution).toBe("dual_axis_debate_repair_applied");
		expect(result.decisions.releaseSkippedReason).toBeNull();
	});

	it("fails closed when Release selects an issue that Reviewer did not open", async () => {
		const { result, responseCount } = await runDebate([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], "Only precision exists.", [2, 3]),
					recall_issue: null,
				},
				"dual-axis-debate-missing-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("apply_precision", "Primary selects precision."),
				"dual-axis-debate-missing-primary",
			),
			tool(
				"submit_pi_native_dual_axis_debate_release",
				primary("apply_recall", "Invalid missing-axis selection."),
				"dual-axis-debate-missing-release",
			),
		]);

		expect(responseCount()).toBe(3);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.failure).toMatchObject({
			role: "adjudicator",
			code: "contract_error",
		});
	});

	it("stops after two calls when Primary rejects a single-axis issue", async () => {
		const { result, responseCount } = await runDebate([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], "Only precision exists.", [2, 3]),
					recall_issue: null,
				},
				"dual-axis-debate-single-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("preserve_candidate", "The single issue is not proven."),
				"dual-axis-debate-single-primary",
			),
		]);

		expect(responseCount()).toBe(2);
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.resolution).toBe("candidate_preserved_by_primary_rejection");
		expect(result.decisions.releaseSkippedReason).toBe(
			"primary_preserved_candidate",
		);
		expect(result.context.releaseInputSha256).toBeNull();
	});
});

describe("dual-axis blind adversarial debate release v25", () => {
	it("can replace Primary's choice without seeing prior-role narratives", async () => {
		const precisionClaim = "SENTINEL_HIDDEN_PRECISION_ATTACK";
		const recallClaim = "SENTINEL_HIDDEN_RECALL_ATTACK";
		const primaryReason = "SENTINEL_HIDDEN_PRIMARY_RESPONSE";
		const { result, calls, responseCount } = await runBlindDebate([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], precisionClaim, [2, 3]),
					recall_issue: issue(["段落0"], recallClaim, [0, 1]),
				},
				"dual-axis-blind-debate-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("apply_precision", primaryReason),
				"dual-axis-blind-debate-primary",
			),
			tool(
				"submit_pi_native_dual_axis_blind_debate_release",
				primary("apply_recall", "Recall survives independent source review."),
				"dual-axis-blind-debate-release",
			),
		]);

		expect(responseCount()).toBe(3);
		expect(calls[0].systemPrompt).toContain("## 4. 容器优先形成范围");
		expect(calls[0].userPrompt).toContain(
			"语义裁决必须严格复用系统中注入的冻结 single-prompt 合同",
		);
		expect(calls[1].systemPrompt).toContain("## 4. 容器优先形成范围");
		expect(calls[1].userPrompt).toContain("严格使用冻结 single-prompt 合同");
		expect(calls[2].userPrompt).toContain('precisionIssueRanges=["段落3"]');
		expect(calls[2].userPrompt).toContain('recallIssueRanges=["段落0"]');
		expect(calls[2].userPrompt).toContain("reviewerAttackVisibility=withheld");
		expect(calls[2].systemPrompt).toContain("## 4. 容器优先形成范围");
		expect(calls[2].userPrompt).toContain("第一步先重建文件角色");
		expect(calls[2].userPrompt).not.toContain(precisionClaim);
		expect(calls[2].userPrompt).not.toContain(recallClaim);
		expect(calls[2].userPrompt).not.toContain(primaryReason);
		expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v25");
		expect(result.contractVersion).toBe(
			"score-extraction-reviewer.pi-native.dual-axis-blind-debate-release-review.v25",
		);
		expect(result.finalRanges).toEqual(["段落0-段落3"]);
		expect(result.resolution).toBe("dual_axis_blind_debate_repair_applied");
	});

	it("fails closed by ignoring an issue without usable evidence", async () => {
		const { result, responseCount } = await runBlindDebate([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: null,
					recall_issue: {
						challenge_ranges: ["段落0"],
						issue_claim: "An issue without evidence cannot open a semantic change.",
					},
				},
				"dual-axis-blind-empty-evidence",
			),
		]);

		expect(responseCount()).toBe(1);
		expect(result.status).toBe("complete");
		expect(result.reviewDegraded).toBe(false);
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.resolution).toBe("candidate_preserved_by_reviewer_pass");
	});

	it("stops after Primary rejects a single-axis issue", async () => {
		const { result, responseCount } = await runBlindDebate([
			tool(
				"submit_pi_native_dual_axis_review",
				{
					verdict: "review",
					precision_issue: issue(["段落3"], "Only precision exists.", [2, 3]),
					recall_issue: null,
				},
				"dual-axis-blind-single-review",
			),
			tool(
				"submit_pi_native_dual_axis_primary",
				primary("preserve_candidate", "The single issue is not proven."),
				"dual-axis-blind-single-primary",
			),
		]);

		expect(responseCount()).toBe(2);
		expect(result.finalRanges).toEqual(["段落1-段落3"]);
		expect(result.resolution).toBe("candidate_preserved_by_primary_rejection");
		expect(result.context.releaseInputSha256).toBeNull();
	});
});
