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
		remove_partitions: [],
		remove_audit_partitions: [],
		add_partitions: [],
	};
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

test("runs the independent Finalizer after an empty challenge for non-empty S0", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({ accepted_remove_ranges: [], accepted_add_ranges: [] }, "unused"),
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
		"xique.word-requirement-review.pi-native-candidate-s0-result.v3",
	);
	expect(result.prompts.candidateS0RuntimeContract).toBe(
		sha256(candidateS0RuntimeContract),
	);
});

test("stops after an empty challenge when Candidate S0 is empty", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({ accepted_remove_ranges: [], accepted_add_ranges: [] }, "unused"),
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

test("allows the Finalizer to remove an S0 hard-carrier span outside the challenge envelope", async () => {
	const registration = createFaux([
		challengerResponse({
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
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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
		challengeRemoveRanges: ["段落2"],
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
			accepted_remove_ranges: [],
			accepted_add_ranges: [],
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

test("canonicalizes a redundant submitted remove already covered by a valid root veto", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			accepted_remove_ranges: ["段落3"],
			accepted_add_ranges: [],
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
	expect(result.decision).toMatchObject({
		challengeRemoveRanges: [],
		rootCoveredRedundantRemoveRanges: ["段落3"],
		hardCarrierRemoveRanges: ["段落3-段落4"],
	});
});

test("continues after rejecting an effectless root veto when valid effects remain", async () => {
	const registration = createFaux([
		challengerResponse({
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
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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
			accepted_remove_ranges: [],
			accepted_add_ranges: ["段落3"],
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

test("allows an independent hard-carrier root veto to cover mixed-audit survivors", async () => {
	const registration = createFaux([
		challengerResponse(auditChallenge()),
		finalizerResponse({
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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

test("allows an independent hard-carrier root veto to cover an exact-remove target without duplicate delta", async () => {
	const registration = createFaux([
		challengerResponse({
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
			accepted_remove_ranges: [],
			accepted_add_ranges: [],
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
	expect(result.decision?.challengeRemoveBlockIds).toEqual([]);
	expect(result.decision?.hardCarrierRemoveBlockIds).toEqual([3, 4]);
});

test("fails closed when a hard-carrier root crosses an unresolved recovery boundary", async () => {
	const registration = createFaux([
		challengerResponse({
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
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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
	expect(result.failure?.message).toContain(
		"hard-carrier root veto crosses unresolved recovery survivor block 3",
	);
});

test("allows a hard-carrier root to cross a recovery scope after its covered blocks are explicitly removed", async () => {
	const registration = createFaux([
		challengerResponse({
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
			accepted_remove_ranges: ["段落3-段落4"],
			accepted_add_ranges: [],
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
	expect(result.decision?.challengeRemoveBlockIds).toEqual([3, 4]);
	expect(result.decision?.hardCarrierRemoveBlockIds).toEqual([3, 4]);
});

test("fails closed when hard-carrier veto spans overlap", async () => {
	const registration = createFaux([
		challengerResponse(emptyChallenge()),
		finalizerResponse({
			accepted_remove_ranges: [],
			accepted_add_ranges: [],
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
			accepted_remove_ranges: [],
			accepted_add_ranges: [],
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
			accepted_remove_ranges: [],
			accepted_add_ranges: [],
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
			accepted_remove_ranges: ["段落2", "段落4"],
			accepted_add_ranges: [],
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

test("normalizes mechanically equivalent compact range syntax", async () => {
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
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
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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
	expect(result.failure?.message).toContain("outside the Challenger envelope");
	expect(result.trace.finalizerRawSubmissions).toEqual([
		{
			accepted_remove_ranges: ["段落1"],
			accepted_add_ranges: ["段落4"],
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
		name: "Challenger supporting evidence exceeds the bounded output",
		responses: [
			challengerResponse({
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
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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
				"invalid range in remove_partitions[1].target_ranges: 段落1中的后半句",
		},
	]);
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
});

test("continues after rejecting an audit that overlaps an exact remove challenge", async () => {
	const overlappingChallenge: PiNativeCandidateS0ChallengeSubmission = {
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
			accepted_remove_ranges: ["段落2"],
			accepted_add_ranges: [],
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

test("forwards complete run-grouped S0 projection only to Challenger and typed groups to Finalizer", async () => {
	const contexts: Context[] = [];
	const groupedChallenge: PiNativeCandidateS0ChallengeSubmission = {
		remove_partitions: [
			{
				target_ranges: ["段落1"],
				source_conclusion: "EXACT_REMOVE_SECRET",
				supporting_block_ids: [0, 1],
			},
		],
		remove_audit_partitions: [
			{
				audit_kind: "recovery_boundary_scope",
				target_ranges: ["段落2"],
				audit_basis: "REMOVE_AUDIT_SECRET",
				supporting_block_ids: [2],
			},
		],
		add_partitions: [
			{
				target_ranges: ["段落3"],
				source_conclusion: "EXACT_ADD_SECRET",
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
				accepted_remove_ranges: [],
				accepted_add_ranges: [],
			});
		},
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({ initialRanges: ["段落1-段落2", "段落4"] }),
	});

	expect(result.status).toBe("preserved");
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
		semantic_authority: boolean;
		runs: Array<{
			range: string;
			block_count: number;
			blocks: Array<{ block_id: number; text: string }>;
		}>;
	};
	expect(challengerProjection).toEqual({
		semantic_authority: false,
		runs: [
			{
				range: "段落1-段落2",
				block_count: 2,
				blocks: [
					{ block_id: 1, text: "设备应支持接口联调。" },
					{ block_id: 2, text: "合同付款条款。" },
				],
			},
			{
				range: "段落4",
				block_count: 1,
				blocks: [{ block_id: 4, text: "响应文件格式模板。" }],
			},
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
	expect(finalizerInput).toContain('"remove_review_ranges":["段落1-段落2"]');
	expect(finalizerInput).toContain(
		'"remove_review_groups":[{"review_kind":"exact_remove_claim","target_ranges":["段落1"],"untrusted_challenger_claim":"EXACT_REMOVE_SECRET","supporting_block_ids":[0,1]},{"review_kind":"recovery_boundary_scope","target_ranges":["段落2"],"mechanical_target_block_count":1,"untrusted_challenger_claim":"REMOVE_AUDIT_SECRET","supporting_block_ids":[2]}]',
	);
	expect(finalizerInput).toContain('"add_review_ranges":["段落3"]');
	expect(finalizerInput).toContain(
		'"add_review_groups":[{"review_kind":"exact_add_claim","target_ranges":["段落3"],"untrusted_challenger_claim":"EXACT_ADD_SECRET","supporting_block_ids":[3]}]',
	);
	expect(finalizerInput).toContain('"challenger_partition_kind_forwarded":true');
	expect(finalizerInput).toContain(
		'"challenger_claims_forwarded_as_untrusted":true',
	);
	expect(finalizerInput).toContain('"candidate_s0_block_ids":[1,2,4]');
	expect(finalizerInput).toContain('"anchor_must_be_in_s0_and_span":true');
	expect(finalizerInput).toContain("EXACT_REMOVE_SECRET");
	expect(finalizerInput).toContain("REMOVE_AUDIT_SECRET");
	expect(finalizerInput).toContain("EXACT_ADD_SECRET");
	expect(finalizerInput).toContain("supporting_block_ids");
});

test("keeps expanded audit block IDs internal to the Finalizer context", async () => {
	const contexts: Context[] = [];
	const largeAudit: PiNativeCandidateS0ChallengeSubmission = {
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
				accepted_remove_ranges: ["段落2", "段落96"],
				accepted_add_ranges: [],
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
	expect(finalizerInput).toContain("untrusted_challenger_claim");
	expect(finalizerInput).toContain("supporting_block_ids");
});

test("keeps the two typed audit channels independently bounded", async () => {
	const auditBlockIds = [
		...Array.from({ length: 77 }, (_, index) => index + 1),
		...Array.from({ length: 52 }, (_, index) => index + 100),
	];
	const largeAudit: PiNativeCandidateS0ChallengeSubmission = {
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
			accepted_remove_ranges: ["段落2", "段落151"],
			accepted_add_ranges: [],
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

test("continues after rejecting a duplicate typed audit kind", async () => {
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		remove_partitions: [],
		remove_audit_partitions: [
			{
				audit_kind: "mixed_atomic_scope",
				target_ranges: ["段落1"],
				audit_basis: "The first bounded mixed scope requires independent review.",
				supporting_block_ids: [1],
			},
			{
				audit_kind: "mixed_atomic_scope",
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
			accepted_remove_ranges: ["段落1"],
			accepted_add_ranges: [],
		}),
	]);

	const result = await runReview(registration);

	expect(result.status).toBe("repaired");
	expect(result.coverage).toEqual({
		challenger: "partial",
		rejectedPartitionCount: 1,
	});
	expect(result.trace.challengerRejectedPartitions).toEqual([
		{
			direction: "remove_audit",
			partitionIndex: 1,
			reason:
				"remove_audit_partitions[1] duplicates audit kind mixed_atomic_scope",
		},
	]);
	expect(result.finalRanges).toEqual(["段落2"]);
});

test("accepts a later typed audit after rejecting an earlier over-budget scope", async () => {
	const challenge: PiNativeCandidateS0ChallengeSubmission = {
		remove_partitions: [],
		remove_audit_partitions: [
			{
				audit_kind: "mixed_atomic_scope",
				target_ranges: ["段落1-段落97"],
				audit_basis: "The first scope intentionally exceeds the fixed audit budget.",
				supporting_block_ids: [1],
			},
			{
				audit_kind: "mixed_atomic_scope",
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
			accepted_remove_ranges: ["段落100"],
			accepted_add_ranges: [],
		}),
	]);

	const result = await runReview(registration, {
		sourcePacket: packet({
			initialRanges: ["段落1-段落97", "段落100"],
			texts: Array.from({ length: 110 }, (_, blockId) => `Source block ${blockId}`),
		}),
	});

	expect(result.status).toBe("repaired");
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
		{ partitionIndex: 1, auditKind: "mixed_atomic_scope", targetBlockIds: [100] },
	]);
	expect(result.finalRanges).toEqual(["段落1-段落97"]);
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
					accepted_remove_ranges: ["段落2"],
					accepted_add_ranges: [],
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
		finalizerResponse({ accepted_remove_ranges: [], accepted_add_ranges: [] }),
		challengerResponse(emptyChallenge()),
		finalizerResponse({ accepted_remove_ranges: [], accepted_add_ranges: [] }),
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
