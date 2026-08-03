import { createHash } from "node:crypto";
import {
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	registerFauxProvider,
	streamSimple,
	type FauxProviderRegistration,
	type FauxResponseStep,
} from "@earendil-works/pi-ai/compat";
import { afterEach, expect, test } from "vitest";
import { loadRequirementReviewPrompts, parseRequirementReviewPacket } from "./index.ts";
import {
	type PiNativeCandidateS0ChallengeSubmission,
	runPiNativeCandidateS0Review,
} from "./pi-native-candidate-s0.ts";

const prompts = await loadRequirementReviewPrompts(
	new URL("../../skills/word-requirement-extraction-reviewer/references", import.meta.url)
		.pathname,
);
const challengerPrompt = "Independently challenge only bounded Candidate S0 mistakes.";
const finalizerPrompt = "Adjudicate only the supplied bounded challenge envelope.";
const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
	for (const registration of registrations.splice(0)) registration.unregister();
});

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function packet(options: {
	sourceName?: string;
	candidateId?: string;
	candidatePromptSha256?: string;
	initialRanges?: string[];
	texts?: string[];
} = {}) {
	const texts =
		options.texts ??
		[
			"采购公告。",
			"设备应支持接口联调。",
			"合同付款条款。",
			"系统应提供运行记录。",
			"响应文件格式模板。",
		];
	const blocks = texts.map((text, blockId) => ({ blockId, text }));
	return parseRequirementReviewPacket({
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: options.sourceName ?? "candidate-s0.docx",
		sourceSha256: sha256(
			blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
		),
		blockCount: blocks.length,
		candidateId: options.candidateId ?? "requirement-candidate-a",
		candidatePromptSha256: options.candidatePromptSha256 ?? "1".repeat(64),
		initialRanges: options.initialRanges ?? ["段落1-段落2"],
		blocks,
	});
}

function emptyChallenge(): PiNativeCandidateS0ChallengeSubmission {
	return { remove_partitions: [], add_partitions: [] };
}

function boundedChallenge(): PiNativeCandidateS0ChallengeSubmission {
	return {
		remove_partitions: [
			{
				target_ranges: ["段落2"],
				source_conclusion: "The cited source identifies a removable Candidate block.",
				supporting_block_ids: [2],
			},
		],
		add_partitions: [
			{
				target_ranges: ["段落3"],
				source_conclusion: "The cited source identifies an omitted requirement block.",
				supporting_block_ids: [3],
			},
		],
	};
}

function challengerResponse(challenge: unknown) {
	return fauxAssistantMessage(JSON.stringify(challenge), { stopReason: "stop" });
}

function finalizerResponse(
	value: Record<string, unknown>,
	id = "candidate-s0-finalizer",
) {
	return fauxAssistantMessage(
		fauxToolCall("submit_final_selection", value, { id }),
		{ stopReason: "toolUse" },
	);
}

function createFaux(responses: FauxResponseStep[]): FauxProviderRegistration {
	const registration = registerFauxProvider({
		provider: "candidate-s0-faux",
		models: [
			{
				id: "candidate-s0-faux-model",
				reasoning: true,
				contextWindow: 1_000_000,
				maxTokens: 16_000,
			},
		],
	});
	registration.setResponses(responses);
	registrations.push(registration);
	return registration;
}

async function runReview(
	registration: FauxProviderRegistration,
	options: {
		sourcePacket?: ReturnType<typeof packet>;
		packetSha256?: string;
	} = {},
) {
	const model = registration.getModel();
	return runPiNativeCandidateS0Review({
		packet: options.sourcePacket ?? packet(),
		packetSha256: options.packetSha256 ?? "0".repeat(64),
		prompts,
		challengerPrompt,
		challengerPromptSha256: sha256(challengerPrompt),
		finalizerPrompt,
		finalizerPromptSha256: sha256(finalizerPrompt),
		challengerRuntime: {
			model,
			streamFunction: streamSimple,
			apiKey: "faux-key",
		},
		finalizerRuntime: {
			model,
			streamFunction: streamSimple,
			apiKey: "faux-key",
		},
	});
}

test("preserves Candidate S0 after one empty Challenger call", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({ accepted_remove_ranges: [], accepted_add_ranges: [] }, "unused"),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("challenger_no_change");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.patch).toBeNull();
	expect(result.budget.providerCalls).toBe(1);
	expect(result.budget.roles.challenger.providerCalls).toBe(1);
	expect(result.budget.roles.finalizer.providerCalls).toBe(0);
	expect(registration.state.callCount).toBe(1);
	expect(registration.getPendingResponseCount()).toBe(1);
});

test("applies only the accepted remove and add envelope", async () => {
	const registration = createFaux([
		challengerResponse(boundedChallenge()),
		finalizerResponse({
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: ["段落3"],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.resolution).toBe("finalizer_applied_repair");
	expect(result.candidateRanges).toEqual(["段落1-段落2"]);
	expect(result.finalRanges).toEqual(["段落1", "段落3"]);
	expect(result.patch).toEqual({ addRanges: ["段落3"], removeRanges: ["段落2"] });
	expect(result.challenge).toMatchObject({
		removeEnvelopeRanges: ["段落2"],
		removeEnvelopeBlockIds: [2],
		addEnvelopeRanges: ["段落3"],
		addEnvelopeBlockIds: [3],
	});
	expect(result.decision).toMatchObject({
		removeRanges: ["段落2"],
		removeBlockIds: [2],
		addRanges: ["段落3"],
		addBlockIds: [3],
		finalRanges: ["段落1", "段落3"],
	});
	expect(result.budget.providerCalls).toBe(2);
	expect(registration.state.callCount).toBe(2);
	expect(registration.getPendingResponseCount()).toBe(0);
});

test("fails closed when the Finalizer leaves the Challenger envelope", async () => {
	const registration = createFaux([
		challengerResponse(boundedChallenge()),
		finalizerResponse({
			accepted_remove_ranges: ["段落1"],
			accepted_add_ranges: ["段落4"],
		}),
	]);

	const result = await runReview(registration);

	expect(registration.state.callCount).toBe(2);
	expect(result.status).toBe("degraded");
	expect(result.resolution).toBe("review_incomplete");
	expect(result.reviewDegraded).toBe(true);
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.patch).toBeNull();
	expect(result.decision).toBeNull();
	expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
	expect(result.failure?.message).toContain(
		"Finalizer remove block 1 is outside the Challenger envelope",
	);
	expect(result.trace.finalizerRawSubmissions).toEqual([
		{
			accepted_remove_ranges: ["段落1"],
			accepted_add_ranges: ["段落4"],
		},
	]);
	expect(result.inputs.finalizerSha256).toMatch(/^[a-f0-9]{64}$/u);
});

test.each([
	{
		name: "Challenger provider error",
		responses: [
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "injected Challenger provider failure",
			}),
		],
		expectedRole: "challenger",
		expectedCode: "provider_error",
		expectedCalls: 1,
	},
	{
		name: "invalid Challenger JSON",
		responses: [fauxAssistantMessage('{"remove_partitions":', { stopReason: "stop" })],
		expectedRole: "challenger",
		expectedCode: "contract_error",
		expectedCalls: 1,
	},
	{
		name: "invalid Challenger schema",
		responses: [
			challengerResponse({
				remove_partitions: [],
				add_partitions: [],
				unexpected: true,
			}),
		],
		expectedRole: "challenger",
		expectedCode: "contract_error",
		expectedCalls: 1,
	},
	{
		name: "Finalizer provider error",
		responses: [
			challengerResponse(boundedChallenge()),
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "injected Finalizer provider failure",
			}),
		],
		expectedRole: "finalizer",
		expectedCode: "provider_error",
		expectedCalls: 2,
	},
	{
		name: "invalid Finalizer schema",
		responses: [
			challengerResponse(boundedChallenge()),
			finalizerResponse({ accepted_remove_ranges: ["段落2"] }),
		],
		expectedRole: "finalizer",
		expectedCode: "contract_error",
		expectedCalls: 2,
	},
] as const)(
	"preserves Candidate S0 on $name",
	async ({ responses, expectedRole, expectedCode, expectedCalls }) => {
		const registration = createFaux([...responses]);

		const result = await runReview(registration);

		expect(registration.state.callCount).toBe(expectedCalls);
		expect(result.status).toBe("degraded");
		expect(result.resolution).toBe("review_incomplete");
		expect(result.reviewDegraded).toBe(true);
		expect(result.candidateRanges).toEqual(["段落1-段落2"]);
		expect(result.finalRanges).toEqual(["段落1-段落2"]);
		expect(result.patch).toBeNull();
		expect(result.failure).toMatchObject({
			role: expectedRole,
			code: expectedCode,
		});
	},
);

test("records the raw Challenger response when target authorization fails", async () => {
	const invalidChallenge: PiNativeCandidateS0ChallengeSubmission = {
		remove_partitions: [],
		add_partitions: [
			{
				target_ranges: ["段落1"],
				source_conclusion: "The target is intentionally outside the add authorization.",
				supporting_block_ids: [1],
			},
		],
	};
	const rawResponse = JSON.stringify(invalidChallenge);
	const registration = createFaux([challengerResponse(invalidChallenge)]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.failure).toMatchObject({
		role: "challenger",
		code: "contract_error",
	});
	expect(result.trace.challengerRawResponse).toBe(rawResponse);
	expect(result.trace.challengerNormalizedResponse).toEqual(invalidChallenge);
	expect(result.trace.challengerStopReason).toBe("stop");
	expect(result.inputs.challengerSha256).toMatch(/^[a-f0-9]{64}$/u);
});

test("continues with valid partitions when another partition is unauthorized", async () => {
	const mixedChallenge: PiNativeCandidateS0ChallengeSubmission = {
		remove_partitions: [boundedChallenge().remove_partitions[0]],
		add_partitions: [
			{
				target_ranges: ["段落1"],
				source_conclusion: "The target is intentionally outside the add authorization.",
				supporting_block_ids: [1],
			},
		],
	};
	const registration = createFaux([
		challengerResponse(mixedChallenge),
		finalizerResponse({
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "add",
			partitionIndex: 0,
			reason: "add challenge block 1 already belongs to Candidate S0",
		},
	]);
	expect(result.challenge?.addPartitions).toEqual([]);
	expect(result.budget.providerCalls).toBe(2);
});

test("ignores and hashes Finalizer auxiliary text", async () => {
	const registration = createFaux([
		challengerResponse(boundedChallenge()),
		fauxAssistantMessage(
			[
				fauxText("ignored auxiliary explanation"),
				fauxToolCall("submit_final_selection", {
					accepted_remove_ranges: ["段落2"],
					accepted_add_ranges: [],
				}),
			],
			{ stopReason: "toolUse" },
		),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.trace.finalizerAuxiliaryText).toEqual({
		blockCount: 1,
		characterCount: "ignored auxiliary explanation".length,
		sha256: sha256("ignored auxiliary explanation"),
		forwarded: false,
	});
});

test("keeps the capability hash independent of packet and Candidate data", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		challengerResponse(emptyChallenge()),
	]);
	const firstPacket = packet();
	const secondPacket = packet({
		sourceName: "different-case.docx",
		candidateId: "requirement-candidate-b",
		candidatePromptSha256: "2".repeat(64),
		initialRanges: ["段落0", "段落4"],
		texts: [
			"另一项目的采购公告。",
			"另一项目的技术要求。",
			"另一项目的合同条款。",
			"另一项目的响应格式。",
			"另一项目的设备参数。",
		],
	});

	const first = await runReview(registration, {
		sourcePacket: firstPacket,
		packetSha256: "a".repeat(64),
	});
	const second = await runReview(registration, {
		sourcePacket: secondPacket,
		packetSha256: "b".repeat(64),
	});

	expect(registration.state.callCount).toBe(2);
	expect(first.packetSha256).not.toBe(second.packetSha256);
	expect(first.candidateId).not.toBe(second.candidateId);
	expect(first.candidatePromptSha256).not.toBe(second.candidatePromptSha256);
	expect(first.candidateRanges).not.toEqual(second.candidateRanges);
	expect(first.capabilitySha256).toBe(second.capabilitySha256);
});
