import { createHash } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { expect, test, vi } from "vitest";
import { loadRequirementReviewPrompts, parseRequirementReviewPacket } from "./index.ts";
import {
	buildDoubaoWitnessPayload,
	piNativeFinalizerStreamFunction,
	PiNativeSemanticWitnessSchema,
	piNativeWitnessStreamFunction,
	runPiNativeRequirementReview,
} from "./pi-native.ts";

const compatStreamMock = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-ai/compat", () => ({ stream: compatStreamMock }));

const finalizerModel: Model<"openai-completions"> = {
	id: "glm-5.2",
	name: "GLM Finalizer Faux",
	api: "openai-completions",
	provider: "pi-requirement-release-glm",
	baseUrl: "https://example.invalid/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 32_000,
};

const witnessModel: Model<"openai-completions"> = {
	id: "doubao-seed-2-0-pro-260215",
	name: "Doubao Witness Faux",
	api: "openai-completions",
	provider: "pi-requirement-reviewer-doubao",
	baseUrl: "https://example.invalid/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 12_000,
};

const prompts = await loadRequirementReviewPrompts(
	new URL("../../skills/word-requirement-extraction-reviewer/references", import.meta.url).pathname,
);

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function packet(initialRanges = ["段落0-段落2"]) {
	const blocks = [
		{ blockId: 0, text: "第一段。" },
		{ blockId: 1, text: "第二段。" },
		{ blockId: 2, text: "第三段。" },
	];
	return parseRequirementReviewPacket({
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: "blind.docx",
		sourceSha256: sha256(blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n")),
		blockCount: blocks.length,
		candidateId: "requirement_candidate_v120",
		candidatePromptSha256: "7".repeat(64),
		initialRanges,
		blocks,
	});
}

type TestCarrierType = "announcement" | "bidder_instruction" | "response_format" | "contract_terms";

function hardRootClaim(
	root: number,
	exit: number | null,
	carrierType: TestCarrierType = "contract_terms",
) {
	return {
		carrier_type: carrierType,
		root_block_id: root,
		exit_block_id_exclusive: exit,
	};
}

function selection(
	ranges: string[],
	hardRootClaims: Array<ReturnType<typeof hardRootClaim>> = [],
	reason = "The source supports this bounded selection.",
) {
	return {
		owner_reason: "The source Owner boundaries were inspected.",
		residual_reason: reason,
		hard_root_claims: hardRootClaims,
		run_selections: [{ run_index: 0, final_selected_ranges: ranges }],
	};
}

function toolSelection(
	value: ReturnType<typeof selection>,
	id: string,
): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall("submit_final_selection", value, { id }), {
		stopReason: "toolUse",
	});
}

function witnessChallenge(
	kind: "owner_boundary" | "atom_membership",
	direction: "select" | "exclude",
	ranges: string[],
	supportingBlockIds: number[],
) {
	return {
		kind,
		direction,
		ranges,
		attacked_premise: "The cited source contradicts the provisional premise.",
		supporting_block_ids: supportingBlockIds,
	};
}

type WitnessChallengeFixture = ReturnType<typeof witnessChallenge>;

type WitnessLaneFixture = {
	kind: "none" | "owner_boundary" | "atom_membership";
	ranges: string[];
	attacked_premise: string;
	supporting_block_ids: number[];
};

function emptyWitnessLane(): WitnessLaneFixture {
	return { kind: "none", ranges: [], attacked_premise: "", supporting_block_ids: [] };
}

function witnessSubmission(challenges: WitnessChallengeFixture[] = []) {
	let exclude = emptyWitnessLane();
	let select = emptyWitnessLane();
	for (const { direction, ...challenge } of challenges) {
		if (direction === "exclude") {
			if (exclude.kind !== "none") throw new Error("duplicate exclude Witness fixture");
			exclude = challenge;
		} else {
			if (select.kind !== "none") throw new Error("duplicate select Witness fixture");
			select = challenge;
		}
	}
	return { exclude, select };
}

function toolWitness(value: unknown): AssistantMessage {
	return fauxAssistantMessage(fauxText(JSON.stringify(value)), { stopReason: "stop" });
}

function withInputUsage(message: AssistantMessage, input: number): AssistantMessage {
	return {
		...message,
		usage: { ...message.usage, input, totalTokens: input + message.usage.output },
	};
}

type ScenarioStep = {
	role: "finalizer" | "witness";
	response: AssistantMessage;
};

function scriptedScenario(
	steps: ScenarioStep[],
	onProviderCall?: (role: ScenarioStep["role"], callIndex: number) => void,
) {
	let cursor = 0;
	const observed: Array<{
		role: ScenarioStep["role"];
		modelId: string;
		reasoning: string | undefined;
		maxTokens: number | undefined;
		toolNames: string[];
		systemPrompt: string;
		userPrompt: string;
		serializedContext: string;
	}> = [];
	const streamFor = (role: ScenarioStep["role"]): StreamFn =>
		(selectedModel, context, options) => {
			const step = steps[cursor];
			if (!step) throw new Error(`unexpected provider call ${cursor + 1}`);
			expect(step.role).toBe(role);
			onProviderCall?.(role, cursor);
			const expectedModel = role === "finalizer" ? finalizerModel : witnessModel;
			expect(selectedModel.id).toBe(expectedModel.id);
			const toolNames = context.tools?.map((tool) => tool.name) ?? [];
			for (const content of step.response.content) {
				if (role === "finalizer" && content.type === "toolCall") {
					expect(toolNames).toContain(content.name);
				}
			}
			observed.push({
				role,
				modelId: selectedModel.id,
				reasoning: options?.reasoning,
				maxTokens: options?.maxTokens,
				toolNames,
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
				serializedContext: JSON.stringify(context),
			});
			cursor += 1;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const reason =
					step.response.stopReason === "length" ||
					step.response.stopReason === "stop" ||
					step.response.stopReason === "toolUse"
						? step.response.stopReason
						: "stop";
				stream.push({ type: "start", partial: step.response });
				stream.push({ type: "done", reason, message: step.response });
				stream.end(step.response);
			});
			return stream;
		};
	return {
		finalizerStream: streamFor("finalizer"),
		witnessStream: streamFor("witness"),
		callCount: () => cursor,
		observed,
	};
}

async function runScenario(
	steps: ScenarioStep[],
	initialRanges?: string[],
	signal?: AbortSignal,
	packetSha256 = "0".repeat(64),
	sourcePacket?: ReturnType<typeof packet>,
) {
	const scripted = scriptedScenario(steps);
	const result = await runPiNativeRequirementReview({
		packet: sourcePacket ?? packet(initialRanges),
		packetSha256,
		prompts,
		finalizerRuntime: {
			model: finalizerModel,
			streamFunction: scripted.finalizerStream,
			apiKey: "test-key",
		},
		witnessRuntime: {
			model: witnessModel,
			streamFunction: scripted.witnessStream,
			apiKey: "test-key",
		},
		signal,
	});
	return { result, scripted };
}

function witnessReviewPacket(observed: { userPrompt: string }) {
	const marker = "HARNESS_REVIEW_PACKET=";
	const reviewText = observed.userPrompt.split(marker).at(-1);
	if (reviewText === undefined || reviewText === observed.userPrompt) {
		throw new Error("missing HARNESS_REVIEW_PACKET in Finalizer replay");
	}
	const packet = JSON.parse(reviewText) as {
		review_evidence: {
			independent_semantic_witness: {
				coverage: "full" | "partial" | "none" | null;
				lane_status: {
					exclude: "valid_none" | "valid_challenge" | "rejected_source_focus";
					select: "valid_none" | "valid_challenge" | "rejected_source_focus";
				} | null;
				challenges: Array<Record<string, unknown>>;
			};
		};
	};
	return packet.review_evidence.independent_semantic_witness;
}

test("runs exactly GLM provisional, Doubao Witness, then GLM final", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0-段落2"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(witnessSubmission([])),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0-段落2"]), "final") },
	]);

	expect(result.status).toBe("preserved");
	expect(result.reviewDegraded).toBe(false);
	expect(result.budget.providerCalls).toBe(3);
	expect(result.budget.roles.finalizer.providerCalls).toBe(2);
	expect(result.budget.roles.witness.providerCalls).toBe(1);
	expect(scripted.callCount()).toBe(3);
	expect(scripted.observed.map(({ role, modelId }) => [role, modelId])).toEqual([
		["finalizer", "glm-5.2"],
		["witness", "doubao-seed-2-0-pro-260215"],
		["finalizer", "glm-5.2"],
	]);
	expect(scripted.observed.map(({ reasoning }) => reasoning)).toEqual(["off", "off", "off"]);
	expect(scripted.observed.map(({ maxTokens }) => maxTokens)).toEqual([8_000, 2_400, 8_000]);
	expect(scripted.observed.reduce((total, { maxTokens }) => total + (maxTokens ?? 0), 0)).toBe(
		18_400,
	);
	expect(scripted.observed[0].toolNames).toEqual(["submit_final_selection"]);
	expect(scripted.observed[1].toolNames).toEqual([]);
	expect(scripted.observed[2].toolNames).toEqual(["submit_final_selection"]);
	expect(scripted.observed[2].serializedContext).toContain("REPLAY_TRUST_BOUNDARY");
	expect(scripted.observed[2].serializedContext).toContain(
		"UNTRUSTED_PROVISIONAL_SUBMISSION",
	);
	expect(scripted.observed[2].serializedContext).toContain("HARNESS_REVIEW_PACKET");
	expect(scripted.observed[2].serializedContext).toContain("review_available");
	expect(scripted.observed[2].serializedContext).toContain("mechanical_contract_blockers");
	expect(scripted.observed[2].serializedContext).toContain("review_evidence");
	expect(scripted.observed[2].serializedContext).not.toContain("repair_required");
	expect(scripted.observed[2].serializedContext).not.toContain("mechanical_conflicts");
	expect(scripted.observed[2].serializedContext).not.toContain('"role":"assistant"');
	expect(scripted.observed[2].serializedContext).not.toContain('"role":"toolResult"');
	expect(scripted.observed[0].systemPrompt).toContain("Pi-native Word 采购需求语义合同");
	expect(scripted.observed[0].systemPrompt).toContain("规范性纳入");
	expect(scripted.observed[0].systemPrompt).toContain("excluded→selected 反转承担对称证据负担");
	expect(scripted.observed[0].systemPrompt).toContain(
		"每个准备 selected 的 heading 必须先按自身 communicative function 和 stripped remainder 独立判断",
	);
	expect(scripted.observed[0].systemPrompt).toContain(
		"authoring wrapper，即使下层存在合格项目事实、范围、清单项或 body，该 wrapper 仍排除",
	);
	expect(scripted.observed[0].systemPrompt).toContain("submit_final_selection");
	expect(scripted.observed[0].systemPrompt).not.toContain("submit_requirement_release");
	expect(scripted.observed[0].systemPrompt).toContain(
		"非空 Witness lane 的唯一 target range 展开后的每个 block",
	);
	expect(scripted.observed[1].systemPrompt).toContain("独立、窄职责对抗证人");
	expect(scripted.observed[1].systemPrompt).toContain(
		"select lane 有对称证据硬门",
	);
	expect(scripted.observed[1].systemPrompt).toContain(
		"非空 lane 的唯一 `ranges[0]` 展开后的全部 target block",
	);
	expect(scripted.observed[1].systemPrompt).toContain(
		"对每个 selected heading 首先按其自身 communicative function 与 stripped remainder 独立裁决",
	);
	expect(scripted.observed[1].systemPrompt).toContain(
		"只攻击该最小可见同-group wrapper block",
	);
	expect(scripted.observed[1].systemPrompt).not.toContain("Pi-native Word 采购需求语义合同");
	expect(scripted.observed[1].systemPrompt).not.toContain("Pi-native Runtime Contract");
	expect(scripted.observed[1].systemPrompt).not.toContain("submit_requirement_release");
	expect(scripted.observed[1].userPrompt).not.toContain("PROVISIONAL_OWNER_REASON");
	expect(scripted.observed[1].userPrompt).not.toContain("PROVISIONAL_RESIDUAL_REASON");
	expect(scripted.observed[1].userPrompt).not.toContain(
		"The source Owner boundaries were inspected.",
	);
	expect(scripted.observed[1].userPrompt).not.toContain(
		"The source supports this bounded selection.",
	);
	expect(result.inputs.finalizerProvisionalSha256).toMatch(/^[0-9a-f]{64}$/u);
	expect(result.inputs.witnessSha256).toMatch(/^[0-9a-f]{64}$/u);
	expect(result.inputs.finalizerFinalSha256).toMatch(/^[0-9a-f]{64}$/u);
	expect(result.inputs.finalizerFinalSha256).not.toBe(
		result.inputs.finalizerProvisionalSha256,
	);
	expect(result.capabilitySha256).toMatch(/^[0-9a-f]{64}$/u);
	expect(result.witness?.challenges).toEqual([]);
	expect(result.witness).toMatchObject({
		status: "accepted",
		coverage: "full",
		laneCoverage: {
			exclude: { status: "valid_none", forwarded: false },
			select: { status: "valid_none", forwarded: false },
		},
	});
	const emptyWitness = witnessSubmission();
	expect(result.witness?.trace.rawArguments).toEqual([JSON.stringify(emptyWitness)]);
	expect(result.witness?.trace.normalizedArguments).toEqual([emptyWitness]);
});

test("stops before the third provider call when cumulative measured and projected usage exceeds the run budget", async () => {
	const { result, scripted } = await runScenario([
		{
			role: "finalizer",
			response: withInputUsage(
				toolSelection(selection(["段落0-段落2"]), "provisional"),
				500_000,
			),
		},
		{
			role: "witness",
			response: withInputUsage(toolWitness(witnessSubmission([])), 200_000),
		},
		{
			role: "finalizer",
			response: toolSelection(selection(["段落0-段落2"]), "must-not-run"),
		},
	]);

	expect(scripted.callCount()).toBe(2);
	expect(result.status).toBe("degraded");
	expect(result.reviewDegraded).toBe(true);
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.inputs.finalizerFinalSha256).toBeNull();
	expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
	expect(result.failure?.message).toContain("input-token budget exhausted");
	expect(result.budget.providerCalls).toBe(2);
	expect(result.budget.inputTokens).toBe(700_000);
});

test("attributes nested Witness elapsed time exactly once", async () => {
	let now = 0;
	const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
	const scripted = scriptedScenario(
		[
			{
				role: "finalizer",
				response: toolSelection(selection(["段落0-段落2"]), "provisional"),
			},
			{ role: "witness", response: toolWitness(witnessSubmission([])) },
			{
				role: "finalizer",
				response: toolSelection(selection(["段落0-段落2"]), "final"),
			},
		],
		(_role, callIndex) => {
			now = [10, 50, 100][callIndex] ?? now;
		},
	);
	const result = await runPiNativeRequirementReview({
		packet: packet(),
		packetSha256: "0".repeat(64),
		prompts,
		finalizerRuntime: {
			model: finalizerModel,
			streamFunction: scripted.finalizerStream,
			apiKey: "test-key",
		},
		witnessRuntime: {
			model: witnessModel,
			streamFunction: scripted.witnessStream,
			apiKey: "test-key",
		},
	}).finally(() => nowSpy.mockRestore());

	expect(result.status).toBe("preserved");
	expect(result.witness?.trace.elapsedMs).toBe(40);
	expect(result.budget.roles.witness.elapsedMs).toBe(40);
	expect(result.budget.roles.finalizer.elapsedMs).toBe(60);
	expect(result.budget.elapsedMs).toBe(100);
});

test("exposes exactly two required non-null Witness lanes without direction fields", () => {
	expect(PiNativeSemanticWitnessSchema).toMatchObject({
		required: ["exclude", "select"],
		properties: {
			exclude: {
				required: ["kind", "ranges", "attacked_premise", "supporting_block_ids"],
				properties: {
					ranges: { maxItems: 1 },
					supporting_block_ids: { maxItems: 8 },
				},
			},
			select: expect.any(Object),
		},
	});
	expect(PiNativeSemanticWitnessSchema.properties.exclude.properties).not.toHaveProperty(
		"direction",
	);
	expect(PiNativeSemanticWitnessSchema.properties).not.toHaveProperty("challenges");
	expect(PiNativeSemanticWitnessSchema.properties).not.toHaveProperty("exclude_challenge");
	expect(PiNativeSemanticWitnessSchema.properties).not.toHaveProperty("select_challenge");
	expect(PiNativeSemanticWitnessSchema.properties).not.toHaveProperty("primary_challenge");
	expect(PiNativeSemanticWitnessSchema.properties).not.toHaveProperty("secondary_challenge");
});

test.each([5, 6, 7, 8])(
	"accepts %i Witness supporting block IDs without sorting or truncation",
	async (supportingBlockCount) => {
		const blocks = Array.from({ length: 9 }, (_, blockId) => ({
			blockId,
			text: `Source block ${blockId}.`,
		}));
		const sourcePacket = parseRequirementReviewPacket({
			schemaVersion: "xique.word-requirement-review.packet.v1",
			reviewMode: "candidate_protected_residual",
			version: "docx-paragraphs-v1",
			outputField: "完整采购需求编号范围",
			sourceName: "witness-capacity.docx",
			sourceSha256: sha256(
				blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
			),
			blockCount: blocks.length,
			candidateId: "requirement_candidate_v120",
			candidatePromptSha256: "7".repeat(64),
			initialRanges: [],
			blocks,
		});
		const supportingBlockIds = Array.from(
			{ length: supportingBlockCount },
			(_, index) => supportingBlockCount - index - 1,
		);
		const { result } = await runScenario(
			[
				{ role: "finalizer", response: toolSelection(selection([]), "provisional") },
				{
					role: "witness",
					response: toolWitness(
						witnessSubmission([
							witnessChallenge(
								"atom_membership",
								"select",
								["段落0"],
								supportingBlockIds,
							),
						]),
					),
				},
				{ role: "finalizer", response: toolSelection(selection([]), "final") },
			],
			undefined,
			undefined,
			"0".repeat(64),
			sourcePacket,
		);

		expect(result.witness).toMatchObject({ status: "accepted" });
		expect(result.witness?.challenges).toHaveLength(1);
		expect(result.witness?.challenges[0]?.supportingBlockIds).toEqual(supportingBlockIds);
	},
);

test("rejects nine Witness supporting block IDs", async () => {
	const blocks = Array.from({ length: 9 }, (_, blockId) => ({
		blockId,
		text: `Source block ${blockId}.`,
	}));
	const sourcePacket = parseRequirementReviewPacket({
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: "witness-capacity.docx",
		sourceSha256: sha256(
			blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
		),
		blockCount: blocks.length,
		candidateId: "requirement_candidate_v120",
		candidatePromptSha256: "7".repeat(64),
		initialRanges: [],
		blocks,
	});
	const { result } = await runScenario(
		[
			{ role: "finalizer", response: toolSelection(selection([]), "provisional") },
			{
				role: "witness",
				response: toolWitness(
					witnessSubmission([
						witnessChallenge(
							"atom_membership",
							"select",
							["段落0"],
							[8, 7, 6, 5, 4, 3, 2, 1, 0],
						),
					]),
				),
			},
			{ role: "finalizer", response: toolSelection(selection([]), "final") },
		],
		undefined,
		undefined,
		"0".repeat(64),
		sourcePacket,
	);

	expect(result.status).toBe("degraded");
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.witness?.error).toContain("8");
});

test("surfaces short selected boundary gaps to both Witness and final reconciliation", async () => {
	const { result, scripted } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(selection(["段落0", "段落2"]), "provisional"),
		},
		{
			role: "witness",
			response: toolWitness(witnessSubmission([])),
		},
		{
			role: "finalizer",
			response: toolSelection(selection(["段落0", "段落2"]), "final"),
		},
	]);

	expect(result.status).toBe("repaired");
	expect(scripted.observed[1].userPrompt).toContain(
		'SELECTED_BOUNDARY_GAPS=[{"run_index":0,"gap_ranges":["段落1"],"left_selected_ranges":["段落0"],"right_selected_ranges":["段落2"]}]',
	);
	const focus = JSON.parse(
		scripted.observed[1].userPrompt.split("REVIEW_FOCUS_SOURCE=")[1] ?? "null",
	) as {
		exclude_scan_selected_islands: Array<{
			ranges: string[];
			blocks: Array<{ block_id: number; text: string }>;
		}>;
		select_scan_excluded_islands: Array<{
			ranges: string[];
			blocks: Array<{ block_id: number; text: string }>;
		}>;
	};
	expect(focus.exclude_scan_selected_islands.map((group) => group.ranges)).toEqual([
		["段落0"],
		["段落2"],
	]);
	expect(focus.select_scan_excluded_islands.map((group) => group.ranges)).toEqual([
		["段落1"],
	]);
	const focusBlocks = [
		...focus.exclude_scan_selected_islands,
		...focus.select_scan_excluded_islands,
	].flatMap((group) => group.blocks);
	expect(focusBlocks.map((block) => block.block_id).sort((left, right) => left - right)).toEqual([
		0, 1, 2,
	]);
	expect(new Set(focusBlocks.map((block) => block.block_id)).size).toBe(focusBlocks.length);
	for (const sourceText of ["第一段。", "第二段。", "第三段。"]) {
		expect(focusBlocks.filter((block) => block.text === sourceText)).toHaveLength(1);
	}
	expect(scripted.observed[2].serializedContext).toContain("selected_boundary_gaps");
	expect(scripted.observed[2].serializedContext).toContain("段落1");
});

test("prioritizes provisional-empty addresses outside hard-root projections", async () => {
	const { result, scripted } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(selection([], [hardRootClaim(0, 2)]), "provisional"),
		},
		{
			role: "witness",
			response: toolWitness(witnessSubmission([])),
		},
		{
			role: "finalizer",
			response: toolSelection(selection([], [hardRootClaim(0, 2)]), "final"),
		},
	]);

	expect(result.status).toBe("repaired");
	expect(scripted.observed[1].userPrompt).toContain(
		'PROVISIONAL_UNCLAIMED_EXCLUDED_RANGES=["段落2"]',
	);
	expect(scripted.observed[2].serializedContext).toContain(
		"provisional_unclaimed_excluded_ranges",
	);
	expect(scripted.observed[2].serializedContext).toContain("第三段。");
});

test("includes fixed edge windows for every provisional hard-claim projection island", async () => {
	const blocks = Array.from({ length: 60 }, (_, blockId) => ({
		blockId,
		text: `Source block ${blockId}.`,
	}));
	const sourcePacket = parseRequirementReviewPacket({
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: "claimed-island-focus.docx",
		sourceSha256: sha256(
			blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
		),
		blockCount: blocks.length,
		candidateId: "requirement_candidate_v120",
		candidatePromptSha256: "7".repeat(64),
		initialRanges: ["段落10", "段落40-段落50"],
		blocks,
	});
	const provisional = {
		owner_reason: "The source Owner boundaries were inspected.",
		residual_reason: "The projected second island is excluded by the provisional claim.",
		hard_root_claims: [hardRootClaim(0, 60)],
		run_selections: [
			{ run_index: 0, final_selected_ranges: ["段落10"] },
			{ run_index: 1, final_selected_ranges: [] },
		],
	};
	const final = {
		owner_reason: "The source Owner boundaries were inspected again.",
		residual_reason: "The source rebuts the provisional claim for block 40.",
		hard_root_claims: [],
		run_selections: [
			{ run_index: 0, final_selected_ranges: ["段落10"] },
			{ run_index: 1, final_selected_ranges: ["段落40"] },
		],
	};
	const { result, scripted } = await runScenario(
		[
			{ role: "finalizer", response: toolSelection(provisional, "provisional") },
			{
				role: "witness",
				response: toolWitness(
					witnessSubmission([
						witnessChallenge("owner_boundary", "select", ["段落40"], [40]),
					]),
				),
			},
			{ role: "finalizer", response: toolSelection(final, "final") },
		],
		undefined,
		undefined,
		"0".repeat(64),
		sourcePacket,
	);

	expect(scripted.observed[1].userPrompt).toContain('"block_id":40');
	expect(result.witness).toMatchObject({ status: "accepted" });
	expect(result.finalRanges).toEqual(["段落10", "段落40"]);
});

test("partitions mixed Witness ranges and does not grant an override", async () => {
	const { result, scripted } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(
				selection(["段落1-段落2"], [hardRootClaim(0, 2)]),
				"provisional",
			),
		},
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("atom_membership", "exclude", ["段落1-段落2"], [0, 1, 2]),
				]),
			),
		},
		{
			role: "finalizer",
			response: toolSelection(
				selection(["段落2"], [hardRootClaim(0, 2)], "The Witness is rebutted for block 2."),
				"final",
			),
		},
	]);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落2"]);
	expect(result.witness?.challenges).toMatchObject([
		{
			cardSlot: "exclude",
			kind: "atom_membership",
			direction: "exclude",
			ranges: ["段落1"],
			overlapsProvisionalHardClaim: true,
		},
		{
			cardSlot: "exclude",
			kind: "atom_membership",
			direction: "exclude",
			ranges: ["段落2"],
			overlapsProvisionalHardClaim: false,
		},
	]);
	expect(scripted.observed[2].userPrompt).toContain(
		'"selection_intersects_hard_claim_ranges":["段落1"]',
	);
	expect(scripted.observed[2].userPrompt).toContain(
		"does not choose which side is semantically correct",
	);
	expect(result.trace.finalClaimSelectionConflicts).toEqual([]);
});

test("rejects the entire select lane when its target mixes provisional states", async () => {
	const rejectedPremise = "REJECTED_SELECT_MIXED_STATE_PREMISE_MUST_NOT_BE_FORWARDED";
	const { result, scripted } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(
				selection(["段落1"], [hardRootClaim(0, 2)]),
				"provisional",
			),
		},
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					{
						...witnessChallenge(
							"atom_membership",
							"select",
							["段落1-段落2"],
							[0, 1, 2],
						),
						attacked_premise: rejectedPremise,
					},
				]),
			),
		},
		{
			role: "finalizer",
			response: toolSelection(
				selection(["段落2"], [hardRootClaim(0, 2)]),
				"final",
			),
		},
	]);

	expect(result.status).toBe("repaired");
	expect(result.witness).toMatchObject({
		status: "accepted",
		coverage: "partial",
		challenges: [],
		laneCoverage: {
			exclude: { status: "valid_none", forwarded: false },
			select: { status: "rejected_source_focus", forwarded: false },
		},
		trace: {
			rejectedLanes: [
				{
					lane: "select",
					forwarded: false,
					reason: {
						code: "source_focus_authorization",
						wrongStateTargetBlockIds: [1],
						outOfGroupTargetBlockIds: [1],
					},
				},
			],
		},
	});
	expect(scripted.callCount()).toBe(3);
	const review = witnessReviewPacket(scripted.observed[2]);
	expect(review).toEqual({
		coverage: "partial",
		lane_status: { exclude: "valid_none", select: "rejected_source_focus" },
		challenges: [],
	});
	expect(JSON.stringify(review)).not.toContain(rejectedPremise);
});

test("allows the Finalizer to rebut a Witness select challenge without an override", async () => {
	const { result } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(selection([], [hardRootClaim(0, null)]), "provisional"),
		},
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("owner_boundary", "select", ["段落2"], [0, 2]),
				]),
			),
		},
		{
			role: "finalizer",
			response: toolSelection(
				selection([], [hardRootClaim(0, null)], "The source rebuts the Witness."),
				"final",
			),
		},
	]);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.witness?.challenges).toMatchObject([
		{
			kind: "owner_boundary",
			direction: "select",
			ranges: ["段落2"],
			overlapsProvisionalHardClaim: true,
		},
	]);
	expect(result.trace.finalClaimSelectionConflicts).toEqual([]);
});

test("accepts selection after the Finalizer narrows its hard-root claim", async () => {
	const { result } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(selection([], [hardRootClaim(0, null)]), "provisional"),
		},
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("owner_boundary", "select", ["段落2"], [0, 2]),
				]),
			),
		},
		{
			role: "finalizer",
			response: toolSelection(
				selection(
					["段落2"],
					[hardRootClaim(0, 2)],
					"The source proves block 2 begins after the corrected peer exit.",
				),
				"final",
			),
		},
	]);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落2"]);
	expect(result.decision?.hardRootClaims).toEqual([
		{
			carrierType: "contract_terms",
			rootBlockId: 0,
			exitBlockIdExclusive: 2,
			projectedRanges: ["段落0-段落1"],
		},
	]);
	expect(result.trace.finalClaimSelectionConflicts).toEqual([]);
	expect(result.failure).toBeNull();
});

test("normalizes terminalBlockId plus one to an EOF hard-root exit", async () => {
	const rawProvisional = selection([], [hardRootClaim(0, 3)], "Provisional EOF claim.");
	const rawFinal = selection([], [hardRootClaim(0, 3)], "Final EOF claim.");
	const { result } = await runScenario([
		{ role: "finalizer", response: toolSelection(rawProvisional, "eof-provisional") },
		{ role: "witness", response: toolWitness(witnessSubmission([])) },
		{ role: "finalizer", response: toolSelection(rawFinal, "eof-final") },
	]);

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.trace.rawSubmissions).toEqual([rawProvisional, rawFinal]);
	expect(result.trace.normalizedSubmissions).toEqual([
		selection([], [hardRootClaim(0, null)], "Provisional EOF claim."),
		selection([], [hardRootClaim(0, null)], "Final EOF claim."),
	]);
	expect(result.provisionalDecision?.hardRootClaims).toEqual([
		{
			carrierType: "contract_terms",
			rootBlockId: 0,
			exitBlockIdExclusive: null,
			projectedRanges: ["段落0-段落2"],
		},
	]);
	expect(result.decision?.hardRootClaims).toEqual(result.provisionalDecision?.hardRootClaims);
});

test("fails closed when final selection still intersects its hard-root claim", async () => {
	const { result } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(selection([], [hardRootClaim(0, null)]), "provisional"),
		},
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("owner_boundary", "select", ["段落2"], [0, 2]),
				]),
			),
		},
		{
			role: "finalizer",
			response: toolSelection(selection(["段落2"], [hardRootClaim(0, null)]), "final"),
		},
	]);

	expect(result.status).toBe("degraded");
	expect(result.reviewDegraded).toBe(true);
	expect(result.resolution).toBe("review_incomplete");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.patch).toBeNull();
	expect(result.decision).toBeNull();
	expect(result.trace.finalClaimSelectionConflicts).toEqual(["段落2"]);
	expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
	expect(result.failure?.message).toContain("intersects final hard-root projection");
	expect(result.budget.providerCalls).toBe(3);
	expect(result.trace).not.toHaveProperty("owner_claim_witness_override_ranges");
	expect(result.trace).not.toHaveProperty("owner_claim_enforced_exclude_ranges");
});

test("does not retry malformed Witness tool arguments or apply the Finalizer repair", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness({
				...witnessSubmission([]),
				summary: "extra field is forbidden",
			}),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.patch).toBeNull();
	expect(result.decision).toBeNull();
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.witness?.error).toContain("additional");
	expect(result.failure).toMatchObject({ role: "witness", code: "contract_error" });
	expect(result.budget.roles.finalizer.providerCalls).toBe(2);
	expect(result.budget.roles.witness.providerCalls).toBe(1);
});

test("accepts one Witness challenge in each direction", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("atom_membership", "exclude", ["段落0"], [0]),
					witnessChallenge("atom_membership", "select", ["段落1"], [1]),
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落1-段落2"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.witness?.challenges).toMatchObject([
		{ cardSlot: "exclude", direction: "exclude", ranges: ["段落0"] },
		{ cardSlot: "select", direction: "select", ranges: ["段落1"] },
	]);
});

test("rejects arrays in a fixed Witness lane", async () => {
	const selectChallenge = witnessChallenge("atom_membership", "select", ["段落1"], [1]);
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness({
				exclude: emptyWitnessLane(),
				select: [selectChallenge, selectChallenge],
			}),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.witness?.error).toContain("/select: must be object");
});

test("preserves a complete long Witness premise without contract failure", async () => {
	const longPremise = `${[
		"源文明确说明采购对象必须在约定地点完成系统部署、参数配置、接口联调和数据初始化",
		"同时要求供应商按照既定时间表提交实施记录、测试报告、培训材料和验收所需证明",
		"并对故障响应时限、问题闭环方式、服务责任主体、备件保障范围和持续运维周期作出明确约束",
		"这些条款共同形成可执行、可检查且直接约束中标后履约活动的完整采购要求",
		"因此不能因为相关内容跨越多个连续段落或包含必要背景连接语就把该义务误判为说明性材料",
		"被攻击的 provisional premise 忽略了上述动作、对象、参数、时限、记录和验收条件之间不可分割的语义关系",
	].join("，")}。`;
	const submission = witnessSubmission([
		{
			...witnessChallenge("atom_membership", "exclude", ["段落0"], [0]),
			attacked_premise: longPremise,
		},
	]);
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{ role: "witness", response: toolWitness(submission) },
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(longPremise.length).toBeGreaterThanOrEqual(239);
	expect(scripted.callCount()).toBe(3);
	expect(result.witness).toMatchObject({ status: "accepted" });
	expect(result.witness?.challenges[0]?.attackedPremise).toBe(longPremise);
	expect(result.witness?.trace.rawArguments).toEqual([JSON.stringify(submission)]);
	expect(result.witness?.trace.normalizedArguments).toEqual([submission]);
});

test("rejects a whitespace-only Witness premise", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					{
						...witnessChallenge("atom_membership", "exclude", ["段落0"], [0]),
						attacked_premise: "   ",
					},
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.witness?.error).toContain("non-blank");
});

test("rejects a legacy verdict field inside a fixed Witness lane", async () => {
	const valid = witnessSubmission([
		witnessChallenge("atom_membership", "exclude", ["段落0"], [0]),
	]);
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness({
				...valid,
				exclude: { ...valid.exclude, verdict: "exclude" },
			}),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.witness?.error).toContain("additional");
});

test("rejects a missing Witness lane", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness({ exclude: emptyWitnessLane() }),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.witness?.error).toContain("select");
});

test("rejects null, string null, empty objects, old slots, and direction fields", async () => {
	const valid = witnessSubmission([
		witnessChallenge("atom_membership", "exclude", ["段落0"], [0]),
	]);
	for (const invalidWitness of [
		{ exclude: null, select: emptyWitnessLane() },
		{ exclude: "null", select: emptyWitnessLane() },
		{ exclude: {}, select: emptyWitnessLane() },
		{ primary_challenge: null, secondary_challenge: null },
		{ exclude_challenge: null, select_challenge: null },
		{ ...valid, exclude: { ...valid.exclude, direction: "exclude" } },
	]) {
		const { result } = await runScenario([
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
			{
				role: "witness",
				response: toolWitness(invalidWitness),
			},
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
		]);

		expect(result.status).toBe("degraded");
		expect(result.witness).toMatchObject({ status: "contract_failure" });
		expect(result.witness?.trace.structuredTerminal).toBe(false);
	}
});

test("enforces every fixed Witness lane field and none/non-none invariants", async () => {
	const validChallenge = witnessSubmission([
		witnessChallenge("atom_membership", "exclude", ["段落0"], [0]),
	]);
	const invalidWitnesses: unknown[] = [
		{ ...witnessSubmission(), exclude: { ...emptyWitnessLane(), ranges: ["段落0"] } },
		{ ...witnessSubmission(), exclude: { ...emptyWitnessLane(), attacked_premise: "x" } },
		{ ...witnessSubmission(), exclude: { ...emptyWitnessLane(), supporting_block_ids: [0] } },
		{ ...validChallenge, exclude: { ...validChallenge.exclude, ranges: [] } },
		{ ...validChallenge, exclude: { ...validChallenge.exclude, attacked_premise: "" } },
		{ ...validChallenge, exclude: { ...validChallenge.exclude, supporting_block_ids: [] } },
		{
			...validChallenge,
			exclude: {
				kind: validChallenge.exclude.kind,
				ranges: validChallenge.exclude.ranges,
				supporting_block_ids: validChallenge.exclude.supporting_block_ids,
			},
		},
	];
	for (const invalidWitness of invalidWitnesses) {
		const { result, scripted } = await runScenario([
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
			{ role: "witness", response: toolWitness(invalidWitness) },
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
		]);

		expect(scripted.callCount()).toBe(3);
		expect(result.status).toBe("degraded");
		expect(result.witness).toMatchObject({ status: "contract_failure" });
	}
});

test("rejects the entire exclude lane when its target is already excluded", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("atom_membership", "exclude", ["段落1"], [1]),
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(result.witness).toMatchObject({
		status: "accepted",
		coverage: "partial",
		challenges: [],
		laneCoverage: {
			exclude: { status: "rejected_source_focus", forwarded: false },
			select: { status: "valid_none", forwarded: false },
		},
	});
	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(scripted.callCount()).toBe(3);
});

test("rejects a Witness challenge that bundles disjoint ranges", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("atom_membership", "exclude", ["段落0", "段落2"], [0, 2]),
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.failure).toMatchObject({ role: "witness", code: "contract_error" });
});

test("rejects Witness evidence outside its bounded source focus", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("atom_membership", "exclude", ["段落0"], [9]),
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.witness).toMatchObject({ status: "contract_failure" });
	expect(result.witness?.error).toContain("unavailable block 9");
});

test("abstains only the Witness lane whose target is outside bounded source focus", async () => {
	const blocks = Array.from({ length: 100 }, (_, blockId) => ({
		blockId,
		text: `Source block ${blockId}.`,
	}));
	const sourcePacket = parseRequirementReviewPacket({
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: "unseen-witness-target.docx",
		sourceSha256: sha256(
			blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
		),
		blockCount: blocks.length,
		candidateId: "requirement_candidate_v120",
		candidatePromptSha256: "7".repeat(64),
		initialRanges: ["段落0-段落99"],
		blocks,
	});
	const { result, scripted } = await runScenario(
		[
			{
				role: "finalizer",
				response: toolSelection(selection(["段落0-段落99"]), "provisional"),
			},
			{
				role: "witness",
				response: toolWitness(
					witnessSubmission([
						witnessChallenge("atom_membership", "exclude", ["段落50"], [0]),
					]),
				),
			},
			{
				role: "finalizer",
				response: toolSelection(selection(["段落0-段落99"]), "final"),
			},
		],
		undefined,
		undefined,
		"0".repeat(64),
		sourcePacket,
	);

	expect(scripted.observed[1].userPrompt).toContain('"block_id":0');
	expect(scripted.observed[1].userPrompt).not.toContain('"block_id":50');
	expect(result.status).toBe("preserved");
	expect(result.witness).toMatchObject({
		status: "accepted",
		coverage: "partial",
		challenges: [],
		laneCoverage: {
			exclude: { status: "rejected_source_focus", forwarded: false },
			select: { status: "valid_none", forwarded: false },
		},
		trace: {
			rejectedLanes: [
				{
					lane: "exclude",
					forwarded: false,
					reason: {
						code: "source_focus_authorization",
						unseenTargetBlockIds: [50],
						outOfGroupTargetBlockIds: [50],
						wrongStateTargetBlockIds: [],
						unseenSupportingBlockIds: [],
					},
				},
			],
		},
	});
	expect(result.failure).toBeNull();
	expect(scripted.callCount()).toBe(3);
	expect(witnessReviewPacket(scripted.observed[2])).toEqual({
		coverage: "partial",
		lane_status: { exclude: "rejected_source_focus", select: "valid_none" },
		challenges: [],
	});
});

test("abstains one lane when supporting source exists but was not visible in focus", async () => {
	const blocks = Array.from({ length: 100 }, (_, blockId) => ({
		blockId,
		text: `Source block ${blockId}.`,
	}));
	const sourcePacket = parseRequirementReviewPacket({
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: "unseen-witness-support.docx",
		sourceSha256: sha256(
			blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
		),
		blockCount: blocks.length,
		candidateId: "requirement_candidate_v120",
		candidatePromptSha256: "7".repeat(64),
		initialRanges: ["段落0-段落99"],
		blocks,
	});
	const rejectedPremise = "REJECTED_UNSEEN_SUPPORT_PREMISE_MUST_NOT_BE_FORWARDED";
	const { result, scripted } = await runScenario(
		[
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
			{
				role: "witness",
				response: toolWitness(
					witnessSubmission([
						{
							...witnessChallenge("atom_membership", "exclude", ["段落0"], [50]),
							attacked_premise: rejectedPremise,
						},
					]),
				),
			},
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
		],
		undefined,
		undefined,
		"0".repeat(64),
		sourcePacket,
	);

	expect(result.status).toBe("repaired");
	expect(result.witness).toMatchObject({
		status: "accepted",
		coverage: "partial",
		laneCoverage: {
			exclude: { status: "rejected_source_focus", forwarded: false },
			select: { status: "valid_none", forwarded: false },
		},
		trace: {
			rejectedLanes: [
				{
					lane: "exclude",
					rawLane: { supporting_block_ids: [50] },
					forwarded: false,
					reason: {
						unseenSupportingBlockIds: [50],
						unseenTargetBlockIds: [],
						wrongStateTargetBlockIds: [],
						outOfGroupTargetBlockIds: [],
					},
				},
			],
		},
	});
	expect(scripted.callCount()).toBe(3);
	const review = witnessReviewPacket(scripted.observed[2]);
	expect(review).toEqual({
		coverage: "partial",
		lane_status: { exclude: "rejected_source_focus", select: "valid_none" },
		challenges: [],
	});
	expect(review).not.toHaveProperty("error");
	expect(JSON.stringify(review)).not.toContain(rejectedPremise);
	expect(JSON.stringify(review)).not.toContain("supporting_block_ids");
});

test("forwards one valid lane while the other lane mechanically abstains", async () => {
	const rejectedPremise = "REJECTED_EXCLUDE_PREMISE_MUST_NOT_BE_FORWARDED";
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					{
						...witnessChallenge("atom_membership", "exclude", ["段落1"], [1]),
						attacked_premise: rejectedPremise,
					},
					witnessChallenge("atom_membership", "select", ["段落1"], [1]),
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落1"]), "final") },
	]);

	expect(result.status).toBe("repaired");
	expect(result.witness).toMatchObject({
		status: "accepted",
		coverage: "partial",
		laneCoverage: {
			exclude: { status: "rejected_source_focus", forwarded: false },
			select: { status: "valid_challenge", forwarded: true },
		},
		challenges: [
			{
				cardSlot: "select",
				direction: "select",
				ranges: ["段落1"],
			},
		],
	});
	expect(scripted.callCount()).toBe(3);
	const review = witnessReviewPacket(scripted.observed[2]);
	expect(review.coverage).toBe("partial");
	expect(review.lane_status).toEqual({
		exclude: "rejected_source_focus",
		select: "valid_challenge",
	});
	expect(review.challenges).toMatchObject([
		{ card_slot: "select", direction: "select", ranges: ["段落1"] },
	]);
	expect(JSON.stringify(review)).not.toContain(rejectedPremise);
});

test("fails closed only when both source-focus lanes mechanically abstain", async () => {
	const rejectedExcludePremise = "REJECTED_EXCLUDE_DOUBLE_ABSTENTION";
	const rejectedSelectPremise = "REJECTED_SELECT_DOUBLE_ABSTENTION";
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					{
						...witnessChallenge("atom_membership", "exclude", ["段落1"], [1]),
						attacked_premise: rejectedExcludePremise,
					},
					{
						...witnessChallenge("atom_membership", "select", ["段落0"], [0]),
						attacked_premise: rejectedSelectPremise,
					},
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.witness).toMatchObject({
		status: "contract_failure",
		coverage: "none",
		laneCoverage: {
			exclude: { status: "rejected_source_focus", forwarded: false },
			select: { status: "rejected_source_focus", forwarded: false },
		},
		error: "both Witness lanes failed source-focus authorization",
		trace: {
			rejectedLanes: [
				{ lane: "exclude", forwarded: false },
				{ lane: "select", forwarded: false },
			],
		},
	});
	expect(result.failure).toMatchObject({ role: "witness", code: "contract_error" });
	const review = witnessReviewPacket(scripted.observed[2]);
	expect(review).toEqual({
		coverage: "none",
		lane_status: {
			exclude: "rejected_source_focus",
			select: "rejected_source_focus",
		},
		challenges: [],
	});
	expect(JSON.stringify(review)).not.toContain(rejectedExcludePremise);
	expect(JSON.stringify(review)).not.toContain(rejectedSelectPremise);
	expect(review).not.toHaveProperty("error");
});

test("records target state and group violations without trimming the rejected card", async () => {
	const { result, scripted } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(selection(["段落0", "段落2"]), "provisional"),
		},
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("atom_membership", "exclude", ["段落0-段落2"], [0, 2]),
				]),
			),
		},
		{
			role: "finalizer",
			response: toolSelection(selection(["段落0", "段落2"]), "final"),
		},
	]);

	expect(result.status).toBe("repaired");
	expect(result.witness).toMatchObject({
		status: "accepted",
		coverage: "partial",
		challenges: [],
		trace: {
			rejectedLanes: [
				{
					lane: "exclude",
					rawLane: { ranges: ["段落0-段落2"] },
					forwarded: false,
					reason: {
						wrongStateTargetBlockIds: [1],
						outOfGroupTargetBlockIds: [1, 2],
					},
				},
			],
		},
	});
	expect(scripted.callCount()).toBe(3);
});

test("applies global source validation before either lane can abstain", async () => {
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(
				witnessSubmission([
					witnessChallenge("atom_membership", "exclude", ["段落1"], [1]),
					witnessChallenge("atom_membership", "select", ["段落99"], [1]),
				]),
			),
		},
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.witness).toMatchObject({
		status: "contract_failure",
		coverage: null,
		laneCoverage: null,
		trace: { rejectedLanes: [] },
	});
	expect(result.witness?.error).toContain("select.ranges references unavailable block 99");
});

test("rejects every non-pure Witness JSON response shape without retrying", async () => {
	const validJson = JSON.stringify(witnessSubmission());
	const invalidResponses: Array<{ name: string; response: AssistantMessage }> = [
		{
			name: "partial JSON",
			response: fauxAssistantMessage(fauxText('{"exclude":'), { stopReason: "stop" }),
		},
		{
			name: "prose wrapped JSON",
			response: fauxAssistantMessage(fauxText(`Result: ${validJson}`), { stopReason: "stop" }),
		},
		{
			name: "markdown wrapped JSON",
			response: fauxAssistantMessage(fauxText(`\`\`\`json\n${validJson}\n\`\`\``), {
				stopReason: "stop",
			}),
		},
		{
			name: "multiple text blocks",
			response: fauxAssistantMessage([fauxText(validJson), fauxText(" ")], {
				stopReason: "stop",
			}),
		},
		{
			name: "thinking content",
			response: fauxAssistantMessage([fauxThinking("hidden"), fauxText(validJson)], {
				stopReason: "stop",
			}),
		},
		{
			name: "tool call",
			response: fauxAssistantMessage(
				fauxToolCall("submit_semantic_witness", witnessSubmission(), { id: "forbidden-tool" }),
				{ stopReason: "toolUse" },
			),
		},
		{
			name: "truncated JSON",
			response: fauxAssistantMessage(fauxText(validJson), { stopReason: "length" }),
		},
	];
	for (const invalid of invalidResponses) {
		const { result, scripted } = await runScenario([
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
			{ role: "witness", response: invalid.response },
			{ role: "finalizer", response: toolSelection(selection(["段落0"]), "final") },
		]);

		expect(scripted.callCount(), invalid.name).toBe(3);
		expect(result.status, invalid.name).toBe("degraded");
		expect(result.finalRanges, invalid.name).toEqual(["段落0-段落2"]);
		expect(result.witness, invalid.name).toMatchObject({ status: "contract_failure" });
		expect(result.witness?.trace.structuredTerminal, invalid.name).toBe(false);
	}
});

test("fails closed when a non-empty Candidate selection escapes its Candidate-only universe", async () => {
	const { result, scripted } = await runScenario(
		[
			{
				role: "finalizer",
				response: toolSelection(selection(["段落1"]), "escaped-provisional"),
			},
		],
		["段落0"],
	);

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.patch).toBeNull();
	expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
	expect(result.failure?.message).toContain("escapes run 0 at block 1");
});

test("mechanically trims ordinary OUT spill while preserving one authorized island", async () => {
	const { result, scripted } = await runScenario(
		[
			{
				role: "finalizer",
				response: toolSelection(selection(["段落0-段落2"]), "projected-provisional"),
			},
			{
				role: "witness",
				response: toolWitness(witnessSubmission([])),
			},
			{
				role: "finalizer",
				response: toolSelection(selection(["段落0-段落2"]), "projected-final"),
			},
		],
		["段落1-段落2"],
	);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("preserved");
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.provisionalDecision?.trimmedOutOfRunRanges).toEqual(["段落0"]);
	expect(result.decision?.trimmedOutOfRunRanges).toEqual(["段落0"]);
	expect(scripted.observed[2].serializedContext).toContain("trimmed_out_of_run_ranges");
});

test("fails closed when one submitted range crosses another declared run", async () => {
	const crossRunSelection = {
		owner_reason: "The source Owner boundaries were inspected.",
		residual_reason: "The submitted range crosses two run permissions.",
		hard_root_claims: [],
		run_selections: [
			{ run_index: 0, final_selected_ranges: ["段落0-段落2"] },
			{ run_index: 1, final_selected_ranges: ["段落2"] },
		],
	};
	const { result, scripted } = await runScenario(
		[{ role: "finalizer", response: toolSelection(crossRunSelection, "cross-run") }],
		["段落0", "段落2"],
	);

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0", "段落2"]);
	expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
	expect(result.failure?.message).toContain("crosses another run at block 2");
});

test("rejects one wide range across collapsed islands but accepts explicit island ranges", async () => {
	const blocks = Array.from({ length: 33 }, (_, blockId) => ({
		blockId,
		text: `Source block ${blockId}.`,
	}));
	const initialRanges = blocks
		.filter((block) => block.blockId % 2 === 0)
		.map((block) => `段落${block.blockId}`);
	const sourcePacket = parseRequirementReviewPacket({
		schemaVersion: "xique.word-requirement-review.packet.v1",
		reviewMode: "candidate_protected_residual",
		version: "docx-paragraphs-v1",
		outputField: "完整采购需求编号范围",
		sourceName: "collapsed-islands.docx",
		sourceSha256: sha256(
			blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
		),
		blockCount: blocks.length,
		candidateId: "requirement_candidate_v120",
		candidatePromptSha256: "7".repeat(64),
		initialRanges,
		blocks,
	});
	const wideSelection = selection(["段落0-段落32"]);
	const failed = await runScenario(
		[{ role: "finalizer", response: toolSelection(wideSelection, "collapsed-wide") }],
		undefined,
		undefined,
		"0".repeat(64),
		sourcePacket,
	);

	expect(failed.scripted.callCount()).toBe(1);
	expect(failed.result.status).toBe("degraded");
	expect(failed.result.failure?.message).toContain("projects onto multiple authorized islands");

	const explicitSelection = selection(initialRanges);
	const accepted = await runScenario(
		[
			{ role: "finalizer", response: toolSelection(explicitSelection, "collapsed-provisional") },
			{ role: "witness", response: toolWitness(witnessSubmission([])) },
			{ role: "finalizer", response: toolSelection(explicitSelection, "collapsed-final") },
		],
		undefined,
		undefined,
		"0".repeat(64),
		sourcePacket,
	);

	expect(accepted.scripted.callCount()).toBe(3);
	expect(accepted.result.status).toBe("preserved");
	expect(accepted.result.context.runRegistry).toEqual([
		{ runIndex: 0, kind: "AUDIT_UNIVERSE", ranges: initialRanges },
	]);
	expect(accepted.result.finalRanges).toEqual(initialRanges);
});

test("expands an empty Candidate to the complete source for false-null review", async () => {
	const { result } = await runScenario(
		[
			{ role: "finalizer", response: toolSelection(selection(["段落1"]), "provisional") },
			{
				role: "witness",
				response: toolWitness(witnessSubmission([])),
			},
			{ role: "finalizer", response: toolSelection(selection(["段落1"]), "final") },
		],
		[],
	);

	expect(result.status).toBe("repaired");
	expect(result.candidateRanges).toEqual([]);
	expect(result.context.auditUniverseRanges).toEqual(["段落0-段落2"]);
	expect(result.finalRanges).toEqual(["段落1"]);
	expect(result.patch).toEqual({ addRanges: ["段落1"], removeRanges: [] });
});

test("honors an already-aborted workflow before the first provider call", async () => {
	const controller = new AbortController();
	controller.abort(new Error("cancelled by test"));
	const { result, scripted } = await runScenario([], undefined, controller.signal);

	expect(scripted.callCount()).toBe(0);
	expect(result.status).toBe("degraded");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.failure).toMatchObject({ role: "preflight", code: "aborted" });
});

test.each(["throw", "reject"] as const)(
	"converts a production Finalizer StreamFn %s into a typed provider failure",
	async (failureMode) => {
		compatStreamMock.mockReset();
		const error = new Error(`injected ${failureMode} provider failure`);
		if (failureMode === "throw") compatStreamMock.mockImplementationOnce(() => { throw error; });
		else compatStreamMock.mockRejectedValueOnce(error);
		const unusedWitness = scriptedScenario([]);
		const result = await runPiNativeRequirementReview({
			packet: packet(),
			packetSha256: "0".repeat(64),
			prompts,
			finalizerRuntime: {
				model: finalizerModel,
				streamFunction: piNativeFinalizerStreamFunction,
				apiKey: "test-key",
			},
			witnessRuntime: {
				model: witnessModel,
				streamFunction: unusedWitness.witnessStream,
				apiKey: "test-key",
			},
		});

		expect(compatStreamMock).toHaveBeenCalledTimes(1);
		expect(unusedWitness.callCount()).toBe(0);
		expect(result.status).toBe("degraded");
		expect(result.finalRanges).toEqual(["段落0-段落2"]);
		expect(result.failure).toMatchObject({
			role: "finalizer",
			code: "provider_error",
			message: `injected ${failureMode} provider failure`,
		});
		expect(result.budget.roles.finalizer.providerCalls).toBe(1);
	},
);

test("stops after invalid provisional schema, thinking, or extra tool calls", async () => {
	const malformed = fauxAssistantMessage(
		fauxToolCall(
			"submit_final_selection",
			{ owner_reason: "missing required fields" },
			{ id: "malformed-provisional" },
		),
		{ stopReason: "toolUse" },
	);
	const thinking = fauxAssistantMessage(
		[
			fauxThinking("hidden reasoning is forbidden"),
			fauxToolCall("submit_final_selection", selection(["段落0-段落2"]), {
				id: "thinking-provisional",
			}),
		],
		{ stopReason: "toolUse" },
	);
	const extraTool = fauxAssistantMessage(
		[
			fauxToolCall("submit_final_selection", selection(["段落0-段落2"]), {
				id: "extra-provisional-1",
			}),
			fauxToolCall("submit_final_selection", selection(["段落0-段落2"]), {
				id: "extra-provisional-2",
			}),
		],
		{ stopReason: "toolUse" },
	);

	for (const [response, expectedFailure] of [
		[malformed, "required"],
		[thinking, "thinking content"],
		[extraTool, "exactly one tool call"],
	] as const) {
		const { result, scripted } = await runScenario([{ role: "finalizer", response }]);

		expect(scripted.callCount()).toBe(1);
		expect(result.status).toBe("degraded");
		expect(result.decision).toBeNull();
		expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
		expect(result.failure?.message).toContain(expectedFailure);
		expect(result.budget.roles.finalizer.providerCalls).toBe(1);
		expect(result.budget.roles.witness.providerCalls).toBe(0);
	}
});

test("treats Finalizer text as trace-only auxiliary output", async () => {
	const provisionalText = "auxiliary provisional text";
	const finalText = "auxiliary final text";
	const { result, scripted } = await runScenario([
		{
			role: "finalizer",
			response: fauxAssistantMessage(
				[
					fauxText(provisionalText),
					fauxToolCall("submit_final_selection", selection(["段落0-段落2"]), {
						id: "mixed-provisional",
					}),
				],
				{ stopReason: "toolUse" },
			),
		},
		{
			role: "witness",
			response: toolWitness(witnessSubmission([])),
		},
		{
			role: "finalizer",
			response: fauxAssistantMessage(
				[
					fauxToolCall("submit_final_selection", selection(["段落0-段落2"]), {
						id: "mixed-final",
					}),
					fauxText(finalText),
				],
				{ stopReason: "toolUse" },
			),
		},
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("preserved");
	expect(result.reviewDegraded).toBe(false);
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.trace.finalizerAuxiliaryText).toEqual([
		{
			turnIndex: 1,
			characterCount: provisionalText.length,
			sha256: sha256(provisionalText),
			forwarded: false,
		},
		{
			turnIndex: 2,
			characterCount: finalText.length,
			sha256: sha256(finalText),
			forwarded: false,
		},
	]);
	expect(scripted.observed[2].serializedContext).not.toContain(provisionalText);
	expect(scripted.observed[2].serializedContext).not.toContain("mixed-provisional");
	expect(scripted.observed[2].serializedContext).toContain("REPLAY_TRUST_BOUNDARY");
	expect(scripted.observed[2].serializedContext).toContain(
		"UNTRUSTED_PROVISIONAL_SUBMISSION",
	);
	expect(scripted.observed[2].serializedContext).toContain("HARNESS_REVIEW_PACKET");
	expect(scripted.observed[2].serializedContext).toContain("review_available");
	expect(scripted.observed[2].serializedContext).toContain("mechanical_contract_blockers");
	expect(scripted.observed[2].serializedContext).toContain("review_evidence");
	expect(scripted.observed[2].serializedContext).not.toContain("repair_required");
	expect(scripted.observed[2].serializedContext).not.toContain("mechanical_conflicts");
	expect(scripted.observed[2].serializedContext).not.toContain('"role":"assistant"');
	expect(scripted.observed[2].serializedContext).not.toContain('"role":"toolResult"');
	expect(JSON.stringify(result.trace)).not.toContain(provisionalText);
	expect(JSON.stringify(result.trace)).not.toContain(finalText);
});

test("stops after a malformed final turn and never requests a fourth call", async () => {
	const malformedFinal = fauxAssistantMessage(
		fauxToolCall(
			"submit_final_selection",
			{ owner_reason: "missing required fields" },
			{ id: "malformed-final" },
		),
		{ stopReason: "toolUse" },
	);
	const { result, scripted } = await runScenario([
		{ role: "finalizer", response: toolSelection(selection(["段落0"]), "provisional") },
		{
			role: "witness",
			response: toolWitness(witnessSubmission([])),
		},
		{ role: "finalizer", response: malformedFinal },
	]);

	expect(scripted.callCount()).toBe(3);
	expect(result.status).toBe("degraded");
	expect(result.decision).toBeNull();
	expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
	expect(result.budget.providerCalls).toBe(3);
});

test("fails closed when one final hard root declares conflicting exits across carrier types", async () => {
	const { result } = await runScenario([
		{
			role: "finalizer",
			response: toolSelection(selection([], [hardRootClaim(0, 2)]), "provisional"),
		},
		{
			role: "witness",
			response: toolWitness(witnessSubmission([])),
		},
		{
			role: "finalizer",
			response: toolSelection(
				selection([], [hardRootClaim(0, 2), hardRootClaim(0, null, "announcement")]),
				"final",
			),
		},
	]);

	expect(result.status).toBe("degraded");
	expect(result.decision).toBeNull();
	expect(result.failure).toMatchObject({ role: "finalizer", code: "contract_error" });
	expect(result.failure?.message).toContain("conflicting exits for 0");
});

test("preflights the Witness worst-case context before any provider call", async () => {
	const scripted = scriptedScenario([]);
	const result = await runPiNativeRequirementReview({
		packet: packet(),
		packetSha256: "0".repeat(64),
		prompts,
		finalizerRuntime: {
			model: finalizerModel,
			streamFunction: scripted.finalizerStream,
			apiKey: "test-key",
		},
		witnessRuntime: {
			model: { ...witnessModel, contextWindow: 1 },
			streamFunction: scripted.witnessStream,
			apiKey: "test-key",
		},
	});

	expect(scripted.callCount()).toBe(0);
	expect(result.status).toBe("degraded");
	expect(result.failure).toMatchObject({ role: "preflight", code: "capacity" });
	expect(result.failure?.message).toContain("Witness input");
});

test("keeps the capability hash stable across packet identities", async () => {
	const scenario = () => [
		{ role: "finalizer" as const, response: toolSelection(selection(["段落0-段落2"]), "p") },
		{
			role: "witness" as const,
			response: toolWitness(witnessSubmission([])),
		},
		{ role: "finalizer" as const, response: toolSelection(selection(["段落0-段落2"]), "f") },
	];
	const first = await runScenario(scenario(), undefined, undefined, "1".repeat(64));
	const second = await runScenario(scenario(), undefined, undefined, "2".repeat(64));

	expect(first.result.capabilitySha256).toBe(second.result.capabilitySha256);
	expect(Object.keys(first.result.prompts).sort()).toEqual([
		"finalizer",
		"piNativeRuntimeContract",
		"piNativeSemanticContract",
		"witness",
	]);
});

test("builds the no-tools Doubao strict JSON-schema payload", () => {
	const payload = buildDoubaoWitnessPayload({
		model: witnessModel.id,
		tools: [
			{
				type: "function",
				function: {
					name: "submit_semantic_witness",
					strict: true,
					parameters: PiNativeSemanticWitnessSchema,
				},
			},
		],
		tool_choice: "required",
		parallel_tool_calls: true,
		reasoning_effort: "medium",
		response_format: { type: "json_schema" },
	});

	expect(payload).toMatchObject({
		model: witnessModel.id,
		thinking: { type: "disabled" },
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "word_requirement_semantic_witness",
				strict: true,
				schema: PiNativeSemanticWitnessSchema,
			},
		},
	});
	expect(payload).not.toHaveProperty("tools");
	expect(payload).not.toHaveProperty("tool_choice");
	expect(payload).not.toHaveProperty("parallel_tool_calls");
	expect(payload).not.toHaveProperty("reasoning_effort");
});

test("wires the no-tools strict JSON-schema transformer into the production Witness stream", async () => {
	compatStreamMock.mockReset();
	const inner = createAssistantMessageEventStream();
	compatStreamMock.mockReturnValueOnce(inner);

	const returned = await piNativeWitnessStreamFunction(
		witnessModel,
		{ messages: [] },
		{ reasoning: "off" },
	);
	const streamOptions = compatStreamMock.mock.calls.at(-1)?.[2] as
		| {
				onPayload?: (payload: unknown) => unknown;
				toolChoice?: unknown;
				parallelToolCalls?: unknown;
				reasoningEffort?: unknown;
		}
		| undefined;

	expect(returned).not.toBe(inner);
	expect(streamOptions?.onPayload).toBe(buildDoubaoWitnessPayload);
	expect(streamOptions).not.toHaveProperty("toolChoice");
	expect(streamOptions).not.toHaveProperty("parallelToolCalls");
	expect(streamOptions).not.toHaveProperty("reasoningEffort");
	const transformed = streamOptions?.onPayload?.({
		tools: [
			{
				type: "function",
				function: { name: "submit_semantic_witness", strict: true },
			},
		],
		response_format: { type: "json_schema" },
	});
	expect(transformed).toMatchObject({
		thinking: { type: "disabled" },
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "word_requirement_semantic_witness",
				strict: true,
				schema: PiNativeSemanticWitnessSchema,
			},
		},
	});
	expect(transformed).not.toHaveProperty("tools");
	expect(transformed).not.toHaveProperty("tool_choice");
	const response = toolWitness(witnessSubmission());
	inner.push({ type: "done", reason: "stop", message: response });
	await expect(returned.result()).resolves.toBe(response);
});
