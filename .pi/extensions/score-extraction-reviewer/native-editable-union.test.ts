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
	loadPiNativeEditableUnionPrompts,
	runPiNativeEditableUnionReview,
} from "./native-bounded-membership.ts";
import { parseScoreReviewPacket, type ScoreReviewPacket } from "./reviewer.ts";

const prompts = await loadPiNativeEditableUnionPrompts(
	new URL("../../skills/score-extraction-reviewer/references", import.meta.url)
		.pathname,
);

const reviewerModel: Model<"openai-completions"> = {
	id: "gemini-reviewer-faux",
	name: "Gemini Reviewer Faux",
	api: "openai-completions",
	provider: "reviewer-faux",
	baseUrl: "https://example.invalid/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 2_000_000,
	maxTokens: 12_000,
};

const primaryModel: Model<"openai-completions"> = {
	...reviewerModel,
	id: "gemini-primary-faux",
	name: "Gemini Primary Faux",
	provider: "primary-faux",
};

interface ScriptStep {
	modelId: string;
	response: AssistantMessage;
}

interface CapturedCall {
	modelId: string;
	systemPrompt: string;
	userPrompt: string;
	toolSchemas: string[];
	maxTokens: number | undefined;
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
		streamFunction(selectedModel, context, options) {
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
				toolSchemas:
					context.tools?.map((candidate) =>
						JSON.stringify(candidate.parameters),
					) ?? [],
				maxTokens: options?.maxTokens,
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
		sourceName: "editable-union-fixture.docx",
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

async function run(sourcePacket: ScoreReviewPacket, streamFunction: StreamFn) {
	return runPiNativeEditableUnionReview({
		packet: sourcePacket,
		packetSha256: "b".repeat(64),
		prompts,
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

test("v91 Finalizer can remove candidate membership that Reviewer left common", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [2] },
				"reviewer-add",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: [1, 2] },
				"primary-edit-common",
			),
		},
	]);

	const result = await run(
		packet({
			texts: ["资格条件", "技术方案评分", "质量保障评分"],
			initialRanges: ["段落0-段落1"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.contractVersion).toBe(
		"score-extraction-reviewer.pi-native.hypothesis-terminal-adjudication.v91",
	);
	expect(result.schemaVersion).toBe(
		"xique.score-review.pi-native-hypothesis-terminal-adjudication-result.v91",
	);
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.patch?.addedBlockIds).toEqual([2]);
	expect(result.patch?.removedBlockIds).toEqual([0]);
	expect(result.budget.maxProviderCalls).toBe(2);
	expect(result.budget.maxOutputTokens).toBe(14_000);
	expect(scripted.calls.map((call) => call.maxTokens)).toEqual([7_000, 7_000]);
	expect(scripted.calls.flatMap((call) => call.toolSchemas).join("\n")).not.toContain(
		"evidence_block_ids",
	);
	expect(scripted.calls[1].userPrompt).toContain("reviewUniverseBlockIds=[0,1,2]");
	expect(scripted.calls[1].userPrompt).toContain(
		"<EDITABLE_UNION_MECHANICAL_SOURCE_SLICE>",
	);
	expect(scripted.calls[1].userPrompt).toContain("outputEligible=true");
	expect(scripted.calls[1].userPrompt).toContain(
		"The review universe is a mechanical recall ceiling",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		'hypothesisARanges=["段落0-段落1"]',
	);
	expect(scripted.calls[1].userPrompt).toContain(
		'hypothesisBRanges=["段落0-段落2"]',
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"hypothesisA=true|hypothesisB=true",
	);
	expect(scripted.calls[1].userPrompt).toContain(
		"hypothesisA=false|hypothesisB=true",
	);
	expect(scripted.calls[1].userPrompt).not.toContain("candidateMember");
	expect(scripted.calls[1].userPrompt).not.toContain("reviewerProposalMember");
	expect(
		scripted.calls[1].userPrompt.split("质量保障评分").length - 1,
	).toBe(1);
	expect(scripted.calls[1].userPrompt).not.toContain("challenge_type");
	expect(scripted.calls[0].userPrompt).toContain("untrustedCandidateBlockIds");
	expect(scripted.calls[0].systemPrompt).toContain(
		"# Frozen accepted single-prompt semantic core v019",
	);
	expect(scripted.calls[1].systemPrompt).toContain(
		"# Frozen accepted single-prompt semantic core v019",
	);
	expect(scripted.calls[0].systemPrompt).not.toContain("##mutation_scope##");
	expect(scripted.calls[0].systemPrompt).not.toContain(
		"# Pi-native v56 Editable-Union Review",
	);
	expect(scripted.calls[0].userPrompt.indexOf("<UNTRUSTED_SOURCE>")).toBeLessThan(
		scripted.calls[0].userPrompt.indexOf("<UNTRUSTED_LOCATOR_CANDIDATE>"),
	);
	expect(scripted.calls[0].toolSchemas.join("\n")).not.toContain(
		"challenge_type",
	);
});

test("v91 repeats candidate-linked literal-reference neighborhoods mechanically", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [1] },
				"reviewer-reference",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: [0, 1] },
				"primary-reference",
			),
		},
	]);

	const result = await run(
		packet({
			texts: [
				"技术评分对照表",
				"技术评分标准详见“技术评分对照表”",
				"商务评分标准",
			],
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(scripted.calls[0].userPrompt).toContain(
		"<CANDIDATE_LINKED_REFERENCE_NEIGHBORHOODS>",
	);
	expect(scripted.calls[0].userPrompt).toContain(
		'R|from=段落1|to=段落0|anchor="技术评分对照表"',
	);
	expect(scripted.calls[0].userPrompt).toContain("id=1|range=段落1");
});

test("v91 supports mixed deltas and final memberships larger than 64 IDs", async () => {
	const changeBlockIds = [
		...Array.from({ length: 10 }, (_, index) => index),
		...Array.from({ length: 20 }, (_, index) => index + 100),
	];
	const finalBlockIds = Array.from({ length: 100 }, (_, index) => index + 20);
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: changeBlockIds },
				"reviewer-mixed",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: finalBlockIds },
				"primary-many",
			),
		},
	]);

	const result = await run(
		packet({
			texts: Array.from({ length: 140 }, (_, index) => `源段落${index}`),
			initialRanges: ["段落0-段落99"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalBlockIds).toEqual(finalBlockIds);
	expect(result.finalRanges).toEqual(["段落20-段落119"]);
});

test("v91 sends an empty non-empty-candidate delta through independent Finalizer", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [] },
				"reviewer-pass",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: [0] },
				"primary-confirm",
			),
		},
	]);

	const result = await run(
		packet({ texts: ["技术方案得5分"], initialRanges: ["段落0"] }),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.resolution).toBe("editable_union_membership_selected");
	expect(result.budget.providerCalls).toBe(2);
	expect(scripted.callCount()).toBe(2);
});

test("v91 has no challenge_type semantic routing field", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [1] },
				"reviewer-mislabeled-add",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: [0, 1] },
				"primary-include",
			),
		},
	]);

	const result = await run(
		packet({
			texts: ["技术方案评分", "服务保障评分"],
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(scripted.calls[0].toolSchemas.join("\n")).not.toContain(
		"challenge_type",
	);
});

test("v91 rejects Finalizer membership outside the mechanical union", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [1] },
				"reviewer-add-one",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: [2] },
				"primary-outside",
			),
		},
	]);

	const result = await run(
		packet({
			texts: ["技术评分", "服务评分", "合同条款"],
			initialRanges: ["段落0"],
		}),
		scripted.streamFunction,
	);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.failure?.message).toContain("outside the editable review universe");
});

test("v91 does not apply the legacy representation-fit guard", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [] },
				"large-pass",
			),
		},
	]);
	const result = await run(
		packet({
			texts: Array.from({ length: 21_000 }, () => "评"),
		}),
		scripted.streamFunction,
	);

	expect(result.context.representationFit).toBe(false);
	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.budget.providerCalls).toBe(1);
});

test("v91 keeps mechanically connected context source-ordered without semantic gap labels", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [0] },
				"gap-reviewer",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: [5] },
				"gap-primary",
			),
		},
	]);
	const result = await run(
		packet({
			texts: ["远端章标题", "远端章正文", "过程一", "过程二", "目标前文", "技术评分"],
			initialRanges: ["段落5"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落5"]);
	expect(scripted.calls[1].userPrompt).not.toContain("<SOURCE_GAP");
});

test("v91 mechanically ignores candidate-absent additions outside the fixed envelope", async () => {
	const scripted = scriptedStream([
		{
			modelId: reviewerModel.id,
			response: tool(
				"submit_pi_native_v57_complete_candidate_delta",
				{ change_block_ids: [0] },
				"outside-envelope-reviewer",
			),
		},
		{
			modelId: primaryModel.id,
			response: tool(
				"submit_pi_native_v57_editable_union_membership",
				{ included_review_universe_block_ids: [49] },
				"outside-envelope-primary",
			),
		},
	]);
	const result = await run(
		packet({
			texts: Array.from({ length: 50 }, (_, index) => `源段落${index}`),
			initialRanges: ["段落49"],
		}),
		scripted.streamFunction,
	);

	expect(result.status, JSON.stringify(result.failure)).toBe("complete");
	expect(result.finalRanges).toEqual(["段落49"]);
	expect(result.decisions.reviewer).toEqual({
		change_block_ids: [],
		ignored_out_of_envelope_block_ids: [0],
	});
	expect(scripted.calls[0].userPrompt).toContain(
		'candidateAbsentAdditionEnvelopeRanges=["段落29-段落49"]',
	);
});
