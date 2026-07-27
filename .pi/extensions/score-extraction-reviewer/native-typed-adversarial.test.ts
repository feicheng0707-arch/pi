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
	loadPiNativeTypedAdversarialPrompts,
	runPiNativeScoreReview,
} from "./native.ts";
import { parseScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadPiNativeTypedAdversarialPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);

const reviewerModel: Model<"openai-completions"> = {
	id: "typed-reviewer",
	name: "Typed Reviewer Faux",
	api: "openai-completions",
	provider: "reviewer-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};
const primaryModel: Model<"openai-completions"> = {
	...reviewerModel,
	id: "typed-primary",
	name: "Typed Primary Faux",
	provider: "primary-faux",
};
const releaseModel: Model<"openai-completions"> = {
	...reviewerModel,
	id: "typed-release",
	name: "Typed Release Faux",
	provider: "release-faux",
};

function packet() {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "typed-adversarial.docx",
		sourceSha256: "a".repeat(64),
		blockCount: 3,
		initialRanges: ["段落0-段落2"],
		locatorContext: {
			mode: "frozen_accepted_output",
			outcome: "ranges",
			completeSourceCoverage: true,
			windowCount: 1,
		},
		reviewContext: null,
		blocks: [0, 1, 2].map((blockId) => ({
			blockId,
			kind: "paragraph",
			text: `投标人应详细阐述方案 ${blockId}，内容完整、合理、针对性强。`,
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
				nextBlockIds: blockId < 2 ? [blockId + 1] : [],
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

function scriptedStream(expectedModelId: string, response: AssistantMessage): {
	streamFunction: StreamFn;
	callCount: () => number;
	userPrompts: string[];
} {
	let calls = 0;
	const userPrompts: string[] = [];
	return {
		streamFunction(selectedModel, context) {
			expect(selectedModel.id).toBe(expectedModelId);
			const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
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
				stream.push({ type: "start", partial: response });
				stream.push({ type: "done", reason: response.stopReason, message: response });
				stream.end(response);
			});
			return stream;
		},
		callCount: () => calls,
		userPrompts,
	};
}

test("typed Primary can reject a material challenge after two calls", async () => {
	const reviewer = scriptedStream(
		reviewerModel.id,
		tool(
			"submit_pi_native_typed_adversarial_review",
			{
				verdict: "challenge",
				add_ranges: [],
				remove_ranges: ["段落2"],
				challenge_basis: "separable_non_target_or_boundary_overrun",
				evidence_block_ids: [1, 2],
			},
			"reviewer-challenge",
		),
	);
	const primary = scriptedStream(
		primaryModel.id,
		tool(
			"submit_pi_native_issue_repair",
			{
				verdict: "publish",
				approved_add_ranges: [],
				approved_remove_ranges: [],
				evidence_block_ids: [1, 2],
				reason: "The challenged block remains inside the valid evaluation group.",
			},
			"primary-rejection",
		),
	);

	const result = await runPiNativeScoreReview({
		packet: packet(),
		packetSha256: "b".repeat(64),
		prompts,
		model: reviewerModel,
		streamFunction: reviewer.streamFunction,
		apiKey: "reviewer-key",
		adjudicatorRuntime: {
			model: primaryModel,
			streamFunction: primary.streamFunction,
			apiKey: "primary-key",
		},
		profile: "typed_adversarial_release",
	});

	expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v21");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.resolution).toBe("candidate_preserved_by_adjudicator");
	expect(result.budget.providerCalls).toBe(2);
	expect(result.decisions.releaseSkippedReason).toBe("primary_preserved_candidate");
	expect(primary.callCount()).toBe(1);
});

test("typed proof obligation reaches Primary and adversarial Release without prose", async () => {
	const reviewer = scriptedStream(
		reviewerModel.id,
		tool(
			"submit_pi_native_typed_adversarial_review",
			{
				verdict: "challenge",
				add_ranges: [],
				remove_ranges: ["段落0-段落2"],
				challenge_basis: "missing_valid_evaluator",
				evidence_block_ids: [0, 1, 2],
			},
			"reviewer-challenge",
		),
	);
	const primary = scriptedStream(
		primaryModel.id,
		tool(
			"submit_pi_native_issue_repair",
			{
				verdict: "publish",
				approved_add_ranges: [],
				approved_remove_ranges: ["段落0-段落2"],
				evidence_block_ids: [0, 1, 2],
				reason: "No evaluator-owned terminal effect is present.",
			},
			"primary-approval",
		),
	);
	const release = scriptedStream(
		releaseModel.id,
		tool(
			"submit_pi_native_selective_release",
			{
				verdict: "publish",
				approved_add_ranges: [],
				approved_remove_ranges: ["段落0-段落2"],
				evidence_block_ids: [0, 1, 2],
				reason: "The candidate cannot establish a valid evaluation relation.",
			},
			"release-approval",
		),
	);

	const result = await runPiNativeScoreReview({
		packet: packet(),
		packetSha256: "c".repeat(64),
		prompts,
		model: reviewerModel,
		streamFunction: reviewer.streamFunction,
		apiKey: "reviewer-key",
		adjudicatorRuntime: {
			model: primaryModel,
			streamFunction: primary.streamFunction,
			apiKey: "primary-key",
		},
		releaseRuntime: {
			model: releaseModel,
			streamFunction: release.streamFunction,
			apiKey: "release-key",
		},
		profile: "typed_adversarial_release",
	});

	expect(result.finalRanges).toEqual([]);
	expect(result.resolution).toBe("release_gated_repair_applied");
	expect(result.budget.providerCalls).toBe(3);
	expect(primary.userPrompts[0]).toContain(
		'reviewerProofObligation="missing_valid_evaluator"',
	);
	expect(primary.userPrompts[0]).toContain("reviewerNarrativeVisibility=not_supplied");
	expect(release.userPrompts[0]).toContain(
		'reviewerProofObligation="missing_valid_evaluator"',
	);
	expect(release.userPrompts[0]).toContain("primaryReasonVisibility=withheld");
	expect(result.releaseModel?.id).toBe(releaseModel.id);
});

test("typed reviewer direction mismatch fails closed after one call", async () => {
	const reviewer = scriptedStream(
		reviewerModel.id,
		tool(
			"submit_pi_native_typed_adversarial_review",
			{
				verdict: "challenge",
				add_ranges: ["段落0"],
				remove_ranges: [],
				challenge_basis: "omitted_target_or_required_closure",
				evidence_block_ids: [0],
			},
			"invalid-direction",
		),
	);

	const result = await runPiNativeScoreReview({
		packet: packet(),
		packetSha256: "d".repeat(64),
		prompts,
		model: reviewerModel,
		streamFunction: reviewer.streamFunction,
		apiKey: "reviewer-key",
		profile: "typed_adversarial_release",
	});

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.budget.providerCalls).toBe(1);
	expect(result.failure?.code).toBe("contract_error");
});
