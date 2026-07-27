import { Type, type Static } from "typebox";
import {
	compactBlockRanges,
	parseStrictRanges,
	type ScoreReviewPacket,
	type ReviewPatch,
} from "./reviewer.ts";

const MAX_MAP_BLOCKS = 400;
const MAX_MAP_PAGES = 8;
const MAX_SOURCE_PAGE_CHARACTERS = 80_000;
const MAX_SOURCE_CHARACTERS = 160_000;
const MAX_PROPOSALS = 2;
const MAX_LOCAL_CONTAINER_DISTANCE = 8;
const SCORE_EVIDENCE_PROBE_PATTERN =
	/(?:评分|得分|分值|分数|满分|打分|加分|扣分|赋分|权重|评审因素|评审标准|评分细则|评价|评标|评审|评定|排名|折算|优劣|不加分|不计分|\d+(?:\.\d+)?\s*分(?:[，。；、）)]|$))/u;
const SCORE_CONTENT_HINT_PATTERN = /(?:技术|服务|方案|质量|能力|承诺|响应|业绩|人员|证书|售后|交付|工期)/u;

const StrictRangeSchema = Type.String({ pattern: "^段落\\d+(?:-段落\\d+)?$" });
export const BlockDecisionSchema = Type.Object({
	blockId: Type.Integer({ minimum: 0 }),
	decision: Type.Union([
		Type.Literal("include_target_leaf", {
			description: "Include because this same block contains a direct evaluation mechanism or result.",
		}),
		Type.Literal("include_group_member", {
			description: "Include because this block inherits a proven local evaluation-group mechanism.",
		}),
		Type.Literal("include_mixed_atomic", {
			description: "Include an indivisible block containing both target and non-target content.",
		}),
		Type.Literal("include_local_container", {
			description: "Include a nearest local container required by retained target leaves.",
		}),
		Type.Literal("exclude_non_target", {
			description: "Exclude the whole block because it has no target leaf or same-block precision debt.",
		}),
	], {
		description: "Membership decision for this block in finalRanges.",
	}),
	sourceQuote: Type.String({
		minLength: 2,
		maxLength: 600,
		description: "Exact quote from the same block's full source.",
	}),
	supportingBlockIds: Type.Array(Type.Integer({ minimum: 0 }), {
		description:
			"For include_group_member, cite local blocks that establish the group mechanism. For include_local_container, cite local retained leaves. Otherwise submit an empty array.",
	}),
});

export const WorkbenchProposalParameters = Type.Object({
	reason: Type.String({ minLength: 1, maxLength: 3_000 }),
	finalRanges: Type.Array(StrictRangeSchema),
	blockDecisions: Type.Array(BlockDecisionSchema, {
		description:
			"First proposal: exactly the current add/remove delta. Repair proposal: cover every checker-required challenge and current delta block; additional fully-read audited blocks are allowed.",
	}),
	outcome: Type.Optional(Type.Union([Type.Literal("complete"), Type.Literal("blocked")])),
});

export type BlockDecision = Static<typeof BlockDecisionSchema>;
export type WorkbenchProposalInput = Static<typeof WorkbenchProposalParameters>;
export type ScoreReviewWorkbenchStage =
	| "structure_map"
	| "source_read"
	| "proposal"
	| "check"
	| "finalize"
	| "finished";

export interface WorkbenchCheckIssue {
	code: string;
	message: string;
	blockIds: number[];
}

interface WorkbenchProposal {
	reason: string;
	outcome: "complete" | "blocked";
	finalRanges: string[];
	finalBlockIds: number[];
	missingBlockIds: number[];
	removeBlockIds: number[];
	blockDecisions: BlockDecision[];
}

export interface ScoreReviewWorkbenchResult {
	schemaVersion: "xique.score-review.workbench-result.v1";
	contractVersion: "score-extraction-reviewer.v2";
	packetSha256: string;
	policySha256: string;
	sourceName: string;
	sourceSha256: string;
	outputField: string;
	reviewMode: "completeness";
	status: "complete" | "blocked";
	reason: string;
	initialRanges: string[];
	finalRanges: string[];
	finalBlockIds: number[];
	patch: ReviewPatch | null;
	blockDecisions: BlockDecision[];
	model: {
		provider: string;
		id: string;
	};
	runtime: {
		maxMapPages: number;
		maxSourceCharacters: number;
		maxProposals: number;
		proposalCount: number;
	};
	evidence: {
		mapBlockIdsRead: number[];
		sourceBlockIdsRead: number[];
		sourceCharactersRead: number;
	};
}

export interface ScoreReviewWorkbenchSnapshot {
	schemaVersion: "xique.score-review.workbench-state.v1";
	packetPath: string;
	packetSha256: string;
	policySha256: string;
	stage: ScoreReviewWorkbenchStage;
	mapBlockIdsRead: number[];
	sourceBlockIdsRead: number[];
	requiredSourceBlockIds: number[];
	mapPagesRead: number;
	sourceCharactersRead: number;
	proposalCount: number;
	firstProposalReason: string | null;
	proposal: WorkbenchProposal | null;
	repairChallengeBlockIds: number[];
	lastCheckIssues: WorkbenchCheckIssue[];
	checkPassed: boolean;
	requiredOutcome: "complete" | "blocked" | null;
	originalActiveTools: string[];
	originalModel: { provider: string; id: string } | null;
	workbenchModel: { provider: string; id: string };
}

export interface ScoreReviewWorkbenchMetadata {
	packetPath: string;
	packetSha256: string;
	policySha256: string;
	originalActiveTools: string[];
	originalModel: { provider: string; id: string } | null;
	workbenchModel: { provider: string; id: string };
}

export interface ScoreReviewWorkbenchDetails {
	schemaVersion: "xique.score-review.workbench-details.v1";
	state: ScoreReviewWorkbenchSnapshot;
	payload: Record<string, unknown>;
}

type ScoreReviewBlock = ScoreReviewPacket["blocks"][number];

export class ScoreReviewWorkbench {
	readonly packet: ScoreReviewPacket;
	readonly metadata: ScoreReviewWorkbenchMetadata;

	private readonly availableBlockIds: ReadonlySet<number>;
	private readonly blocksById: ReadonlyMap<number, ScoreReviewBlock>;
	private readonly initialBlockIds: readonly number[];
	private readonly mapBlockIdsRead = new Set<number>();
	private readonly sourceBlockIdsRead = new Set<number>();
	private readonly requiredSourceBlockIds = new Set<number>();
	private stageValue: ScoreReviewWorkbenchStage = "structure_map";
	private mapPagesReadValue = 0;
	private sourceCharactersReadValue = 0;
	private proposalCountValue = 0;
	private firstProposalReasonValue: string | null = null;
	private proposalValue: WorkbenchProposal | null = null;
	private readonly repairChallengeBlockIds = new Set<number>();
	private lastCheckIssuesValue: WorkbenchCheckIssue[] = [];
	private checkPassedValue = false;
	private requiredOutcomeValue: "complete" | "blocked" | null = null;

	constructor(
		packet: ScoreReviewPacket,
		metadata: ScoreReviewWorkbenchMetadata,
		snapshot?: ScoreReviewWorkbenchSnapshot,
	) {
		if (packet.reviewMode !== "completeness") {
			throw new Error("Pi-native score review workbench v1 only supports completeness packets");
		}
		this.packet = packet;
		this.metadata = metadata;
		this.availableBlockIds = new Set(packet.blocks.map((block) => block.blockId));
		this.blocksById = new Map(packet.blocks.map((block) => [block.blockId, block]));
		this.initialBlockIds = parseStrictRanges(packet.initialRanges, this.availableBlockIds).blockIds;

		if (snapshot) {
			this.restore(snapshot);
			return;
		}
		this.requireSourceEvidence(this.initialEvidenceSeedBlockIds());
	}

	get stage(): ScoreReviewWorkbenchStage {
		return this.stageValue;
	}

	get proposalCount(): number {
		return this.proposalCountValue;
	}

	get isFinished(): boolean {
		return this.stageValue === "finished";
	}

	forceBlockedForRuntime(code: string, message: string): void {
		if (this.isFinished) return;
		const blockIds = this.proposalValue
			? this.requiredDecisionBlockIds(this.proposalValue)
			: this.requiredSourceIds();
		this.lastCheckIssuesValue = [{ code, message, blockIds }];
		this.requiredOutcomeValue = "blocked";
		this.checkPassedValue = false;
		this.stageValue = "finalize";
	}

	activeToolName(): string | null {
		if (this.stageValue === "structure_map" || this.stageValue === "source_read") {
			return "inspect_score_review_source";
		}
		if (this.stageValue === "proposal") {
			return this.proposalCountValue === 0
				? "propose_score_review_patch"
				: "repair_score_review_patch";
		}
		if (this.stageValue === "check") return "check_score_review_patch";
		if (this.stageValue === "finalize") return "finalize_score_review";
		return null;
	}

	inspectSource(): Record<string, unknown> {
		if (this.stageValue === "structure_map") return this.readStructureMapPage();
		if (this.stageValue === "source_read") return this.readRequiredSourcePage();
		throw new Error(`score review source inspection is unavailable during ${this.stageValue}`);
	}

	propose(input: WorkbenchProposalInput): Record<string, unknown> {
		if (this.stageValue !== "proposal") {
			throw new Error(`score review proposal is unavailable during ${this.stageValue}`);
		}
		if (this.proposalCountValue >= MAX_PROPOSALS) throw new Error("score review proposal budget exhausted");

		const final = parseStrictRanges(input.finalRanges, this.availableBlockIds);
		const initial = new Set(this.initialBlockIds);
		const finalBlockIds = new Set(final.blockIds);
		const missingBlockIds = final.blockIds.filter((blockId) => !initial.has(blockId));
		const removeBlockIds = this.initialBlockIds.filter((blockId) => !finalBlockIds.has(blockId));
		const evidenceSeeds = [
			...final.blockIds,
			...input.blockDecisions.flatMap((decision) => [
				decision.blockId,
				...decision.supportingBlockIds,
			]),
		];
		this.requireSourceEvidence(evidenceSeeds);
		const unreadBlockIds = this.requiredSourceIds().filter((blockId) => !this.sourceBlockIdsRead.has(blockId));
		if (unreadBlockIds.length > 0) {
			this.stageValue = "source_read";
			return {
				ok: false,
				status: "needs_more_evidence",
				unreadRanges: compactBlockRanges(unreadBlockIds),
				message: "目标范围、block decision ledger 及其 controller/边界必须先读取完整 source。",
			};
		}

		const proposal: WorkbenchProposal = {
			reason: input.reason.trim(),
			outcome: input.outcome ?? "complete",
			finalRanges: final.ranges,
			finalBlockIds: final.blockIds,
			missingBlockIds,
			removeBlockIds,
			blockDecisions: input.blockDecisions.map((decision) => ({
				...decision,
				supportingBlockIds: [...decision.supportingBlockIds],
			})),
		};
		this.proposalCountValue += 1;
		if (this.firstProposalReasonValue === null) this.firstProposalReasonValue = proposal.reason;
		this.proposalValue = proposal;
		this.checkPassedValue = false;
		this.requiredOutcomeValue = null;
		this.lastCheckIssuesValue = [];
		this.stageValue = "check";
		return {
			ok: true,
			status: this.proposalCountValue === 1 ? "initial_proposal_recorded" : "repair_proposal_recorded",
			proposalCount: this.proposalCountValue,
			proposalsRemaining: MAX_PROPOSALS - this.proposalCountValue,
			finalRanges: proposal.finalRanges,
			missingRanges: compactBlockRanges(proposal.missingBlockIds),
			removeRanges: compactBlockRanges(proposal.removeBlockIds),
			message: "调用零参数 check_score_review_patch 执行确定性检查和定向反方审计。",
		};
	}

	checkProposal(): Record<string, unknown> {
		if (this.stageValue !== "check" || !this.proposalValue) {
			throw new Error(`score review checker is unavailable during ${this.stageValue}`);
		}
		const issues = this.proposalIssues(this.proposalValue);
		if (
			this.proposalCountValue === MAX_PROPOSALS &&
			this.firstProposalReasonValue === this.proposalValue.reason
		) {
			issues.push({
				code: "repair_reason_unchanged",
				message: "targeted repair 必须给出新的 source-first 审计理由，不能逐字重复初稿理由。",
				blockIds: this.requiredDecisionBlockIds(this.proposalValue),
			});
		}

		if (this.proposalCountValue < MAX_PROPOSALS) {
			const challengeBlockIds = this.challengeBlockIds(this.proposalValue);
			for (const blockId of challengeBlockIds) this.repairChallengeBlockIds.add(blockId);
			const challengeIssues = [
				...issues,
				{
					code: "targeted_semantic_repair_required",
					message:
						"无论确定性合同是否通过，都必须完成一次 checker-owned 定向反方审计。下一稿对每个 challenge block 提交一项 membership decision 和同块 exact sourceQuote：先用相邻 blocks 判断是否已由上位规则或多个真正 evaluator result 建立评价组，再判断该 block 是否作为组成员或边界继承该机制；不得先把每个 block 孤立地重做 standalone evaluation test。直接机制来自同块时用 include_target_leaf；依赖已证明评价组时必须用 include_group_member，并在 supportingBlockIds 引用组机制证据。供应商编制/阐述动作叠加单向理想质量形容词不能建立评价组。明确组边界后再保持或修订 finalRanges，并用新的 source-first reason 逐块交账。",
					blockIds: challengeBlockIds,
				},
				...this.boundaryCounterclaimIssues(this.proposalValue, challengeBlockIds),
			];
			this.lastCheckIssuesValue = challengeIssues;
			this.stageValue = "proposal";
			return {
				ok: false,
				status: "targeted_repair_required",
				issues: challengeIssues,
				issueRanges: compactBlockRanges(challengeIssues.flatMap((issue) => issue.blockIds)),
				requiredDecisionBlockIds: sorted(this.repairChallengeBlockIds),
				requiredDecisionRanges: compactBlockRanges(sorted(this.repairChallengeBlockIds)),
				proposalsRemaining: MAX_PROPOSALS - this.proposalCountValue,
			};
		}

		this.lastCheckIssuesValue = issues;
		if (issues.length > 0) {
			this.requiredOutcomeValue = "blocked";
			this.checkPassedValue = false;
			this.stageValue = "finalize";
			return {
				ok: false,
				status: "blocked_required",
				issues,
				issueRanges: compactBlockRanges(issues.flatMap((issue) => issue.blockIds)),
				message: "targeted repair 后仍未通过确定性合同；最终裁决必须 blocked。",
			};
		}

		this.checkPassedValue = true;
		this.requiredOutcomeValue = this.proposalValue.outcome;
		this.stageValue = "finalize";
		return {
			ok: true,
			status: "ready_to_finalize",
			requiredOutcome: this.requiredOutcomeValue,
			finalRanges: this.proposalValue.finalRanges,
			missingRanges: compactBlockRanges(this.proposalValue.missingBlockIds),
			removeRanges: compactBlockRanges(this.proposalValue.removeBlockIds),
			message: "用新的最终裁决理由调用 finalize_score_review。",
		};
	}

	finalize(input: { reason: string; outcome: "complete" | "blocked" }): Record<string, unknown> {
		if (this.stageValue !== "finalize") {
			throw new Error(`score review finalization is unavailable during ${this.stageValue}`);
		}
		if (this.requiredOutcomeValue === "blocked" && input.outcome !== "blocked") {
			return {
				ok: false,
				status: "finalization_rejected",
				expectedOutcome: "blocked",
				issues: this.lastCheckIssuesValue,
			};
		}
		if (this.proposalValue && input.reason.trim() === this.proposalValue.reason) {
			return {
				ok: false,
				status: "finalization_rejected",
				message: "最终裁决理由必须独立于 repair proposal reason，不能逐字重复。",
			};
		}

		const proposal = this.proposalValue;
		const finalBlockIds = proposal?.finalBlockIds ?? [...this.initialBlockIds];
		const finalRanges = compactBlockRanges(finalBlockIds);
		const missingBlockIds = proposal?.missingBlockIds ?? [];
		const removeBlockIds = proposal?.removeBlockIds ?? [];
		const aggregateDeltaReason = [
			`运行时聚合 delta：add=${formatRangeList(compactBlockRanges(missingBlockIds))}`,
			`remove=${formatRangeList(compactBlockRanges(removeBlockIds))}`,
			`final=${formatRangeList(finalRanges)}`,
		].join("; ");
		const patch =
			missingBlockIds.length > 0 || removeBlockIds.length > 0
				? {
						missingRanges: compactBlockRanges(missingBlockIds),
						removeRanges: compactBlockRanges(removeBlockIds),
						addedBlockIds: [...missingBlockIds],
						removedBlockIds: [...removeBlockIds],
						reason: proposal?.reason ?? input.reason.trim(),
					}
				: null;
		const result: ScoreReviewWorkbenchResult = {
			schemaVersion: "xique.score-review.workbench-result.v1",
			contractVersion: "score-extraction-reviewer.v2",
			packetSha256: this.metadata.packetSha256,
			policySha256: this.metadata.policySha256,
			sourceName: this.packet.sourceName,
			sourceSha256: this.packet.sourceSha256,
			outputField: this.packet.outputField,
			reviewMode: "completeness",
			status: input.outcome,
			reason: `${aggregateDeltaReason}\nfinal adjudication: ${input.reason.trim()}`,
			initialRanges: compactBlockRanges(this.initialBlockIds),
			finalRanges,
			finalBlockIds,
			patch,
			blockDecisions: proposal?.blockDecisions ?? [],
			model: { ...this.metadata.workbenchModel },
			runtime: {
				maxMapPages: MAX_MAP_PAGES,
				maxSourceCharacters: MAX_SOURCE_CHARACTERS,
				maxProposals: MAX_PROPOSALS,
				proposalCount: this.proposalCountValue,
			},
			evidence: {
				mapBlockIdsRead: sorted(this.mapBlockIdsRead),
				sourceBlockIdsRead: sorted(this.sourceBlockIdsRead),
				sourceCharactersRead: this.sourceCharactersReadValue,
			},
		};
		this.stageValue = "finished";
		return { ok: true, status: input.outcome, result };
	}

	snapshot(): ScoreReviewWorkbenchSnapshot {
		return {
			schemaVersion: "xique.score-review.workbench-state.v1",
			packetPath: this.metadata.packetPath,
			packetSha256: this.metadata.packetSha256,
			policySha256: this.metadata.policySha256,
			stage: this.stageValue,
			mapBlockIdsRead: sorted(this.mapBlockIdsRead),
			sourceBlockIdsRead: sorted(this.sourceBlockIdsRead),
			requiredSourceBlockIds: sorted(this.requiredSourceBlockIds),
			mapPagesRead: this.mapPagesReadValue,
			sourceCharactersRead: this.sourceCharactersReadValue,
			proposalCount: this.proposalCountValue,
			firstProposalReason: this.firstProposalReasonValue,
			proposal: this.proposalValue
				? {
						...this.proposalValue,
						finalRanges: [...this.proposalValue.finalRanges],
						finalBlockIds: [...this.proposalValue.finalBlockIds],
						missingBlockIds: [...this.proposalValue.missingBlockIds],
						removeBlockIds: [...this.proposalValue.removeBlockIds],
						blockDecisions: this.proposalValue.blockDecisions.map((decision) => ({
							...decision,
							supportingBlockIds: [...decision.supportingBlockIds],
						})),
					}
				: null,
			repairChallengeBlockIds: sorted(this.repairChallengeBlockIds),
			lastCheckIssues: this.lastCheckIssuesValue.map((issue) => ({
				...issue,
				blockIds: [...issue.blockIds],
			})),
			checkPassed: this.checkPassedValue,
			requiredOutcome: this.requiredOutcomeValue,
			originalActiveTools: [...this.metadata.originalActiveTools],
			originalModel: this.metadata.originalModel ? { ...this.metadata.originalModel } : null,
			workbenchModel: { ...this.metadata.workbenchModel },
		};
	}

	details(payload: Record<string, unknown>): ScoreReviewWorkbenchDetails {
		return {
			schemaVersion: "xique.score-review.workbench-details.v1",
			state: this.snapshot(),
			payload,
		};
	}

	private restore(snapshot: ScoreReviewWorkbenchSnapshot): void {
		if (snapshot.schemaVersion !== "xique.score-review.workbench-state.v1") {
			throw new Error("unsupported score review workbench snapshot");
		}
		if (snapshot.packetSha256 !== this.metadata.packetSha256) {
			throw new Error("score review workbench packet changed since the saved session state");
		}
		for (const blockId of [
			...snapshot.mapBlockIdsRead,
			...snapshot.sourceBlockIdsRead,
			...snapshot.requiredSourceBlockIds,
			...snapshot.repairChallengeBlockIds,
		]) {
			if (!this.availableBlockIds.has(blockId)) {
				throw new Error(`score review workbench snapshot references missing block ${blockId}`);
			}
		}
		this.stageValue = snapshot.stage;
		for (const blockId of snapshot.mapBlockIdsRead) this.mapBlockIdsRead.add(blockId);
		for (const blockId of snapshot.sourceBlockIdsRead) this.sourceBlockIdsRead.add(blockId);
		for (const blockId of snapshot.requiredSourceBlockIds) this.requiredSourceBlockIds.add(blockId);
		this.mapPagesReadValue = snapshot.mapPagesRead;
		this.sourceCharactersReadValue = snapshot.sourceCharactersRead;
		this.proposalCountValue = snapshot.proposalCount;
		this.firstProposalReasonValue = snapshot.firstProposalReason;
		this.proposalValue = snapshot.proposal;
		for (const blockId of snapshot.repairChallengeBlockIds) this.repairChallengeBlockIds.add(blockId);
		this.lastCheckIssuesValue = snapshot.lastCheckIssues;
		this.checkPassedValue = snapshot.checkPassed;
		this.requiredOutcomeValue = snapshot.requiredOutcome;
	}

	private readStructureMapPage(): Record<string, unknown> {
		const unreadBlocks = this.packet.blocks.filter((block) => !this.mapBlockIdsRead.has(block.blockId));
		if (unreadBlocks.length === 0) {
			this.advanceAfterInspection();
			return { ok: true, status: "structure_map_complete", nextStage: this.stageValue };
		}
		if (this.mapPagesReadValue >= MAX_MAP_PAGES) {
			return this.blockForBudget(
				"map_page_budget_exhausted",
				`document map 超过 ${MAX_MAP_PAGES} 页的硬预算。`,
				unreadBlocks.map((block) => block.blockId),
			);
		}

		const page = unreadBlocks.slice(0, MAX_MAP_BLOCKS);
		for (const block of page) this.mapBlockIdsRead.add(block.blockId);
		this.mapPagesReadValue += 1;
		const remainingBlockIds = this.packet.blocks
			.filter((block) => !this.mapBlockIdsRead.has(block.blockId))
			.map((block) => block.blockId);
		if (remainingBlockIds.length === 0) this.advanceAfterInspection();
		return {
			ok: true,
			status: "structure_map_page",
			complete: remainingBlockIds.length === 0,
			blockIds: page.map((block) => block.blockId),
			text: [
				"DOCX block map（preview 只用于定位；语义裁决必须读取完整 source）：",
				...page.map((block) => this.documentMapLine(block)),
			].join("\n"),
			remainingRanges: compactBlockRanges(remainingBlockIds),
			nextStage: this.stageValue,
		};
	}

	private readRequiredSourcePage(): Record<string, unknown> {
		const unreadBlockIds = this.requiredSourceIds().filter((blockId) => !this.sourceBlockIdsRead.has(blockId));
		if (unreadBlockIds.length === 0) {
			this.advanceAfterInspection();
			return { ok: true, status: "source_read_complete", nextStage: this.stageValue };
		}
		const remainingBudget = MAX_SOURCE_CHARACTERS - this.sourceCharactersReadValue;
		if (remainingBudget <= 0) {
			return this.blockForBudget(
				"source_character_budget_exhausted",
				`完整 source 读取超过 ${MAX_SOURCE_CHARACTERS} 字符的硬预算。`,
				unreadBlockIds,
			);
		}

		const pageBlockIds: number[] = [];
		let pageCharacters = 0;
		for (const blockId of unreadBlockIds) {
			const block = this.blocksById.get(blockId);
			if (!block) continue;
			const blockCharacters = this.locatorText(block).length + (pageBlockIds.length > 0 ? 1 : 0);
			if (blockCharacters > MAX_SOURCE_PAGE_CHARACTERS || blockCharacters > remainingBudget) {
				if (pageBlockIds.length === 0) {
					return this.blockForBudget(
						"source_block_budget_exhausted",
						`段落${blockId} 无法装入剩余 source 预算。`,
						[blockId],
					);
				}
				break;
			}
			if (pageBlockIds.length > 0 && pageCharacters + blockCharacters > MAX_SOURCE_PAGE_CHARACTERS) break;
			pageBlockIds.push(blockId);
			pageCharacters += blockCharacters;
		}

		const content = pageBlockIds
			.map((blockId) => this.blocksById.get(blockId))
			.filter((block): block is ScoreReviewBlock => block !== undefined)
			.map((block) => this.locatorText(block))
			.join("\n");
		for (const blockId of pageBlockIds) this.sourceBlockIdsRead.add(blockId);
		this.sourceCharactersReadValue += content.length;
		const remainingBlockIds = this.requiredSourceIds().filter(
			(blockId) => !this.sourceBlockIdsRead.has(blockId),
		);
		if (remainingBlockIds.length === 0) this.advanceAfterInspection();
		return {
			ok: true,
			status: "source_page",
			complete: remainingBlockIds.length === 0,
			blockIds: pageBlockIds,
			ranges: compactBlockRanges(pageBlockIds),
			content,
			remainingRanges: compactBlockRanges(remainingBlockIds),
			sourceCharactersRead: this.sourceCharactersReadValue,
			sourceCharactersRemaining: MAX_SOURCE_CHARACTERS - this.sourceCharactersReadValue,
			nextStage: this.stageValue,
		};
	}

	private advanceAfterInspection(): void {
		if (this.packet.blocks.some((block) => !this.mapBlockIdsRead.has(block.blockId))) {
			this.stageValue = "structure_map";
			return;
		}
		if (this.requiredSourceIds().some((blockId) => !this.sourceBlockIdsRead.has(blockId))) {
			this.stageValue = "source_read";
			return;
		}
		this.stageValue = "proposal";
	}

	private blockForBudget(code: string, message: string, blockIds: number[]): Record<string, unknown> {
		this.lastCheckIssuesValue = [{ code, message, blockIds: [...blockIds] }];
		this.requiredOutcomeValue = "blocked";
		this.checkPassedValue = false;
		this.stageValue = "finalize";
		return { ok: false, status: "blocked_required", issues: this.lastCheckIssuesValue };
	}

	private proposalIssues(proposal: WorkbenchProposal): WorkbenchCheckIssue[] {
		const issues: WorkbenchCheckIssue[] = [];
		const requiredDecisionBlockIds = this.requiredDecisionBlockIds(proposal);
		const requiredDecisions = new Set(requiredDecisionBlockIds);
		const decisionsById = new Map<number, BlockDecision>();
		const duplicateBlockIds = new Set<number>();
		for (const decision of proposal.blockDecisions) {
			if (decisionsById.has(decision.blockId)) duplicateBlockIds.add(decision.blockId);
			else decisionsById.set(decision.blockId, decision);
		}
		if (duplicateBlockIds.size > 0) {
			issues.push({
				code: "block_decision_ledger_duplicate",
				message: "blockDecisions 不得重复 blockId。",
				blockIds: [...duplicateBlockIds],
			});
		}
		const missingLedgerBlockIds = requiredDecisionBlockIds.filter((blockId) => !decisionsById.has(blockId));
		const extraLedgerBlockIds =
			this.proposalCountValue === 1
				? [...decisionsById.keys()].filter((blockId) => !requiredDecisions.has(blockId))
				: [];
		if (missingLedgerBlockIds.length > 0 || extraLedgerBlockIds.length > 0) {
			issues.push({
				code: "block_decision_ledger_coverage",
				message:
					this.proposalCountValue === 1
						? "第一稿 blockDecisions 必须恰好覆盖运行时计算的 add/remove delta。"
						: "repair blockDecisions 必须覆盖全部 checker challenge blocks 与当前 add/remove delta；允许额外审计已读 block。",
				blockIds: [...missingLedgerBlockIds, ...extraLedgerBlockIds],
			});
		}

		const final = new Set(proposal.finalBlockIds);
		for (const [blockId, decision] of decisionsById) {
			const isIncludedDecision = decision.decision.startsWith("include_");
			if (final.has(blockId) !== isIncludedDecision) {
				issues.push({
					code: "block_decision_membership_mismatch",
					message: "ledger decision 必须与该 block 是否属于 finalRanges 一致。",
					blockIds: [blockId],
				});
			}
			if (!this.sourceBlockIdsRead.has(blockId)) {
				issues.push({
					code: "block_decision_source_unread",
					message: "ledger block 必须已读取完整 source。",
					blockIds: [blockId],
				});
			}
			const block = this.blocksById.get(blockId);
			const source = normalizeEvidenceText(block ? this.blockSourceText(block) : "");
			const quote = normalizeEvidenceText(decision.sourceQuote);
			if (quote.length < 2 || !source.includes(quote)) {
				issues.push({
					code: "block_decision_quote_mismatch",
					message: "sourceQuote 必须是同一 block 完整 source 中的 exact 原句。",
					blockIds: [blockId],
				});
			}
			if (
				decision.decision === "include_group_member" ||
				decision.decision === "include_local_container"
			) {
				const invalidSupport = decision.supportingBlockIds.filter(
					(supportingBlockId) =>
						supportingBlockId === blockId ||
						!final.has(supportingBlockId) ||
						!this.sourceBlockIdsRead.has(supportingBlockId) ||
						Math.abs(supportingBlockId - blockId) > MAX_LOCAL_CONTAINER_DISTANCE,
				);
				if (decision.supportingBlockIds.length === 0 || invalidSupport.length > 0) {
					issues.push({
						code:
							decision.decision === "include_group_member"
								? "group_member_support_invalid"
								: "local_container_support_invalid",
						message:
							`${decision.decision} 必须引用8个 block 地址以内、已读且仍被保留的 supportingBlockIds。`,
						blockIds: [blockId, ...invalidSupport],
					});
				}
			} else if (decision.supportingBlockIds.length > 0) {
				issues.push({
					code: "unexpected_supporting_block",
					message:
						"只有 include_group_member 或 include_local_container 可以声明 supportingBlockIds。",
					blockIds: [blockId, ...decision.supportingBlockIds],
				});
			}
		}
		return issues;
	}

	private changedBlockIds(proposal: WorkbenchProposal): number[] {
		return [...new Set([...proposal.missingBlockIds, ...proposal.removeBlockIds])].sort(
			(left, right) => left - right,
		);
	}

	private requiredDecisionBlockIds(proposal: WorkbenchProposal): number[] {
		const blockIds = new Set(this.changedBlockIds(proposal));
		if (this.proposalCountValue === MAX_PROPOSALS) {
			for (const blockId of this.repairChallengeBlockIds) blockIds.add(blockId);
		}
		return sorted(blockIds);
	}

	private challengeBlockIds(proposal: WorkbenchProposal): number[] {
		const seeds = new Set([
			...this.initialBlockIds,
			...proposal.finalBlockIds,
			...this.changedBlockIds(proposal),
		]);
		if (seeds.size === 0) {
			for (const blockId of this.requiredSourceIds()) seeds.add(blockId);
		}
		return this.relatedEvidenceBlockIds(sorted(seeds)).filter((blockId) =>
			this.sourceBlockIdsRead.has(blockId),
		);
	}

	private boundaryCounterclaimIssues(
		proposal: WorkbenchProposal,
		challengeBlockIds: readonly number[],
	): WorkbenchCheckIssue[] {
		const final = new Set(proposal.finalBlockIds);
		const issues: WorkbenchCheckIssue[] = [];
		for (const blockId of challengeBlockIds) {
			if (final.has(blockId)) continue;
			const structure = this.blocksById.get(blockId)?.structure;
			const adjacentIncludedBlockIds = [
				...(structure?.previousBlockIds ?? []),
				...(structure?.nextBlockIds ?? []),
			]
				.filter((relatedBlockId) => final.has(relatedBlockId))
				.filter((relatedBlockId, index, values) => values.indexOf(relatedBlockId) === index)
				.sort((left, right) => left - right);
			if (adjacentIncludedBlockIds.length === 0) continue;
			issues.push({
				code: "excluded_boundary_counterclaim",
				message:
					`反方假设：段落${blockId} 与拟保留的 ${formatRangeList(compactBlockRanges(adjacentIncludedBlockIds))} 同属一个已建立的评价组。若仍排除段落${blockId}，必须引用肯定的新 controller、项目/标包、生命周期、文档角色或独立硬排除 scope 作为边界；“本块没有重复评价主体、分值、档位或评价动词”不是边界证据。若找不到肯定边界，应改为 include_group_member 并用 supportingBlockIds 指向组机制证据。`,
				blockIds: [blockId, ...adjacentIncludedBlockIds],
			});
		}
		return issues;
	}

	private initialEvidenceSeedBlockIds(): number[] {
		if (this.initialBlockIds.length > 0) return [...this.initialBlockIds];
		const fullSourceCharacters = this.packet.blocks.reduce(
			(total, block) => total + this.locatorText(block).length + 1,
			0,
		);
		if (fullSourceCharacters <= MAX_SOURCE_CHARACTERS) {
			return this.packet.blocks.map((block) => block.blockId);
		}
		const probeBlockIds = this.packet.blocks
			.filter((block) => SCORE_EVIDENCE_PROBE_PATTERN.test(block.text))
			.map((block) => block.blockId);
		if (probeBlockIds.length > 0) return probeBlockIds;
		const hintedBlockIds = this.packet.blocks
			.filter(
				(block) =>
					block.structure.headingCandidateLevel !== null || SCORE_CONTENT_HINT_PATTERN.test(block.text),
			)
			.map((block) => block.blockId);
		if (hintedBlockIds.length > 0) return hintedBlockIds;
		return this.packet.blocks.slice(0, 1).map((block) => block.blockId);
	}

	private requireSourceEvidence(seedBlockIds: readonly number[]): void {
		for (const blockId of this.relatedEvidenceBlockIds(seedBlockIds)) {
			this.requiredSourceBlockIds.add(blockId);
		}
	}

	private relatedEvidenceBlockIds(seedBlockIds: readonly number[]): number[] {
		const blockIds = new Set(seedBlockIds.filter((blockId) => this.availableBlockIds.has(blockId)));
		for (const blockId of [...blockIds]) {
			const structure = this.blocksById.get(blockId)?.structure;
			for (const relatedBlockId of [
				...(structure?.ancestorBlockIds ?? []),
				...(structure?.previousBlockIds ?? []),
				...(structure?.nextBlockIds ?? []),
			]) {
				if (this.availableBlockIds.has(relatedBlockId)) blockIds.add(relatedBlockId);
			}
		}
		return [...blockIds].sort((left, right) => left - right);
	}

	private requiredSourceIds(): number[] {
		return sorted(this.requiredSourceBlockIds);
	}

	private documentMapLine(block: ScoreReviewBlock): string {
		const structure = block.structure;
		const attributes = [
			`selected=${this.initialBlockIds.includes(block.blockId) ? "yes" : "no"}`,
			`kind=${block.kind}`,
		];
		if (structure.styleId || structure.styleName) {
			attributes.push(`style=${preview(structure.styleId || structure.styleName, 40)}`);
		}
		if (structure.headingCandidateLevel !== null) {
			attributes.push(`headingCandidate=${structure.headingCandidateLevel}/${structure.headingCandidateSource}`);
		}
		if (structure.ancestorBlockIds.length > 0) {
			attributes.push(`ancestors=${structure.ancestorBlockIds.map((blockId) => `段落${blockId}`).join(">")}`);
		}
		if (block.kind === "table") attributes.push(`rows=${block.rows?.length ?? 0}`);
		return `段落${block.blockId} [${attributes.join("; ")}] preview=${preview(block.text, 120)}`;
	}

	private locatorText(block: ScoreReviewBlock): string {
		const sourceText = this.blockSourceText(block);
		if (sourceText.includes("<table>") || sourceText.length > 1_200) {
			return [
				`段落${block.blockId} BEGIN（同一不可拆原子 block）`,
				...sourceFragments(sourceText).map(
					(fragment, index) => `段落${block.blockId}#${index + 1}：${fragment}`,
				),
				`段落${block.blockId} END`,
			].join("\n");
		}
		return `段落${block.blockId}：${sourceText}`;
	}

	private blockSourceText(block: ScoreReviewBlock): string {
		if (block.kind !== "table") return block.text;
		const rows = (block.rows ?? []).map((row) => row.filter(Boolean).join(" | ")).filter(Boolean).join("\n");
		return rows ? `内容为表格<table>\n${rows}</table>` : block.text;
	}
}

export function parseScoreReviewWorkbenchDetails(value: unknown): ScoreReviewWorkbenchDetails | null {
	if (!isRecord(value) || value.schemaVersion !== "xique.score-review.workbench-details.v1") return null;
	if (!isRecord(value.state) || value.state.schemaVersion !== "xique.score-review.workbench-state.v1") return null;
	if (!isRecord(value.payload)) return null;
	return value as unknown as ScoreReviewWorkbenchDetails;
}

function sorted(values: ReadonlySet<number>): number[] {
	return [...values].sort((left, right) => left - right);
}

function preview(value: string, limit: number): string {
	const compact = value.split(/\s+/u).filter(Boolean).join(" ");
	return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function normalizeEvidenceText(value: string): string {
	return value.replace(/\s+/gu, "").trim();
}

function sourceFragments(value: string): string[] {
	const fragments: string[] = [];
	for (const cell of value.split(/[\t\r\n]+/u).map((part) => part.trim()).filter(Boolean)) {
		for (let offset = 0; offset < cell.length; offset += 600) {
			fragments.push(cell.slice(offset, offset + 600));
		}
	}
	return fragments;
}

function formatRangeList(ranges: readonly string[]): string {
	return ranges.length > 0 ? ranges.join(", ") : "(empty)";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
