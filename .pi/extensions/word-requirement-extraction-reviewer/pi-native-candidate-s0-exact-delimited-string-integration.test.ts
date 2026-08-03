import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Context } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	registerFauxProvider,
	streamSimple,
} from "@earendil-works/pi-ai/compat";
import { expect, test } from "vitest";
import { loadRequirementReviewPrompts, parseRequirementReviewPacket } from "./index.ts";
import { runPiNativeCandidateS0Review } from "./pi-native-candidate-s0.ts";

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

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function userText(context: Context): string {
	const message = context.messages.find((candidate) => candidate.role === "user");
	if (message?.role !== "user") throw new Error("context omitted its user message");
	return typeof message.content === "string"
		? message.content
		: message.content
				.map((content) => (content.type === "text" ? content.text : ""))
				.join("");
}

function labeledJson(input: string, label: string): unknown {
	const prefix = `${label}=`;
	const line = input.split("\n").find((candidate) => candidate.startsWith(prefix));
	if (line === undefined) throw new Error(`input omitted ${label}`);
	return JSON.parse(line.slice(prefix.length));
}

test("forwards the same mechanical occurrence index to Challenger and Finalizer", async () => {
	const contexts: Context[] = [];
	const registration = registerFauxProvider({
		provider: "candidate-s0-exact-delimited-string-faux",
		models: [
			{
				id: "candidate-s0-exact-delimited-string-faux-model",
				reasoning: true,
				contextWindow: 1_000_000,
				maxTokens: 16_000,
			},
		],
	});
	registration.setResponses([
		(context) => {
			contexts.push(context);
			return fauxAssistantMessage(
				fauxText(
					JSON.stringify({
						remove_partitions: [],
						remove_audit_partitions: [],
						add_partitions: [],
					}),
				),
				{ stopReason: "stop" },
			);
		},
		(context) => {
			contexts.push(context);
			return fauxAssistantMessage(
				fauxToolCall(
					"submit_final_selection",
					{
						hard_carrier_root_vetoes: [],
						ordinary_remove_ranges: [],
						ordinary_add_ranges: [],
					},
					{ id: "candidate-s0-occurrence-finalizer" },
				),
				{ stopReason: "toolUse" },
			);
		},
	]);

	try {
		const blocks = [
			{ blockId: 0, text: "供应商应遵守《现场管理制度》。" },
			{ blockId: 1, text: "5.1 现场管理制度" },
			{ blockId: 2, text: "其他内容。" },
		];
		const packet = parseRequirementReviewPacket({
			schemaVersion: "xique.word-requirement-review.packet.v1",
			reviewMode: "candidate_protected_residual",
			version: "docx-paragraphs-v1",
			outputField: "完整采购需求编号范围",
			sourceName: "exact-delimited-string.docx",
			sourceSha256: sha256(
				blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
			),
			blockCount: 3,
			candidateId: "requirement-candidate-exact-delimited-string",
			candidatePromptSha256: "b".repeat(64),
			initialRanges: ["段落0"],
			blocks,
		});
		const model = registration.getModel();
		const result = await runPiNativeCandidateS0Review({
			packet,
			packetSha256: "c".repeat(64),
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
				transportProfile: "faux-json-object",
				apiKey: "faux-key",
			},
			finalizerRuntime: {
				model,
				streamFunction: streamSimple,
				apiKey: "faux-key",
			},
		});

		expect(result.status).toBe("preserved");
		expect(contexts).toHaveLength(2);
		expect(contexts[0]?.tools).toEqual([]);
		expect(result.models.challenger).toMatchObject({
			thinkingMode: "disabled",
			responseFormat: "json_object",
			transportProfile: "faux-json-object",
		});
		const challengerInput = userText(contexts[0] as Context);
		const finalizerInput = userText(contexts[1] as Context);
		const label = "MECHANICAL_EXACT_DELIMITED_STRING_OCCURRENCE_INDEX_JSON";
		const challengerIndex = labeledJson(challengerInput, label);
		const finalizerIndex = labeledJson(finalizerInput, label);
		expect(finalizerIndex).toEqual(challengerIndex);
		expect(challengerIndex).toMatchObject({
			semantic_authority: false,
			eligibility_rule:
				"seed scan prioritizes Candidate-S0 blocks before outside blocks; an emitted seed appears in at least one Candidate-S0 block and two to eight distinct source blocks total",
			bounded_and_non_exhaustive: true,
			absence_is_not_evidence: true,
			max_scanned_seeds: 256,
			scanned_seed_count: 1,
			seed_scan_truncated: false,
			eligible_entry_count: 1,
			entry_scan_truncated: false,
			max_entries: 24,
			max_total_occurrence_blocks: 8,
			fanout_omitted_entry_count: 0,
			candidate_side_truncated_entry_count: 0,
			outside_side_truncated_entry_count: 0,
			entries: [
				{
					matchedSourceText: "现场管理制度",
					candidateS0BlockIds: [0],
					candidateS0BlockIdsTruncated: false,
					outsideCandidateS0BlockIds: [1],
					outsideCandidateS0BlockIdsTruncated: false,
				},
			],
		});
		expect(challengerInput.indexOf("COMPLETE_IMMUTABLE_SOURCE_JSON=")).toBeLessThan(
			challengerInput.indexOf("CANDIDATE_S0_RANGES="),
		);
		expect(challengerInput.indexOf("MECHANICAL_S0_RUN_QUEUE_JSON=")).toBeLessThan(
			challengerInput.indexOf(`${label}=`),
		);
		expect(result.context.exactDelimitedStringOccurrenceEntryCount).toBe(1);
		expect(result.context.exactDelimitedStringScannedSeedCount).toBe(1);
		expect(result.context.exactDelimitedStringSeedScanTruncated).toBe(false);
		expect(result.context.exactDelimitedStringEligibleEntryCount).toBe(1);
		expect(result.context.exactDelimitedStringEntryScanTruncated).toBe(false);
		expect(
			result.context.exactDelimitedStringCandidateSideTruncatedEntryCount,
		).toBe(0);
		expect(
			result.context.exactDelimitedStringOutsideSideTruncatedEntryCount,
		).toBe(0);
		expect(result.context.exactDelimitedStringFanoutOmittedEntryCount).toBe(0);
		expect(
			result.context.exactDelimitedStringOccurrenceSerializedCharacterCount,
		).toBeGreaterThan(0);
	} finally {
		registration.unregister();
	}
});

test("includes the occurrence index in both deterministic capacity estimates", async () => {
	const registration = registerFauxProvider({
		provider: "candidate-s0-occurrence-capacity-faux",
		models: [
			{
				id: "candidate-s0-occurrence-capacity-faux-model",
				reasoning: true,
				contextWindow: 1_000_000,
				maxTokens: 16_000,
			},
		],
	});
	const challengerResponse = () =>
		fauxAssistantMessage(
			fauxText(
				JSON.stringify({
					remove_partitions: [],
					remove_audit_partitions: [],
					add_partitions: [],
				}),
			),
			{ stopReason: "stop" },
		);
	const finalizerResponse = () =>
		fauxAssistantMessage(
			fauxToolCall(
				"submit_final_selection",
				{
					hard_carrier_root_vetoes: [],
					ordinary_remove_ranges: [],
					ordinary_add_ranges: [],
				},
				{ id: "candidate-s0-occurrence-capacity-finalizer" },
			),
			{ stopReason: "toolUse" },
		);
	registration.setResponses([
		challengerResponse(),
		finalizerResponse(),
		challengerResponse(),
		finalizerResponse(),
	]);

	try {
		const model = registration.getModel();
		const run = async (
			candidateId: string,
			blocks: Array<{ blockId: number; text: string }>,
		) => {
			const packet = parseRequirementReviewPacket({
				schemaVersion: "xique.word-requirement-review.packet.v1",
				reviewMode: "candidate_protected_residual",
				version: "docx-paragraphs-v1",
				outputField: "完整采购需求编号范围",
				sourceName: `${candidateId}.docx`,
				sourceSha256: sha256(
					blocks.map((block) => `段落${block.blockId}：${block.text}`).join("\n"),
				),
				blockCount: blocks.length,
				candidateId,
				candidatePromptSha256: "d".repeat(64),
				initialRanges: ["段落0"],
				blocks,
			});
			return runPiNativeCandidateS0Review({
				packet,
				packetSha256: sha256(candidateId),
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
					transportProfile: "faux-json-object",
					apiKey: "faux-key",
				},
				finalizerRuntime: {
					model,
					streamFunction: streamSimple,
					apiKey: "faux-key",
				},
			});
		};
		const indexed = await run("indexed", [
			{ blockId: 0, text: "供应商应遵守《现场管理制度》。" },
			{ blockId: 1, text: "5.1 现场管理制度" },
		]);
		const control = await run("control", [
			{ blockId: 0, text: "供应商应遵守（现场管理制度）。" },
			{ blockId: 1, text: "5.1 现场管理制度" },
		]);

		expect(indexed.context.sourceTextCharacterCount).toBe(
			control.context.sourceTextCharacterCount,
		);
		expect(indexed.context.exactDelimitedStringOccurrenceEntryCount).toBe(1);
		expect(control.context.exactDelimitedStringOccurrenceEntryCount).toBe(0);
		expect(indexed.context.challengerEstimatedTokens).toBeGreaterThan(
			control.context.challengerEstimatedTokens,
		);
		expect(indexed.context.finalizerPreflightEstimatedTokens).toBeGreaterThan(
			control.context.finalizerPreflightEstimatedTokens,
		);
	} finally {
		registration.unregister();
	}
});
