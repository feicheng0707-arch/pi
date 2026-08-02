import { afterEach, beforeEach, expect, it, vi } from "vitest";

const googleGenAiMock = vi.hoisted(() => ({
	constructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@google/genai", () => {
	class GoogleGenAI {
		models = {
			generateContentStream: async function* () {
				yield {
					responseId: "gemini-response-id",
					candidates: [
						{
							content: { parts: [{ text: "ok" }] },
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 1,
						candidatesTokenCount: 1,
						totalTokenCount: 2,
					},
				};
			},
		};

		constructor(config: Record<string, unknown>) {
			googleGenAiMock.constructorCalls.push(config);
		}
	}

	return {
		FinishReason: { STOP: "STOP" },
		FunctionCallingConfigMode: { AUTO: "AUTO", NONE: "NONE", ANY: "ANY" },
		GoogleGenAI,
	};
});

import { stream } from "../src/api/google-generative-ai.ts";
import type { Context, Model } from "../src/types.ts";

const model: Model<"google-generative-ai"> = {
	id: "gemini-3.5-flash",
	name: "Gemini 3.5 Flash",
	api: "google-generative-ai",
	provider: "google",
	baseUrl: "https://generativelanguage.googleapis.com/v1beta",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_048_576,
	maxTokens: 65_536,
};
const context: Context = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};
const originalUseVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI;

beforeEach(() => {
	googleGenAiMock.constructorCalls.length = 0;
	process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
});

afterEach(() => {
	if (originalUseVertex === undefined) {
		delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
	} else {
		process.env.GOOGLE_GENAI_USE_VERTEXAI = originalUseVertex;
	}
});

it("forces the Gemini API client even when the process defaults to Vertex", async () => {
	const result = stream(model, context, { apiKey: "test-gemini-key" });

	await result.result();

	expect(googleGenAiMock.constructorCalls).toHaveLength(1);
	expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
		apiKey: "test-gemini-key",
		vertexai: false,
		httpOptions: {
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			apiVersion: "",
		},
	});
});
