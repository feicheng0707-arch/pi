import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/compat";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertAnswerFreeScoreReviewPacketValue } from "./integrity.ts";
import {
	loadPiNativeOwnerBoundaryPrompts,
	runPiNativeOwnerBoundaryReview,
} from "./native-owner-boundary.ts";
import {
	loadPiNativeAtomicRemovalPrompts,
	loadPiNativeBoundedMembershipPrompts,
	runPiNativeAtomicRemovalReview,
	runPiNativeBoundedMembershipReview,
} from "./native-bounded-membership.ts";
import {
	loadPiNativeAdversarialDebateReleasePrompts,
	loadPiNativeBlindResidualPrompts,
	loadPiNativeFullChallengeReleasePrompts,
	loadPiNativePartialGroupAppealPrompts,
	loadPiNativePrompts,
	loadPiNativeReleaseGatedIssueRepairPrompts,
	loadPiNativeResidualPrompts,
	loadPiNativeReviewerDialogueReleasePrompts,
	loadPiNativeSingleIssueReleasePrompts,
	loadPiNativeStrictAdversarialDebatePrompts,
	loadPiNativeTargetedIssueRepairPrompts,
	loadPiNativeTargetedRepairPrompts,
	type PiNativePrompts,
	type PiNativeReviewProfile,
	runPiNativeScoreReview,
} from "./native.ts";
import { loadXqParityPrompts, runXqParityReview } from "./parity.ts";
import {
	parseScoreReviewPacket,
	runScoreReviewLoop,
	type ScoreReviewPacket,
} from "./reviewer.ts";
import {
	loadScopeGraphReviewPrompts,
	runScopeGraphScoreReview,
} from "./scope.ts";
import { loadSparseReviewPrompts, runSparseScoreReview } from "./sparse.ts";
import {
	parseScoreReviewWorkbenchDetails,
	ScoreReviewWorkbench,
	type ScoreReviewWorkbenchSnapshot,
	WorkbenchProposalParameters,
} from "./workbench.ts";

const DOUBAO_PROVIDER = "pi-score-reviewer-doubao";
const DOUBAO_MODEL = "doubao-seed-2-0-lite-260428";
const DOUBAO_PRO_MODEL = "doubao-seed-2-0-pro-260215";
const DOUBAO_CHECKER_MODEL = "doubao-seed-1-6-251015";
const DEFAULT_DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const MAX_PACKET_BYTES = 20 * 1024 * 1024;
const MAX_WORKBENCH_CONTINUATION_NUDGES = 4;
const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const reviewerContractPath = resolve(
	extensionDirectory,
	"../../skills/score-extraction-reviewer/references/reviewer-contract.md",
);
const workbenchPolicyPath = resolve(
	extensionDirectory,
	"../../skills/score-extraction-reviewer/references/pi-native-workbench.md",
);
const parityPromptDirectory = resolve(
	extensionDirectory,
	"../../skills/score-extraction-reviewer/references/xq-parity",
);
const sparsePromptDirectory = resolve(
	extensionDirectory,
	"../../skills/score-extraction-reviewer/references",
);
const piNativePromptDirectory = sparsePromptDirectory;
const WORKBENCH_STAGE_TOOL_NAMES = new Set([
	"inspect_score_review_source",
	"propose_score_review_patch",
	"repair_score_review_patch",
	"check_score_review_patch",
	"finalize_score_review",
]);
const EmptyParameters = Type.Object({});
const FinalizeParameters = Type.Object({
	reason: Type.String({ minLength: 1, maxLength: 3_000 }),
	outcome: Type.Union([Type.Literal("complete"), Type.Literal("blocked")]),
});

interface LoadedScoreReviewPacket {
	packetPath: string;
	packetSha256: string;
	packet: ScoreReviewPacket;
}

const parityReviewTool = defineTool({
	name: "review_score_extraction_ranges_xq_parity",
	label: "Review score extraction ranges (xq parity)",
	description:
		"Run the isolated xq-parity score review capability: fresh add-only Completeness loop, frozen Production Checker, fresh remove-only Release loop, and nested independent Owner/Boundary Pi loops.",
	promptSnippet:
		"Review a completeness packet with the isolated xq-parity Pi capability",
	promptGuidelines: [
		"Use this as the default score-extraction review capability. Call it once with an immutable completeness packet and report its structured result; do not move source or worker history into the main session.",
	],
	parameters: Type.Object({
		packetPath: Type.String({
			minLength: 1,
			description:
				"Absolute path or cwd-relative path to an xique.score-review.packet.v1 completeness JSON file",
		}),
	}),
	executionMode: "sequential",

	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
		const prompts = await loadXqParityPrompts(parityPromptDirectory);
		const reviewerModel = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
		if (!reviewerModel) {
			throw new Error(
				`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
			);
		}
		const checkerModel = ctx.modelRegistry.find(
			DOUBAO_PROVIDER,
			DOUBAO_CHECKER_MODEL,
		);
		if (!checkerModel) {
			throw new Error(
				`registered Doubao checker model not found: ${DOUBAO_PROVIDER}/${DOUBAO_CHECKER_MODEL}`,
			);
		}
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(reviewerModel);
		if (!auth.ok) throw new Error(`Doubao reviewer auth failed: ${auth.error}`);
		if (!auth.apiKey) {
			throw new Error(
				"Doubao reviewer requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
			);
		}

		const result = await runXqParityReview({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			prompts,
			reviewerModel,
			checkerModel,
			streamFunction: doubaoStreamFunction,
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal,
			onProgress: (progress) => {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `${progress.role} turn ${progress.turn}: ${progress.tool ?? "model"}`,
						},
					],
					details: progress,
				});
			},
		});

		const ranges =
			result.finalRanges.length > 0 ? result.finalRanges.join(", ") : "(empty)";
		const patch = result.patch
			? `add ${result.patch.missingRanges.join(", ") || "none"}; remove ${result.patch.removeRanges.join(", ") || "none"}`
			: "none";
		return {
			content: [
				{
					type: "text",
					text: `XQ-parity score review ${result.status}. Final ranges: ${ranges}. Patch: ${patch}. Checker: ${result.checker.status}. Reason: ${result.reason}`,
				},
			],
			details: result,
		};
	},
});

const dualReviewTool = defineTool({
	name: "review_score_extraction_ranges_dual_review",
	label: "Review score extraction ranges (dual review)",
	description:
		"Run the experimental bounded Finalizer/Challenger score review over one frozen compact context, with at most one targeted disagreement repair and no per-block ledger.",
	promptSnippet:
		"Review score extraction ranges with independent main and adversarial judgments",
	promptGuidelines: [
		"Use this only for the v3 dual-review experiment. Call it once with an immutable completeness packet; report needs_review without publishing ranges when the two judgments and one allowed repair do not close.",
	],
	parameters: Type.Object({
		packetPath: Type.String({
			minLength: 1,
			description:
				"Absolute path or cwd-relative path to an xique.score-review.packet.v1 completeness JSON file",
		}),
	}),
	executionMode: "sequential",

	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
		const prompts = await loadSparseReviewPrompts(sparsePromptDirectory);
		const model = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
		if (!model)
			throw new Error(
				`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
			);
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(`Doubao reviewer auth failed: ${auth.error}`);
		if (!auth.apiKey) {
			throw new Error(
				"Doubao reviewer requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
			);
		}

		const result = await runSparseScoreReview({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			prompts,
			model,
			streamFunction: doubaoStreamFunction,
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal,
			onProgress: (progress) => {
				onUpdate?.({
					content: [
						{ type: "text", text: `${progress.role}: structured judgment` },
					],
					details: progress,
				});
			},
		});

		const ranges =
			result.finalRanges === null
				? "(not published)"
				: result.finalRanges.length > 0
					? result.finalRanges.join(", ")
					: "(empty)";
		const patch = result.patch
			? `add ${result.patch.missingRanges.join(", ") || "none"}; remove ${result.patch.removeRanges.join(", ") || "none"}`
			: "none";
		return {
			content: [
				{
					type: "text",
					text: `Dual score review ${result.status} via ${result.resolution}. Final ranges: ${ranges}. Patch: ${patch}. Calls: ${result.budget.providerCalls}. Reason: ${result.reason}`,
				},
			],
			details: result,
		};
	},
});

const scopeGraphReviewTool = defineTool({
	name: "review_score_extraction_ranges_scope_graph",
	label: "Review score extraction ranges (scope graph)",
	description:
		"Run the experimental v5 deterministic coarse-scope graph with Doubao 2.0 Lite for every semantic role and at most one targeted unit repair.",
	promptSnippet:
		"Review score extraction ranges over deterministic structural units",
	promptGuidelines: [
		"Use this only for the v5 scope-graph experiment. Call it once with an immutable completeness packet; models select unit IDs, while code only expands structural units, routes the frozen model by role, and enforces hashes, disagreement scope, and hard budgets.",
	],
	parameters: Type.Object({
		packetPath: Type.String({
			minLength: 1,
			description:
				"Absolute path or cwd-relative path to an xique.score-review.packet.v1 completeness JSON file",
		}),
	}),
	executionMode: "sequential",

	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
		const prompts = await loadScopeGraphReviewPrompts(sparsePromptDirectory);
		const model = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
		if (!model)
			throw new Error(
				`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
			);
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(`Doubao reviewer auth failed: ${auth.error}`);
		if (!auth.apiKey) {
			throw new Error(
				"Doubao reviewer requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
			);
		}

		const result = await runScopeGraphScoreReview({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			prompts,
			model,
			sequenceModel: model,
			streamFunction: doubaoStreamFunction,
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal,
			onProgress: (progress) => {
				onUpdate?.({
					content: [
						{ type: "text", text: `${progress.role}: scope-unit judgment` },
					],
					details: progress,
				});
			},
		});

		const ranges =
			result.finalRanges === null
				? "(not published)"
				: result.finalRanges.length > 0
					? result.finalRanges.join(", ")
					: "(empty)";
		const patch = result.patch
			? `add ${result.patch.missingRanges.join(", ") || "none"}; remove ${result.patch.removeRanges.join(", ") || "none"}`
			: "none";
		return {
			content: [
				{
					type: "text",
					text: `Scope-graph score review ${result.status} via ${result.resolution}. Final ranges: ${ranges}. Patch: ${patch}. Units: ${result.context.unitCount}. Calls: ${result.budget.providerCalls}. Reason: ${result.reason}`,
				},
			],
			details: result,
		};
	},
});

interface PiNativeBoundedMembershipToolConfiguration {
	route: "v51" | "v53";
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuideline: string;
	summaryLabel: string;
}

function createPiNativeBoundedMembershipTool(
	configuration: PiNativeBoundedMembershipToolConfiguration,
) {
	return defineTool({
		name: configuration.name,
		label: configuration.label,
		description: configuration.description,
		promptSnippet: configuration.promptSnippet,
		promptGuidelines: [configuration.promptGuideline],
		parameters: Type.Object({
			packetPath: Type.String({
				minLength: 1,
				description:
					"Absolute path or cwd-relative path to an xique.score-review.packet.v1 completeness JSON file",
			}),
		}),
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
			const reviewerModel = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
			if (!reviewerModel) {
				throw new Error(
					`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
				);
			}
			const primaryModel = ctx.modelRegistry.find(
				DOUBAO_PROVIDER,
				DOUBAO_PRO_MODEL,
			);
			if (!primaryModel) {
				throw new Error(
					`registered Doubao Primary model not found: ${DOUBAO_PROVIDER}/${DOUBAO_PRO_MODEL}`,
				);
			}
			const reviewerAuth = await ctx.modelRegistry.getApiKeyAndHeaders(reviewerModel);
			if (!reviewerAuth.ok) {
				throw new Error(`Doubao reviewer auth failed: ${reviewerAuth.error}`);
			}
			const primaryAuth = await ctx.modelRegistry.getApiKeyAndHeaders(primaryModel);
			if (!primaryAuth.ok) {
				throw new Error(`Doubao Primary auth failed: ${primaryAuth.error}`);
			}
			if (!reviewerAuth.apiKey || !primaryAuth.apiKey) {
				throw new Error(
					"Doubao bounded-membership review requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
				);
			}

			const sharedOptions = {
				packet: loaded.packet,
				packetSha256: loaded.packetSha256,
				reviewerRuntime: {
					model: reviewerModel,
					streamFunction: doubaoStreamFunction,
					apiKey: reviewerAuth.apiKey,
					headers: reviewerAuth.headers,
					env: reviewerAuth.env,
				},
				primaryRuntime: {
					model: primaryModel,
					streamFunction: doubaoStreamFunction,
					apiKey: primaryAuth.apiKey,
					headers: primaryAuth.headers,
					env: primaryAuth.env,
				},
				signal,
				onProgress: (progress: {
					status: "running";
					role: string;
					tool: string;
				}) => {
					onUpdate?.({
						content: [
							{
								type: "text",
								text: `${progress.role}: ${progress.tool}`,
							},
						],
						details: progress,
					});
				},
			};
			const result =
				configuration.route === "v53"
					? await runPiNativeAtomicRemovalReview({
							...sharedOptions,
							prompts: await loadPiNativeAtomicRemovalPrompts(
								piNativePromptDirectory,
							),
						})
					: await runPiNativeBoundedMembershipReview({
							...sharedOptions,
							prompts: await loadPiNativeBoundedMembershipPrompts(
								piNativePromptDirectory,
							),
						});

			const ranges =
				result.finalRanges.length > 0
					? result.finalRanges.join(", ")
					: "(empty)";
			return {
				content: [
					{
						type: "text",
						text: `${configuration.summaryLabel} review ${result.status} via ${result.resolution}. Final ranges: ${ranges}. Calls: ${result.budget.providerCalls}. Reason: ${result.reason}`,
					},
				],
				details: result,
			};
		},
	});
}

const piNativeBoundedMembershipTool = createPiNativeBoundedMembershipTool({
	route: "v51",
	name: "review_score_extraction_ranges_pi_native_bounded_membership_v51",
	label: "Review score extraction ranges (Pi-native bounded membership v51)",
	description:
		"Run the experimental v51 complete-source Lite Reviewer and direction-blind Pro bounded-membership Primary, with one optional Pro literal-inspection Planner for oversized atomic difference blocks.",
	promptSnippet:
		"Review a frozen score-extraction candidate with bounded adversarial membership",
	promptGuideline:
		"Use this only for the Pi-native bounded-membership v51 experiment. Call it once with an immutable completeness packet; do not retry, expose Reviewer provenance to Primary, add a Release role, or repair a degraded result manually.",
	summaryLabel: "Pi-native bounded-membership v51",
});

const piNativeAtomicRemovalTool = createPiNativeBoundedMembershipTool({
	route: "v53",
	name: "review_score_extraction_ranges_pi_native_atomic_removal_v53",
	label: "Review score extraction ranges (Pi-native atomic removal v53)",
	description:
		"Run the experimental v53 Lite Reviewer plus Pro bounded judge, using one exact-quote Atomic Removal Verifier for a single oversized removal or one focused Pro judge for a single immediate-edge addition.",
	promptSnippet:
		"Review a frozen score-extraction candidate with atomic-removal and immediate-edge verification",
	promptGuideline:
		"Use this only for the Pi-native atomic-removal v53 experiment. Call it once with an immutable completeness packet; do not retry, add a ledger or Release role, or repair a degraded result manually.",
	summaryLabel: "Pi-native atomic-removal v53",
});

const piNativeReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native",
	label: "Review score extraction ranges (Pi-native independent proposal review v6.3)",
	description:
		"Run the preserved candidate-blind Pi-native v6.3 independent-proposal experiment.",
	promptSnippet: "Review a frozen candidate with the preserved Pi-native v6.3 baseline",
	promptGuideline:
		"Use this only for the preserved Pi-native independent-proposal v6.3 baseline; do not retry or repair outside the capability.",
	profile: "independent",
	loadPrompts: loadPiNativePrompts,
});

const piNativeResidualReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_residual",
	label: "Review score extraction ranges (Pi-native residual challenge v7)",
	description:
		"Run one candidate-aware residual Challenger and one optional exact-delta Adjudicator. The candidate changes only when both roles support the same replacement; all failures preserve candidate with degraded status.",
	promptSnippet: "Attack a frozen score-extraction candidate for residual errors",
	promptGuideline:
		"Use this only for the Pi-native residual-challenge v7 experiment. Call it once with an immutable completeness packet; do not regenerate Primary, retry a degraded result, or repair outside the capability.",
	profile: "residual",
	loadPrompts: loadPiNativeResidualPrompts,
});

const piNativeBlindResidualReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_blind_residual",
	label: "Review score extraction ranges (Pi-native source-blind residual v8)",
	description:
		"Run one source-only blind residual proposal and one optional claim-free exact-delta Adjudicator. The candidate changes only when both independent roles support the same replacement; all failures preserve candidate with degraded status.",
	promptSnippet: "Independently challenge a frozen score-extraction candidate without exposing it",
	promptGuideline:
		"Use this only for the Pi-native source-blind residual v8 experiment. Call it once with an immutable completeness packet; do not expose candidate to Call 1, retry a degraded result, or repair outside the capability.",
	profile: "blind_residual",
	loadPrompts: loadPiNativeBlindResidualPrompts,
});

const piNativeTargetedRepairReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_targeted_repair",
	label: "Review score extraction ranges (Pi-native targeted repair v9)",
	description:
		"Treat the candidate as an untrusted patch, open one bounded omission/contamination envelope, and let one independent Finalizer publish a partial or complete repair inside that envelope. All failures preserve candidate with degraded status.",
	promptSnippet: "Review an untrusted score-extraction patch with bounded targeted repair",
	promptGuideline:
		"Use this only for the Pi-native targeted-repair v9 experiment. Call it once with an immutable completeness packet; do not retry, expand the challenge envelope outside the capability, or repair a degraded result manually.",
	profile: "targeted_repair",
	loadPrompts: loadPiNativeTargetedRepairPrompts,
});

const piNativeTargetedIssueRepairReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_targeted_issue_repair",
	label: "Review score extraction ranges (Pi-native residual issue repair v10)",
	description:
		"Review the candidate as an untrusted patch, emit pass or explicit addition/removal challenges, and let one independent Finalizer approve any challenge subset. Runtime only applies the approved set delta.",
	promptSnippet: "Review a score-extraction candidate with residual issue repair",
	promptGuideline:
		"Use this only for the Pi-native residual issue-repair v10 experiment. Call it once with an immutable completeness packet; do not retry, widen challenges outside the capability, or repair a degraded result manually.",
	profile: "targeted_issue_repair",
	loadPrompts: loadPiNativeTargetedIssueRepairPrompts,
});

const piNativeReleaseGatedIssueRepairReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_release_gated_issue_repair",
	label: "Review score extraction ranges (Pi-native selective release gate v13)",
	description:
		"Run residual issue review and Primary Finalization, then conditionally require one independent selective Release Gate before any candidate override. The Gate can only veto Primary-approved changes; all Gate failures preserve candidate with degraded status.",
	promptSnippet:
		"Review a score-extraction candidate with a conditional independent release gate",
	promptGuideline:
		"Use this only for the Pi-native selective release-gate v13 experiment. Call it once with an immutable completeness packet; do not retry, publish the Primary intermediate result, or repair a degraded result manually.",
	profile: "release_gated_issue_repair",
	loadPrompts: loadPiNativeReleaseGatedIssueRepairPrompts,
});

const piNativeFullChallengeReleaseReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_full_challenge_release",
	label: "Review score extraction ranges (Pi-native full-challenge release v14)",
	description:
		"Run residual issue review and Primary Finalization, then conditionally let one independent Release role approve any subset of the complete Reviewer challenge. It cannot touch unchallenged blocks; all Release failures preserve candidate with degraded status.",
	promptSnippet:
		"Review a score-extraction candidate with conditional full-challenge release",
	promptGuideline:
		"Use this only for the Pi-native full-challenge release v14 experiment. Call it once with an immutable completeness packet; do not retry, expose Primary decisions to Release, or repair a degraded result manually.",
	profile: "full_challenge_release",
	loadPrompts: loadPiNativeFullChallengeReleasePrompts,
});

const piNativePartialGroupAppealReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_partial_group_appeal_release",
	label: "Review score extraction ranges (Pi-native partial-group appeal v15)",
	description:
		"Run residual issue review and Primary Finalization, then conditionally release Primary-approved changes plus only rejected members of a Reviewer range item that Primary partially approved. Code computes scope mechanically; the Release role decides all semantics.",
	promptSnippet:
		"Review a score-extraction candidate with bounded partial-group appeal",
	promptGuideline:
		"Use this only for the Pi-native partial-group appeal v15 experiment. Call it once with an immutable completeness packet; do not retry, expand appeal across Reviewer range items, or repair a degraded result manually.",
	profile: "partial_group_appeal_release",
	loadPrompts: loadPiNativePartialGroupAppealPrompts,
});

const piNativeReviewerDialogueReleaseReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_reviewer_dialogue_release",
	label: "Review score extraction ranges (Pi-native reviewer dialogue release v16)",
	description:
		"Expose the Reviewer's issue comment to the Primary Finalizer as an untrusted code-review note, then conditionally run a comment-blind selective Release Gate over only Primary-approved changes.",
	promptSnippet:
		"Review a score-extraction candidate with reviewer dialogue and blind release",
	promptGuideline:
		"Use this only for the Pi-native reviewer-dialogue release v16 experiment. Call it once with an immutable completeness packet; do not expose review comments to Release, retry, or repair a degraded result manually.",
	profile: "reviewer_dialogue_release",
	loadPrompts: loadPiNativeReviewerDialogueReleasePrompts,
});

const piNativeSingleIssueReleaseReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_single_issue_release",
	label: "Review score extraction ranges (Pi-native single-issue release v17)",
	description:
		"Pass the candidate or raise exactly one explicit include/exclude issue, require one whole-issue Primary approval, then conditionally require one blind whole-issue Release approval. No partial patch or direction recovery is allowed.",
	promptSnippet:
		"Review a score-extraction candidate with one bounded review issue",
	promptGuideline:
		"Use this only for the Pi-native single-issue release v17 experiment. Call it once with an immutable completeness packet; do not retry a second issue, partially apply a rejected issue, or repair a degraded result manually.",
	profile: "single_issue_release",
	loadPrompts: loadPiNativeSingleIssueReleasePrompts,
});

const piNativeAdversarialDebateReleaseReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_adversarial_debate_release",
	label: "Review score extraction ranges (Pi-native adversarial debate release v18)",
	description:
		"Run the frozen residual issue Reviewer and claim-blind Primary, then conditionally let one independent Release judge read the complete Reviewer attack, Primary response, and source before approving any subset of the Reviewer envelope.",
	promptSnippet:
		"Review a score-extraction candidate with bounded adversarial debate release",
	promptGuideline:
		"Use this only for the Pi-native adversarial-debate release v18 experiment. Call it once with an immutable completeness packet; do not retry, expand beyond the Reviewer envelope, or repair a degraded result manually.",
	profile: "adversarial_debate_release",
	loadPrompts: loadPiNativeAdversarialDebateReleasePrompts,
});

const piNativeStrictAdversarialDebateReviewTool = createPiNativeReviewTool({
	name: "review_score_extraction_ranges_pi_native_strict_adversarial_debate_release",
	label: "Review score extraction ranges (Pi-native strict adversarial debate v19)",
	description:
		"Run a strict-direction residual issue Reviewer and claim-blind Primary, then conditionally use the adversarial Release for any Primary override or a fully rejected whole-candidate removal challenge.",
	promptSnippet:
		"Review a score-extraction candidate with strict bounded adversarial debate",
	promptGuideline:
		"Use this only for the Pi-native strict adversarial-debate v19 experiment. Call it once with an immutable completeness packet; do not recover direction errors, retry, expand beyond the Reviewer envelope, or repair a degraded result manually.",
	profile: "strict_adversarial_debate_release",
	loadPrompts: loadPiNativeStrictAdversarialDebatePrompts,
});

interface PiNativeToolConfiguration {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuideline: string;
	profile: PiNativeReviewProfile;
	loadPrompts: (directory: string) => Promise<PiNativePrompts>;
}

function createPiNativeReviewTool(configuration: PiNativeToolConfiguration) {
	return defineTool({
		name: configuration.name,
		label: configuration.label,
		description: configuration.description,
		promptSnippet: configuration.promptSnippet,
		promptGuidelines: [configuration.promptGuideline],
		parameters: Type.Object({
			packetPath: Type.String({
				minLength: 1,
				description:
					"Absolute path or cwd-relative path to an xique.score-review.packet.v1 completeness JSON file",
			}),
		}),
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
			const prompts = await configuration.loadPrompts(piNativePromptDirectory);
			const model = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
			if (!model) {
				throw new Error(
					`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
				);
			}
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) throw new Error(`Doubao reviewer auth failed: ${auth.error}`);
			if (!auth.apiKey) {
				throw new Error(
					"Doubao reviewer requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
				);
			}

			const result = await runPiNativeScoreReview({
				packet: loaded.packet,
				packetSha256: loaded.packetSha256,
				prompts,
				model,
				streamFunction: doubaoStreamFunction,
				apiKey: auth.apiKey,
				headers: auth.headers,
				env: auth.env,
				signal,
				profile: configuration.profile,
				onProgress: (progress) => {
					onUpdate?.({
						content: [
							{
								type: "text",
								text: `${progress.role}: ${progress.tool}`,
							},
						],
						details: progress,
					});
				},
			});

			const ranges =
				result.finalRanges.length > 0 ? result.finalRanges.join(", ") : "(empty)";
			return {
				content: [
					{
						type: "text",
						text: `Pi-native ${configuration.profile} review ${result.status}. Final ranges: ${ranges}. Calls: ${result.budget.providerCalls}. Reason: ${result.reason}`,
					},
				],
				details: result,
			};
		},
	});
}

const piNativeOwnerBoundaryTool = defineTool({
	name: "review_score_extraction_ranges_pi_native_owner_boundary",
	label: "Review score extraction ranges (Pi-native Owner/Boundary v5)",
	description:
		"Run the candidate-protected Pi-native v5: one candidate-blind Owner Gate followed by one independent full-source Final Boundary Gate, with no Primary regeneration, ledger, retry, or third call.",
	promptSnippet:
		"Review a frozen score-extraction candidate with independent Owner and Boundary gates",
	promptGuidelines: [
		"Use this for the Pi-native Owner/Boundary v5 experiment. Call it once with an immutable completeness packet; do not regenerate the candidate, expose source to the main session, or repair needs_review outside the capability.",
	],
	parameters: Type.Object({
		packetPath: Type.String({
			minLength: 1,
			description:
				"Absolute path or cwd-relative path to an xique.score-review.packet.v1 completeness JSON file",
		}),
	}),
	executionMode: "sequential",

	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
		const prompts = await loadPiNativeOwnerBoundaryPrompts(piNativePromptDirectory);
		const model = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
		if (!model) {
			throw new Error(
				`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
			);
		}
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(`Doubao reviewer auth failed: ${auth.error}`);
		if (!auth.apiKey) {
			throw new Error(
				"Doubao reviewer requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
			);
		}

		const result = await runPiNativeOwnerBoundaryReview({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			prompts,
			model,
			streamFunction: doubaoStreamFunction,
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal,
			onProgress: (progress) => {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `${progress.role}: ${progress.tool}`,
						},
					],
					details: progress,
				});
			},
		});

		const ranges =
			result.finalRanges === null
				? "(not published)"
				: result.finalRanges.length > 0
					? result.finalRanges.join(", ")
					: "(empty)";
		return {
			content: [
				{
					type: "text",
					text: `Pi-native Owner/Boundary review ${result.status} via ${result.resolution}. Final ranges: ${ranges}. Calls: ${result.budget.providerCalls}. Reason: ${result.reason}`,
				},
			],
			details: result,
		};
	},
});

const reviewTool = defineTool({
	name: "review_score_extraction_ranges",
	label: "Review score extraction ranges (v1 baseline)",
	description:
		"Run the legacy v1 isolated Reviewer loop for an xique.score-review.packet.v1 JSON file. Use only as an explicit baseline.",
	promptSnippet: "Run the legacy v1 score-extraction Reviewer baseline",
	parameters: Type.Object({
		packetPath: Type.String({
			minLength: 1,
			description:
				"Absolute path or cwd-relative path to an xique.score-review.packet.v1 JSON file",
		}),
	}),
	executionMode: "sequential",

	async execute(_toolCallId, params, signal, onUpdate, ctx) {
		const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
		const reviewerContract = await readFile(reviewerContractPath, "utf8");
		const model = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
		if (!model)
			throw new Error(
				`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
			);
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(`Doubao reviewer auth failed: ${auth.error}`);
		if (!auth.apiKey) {
			throw new Error(
				"Doubao reviewer requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
			);
		}

		const result = await runScoreReviewLoop({
			packet: loaded.packet,
			packetSha256: loaded.packetSha256,
			reviewerContract,
			reviewerContractSha256: sha256(reviewerContract),
			model,
			streamFunction: doubaoStreamFunction,
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal,
			onProgress: (progress) => {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `Reviewer turn ${progress.turn}: ${progress.tool ?? progress.stage}`,
						},
					],
					details: progress,
				});
			},
		});

		const ranges =
			result.finalRanges.length > 0 ? result.finalRanges.join(", ") : "(empty)";
		const patch = result.patch
			? `add ${result.patch.missingRanges.join(", ") || "none"}; remove ${result.patch.removeRanges.join(", ") || "none"}`
			: "none";
		return {
			content: [
				{
					type: "text",
					text: `Score range review ${result.status}. Final ranges: ${ranges}. Patch: ${patch}. Reason: ${result.reason}`,
				},
			],
			details: result,
		};
	},
});

const doubaoStreamFunction: StreamFn = (model, context, options) => {
	if (model.api !== "openai-completions") {
		throw new Error(
			`Doubao reviewer requires openai-completions, received ${model.api}`,
		);
	}
	const { reasoning, ...streamOptions } = options ?? {};
	const tools = context.tools ?? [];
	const toolChoice =
		tools.length === 0
			? ("none" as const)
			: tools.length === 1
				? ({ type: "function", function: { name: tools[0].name } } as const)
				: ("required" as const);
	return stream(model as Model<"openai-completions">, context, {
		...streamOptions,
		toolChoice,
		reasoningEffort: reasoning,
	});
};

export default function (pi: ExtensionAPI) {
	let workbench: ScoreReviewWorkbench | null = null;
	let continuationNudgeCount = 0;

	pi.registerProvider(DOUBAO_PROVIDER, {
		name: "Pi Score Reviewer Doubao",
		baseUrl: process.env.PI_SCORE_REVIEWER_BASE_URL || DEFAULT_DOUBAO_BASE_URL,
		apiKey: "$PI_SCORE_REVIEWER_API_KEY",
		api: "openai-completions",
		models: [
				{
					id: DOUBAO_MODEL,
				name: "Doubao Seed 2.0 Lite (Xique Reviewer)",
				api: "openai-completions",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256_000,
				maxTokens: 12_000,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					thinkingFormat: "deepseek",
					},
				},
				{
					id: DOUBAO_PRO_MODEL,
					name: "Doubao Seed 2.0 Pro (Xique Bounded Membership)",
					api: "openai-completions",
					reasoning: true,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128_000,
					maxTokens: 6_000,
					compat: {
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
						supportsUsageInStreaming: true,
						maxTokensField: "max_tokens",
						thinkingFormat: "deepseek",
					},
				},
				{
					id: DOUBAO_CHECKER_MODEL,
				name: "Doubao Seed 1.6 (Xique Production Checker)",
				api: "openai-completions",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256_000,
				maxTokens: 12_000,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					thinkingFormat: "deepseek",
				},
			},
		],
	});

	pi.registerTool({
		name: "open_score_review_workbench",
		label: "Open score review workbench",
		description:
			"Open a Pi-native bounded score-extraction review for an xique.score-review.packet.v1 completeness packet, switch the main session to Doubao, and activate the single stage-appropriate workbench tool.",
		promptSnippet:
			"Open a Pi-native score-extraction review workbench for a packet",
		promptGuidelines: [
			"Use open_score_review_workbench only when the user explicitly requests the v2 main-session workbench experiment; the default capability is review_score_extraction_ranges_xq_parity.",
		],
		parameters: Type.Object({
			packetPath: Type.String({
				minLength: 1,
				description:
					"Absolute path or cwd-relative path to an xique.score-review.packet.v1 JSON file",
			}),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (workbench && !workbench.isFinished)
				throw new Error("a score review workbench is already active");
			continuationNudgeCount = 0;
			const loaded = await loadScoreReviewPacket(params.packetPath, ctx.cwd);
			const policy = await readFile(workbenchPolicyPath, "utf8");
			const model = ctx.modelRegistry.find(DOUBAO_PROVIDER, DOUBAO_MODEL);
			if (!model)
				throw new Error(
					`registered Doubao reviewer model not found: ${DOUBAO_PROVIDER}/${DOUBAO_MODEL}`,
				);
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok)
				throw new Error(`Doubao reviewer auth failed: ${auth.error}`);
			if (!auth.apiKey) {
				throw new Error(
					"Doubao reviewer requires PI_SCORE_REVIEWER_API_KEY or stored credentials for pi-score-reviewer-doubao",
				);
			}

			const originalActiveTools = pi
				.getActiveTools()
				.filter((name) => !WORKBENCH_STAGE_TOOL_NAMES.has(name));
			const metadata = {
				packetPath: loaded.packetPath,
				packetSha256: loaded.packetSha256,
				policySha256: sha256(policy),
				originalActiveTools,
				originalModel: ctx.model
					? { provider: ctx.model.provider, id: ctx.model.id }
					: null,
				workbenchModel: { provider: model.provider, id: model.id },
			};
			const nextWorkbench = new ScoreReviewWorkbench(loaded.packet, metadata);
			if (!(await pi.setModel(model)))
				throw new Error(
					"failed to activate the registered Doubao reviewer model",
				);
			workbench = nextWorkbench;
			activateWorkbenchTool(pi, workbench);
			const payload = {
				ok: true,
				status: "opened",
				packetPath: loaded.packetPath,
				packetSha256: loaded.packetSha256,
				policySha256: metadata.policySha256,
				model: metadata.workbenchModel,
				stage: workbench.stage,
				nextTool: workbench.activeToolName(),
			};
			return {
				content: [
					{
						type: "text",
						text: `${JSON.stringify(payload, null, 2)}\n\n# Pi-native completeness review policy\n\n${policy}`,
					},
				],
				details: workbench.details(payload),
			};
		},
	});

	pi.registerTool({
		name: "inspect_score_review_source",
		label: "Inspect score review source",
		description:
			"Read the next runtime-owned document-map or full-source page for the active score review workbench. This tool has no range parameters; repeat it until the workbench activates propose_score_review_patch.",
		promptSnippet: "Inspect the next deterministic score-review source page",
		promptGuidelines: [
			"Call inspect_score_review_source with an empty object while it is active; treat map previews only as locators and use the returned full source for semantic decisions.",
		],
		parameters: EmptyParameters,
		executionMode: "sequential",
		async execute() {
			const activeWorkbench = requireWorkbench(workbench);
			const payload = activeWorkbench.inspectSource();
			activateWorkbenchTool(pi, activeWorkbench);
			return workbenchToolResult(activeWorkbench, payload);
		},
	});

	pi.registerTool({
		name: "propose_score_review_patch",
		label: "Propose score review patch",
		description:
			"Submit the first source-grounded final ranges and a block decision ledger covering exactly the runtime-computed add/remove delta. The checker will always open one separate targeted repair stage.",
		promptSnippet: "Propose initial score-extraction review ranges",
		promptGuidelines: [
			"When propose_score_review_patch is active, submit strict 段落N finalRanges and blockDecisions exactly for the add/remove delta; every sourceQuote must be an exact quote from that same block.",
			"Before propose_score_review_patch, identify direct evaluation, any local evaluation group, and positive source boundaries. Repeated wording like 投标人详细阐述某方案、方案完整性高、合理、针对性强 is still a supplier drafting requirement, not an evaluator result, unless source separately supplies an evaluation owner/rule and executable consequence.",
			"The first proposal is provisional: check_score_review_patch will force an independent targeted repair even when the deterministic contract passes.",
		],
		parameters: WorkbenchProposalParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const activeWorkbench = requireWorkbench(workbench);
			const payload = activeWorkbench.propose(params);
			activateWorkbenchTool(pi, activeWorkbench);
			return workbenchToolResult(activeWorkbench, payload);
		},
	});

	pi.registerTool({
		name: "repair_score_review_patch",
		label: "Repair score review patch",
		description:
			"Submit the only targeted repair. Cover every checker-owned challenge and current delta block, optionally audit additional fully-read blocks, answer every boundary counterclaim, and publish a new source-first reason.",
		promptSnippet: "Repair challenged score-extraction ranges block by block",
		promptGuidelines: [
			"When repair_score_review_patch is active, blockDecisions must cover every requiredDecisionBlockId plus any newly changed delta block; additional fully-read audited blocks are allowed. Every sourceQuote must be exact text from that same block.",
			"For repair_score_review_patch, determine evaluation-group formation before per-block membership. Multiple neighboring evaluator results can establish a group; supplier drafting actions plus one-way ideal adjectives cannot. Once a group exists, do not demand repeated owner, score, grade, or evaluation verbs from each member.",
			"The repeated pattern 投标人详细阐述……方案完整性高、方案合理、针对性强 is not a direct evaluation mechanism and does not become one through repetition. If that is the only pattern, delete the response-scheme title and all orphan members unless separate source proves an evaluator owner/rule plus an executable result, grade, comparison, score, or pass/fail consequence.",
			"A bounded source slice may omit the upstream evaluation owner. If several continuous numbered technical/service items repeat negative evaluation outcomes such as incomplete, defective, weak, or not provided, treat that as a local evaluation group and include same-level response-time, arrival-time, delivery, training, and provide/not-provide members unless source shows a positive boundary.",
			"Use include_target_leaf only for a same-block direct mechanism. Use include_group_member with supportingBlockIds for a member inheriting a proven local group. Use include_mixed_atomic or include_local_container only for their stated atomic/container cases. Use exclude_non_target only outside finalRanges.",
			"For every excluded_boundary_counterclaim, assume the challenged block inherits the adjacent retained group. Keep it excluded only by quoting a positive new controller, project/package, lifecycle, document-role, or independent hard-exclusion boundary. Missing standalone evaluation language is not boundary evidence.",
			"repair_score_review_patch must use a new reason that explicitly resolves group anchors, each challenged boundary, and each block membership; revise finalRanges whenever the counterclaim cannot be refuted.",
		],
		parameters: WorkbenchProposalParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const activeWorkbench = requireWorkbench(workbench);
			const payload = activeWorkbench.propose(params);
			activateWorkbenchTool(pi, activeWorkbench);
			return workbenchToolResult(activeWorkbench, payload);
		},
	});

	pi.registerTool({
		name: "check_score_review_patch",
		label: "Check score review patch",
		description:
			"Run the zero-parameter deterministic contract checker. The first check returns deterministic issues and a checker-owned semantic challenge together; the second either opens final adjudication or requires blocked.",
		promptSnippet: "Check the proposed score-extraction range patch",
		promptGuidelines: [
			"Call check_score_review_patch with an empty object while it is active; do not pre-empt its deterministic delta and ledger checks.",
		],
		parameters: EmptyParameters,
		executionMode: "sequential",
		async execute() {
			const activeWorkbench = requireWorkbench(workbench);
			const payload = activeWorkbench.checkProposal();
			activateWorkbenchTool(pi, activeWorkbench);
			return workbenchToolResult(activeWorkbench, payload);
		},
	});

	pi.registerTool({
		name: "finalize_score_review",
		label: "Finalize score review",
		description:
			"Publish the final source-first adjudication for the active workbench. The runtime prefixes the real aggregate delta, restores the previous model and tools, and terminates the review turn.",
		promptSnippet: "Finalize the checked score-extraction review",
		promptGuidelines: [
			"When finalize_score_review is active, give a new final-adjudication reason; use blocked when the checker requires it or the semantic result remains unsafe.",
		],
		parameters: FinalizeParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const activeWorkbench = requireWorkbench(workbench);
			const payload = activeWorkbench.finalize(params);
			const details = activeWorkbench.details(payload);
			if (payload.ok !== true) {
				activateWorkbenchTool(pi, activeWorkbench);
				return workbenchToolResult(activeWorkbench, payload);
			}

			const snapshot = activeWorkbench.snapshot();
			pi.setActiveTools(snapshot.originalActiveTools);
			let modelRestored = snapshot.originalModel === null;
			if (snapshot.originalModel) {
				const originalModel = ctx.modelRegistry.find(
					snapshot.originalModel.provider,
					snapshot.originalModel.id,
				);
				modelRestored = originalModel
					? await pi.setModel(originalModel)
					: false;
			}
			workbench = null;
			continuationNudgeCount = 0;
			return {
				content: [
					{
						type: "text",
						text: `${JSON.stringify(payload, null, 2)}\nEnvironment restored: tools=yes, model=${modelRestored ? "yes" : "no"}`,
					},
				],
				details,
				terminate: true,
			};
		},
	});

	pi.registerTool(parityReviewTool);
	pi.registerTool(dualReviewTool);
	pi.registerTool(scopeGraphReviewTool);
	pi.registerTool(piNativeBoundedMembershipTool);
	pi.registerTool(piNativeAtomicRemovalTool);
	pi.registerTool(piNativeReviewTool);
	pi.registerTool(piNativeResidualReviewTool);
	pi.registerTool(piNativeBlindResidualReviewTool);
	pi.registerTool(piNativeTargetedRepairReviewTool);
	pi.registerTool(piNativeTargetedIssueRepairReviewTool);
	pi.registerTool(piNativeReleaseGatedIssueRepairReviewTool);
	pi.registerTool(piNativeFullChallengeReleaseReviewTool);
	pi.registerTool(piNativePartialGroupAppealReviewTool);
	pi.registerTool(piNativeReviewerDialogueReleaseReviewTool);
	pi.registerTool(piNativeSingleIssueReleaseReviewTool);
	pi.registerTool(piNativeAdversarialDebateReleaseReviewTool);
	pi.registerTool(piNativeStrictAdversarialDebateReviewTool);
	pi.registerTool(piNativeOwnerBoundaryTool);
	pi.registerTool(reviewTool);

	const reconstructWorkbench = async (ctx: ExtensionContext) => {
		let snapshot: ScoreReviewWorkbenchSnapshot | null = null;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "toolResult")
				continue;
			const details = parseScoreReviewWorkbenchDetails(entry.message.details);
			if (details) snapshot = details.state;
		}
		if (!snapshot || snapshot.stage === "finished") {
			workbench = null;
			continuationNudgeCount = 0;
			disableWorkbenchStageTools(pi);
			return;
		}

		try {
			const loaded = await loadScoreReviewPacket(snapshot.packetPath, ctx.cwd);
			if (loaded.packetSha256 !== snapshot.packetSha256) {
				throw new Error(
					"score review packet hash changed since the saved workbench state",
				);
			}
			const policy = await readFile(workbenchPolicyPath, "utf8");
			if (sha256(policy) !== snapshot.policySha256) {
				throw new Error(
					"Pi-native score review policy changed since the saved workbench state",
				);
			}
			const restored = new ScoreReviewWorkbench(
				loaded.packet,
				{
					packetPath: snapshot.packetPath,
					packetSha256: snapshot.packetSha256,
					policySha256: snapshot.policySha256,
					originalActiveTools: snapshot.originalActiveTools,
					originalModel: snapshot.originalModel,
					workbenchModel: snapshot.workbenchModel,
				},
				snapshot,
			);
			const model = ctx.modelRegistry.find(
				snapshot.workbenchModel.provider,
				snapshot.workbenchModel.id,
			);
			if (!model || !(await pi.setModel(model)))
				throw new Error("saved Doubao workbench model is unavailable");
			workbench = restored;
			continuationNudgeCount = 0;
			activateWorkbenchTool(pi, restored);
		} catch (error) {
			workbench = null;
			disableWorkbenchStageTools(pi);
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	};

	pi.on("session_start", async (_event, ctx) => reconstructWorkbench(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructWorkbench(ctx));

	pi.on("agent_end", () => {
		if (!workbench || workbench.isFinished) return;
		if (continuationNudgeCount > MAX_WORKBENCH_CONTINUATION_NUDGES) return;
		if (continuationNudgeCount === MAX_WORKBENCH_CONTINUATION_NUDGES) {
			workbench.forceBlockedForRuntime(
				"agent_continuation_budget_exhausted",
				`Pi agent stopped before a terminal workbench result after ${MAX_WORKBENCH_CONTINUATION_NUDGES} continuation nudges.`,
			);
			activateWorkbenchTool(pi, workbench);
		}
		continuationNudgeCount += 1;
		const activeTool = workbench.activeToolName();
		if (!activeTool) return;
		pi.sendUserMessage(
			`Score review workbench is not terminal. Do not explain or stop. Call the only active tool ${activeTool} with exactly its current schema; continue until finalize_score_review returns complete or blocked.`,
			{ deliverAs: "followUp" },
		);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (
			!workbench ||
			workbench.isFinished ||
			ctx.model?.provider !== DOUBAO_PROVIDER
		)
			return;
		const activeTool = workbench.activeToolName();
		if (
			!activeTool ||
			pi.getActiveTools().length !== 1 ||
			pi.getActiveTools()[0] !== activeTool
		)
			return;
		if (!isRecord(event.payload)) return;
		return {
			...event.payload,
			tool_choice: { type: "function", function: { name: activeTool } },
			parallel_tool_calls: false,
		};
	});
}

async function loadScoreReviewPacket(
	packetPathInput: string,
	cwd: string,
): Promise<LoadedScoreReviewPacket> {
	const normalizedPath = packetPathInput.startsWith("@")
		? packetPathInput.slice(1)
		: packetPathInput;
	const packetPath = isAbsolute(normalizedPath)
		? resolve(normalizedPath)
		: resolve(cwd, normalizedPath);
	const packetStat = await stat(packetPath);
	if (!packetStat.isFile())
		throw new Error("score review packet path is not a file");
	if (packetStat.size > MAX_PACKET_BYTES)
		throw new Error("score review packet exceeds the 20 MiB limit");

	const packetText = await readFile(packetPath, "utf8");
	let packetValue: unknown;
	try {
		packetValue = JSON.parse(packetText);
	} catch (error) {
		throw new Error(
			`score review packet is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	assertAnswerFreeScoreReviewPacketValue(packetValue);
	return {
		packetPath,
		packetSha256: sha256(packetText),
		packet: parseScoreReviewPacket(packetValue),
	};
}

function requireWorkbench(
	workbench: ScoreReviewWorkbench | null,
): ScoreReviewWorkbench {
	if (!workbench || workbench.isFinished)
		throw new Error("no active score review workbench");
	return workbench;
}

function activateWorkbenchTool(
	pi: ExtensionAPI,
	workbench: ScoreReviewWorkbench,
): void {
	const toolName = workbench.activeToolName();
	pi.setActiveTools(toolName ? [toolName] : []);
}

function disableWorkbenchStageTools(pi: ExtensionAPI): void {
	pi.setActiveTools(
		pi.getActiveTools().filter((name) => !WORKBENCH_STAGE_TOOL_NAMES.has(name)),
	);
}

function workbenchToolResult(
	workbench: ScoreReviewWorkbench,
	payload: Record<string, unknown>,
) {
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(payload, null, 2) },
		],
		details: workbench.details(payload),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
