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
	type RequirementReviewStructureEvidence,
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

function packetValue(
	blocks: RequirementReviewBlock[],
	initialRanges: string[],
	structureEvidence?: RequirementReviewStructureEvidence,
) {
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
		...(structureEvidence ? { structureEvidence } : {}),
	};
}

function structureEvidence(
	blocks: readonly RequirementReviewBlock[],
	entries: RequirementReviewStructureEvidence["entries"],
): RequirementReviewStructureEvidence {
	return {
		schemaVersion: "xique.word-structure-evidence.v1",
		docxSha256: "8".repeat(64),
		sourceSha256: sha256(renderSource(blocks)),
		sourceBlockCount: blocks.length,
		matchedBlockCount: entries.length,
		exactMatchCount: entries.filter((entry) => entry.matchConfidence === "exact").length,
		entries,
	};
}

function paragraphStructure(
	blockId: number,
	bodyIndex = blockId,
): RequirementReviewStructureEvidence["entries"][number] {
	return {
		blockId,
		matchConfidence: "exact",
		bodyIndex,
		kind: "paragraph",
		styleId: null,
		styleName: null,
		outlineLevel: null,
		numberingLevel: null,
		pageBreakBefore: false,
		keepNext: false,
		alignment: null,
		boldRatio: 0,
		fontSizes: [],
		outlinePath: [],
		table: null,
	};
}

function tool(name: string, args: Record<string, unknown>, id: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function release(
	deltas: {
		hardCarrierReason?: string;
		restoredRemoveRanges?: string[];
		hardExcludedRanges?: string[];
		outsideCarrierExcludedRanges?: string[];
		acceptedAddRanges?: string[];
	},
	reason: string,
): Record<string, unknown> {
	return {
		hard_carrier_reason:
			deltas.hardCarrierReason ?? "The candidate-wide four-carrier audit is complete.",
		residual_reason: reason,
		restored_remove_ranges: deltas.restoredRemoveRanges ?? [],
		hard_excluded_ranges: deltas.hardExcludedRanges ?? [],
		outside_carrier_excluded_ranges: deltas.outsideCarrierExcludedRanges ?? [],
		accepted_add_ranges: deltas.acceptedAddRanges ?? [],
	};
}

function scriptedStream(responses: AssistantMessage[], expectedModel = model): {
	streamFunction: StreamFn;
	callCount: () => number;
	userPrompts: string[];
	toolParameterKeys: string[][];
	thinkingLevels: Array<string | undefined>;
} {
	let calls = 0;
	const userPrompts: string[] = [];
	const toolParameterKeys: string[][] = [];
	const thinkingLevels: Array<string | undefined> = [];
	return {
		streamFunction(selectedModel, context, options) {
			expect(selectedModel.id).toBe(expectedModel.id);
			const response = responses[calls];
			if (!response) throw new Error(`unexpected provider call ${calls + 1}`);
			const toolNames = context.tools?.map((candidate) => candidate.name) ?? [];
			const parameters = context.tools?.[0]?.parameters as {
				properties?: Record<string, unknown>;
			} | undefined;
			toolParameterKeys.push(Object.keys(parameters?.properties ?? {}));
			thinkingLevels.push(options?.reasoning);
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
		thinkingLevels,
	};
}

function roleRuntime(streamFunction: StreamFn, runtimeModel = model) {
	return { model: runtimeModel, streamFunction, apiKey: "test-key" };
}

test("uses medium Reviewer thinking and disables Release thinking", async () => {
	const reasoningModel: Model<"openai-completions"> = {
		...model,
		id: "reasoning-faux",
		name: "Reasoning Faux",
		reasoning: true,
	};
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "仅包含可安全删除的非需求内容。" }], ["段落0"]),
	);
	const scripted = scriptedStream(
		[
			tool(
				"submit_requirement_residual_review",
				{
					verdict: "challenge",
					...buyerIssuedReviewFields,
					issue_type: "boundary",
					add_ranges: [],
					removal: { mode: "exact", remove_ranges: ["段落0"] },
					reason: "The Candidate contains one independently removable non-requirement block.",
				},
				"thinking-reviewer",
			),
		tool(
			"submit_requirement_release",
			release(
				{ hardExcludedRanges: ["段落0"] },
				"The challenged block is safely excluded.",
			),
				"thinking-release",
			),
		],
		reasoningModel,
	);
	const result = await runRequirementReview({
		packet,
		packetSha256: "0".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction, reasoningModel),
		releaseRuntime: roleRuntime(scripted.streamFunction, reasoningModel),
	});

	expect(result.status).toBe("repaired");
	expect(scripted.thinkingLevels).toEqual(["medium", "off"]);
	expect(result.context).toMatchObject({
		reviewerThinkingLevel: "medium",
		releaseThinkingLevel: "off",
	});
});

test("rejects answer-bearing packet fields", () => {
	const blocks = [{ blockId: 0, text: "采购人要求提供网络安全服务。" }];
	expect(() =>
		parseRequirementReviewPacket({
			...packetValue(blocks, ["段落0"]),
			expectedRanges: ["段落0"],
		}),
	).toThrow("answer-bearing field is forbidden");
});

test("rejects Word structure evidence that is not bound to the canonical source", () => {
	const blocks = [{ blockId: 0, text: "采购人要求提供网络安全服务。" }];
	const evidence = structureEvidence(blocks, [paragraphStructure(0)]);
	expect(() =>
		parseRequirementReviewPacket({
			...packetValue(blocks, ["段落0"]),
			structureEvidence: { ...evidence, sourceSha256: "9".repeat(64) },
		}),
	).toThrow("structureEvidence sourceSha256 mismatch");
});

test("provides the same answer-free Word structure map to Reviewer and Release", async () => {
	const blocks = [
		{ blockId: 0, text: "采购需求书。" },
		{ blockId: 1, text: "采购人要求完成系统安装。" },
		{ blockId: 2, text: "技术参数表。" },
		{ blockId: 3, text: "响应文件格式。" },
		{ blockId: 4, text: "供应商盖章。" },
	];
	const heading = {
		...paragraphStructure(0),
		styleId: "Heading1",
		styleName: "heading 1",
		outlineLevel: 0,
		alignment: "center",
		boldRatio: 1,
		fontSizes: [32],
		outlinePath: [{ level: 0, blockId: 0 }],
	};
	const table = {
		...paragraphStructure(2),
		kind: "table" as const,
		outlinePath: [{ level: 0, blockId: 0 }],
		table: { rowCount: 6, cellCount: 24, paragraphCount: 24 },
	};
	const formatHeading = {
		...paragraphStructure(3),
		outlineLevel: 0,
		pageBreakBefore: true,
		boldRatio: 1,
		fontSizes: [28],
		outlinePath: [{ level: 0, blockId: 3 }],
	};
	const packet = parseRequirementReviewPacket(
		packetValue(
			blocks,
			["段落0-段落4"],
			structureEvidence(blocks, [
				heading,
				{ ...paragraphStructure(1), outlinePath: [{ level: 0, blockId: 0 }] },
				table,
				formatHeading,
				{ ...paragraphStructure(4), outlinePath: [{ level: 0, blockId: 3 }] },
			]),
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
				remove_ranges: ["段落3-段落4"],
				preserve_ranges: [],
				reason: "The response-format carrier is mechanically addressable and removable.",
			},
			"reviewer-structure-map",
		),
		tool(
			"submit_requirement_release",
			release(
				{ hardExcludedRanges: ["段落3-段落4"] },
				"The independent source and structure review approves the removal.",
			),
			"release-structure-map",
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
	expect(result.context).toMatchObject({
		structureEvidenceProvided: true,
		structureEvidenceEntryCount: 5,
		structureMapCoverage: "complete",
	});
	for (const prompt of scripted.userPrompts) {
		expect(prompt).toContain("# Optional mechanically aligned Word structure map");
		expect(prompt).toContain('S|0|b=0|k=p|m=x|sty="heading 1"|ol=0|a=center|br=1.000|fs=32|path=0@0');
		expect(prompt).toContain("S|2|b=2|k=t|m=x|path=0@0|tbl=6/24/24");
		expect(prompt).toContain("S|3|b=3|k=p|m=x|ol=0|pb=1|br=1.000|fs=28|path=0@3");
	}
	expect(scripted.userPrompts[1]).toContain(
		"# Challenged-side structural navigation focus (bounded mechanical duplicate)",
	);
	expect(scripted.userPrompts[1]).toContain("releaseChallengeStructureFocusTargetNodeCount=2");
	expect(scripted.userPrompts[1]).toContain("releaseChallengeStructureFocusIncludedNodeCount=2");
	expect(scripted.userPrompts[1]).toContain("releaseChallengeStructureFocusCoverage=complete");
	expect(scripted.userPrompts[1]).toContain('CHANGE_STRUCTURE|S|3|b=3|k=p|m=x|ol=0');
	expect(scripted.userPrompts[1]).toContain("CHANGE_STRUCTURE|S|4|b=4|k=p|m=x");
	expect(scripted.userPrompts[1]).not.toContain("CHANGE_STRUCTURE|S|0|");
});

test("bounds a large Word structure map with content-blind sampling", async () => {
	const blocks = Array.from({ length: 500 }, (_, blockId) => ({
		blockId,
		text: `结构段落${blockId}。`,
	}));
	const entries = blocks.map(({ blockId }) => ({
		...paragraphStructure(blockId),
		pageBreakBefore: true,
	}));
	const packet = parseRequirementReviewPacket(
		packetValue(blocks, ["段落0-段落499"], structureEvidence(blocks, entries)),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "pass",
				...buyerIssuedReviewFields,
				reason: "The complete Candidate remains source-supported.",
			},
			"reviewer-bounded-structure-map",
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
	expect(result.context.structureMapCoverage).toBe("partial");
	expect(result.context.structureMapNodeCount).toBeLessThanOrEqual(384);
	expect(result.context.structureMapCharacterCount).toBeLessThanOrEqual(24_000);
	expect(scripted.userPrompts[0]).toContain("structureMapCoverage=partial");
});

test("derives content-blind visual peer navigation for non-outline headings", async () => {
	const blocks = [
		{ blockId: 0, text: "第五章 技术服务要求。" },
		{ blockId: 1, text: "一、项目概述。" },
		{ blockId: 2, text: "采购人要求完成全过程服务。" },
		{ blockId: 3, text: "二、独立载体。" },
		{ blockId: 4, text: "载体内部第一项。" },
		{ blockId: 5, text: "载体内部第二项。" },
		{ blockId: 6, text: "第六章 后续章节。" },
	];
	const topHeading = {
		...paragraphStructure(0),
		outlineLevel: 0,
		alignment: "center",
		boldRatio: 1,
		fontSizes: [36],
		outlinePath: [{ level: 0, blockId: 0 }],
	};
	const firstVisualHeading = {
		...paragraphStructure(1),
		alignment: "both",
		boldRatio: 1,
		fontSizes: [28],
		outlinePath: [{ level: 0, blockId: 0 }],
	};
	const secondVisualHeading = {
		...paragraphStructure(3),
		alignment: "both",
		boldRatio: 1,
		fontSizes: [28],
		outlinePath: [{ level: 0, blockId: 0 }],
	};
	const nextHeading = {
		...paragraphStructure(6),
		outlineLevel: 0,
		alignment: "center",
		boldRatio: 1,
		fontSizes: [36],
		outlinePath: [{ level: 0, blockId: 6 }],
	};
	const packet = parseRequirementReviewPacket(
		packetValue(
			blocks,
			["段落0-段落6"],
			structureEvidence(blocks, [
				topHeading,
				firstVisualHeading,
				{ ...paragraphStructure(2), outlinePath: [{ level: 0, blockId: 0 }] },
				secondVisualHeading,
				{ ...paragraphStructure(4), outlinePath: [{ level: 0, blockId: 0 }] },
				{ ...paragraphStructure(5), outlinePath: [{ level: 0, blockId: 0 }] },
				nextHeading,
			]),
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
				remove_ranges: ["段落3-段落5"],
				preserve_ranges: [],
				reason: "The second visual peer starts an independently removable carrier.",
			},
			"reviewer-visual-navigation",
		),
		tool(
			"submit_requirement_release",
			release(
				{ hardExcludedRanges: ["段落3-段落5"] },
				"The visual boundary hypothesis is source-confirmed.",
			),
			"release-visual-navigation",
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
	for (const prompt of scripted.userPrompts) {
		expect(prompt).toContain("vc=1@0~3");
		expect(prompt).toContain("vc=3@0~6");
		expect(prompt).toContain("visualNavigationContract=");
		expect(prompt).toContain("vc=node@parent~exit");
	}
	expect(scripted.userPrompts[0]).toContain(
		"vc never proves that node is a heading or assigns Owner",
	);
	expect(scripted.userPrompts[1]).toContain("vc is not a semantic heading or Owner label");
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
	expect(result.context.structureEvidenceProvided).toBe(false);
	expect(result.context.structureMapCoverage).toBe("unavailable");
	expect(scripted.userPrompts[0]).toContain('availableSourceRanges=["段落0-段落2"]');
	expect(scripted.userPrompts[0]).toContain("candidateBlockCount=1");
	expect(scripted.userPrompts[0]).toContain("candidateCoverageRatio=0.3333");
	expect(scripted.userPrompts[0]).toMatch(/sourceCharacterCount=\d+/u);
	expect(scripted.userPrompts[0]).toMatch(/candidateCharacterCount=\d+/u);
	expect(scripted.userPrompts[0]).toMatch(/candidateCharacterCoverageRatio=0\.\d{4}/u);
	expect(scripted.userPrompts[0]).toContain("focusedCandidateBlockCount=1");
	expect(scripted.userPrompts[0]).toContain("focusedCandidateIncluded=true");
	expect(scripted.userPrompts[0]).toContain(
		"# Focused Candidate-only review view (complete mechanical duplicate when budget permits)",
	);
	expect(scripted.userPrompts[0]).toContain(
		"candidateFocusPurpose=Complete mechanical duplicate of Candidate-selected addresses only when the whole duplicate fits",
	);
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

test("fails closed when absent instantiation leaves part of a non-empty Candidate", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "未实例化模板标题。" },
				{ blockId: 1, text: "空白货物清单。" },
			],
			["段落0-段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				source_role: "buyer_issued",
				instantiation: "absent",
				issue_type: "false_non_null",
				add_ranges: [],
				removal: { mode: "exact", remove_ranges: ["段落0"] },
				reason: "The source is uninstantiated, but the structural patch leaves one Candidate block.",
			},
			"reviewer-partial-terminal-null",
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
	expect(result.status).toBe("degraded");
	expect(result.resolution).toBe("review_incomplete");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.failure?.message).toContain("must remove the complete Candidate");
});

test("accepts the shortest terminal-null complement for absent instantiation", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "未实例化模板标题。" },
				{ blockId: 1, text: "空白货物清单。" },
			],
			["段落0-段落1"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				source_role: "buyer_issued",
				instantiation: "absent",
				issue_type: "false_non_null",
				add_ranges: [],
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The source is an uninstantiated template with no surviving Candidate island.",
			},
			"reviewer-complete-terminal-null",
		),
		tool(
			"submit_requirement_release",
			release(
				{ outsideCarrierExcludedRanges: ["段落0-段落1"] },
				"The complete challenged Candidate has no qualified instantiated source.",
			),
			"release-complete-terminal-null",
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
	expect(result.finalRanges).toEqual([]);
	expect(result.reviewer).toMatchObject({
		removeMode: "candidate_complement",
		removeRanges: ["段落0-段落1"],
		preserveRanges: [],
	});
});

test("publishes a source-proven completed supplier response as a terminal null", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "技术方案" },
				{ blockId: 1, text: "我方已完成系统设计并承诺按期交付。" },
				{ blockId: 2, text: "合同条款接受承诺" },
			],
			["段落0-段落2"],
		),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				source_role: "completed_supplier_response",
				instantiation: "present",
				issue_type: "wrong_direction",
				add_ranges: [],
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason:
					"The complete source is a submitted supplier technical proposal with no separable buyer-issued requirement region.",
			},
			"reviewer-completed-supplier-terminal-null",
		),
		tool(
			"submit_requirement_release",
			{
				hard_carrier_reason: "No four-class carrier is present in the authorized envelope.",
				hard_excluded_ranges: [],
				residual_reason:
					"Whole-source authorship is a completed supplier response, so its copied duties cannot reopen requirement membership.",
				outside_carrier_excluded_ranges: ["段落0-段落2"],
				accepted_add_ranges: [],
			},
			"release-completed-supplier-terminal-null",
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
	expect(result.release).toMatchObject({
		submittedOutsideCarrierExcludedRanges: ["段落0-段落2"],
		outsideCarrierExcludedRanges: ["段落0-段落2"],
		finalRanges: [],
	});
	expect(scripted.userPrompts[1]).toContain("wholeSourceIdentityVetoContract=");
	expect(scripted.userPrompts[1]).toContain(
		"Copied tender clauses, technical detail, future duties, response tables, or commitments cannot reopen membership",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Mandatory whole_source_identity_veto before every local gate",
	);
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
			release({}, "The challenged block is independently owned by scoring."),
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
		hardCarrierReason: "The candidate-wide four-carrier audit is complete.",
		submittedRestoredRemoveRanges: [],
		restoredRemoveRanges: [],
		submittedHardExcludedRanges: [],
		hardExcludedRanges: [],
		residualReason: "The challenged block is independently owned by scoring.",
		submittedOutsideCarrierExcludedRanges: [],
		outsideCarrierExcludedRanges: [],
		hardBoundaryResidualAuthorityRanges: [],
		submittedAcceptedAddRanges: [],
		acceptedAddRanges: [],
		finalRanges: ["段落1"],
		finalBlockIds: [1],
		reason:
			"The candidate-wide four-carrier audit is complete.\n\nThe challenged block is independently owned by scoring.",
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
			release(
				{
					hardCarrierReason: "硬".repeat(2_500),
					restoredRemoveRanges: ["段落0"],
				},
				"总".repeat(2_500),
			),
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
	expect(result.release?.hardCarrierReason).toHaveLength(1_200);
	expect(result.release?.residualReason).toHaveLength(1_200);
	expect(result.release?.reason).toHaveLength(2_402);
});

test("derives final ranges mechanically from typed Release deltas", async () => {
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
			release(
				{ acceptedAddRanges: ["段落2"] },
				"The challenged addition is independently accepted.",
			),
			"release-typed-deltas",
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
		submittedHardExcludedRanges: [],
		hardExcludedRanges: [],
		submittedAcceptedAddRanges: ["段落2"],
		acceptedAddRanges: ["段落2"],
		finalRanges: ["段落1-段落2"],
		finalBlockIds: [1, 2],
	});
	expect(scripted.toolParameterKeys[1]).toEqual([
		"hard_carrier_reason",
		"residual_reason",
		"restored_remove_ranges",
		"hard_excluded_ranges",
		"outside_carrier_excluded_ranges",
		"accepted_add_ranges",
	]);
});

test("gives restored REMOVE_REVIEW ranges precedence over overlapping exclusions", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "响应文件格式标题。" },
				{ blockId: 1, text: "采购人要求完成系统安装。" },
				{ blockId: 2, text: "采购人要求完成调试和验收。" },
				{ blockId: 3, text: "合同条款格式标题。" },
				{ blockId: 4, text: "采购人要求提供运行维护服务。" },
			],
			["段落0-段落4"],
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
				removal: { mode: "exact", remove_ranges: ["段落0-段落3"] },
				reason: "The Reviewer proposes one broad removal for independent review.",
			},
			"reviewer-restoration-precedence",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					restoredRemoveRanges: ["段落1-段落2"],
					hardExcludedRanges: ["段落0-段落3"],
				},
				"The middle technical island must be restored despite the broad exclusion projection.",
			),
			"release-restoration-precedence",
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
	expect(result.finalRanges).toEqual(["段落1-段落2", "段落4"]);
	expect(result.release).toMatchObject({
		submittedRestoredRemoveRanges: ["段落1-段落2"],
		restoredRemoveRanges: ["段落1-段落2"],
		submittedHardExcludedRanges: ["段落0-段落3"],
		hardExcludedRanges: ["段落0", "段落3"],
	});
});

test("mechanically restores any REMOVE_REVIEW block without explicit deletion authority", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "响应格式。" },
				{ blockId: 1, text: "技术要求。" },
				{ blockId: 2, text: "纯结算说明。" },
				{ blockId: 3, text: "独立验收要求。" },
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
				removal: { mode: "exact", remove_ranges: ["段落0-段落2"] },
				reason: "The complete Candidate is submitted as the removal envelope.",
			},
			"reviewer-unclassified-remove",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					restoredRemoveRanges: ["段落0"],
					outsideCarrierExcludedRanges: ["段落2"],
				},
				"The structural projection accidentally omits one challenged block.",
			),
			"release-unclassified-remove",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "9".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.resolution).toBe("release_applied_repair");
	expect(result.finalRanges).toEqual(["段落0-段落1", "段落3"]);
	expect(result.failure).toBeNull();
	expect(result.release).toMatchObject({
		submittedRestoredRemoveRanges: ["段落0"],
		restoredRemoveRanges: ["段落0-段落1"],
		outsideCarrierExcludedRanges: ["段落2"],
	});
});

test("demotes a buyer-issued full Candidate removal to hard-carrier-only review", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统安装。" },
				{ blockId: 1, text: "采购人要求完成调试和验收。" },
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
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes ordinary removal of the complete Candidate.",
			},
			"reviewer-full-removal-demotion",
		),
		tool(
			"submit_requirement_release",
			release(
				{ outsideCarrierExcludedRanges: ["段落0-段落1"] },
				"No source-proven four-carrier root is approved.",
			),
			"release-full-removal-demotion",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "a".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("preserved");
	expect(result.resolution).toBe("release_rejected_challenge");
	expect(result.finalRanges).toEqual(["段落0-段落1"]);
	expect(result.context.fullRemovalDemotedToHardBoundaryReview).toBe(true);
	expect(result.release).toMatchObject({
		submittedOutsideCarrierExcludedRanges: ["段落0-段落1"],
		outsideCarrierExcludedRanges: [],
		finalRanges: ["段落0-段落1"],
	});
	expect(scripted.userPrompts[1]).toContain("releaseAuditMode=hard_carrier_boundary_residual");
	expect(scripted.userPrompts[1]).toContain("challengeRemoveRanges=[]");
	expect(scripted.userPrompts[1]).toContain("releaseRemoveEnvelopeRanges=[]");
	expect(scripted.userPrompts[1]).toContain("Every Candidate block starts as BASE_KEEP");
	expect(prompts.release).toContain(
		"即使 `releaseRemoveEnvelopeRanges=[]` 且 source overlay 仍显示 `BASE_KEEP`",
	);
	expect(scripted.userPrompts[1]).toContain("IN|段落0：");
	expect(scripted.userPrompts[1]).toContain("IN|段落1：");
	expect(scripted.userPrompts[1]).not.toContain("REMOVE_REVIEW|段落");
});

test("keeps ADD_REVIEW available after full-removal demotion", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统安装。" },
				{ blockId: 1, text: "采购人要求完成调试。" },
				{ blockId: 2, text: "采购人还要求完成验收。" },
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
				issue_type: "source_fidelity",
				add_ranges: ["段落2"],
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes one addition and ordinary removal of the complete Candidate.",
			},
			"reviewer-full-removal-with-add",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					outsideCarrierExcludedRanges: ["段落0-段落1"],
					acceptedAddRanges: ["段落2"],
				},
				"The addition is approved; ordinary Candidate deletion remains unauthorized.",
			),
			"release-full-removal-with-add",
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
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.patch).toEqual({ addRanges: ["段落2"], removeRanges: [] });
	expect(result.context.fullRemovalDemotedToHardBoundaryReview).toBe(true);
	expect(result.release).toMatchObject({
		outsideCarrierExcludedRanges: [],
		acceptedAddRanges: ["段落2"],
	});
	expect(scripted.userPrompts[1]).toContain("ADD_REVIEW|段落2：");
});

test("retains hard-carrier deletion authority after full-removal demotion", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "第一章 招标公告。" },
				{ blockId: 1, text: "公告联系方式。" },
				{ blockId: 2, text: "第二章 独立技术要求。" },
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
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes ordinary removal of every Candidate block.",
			},
			"reviewer-full-removal-hard-carrier",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					hardExcludedRanges: ["段落0-段落1"],
				},
				"The announcement is hard-excluded; the independent technical chapter remains protected.",
			),
			"release-full-removal-hard-carrier",
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
	expect(result.finalRanges).toEqual(["段落2"]);
	expect(result.context.fullRemovalDemotedToHardBoundaryReview).toBe(true);
	expect(result.release).toMatchObject({
		hardExcludedRanges: ["段落0-段落1"],
		outsideCarrierExcludedRanges: [],
		hardBoundaryResidualAuthorityRanges: ["段落2"],
	});
});

test("allows precision deletion only on a residual exposed by a boundary-complete hard suffix", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购对象和范围。" },
				{ blockId: 1, text: "纯付款步骤。" },
				{ blockId: 2, text: "独立验收要求。" },
				{ blockId: 3, text: "第五章 采购合同。" },
				{ blockId: 4, text: "合同附件范本。" },
			],
			["段落0-段落4"],
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
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes ordinary removal of every Candidate block.",
			},
			"reviewer-boundary-residual",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					hardExcludedRanges: ["段落3-段落4"],
					outsideCarrierExcludedRanges: ["段落1"],
				},
				"The hard contract suffix exposes a bounded residual with one separable payment atom.",
			),
			"release-boundary-residual",
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
	expect(result.finalRanges).toEqual(["段落0", "段落2"]);
	expect(result.release).toMatchObject({
		hardExcludedRanges: ["段落3-段落4"],
		hardBoundaryResidualAuthorityRanges: ["段落0-段落2"],
		outsideCarrierExcludedRanges: ["段落1"],
	});
});

test("allows precision deletion on the unique residual between complete hard boundaries", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "第一章 招标公告。" },
				{ blockId: 1, text: "公告联系方式。" },
				{ blockId: 2, text: "采购需求标题。" },
				{ blockId: 3, text: "详见未随本文件提供的采购清单。" },
				{ blockId: 4, text: "第五章 采购合同。" },
				{ blockId: 5, text: "合同附件范本。" },
			],
			["段落0-段落5"],
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
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes ordinary removal of every Candidate block.",
			},
			"reviewer-middle-boundary-residual",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					hardExcludedRanges: ["段落0-段落1", "段落4-段落5"],
					outsideCarrierExcludedRanges: ["段落2-段落3"],
				},
				"The hard boundary roots expose one continuous middle residual containing only a non-fact shell.",
			),
			"release-middle-boundary-residual",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "0".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.release).toMatchObject({
		hardExcludedRanges: ["段落0-段落1", "段落4-段落5"],
		hardBoundaryResidualAuthorityRanges: ["段落2-段落3"],
		outsideCarrierExcludedRanges: ["段落2-段落3"],
	});
});

test("allows precision deletion on the sole surviving Candidate interval", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "第一章 招标公告。" },
				{ blockId: 1, text: "公告联系方式。" },
				{ blockId: 2, text: "非 Candidate 分隔段。" },
				{ blockId: 3, text: "采购需求标题。" },
				{ blockId: 4, text: "详见未随本文件提供的采购清单。" },
				{ blockId: 5, text: "另一非 Candidate 分隔段。" },
				{ blockId: 6, text: "第五章 采购合同。" },
				{ blockId: 7, text: "合同附件范本。" },
			],
			["段落0-段落1", "段落3-段落4", "段落6-段落7"],
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
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes ordinary removal of every Candidate block.",
			},
			"reviewer-independent-residual",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					hardExcludedRanges: ["段落0-段落1", "段落6-段落7"],
					outsideCarrierExcludedRanges: ["段落3-段落4"],
				},
				"Every other Candidate interval is hard-excluded, leaving one continuous residual.",
			),
			"release-independent-residual",
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
	expect(result.release).toMatchObject({
		hardExcludedRanges: ["段落0-段落1", "段落6-段落7"],
		hardBoundaryResidualAuthorityRanges: ["段落3-段落4"],
		outsideCarrierExcludedRanges: ["段落3-段落4"],
	});
});

test("does not open residual precision when two Candidate address runs remain", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "第一章 招标公告。" },
				{ blockId: 1, text: "公告联系方式。" },
				{ blockId: 2, text: "非 Candidate 分隔段。" },
				{ blockId: 3, text: "第一个残留 Candidate 岛。" },
				{ blockId: 4, text: "另一非 Candidate 分隔段。" },
				{ blockId: 5, text: "第二个残留 Candidate 岛。" },
			],
			["段落0-段落1", "段落3", "段落5"],
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
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes ordinary removal of every Candidate block.",
			},
			"reviewer-two-residual-runs",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					hardExcludedRanges: ["段落0-段落1"],
					outsideCarrierExcludedRanges: ["段落3", "段落5"],
				},
				"Two discontinuous Candidate runs remain after the hard delta.",
			),
			"release-two-residual-runs",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "2".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落3", "段落5"]);
	expect(result.release).toMatchObject({
		hardExcludedRanges: ["段落0-段落1"],
		hardBoundaryResidualAuthorityRanges: [],
		outsideCarrierExcludedRanges: [],
	});
});

test("does not open residual precision when a hard exclusion is internal to a Candidate run", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			Array.from({ length: 5 }, (_, blockId) => ({
				blockId,
				text: `Candidate 段落${blockId}。`,
			})),
			["段落0-段落4"],
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
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The Reviewer proposes ordinary removal of every Candidate block.",
			},
			"reviewer-internal-hard-fracture",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					hardExcludedRanges: ["段落2"],
					outsideCarrierExcludedRanges: ["段落0-段落1", "段落3-段落4"],
				},
				"An internal hard island cannot authorize Candidate-wide precision cleanup.",
			),
			"release-internal-hard-fracture",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "f".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual(["段落0-段落1", "段落3-段落4"]);
	expect(result.release).toMatchObject({
		hardExcludedRanges: ["段落2"],
		hardBoundaryResidualAuthorityRanges: [],
		outsideCarrierExcludedRanges: [],
	});
});

test.each([
	{
		name: "non-procurement source",
		sourceRole: "non_procurement" as const,
		instantiation: "present" as const,
	},
	{
		name: "absent instantiation",
		sourceRole: "buyer_issued" as const,
		instantiation: "absent" as const,
	},
])("keeps the full removal envelope for $name", async ({ sourceRole, instantiation }) => {
	const packet = parseRequirementReviewPacket(
		packetValue([{ blockId: 0, text: "不构成当前项目采购需求的完整来源。" }], ["段落0"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				source_role: sourceRole,
				instantiation,
				issue_type: "false_non_null",
				add_ranges: [],
				removal: { mode: "candidate_complement", preserve_ranges: [] },
				reason: "The terminal source decision removes the complete Candidate.",
			},
			`reviewer-terminal-${sourceRole}-${instantiation}`,
		),
		tool(
			"submit_requirement_release",
			release(
				{ outsideCarrierExcludedRanges: ["段落0"] },
				"The terminal source decision is independently confirmed.",
			),
			`release-terminal-${sourceRole}-${instantiation}`,
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
	expect(result.finalRanges).toEqual([]);
	expect(result.context.fullRemovalDemotedToHardBoundaryReview).toBe(false);
	expect(scripted.userPrompts[1]).toContain("releaseAuditMode=bounded_patch");
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落0：");
});

test("requires every approved four-carrier deletion to use the hard field", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "响应文件格式。" },
				{ blockId: 1, text: "响应格式内部技术表。" },
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
				removal: { mode: "exact", remove_ranges: ["段落0"] },
				reason: "The Reviewer challenges only the carrier root.",
			},
			"reviewer-hard-field-mandatory",
		),
		tool(
			"submit_requirement_release",
			release(
				{ hardExcludedRanges: ["段落0-段落1"] },
				"The source-proven response-format root also governs the protected descendant.",
			),
			"release-hard-field-mandatory",
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
	expect(result.finalRanges).toEqual([]);
	expect(scripted.userPrompts[1]).toContain(
		"Every four-carrier deletion uses hard_excluded_ranges regardless of marker",
	);
	expect(scripted.userPrompts[1]).toContain(
		"outside_carrier_excluded_ranges is never an alternative encoding for a hard carrier",
	);
});

test("clips unauthorized Release exclusions before deriving final ranges", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统实施。" },
				{ blockId: 1, text: "独立预算说明。" },
				{ blockId: 2, text: "合同主要条款。" },
				{ blockId: 3, text: "合同付款与验收子项。" },
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
				remove_ranges: ["段落2-段落3"],
				reason: "The Candidate contains a contract carrier.",
			},
			"reviewer-two-gate-release",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					restoredRemoveRanges: ["段落3"],
					hardExcludedRanges: ["段落2"],
					outsideCarrierExcludedRanges: ["段落1"],
				},
				"The hard carrier is excluded; the unchallenged outside-carrier range is unauthorized.",
			),
			"release-two-gate-release",
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
	expect(result.finalRanges).toEqual(["段落0-段落1", "段落3"]);
	expect(result.release).toMatchObject({
		submittedHardExcludedRanges: ["段落2"],
		hardExcludedRanges: ["段落2"],
		submittedOutsideCarrierExcludedRanges: ["段落1"],
		outsideCarrierExcludedRanges: [],
		finalRanges: ["段落0-段落1", "段落3"],
	});
});

test("mechanically normalizes a singleton stringified empty Release range array", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统实施。" },
				{ blockId: 1, text: "纯结算说明。" },
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
				issue_type: "operational_precision",
				add_ranges: [],
				removal: { mode: "exact", remove_ranges: ["段落1"] },
				reason: "The separable settlement block has no surviving work duty.",
			},
			"reviewer-stringified-empty-release-range",
		),
		tool(
			"submit_requirement_release",
			{
				hard_carrier_reason: "No four-class carrier is present in the authorized envelope.",
				hard_excluded_ranges: ["[]"],
				residual_reason: "The settlement atom is removable after the residual duty test.",
				outside_carrier_excluded_ranges: ["段落1"],
				accepted_add_ranges: [],
			},
			"release-stringified-empty-release-range",
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
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.release).toMatchObject({
		submittedHardExcludedRanges: [],
		hardExcludedRanges: [],
		submittedOutsideCarrierExcludedRanges: ["段落1"],
		outsideCarrierExcludedRanges: ["段落1"],
	});
});

test("normalizes a prefixed Reviewer issue type without degrading a valid challenge", async () => {
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
				issue_type: "issue_type=material_omission: source-derived challenge",
				add_ranges: ["段落2"],
				reason: "The external score block is proposed as an omission.",
			},
			"reviewer-missing-remove-ranges",
		),
		tool(
			"submit_requirement_release",
			release({}, "The block is independently owned by scoring, so Candidate remains unchanged."),
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
		issueType: "material_omission",
		addRanges: ["段落2"],
		removeRanges: [],
	});
});

test("normalizes an unknown Reviewer issue label without degrading a valid challenge", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "采购人要求完成系统安装。" },
				{ blockId: 1, text: "独立纯结算条款。" },
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
				issue_type: "mixed pricing boundary concern",
				add_ranges: [],
				removal: { mode: "exact", remove_ranges: ["段落1"] },
				reason: "The separable settlement block has no surviving direct work duty.",
			},
			"reviewer-unknown-issue-label",
		),
		tool(
			"submit_requirement_release",
			release(
				{ outsideCarrierExcludedRanges: ["段落1"] },
				"The challenged settlement block is independently excluded.",
			),
			"release-unknown-issue-label",
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
	expect(result.failure).toBeNull();
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		issueType: "unspecified",
		removeRanges: ["段落1"],
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
				{ acceptedAddRanges: ["段落2"] },
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
	expect(scripted.userPrompts[1]).toContain('candidateHardCarrierAuditOrder=["段落1"]');
	expect(scripted.userPrompts[1]).toContain("candidateBlockCount=1");
	expect(scripted.userPrompts[1]).toContain("challengeAddBlockCount=1");
	expect(scripted.userPrompts[1]).toContain("challengeRemoveBlockCount=0");
	expect(scripted.userPrompts[1]).toContain("IN|段落1：");
	expect(scripted.userPrompts[1]).toContain("OUT|段落2：");
	expect(scripted.userPrompts[1]).toContain("ATOMIC_CHANGE_TARGET|ADD_REVIEW|段落2：");
	expect(scripted.userPrompts[1]).toContain("OUT|段落3：");
	expect(scripted.userPrompts[1]).toContain(
		"# Complete immutable source with Candidate-only IN/OUT membership",
	);
	expect(scripted.userPrompts[1]).toContain(
		"candidateAuditOrderingContract=The Harness orders continuous Candidate intervals by descending block count using addresses only",
	);
	expect(scripted.userPrompts[1]).toContain(
		"releaseTerminalContract=Submit one phased semantic plan in fixed order: hard_carrier_reason -> residual_reason -> restored_remove_ranges -> hard_excluded_ranges -> outside_carrier_excluded_ranges -> accepted_add_ranges",
	);
	expect(scripted.userPrompts[1].lastIndexOf("# Final release checklist")).toBeGreaterThan(
		scripted.userPrompts[1].lastIndexOf("OUT|段落3："),
	);
	expect(scripted.userPrompts[1]).not.toContain(hiddenReviewerNarrative);
	expect(result.budget.providerCalls).toBe(2);
});

test("orders Candidate interval audits by descending block count for both roles", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			Array.from({ length: 10 }, (_, blockId) => ({
				blockId,
				text: `段落正文${blockId}。`,
			})),
			["段落0", "段落2-段落6", "段落8-段落9"],
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
				remove_ranges: ["段落0"],
				reason: "The shortest Candidate interval is challenged after the ordered audit.",
			},
			"reviewer-audit-order",
		),
		tool(
			"submit_requirement_release",
			release(
				{ outsideCarrierExcludedRanges: ["段落0"] },
				"The bounded challenged interval is independently excluded.",
			),
			"release-audit-order",
		),
	]);

	await runRequirementReview({
		packet,
		packetSha256: "2".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	const expectedOrder =
		'candidateHardCarrierAuditOrder=["段落2-段落6","段落8-段落9","段落0"]';
	expect(scripted.userPrompts[0]).toContain(expectedOrder);
	expect(scripted.userPrompts[1]).toContain(expectedOrder);
});

test("samples an oversized change side with fixed text-blind address priorities", async () => {
	const blocks = Array.from({ length: 180 }, (_, blockId) => ({
		blockId,
		text: `原子段落${blockId}。`,
	}));
	const packet = parseRequirementReviewPacket(
		packetValue(blocks, ["段落0", "段落20", "段落40-段落179"]),
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
			release(
				{ outsideCarrierExcludedRanges: ["段落20", "段落40-段落179"] },
				"The bounded exact challenge is independently approved.",
			),
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
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(scripted.userPrompts[1]).not.toContain("focusedKeepTargetBlockCount=");
	expect(scripted.userPrompts[1]).not.toContain("## CANDIDATE_KEEP_SIDE");
	expect(scripted.userPrompts[1]).toContain("focusedChangeTargetBlockCount=141");
	expect(scripted.userPrompts[1]).toContain("focusedChangeIncludedTargetBlockCount=125");
	expect(scripted.userPrompts[1]).toContain("focusedChangeCoverage=partial");
	expect(scripted.userPrompts[1]).toContain("focusedReviewRenderedBlockCount=128");
	expect(scripted.userPrompts[1]).toContain("focusedReviewIncluded=true");
	expect(scripted.userPrompts[1]).toContain(
		"ATOMIC_CHANGE_TARGET|REMOVE_REVIEW|段落20：",
	);
	expect(scripted.userPrompts[1]).not.toContain("ATOMIC_KEEP_TARGET|");
});

test("renders only the challenged side within one fixed text-blind budget", async () => {
	const blocks = Array.from({ length: 400 }, (_, blockId) => ({
		blockId,
		text: `原子段落${blockId}。`,
	}));
	const packet = parseRequirementReviewPacket(packetValue(blocks, ["段落0-段落399"]));
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段落100-段落102", "段落200-段落210", "段落350-段落399"],
				preserve_ranges: [],
				reason: "The exact challenge creates several mechanical keep/remove transitions.",
			},
			"reviewer-targeted-focus",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					outsideCarrierExcludedRanges: [
						"段落100-段落102",
						"段落200-段落210",
						"段落350-段落399",
					],
				},
				"Approve the bounded removal.",
			),
			"release-targeted-focus",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "4".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(scripted.userPrompts[1]).not.toContain("focusedKeepTargetBlockCount=");
	expect(scripted.userPrompts[1]).toContain("focusedChangeTargetBlockCount=64");
	expect(scripted.userPrompts[1]).toContain("focusedChangeIncludedTargetBlockCount=64");
	expect(scripted.userPrompts[1]).toContain("focusedChangeCoverage=complete");
	expect(scripted.userPrompts[1]).toContain("focusedReviewRenderedBlockCount=69");
	expect(scripted.userPrompts[1]).toContain("focusedReviewIncluded=true");
	expect(scripted.userPrompts[1]).toContain(
		"The harness repeats only REMOVE_REVIEW and ADD_REVIEW addresses",
	);
	expect(scripted.userPrompts[1]).not.toContain("## CANDIDATE_KEEP_SIDE");
	expect(scripted.userPrompts[1]).toContain("## PROPOSED_CHANGE_SIDE");
	expect(scripted.userPrompts[1]).toContain(
		"ATOMIC_CONTEXT|BASE_KEEP|段落99：",
	);
	expect(scripted.userPrompts[1]).toContain(
		"ATOMIC_CHANGE_TARGET|REMOVE_REVIEW|段落100：",
	);
	expect(
		scripted.userPrompts[1].indexOf("ATOMIC_CHANGE_TARGET|REMOVE_REVIEW|段落399："),
	).toBeLessThan(
		scripted.userPrompts[1].indexOf("ATOMIC_CHANGE_TARGET|REMOVE_REVIEW|段落350："),
	);
});

test("keeps the start boundary window of a large proposed-removal run visible", async () => {
	const blocks = Array.from({ length: 1_068 }, (_, blockId) => ({
		blockId,
		text: `原子段落${blockId}。`,
	}));
	const packet = parseRequirementReviewPacket(
		packetValue(blocks, ["段落1", "段落4-段落7", "段落9-段落102", "段落146-段落1067"]),
	);
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				removal: {
					mode: "exact",
					remove_ranges: [
						"段落1",
						"段落5-段落7",
						"段落9-段落102",
						"段落184-段落1067",
					],
				},
				reason: "The exact proposal creates one very large change-side run after a qualified island.",
			},
			"reviewer-large-change-boundary",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					outsideCarrierExcludedRanges: [
						"段落1",
						"段落5-段落7",
						"段落9-段落102",
						"段落184-段落1067",
					],
				},
				"The independently reviewed change-side ranges are excluded.",
			),
			"release-large-change-boundary",
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
	expect(scripted.userPrompts[1]).not.toContain("focusedKeepCoverage=");
	expect(scripted.userPrompts[1]).toContain("focusedChangeCoverage=partial");
	for (const blockId of [184, 198, 199, 200]) {
		expect(scripted.userPrompts[1]).toContain(
			`ATOMIC_CHANGE_TARGET|REMOVE_REVIEW|段落${blockId}：`,
		);
	}
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
				{ hardExcludedRanges: ["段落2-段落3"] },
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
				{
					restoredRemoveRanges: ["段落3"],
					acceptedAddRanges: ["段落2"],
				},
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
			["段落0-段落1"],
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
				remove_ranges: ["段落1-段落2"],
				reason: "The exact ranges overlap the candidate boundary by one block.",
			},
			"reviewer-overlap",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					outsideCarrierExcludedRanges: ["段落1"],
					acceptedAddRanges: ["段落2"],
				},
				"The mechanically normalized add/remove envelope is source-supported.",
			),
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
	expect(result.finalRanges).toEqual(["段落0", "段落2"]);
});

test("mechanically clips Release deltas to the authorized direction envelope", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "Candidate 内的项目概况。" },
				{ blockId: 1, text: "Candidate 内的响应文件格式。" },
				{ blockId: 2, text: "Candidate 外的技术要求。" },
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
				reason: "The Candidate contains one independently excluded response-format block.",
			},
			"reviewer-release-envelope-clipping",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					outsideCarrierExcludedRanges: ["段落1"],
					acceptedAddRanges: ["段落0", "段落2"],
				},
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
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落1"] });
	expect(result.release).toMatchObject({
		verdict: "publish",
		submittedAcceptedAddRanges: ["段落0", "段落2"],
		acceptedAddRanges: [],
		finalRanges: ["段落0"],
	});
});

test("mechanically expands a broad Candidate complement around preserved technical islands", async () => {
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
				removal: {
					mode: "candidate_complement",
					preserve_ranges: ["段落1-段落2", "段落5"],
				},
				reason: "Protect the complete technical islands and remove the remaining excluded carriers.",
			},
			"reviewer-candidate-complement",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					outsideCarrierExcludedRanges: [
						"段落0",
						"段落3-段落4",
						"段落6-段落7",
					],
				},
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
	expect(scripted.toolParameterKeys[0]).toEqual([
		"reason",
		"verdict",
		"source_role",
		"instantiation",
		"issue_type",
		"add_ranges",
		"removal",
	]);
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
		'releaseRemoveEnvelopeRanges=["段落0","段落3-段落4","段落6-段落7"]',
	);
	expect(scripted.userPrompts[1]).toContain("reviewerPreserveRangesAndRationale=withheld");
	expect(scripted.userPrompts[1]).toContain(
		"reviewerMechanicalPatchVisibility=exact REMOVE_REVIEW envelope for ordinary changes; all other Candidate blocks are protected BASE_KEEP except the explicit four-carrier veto",
	);
	expect(scripted.userPrompts[1]).not.toContain("challengePreserveRanges=");
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落0：");
	expect(scripted.userPrompts[1]).toContain("BASE_KEEP|段落1：");
	expect(scripted.userPrompts[1]).not.toContain("PROPOSED_REMOVE|");
	expect(scripted.userPrompts[1]).not.toContain("AUDIT_KEEP|");
	expect(scripted.userPrompts[1]).not.toContain("CANDIDATE_REVIEW|");
	expect(scripted.userPrompts[1]).not.toContain("REMOVE_REVIEW|段落1：");
	expect(scripted.userPrompts[1]).toContain(
		"do not scan BASE_KEEP for any outside-carrier cleanup",
	);
	expect(scripted.userPrompts[1]).toContain(
		"challengeEnvelopeMetrics=Permission-and-budget metadata only",
	);
	expect(scripted.userPrompts[1]).toContain("wholeSourceIdentityVetoContract=");
	expect(scripted.userPrompts[1]).toContain(
		"Whole-source terminal identities outrank local technical content",
	);
	expect(scripted.userPrompts[1]).toContain("focusedChangeTargetBlockCount=5");
	expect(scripted.userPrompts[1]).toContain("focusedChangeIncludedTargetBlockCount=5");
	expect(scripted.userPrompts[1]).toContain("focusedChangeCoverage=complete");
	expect(scripted.userPrompts[1]).toContain("focusedReviewRenderedBlockCount=8");
	expect(scripted.userPrompts[1]).toContain("focusedReviewIncluded=true");
	expect(scripted.userPrompts[1]).toContain(
		"# Text-blind challenged-side atomic navigation view (bounded mechanical duplicate)",
	);
	expect(scripted.userPrompts[1]).toContain(
		"focusViewPurpose=Text-blind challenged-side atomic navigation only",
	);
	expect(scripted.userPrompts[1].match(/^IN\|段落1：/gmu)).toHaveLength(1);
	expect(scripted.userPrompts[1].match(/^IN\|段落0：/gmu)).toHaveLength(1);
	expect(scripted.userPrompts[1]).not.toContain("ATOMIC_KEEP_TARGET|");
	expect(scripted.userPrompts[1]).toContain(
		"ATOMIC_CHANGE_TARGET|REMOVE_REVIEW|段落0：",
	);
	expect(scripted.userPrompts[1]).toContain(
		"an independent technical chapter outside the four carriers has fact payload",
	);
	expect(scripted.userPrompts[1]).toContain(
		"a heading such as business, fulfillment, delivery, or after-sales requirements is not a pure-commerce verdict",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Every BASE_KEEP block is mechanically retained unless hard_excluded_ranges authorizes its four-carrier subtraction",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A corrected root with a partial hard delta is an invalid holey projection",
	);
	expect(scripted.userPrompts[1]).toContain(
		"To omit a descendant, first correct the root or exit in residual_reason",
	);
	expect(scripted.userPrompts[0]).toContain(
		"This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region",
	);
	expect(scripted.userPrompts[1]).toContain(
		"This notice-sequence pattern applies only inside one uninterrupted, functionally homogeneous notification region",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A physical-file title, invitation act, attachment relationship, or notice elements scattered across separate chapters is insufficient evidence for null",
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
		"do not place the heading or body in either exclusion field",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Closure never extends backward across the carrier start",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Use removal.mode=candidate_complement when preserve_ranges is strictly shorter",
	);
	expect(scripted.userPrompts[0]).toContain(
		"candidate_complement with preserve_ranges=[] is the shortest valid expression",
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
		"enumerate every safe removal island and split around every kept block",
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
		"Only a boundary-independent technical appendix under its own qualified Owner can enter accepted_add_ranges or remain selected",
	);
	expect(scripted.userPrompts[0]).toContain("peerRootFractureContract=");
	expect(scripted.userPrompts[1]).toContain("peerRootFractureContract=");
	expect(scripted.userPrompts[0]).toContain(
		"A contract root ends before a later peer technical, specification, material, brand, drawing, list",
	);
	expect(scripted.userPrompts[1]).toContain(
		"adjacency, chapter order, an earlier cross-reference, or placement between contract and response-format chapters is insufficient",
	);
	expect(scripted.userPrompts[0]).toContain("hardCarrierFunctionContract=");
	expect(scripted.userPrompts[1]).toContain("hardCarrierFunctionContract=");
	expect(scripted.userPrompts[0]).toContain("announcementPreambleBoundaryContract=");
	expect(scripted.userPrompts[1]).toContain("announcementPreambleBoundaryContract=");
	expect(scripted.userPrompts[0]).toContain("substantiveResponseWrapperContract=");
	expect(scripted.userPrompts[1]).toContain("substantiveResponseWrapperContract=");
	expect(scripted.userPrompts[0]).toContain(
		"If the actual offered service, work, product, quality, safety, acceptance, warranty, or result remains the grammatical subject",
	);
	expect(scripted.userPrompts[1]).toContain(
		"orphaned general-compliance, response, no-deviation, or acceptance phrase",
	);
	expect(scripted.userPrompts[0]).toContain("outsideCarrierPrecisionClosureContract=");
	expect(scripted.userPrompts[1]).toContain("outsideCarrierPrecisionClosureContract=");
	expect(scripted.userPrompts[0]).toContain("outsideCarrierCounterexampleContract=");
	expect(scripted.userPrompts[1]).toContain("outsideCarrierCounterexampleContract=");
	expect(scripted.userPrompts[0]).toContain("pricingBasisRoleContract=");
	expect(scripted.userPrompts[1]).toContain("pricingBasisRoleContract=");
	expect(scripted.userPrompts[0]).toContain("Mandatory peer_root_fracture_attack");
	expect(scripted.userPrompts[1]).toContain("Mandatory peer_root_fracture_attack");
	expect(scripted.userPrompts[1]).toContain("Mandatory preamble_peer_reset_test");
	expect(scripted.userPrompts[0]).toContain("Mandatory outside_carrier_precision_closure");
	expect(scripted.userPrompts[0]).toContain(
		"reopen primary direct effect at each source-proven peer heading",
	);
	expect(scripted.userPrompts[1]).toContain("Mandatory outside-carrier function fracture");
	expect(scripted.userPrompts[1]).toContain("counterexample_first_duty_attack");
	expect(scripted.userPrompts[1]).toContain("Mandatory price_wrapper_empty_remainder_test");
	expect(scripted.userPrompts[1]).toContain("Mandatory subject_predicate_remainder_test");
	expect(scripted.userPrompts[1]).toContain(
		"Repetition of the same facts in an earlier announcement is not local Owner evidence",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Delete the child only when this stripped remainder is empty of work facts",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Do not run a global false-protection sweep over BASE_KEEP",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A new peer heading starts a new Owner decision",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Project the corrected residual plan into outside_carrier_excluded_ranges",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A non-empty residual cannot be called already covered",
	);
	expect(scripted.userPrompts[1]).toContain(
		"scanning each continuous Candidate interval from first through last in candidateHardCarrierAuditOrder",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Closure never extends backward across the carrier start",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Test the whole-document communicative-role hypothesis before local Owner partitioning",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Before local partitioning, test the whole-document communicative-role hypothesis",
	);
	expect(scripted.userPrompts[0]).toContain(
		"whole_container_disconfirmation",
	);
	expect(scripted.userPrompts[1]).toContain(
		"all chapters participating in one procurement does not make them one notice",
	);
	expect(scripted.userPrompts[0]).toContain(
		"carrier_root_exit_attack=<actual four-class root address -> first different-Owner peer root address or EOF>",
	);
	expect(scripted.userPrompts[1]).toContain(
		"carrier_root_exit_attack=<actual four-class root address -> first different-Owner peer root address or EOF>",
	);
	expect(scripted.userPrompts[0]).toContain(
		"chain through consecutive same-Owner peer scopes",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Carry an actual Owner through all child clauses until the next peer exit",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A later carrier never expands backward",
	);
	expect(scripted.userPrompts[1]).toContain(
		"do not search BASE_KEEP for ordinary outside-carrier cleanup",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A structural exit never automatically ends Owner",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Mandatory mixed_container_root_sweep before the atom gate",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Mandatory mixed_container_root_sweep before atom review",
	);
	expect(scripted.userPrompts[0]).toContain(
		"that holey selection is invalid",
	);
	expect(scripted.userPrompts[1]).toContain(
		"is a forbidden holey selection",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Mandatory duty_survival_attack for every proposed outside-carrier removal",
	);
	expect(scripted.userPrompts[1]).toContain(
		"duty_survival_attack=<challenged removals whose direct duty survives after stripping incidental language or none>",
	);
	expect(scripted.userPrompts[0]).toContain(
		"A complete bid/response mandatory-requirements section or mandatory response table remains pre-award proof/commitment Owner",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Stage Owner outranks future-tense wording",
	);
	expect(scripted.userPrompts[0]).toContain(
		"First close personnel Stage Owner at subsection level",
	);
	expect(scripted.userPrompts[1]).toContain(
		"First close personnel Stage Owner at subsection level",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Do not carve out one child merely because it also describes future staffing",
	);
	expect(scripted.userPrompts[0]).toContain("preAwardStageGateContract=");
	expect(scripted.userPrompts[1]).toContain("preAwardStageGateContract=");
	expect(scripted.userPrompts[1]).toContain(
		"Mandatory pre_award_stage_gate ordering",
	);
	expect(scripted.userPrompts[0]).toContain("nonFactShellClosureContract=");
	expect(scripted.userPrompts[1]).toContain("nonFactShellClosureContract=");
	expect(scripted.userPrompts[1]).toContain(
		"Mandatory non_fact_shell_closure",
	);
	expect(scripted.userPrompts[0]).toContain("headingMembershipIndependenceContract=");
	expect(scripted.userPrompts[1]).toContain("headingMembershipIndependenceContract=");
	expect(scripted.userPrompts[1]).toContain(
		"Mandatory heading membership independence outside the four carrier gate",
	);
	expect(scripted.userPrompts[0]).toContain("performanceTransitionAttackContract=");
	expect(scripted.userPrompts[1]).toContain("performanceTransitionAttackContract=");
	expect(scripted.userPrompts[0]).toContain(
		"receipt, takeover, migration, handover, or return of assets, equipment, materials, data, accounts, sites, or work in progress",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Delete only when the remainder solely allocates money, valuation, title, or payment and imposes no actual transition action",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Contract-format containment requires an actual source-proven contract agreement",
	);
	expect(scripted.userPrompts[0]).toContain(
		"A bounded bidder/supplier commitment, response-commitment, no-deviation commitment, or declaration section is a response-format root",
	);
	expect(scripted.userPrompts[1]).toContain(
		"A bounded bidder/supplier commitment, response-commitment, no-deviation commitment, or declaration section is a response-format root",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Confidentiality language survives as a direct data-control duty",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Cost language cannot erase a resource-provision duty",
	);
	expect(scripted.userPrompts[1]).toContain(
		"a direct work duty remains qualified when cost inclusion is merely incidental",
	);
	expect(scripted.userPrompts[0]).toContain(
		"合同签订后或履约期间的变更控制命令也必须存活",
	);
	expect(scripted.userPrompts[0]).toContain(
		"成交前未提出异议/偏离即视为完全响应",
	);
	expect(scripted.userPrompts[0]).toContain(
		"A command to execute according to a designated platform survives",
	);
	expect(scripted.userPrompts[1]).toContain(
		"direct requirement on the successful supplier's post-award staffing, resources, submission, review, approval, filing, records, or data handling is performance content",
	);
	expect(scripted.userPrompts[0]).toContain(
		"its embedded attachment, technical list, and detailed child rules inherit that carrier",
	);
	expect(scripted.userPrompts[1]).toContain(
		"direct implementation, resources, plans/reports, records, data control, delivery",
	);
	expect(scripted.userPrompts[0]).toContain(
		"polarity-normalize that antecedent after stripping the consequence",
	);
	expect(scripted.userPrompts[1]).toContain(
		"remedyTriggerSeparation=Quality error, misconduct, or false deliverables",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Mandatory consequence_cluster_attack whenever Candidate IN covers a penalty",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Do not run a global false-protection sweep over BASE_KEEP",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Finish with a global pure-legal-wrapper sweep across all Candidate IN",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Terminal Owner consistency check",
	);
	expect(scripted.userPrompts[0]).toContain(
		"that range must follow the root through its semantic exit",
	);
	expect(scripted.userPrompts[0]).toContain(
		"Terminal instantiation evidence check",
	);
	expect(scripted.userPrompts[0]).toContain(
		"A procuring organization name, generic batch label, platform rule, bid timetable, template/version number, default clause, blank table, or external pointer cannot establish instantiation alone",
	);
	expect(scripted.userPrompts[1]).toContain(
		"generic supply/quotation rules, drafting instructions, default duties, blank schedules/tables",
	);
	expect(scripted.userPrompts[1]).toContain(
		"cannot reopen membership through primary-effect, normative-incorporation, or duty_survival_attack",
	);
	expect(scripted.userPrompts[1]).toContain(
		"Pure budget, pre-award proof/procedure, price/payment/settlement/guarantee, pure legal remedy, and bare pointers may be excluded",
	);
});

test("restores challenged over-deletion and preserves Candidate outside the complement envelope", async () => {
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
				reason: "Only the Candidate complement is submitted for independent release review.",
			},
			"reviewer-complement-corrections",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					restoredRemoveRanges: ["段落1"],
					outsideCarrierExcludedRanges: ["段落0"],
				},
				"Restore the challenged technical block; the unchallenged Candidate remains mandatory.",
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
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落0"] });
	expect(result.release).toMatchObject({
		verdict: "publish",
		submittedOutsideCarrierExcludedRanges: ["段落0"],
		finalRanges: ["段落1-段落2"],
	});
});

test("does not let complement Release delete Candidate outside the submitted removal envelope", async () => {
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
			release(
				{ outsideCarrierExcludedRanges: ["段落0", "段落3"] },
				"Only the challenged announcement-owned blocks are subtracted.",
			),
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
	expect(result.finalRanges).toEqual(["段落1-段落2"]);
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		removeMode: "candidate_complement",
		removeRanges: ["段落0", "段落3"],
		preserveRanges: ["段落1-段落2"],
	});
	expect(result.release).toMatchObject({
		verdict: "publish",
		submittedOutsideCarrierExcludedRanges: ["段落0", "段落3"],
		finalRanges: ["段落1-段落2"],
	});
	expect(scripted.userPrompts[1]).toContain(
		'challengeRemoveRanges=["段落0","段落3"]',
	);
	expect(scripted.userPrompts[1]).toContain(
		'releaseRemoveEnvelopeRanges=["段落0","段落3"]',
	);
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落0：");
	expect(scripted.userPrompts[1]).toContain("BASE_KEEP|段落1：");
	expect(scripted.userPrompts[1]).not.toContain("PROPOSED_REMOVE|");
	expect(scripted.userPrompts[1]).not.toContain("AUDIT_KEEP|");
	expect(scripted.userPrompts[1]).not.toContain("CANDIDATE_REVIEW|");
});

test("lets Release close a Reviewer-missed hard carrier without opening ordinary BASE_KEEP cleanup", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			[
				{ blockId: 0, text: "第一章 招标公告。" },
				{ blockId: 1, text: "公告内部项目概况。" },
				{ blockId: 2, text: "第二章 投标人须知。" },
				{ blockId: 3, text: "须知内部工期摘要。" },
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
				removal: { mode: "candidate_complement", preserve_ranges: ["段落1", "段落3"] },
				reason: "The Reviewer misses two child blocks while challenging their carrier roots.",
			},
			"reviewer-missed-hard-carrier-children",
		),
		tool(
			"submit_requirement_release",
			{
				hard_carrier_reason:
					"Both preserved children remain inside source-proven announcement or bidder-instruction roots.",
				hard_excluded_ranges: ["段落0-段落3"],
				residual_reason: "No authorized outside-carrier residual remains after Phase 1.",
				outside_carrier_excluded_ranges: [],
				accepted_add_ranges: [],
			},
			"release-hard-carrier-veto",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "4".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(result.status).toBe("repaired");
	expect(result.finalRanges).toEqual([]);
	expect(result.patch).toEqual({ addRanges: [], removeRanges: ["段落0-段落3"] });
	expect(result.release).toMatchObject({
		submittedHardExcludedRanges: ["段落0-段落3"],
		hardExcludedRanges: ["段落0-段落3"],
		finalRanges: [],
	});
	expect(scripted.userPrompts[1]).toContain("hardCarrierVetoContract=");
	expect(scripted.userPrompts[1]).toContain(
		"The Harness deletes only explicitly authorized hard/outside exclusions, mechanically restores every other REMOVE_REVIEW block",
	);
});

test("renders address-only permission transitions for hard-carrier root closure", async () => {
	const packet = parseRequirementReviewPacket(
		packetValue(
			Array.from({ length: 7 }, (_, blockId) => ({
				blockId,
				text: `机械源段落${blockId}。`,
			})),
			["段落0-段落6"],
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
				removal: { mode: "candidate_complement", preserve_ranges: ["段落2-段落4"] },
				reason: "The Reviewer leaves one protected run between two challenged runs.",
			},
			"reviewer-permission-transitions",
		),
		tool(
			"submit_requirement_release",
			{
				hard_carrier_reason:
					"One source-proven hard carrier crosses both permission transitions.",
				hard_excluded_ranges: ["段落0-段落6"],
				residual_reason: "No authorized outside-carrier residual remains after Phase 1.",
				outside_carrier_excluded_ranges: [],
				accepted_add_ranges: [],
			},
			"release-permission-transitions",
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
	expect(result.finalRanges).toEqual([]);
	expect(scripted.userPrompts[1]).toContain("permissionTransitionCount=2");
	expect(scripted.userPrompts[1]).toContain("permissionTransitionRenderedCount=2");
	expect(scripted.userPrompts[1]).toContain("permissionTransitionCoverage=complete");
	expect(scripted.userPrompts[1]).toContain(
		'PERMISSION_TRANSITION|REMOVE_REVIEW|["段落0-段落1"]|BASE_KEEP|["段落2-段落4"]',
	);
	expect(scripted.userPrompts[1]).toContain(
		'PERMISSION_TRANSITION|BASE_KEEP|["段落2-段落4"]|REMOVE_REVIEW|["段落5-段落6"]',
	);
	expect(scripted.userPrompts[1]).toContain(
		"A permission-marker switch is never a source-proven Owner exit",
	);
});

test("does not let exact Release delete an unchallenged Candidate block", async () => {
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
			release(
				{ outsideCarrierExcludedRanges: ["段落1"] },
				"Approve the challenged response-format deletion only.",
			),
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
	expect(result.finalRanges).toEqual(["段落0"]);
	expect(scripted.userPrompts[1]).toContain("BASE_KEEP|段落0：");
	expect(scripted.userPrompts[1]).toContain("REMOVE_REVIEW|段落1：");
	expect(scripted.userPrompts[1]).toContain("releaseAuditMode=bounded_patch");
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
			release(
				{ outsideCarrierExcludedRanges: ["段落0", "段落3"] },
				"The exact Candidate complement is independently safe.",
			),
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
			release(
				{ hardExcludedRanges: ["段落2"] },
				"The exact excluded block is independently safe to remove.",
			),
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

test("fails closed instead of resolving a conflicting legacy exact removal", async () => {
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
				remove_ranges: ["段落1-段落2"],
				preserve_ranges: ["段落1"],
				reason: "The structural submission explicitly protects one address inside the removal range.",
			},
			"reviewer-conflicting-exact-mode",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "d".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("degraded");
	expect(result.resolution).toBe("review_incomplete");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.reviewer).toBeNull();
});

test("fails closed when Reviewer removal expresses both exact delete and preserve directions", async () => {
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
				removal: {
					mode: "exact",
					remove_ranges: ["段落1-段落2"],
					preserve_ranges: ["段落1"],
				},
				reason: "Paragraph 1 is qualified, while the structural removal still crosses it.",
			},
			"reviewer-conflicting-removal-directions",
		),
	]);
	const result = await runRequirementReview({
		packet,
		packetSha256: "2".repeat(64),
		prompts,
		reviewerRuntime: roleRuntime(scripted.streamFunction),
		releaseRuntime: roleRuntime(scripted.streamFunction),
	});

	expect(scripted.callCount()).toBe(1);
	expect(result.status).toBe("degraded");
	expect(result.resolution).toBe("review_incomplete");
	expect(result.finalRanges).toEqual(["段落0-段落2"]);
	expect(result.failure?.code).toBe("contract_error");
	expect(result.reviewer).toBeNull();
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
			release(
				{ outsideCarrierExcludedRanges: ["段落30-段落35"] },
				"The compact exact complement is independently safe.",
			),
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

test("normalizes mechanically grouped paragraph addresses before schema validation", async () => {
	const blocks = Array.from({ length: 13 }, (_, blockId) => ({
		blockId,
		text: `原子段落${blockId}。`,
	}));
	const packet = parseRequirementReviewPacket(packetValue(blocks, ["段落0-段落12"]));
	const scripted = scriptedStream([
		tool(
			"submit_requirement_residual_review",
			{
				verdict: "challenge",
				...buyerIssuedReviewFields,
				issue_type: "boundary",
				add_ranges: [],
				remove_mode: "exact",
				remove_ranges: ["段落0、3-4；段6-段7", "9, 11至12"],
				preserve_ranges: [],
				reason: "The exact mechanical address list is grouped into two strings.",
			},
			"reviewer-grouped-addresses",
		),
		tool(
			"submit_requirement_release",
			release(
				{
					outsideCarrierExcludedRanges: [
						"段落0",
						"段落3-段落4",
						"段落6-段落7",
						"段落9",
						"段落11-段落12",
					],
				},
				"Approve the exact removal.",
			),
			"release-grouped-addresses",
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
	expect(result.failure).toBeNull();
	expect(result.reviewer).toMatchObject({
		verdict: "challenge",
		removeMode: "exact",
		removeRanges: ["段落0", "段落3-段落4", "段落6-段落7", "段落9", "段落11-段落12"],
	});
	expect(result.finalRanges).toEqual(["段落1-段落2", "段落5", "段落8", "段落10"]);
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
				{ outsideCarrierExcludedRanges: ["段落0", "段落6"] },
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
