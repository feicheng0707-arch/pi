import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Context } from "@earendil-works/pi-ai";
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

const promptDirectory = new URL(
	"../../skills/word-requirement-extraction-reviewer/references/",
	import.meta.url,
);
const prompts = await loadRequirementReviewPrompts(promptDirectory.pathname);
const [candidateS0RuntimeContract, challengerPrompt, finalizerPrompt] =
	await Promise.all([
		readFile(new URL("candidate-s0-runtime-contract.md", promptDirectory), "utf8"),
		readFile(new URL("challenger-vnext.md", promptDirectory), "utf8"),
		readFile(new URL("targeted-finalizer-vnext.md", promptDirectory), "utf8"),
	]);
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
	blockIds?: number[];
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
	const blockIds = options.blockIds ?? texts.map((_, blockId) => blockId);
	if (blockIds.length !== texts.length) {
		throw new Error("blockIds length must match texts length");
	}
	const blocks = texts.map((text, index) => ({ blockId: blockIds[index], text }));
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
	return {
		hard_carrier_root_challenges: [],
		remove_partitions: [],
		remove_audit_partitions: [],
		add_partitions: [],
	};
}

function boundedChallenge(): PiNativeCandidateS0ChallengeSubmission {
	return {
		hard_carrier_root_challenges: [],
		remove_partitions: [
			{
				target_ranges: ["段落2"],
				source_conclusion: "The cited source identifies a removable Candidate block.",
				supporting_block_ids: [2],
			},
		],
		remove_audit_partitions: [],
		add_partitions: [
			{
				target_ranges: ["段落3"],
				source_conclusion: "The cited source identifies an omitted requirement block.",
				supporting_block_ids: [3],
			},
		],
	};
}

function auditChallenge(): PiNativeCandidateS0ChallengeSubmission {
	return {
		hard_carrier_root_challenges: [],
		remove_partitions: [],
		remove_audit_partitions: [
			{
				audit_kind: "mixed_atomic_scope",
				target_ranges: ["段落1-段落4"],
				audit_basis:
					"The bounded selected scope contains competing atomic membership roles requiring exact independent adjudication.",
				supporting_block_ids: [1, 2, 3, 4],
			},
		],
		add_partitions: [],
	};
}

function challengerResponse(challenge: unknown) {
	return fauxAssistantMessage(
		fauxToolCall("submit_final_selection", challenge, {
			id: "candidate-s0-challenger",
		}),
		{ stopReason: "toolUse" },
	);
}

function finalizerResponse(
	value: Record<string, unknown>,
	id = "candidate-s0-finalizer",
) {
	const submission = Object.hasOwn(value, "hard_carrier_root_vetoes")
		? value
		: { ...value, hard_carrier_root_vetoes: [] };
	return fauxAssistantMessage(
		fauxToolCall("submit_final_selection", submission, { id }),
		{ stopReason: "toolUse" },
	);
}

function createFaux(
	responses: FauxResponseStep[],
	contextWindow = 1_000_000,
): FauxProviderRegistration {
	const registration = registerFauxProvider({
		provider: "candidate-s0-faux",
		models: [
			{
				id: "candidate-s0-faux-model",
				reasoning: true,
				contextWindow,
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
		candidateS0RuntimeContract,
		candidateS0RuntimeContractSha256: sha256(candidateS0RuntimeContract),
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

test("keeps the v12 flat-projection and orthogonal hard-root prompts aligned", () => {
	expect(challengerPrompt).toContain("CANDIDATE_S0_SOURCE_PROJECTION_JSON.blocks[]");
	expect(challengerPrompt).toContain("MECHANICAL_S0_RUN_QUEUE_JSON.runs[]");
	expect(challengerPrompt).toContain("`hard_carrier_root_challenges`");
	expect(challengerPrompt).toContain(
		"顶层恰有 `hard_carrier_root_challenges`、`remove_partitions`、`remove_audit_partitions` 与 `add_partitions` 四个 non-nullable arrays",
	);
	expect(challengerPrompt).toContain("先裁决全部 singleton");
	expect(challengerPrompt).toContain("首 block与末 block");
	expect(challengerPrompt).toContain(
		"其 source-proven descendants 必须对 exact remove、neutral audit 和 add 完全沉默",
	);
	expect(challengerPrompt).not.toContain("sentinel");
	expect(challengerPrompt).toContain("heading/pointer/consequence residue fixed-point");
	expect(challengerPrompt).not.toContain("SOURCE_PROJECTION_JSON.runs");
	expect(candidateS0RuntimeContract).toContain(
		"把完整 `S0` 统一作为 ordinary remove 的机械 authorization",
	);
	expect(candidateS0RuntimeContract).toContain(
		"exact partition 在 canonical 合并前按原始 submitted range 拆成独立 group",
	);
	expect(finalizerPrompt).toContain("MECHANICAL_S0_RUN_QUEUE_JSON");
	expect(finalizerPrompt).toContain("未挑战 `S0` 仍可删除");
	expect(finalizerPrompt).toContain(
		"Root challenge 只是 attention/navigation，不是 veto授权或双钥匙",
	);
	expect(finalizerPrompt).toContain("`Δ-⊆S0`");
	expect(finalizerPrompt).toContain("`Δ+⊆ADD_ENVELOPE");
	expect(finalizerPrompt).not.toContain("`Δ-⊆S0∩REMOVE_ENVELOPE`");
	expect(finalizerPrompt).toContain(
		"hard_carrier_root_vetoes -> ordinary_remove_ranges -> ordinary_add_ranges",
	);
	expect(finalizerPrompt).toContain("`Δ-∩V=∅`");
});

test("runs the independent Finalizer after an empty challenge for non-empty S0", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({ ordinary_remove_ranges: [], ordinary_add_ranges: [] }, "unused"),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("finalizer_preserved");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.patch).toBeNull();
	expect(result.budget.providerCalls).toBe(2);
	expect(result.budget.roles.challenger.providerCalls).toBe(1);
	expect(result.budget.roles.finalizer.providerCalls).toBe(1);
	expect(registration.state.callCount).toBe(2);
	expect(registration.getPendingResponseCount()).toBe(0);
	expect(result.schemaVersion).toBe(
		"xique.word-requirement-review.pi-native-candidate-s0-result.v4",
	);
	expect(result.prompts.candidateS0RuntimeContract).toBe(
		sha256(candidateS0RuntimeContract),
	);
});

test("keeps valid typed root review after an independent rejection without forwarding conclusions", async () => {
	const contexts: Context[] = [];
	const rootTraceOnlyClaim = "TRACE_ONLY_ROOT_CHALLENGE_CLAIM_7A19D4E2";
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [
			{
				carrier_type: "response_format",
				root_block_id: 4,
				exit_block_id_exclusive: 3,
				projected_s0_anchor_block_id: 1,
				source_conclusion: "This root intentionally has a reversed boundary.",
				supporting_block_ids: [3, 4],
			},
			{
				carrier_type: "announcement_notice",
				root_block_id: 0,
				exit_block_id_exclusive: 3,
				projected_s0_anchor_block_id: 1,
				source_conclusion: rootTraceOnlyClaim,
				supporting_block_ids: [0, 1, 3],
			},
		],
		remove_partitions: [],
		remove_audit_partitions: [],
		add_partitions: [],
	};
	const registration = createFaux([
		(context) => {
			contexts.push(context);
			return challengerResponse(challenge);
		},
		(context) => {
			contexts.push(context);
			return finalizerResponse({
				ordinary_remove_ranges: [],
				ordinary_add_ranges: [],
			});
		},
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("preserved");
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "hard_root",
			partitionIndex: 0,
			reason:
				"hard_carrier_root_challenges[0] exit position 3 must follow root position 4 in source order",
		},
	]);
	expect(result.challenge?.hardCarrierRootChallenges).toMatchObject([
		{
			challengeIndex: 1,
			carrierType: "announcement_notice",
			rootBlockId: 0,
			exitBlockIdExclusive: 3,
			projectedS0AnchorBlockId: 1,
			projectedRanges: ["段落1-段落2"],
			sourceConclusion: rootTraceOnlyClaim,
			supportingBlockIds: [0, 1, 3],
		},
	]);
	expect(result.trace.challengerRawResponse).toContain(rootTraceOnlyClaim);
	const finalizerMessage = contexts[1]?.messages.find(
		(message) => message.role === "user",
	);
	if (finalizerMessage?.role !== "user") {
		throw new Error("Finalizer context omitted its user message");
	}
	const finalizerInput =
		typeof finalizerMessage.content === "string"
			? finalizerMessage.content
			: finalizerMessage.content
					.map((content) => (content.type === "text" ? content.text : ""))
					.join("");
	expect(finalizerInput).toContain(
		'"hard_root_review_groups":[{"challenge_index":1,"carrier_type":"announcement_notice","root_block_id":0,"exit_block_id_exclusive":3,"projected_s0_anchor_block_id":1,"supporting_block_ids":[0,1,3]}]',
	);
	expect(finalizerInput).not.toContain(rootTraceOnlyClaim);
	expect(result.decision?.hardCarrierRootChallengeMatches).toEqual([
		{ challengeIndex: 1, matchedVetoIndices: [] },
	]);
});

test("continues to the independent Finalizer when only root reviews are invalid", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 3,
					exit_block_id_exclusive: 4,
					projected_s0_anchor_block_id: 1,
					source_conclusion: "The anchor intentionally falls outside the span.",
					supporting_block_ids: [1, 3, 4],
				},
			],
			remove_partitions: [],
			remove_audit_partitions: [],
			add_partitions: [],
		}),
		finalizerResponse({ ordinary_remove_ranges: [], ordinary_add_ranges: [] }),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("finalizer_preserved");
	expect(result.budget.providerCalls).toBe(2);
	expect(result.challenge?.hardCarrierRootChallenges).toEqual([]);
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "hard_root",
			partitionIndex: 0,
			reason:
				"hard_carrier_root_challenges[0] anchor block 1 is outside the submitted root span",
		},
	]);
});

test("stops after an empty challenge when Candidate S0 is empty", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({ ordinary_remove_ranges: [], ordinary_add_ranges: [] }, "unused"),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: [] }),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("challenger_no_change");
	expect(result.finalRanges).toEqual([]);
	expect(result.budget.providerCalls).toBe(1);
	expect(registration.getPendingResponseCount()).toBe(1);
});

test("applies only the accepted remove and add envelope", async () => {
	const registration = createFaux([
		challengerResponse(boundedChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: ["段落3"],
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

test("allows the Finalizer to remove an S0 hard-carrier span outside the challenge envelope", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [
				{
					target_ranges: ["段落2"],
					source_conclusion: "One bounded atom requires review.",
					supporting_block_ids: [2],
				},
			],
			remove_audit_partitions: [],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 3,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.patch).toEqual({
		addRanges: [],
		removeRanges: ["段落2-段落4"],
	});
	expect(result.decision).toMatchObject({
		ordinaryRemoveRanges: ["段落2"],
		challengedOrdinaryRemoveRanges: ["段落2"],
		independentOrdinaryRemoveRanges: [],
		hardCarrierRemoveRanges: ["段落3-段落4"],
		removeRanges: ["段落2-段落4"],
		hardCarrierRootVetoes: [
			{
				vetoIndex: 0,
				carrierType: "contract_terms_and_formats",
				rootBlockId: 3,
				exitBlockIdExclusive: "EOF",
				projectedS0AnchorBlockId: 3,
				projectedRanges: ["段落3-段落4"],
			},
		],
	});
});

test("projects hard-carrier vetoes by source order when block IDs are sparse", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "announcement_notice",
					root_block_id: 5,
					exit_block_id_exclusive: 40,
					projected_s0_anchor_block_id: 10,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({
			initialRanges: ["段落10", "段落30"],
			blockIds: [5, 10, 30, 40],
			texts: ["root", "selected one", "selected two", "peer exit"],
		}),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.decision?.hardCarrierRemoveBlockIds).toEqual([10, 30]);
});

test("records root-review to veto matches without using the anchor as a gate", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [
				{
					carrier_type: "announcement_notice",
					root_block_id: 0,
					exit_block_id_exclusive: 3,
					projected_s0_anchor_block_id: 1,
					source_conclusion: "The source proposes one bounded announcement root.",
					supporting_block_ids: [0, 1, 3],
				},
			],
			remove_partitions: [],
			remove_audit_partitions: [],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "announcement_notice",
					root_block_id: 0,
					exit_block_id_exclusive: 3,
					projected_s0_anchor_block_id: 2,
				},
			],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.decision?.hardCarrierRootChallengeMatches).toEqual([
		{ challengeIndex: 0, matchedVetoIndices: [0] },
	]);
});

test("allows an independent ordinary remove anywhere inside Candidate S0", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落3"],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2", "段落4"]);
	expect(result.decision).toMatchObject({
		ordinaryRemoveRanges: ["段落3"],
		challengedOrdinaryRemoveRanges: [],
		independentOrdinaryRemoveRanges: ["段落3"],
	});
});

test("classifies challenged and independent ordinary removes as disjoint complete partitions", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [
				{
					target_ranges: ["段落2"],
					source_conclusion: "One exact Candidate block requires review.",
					supporting_block_ids: [2],
				},
			],
			remove_audit_partitions: [],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2", "段落4"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.decision).toMatchObject({
		ordinaryRemoveBlockIds: [2, 4],
		challengedOrdinaryRemoveBlockIds: [2],
		independentOrdinaryRemoveBlockIds: [4],
	});
	const challenged = new Set(
		result.decision?.challengedOrdinaryRemoveBlockIds ?? [],
	);
	const independent = new Set(
		result.decision?.independentOrdinaryRemoveBlockIds ?? [],
	);
	expect([...challenged].filter((blockId) => independent.has(blockId))).toEqual([]);
	expect([...challenged, ...independent].sort((left, right) => left - right)).toEqual(
		result.decision?.ordinaryRemoveBlockIds,
	);
});

test("fails closed when an ordinary remove leaves Candidate S0", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落3"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.failure?.message).toContain(
		"Finalizer remove block 3 is outside Candidate S0",
	);
});

test("fails closed on an ordinary wholesale reversal of non-empty Candidate S0", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落1-段落2"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.failure?.message).toContain(
		"ordinary_remove_ranges cannot remove the entire non-empty Candidate S0",
	);
});

test("continues after rejecting an effectless root veto when valid effects remain", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [
				{
					target_ranges: ["段落2"],
					source_conclusion: "One bounded atom requires review.",
					supporting_block_ids: [2],
				},
			],
			remove_audit_partitions: [],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "announcement_notice",
					root_block_id: 0,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 1,
				},
				{
					carrier_type: "bidder_instructions",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 1,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.decision).toMatchObject({
		rejectedHardCarrierRootVetoes: [
			{
				vetoIndex: 1,
				reason:
					"hard_carrier_root_vetoes[1] anchor block 1 is outside the submitted root span",
			},
		],
	});
});

test("fails closed when an accepted add conflicts with a hard-carrier root veto", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [],
			remove_audit_partitions: [],
			add_partitions: [
				{
					target_ranges: ["段落3"],
					source_conclusion: "One excluded block requires add review.",
					supporting_block_ids: [3],
				},
			],
		}),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: ["段落3"],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 2,
					exit_block_id_exclusive: 4,
					projected_s0_anchor_block_id: 2,
				},
			],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.failure).toMatchObject({
		role: "finalizer",
		code: "contract_error",
	});
	expect(result.failure?.message).toContain(
		"Finalizer add block 3 conflicts with hard-carrier root veto 0",
	);
});

test("allows a hard-carrier root veto to shadow mixed-audit challenge addresses", async () => {
	const registration = createFaux([
		challengerResponse(auditChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 3,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.patch).toEqual({
		addRanges: [],
		removeRanges: ["段落2-段落4"],
	});
});

test("allows a hard-carrier root veto to shadow an exact challenge address", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [
				{
					target_ranges: ["段落3"],
					source_conclusion: "The exact target is independently challenged.",
					supporting_block_ids: [3],
				},
			],
			remove_audit_partitions: [],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 3,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.decision?.challengedOrdinaryRemoveBlockIds).toEqual([]);
	expect(result.decision?.hardCarrierRemoveBlockIds).toEqual([3, 4]);
});

test("fails closed when ordinary remove duplicates a hard-carrier root veto", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [
				{
					target_ranges: ["段落3"],
					source_conclusion: "The exact target independently requires removal.",
					supporting_block_ids: [3],
				},
			],
			remove_audit_partitions: [],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: ["段落3"],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 3,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1-段落4"]);
	expect(result.decision).toBeNull();
	expect(result.failure?.message).toContain(
		"ordinary remove block 3 duplicates a hard-carrier root veto",
	);
});

test("allows a hard-carrier root to shadow recovery challenge addresses", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [],
			remove_audit_partitions: [
				{
					audit_kind: "recovery_boundary_scope",
					target_ranges: ["段落1-段落4"],
					audit_basis: "The complete later-module boundary requires recovery adjudication.",
					supporting_block_ids: [1, 4],
				},
			],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 3,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.decision?.challengedOrdinaryRemoveBlockIds).toEqual([2]);
	expect(result.decision?.hardCarrierRemoveBlockIds).toEqual([3, 4]);
});

test("fails closed when recovery ordinary delta duplicates its root veto", async () => {
	const registration = createFaux([
		challengerResponse({
			hard_carrier_root_challenges: [],
			remove_partitions: [],
			remove_audit_partitions: [
				{
					audit_kind: "recovery_boundary_scope",
					target_ranges: ["段落3-段落4"],
					audit_basis: "The complete later-module boundary requires recovery adjudication.",
					supporting_block_ids: [3, 4],
				},
			],
			add_partitions: [],
		}),
		finalizerResponse({
			ordinary_remove_ranges: ["段落3-段落4"],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "contract_terms_and_formats",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 3,
				},
			],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1-段落4"]);
	expect(result.decision).toBeNull();
	expect(result.failure?.message).toContain(
		"ordinary remove block 3 duplicates a hard-carrier root veto",
	);
});

test("fails closed when hard-carrier veto spans overlap", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "announcement_notice",
					root_block_id: 0,
					exit_block_id_exclusive: 3,
					projected_s0_anchor_block_id: 1,
				},
				{
					carrier_type: "bidder_instructions",
					root_block_id: 2,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 2,
				},
			],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.failure?.message).toContain(
		"hard_carrier_root_vetoes[1] overlaps veto 0 in source order",
	);
});

test("fails closed when a hard-carrier veto anchor is outside Candidate S0", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "response_format",
					root_block_id: 3,
					exit_block_id_exclusive: "EOF",
					projected_s0_anchor_block_id: 3,
				},
			],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.failure?.message).toContain(
		"hard_carrier_root_vetoes[0] anchor block 3 is outside Candidate S0",
	);
});

test("fails closed when a hard-carrier veto anchor is outside its root span", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: [],
			ordinary_add_ranges: [],
			hard_carrier_root_vetoes: [
				{
					carrier_type: "response_format",
					root_block_id: 2,
					exit_block_id_exclusive: 3,
					projected_s0_anchor_block_id: 1,
				},
			],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.failure?.message).toContain(
		"hard_carrier_root_vetoes[0] anchor block 1 is outside the submitted root span",
	);
});

test("applies a sparse remove subset inside a bounded neutral audit scope", async () => {
	const registration = createFaux([
		challengerResponse(auditChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2", "段落4"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("repaired");
	expect(result.candidateRanges).toEqual(["段落1-段落4"]);
	expect(result.finalRanges).toEqual(["段落1", "段落3"]);
	expect(result.patch).toEqual({
		addRanges: [],
		removeRanges: ["段落2", "段落4"],
	});
	expect(result.challenge).toMatchObject({
		removeAuditPartitions: [
			{
				partitionIndex: 0,
				targetRanges: ["段落1-段落4"],
				targetBlockIds: [1, 2, 3, 4],
			},
		],
		removeExactEnvelopeRanges: [],
		removeAuditEnvelopeRanges: ["段落1-段落4"],
		removeEnvelopeRanges: ["段落1-段落4"],
	});
	expect(result.coverage).toEqual({
		challenger: "complete",
		rejectedPartitionCount: 0,
	});
	expect(result.budget.providerCalls).toBe(2);
});

test("fails closed when the Finalizer removes a mixed atomic scope wholesale", async () => {
	const registration = createFaux([
		challengerResponse(auditChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落1-段落4"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落4"] }),
	});

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1-段落4"]);
	expect(result.failure?.message).toContain(
		"mixed_atomic_scope partition 0 cannot be removed wholesale",
	);
});

test("normalizes mechanically equivalent compact range syntax", async () => {
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [
			{
				target_ranges: ["段落1-2"],
				source_conclusion: "The exact selected range requires bounded review.",
				supporting_block_ids: [1, 2],
			},
		],
		remove_audit_partitions: [],
		add_partitions: [],
	};
	const registration = createFaux([
		challengerResponse(challenge),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.challenge?.removeExactEnvelopeRanges).toEqual(["段落1-段落2"]);
	expect(result.finalRanges).toEqual(["段落1"]);
});

test("fails closed when a neutral audit scope leaves Candidate S0", async () => {
	const registration = createFaux([challengerResponse(auditChallenge())]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.patch).toBeNull();
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "remove_audit",
			partitionIndex: 0,
			reason: "remove audit block 3 is outside Candidate S0",
		},
	]);
	expect(result.coverage).toEqual({
		challenger: "none",
		rejectedPartitionCount: 1,
	});
	expect(result.budget.providerCalls).toBe(1);
});

test("fails closed when the Finalizer leaves the Challenger envelope", async () => {
	const registration = createFaux([
		challengerResponse(boundedChallenge()),
		finalizerResponse({
			ordinary_remove_ranges: ["段落1"],
			ordinary_add_ranges: ["段落4"],
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
	expect(result.failure?.message).toContain("outside the Challenger envelope");
	expect(result.trace.finalizerRawSubmissions).toEqual([
		{
			ordinary_remove_ranges: ["段落1"],
			ordinary_add_ranges: ["段落4"],
			hard_carrier_root_vetoes: [],
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
		name: "Challenger text instead of tool call",
		responses: [
			fauxAssistantMessage(JSON.stringify(emptyChallenge()), { stopReason: "stop" }),
		],
		expectedRole: "challenger",
		expectedCode: "contract_error",
		expectedCalls: 1,
	},
	{
		name: "invalid Challenger schema",
			responses: [
				challengerResponse({
					hard_carrier_root_challenges: [],
					remove_partitions: [],
				remove_audit_partitions: [],
				add_partitions: [],
				unexpected: true,
			}),
		],
		expectedRole: "challenger",
		expectedCode: "contract_error",
		expectedCalls: 1,
	},
	{
		name: "missing required hard-carrier root challenge array",
		responses: [
			challengerResponse({
				remove_partitions: [],
				remove_audit_partitions: [],
				add_partitions: [],
			}),
		],
		expectedRole: "challenger",
		expectedCode: "contract_error",
		expectedCalls: 1,
	},
		{
			name: "Challenger supporting evidence exceeds the bounded output",
			responses: [
				challengerResponse({
					hard_carrier_root_challenges: [],
					remove_partitions: [
					{
						target_ranges: ["段落1"],
						source_conclusion: "The partition intentionally exceeds the evidence-ID cap.",
						supporting_block_ids: Array.from(
							{ length: 25 },
							(_, blockId) => blockId,
						),
					},
				],
				remove_audit_partitions: [],
				add_partitions: [],
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
			finalizerResponse({ ordinary_remove_ranges: ["段落2"] }),
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
		hard_carrier_root_challenges: [],
		remove_partitions: [],
		remove_audit_partitions: [],
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
	expect(result.trace.challengerStopReason).toBe("toolUse");
	expect(result.inputs.challengerSha256).toMatch(/^[a-f0-9]{64}$/u);
});

test("continues with partial coverage when one partition is unauthorized", async () => {
	const mixedChallenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [boundedChallenge().remove_partitions[0]],
		remove_audit_partitions: [],
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
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落2"] });
	expect(result.failure).toBeNull();
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "add",
			partitionIndex: 0,
			reason: "add challenge block 1 already belongs to Candidate S0",
		},
	]);
	expect(result.challenge?.addPartitions).toEqual([]);
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
	expect(result.budget.providerCalls).toBe(2);
	expect(registration.getPendingResponseCount()).toBe(0);
});

test("continues after rejecting one partition with a non-canonical range", async () => {
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [
			boundedChallenge().remove_partitions[0],
			{
				target_ranges: ["段落1中的后半句"],
				source_conclusion: "The target intentionally attempts a block-internal slice.",
				supporting_block_ids: [1],
			},
		],
		remove_audit_partitions: [],
		add_partitions: [],
	};
	const registration = createFaux([
		challengerResponse(challenge),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "remove",
			partitionIndex: 1,
			reason:
				"invalid range in remove_partitions[1].target_ranges[0]: 段落1中的后半句",
		},
	]);
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
});

test("continues after rejecting an audit that overlaps an exact remove challenge", async () => {
	const overlappingChallenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [boundedChallenge().remove_partitions[0]],
		remove_audit_partitions: [
			{
				audit_kind: "mixed_atomic_scope",
				target_ranges: ["段落1-段落2"],
				audit_basis: "The audit intentionally overlaps an exact remove target.",
				supporting_block_ids: [1, 2],
			},
		],
		add_partitions: [],
	};
	const registration = createFaux([
		challengerResponse(overlappingChallenge),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落2"] });
	expect(result.challenge?.removeAuditPartitions).toEqual([]);
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "remove_audit",
			partitionIndex: 0,
			reason: "remove audit block 2 already belongs to an exact remove challenge",
		},
	]);
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
	expect(result.budget.providerCalls).toBe(2);
	expect(registration.getPendingResponseCount()).toBe(0);
});

test("keeps Challenger claims in trace while withholding them from the Finalizer", async () => {
	const contexts: Context[] = [];
	const traceOnlyClaim = "TRACE_ONLY_CHALLENGER_CLAIM_4E6D5A91";
	const groupedChallenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [
			{
				target_ranges: ["段落1"],
				source_conclusion: traceOnlyClaim,
				supporting_block_ids: [0, 1],
			},
		],
		remove_audit_partitions: [
			{
				audit_kind: "recovery_boundary_scope",
				target_ranges: ["段落2"],
				audit_basis: "The bounded scope requires independent recovery review.",
				supporting_block_ids: [2],
			},
		],
		add_partitions: [
			{
				target_ranges: ["段落3"],
				source_conclusion: "The excluded block requires independent add review.",
				supporting_block_ids: [3],
			},
		],
	};
	const registration = createFaux([
		(context) => {
			contexts.push(context);
			return challengerResponse(groupedChallenge);
		},
		(context) => {
			contexts.push(context);
			return finalizerResponse({
				ordinary_remove_ranges: [],
				ordinary_add_ranges: [],
			});
		},
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落2", "段落4"] }),
	});

	expect(result.status).toBe("preserved");
	expect(result.challenge?.removePartitions[0]?.sourceConclusion).toBe(
		traceOnlyClaim,
	);
	expect(result.trace.challengerRawResponse).toContain(traceOnlyClaim);
	expect(JSON.stringify(result.trace.challengerNormalizedResponse)).toContain(
		traceOnlyClaim,
	);
	expect(contexts).toHaveLength(2);
	const challengerMessage = contexts[0].messages.find(
		(message) => message.role === "user",
	);
	if (challengerMessage?.role !== "user") {
		throw new Error("Challenger context omitted its user message");
	}
	const challengerInput =
		typeof challengerMessage.content === "string"
			? challengerMessage.content
			: challengerMessage.content
					.map((content) => (content.type === "text" ? content.text : ""))
					.join("");
	const runQueuePrefix = "MECHANICAL_S0_RUN_QUEUE_JSON=";
	const runQueueLine = challengerInput
		.split("\n")
		.find((line) => line.startsWith(runQueuePrefix));
	if (runQueueLine === undefined) {
		throw new Error("Challenger context omitted the mechanical S0 run queue");
	}
	expect(JSON.parse(runQueueLine.slice(runQueuePrefix.length))).toEqual({
		semantic_authority: false,
		runs: [
			{
				range: "段落1-段落2",
				block_count: 2,
				start_block_id: 1,
				end_block_id: 2,
				singleton: false,
			},
			{
				range: "段落4",
				block_count: 1,
				start_block_id: 4,
				end_block_id: 4,
				singleton: true,
			},
		],
	});
	const projectionPrefix = "CANDIDATE_S0_SOURCE_PROJECTION_JSON=";
	const projectionLine = challengerInput
		.split("\n")
		.find((line) => line.startsWith(projectionPrefix));
	if (projectionLine === undefined) {
		throw new Error("Challenger context omitted the Candidate-S0 source projection");
	}
	const challengerProjection = JSON.parse(
		projectionLine.slice(projectionPrefix.length),
	) as {
		candidate_s0_ranges: string[];
		semantic_authority: boolean;
		blocks: Array<{ block_id: number; text: string }>;
	};
	expect(challengerProjection).toEqual({
		candidate_s0_ranges: ["段落1-段落2", "段落4"],
		semantic_authority: false,
		blocks: [
			{ block_id: 1, text: "设备应支持接口联调。" },
			{ block_id: 2, text: "合同付款条款。" },
			{ block_id: 4, text: "响应文件格式模板。" },
		],
	});
	const finalizerMessage = contexts[1].messages.find(
		(message) => message.role === "user",
	);
	if (finalizerMessage?.role !== "user") {
		throw new Error("Finalizer context omitted its user message");
	}
	const finalizerInput =
		typeof finalizerMessage.content === "string"
			? finalizerMessage.content
			: finalizerMessage.content
					.map((content) => (content.type === "text" ? content.text : ""))
					.join("");
	expect(finalizerInput).not.toContain(projectionPrefix);
	const finalizerRunQueueLine = finalizerInput
		.split("\n")
		.find((line) => line.startsWith(runQueuePrefix));
	if (finalizerRunQueueLine === undefined) {
		throw new Error("Finalizer context omitted the mechanical S0 run queue");
	}
	expect(JSON.parse(finalizerRunQueueLine.slice(runQueuePrefix.length))).toEqual({
		semantic_authority: false,
		runs: [
			{
				range: "段落1-段落2",
				block_count: 2,
				start_block_id: 1,
				end_block_id: 2,
				singleton: false,
			},
			{
				range: "段落4",
				block_count: 1,
				start_block_id: 4,
				end_block_id: 4,
				singleton: true,
			},
		],
	});
	expect(finalizerInput).toContain(
		'"remove_review_ranges":["段落1-段落2","段落4"]',
	);
	expect(finalizerInput).toContain('"hard_root_review_groups":[]');
	expect(finalizerInput).toContain(
		'"remove_review_groups":[{"review_kind":"exact_remove_claim","partition_index":0,"range_index":0,"target_ranges":["段落1"],"mechanical_context_block_ids":[0,2,3]},{"review_kind":"recovery_boundary_scope","target_ranges":["段落2"],"mechanical_target_block_count":1,"supporting_block_ids":[2]}]',
	);
	expect(finalizerInput).toContain('"add_review_ranges":["段落3"]');
	expect(finalizerInput).toContain(
		'"add_review_groups":[{"review_kind":"exact_add_claim","partition_index":0,"range_index":0,"target_ranges":["段落3"],"mechanical_context_block_ids":[1,2,4]}]',
	);
	expect(finalizerInput).toContain('"challenger_partition_kind_forwarded":true');
	expect(finalizerInput).toContain(
		'"challenger_claims_forwarded_as_untrusted":false',
	);
	expect(finalizerInput).toContain(
		'"exact_partition_supporting_ids_forwarded":false',
	);
	expect(finalizerInput).toContain('"candidate_s0_block_ids":[1,2,4]');
	expect(finalizerInput).toContain('"anchor_must_be_in_s0_and_span":true');
	expect(finalizerInput).not.toContain(traceOnlyClaim);
	expect(finalizerInput).not.toContain("untrusted_challenger_claim");
	expect(finalizerInput).not.toContain("source_conclusion");
	expect(finalizerInput).not.toContain("audit_basis");
	expect(finalizerInput).toContain("supporting_block_ids");
});

test("splits exact target ranges into stable groups with source-order neighbor context", async () => {
	const contexts: Context[] = [];
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [
			{
				target_ranges: ["段落259", "段落265"],
				source_conclusion: "Two independent exact addresses require review.",
				supporting_block_ids: [100],
			},
		],
		remove_audit_partitions: [],
		add_partitions: [],
	};
	const registration = createFaux([
		(context) => {
			contexts.push(context);
			return challengerResponse(challenge);
		},
		(context) => {
			contexts.push(context);
			return finalizerResponse({
				ordinary_remove_ranges: [],
				ordinary_add_ranges: [],
			});
		},
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({
			initialRanges: ["段落259", "段落265"],
			blockIds: [100, 257, 259, 265, 300, 400, 500],
			texts: [
				"context zero",
				"context one",
				"selected 259",
				"selected 265",
				"context two",
				"context three",
				"context four",
			],
		}),
	});

	expect(result.status).toBe("preserved");
	expect(result.challenge?.removePartitions[0]?.targetRangeGroups).toEqual([
		{ rangeIndex: 0, targetRange: "段落259", targetBlockIds: [259] },
		{ rangeIndex: 1, targetRange: "段落265", targetBlockIds: [265] },
	]);
	const finalizerMessage = contexts[1]?.messages.find(
		(message) => message.role === "user",
	);
	if (finalizerMessage?.role !== "user") {
		throw new Error("Finalizer context omitted its user message");
	}
	const finalizerInput =
		typeof finalizerMessage.content === "string"
			? finalizerMessage.content
			: finalizerMessage.content
					.map((content) => (content.type === "text" ? content.text : ""))
					.join("");
	const envelopePrefix = "CHALLENGE_ENVELOPE=";
	const envelopeLine = finalizerInput
		.split("\n")
		.find((line) => line.startsWith(envelopePrefix));
	if (envelopeLine === undefined) {
		throw new Error("Finalizer context omitted the challenge envelope");
	}
	const envelope = JSON.parse(envelopeLine.slice(envelopePrefix.length)) as {
		remove_review_groups: Array<Record<string, unknown>>;
	};
	expect(envelope.remove_review_groups).toEqual([
		{
			review_kind: "exact_remove_claim",
			partition_index: 0,
			range_index: 0,
			target_ranges: ["段落259"],
			mechanical_context_block_ids: [100, 257, 265, 300],
		},
		{
			review_kind: "exact_remove_claim",
			partition_index: 0,
			range_index: 1,
			target_ranges: ["段落265"],
			mechanical_context_block_ids: [257, 259, 300, 400],
		},
	]);
	expect(envelope.remove_review_groups).toHaveLength(2);
	expect(envelope.remove_review_groups.every((group) =>
		!Object.hasOwn(group, "supporting_block_ids"),
	)).toBe(true);
});

test("keeps expanded audit block IDs internal to the Finalizer context", async () => {
	const contexts: Context[] = [];
	const largeAudit: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [],
		remove_audit_partitions: [
			{
				audit_kind: "mixed_atomic_scope",
				target_ranges: ["段落1-段落96"],
				audit_basis: "The bounded scope contains competing atomic roles.",
				supporting_block_ids: [1, 48, 96],
			},
		],
		add_partitions: [],
	};
	const registration = createFaux([
		(context) => {
			contexts.push(context);
			return challengerResponse(largeAudit);
		},
		(context) => {
			contexts.push(context);
			return finalizerResponse({
				ordinary_remove_ranges: ["段落2", "段落96"],
				ordinary_add_ranges: [],
			});
		},
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({
			initialRanges: ["段落1-段落96"],
			texts: Array.from({ length: 100 }, (_, blockId) =>
				`Source block ${blockId}`,
			),
		}),
	});

	expect(result.status).toBe("repaired");
	expect(result.challenge?.removeAuditEnvelopeBlockIds).toHaveLength(96);
	expect(contexts).toHaveLength(2);
	const finalizerMessage = contexts[1].messages.find(
		(message) => message.role === "user",
	);
	if (finalizerMessage?.role !== "user") {
		throw new Error("Finalizer context omitted its user message");
	}
	const finalizerInput =
		typeof finalizerMessage.content === "string"
			? finalizerMessage.content
			: finalizerMessage.content
					.map((content) => (content.type === "text" ? content.text : ""))
					.join("");
	const orderedMarkers = [
		"COMPLETE_IMMUTABLE_SOURCE_JSON=",
		"CANDIDATE_S0_RANGES=",
		"MECHANICAL_S0_RUN_QUEUE_JSON=",
		"CHALLENGE_ENVELOPE=",
		"FINALIZER_TOOL_SCHEMA=",
	].map((marker) => finalizerInput.indexOf(marker));
	expect(orderedMarkers.every((index) => index >= 0)).toBe(true);
	expect(orderedMarkers).toEqual([...orderedMarkers].sort((left, right) => left - right));
	expect(finalizerInput).toContain(
		'"remove_review_ranges":["段落1-段落96"]',
	);
	expect(finalizerInput).toContain('"challenger_partition_kind_forwarded":true');
	expect(finalizerInput).toContain('"review_kind":"mixed_atomic_scope"');
	expect(finalizerInput).not.toContain("remove_partitions");
	expect(finalizerInput).not.toContain("remove_audit_partitions");
	expect(finalizerInput).not.toContain("target_block_ids");
	expect(finalizerInput).not.toContain("audit_basis");
	expect(finalizerInput).not.toContain("source_conclusion");
	expect(finalizerInput).not.toContain("untrusted_challenger_claim");
	expect(finalizerInput).toContain("supporting_block_ids");
});

test("keeps the two typed audit channels independently bounded", async () => {
	const auditBlockIds = [
		...Array.from({ length: 77 }, (_, index) => index + 1),
		...Array.from({ length: 52 }, (_, index) => index + 100),
	];
	const largeAudit: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [],
		remove_audit_partitions: [
			{
				audit_kind: "mixed_atomic_scope",
				target_ranges: ["段落1-段落77"],
				audit_basis:
					"One bounded ordinary Candidate scope has mixed atomic-membership risk.",
				supporting_block_ids: Array.from({ length: 24 }, (_, index) => index + 1),
			},
			{
				audit_kind: "recovery_boundary_scope",
				target_ranges: ["段落100-段落151"],
				audit_basis:
					"One independently bounded recovered module requires atomic review.",
				supporting_block_ids: [100, 151],
			},
		],
		add_partitions: [],
	};
	const registration = createFaux([
		challengerResponse(largeAudit),
		finalizerResponse({
			ordinary_remove_ranges: ["段落2", "段落151"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({
			initialRanges: ["段落1-段落77", "段落100-段落151"],
			texts: Array.from({ length: 160 }, (_, blockId) =>
				`Source block ${blockId}`,
			),
		}),
	});

	expect(result.status).toBe("repaired");
	expect(result.coverage).toEqual({
		challenger: "complete",
		rejectedPartitionCount: 0,
	});
	expect(result.challenge?.removeAuditEnvelopeBlockIds).toEqual(auditBlockIds);
	expect(result.challenge?.removeAuditPartitions[0]?.supportingBlockIds).toHaveLength(
		24,
	);
	expect(result.patch).toEqual({
		addRanges: [],
		removeRanges: ["段落2", "段落151"],
	});
});

test("fails closed after rejecting a recovery-boundary audit", async () => {
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [],
		remove_audit_partitions: [
			{
				audit_kind: "recovery_boundary_scope",
				target_ranges: ["段落1"],
				audit_basis: "The first bounded mixed scope requires independent review.",
				supporting_block_ids: [1],
			},
			{
				audit_kind: "recovery_boundary_scope",
				target_ranges: ["段落2"],
				audit_basis: "The second mixed scope attempts to reuse the typed slot.",
				supporting_block_ids: [2],
			},
		],
		add_partitions: [],
	};
	const registration = createFaux([
		challengerResponse(challenge),
		finalizerResponse({
			ordinary_remove_ranges: ["段落1"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "remove_audit",
			partitionIndex: 1,
			reason:
				"remove_audit_partitions[1] duplicates audit kind recovery_boundary_scope",
		},
	]);
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.failure?.message).toContain(
		"recovery_boundary_scope failed mechanical authorization",
	);
	expect(result.budget.providerCalls).toBe(1);
	expect(registration.getPendingResponseCount()).toBe(1);
});

test("fails closed even when a later recovery audit is mechanically valid", async () => {
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		hard_carrier_root_challenges: [],
		remove_partitions: [],
		remove_audit_partitions: [
			{
				audit_kind: "recovery_boundary_scope",
				target_ranges: ["段落1-段落97"],
				audit_basis: "The first scope intentionally exceeds the fixed audit budget.",
				supporting_block_ids: [1],
			},
			{
				audit_kind: "recovery_boundary_scope",
				target_ranges: ["段落100"],
				audit_basis: "A later mechanically valid scope may use the typed slot.",
				supporting_block_ids: [100],
			},
		],
		add_partitions: [],
	};
	const registration = createFaux([
		challengerResponse(challenge),
		finalizerResponse({
			ordinary_remove_ranges: ["段落100"],
			ordinary_add_ranges: [],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({
			initialRanges: ["段落1-段落97", "段落100"],
			texts: Array.from({ length: 110 }, (_, blockId) => `Source block ${blockId}`),
		}),
	});

	expect(result.status).toBe("degraded");
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "remove_audit",
			partitionIndex: 0,
			reason:
				"remove_audit_partitions[0] expands to 97 blocks; maximum is 96",
		},
	]);
	expect(result.challenge?.removeAuditPartitions).toMatchObject([
		{
			partitionIndex: 1,
			auditKind: "recovery_boundary_scope",
			targetBlockIds: [100],
		},
	]);
	expect(result.finalRanges).toEqual(["段落1-段落97", "段落100"]);
	expect(result.failure?.message).toContain(
		"recovery_boundary_scope failed mechanical authorization",
	);
	expect(result.budget.providerCalls).toBe(1);
	expect(registration.getPendingResponseCount()).toBe(1);
});

test("fails capacity preflight before the first provider call", async () => {
	const registration = createFaux([challengerResponse(emptyChallenge())], 1_000);

	const result = await runReview(registration);

	expect(result.status).toBe("degraded");
	expect(result.failure).toMatchObject({ role: "preflight", code: "capacity" });
	expect(result.coverage).toEqual({
		challenger: "not_run",
		rejectedPartitionCount: 0,
	});
	expect(result.budget.providerCalls).toBe(0);
	expect(registration.state.callCount).toBe(0);
});

test("ignores and hashes Finalizer auxiliary text", async () => {
	const registration = createFaux([
		challengerResponse(boundedChallenge()),
		fauxAssistantMessage(
			[
				fauxText("ignored auxiliary explanation"),
				fauxToolCall("submit_final_selection", {
					ordinary_remove_ranges: ["段落2"],
					ordinary_add_ranges: [],
					hard_carrier_root_vetoes: [],
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
		finalizerResponse({ ordinary_remove_ranges: [], ordinary_add_ranges: [] }),
		challengerResponse(emptyChallenge()),
		finalizerResponse({ ordinary_remove_ranges: [], ordinary_add_ranges: [] }),
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

	expect(registration.state.callCount).toBe(4);
	expect(first.packetSha256).not.toBe(second.packetSha256);
	expect(first.candidateId).not.toBe(second.candidateId);
	expect(first.candidatePromptSha256).not.toBe(second.candidatePromptSha256);
	expect(first.candidateRanges).not.toEqual(second.candidateRanges);
	expect(first.capabilitySha256).toBe(second.capabilitySha256);
});
