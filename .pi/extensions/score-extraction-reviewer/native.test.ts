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
	buildPiNativeDeltaEvidencePacket,
	loadPiNativeAdversarialDebateReleasePrompts,
	loadPiNativeBlindResidualPrompts,
	loadPiNativeFullChallengeReleasePrompts,
	loadPiNativePartialGroupAppealPrompts,
	loadPiNativePrompts,
	loadPiNativeReleaseGatedIssueRepairPrompts,
	loadPiNativeResidualPrompts,
	loadPiNativeReviewerDialogueReleasePrompts,
	loadPiNativeSingleIssueReleasePrompts,
	loadPiNativeStrictAdversarialDebatePrompts,
	loadPiNativeTargetedIssueRepairPrompts,
	loadPiNativeTargetedRepairPrompts,
	type PiNativeRole,
	type PiNativeReviewProfile,
	runPiNativeScoreReview,
} from "./native.ts";
import { parseScoreReviewPacket, type ScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadPiNativePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const residualPrompts = await loadPiNativeResidualPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const blindResidualPrompts = await loadPiNativeBlindResidualPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const targetedRepairPrompts = await loadPiNativeTargetedRepairPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const targetedIssueRepairPrompts = await loadPiNativeTargetedIssueRepairPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const releaseGatedIssueRepairPrompts = await loadPiNativeReleaseGatedIssueRepairPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const fullChallengeReleasePrompts = await loadPiNativeFullChallengeReleasePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const partialGroupAppealPrompts = await loadPiNativePartialGroupAppealPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const reviewerDialogueReleasePrompts = await loadPiNativeReviewerDialogueReleasePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const singleIssueReleasePrompts = await loadPiNativeSingleIssueReleasePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);
const adversarialDebateReleasePrompts =
	await loadPiNativeAdversarialDebateReleasePrompts(
		new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
	);
const strictAdversarialDebatePrompts =
	await loadPiNativeStrictAdversarialDebatePrompts(
		new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
	);
const packetSha256 = "b".repeat(64);
const reviewerModel: Model<"openai-completions"> = {
	id: "doubao-seed-2-0-lite-260428",
	name: "Pi-native Reviewer Faux",
	api: "openai-completions",
	provider: "pi-native-reviewer-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};
const adjudicatorModel: Model<"openai-completions"> = {
	...reviewerModel,
	id: "doubao-seed-1-6-251015",
	name: "Pi-native Adjudicator Faux",
	contextWindow: 128_000,
};

interface CapturedCall {
	role: PiNativeRole;
	modelId: string;
	toolNames: string[];
	toolParameterText: string;
	systemPrompt: string;
	userPrompt: string;
}

interface BlockOptions {
	kind?: "paragraph" | "table";
	rows?: string[][];
	tableIndex?: number | null;
	headingLevel?: number | null;
	outlineLevel?: number | null;
	tocLevel?: number | null;
	ancestorBlockIds?: number[];
	numberingId?: number | null;
	numberingLevel?: number | null;
	markerKind?: string;
	markerToken?: string;
	sequenceGroupStartBlockId?: number | null;
	parentBlockId?: number | null;
	candidateAncestorBlockIds?: number[];
}

function block(
	blockId: number,
	text: string,
	options: BlockOptions = {},
): ScoreReviewPacket["blocks"][number] {
	const headingLevel = options.headingLevel ?? null;
	return {
		blockId,
		kind: options.kind ?? "paragraph",
		text,
		rows: options.rows,
		tableIndex: options.tableIndex,
		structure: {
			styleId: "",
			styleName: "",
			outlineLevel: options.outlineLevel ?? null,
			numberingId: options.numberingId ?? null,
			numberingLevel: options.numberingLevel ?? null,
			headingCandidateLevel: headingLevel,
			headingCandidateSource: headingLevel === null ? "none" : "style_name",
			tocLevel: options.tocLevel ?? null,
			ancestorBlockIds: options.ancestorBlockIds ?? [],
			previousBlockIds: blockId > 0 ? [blockId - 1] : [],
			nextBlockIds: [],
			textMarkerKind: options.markerKind ?? "none",
			textMarkerToken: options.markerToken ?? "",
			sequenceGroupStartBlockId: options.sequenceGroupStartBlockId ?? null,
			candidateParentBlockId: options.parentBlockId ?? null,
			candidateAncestorBlockIds: options.candidateAncestorBlockIds ?? [],
		},
	};
}

function packet(
	initialRanges: string[] = ["段落0-段落2"],
	overrides: {
		blocks?: ScoreReviewPacket["blocks"];
		sourceName?: string;
		reviewContext?: unknown;
	} = {},
): ScoreReviewPacket {
	const blocks =
		overrides.blocks ??
		[
			block(0, "第三章 评标办法", { headingLevel: 1 }),
			block(1, "评标委员会根据实施方案完整性评分，满分10分。"),
			block(2, "售后服务响应时限：8小时内得5分。"),
			block(3, "投标报价按最低价法计算价格得分。"),
			block(4, "第四章 合同履约考核", { headingLevel: 1 }),
		];
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: overrides.sourceName ?? "pi-native-review.docx",
		sourceSha256: "a".repeat(64),
		blockCount: blocks.length,
		initialRanges,
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: initialRanges.length > 0 ? "ranges" : "null",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: overrides.reviewContext ?? null,
		blocks,
	});
}

function tool(name: string, args: Record<string, unknown>, id: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), {
		stopReason: "toolUse",
	});
}

function withUsage(message: AssistantMessage, input: number, output: number): AssistantMessage {
	return {
		...message,
		usage: {
			input,
			output,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: input + output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function scriptedStream(responses: readonly AssistantMessage[]) {
	let responseIndex = 0;
	const calls: CapturedCall[] = [];
	const streamFunction: StreamFn = (selectedModel, context) => {
		const response = responses[responseIndex++];
		if (!response) throw new Error("scripted Pi-native response exhausted");
		const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
		const calledTools = response.content.filter((content) => content.type === "toolCall");
		for (const calledTool of calledTools) {
			if (!toolNames.includes(calledTool.name)) {
				throw new Error(`script called unavailable tool ${calledTool.name}`);
			}
		}
		calls.push({
			role:
				toolNames.includes("submit_pi_native_delta_adjudication") ||
				toolNames.includes("submit_pi_native_targeted_repair") ||
				toolNames.includes("submit_pi_native_issue_repair") ||
				toolNames.includes("submit_pi_native_selective_release") ||
				toolNames.includes("submit_pi_native_full_challenge_release") ||
				toolNames.includes("submit_pi_native_partial_group_appeal_release") ||
				toolNames.includes("submit_pi_native_adversarial_debate_release") ||
				toolNames.includes("submit_pi_native_strict_adversarial_debate_release") ||
				toolNames.includes("submit_pi_native_single_issue_primary") ||
				toolNames.includes("submit_pi_native_single_issue_release")
					? "adjudicator"
					: "reviewer",
			modelId: selectedModel.id,
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
			if (response.stopReason === "error" || response.stopReason === "aborted") {
				stream.push({ type: "error", reason: response.stopReason, error: response });
			} else {
				stream.push({ type: "done", reason: response.stopReason, message: response });
			}
			stream.end(response);
		});
		return stream;
	};
	return { streamFunction, calls, responseCount: () => responseIndex };
}

async function run(
	responses: readonly AssistantMessage[],
	sourcePacket = packet(),
	options: {
		model?: Model<"openai-completions">;
		adjudicatorModel?: Model<"openai-completions">;
		workflowTimeoutMs?: number;
		profile?: PiNativeReviewProfile;
	} = {},
) {
	const scripted = scriptedStream(responses);
	const selectedPrompts =
		options.profile === "strict_adversarial_debate_release"
			? strictAdversarialDebatePrompts
			: options.profile === "adversarial_debate_release"
			? adversarialDebateReleasePrompts
			: options.profile === "single_issue_release"
			? singleIssueReleasePrompts
			: options.profile === "reviewer_dialogue_release"
			? reviewerDialogueReleasePrompts
			: options.profile === "partial_group_appeal_release"
			? partialGroupAppealPrompts
			: options.profile === "full_challenge_release"
			? fullChallengeReleasePrompts
			: options.profile === "release_gated_issue_repair"
			? releaseGatedIssueRepairPrompts
			: options.profile === "targeted_issue_repair" ||
		options.profile === "blind_issue_repair" ||
		options.profile === "membership_issue_repair"
			? targetedIssueRepairPrompts
			: options.profile === "targeted_repair"
			? targetedRepairPrompts
			: options.profile === "blind_residual"
			? blindResidualPrompts
			: options.profile === "residual"
				? residualPrompts
				: prompts;
	const result = await runPiNativeScoreReview({
		packet: sourcePacket,
		packetSha256,
		prompts: selectedPrompts,
		model: options.model ?? reviewerModel,
		streamFunction: scripted.streamFunction,
		apiKey: "faux-key",
		adjudicatorRuntime: options.adjudicatorModel
			? {
					model: options.adjudicatorModel,
					streamFunction: scripted.streamFunction,
					apiKey: "faux-adjudicator-key",
				}
			: undefined,
		workflowTimeoutMs: options.workflowTimeoutMs,
		profile: options.profile,
	});
	return { result, ...scripted };
}

function reviewerProposal(
	proposalRanges: string[],
	proposalClaim = "The proposal is the minimal complete source-grounded evaluation scope.",
) {
	return {
		verdict: "proposal",
		proposal_ranges: proposalRanges,
		proposal_claim: proposalClaim,
		evidence_block_ids: [0, 1, 2, 3],
	};
}

function adjudication(verdict: "accept_candidate" | "accept_proposal" | "degraded", reason: string) {
	return {
		verdict,
		evidence_block_ids: [1, 3],
		reason,
	};
}

function issueChallenge(addRanges: string[], removeRanges: string[], claim: string) {
	return {
		verdict: "challenge",
		add_ranges: addRanges,
		remove_ranges: removeRanges,
		issue_claim: claim,
		evidence_block_ids: [0, 1, 2, 3, 4],
	};
}

function membershipChallenge(challengeRanges: string[], claim: string) {
	return {
		verdict: "challenge",
		challenge_ranges: challengeRanges,
		issue_claim: claim,
		evidence_block_ids: [0, 1, 2, 3, 4],
	};
}

function issueRepair(approvedAddRanges: string[], approvedRemoveRanges: string[], reason: string) {
	return {
		verdict: "publish",
		approved_add_ranges: approvedAddRanges,
		approved_remove_ranges: approvedRemoveRanges,
		evidence_block_ids: [0, 1, 2, 3, 4],
		reason,
	};
}

function singleIssuePass(reason: string) {
	return {
		verdict: "pass",
		evidence_block_ids: [0, 1, 2, 3, 4],
		reason,
	};
}

function singleIssueChallenge(
	desiredMembership: "include" | "exclude",
	challengeRanges: string[],
	claim: string,
) {
	return {
		verdict: "challenge",
		desired_membership: desiredMembership,
		challenge_ranges: challengeRanges,
		issue_claim: claim,
		evidence_block_ids: [0, 1, 2, 3, 4],
	};
}

function singleIssueDecision(
	verdict: "approve_change" | "reject_change" | "degraded",
	reason: string,
) {
	return {
		verdict,
		evidence_block_ids: verdict === "degraded" ? [] : [0, 1, 2, 3, 4],
		reason,
	};
}

describe("Pi-native candidate-protected independent proposal review v6.3", () => {
	it.each([
		["non-empty", ["段落0-段落2"]],
		["empty", []],
	])("preserves a %s frozen candidate after exactly one call", async (_label, initialRanges) => {
		const sourcePacket = packet(initialRanges);
		const { result, calls, responseCount } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(initialRanges),
					"reviewer-same-proposal",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(1);
		expect(calls.map((call) => call.role)).toEqual(["reviewer"]);
		expect(result.status).toBe("complete");
		expect(result.resolution).toBe("candidate_preserved_by_set_equivalence");
		expect(result.finalRanges).toEqual(initialRanges);
		expect(result.candidatePreserved).toBe(true);
		expect(result.reviewDegraded).toBe(false);
		expect(result.failure).toBeNull();
		expect(result.budget.providerCalls).toBe(1);
		expect(result.budget.roles.adjudicator.providerCalls).toBe(0);
		expect(result.context.adjudicatorInputSha256).toBeNull();
		expect(result.decisions.adjudicatorSkippedReason).toBe("proposal_matches_candidate");
		expect(calls[0].userPrompt).not.toContain("candidateRanges=");
		expect(calls[0].userPrompt).not.toContain("<CANDIDATE_AUDIT>");
		expect(calls[0].userPrompt).not.toContain("C:head");
		expect(calls[0].userPrompt).not.toContain("N:before");
	});

	it("keeps the complete Reviewer input byte-identical across candidate variants", async () => {
		const responses = [
			tool(
				"submit_pi_native_delta_review",
				reviewerProposal(["段落0-段落1"]),
				"reviewer-independent",
			),
			tool(
				"submit_pi_native_delta_adjudication",
				adjudication("accept_candidate", "Candidate is better supported."),
				"adjudicator",
			),
		];
		const first = await run(responses, packet(["段落0-段落2"]));
		const second = await run(responses, packet(["段落1-段落2"]));

		expect(first.calls[0].systemPrompt).toBe(second.calls[0].systemPrompt);
		expect(first.calls[0].userPrompt).toBe(second.calls[0].userPrompt);
		expect(first.calls[0].toolParameterText).toBe(second.calls[0].toolParameterText);
		expect(first.result.context.reviewerInputSha256).toBe(
			second.result.context.reviewerInputSha256,
		);
	});

	it("changes the candidate only when the Adjudicator accepts the exact proposal", async () => {
		const sourcePacket = packet(["段落0-段落3"]);
		const reviewerClaim = "The source supports the exact narrower evaluation scope.";
		const { result, calls, responseCount } = await run(
			[
				withUsage(
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(["段落0-段落2"], reviewerClaim),
						"reviewer-challenge",
					),
					11,
					3,
				),
				withUsage(
					tool(
						"submit_pi_native_delta_adjudication",
						adjudication("accept_proposal", "The exact proposal is independently supported."),
						"adjudicator-accept",
					),
					7,
					2,
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(2);
		expect(calls.map((call) => call.role)).toEqual(["reviewer", "adjudicator"]);
		expect(result.resolution).toBe("proposal_accepted");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.candidatePreserved).toBe(false);
		expect(result.patch?.removeRanges).toEqual(["段落3"]);
		expect(result.decisions.reviewerAddedBlockIds).toEqual([]);
		expect(result.decisions.reviewerRemovedBlockIds).toEqual([3]);
		expect(result.reviewDegraded).toBe(false);
		expect(result.budget.providerCalls).toBe(2);
		expect(result.budget.inputTokens).toBe(18);
		expect(calls[1].userPrompt).toContain('proposalRanges=["段落0-段落2"]');
		expect(calls[1].userPrompt).toContain("removedBlockIds=[3]");
		expect(calls[1].userPrompt).toContain(`proposalClaim=${JSON.stringify(reviewerClaim)}`);
		expect(calls[1].userPrompt).toContain("You cannot submit ranges or create a third answer");
		expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v6.3");
		expect(result.context.format).toBe("compact_mechanical_neutral_source_v3");
		expect(result.context.reviewerInputSha256).toHaveLength(64);
		expect(result.context.adjudicatorInputSha256).toHaveLength(64);
		expect(result.decisions.adjudicatorSkippedReason).toBeNull();
	});

	it("lets the independent Adjudicator protect a correct candidate", async () => {
		const sourcePacket = packet();
		const { result, responseCount } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(["段落0-段落1"]),
					"reviewer-challenge",
				),
				tool(
					"submit_pi_native_delta_adjudication",
					adjudication("accept_candidate", "The deletion is not proven."),
					"adjudicator-candidate",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(2);
		expect(result.resolution).toBe("candidate_preserved_by_adjudicator");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.candidatePreserved).toBe(true);
		expect(result.patch).toBeNull();
		expect(result.reviewDegraded).toBe(false);
	});

	it("requires non-empty evidence for an Adjudicator semantic verdict", async () => {
		const sourcePacket = packet();
		const { result, responseCount } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(["段落0-段落1"]),
					"reviewer-replacement",
				),
				tool(
					"submit_pi_native_delta_adjudication",
					{
						verdict: "accept_proposal",
						evidence_block_ids: [],
						reason: "The proposal is supported.",
					},
					"adjudicator-empty-evidence",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(2);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.failure).toMatchObject({ role: "adjudicator", code: "contract_error" });
	});

	it("accepts an empty proposal through the same two-key contract", async () => {
		const sourcePacket = packet();
		const { result } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal([]),
					"reviewer-empty",
				),
				tool(
					"submit_pi_native_delta_adjudication",
					adjudication("accept_proposal", "The complete source supports an empty answer."),
					"adjudicator-empty",
				),
			],
			sourcePacket,
		);

		expect(result.finalRanges).toEqual([]);
		expect(result.patch?.removedBlockIds).toEqual([0, 1, 2]);
	});

	it("recovers one non-empty proposal from an empty candidate", async () => {
		const sourcePacket = packet([]);
		const { result } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(["段落0-段落2"]),
					"reviewer-non-empty",
				),
				tool(
					"submit_pi_native_delta_adjudication",
					adjudication("accept_proposal", "The exact non-empty proposal is supported."),
					"adjudicator-non-empty",
				),
			],
			sourcePacket,
		);

		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.patch?.addedBlockIds).toEqual([0, 1, 2]);
	});

	it("rejects a Reviewer degraded branch and preserves the candidate after one call", async () => {
		const sourcePacket = packet();
		const { result, responseCount } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					{
						verdict: "degraded",
						evidence_block_ids: [],
						reason: "The immutable source is internally unavailable.",
					},
					"reviewer-degraded",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(1);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "reviewer", code: "contract_error" });
		expect(result.budget.providerCalls).toBe(1);
		expect(result.decisions.reviewer).toBeNull();
		expect(result.decisions.adjudicatorSkippedReason).toBe("reviewer_not_completed");
	});

	it.each([
		[
			"unknown proposal block",
			{
				...reviewerProposal(["段落999"]),
			},
		],
		[
			"unknown evidence block",
			{
				...reviewerProposal(["段落0-段落1"]),
				evidence_block_ids: [999],
			},
		],
		[
			"empty replacement evidence",
			{
				...reviewerProposal(["段落0-段落1"]),
				evidence_block_ids: [],
			},
		],
		[
			"missing proposal",
			{
				verdict: "proposal",
				proposal_claim: "The source supports a narrower evaluation scope.",
				evidence_block_ids: [2],
			},
		],
		[
			"removed counterproposal verdict",
			{
				...reviewerProposal(["段落0-段落2"]),
				verdict: "counterproposal",
			},
		],
		[
			"branch leakage",
			{
				verdict: "degraded",
				evidence_block_ids: [],
				reason: "Source is unavailable.",
				proposal_ranges: ["段落0-段落1"],
			},
		],
	])("falls back mechanically for invalid Reviewer submission: %s", async (_label, args) => {
		const sourcePacket = packet();
		const { result, responseCount } = await run(
			[tool("submit_pi_native_delta_review", args, `invalid-${_label}`)],
			sourcePacket,
		);

		expect(responseCount()).toBe(1);
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.candidatePreserved).toBe(true);
		expect(result.status).toBe("degraded");
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "reviewer", code: "contract_error" });
		expect(result.budget.providerCalls).toBe(1);
		expect(result.budget.roles.adjudicator.providerCalls).toBe(0);
	});

	it("normalizes an identical replacement to one-call candidate preservation", async () => {
		const sourcePacket = packet();
		const { result, responseCount } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(["段落0-段落2"]),
					"same-replacement",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(1);
		expect(result.status).toBe("complete");
		expect(result.resolution).toBe("candidate_preserved_by_set_equivalence");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.decisions.reviewerSameProposalNormalized).toBe(true);
		expect(result.budget.roles.adjudicator.providerCalls).toBe(0);
	});

	it("does not retry a Reviewer provider failure", async () => {
		const sourcePacket = packet();
		let attempts = 0;
		const streamFunction: StreamFn = () => {
			attempts += 1;
			const response = fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "provider unavailable",
			});
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: response });
				stream.push({ type: "error", reason: "error", error: response });
				stream.end(response);
			});
			return stream;
		};
		const result = await runPiNativeScoreReview({
			packet: sourcePacket,
			packetSha256,
			prompts,
			model: reviewerModel,
			streamFunction,
			apiKey: "faux-key",
		});

		expect(attempts).toBe(1);
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "reviewer", code: "provider_error" });
		expect(result.budget.providerCalls).toBe(1);
	});

	it("forbids the Adjudicator from submitting a third range answer", async () => {
		const sourcePacket = packet(["段落0-段落3"]);
		const { result, responseCount } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(["段落0-段落2"]),
					"reviewer-challenge",
				),
				tool(
					"submit_pi_native_delta_adjudication",
					{
						...adjudication("accept_proposal", "Attempted third answer."),
						final_ranges: ["段落1-段落2"],
					},
					"adjudicator-third-answer",
				),
			],
			sourcePacket,
		);

		expect(responseCount()).toBe(2);
		expect(result.finalRanges).toEqual(["段落0-段落3"]);
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "adjudicator", code: "contract_error" });
		expect(result.decisions.adjudicator).toBeNull();
	});

	it("preserves accumulated usage when the Adjudicator provider fails", async () => {
		const sourcePacket = packet(["段落0-段落3"]);
		let step = 0;
		const first = withUsage(
			tool(
				"submit_pi_native_delta_review",
				reviewerProposal(["段落0-段落2"]),
				"reviewer-challenge",
			),
			13,
			4,
		);
		const streamFunction: StreamFn = (_model, context) => {
			step += 1;
			const response =
				step === 1
					? first
					: fauxAssistantMessage("", {
							stopReason: "error",
							errorMessage: "adjudicator provider unavailable",
						});
			const availableNames = context.tools?.map((candidate) => candidate.name) ?? [];
			if (step === 1 && !availableNames.includes("submit_pi_native_delta_review")) {
				throw new Error("Reviewer tool was not active");
			}
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: response });
				if (response.stopReason === "error") {
					stream.push({ type: "error", reason: "error", error: response });
				} else {
					stream.push({ type: "done", reason: response.stopReason, message: response });
				}
				stream.end(response);
			});
			return stream;
		};
		const result = await runPiNativeScoreReview({
			packet: sourcePacket,
			packetSha256,
			prompts,
			model: reviewerModel,
			streamFunction,
			apiKey: "faux-key",
		});

		expect(step).toBe(2);
		expect(result.finalRanges).toEqual(["段落0-段落3"]);
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "adjudicator", code: "provider_error" });
		expect(result.budget.providerCalls).toBe(2);
		expect(result.budget.roles.reviewer.inputTokens).toBe(13);
		expect(result.budget.roles.adjudicator.providerCalls).toBe(1);
	});

	it("rejects duplicate terminal submissions instead of silently taking the first", async () => {
		const sourcePacket = packet();
		const duplicate = fauxAssistantMessage(
			[
				fauxToolCall("submit_pi_native_delta_review", reviewerProposal(["段落0-段落2"], "first"), {
					id: "first",
				}),
				fauxToolCall("submit_pi_native_delta_review", reviewerProposal(["段落0-段落2"], "second"), {
					id: "second",
				}),
			],
			{ stopReason: "toolUse" },
		);
		const { result, responseCount } = await run([duplicate], sourcePacket);

		expect(responseCount()).toBe(1);
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "reviewer", code: "contract_error" });
		expect(result.budget.providerCalls).toBe(1);
	});

	it("preserves the candidate when capacity preflight makes zero calls", async () => {
		const sourcePacket = packet();
		const scripted = scriptedStream([]);
		const result = await runPiNativeScoreReview({
			packet: sourcePacket,
			packetSha256,
			prompts,
			model: { ...reviewerModel, contextWindow: 4_000 },
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(scripted.responseCount()).toBe(0);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "preflight", code: "context_capacity" });
		expect(result.context.preflight.fit).toBe(false);
		expect(result.budget.providerCalls).toBe(0);
	});

	it("preserves the candidate when complete-source coverage is absent", async () => {
		const completePacket = packet();
		const sourcePacket: ScoreReviewPacket = {
			...completePacket,
			locatorContext: {
				...completePacket.locatorContext,
				completeSourceCoverage: false,
			},
		};
		const scripted = scriptedStream([]);
		const result = await runPiNativeScoreReview({
			packet: sourcePacket,
			packetSha256,
			prompts,
			model: reviewerModel,
			streamFunction: scripted.streamFunction,
			apiKey: "faux-key",
		});

		expect(scripted.responseCount()).toBe(0);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.failure).toMatchObject({ role: "preflight", code: "contract_error" });
	});

	it("preserves the candidate on workflow timeout without a retry", async () => {
		const sourcePacket = packet();
		let attempts = 0;
		const streamFunction: StreamFn = (_model, _context, options) => {
			attempts += 1;
			const stream = createAssistantMessageEventStream();
			options?.signal?.addEventListener(
				"abort",
				() => {
					const response = fauxAssistantMessage("", {
						stopReason: "aborted",
						errorMessage: "request aborted",
					});
					stream.push({ type: "error", reason: "aborted", error: response });
					stream.end(response);
				},
				{ once: true },
			);
			return stream;
		};
		const result = await runPiNativeScoreReview({
			packet: sourcePacket,
			packetSha256,
			prompts,
			model: reviewerModel,
			streamFunction,
			apiKey: "faux-key",
			workflowTimeoutMs: 1,
		});

		expect(attempts).toBe(1);
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.reviewDegraded).toBe(true);
		expect(result.failure).toMatchObject({ role: "reviewer", code: "timeout" });
		expect(result.budget.providerCalls).toBe(1);
	});

	it("keeps answer-bearing metadata out of both semantic contexts", async () => {
		const sourcePacket = packet(["段落0-段落3"], {
			sourceName: "HIDDEN_CASE_16D.docx",
			reviewContext: { expectedRanges: ["SENTINEL_EXPECTED_RANGE"] },
		});
		const reviewerClaim = "SENTINEL_REVIEWER_CLAIM";
		const { result, calls } = await run(
			[
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(["段落0-段落2"], reviewerClaim),
					"reviewer-isolation",
				),
				tool(
					"submit_pi_native_delta_adjudication",
					adjudication("accept_candidate", "Candidate remains safer."),
					"adjudicator-isolation",
				),
			],
			sourcePacket,
		);

		expect(result.sourceName).toBe("HIDDEN_CASE_16D.docx");
		for (const call of calls) {
			const semanticContext = `${call.systemPrompt}\n${call.userPrompt}`;
			expect(semanticContext).not.toContain("HIDDEN_CASE_16D");
			expect(semanticContext).not.toContain("SENTINEL_EXPECTED_RANGE");
			expect(semanticContext).not.toContain("expectedRanges");
		}
		expect(calls[0].userPrompt).not.toContain("candidateRanges=");
		expect(calls[0].userPrompt).not.toContain("<CANDIDATE_AUDIT>");
		expect(calls[1].userPrompt).toContain('candidateRanges=["段落0-段落3"]');
		expect(calls[1].userPrompt).not.toContain("<CANDIDATE_AUDIT>");
		expect(calls[1].userPrompt).toContain(reviewerClaim);
	});

	it("exposes only deterministic candidate, sequence, heading, and table facts", () => {
		const blocks = [
			block(0, "1、第一项", {
				markerKind: "arabic_comma",
				markerToken: "1、",
				sequenceGroupStartBlockId: 0,
			}),
			block(1, "2、第二项", {
				markerKind: "arabic_comma",
				markerToken: "2、",
				sequenceGroupStartBlockId: 0,
			}),
			block(2, "Word 编号项一", { numberingId: 7, numberingLevel: 0 }),
			block(3, "Word 编号项二", { numberingId: 7, numberingLevel: 0 }),
			block(4, "1、服务维度", { markerKind: "arabic_comma", markerToken: "1、" }),
			block(5, "3、培训维度", { markerKind: "arabic_comma", markerToken: "3、" }),
			block(6, "<table><tr><td>literal</td></tr></table>"),
			block(7, "表格原文", {
				kind: "table",
				rows: [
					["列1", "列2"],
					["值1", "值2"],
				],
				tableIndex: 3,
			}),
			block(8, "远端标题", {
				headingLevel: 2,
				outlineLevel: 1,
				tocLevel: 2,
				ancestorBlockIds: [0],
				parentBlockId: 7,
				candidateAncestorBlockIds: [0, 7],
			}),
		];
		const sourcePacket = packet(["段落1-段落5"], { blocks });
		const context = buildPiNativeDeltaEvidencePacket(sourcePacket);
		const repeated = buildPiNativeDeltaEvidencePacket(sourcePacket);

		expect(context.sha256).toBe(repeated.sha256);
		expect(context.sequenceFacts.map((fact) => fact.source)).toEqual([
			"packet",
			"word_numbering",
			"text_marker",
		]);
		expect(context.sequenceFacts[0]).toMatchObject({
			memberBlockIds: [0, 1],
		});
		expect(context.sequenceFacts[2].memberBlockIds).toEqual([4, 5]);
		expect(context.blockFacts[6]).toMatchObject({ kind: "paragraph", literalTable: true });
		expect(context.blockFacts[7]).toMatchObject({ kind: "table", rowCount: 2, tableIndex: 3 });
		expect(context.blockFacts[8]).toMatchObject({
			headingLevel: 2,
			outlineLevel: 1,
			tocLevel: 2,
			ancestorBlockIds: [0],
			parentBlockId: 7,
			candidateAncestorBlockIds: [0, 7],
		});
		expect(context.text).toContain("id=8|range=段落8|");
		expect(context.text).toContain('members=["段落0@1、","段落1@2、"]');
		expect(context.text).not.toContain("<CANDIDATE_AUDIT>");
		expect(context.text).not.toContain("candidate=");
		expect(context.text).not.toContain("outside=");
		expect(context.text).not.toContain("C:head");
		expect(context.text).not.toContain("N:before");
		expect(context.text).not.toContain("<structure>");
		expect(context.text).not.toContain(sourcePacket.sourceName);
		expect(context.text).not.toContain("owner=");
		expect(context.text).not.toContain("risk=");
	});

	it("exposes an unambiguous literal cross-reference without selecting its semantics", () => {
		const sourcePacket = packet(["段落1-段落2"], {
			blocks: [
				block(0, "技术评分标准详见招标文件第六章表格“技术评分对照表”。"),
				block(1, "技术评分对照表（分值25分）"),
				block(2, "内容为表格<table><tr><td>技术方案</td><td>25分</td></tr></table>"),
			],
		});
		const context = buildPiNativeDeltaEvidencePacket(sourcePacket);

		expect(context.explicitReferences).toEqual([
			{ fromBlockId: 0, toBlockId: 1, anchor: "技术评分对照表" },
		]);
		expect(context.text).toContain(
			'R|from=段落0|to=段落1|anchor="技术评分对照表"',
		);
		expect(context.text).not.toContain("reference_target=true");
	});

	it("keeps compact full-source context below the deterministic representation gate", () => {
		const blocks = Array.from({ length: 2_054 }, (_, blockId) =>
			block(blockId, `正文${String(blockId).padStart(4, "0")}${"甲".repeat(34)}`),
		);
		const sourcePacket = packet(["段落100-段落200"], {
			blocks,
			sourceName: "MUST_NOT_ENTER_CONTEXT.docx",
			reviewContext: { expected: "MUST_NOT_ENTER_CONTEXT" },
		});
		const context = buildPiNativeDeltaEvidencePacket(sourcePacket);

		expect(context.sourceCharacterCount).toBeGreaterThan(80_000);
		expect(context.characterCount).toBeLessThanOrEqual(context.sourceCharacterCount * 2 + 8_000);
		expect(context.representationFit).toBe(true);
		expect(context.text).not.toContain("MUST_NOT_ENTER_CONTEXT");
		expect(context.text).not.toContain("styleName");
		expect(context.text).not.toContain("previousBlockIds");
		expect(context.text).not.toContain("<structure>");
	});

	describe("candidate-aware residual challenge v7", () => {
		it("reuses candidate provenance without injecting the legacy accepted Prompt", async () => {
			const sourcePacket = packet(["段落0-段落2"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(["段落0-段落2"]),
						"residual-preserve",
					),
				],
				sourcePacket,
				{ profile: "residual" },
			);

			expect(responseCount()).toBe(1);
			expect(calls[0].userPrompt).toContain('candidateRanges=["段落0-段落2"]');
			expect(calls[0].systemPrompt).toContain("Residual Challenger");
			expect(calls[0].systemPrompt).not.toContain("<output_contract>");
			expect(calls[0].systemPrompt).not.toContain("允许同一评价容器内无害偏宽");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v7");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.residual-challenge-review.v7",
			);
			expect(result.reviewProfile).toBe("residual");
			expect(result.prompts.candidate).toBe(residualPrompts.hashes.candidate);
			expect(result.resolution).toBe("candidate_preserved_by_set_equivalence");
		});

		it("changes candidate only after the exact residual proposal wins adjudication", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(
							["段落0-段落2"],
							"The separately addressable price block is contamination.",
						),
						"residual-challenge",
					),
					tool(
						"submit_pi_native_delta_adjudication",
						adjudication("accept_proposal", "The exact removal is source-grounded."),
						"residual-adjudication",
					),
				],
				sourcePacket,
				{ profile: "residual" },
			);

			expect(responseCount()).toBe(2);
			expect(calls.map((call) => call.role)).toEqual(["reviewer", "adjudicator"]);
			expect(calls[1].userPrompt).toContain("removedBlockIds=[3]");
			expect(calls[1].systemPrompt).toContain("Residual Delta Adjudicator");
			expect(calls[1].systemPrompt).not.toContain("<output_contract>");
			expect(result.resolution).toBe("proposal_accepted");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.budget.providerCalls).toBe(2);
		});

		it("fails closed without retrying an invalid residual challenge", async () => {
			const sourcePacket = packet(["段落0-段落2"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						{
							verdict: "degraded",
							evidence_block_ids: [],
							reason: "No decision.",
						},
						"invalid-residual",
					),
				],
				sourcePacket,
				{ profile: "residual" },
			);

			expect(responseCount()).toBe(1);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.failure).toMatchObject({ role: "reviewer", code: "contract_error" });
			expect(result.budget.providerCalls).toBe(1);
		});
	});

	describe("source-blind residual challenge v8", () => {
		it("keeps the complete Challenger input byte-identical across candidate variants", async () => {
			const responses = [
				tool(
					"submit_pi_native_delta_review",
					reviewerProposal(["段落0-段落1"]),
					"blind-independent",
				),
				tool(
					"submit_pi_native_delta_adjudication",
					adjudication("accept_candidate", "The protected answer is better supported."),
					"blind-adjudicator",
				),
			];
			const first = await run(responses, packet(["段落0-段落2"]), {
				profile: "blind_residual",
			});
			const second = await run(responses, packet(["段落1-段落2"]), {
				profile: "blind_residual",
			});

			expect(first.calls[0].systemPrompt).toBe(second.calls[0].systemPrompt);
			expect(first.calls[0].userPrompt).toBe(second.calls[0].userPrompt);
			expect(first.calls[0].toolParameterText).toBe(second.calls[0].toolParameterText);
			expect(first.result.context.reviewerInputSha256).toBe(
				second.result.context.reviewerInputSha256,
			);
			for (const review of [first, second]) {
				expect(review.calls[0].userPrompt).not.toContain("candidateRanges=");
				expect(review.calls[0].userPrompt).not.toContain("<MECHANICAL_SEQUENCES>");
				expect(review.calls[0].userPrompt).not.toContain("Q0|");
				expect(review.calls[0].userPrompt).not.toContain("Q=mechanical");
				expect(review.calls[0].systemPrompt).not.toContain("<output_contract>");
				expect(review.calls[0].systemPrompt).not.toContain("允许同一评价容器内无害偏宽");
				expect(review.result.context.format).toBe(
					"compact_mechanical_neutral_source_v4_no_sequences",
				);
				expect(review.result.context.sequenceCount).toBe(0);
			}
		});

		it("withholds the Challenger claim from claim-free exact-delta adjudication", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_BLIND_CHALLENGER_CLAIM";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(["段落0-段落2"], hiddenClaim),
						"blind-challenge",
					),
					tool(
						"submit_pi_native_delta_adjudication",
						adjudication("accept_proposal", "The exact proposal matches the source."),
						"blind-accept",
					),
				],
				sourcePacket,
				{ profile: "blind_residual" },
			);

			expect(responseCount()).toBe(2);
			expect(calls[1].userPrompt).toContain('setA_candidate_ranges=["段落0-段落3"]');
			expect(calls[1].userPrompt).toContain('setB_proposal_ranges=["段落0-段落2"]');
			expect(calls[1].userPrompt).toContain("setA_only_block_ids=[3]");
			expect(calls[1].userPrompt).toContain("setB_only_block_ids=[]");
			expect(calls[1].userPrompt).not.toContain(hiddenClaim);
			expect(calls[1].userPrompt).not.toContain("proposalClaim=");
			expect(calls[1].userPrompt).not.toContain("reviewerEvidenceBlockIds=");
			expect(calls[1].userPrompt).not.toContain("challengerEvidenceBlockIds=");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v8");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.blind-residual-review.v8",
			);
			expect(result.reviewProfile).toBe("blind_residual");
			expect(result.prompts.candidate).toBe(blindResidualPrompts.hashes.candidate);
			expect(result.resolution).toBe("proposal_accepted");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.budget.providerCalls).toBe(2);
		});

		it("fails closed after the second and final call when adjudication is invalid", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(["段落0-段落2"]),
						"blind-replacement",
					),
					tool(
						"submit_pi_native_delta_adjudication",
						{
							verdict: "accept_proposal",
							evidence_block_ids: [],
							reason: "Invalid empty evidence.",
						},
						"blind-invalid-adjudication",
					),
				],
				sourcePacket,
				{ profile: "blind_residual" },
			);

			expect(responseCount()).toBe(2);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({ role: "adjudicator", code: "contract_error" });
			expect(result.budget.providerCalls).toBe(2);
		});
	});

	describe("untrusted-candidate targeted repair v9", () => {
		it("fails closed after one call when no falsification envelope is opened", async () => {
			const sourcePacket = packet(["段落0-段落2"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(["段落0-段落2"], "No material challenge was found."),
						"targeted-no-challenge",
					),
				],
				sourcePacket,
				{ profile: "targeted_repair" },
			);

			expect(responseCount()).toBe(1);
			expect(calls.map((call) => call.role)).toEqual(["reviewer"]);
			expect(calls[0].userPrompt).toContain('untrustedCandidateRanges=["段落0-段落2"]');
			expect(calls[0].systemPrompt).not.toContain("<output_contract>");
			expect(calls[0].userPrompt).not.toContain("<MECHANICAL_SEQUENCES>");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v9");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.targeted-repair-review.v9",
			);
			expect(result.reviewProfile).toBe("targeted_repair");
			expect(result.context.format).toBe(
				"compact_mechanical_neutral_source_v4_no_sequences",
			);
			expect(result.context.sequenceCount).toBe(0);
			expect(result.prompts.candidate).toBe(targetedRepairPrompts.hashes.candidate);
			expect(result.status).toBe("degraded");
			expect(result.resolution).toBe("degraded_candidate_fallback");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.failure).toMatchObject({ role: "reviewer", code: "contract_error" });
		});

		it("lets the Finalizer partially accept a bounded challenge envelope", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_TARGETED_REVIEWER_CLAIM";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(["段落0-段落2", "段落4"], hiddenClaim),
						"targeted-envelope",
					),
					tool(
						"submit_pi_native_targeted_repair",
						{
							verdict: "publish",
							final_ranges: ["段落0-段落2"],
							evidence_block_ids: [1, 3, 4],
							reason: "Accept the removal challenge and reject the addition challenge.",
						},
						"targeted-finalizer",
					),
				],
				sourcePacket,
				{ profile: "targeted_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(calls.map((call) => call.role)).toEqual(["reviewer", "adjudicator"]);
			expect(calls[1].userPrompt).toContain('setA_candidate_ranges=["段落0-段落3"]');
			expect(calls[1].userPrompt).toContain(
				'setB_challenge_envelope_ranges=["段落0-段落2","段落4"]',
			);
			expect(calls[1].userPrompt).toContain("setB_only_addition_challenges=[4]");
			expect(calls[1].userPrompt).toContain("setA_only_removal_challenges=[3]");
			expect(calls[1].userPrompt).not.toContain(hiddenClaim);
			expect(calls[1].userPrompt).not.toContain("proposalClaim=");
			expect(result.resolution).toBe("targeted_repair_applied");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.patch?.removedBlockIds).toEqual([3]);
			expect(result.patch?.addedBlockIds).toEqual([]);
			expect(result.budget.providerCalls).toBe(2);
		});

		it("fails closed when the Finalizer adds a block outside the challenge envelope", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_delta_review",
						reviewerProposal(["段落0-段落2"]),
						"targeted-removal-envelope",
					),
					tool(
						"submit_pi_native_targeted_repair",
						{
							verdict: "publish",
							final_ranges: ["段落0-段落2", "段落4"],
							evidence_block_ids: [3, 4],
							reason: "Attempted unbounded addition.",
						},
						"targeted-outside-envelope",
					),
				],
				sourcePacket,
				{ profile: "targeted_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({ role: "adjudicator", code: "contract_error" });
			expect(result.budget.providerCalls).toBe(2);
		});
	});

	describe("residual issue repair v10", () => {
		it("uses an explicitly isolated Finalizer runtime without changing the Reviewer runtime", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, calls } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], ["段落3"], "Block 3 may be pollution."),
						"heterogeneous-issue-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "The removal is source-grounded."),
						"heterogeneous-issue-finalizer",
					),
				],
				sourcePacket,
				{
					profile: "targeted_issue_repair",
					adjudicatorModel,
				},
			);

			expect(calls.map((call) => call.modelId)).toEqual([
				reviewerModel.id,
				adjudicatorModel.id,
			]);
			expect(result.model.id).toBe(reviewerModel.id);
			expect(result.models).toEqual({
				reviewer: {
					provider: reviewerModel.provider,
					id: reviewerModel.id,
					contextWindow: reviewerModel.contextWindow,
				},
				adjudicator: {
					provider: adjudicatorModel.provider,
					id: adjudicatorModel.id,
					contextWindow: adjudicatorModel.contextWindow,
				},
			});
			expect(result.context.preflight.reviewerContextWindow).toBe(256_000);
			expect(result.context.preflight.adjudicatorContextWindow).toBe(128_000);
			expect(result.context.preflight.contextWindow).toBe(128_000);
		});

		it("mechanically applies only the Finalizer-approved challenge subset", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_RESIDUAL_ISSUE_CLAIM";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], hiddenClaim),
						"issue-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "Approve removal and reject addition."),
						"issue-finalizer",
					),
				],
				sourcePacket,
				{ profile: "targeted_issue_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(calls.map((call) => call.role)).toEqual(["reviewer", "adjudicator"]);
			expect(calls[1].userPrompt).toContain("additionChallengeBlockIds=[4]");
			expect(calls[1].userPrompt).toContain("removalChallengeBlockIds=[3]");
			expect(calls[1].userPrompt).toContain(
				`untrustedReviewerIssue=${JSON.stringify(hiddenClaim)}`,
			);
			expect(calls[1].userPrompt).toContain(
				"untrustedReviewerEvidenceBlockIds=[0,1,2,3,4]",
			);
			expect(calls[1].userPrompt).toContain("这是 mixed repair");
			expect(calls[1].toolParameterText).toContain('"approved_add_ranges"');
			expect(calls[1].toolParameterText).not.toContain('"final_ranges"');
			expect(result.resolution).toBe("targeted_repair_applied");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.patch?.removedBlockIds).toEqual([3]);
			expect(result.patch?.addedBlockIds).toEqual([]);
			expect(result.decisions.reviewerAddedBlockIds).toEqual([4]);
			expect(result.decisions.reviewerRemovedBlockIds).toEqual([3]);
			expect(result.budget.providerCalls).toBe(2);
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v10");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.targeted-issue-repair-review.v10",
			);
			expect(result.reviewProfile).toBe("targeted_issue_repair");
			expect(calls[0].userPrompt).toContain(
				'untrustedCandidateRanges=["段落0-段落3"]',
			);
			expect(calls[0].userPrompt).not.toContain("<MECHANICAL_SEQUENCES>");
		});

		it("rejects a Reviewer challenge with no effective membership delta", async () => {
			const sourcePacket = packet(["段落0-段落2"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], [], "No concrete delta."),
						"empty-issue-challenge",
					),
				],
				sourcePacket,
				{ profile: "targeted_issue_repair" },
			);

			expect(responseCount()).toBe(1);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.failure).toMatchObject({ role: "reviewer", code: "contract_error" });
		});

		it("mechanically ignores directionally redundant challenge blocks", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(
							["段落3-段落4"],
							["段落4"],
							"Only block 4 has a material effective addition challenge.",
						),
						"normalized-issue-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair(["段落4"], [], "Approve the effective addition."),
						"normalized-issue-finalizer",
					),
				],
				sourcePacket,
				{ profile: "blind_issue_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(calls[1].userPrompt).toContain("additionChallengeBlockIds=[4]");
			expect(calls[1].userPrompt).toContain("removalChallengeBlockIds=[]");
			expect(result.decisions.reviewerAddedBlockIds).toEqual([4]);
			expect(result.decisions.reviewerRemovedBlockIds).toEqual([]);
			expect(result.finalRanges).toEqual(["段落0-段落4"]);
		});

		it("recovers an all-directional-no-op submission as a bounded challenge", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(
							["段落3"],
							[],
							"Block 3 is the only exact membership challenge.",
						),
						"direction-recovered-issue-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "Approve the recovered removal challenge."),
						"direction-recovered-issue-finalizer",
					),
				],
				sourcePacket,
				{ profile: "targeted_issue_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(calls[1].userPrompt).toContain("additionChallengeBlockIds=[]");
			expect(calls[1].userPrompt).toContain("removalChallengeBlockIds=[3]");
			expect(result.decisions.reviewer).toMatchObject({
				add_ranges: ["段落3"],
				remove_ranges: [],
			});
			expect(result.decisions.reviewerAddedBlockIds).toEqual([]);
			expect(result.decisions.reviewerRemovedBlockIds).toEqual([3]);
			expect(result.status).toBe("complete");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
		});

		it("fails closed when Finalizer approves an unchallenged block", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], ["段落3"], "Block 3 may be pollution."),
						"bounded-issue-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落4"], "Attempted unchallenged removal."),
						"unbounded-issue-repair",
					),
				],
				sourcePacket,
				{ profile: "targeted_issue_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({ role: "adjudicator", code: "contract_error" });
		});
	});

	describe("claim-blind residual issue repair v11", () => {
		it("keeps Reviewer input identical while withholding its narrative from Finalizer", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_REVIEWER_NARRATIVE";
			const responses = [
				tool(
					"submit_pi_native_residual_issue_review",
					issueChallenge(["段落4"], ["段落3"], hiddenClaim),
					"blind-issue-challenge",
				),
				tool(
					"submit_pi_native_issue_repair",
					issueRepair([], ["段落3"], "Approve only the source-grounded removal."),
					"blind-issue-finalizer",
				),
			];
			const visible = await run(responses, sourcePacket, {
				profile: "targeted_issue_repair",
			});
			const blind = await run(responses, sourcePacket, {
				profile: "blind_issue_repair",
			});

			expect(blind.calls[0].systemPrompt).toBe(visible.calls[0].systemPrompt);
			expect(blind.calls[0].userPrompt).toBe(visible.calls[0].userPrompt);
			expect(blind.calls[0].toolParameterText).toBe(
				visible.calls[0].toolParameterText,
			);
			expect(blind.result.context.reviewerInputSha256).toBe(
				visible.result.context.reviewerInputSha256,
			);
			expect(blind.calls[1].userPrompt).toContain("additionChallengeBlockIds=[4]");
			expect(blind.calls[1].userPrompt).toContain("removalChallengeBlockIds=[3]");
			expect(blind.calls[1].userPrompt).toContain(
				"reviewerCommentVisibility=withheld",
			);
			expect(blind.calls[1].userPrompt).not.toContain(hiddenClaim);
			expect(blind.calls[1].userPrompt).not.toContain(
				"untrustedReviewerEvidenceBlockIds",
			);
			expect(blind.result.schemaVersion).toBe(
				"xique.score-review.pi-native-result.v11",
			);
			expect(blind.result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.blind-issue-repair-review.v11",
			);
			expect(blind.result.finalRanges).toEqual(["段落0-段落2"]);
		});
	});

	describe("selective release-gated residual issue repair v13", () => {
		it("skips the third call when Primary preserves the candidate", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], "Test one mixed residual issue."),
						"release-gated-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], [], "Neither exact challenge is source-grounded."),
						"release-gated-primary-preserve",
					),
				],
				sourcePacket,
				{ profile: "release_gated_issue_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(calls.map((call) => call.toolNames[0])).toEqual([
				"submit_pi_native_residual_issue_review",
				"submit_pi_native_issue_repair",
			]);
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.resolution).toBe("candidate_preserved_by_adjudicator");
			expect(result.decisions.release).toBeNull();
			expect(result.decisions.releaseSkippedReason).toBe(
				"primary_preserved_candidate",
			);
			expect(result.context.releaseInputSha256).toBeNull();
			expect(result.budget.providerCalls).toBe(2);
			expect(result.budget.maxProviderCalls).toBe(3);
		});

		it("lets Release veto an incorrect addition while publishing a supported removal", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_RELEASE_GATED_REVIEWER_CLAIM";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], hiddenClaim),
						"release-gated-mixed-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair(
							["段落4"],
							["段落3"],
							"Primary approves both exact changes.",
						),
						"release-gated-primary-change",
					),
					tool(
						"submit_pi_native_selective_release",
						issueRepair(
							[],
							["段落3"],
							"Release vetoes the addition and publishes only the removal.",
						),
						"release-gated-selective-veto",
					),
				],
				sourcePacket,
				{ profile: "release_gated_issue_repair" },
			);

			expect(responseCount()).toBe(3);
			expect(calls.map((call) => call.toolNames[0])).toEqual([
				"submit_pi_native_residual_issue_review",
				"submit_pi_native_issue_repair",
				"submit_pi_native_selective_release",
			]);
			expect(calls[2].userPrompt).toContain(
				"primaryApprovedAdditionBlockIds=[4]",
			);
			expect(calls[2].userPrompt).toContain(
				"primaryApprovedRemovalBlockIds=[3]",
			);
			expect(calls[2].userPrompt).not.toContain(hiddenClaim);
			expect(calls[2].userPrompt).not.toContain("additionChallengeBlockIds");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.patch?.addedBlockIds).toEqual([]);
			expect(result.patch?.removedBlockIds).toEqual([3]);
			expect(result.resolution).toBe("release_gated_repair_applied");
			expect(result.context.releaseInputSha256).toHaveLength(64);
			expect(result.decisions.releaseSkippedReason).toBeNull();
			expect(result.budget.providerCalls).toBe(3);
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v13");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.release-gated-issue-repair-review.v13",
			);
		});

		it("fails closed when Release approves a block that Primary did not approve", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], "Test exact mixed changes."),
						"release-subset-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "Primary approves only removal."),
						"release-subset-primary",
					),
					tool(
						"submit_pi_native_selective_release",
						issueRepair(["段落4"], ["段落3"], "Attempt to restore rejected addition."),
						"release-subset-violation",
					),
				],
				sourcePacket,
				{ profile: "release_gated_issue_repair" },
			);

			expect(responseCount()).toBe(3);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({
				role: "adjudicator",
				code: "contract_error",
			});
			expect(result.decisions.release).toBeNull();
			expect(result.budget.providerCalls).toBe(3);
		});

		it("fails closed when Release explicitly degrades", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], ["段落3"], "Test one removal."),
						"release-degraded-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "Primary approves removal."),
						"release-degraded-primary",
					),
					tool(
						"submit_pi_native_selective_release",
						{
							verdict: "degraded",
							evidence_block_ids: [],
							reason: "The immutable source cannot support reliable release.",
						},
						"release-explicit-degraded",
					),
				],
				sourcePacket,
				{ profile: "release_gated_issue_repair" },
			);

			expect(responseCount()).toBe(3);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({
				role: "adjudicator",
				code: "adjudicator_degraded",
			});
			expect(result.decisions.release).toMatchObject({ verdict: "degraded" });
		});

		it("keeps the first two semantic calls byte-identical to claim-blind v11", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const responses = [
				tool(
					"submit_pi_native_residual_issue_review",
					issueChallenge(["段落4"], ["段落3"], "Same isolated challenge."),
					"same-challenge",
				),
				tool(
					"submit_pi_native_issue_repair",
					issueRepair([], [], "Primary preserves candidate."),
					"same-primary",
				),
			];
			const blind = await run(responses, sourcePacket, {
				profile: "blind_issue_repair",
			});
			const gated = await run(responses, sourcePacket, {
				profile: "release_gated_issue_repair",
			});

			for (const index of [0, 1]) {
				expect(gated.calls[index].systemPrompt).toBe(blind.calls[index].systemPrompt);
				expect(gated.calls[index].userPrompt).toBe(blind.calls[index].userPrompt);
				expect(gated.calls[index].toolParameterText).toBe(
					blind.calls[index].toolParameterText,
				);
			}
		});
	});

	describe("full-challenge release residual issue repair v14", () => {
		it("can veto a Primary approval and publish a different Reviewer-opened challenge", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_FULL_CHALLENGE_REVIEWER_CLAIM";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], hiddenClaim),
						"full-challenge-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair(["段落4"], [], "Primary approves only the addition."),
						"full-challenge-primary",
					),
					tool(
						"submit_pi_native_full_challenge_release",
						issueRepair(
							[],
							["段落3"],
							"Release vetoes the addition and independently approves the removal.",
						),
						"full-challenge-release",
					),
				],
				sourcePacket,
				{ profile: "full_challenge_release" },
			);

			expect(responseCount()).toBe(3);
			expect(calls[2].userPrompt).toContain(
				"reviewerAdditionChallengeBlockIds=[4]",
			);
			expect(calls[2].userPrompt).toContain(
				"reviewerRemovalChallengeBlockIds=[3]",
			);
			expect(calls[2].userPrompt).toContain(
				"primaryDecisionVisibility=withheld",
			);
			expect(calls[2].userPrompt).not.toContain(hiddenClaim);
			expect(calls[2].userPrompt).not.toContain("primaryApproved");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.resolution).toBe("full_challenge_repair_applied");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v14");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.full-challenge-release-review.v14",
			);
			expect(result.budget.providerCalls).toBe(3);
		});

		it("fails closed when Release approves a block outside the Reviewer challenge", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], ["段落3"], "Test one exact removal."),
						"full-challenge-bounded-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "Primary approves the removal."),
						"full-challenge-bounded-primary",
					),
					tool(
						"submit_pi_native_full_challenge_release",
						issueRepair([], ["段落4"], "Attempt an unchallenged removal."),
						"full-challenge-outside-envelope",
					),
				],
				sourcePacket,
				{ profile: "full_challenge_release" },
			);

			expect(responseCount()).toBe(3);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({
				role: "adjudicator",
				code: "contract_error",
			});
		});

		it("still stops after two calls when Primary proposes no override", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], "Test a mixed challenge."),
						"full-challenge-skip-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], [], "Primary rejects every challenge."),
						"full-challenge-skip-primary",
					),
				],
				sourcePacket,
				{ profile: "full_challenge_release" },
			);

			expect(responseCount()).toBe(2);
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.decisions.releaseSkippedReason).toBe(
				"primary_preserved_candidate",
			);
			expect(result.budget.maxProviderCalls).toBe(3);
		});
	});

	describe("partial-group appeal residual issue repair v15", () => {
		it("opens only rejected members of a partially approved Reviewer range item", async () => {
			const sourcePacket = packet(["段落0-段落4"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], ["段落1-段落3"], "Test one grouped removal."),
						"partial-appeal-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落1"], "Primary removes only the first member."),
						"partial-appeal-primary",
					),
					tool(
						"submit_pi_native_partial_group_appeal_release",
						issueRepair(
							[],
							["段落1-段落3"],
							"Release confirms the Primary change and the bounded appeal.",
						),
						"partial-appeal-release",
					),
				],
				sourcePacket,
				{ profile: "partial_group_appeal_release" },
			);

			expect(responseCount()).toBe(3);
			expect(calls[2].userPrompt).toContain(
				"primaryApprovedRemovalBlockIds=[1]",
			);
			expect(calls[2].userPrompt).toContain(
				"partialGroupAppealRemovalBlockIds=[2,3]",
			);
			expect(result.finalRanges).toEqual(["段落0", "段落4"]);
			expect(result.resolution).toBe("partial_group_appeal_repair_applied");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v15");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.partial-group-appeal-release-review.v15",
			);
		});

		it("does not reopen a Reviewer range item that Primary rejected in full", async () => {
			const sourcePacket = packet(["段落0-段落4"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(
							[],
							["段落1-段落3", "段落4"],
							"Test one rejected group and one approved singleton.",
						),
						"partial-appeal-full-reject-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落4"], "Primary approves only the singleton."),
						"partial-appeal-full-reject-primary",
					),
					tool(
						"submit_pi_native_partial_group_appeal_release",
						issueRepair([], ["段落2", "段落4"], "Attempt to reopen a fully rejected item."),
						"partial-appeal-full-reject-release",
					),
				],
				sourcePacket,
				{ profile: "partial_group_appeal_release" },
			);

			expect(responseCount()).toBe(3);
			expect(calls[2].userPrompt).toContain(
				"partialGroupAppealRemovalBlockIds=[]",
			);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落4"]);
			expect(result.failure).toMatchObject({
				role: "adjudicator",
				code: "contract_error",
			});
		});

		it("can veto a Primary approval while accepting only the bounded appeal", async () => {
			const sourcePacket = packet(["段落0-段落4"]);
			const { result } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], ["段落1-段落3"], "Test a partial grouped issue."),
						"partial-appeal-veto-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落1"], "Primary approves the first member."),
						"partial-appeal-veto-primary",
					),
					tool(
						"submit_pi_native_partial_group_appeal_release",
						issueRepair([], ["段落2-段落3"], "Veto Primary and approve only appeal members."),
						"partial-appeal-veto-release",
					),
				],
				sourcePacket,
				{ profile: "partial_group_appeal_release" },
			);

			expect(result.finalRanges).toEqual(["段落0-段落1", "段落4"]);
			expect(result.patch?.removedBlockIds).toEqual([2, 3]);
		});
	});

	describe("reviewer-dialogue selective release v16", () => {
		it("shows the untrusted issue to Primary but hides it from selective Release", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const reviewerClaim = "SENTINEL_DIALOGUE_REVIEWER_ISSUE";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], reviewerClaim),
						"dialogue-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair(["段落4"], ["段落3"], "Primary approves both changes."),
						"dialogue-primary",
					),
					tool(
						"submit_pi_native_selective_release",
						issueRepair([], ["段落3"], "Release vetoes the addition."),
						"dialogue-release",
					),
				],
				sourcePacket,
				{ profile: "reviewer_dialogue_release" },
			);

			expect(responseCount()).toBe(3);
			expect(calls[1].userPrompt).toContain(
				`untrustedReviewerIssue=${JSON.stringify(reviewerClaim)}`,
			);
			expect(calls[2].userPrompt).not.toContain(reviewerClaim);
			expect(calls[2].userPrompt).not.toContain("untrustedReviewerIssue");
			expect(calls[2].userPrompt).toContain(
				"primaryApprovedAdditionBlockIds=[4]",
			);
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.resolution).toBe("dialogue_release_repair_applied");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v16");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.reviewer-dialogue-release-review.v16",
			);
		});

		it("keeps Reviewer input identical to v13 while changing only Primary visibility", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const responses = [
				tool(
					"submit_pi_native_residual_issue_review",
					issueChallenge(["段落4"], ["段落3"], "Same exact issue."),
					"dialogue-compare-reviewer",
				),
				tool(
					"submit_pi_native_issue_repair",
					issueRepair([], [], "Primary preserves candidate."),
					"dialogue-compare-primary",
				),
			];
			const blind = await run(responses, sourcePacket, {
				profile: "release_gated_issue_repair",
			});
			const dialogue = await run(responses, sourcePacket, {
				profile: "reviewer_dialogue_release",
			});

			expect(dialogue.calls[0].systemPrompt).toBe(blind.calls[0].systemPrompt);
			expect(dialogue.calls[0].userPrompt).toBe(blind.calls[0].userPrompt);
			expect(dialogue.calls[0].toolParameterText).toBe(
				blind.calls[0].toolParameterText,
			);
			expect(dialogue.calls[1].userPrompt).not.toBe(blind.calls[1].userPrompt);
			expect(dialogue.calls[1].userPrompt).toContain("untrustedReviewerIssue");
			expect(blind.calls[1].userPrompt).toContain(
				"reviewerCommentVisibility=withheld",
			);
		});
	});

	describe("adversarial-debate release v18", () => {
		it("gives the final judge the complete bounded attack and Primary response", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const reviewerClaim = "SENTINEL_ADVERSARIAL_REVIEWER_ATTACK";
			const primaryReason = "SENTINEL_ADVERSARIAL_PRIMARY_RESPONSE";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落4"], ["段落3"], reviewerClaim),
						"adversarial-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair(["段落4"], [], primaryReason),
						"adversarial-primary",
					),
					tool(
						"submit_pi_native_adversarial_debate_release",
						issueRepair(
							[],
							["段落3"],
							"The source supports the removal but defeats the addition.",
						),
						"adversarial-release",
					),
				],
				sourcePacket,
				{ profile: "adversarial_debate_release" },
			);

			expect(responseCount()).toBe(3);
			expect(calls.map((call) => call.toolNames[0])).toEqual([
				"submit_pi_native_residual_issue_review",
				"submit_pi_native_issue_repair",
				"submit_pi_native_adversarial_debate_release",
			]);
			expect(calls[2].userPrompt).toContain(
				`untrustedReviewerAttack=${JSON.stringify(reviewerClaim)}`,
			);
			expect(calls[2].userPrompt).toContain(
				`untrustedPrimaryResponse=${JSON.stringify(primaryReason)}`,
			);
			expect(calls[2].userPrompt).toContain(
				"reviewerAdditionChallengeBlockIds=[4]",
			);
			expect(calls[2].userPrompt).toContain(
				"reviewerRemovalChallengeBlockIds=[3]",
			);
			expect(calls[2].userPrompt).toContain(
				"primaryApprovedAdditionBlockIds=[4]",
			);
			expect(calls[2].userPrompt).toContain(
				"primaryRejectedRemovalBlockIds=[3]",
			);
			expect(calls[2].userPrompt).toContain(
				"本任务只判断 source membership",
			);
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.resolution).toBe("adversarial_debate_repair_applied");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v18");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.adversarial-debate-release-review.v18",
			);
			expect(result.budget.providerCalls).toBe(3);
		});

		it("keeps the first two calls byte-identical to v13", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const responses = [
				tool(
					"submit_pi_native_residual_issue_review",
					issueChallenge(["段落4"], ["段落3"], "Same bounded attack."),
					"adversarial-compare-reviewer",
				),
				tool(
					"submit_pi_native_issue_repair",
					issueRepair([], [], "Primary preserves candidate."),
					"adversarial-compare-primary",
				),
			];
			const v13 = await run(responses, sourcePacket, {
				profile: "release_gated_issue_repair",
			});
			const v18 = await run(responses, sourcePacket, {
				profile: "adversarial_debate_release",
			});

			for (const index of [0, 1]) {
				expect(v18.calls[index].systemPrompt).toBe(v13.calls[index].systemPrompt);
				expect(v18.calls[index].userPrompt).toBe(v13.calls[index].userPrompt);
				expect(v18.calls[index].toolParameterText).toBe(
					v13.calls[index].toolParameterText,
				);
			}
			expect(v18.result.budget.providerCalls).toBe(2);
			expect(v18.result.decisions.releaseSkippedReason).toBe(
				"primary_preserved_candidate",
			);
		});

		it("fails closed when the debate judge leaves the Reviewer envelope", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge([], ["段落3"], "Test one bounded removal."),
						"adversarial-bounded-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "Primary approves the removal."),
						"adversarial-bounded-primary",
					),
					tool(
						"submit_pi_native_adversarial_debate_release",
						issueRepair([], ["段落4"], "Attempt an unchallenged removal."),
						"adversarial-outside-envelope",
					),
				],
				sourcePacket,
				{ profile: "adversarial_debate_release" },
			);

			expect(responseCount()).toBe(3);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({
				role: "adjudicator",
				code: "contract_error",
			});
		});
	});

	describe("strict adversarial-debate release v19", () => {
		it("fails closed instead of reversing an invalid challenge direction", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(
							["段落3"],
							[],
							"Invalidly use addition to restate a candidate-present block.",
						),
						"strict-direction-reviewer",
					),
				],
				sourcePacket,
				{ profile: "strict_adversarial_debate_release" },
			);

			expect(responseCount()).toBe(1);
			expect(calls[0].userPrompt).toContain(
				"untrustedCandidateBlockIds=[0,1,2,3]",
			);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({
				role: "reviewer",
				code: "contract_error",
			});
		});

		it("escalates a fully rejected whole-candidate removal challenge", async () => {
			const sourcePacket = packet(["段落0-段落2"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(
							[],
							["段落0-段落2"],
							"The whole candidate lacks a valid evaluation relation.",
						),
						"strict-full-removal-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], [], "Primary rejects the whole removal attack."),
						"strict-full-removal-primary",
					),
					tool(
						"submit_pi_native_strict_adversarial_debate_release",
						issueRepair([], ["段落0-段落2"], "The complete source supports removal."),
						"strict-full-removal-release",
					),
				],
				sourcePacket,
				{ profile: "strict_adversarial_debate_release" },
			);

			expect(responseCount()).toBe(3);
			expect(calls.map((call) => call.toolNames[0])).toEqual([
				"submit_pi_native_residual_issue_review",
				"submit_pi_native_issue_repair",
				"submit_pi_native_strict_adversarial_debate_release",
			]);
			expect(calls[2].userPrompt).toContain(
				"primaryRejectedRemovalBlockIds=[0,1,2]",
			);
			expect(result.finalRanges).toEqual([]);
			expect(result.resolution).toBe(
				"strict_adversarial_debate_repair_applied",
			);
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v19");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.strict-adversarial-debate-release-review.v19",
			);
		});

		it("keeps an ordinary rejected local challenge on the two-call path", async () => {
			const sourcePacket = packet(["段落0-段落2"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						issueChallenge(["段落3"], [], "Test one local addition."),
						"strict-local-reviewer",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], [], "Primary rejects the local addition."),
						"strict-local-primary",
					),
				],
				sourcePacket,
				{ profile: "strict_adversarial_debate_release" },
			);

			expect(responseCount()).toBe(2);
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.decisions.releaseSkippedReason).toBe(
				"primary_preserved_candidate",
			);
			expect(result.context.releaseInputSha256).toBeNull();
		});
	});

	describe("single-issue candidate release v17", () => {
		it("preserves the candidate after one explicit Reviewer pass", async () => {
			const sourcePacket = packet(["段落0-段落2"]);
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_single_issue_review",
						singleIssuePass("No material residual issue is proven."),
						"single-issue-pass",
					),
				],
				sourcePacket,
				{ profile: "single_issue_release" },
			);

			expect(responseCount()).toBe(1);
			expect(calls.map((call) => call.role)).toEqual(["reviewer"]);
			expect(result.resolution).toBe("candidate_preserved_by_reviewer_pass");
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.reviewDegraded).toBe(false);
			expect(result.decisions.adjudicatorSkippedReason).toBe("reviewer_pass");
			expect(result.decisions.releaseSkippedReason).toBe("reviewer_pass");
			expect(result.budget.providerCalls).toBe(1);
			expect(result.budget.maxProviderCalls).toBe(3);
		});

		it("applies one exact include issue only after Primary and blind Release approve", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_SINGLE_ISSUE_CLAIM";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_single_issue_review",
						singleIssueChallenge("include", ["段落4"], hiddenClaim),
						"single-issue-reviewer",
					),
					tool(
						"submit_pi_native_single_issue_primary",
						singleIssueDecision("approve_change", "The exact include issue is supported."),
						"single-issue-primary",
					),
					tool(
						"submit_pi_native_single_issue_release",
						singleIssueDecision("approve_change", "Blind release independently approves."),
						"single-issue-release",
					),
				],
				sourcePacket,
				{ profile: "single_issue_release" },
			);

			expect(responseCount()).toBe(3);
			expect(calls[1].userPrompt).toContain(
				`untrustedReviewerIssue=${JSON.stringify(hiddenClaim)}`,
			);
			expect(calls[2].userPrompt).not.toContain(hiddenClaim);
			expect(calls[2].userPrompt).toContain('issueDesiredMembership="include"');
			expect(calls[2].toolParameterText).not.toContain("approved_add_ranges");
			expect(result.finalRanges).toEqual(["段落0-段落4"]);
			expect(result.resolution).toBe("single_issue_repair_applied");
			expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v17");
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.single-issue-release-review.v17",
			);
			expect(result.context.releaseInputSha256).toHaveLength(64);
		});

		it("stops after Primary rejects the whole issue", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_single_issue_review",
						singleIssueChallenge("exclude", ["段落3"], "Test one removal."),
						"single-issue-rejected-reviewer",
					),
					tool(
						"submit_pi_native_single_issue_primary",
						singleIssueDecision("reject_change", "The whole issue is unsupported."),
						"single-issue-primary-reject",
					),
				],
				sourcePacket,
				{ profile: "single_issue_release" },
			);

			expect(responseCount()).toBe(2);
			expect(result.resolution).toBe("candidate_preserved_by_primary_rejection");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.context.releaseInputSha256).toBeNull();
			expect(result.decisions.releaseSkippedReason).toBe(
				"primary_rejected_change",
			);
		});

		it("lets blind Release reject the whole Primary-approved issue", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_single_issue_review",
						singleIssueChallenge("exclude", ["段落3"], "Test one removal."),
						"single-issue-release-reject-reviewer",
					),
					tool(
						"submit_pi_native_single_issue_primary",
						singleIssueDecision("approve_change", "Primary approves removal."),
						"single-issue-release-reject-primary",
					),
					tool(
						"submit_pi_native_single_issue_release",
						singleIssueDecision("reject_change", "Blind release rejects removal."),
						"single-issue-release-reject",
					),
				],
				sourcePacket,
				{ profile: "single_issue_release" },
			);

			expect(responseCount()).toBe(3);
			expect(result.resolution).toBe("candidate_preserved_by_release_rejection");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.reviewDegraded).toBe(false);
		});

		it("fails closed instead of recovering an action with invalid candidate membership", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const { result, responseCount } = await run(
				[
					tool(
						"submit_pi_native_single_issue_review",
						singleIssueChallenge(
							"include",
							["段落3"],
							"Invalid attempt to include a candidate-present block.",
						),
						"single-issue-invalid-membership",
					),
				],
				sourcePacket,
				{ profile: "single_issue_release" },
			);

			expect(responseCount()).toBe(1);
			expect(result.status).toBe("degraded");
			expect(result.finalRanges).toEqual(["段落0-段落3"]);
			expect(result.failure).toMatchObject({
				role: "reviewer",
				code: "contract_error",
			});
		});
	});

	describe("membership-derived residual issue repair v12", () => {
		it("mechanically derives challenge direction from candidate membership", async () => {
			const sourcePacket = packet(["段落0-段落3"]);
			const hiddenClaim = "SENTINEL_MEMBERSHIP_ISSUE";
			const { result, calls, responseCount } = await run(
				[
					tool(
						"submit_pi_native_residual_issue_review",
						membershipChallenge(["段落3-段落4"], hiddenClaim),
						"membership-issue-challenge",
					),
					tool(
						"submit_pi_native_issue_repair",
						issueRepair([], ["段落3"], "Approve only the candidate-present challenge."),
						"membership-issue-finalizer",
					),
				],
				sourcePacket,
				{ profile: "membership_issue_repair" },
			);

			expect(responseCount()).toBe(2);
			expect(calls[0].toolParameterText).toContain('"challenge_ranges"');
			expect(calls[0].toolParameterText).not.toContain(
				'"add_ranges"',
			);
			expect(calls[0].toolParameterText).not.toContain(
				'"remove_ranges"',
			);
			expect(calls[1].userPrompt).toContain("additionChallengeBlockIds=[4]");
			expect(calls[1].userPrompt).toContain("removalChallengeBlockIds=[3]");
			expect(calls[1].userPrompt).not.toContain(hiddenClaim);
			expect(result.decisions.reviewerAddedBlockIds).toEqual([4]);
			expect(result.decisions.reviewerRemovedBlockIds).toEqual([3]);
			expect(result.finalRanges).toEqual(["段落0-段落2"]);
			expect(result.schemaVersion).toBe(
				"xique.score-review.pi-native-result.v12",
			);
			expect(result.contractVersion).toBe(
				"score-extraction-reviewer.pi-native.membership-issue-repair-review.v12",
			);
		});
	});
});
