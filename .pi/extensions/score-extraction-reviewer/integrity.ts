const FORBIDDEN_CANONICAL_FIELD_NAMES = new Set([
	"acceptableanswers",
	"acceptableranges",
	"acceptablerangesets",
	"answer",
	"answerranges",
	"baselineanswer",
	"baselineoutput",
	"baselineranges",
	"correctanswer",
	"correctedranges",
	"correctranges",
	"evaluationresult",
	"expected",
	"expectedanswer",
	"expectedranges",
	"gold",
	"goldanswer",
	"goldranges",
	"groundtruth",
	"isanswercorrect",
	"iscorrect",
	"pioutput",
	"productionbaseline",
	"referenceanswer",
	"referenceranges",
	"scorecard",
	"verdict",
	"winner",
	"xqoutput",
]);

export class ScoreReviewPacketIntegrityError extends Error {
	readonly fieldPath: string;

	constructor(fieldPath: string) {
		super(`score review runtime packet contains forbidden answer-bearing field: ${fieldPath}`);
		this.name = "ScoreReviewPacketIntegrityError";
		this.fieldPath = fieldPath;
	}
}

export function assertAnswerFreeScoreReviewPacketValue(value: unknown): void {
	visit(value, "$", new Set<object>());
}

function visit(value: unknown, path: string, visited: Set<object>): void {
	if (typeof value !== "object" || value === null) return;
	if (visited.has(value)) return;
	visited.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) visit(value[index], `${path}[${index}]`, visited);
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		if (FORBIDDEN_CANONICAL_FIELD_NAMES.has(canonicalFieldName(key))) {
			throw new ScoreReviewPacketIntegrityError(childPath);
		}
		visit(child, childPath, visited);
	}
}

function canonicalFieldName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}
