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
	loadPiNativeStrictAdversarialDebatePrompts,
	runPiNativeScoreReview,
} from "./native.ts";
import { parseScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadPiNativeStrictAdversarialDebatePrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url).pathname,
);

const reviewerModel: Model<"openai-completions"> = {
	id: "reviewer-lite",
	name: "Reviewer Lite Faux",
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
	id: "primary-lite",
	name: "Primary Lite Faux",
	provider: "primary-faux",
	contextWindow: 128_000,
};
const releaseModel: Model<"openai-completions"> = {
	...reviewerModel,
	id: "release-pro",
	name: "Release Pro Faux",
	provider: "release-faux",
	contextWindow: 512_000,
};

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

test("routes a strict adversarial debate release through an isolated runtime", async () => {
	const packet = parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "isolated-release-runtime.docx",
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
	const reviewer = scriptedStream(
		reviewerModel.id,
		tool(
			"submit_pi_native_residual_issue_review",
			{
				verdict: "challenge",
				add_ranges: [],
				remove_ranges: ["段落0-段落2"],
				issue_claim: "The whole candidate is supplier-authored drafting guidance without a terminal evaluation effect.",
				evidence_block_ids: [0, 1, 2],
			},
			"reviewer-removal",
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
				evidence_block_ids: [0, 1, 2],
				reason: "Primary rejects the complete removal challenge.",
			},
			"primary-rejection",
		),
	);
	const release = scriptedStream(
		releaseModel.id,
		tool(
			"submit_pi_native_strict_adversarial_debate_release",
			{
				verdict: "publish",
				approved_add_ranges: [],
				approved_remove_ranges: ["段落0-段落2"],
				evidence_block_ids: [0, 1, 2],
				reason: "The source contains drafting standards but no evaluator-owned terminal effect.",
			},
			"release-approval",
		),
	);

	const result = await runPiNativeScoreReview({
		packet,
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
		releaseRuntime: {
			model: releaseModel,
			streamFunction: release.streamFunction,
			apiKey: "release-key",
		},
		profile: "strict_adversarial_debate_release",
	});

	expect(reviewer.callCount()).toBe(1);
	expect(primary.callCount()).toBe(1);
	expect(release.callCount()).toBe(1);
	expect(result.finalRanges).toEqual([]);
	expect(result.schemaVersion).toBe("xique.score-review.pi-native-result.v19");
	expect(result.resolution).toBe("strict_adversarial_debate_repair_applied");
	expect(result.budget.providerCalls).toBe(3);
	expect(primary.userPrompts[0]).toContain("reviewerCommentVisibility=withheld");
	expect(primary.userPrompts[0]).not.toContain("The whole candidate is supplier-authored");
	expect(release.userPrompts[0]).toContain("untrustedReviewerAttack=");
	expect(release.userPrompts[0]).toContain("untrustedPrimaryResponse=");
	expect(result.models.reviewer.id).toBe(reviewerModel.id);
	expect(result.models.adjudicator.id).toBe(primaryModel.id);
	expect(result.releaseModel).toEqual({
		provider: releaseModel.provider,
		id: releaseModel.id,
		contextWindow: releaseModel.contextWindow,
	});
	expect(result.context.preflight.releaseContextWindow).toBe(512_000);
	expect(result.context.preflight.contextWindow).toBe(128_000);
});
