import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMalformedParameterMarkup } from "./protocol.ts";

describe("normalizeMalformedParameterMarkup", () => {
	it("recovers provider parameter markup before schema validation", () => {
		const normalized = normalizeMalformedParameterMarkup({
			selected_proposal:
				'empty</parameterparameter>\n<parameter name="evidence_quotes" string="false">[{"block_id":80,"quote":"八、评价标准"}]',
			reason: "post-award, choose empty.</parameterparameter>\n</function></seed:tool_call>",
		});
		assert.deepEqual(normalized, {
			recoveredMalformedParameterMarkup: true,
			value: {
				selected_proposal: "empty",
				evidence_quotes: [{ block_id: 80, quote: "八、评价标准" }],
				reason: "post-award, choose empty.",
			},
		});
	});

	it("does not guess when the embedded payload is invalid", () => {
		const value = {
			selected_proposal:
				'empty</parameterparameter><parameter name="evidence_quotes" string="false">not-json',
		};
		assert.deepEqual(normalizeMalformedParameterMarkup(value), {
			value,
			recoveredMalformedParameterMarkup: false,
		});
	});

	it("does not overwrite a conflicting explicit field", () => {
		const value = {
			selected_proposal:
				'empty</parameterparameter><parameter name="evidence_quotes" string="false">[]',
			evidence_quotes: [{ block_id: 81, quote: "conflict" }],
		};
		assert.deepEqual(normalizeMalformedParameterMarkup(value), {
			value,
			recoveredMalformedParameterMarkup: false,
		});
	});
});
