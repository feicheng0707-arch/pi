import { describe, expect, test } from "vitest";
import { buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex } from "./pi-native-candidate-s0.ts";

describe("Candidate S0 exact delimited string occurrence index", () => {
	test("locates whitespace-normalized literal occurrences on both sides of S0", () => {
		const index = buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
			[
				{ blockId: 1, text: "供应商应遵守《安全\n文明制度》。" },
				{ blockId: 2, text: "《安全 文明制度》" },
				{ blockId: 3, text: "3.2 安全\n文明制度" },
			],
			new Set([1]),
		);

		expect(index).toEqual([
			{
				matchedSourceText: "安全 文明制度",
				candidateS0BlockIds: [1],
				candidateS0BlockIdsTruncated: false,
				outsideCandidateS0BlockIds: [2, 3],
				outsideCandidateS0BlockIdsTruncated: false,
			},
		]);
	});

	test("does not use case-insensitive or punctuation-fuzzy matching", () => {
		const index = buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
			[
				{ blockId: 1, text: "《Alpha-Beta》与《制度，甲》" },
				{ blockId: 2, text: "alpha-beta" },
				{ blockId: 3, text: "制度,甲" },
			],
			new Set([1]),
		);

		expect(index).toEqual([]);
	});

	test("supports every allowed paired delimiter without merging different text", () => {
		const index = buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
			[
				{ blockId: 1, text: "\"Policy E\" 『制度丁』 「制度丙」 “制度乙” 《制度甲》" },
				{ blockId: 2, text: "Policy E" },
				{ blockId: 3, text: "制度丁" },
				{ blockId: 4, text: "制度丙" },
				{ blockId: 5, text: "制度乙" },
				{ blockId: 6, text: "制度甲" },
			],
			new Set([1]),
		);

		expect(index.map((entry) => entry.matchedSourceText)).toEqual([
			"Policy E",
			"制度丁",
			"制度丙",
			"制度乙",
			"制度甲",
		]);
		expect(index.map((entry) => entry.outsideCandidateS0BlockIds)).toEqual([
			[2],
			[3],
			[4],
			[5],
			[6],
		]);
	});

	test("omits unseeded or one-sided strings and keeps matching literal", () => {
		const index = buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
			[
				{ blockId: 1, text: "《仅在候选内》与未加定界符内容" },
				{ blockId: 2, text: "仅在候选内" },
				{ blockId: 3, text: "《仅在候选外》" },
				{ blockId: 4, text: "仅在候选外与未加定界符内容" },
			],
			new Set([1, 2]),
		);

		expect(index).toEqual([]);
	});

	test("keeps source order, deduplicates each block, and caps each side", () => {
		const blocks = [
			{ blockId: 1, text: "《共同制度》《共同制度》" },
			...Array.from({ length: 9 }, (_, index) => ({
				blockId: index + 2,
				text: "共同制度",
			})),
			...Array.from({ length: 10 }, (_, index) => ({
				blockId: index + 11,
				text: "共同制度",
			})),
		];
		const candidateBlockIds = new Set(
			Array.from({ length: 10 }, (_, index) => index + 1),
		);

		const index = buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
			blocks,
			candidateBlockIds,
		);

		expect(index).toEqual([
			{
				matchedSourceText: "共同制度",
				candidateS0BlockIds: [1, 2, 3, 4, 5, 6, 7, 8],
				candidateS0BlockIdsTruncated: true,
				outsideCandidateS0BlockIds: [11, 12, 13, 14, 15, 16, 17, 18],
				outsideCandidateS0BlockIdsTruncated: true,
			},
		]);
	});

	test("caps the deterministic entry list", () => {
		const blocks = Array.from({ length: 70 }, (_, index) => {
			const suffix = String(index).padStart(2, "0");
			return [
				{ blockId: index * 2, text: `《条目${suffix}》` },
				{ blockId: index * 2 + 1, text: `条目${suffix}` },
			];
		}).flat();
		const candidateBlockIds = new Set(
			Array.from({ length: 70 }, (_, index) => index * 2),
		);

		const index = buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
			blocks,
			candidateBlockIds,
		);

		expect(index).toHaveLength(64);
		expect(index[0]?.matchedSourceText).toBe("条目00");
		expect(index[63]?.matchedSourceText).toBe("条目63");
	});

	test("bounds distinct seed scanning before occurrence expansion", () => {
		const blocks = Array.from({ length: 257 }, (_, index) => ({
			blockId: index,
			text: `《种子${String(index).padStart(3, "0")}》`,
		}));
		blocks.push({ blockId: 300, text: "种子256" });

		const index = buildPiNativeCandidateS0ExactDelimitedStringOccurrenceIndex(
			blocks,
			new Set(Array.from({ length: 257 }, (_, blockId) => blockId)),
		);

		expect(index).toEqual([]);
	});
});
