const PARAMETER_CLOSE_MARKERS = ["</parameterparameter>", "</parameter>"] as const;
const TERMINAL_TOOL_MARKUP_PATTERN =
	/(?:<\/parameterparameter>|<\/parameter>)?\s*(?:<\/function>)?\s*(?:<\/seed:tool_call>)?\s*$/u;
const PARAMETER_TAG_PATTERN =
	/^<parameter\s+name=(?:"(?<doubleName>[A-Za-z_][A-Za-z0-9_]*)"|'(?<singleName>[A-Za-z_][A-Za-z0-9_]*)')(?:\s+string=(?:"(?<doubleString>true|false)"|'(?<singleString>true|false)'))?\s*>/u;

export interface StructuredToolArgumentNormalization {
	value: unknown;
	recoveredMalformedParameterMarkup: boolean;
}

export function normalizeMalformedParameterMarkup(
	value: unknown,
): StructuredToolArgumentNormalization {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { value, recoveredMalformedParameterMarkup: false };
	}
	const source = value as Record<string, unknown>;
	for (const [fieldName, fieldValue] of Object.entries(source)) {
		if (typeof fieldValue !== "string") continue;
		const marker = firstParameterCloseMarker(fieldValue);
		if (marker === null) continue;
		const prefix = fieldValue.slice(0, marker.index).trimEnd();
		const embedded = parseEmbeddedParameters(fieldValue.slice(marker.index + marker.marker.length));
		if (embedded === null || Object.keys(embedded).length === 0 || Object.hasOwn(embedded, fieldName)) {
			continue;
		}
		const conflicts = Object.entries(embedded).some(
			([name, child]) => Object.hasOwn(source, name) && !sameJsonValue(source[name], child),
		);
		if (conflicts) continue;
		const normalized: Record<string, unknown> = { ...source, [fieldName]: prefix, ...embedded };
		for (const [name, child] of Object.entries(normalized)) {
			if (typeof child === "string") normalized[name] = stripTerminalToolMarkup(child);
		}
		return { value: normalized, recoveredMalformedParameterMarkup: true };
	}
	return { value, recoveredMalformedParameterMarkup: false };
}

function parseEmbeddedParameters(value: string): Record<string, unknown> | null {
	const parsed: Record<string, unknown> = {};
	let remaining = value.trimStart();
	while (remaining.length > 0) {
		const tag = PARAMETER_TAG_PATTERN.exec(remaining);
		if (!tag?.groups) return null;
		const name = tag.groups.doubleName ?? tag.groups.singleName;
		const stringFlag = tag.groups.doubleString ?? tag.groups.singleString;
		if (!name || Object.hasOwn(parsed, name)) return null;
		remaining = remaining.slice(tag[0].length);
		const nextMarker = firstParameterCloseMarker(remaining);
		const rawPayload = (
			nextMarker === null ? stripTerminalToolMarkup(remaining) : remaining.slice(0, nextMarker.index)
		).trim();
		if (rawPayload.length === 0) return null;
		try {
			parsed[name] =
				stringFlag === "true" && !rawPayload.startsWith('"')
					? rawPayload
					: (JSON.parse(rawPayload) as unknown);
		} catch {
			return null;
		}
		if (nextMarker === null) return parsed;
		remaining = remaining.slice(nextMarker.index + nextMarker.marker.length).trimStart();
		if (/^(?:<\/function>)?\s*(?:<\/seed:tool_call>)?\s*$/u.test(remaining)) return parsed;
	}
	return parsed;
}

function firstParameterCloseMarker(
	value: string,
): { index: number; marker: (typeof PARAMETER_CLOSE_MARKERS)[number] } | null {
	let match: { index: number; marker: (typeof PARAMETER_CLOSE_MARKERS)[number] } | null = null;
	for (const marker of PARAMETER_CLOSE_MARKERS) {
		const index = value.indexOf(marker);
		if (index >= 0 && (match === null || index < match.index)) match = { index, marker };
	}
	return match;
}

function stripTerminalToolMarkup(value: string): string {
	return value.replace(TERMINAL_TOOL_MARKUP_PATTERN, "").trimEnd();
}

function sameJsonValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
