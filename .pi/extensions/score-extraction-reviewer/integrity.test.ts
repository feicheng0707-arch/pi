import { describe, expect, it } from "vitest";
import {
	assertAnswerFreeScoreReviewPacketValue,
	ScoreReviewPacketIntegrityError,
} from "./integrity.ts";

describe("score review runtime packet integrity", () => {
	it("allows source text to contain evaluation vocabulary", () => {
		expect(() =>
			assertAnswerFreeScoreReviewPacketValue({
				schemaVersion: "xique.score-review.packet.v1",
				sourceName: "reference-answering-system.docx",
				blocks: [{ blockId: 1, text: "The expected service outcome is evaluated by the committee." }],
			}),
		).not.toThrow();
	});

	it("rejects a top-level expected range field", () => {
		expect(() =>
			assertAnswerFreeScoreReviewPacketValue({
				schemaVersion: "xique.score-review.packet.v1",
				expected_ranges: ["段落1-段落3"],
			}),
		).toThrowError(ScoreReviewPacketIntegrityError);
	});

	it("rejects nested baseline and adjudication fields", () => {
		for (const value of [
			{ metadata: { productionBaseline: { ranges: ["段落1"] } } },
			{ reviewContext: { evaluator: { winner: "candidate" } } },
			{ blocks: [{ blockId: 1, labels: { ground_truth: true } }] },
		]) {
			expect(() => assertAnswerFreeScoreReviewPacketValue(value)).toThrowError(
				ScoreReviewPacketIntegrityError,
			);
		}
	});

	it("reports the exact forbidden field path", () => {
		try {
			assertAnswerFreeScoreReviewPacketValue({ reviewContext: { evaluator: { acceptableRangeSets: [] } } });
			throw new Error("expected integrity failure");
		} catch (error) {
			expect(error).toBeInstanceOf(ScoreReviewPacketIntegrityError);
			expect((error as ScoreReviewPacketIntegrityError).fieldPath).toBe(
				"$.reviewContext.evaluator.acceptableRangeSets",
			);
		}
	});
});
