import { describe, expect, it } from "vitest";
import { parseScoreReviewPacket, type ScoreReviewPacket } from "./reviewer.ts";
import { ScoreReviewWorkbench, type ScoreReviewWorkbenchMetadata } from "./workbench.ts";

function packet(reviewMode: ScoreReviewPacket["reviewMode"] = "completeness"): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode,
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "review.docx",
		sourceSha256: "a".repeat(64),
		blockCount: 4,
		initialRanges: ["段落0-段落1"],
		reviewContext: { checkerSignal: null },
		blocks: [
			block(0, "第三章 评审办法", [], [1]),
			block(1, "技术方案完整性：完整得10分，不完整不得分。", [0], [2]),
			block(2, "售后响应时限：8小时内得5分，超过8小时不得分。", [0], [3]),
			block(3, "第四章 合同条款", [], []),
		],
	});
}

function groupBoundaryPacket(): ScoreReviewPacket {
	return parseScoreReviewPacket({
		schemaVersion: "xique.score-review.packet.v1",
		reviewMode: "completeness",
		outputField: "完整评分标准编号范围",
		version: "docx-body-blocks-v2",
		sourceName: "group-boundary.docx",
		sourceSha256: "d".repeat(64),
		blockCount: 4,
		initialRanges: ["段落1-段落2"],
		reviewContext: { checkerSignal: null },
		blocks: [
			block(0, "1.响应时限：承诺在接到通知后8小时内响应", [], [1, 2]),
			block(1, "2.实施方案：方案不完整或有明显缺陷", [], [2, 3]),
			block(2, "3.培训服务方案：不提供培训服务", [], [3]),
			block(3, "第四章 合同条款", [], []),
		],
	});
}

function block(blockId: number, text: string, ancestorBlockIds: number[], nextBlockIds: number[]) {
	return {
		blockId,
		kind: "paragraph",
		text,
		structure: {
			styleId: "",
			styleName: blockId === 0 || blockId === 3 ? "标题 1" : "",
			outlineLevel: null,
			numberingId: null,
			numberingLevel: null,
			headingCandidateLevel: blockId === 0 || blockId === 3 ? 1 : null,
			headingCandidateSource: blockId === 0 || blockId === 3 ? "style_name" : "none",
			tocLevel: null,
			ancestorBlockIds,
			previousBlockIds: blockId > 0 ? [blockId - 1] : [],
			nextBlockIds,
		},
	};
}

function metadata(): ScoreReviewWorkbenchMetadata {
	return {
		packetPath: "/tmp/review-packet.json",
		packetSha256: "b".repeat(64),
		policySha256: "c".repeat(64),
		originalActiveTools: ["read", "open_score_review_workbench"],
		originalModel: { provider: "openai", id: "gpt-test" },
		workbenchModel: { provider: "pi-score-reviewer-doubao", id: "doubao-test" },
	};
}

function inspectInitialEvidence(workbench: ScoreReviewWorkbench): void {
	const map = workbench.inspectSource();
	expect(map).toEqual(expect.objectContaining({ status: "structure_map_page", complete: true }));
	expect(workbench.stage).toBe("source_read");
	const source = workbench.inspectSource();
	expect(source).toEqual(
		expect.objectContaining({ status: "source_page", complete: true, ranges: ["段落0-段落2"] }),
	);
	expect(workbench.stage).toBe("proposal");
}

function addBlockTwoDecision() {
	return [
		{
			blockId: 2,
			decision: "include_target_leaf" as const,
			sourceQuote: "售后响应时限：8小时内得5分，超过8小时不得分。",
			supportingBlockIds: [],
		},
	];
}

function repairedBlockDecisions() {
	return [
		{
			blockId: 0,
			decision: "include_local_container" as const,
			sourceQuote: "第三章 评审办法",
			supportingBlockIds: [1, 2],
		},
		{
			blockId: 1,
			decision: "include_target_leaf" as const,
			sourceQuote: "技术方案完整性：完整得10分，不完整不得分。",
			supportingBlockIds: [],
		},
		...addBlockTwoDecision(),
		{
			blockId: 3,
			decision: "exclude_non_target" as const,
			sourceQuote: "第四章 合同条款",
			supportingBlockIds: [],
		},
	];
}

describe("Pi-native score review workbench", () => {
	it("runs inspect, propose, deterministic check, targeted repair, and final adjudication", () => {
		const workbench = new ScoreReviewWorkbench(packet(), metadata());
		expect(workbench.activeToolName()).toBe("inspect_score_review_source");
		inspectInitialEvidence(workbench);

		const needsBoundary = workbench.propose({
			reason: "段落2是同一评价组中的售后响应时限评分叶子。",
			finalRanges: ["段落0-段落2"],
			blockDecisions: addBlockTwoDecision(),
			outcome: "complete",
		});
		expect(needsBoundary).toEqual(
			expect.objectContaining({ status: "needs_more_evidence", unreadRanges: ["段落3"] }),
		);
		expect(workbench.proposalCount).toBe(0);
		expect(workbench.activeToolName()).toBe("inspect_score_review_source");

		expect(workbench.inspectSource()).toEqual(
			expect.objectContaining({ status: "source_page", ranges: ["段落3"], complete: true }),
		);
		expect(workbench.activeToolName()).toBe("propose_score_review_patch");

		expect(
			workbench.propose({
				reason: "段落2是同一评价组中的售后响应时限评分叶子。",
				finalRanges: ["段落0-段落2"],
				blockDecisions: addBlockTwoDecision(),
				outcome: "complete",
			}),
		).toEqual(expect.objectContaining({ status: "initial_proposal_recorded", proposalCount: 1 }));
		expect(workbench.activeToolName()).toBe("check_score_review_patch");

		const challenge = workbench.checkProposal();
		expect(challenge).toEqual(
			expect.objectContaining({
				status: "targeted_repair_required",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "targeted_semantic_repair_required" }),
					expect.objectContaining({ code: "excluded_boundary_counterclaim", blockIds: [3, 2] }),
				]),
				requiredDecisionRanges: ["段落0-段落3"],
			}),
		);
		expect(workbench.activeToolName()).toBe("repair_score_review_patch");

		expect(
			workbench.propose({
				reason:
					"反方复核确认段落2含明确得分与不得分结果，最近 controller 仍为评审办法，段落3已切换到合同条款。",
				finalRanges: ["段落0-段落2"],
				blockDecisions: repairedBlockDecisions(),
				outcome: "complete",
			}),
		).toEqual(expect.objectContaining({ status: "repair_proposal_recorded", proposalCount: 2 }));
		expect(workbench.checkProposal()).toEqual(
			expect.objectContaining({ status: "ready_to_finalize", requiredOutcome: "complete" }),
	);

		const final = workbench.finalize({
			reason: "最终裁决保留评审标题及两个具名技术服务评分叶子，合同章节构成肯定边界。",
			outcome: "complete",
		});
		expect(final).toEqual(
			expect.objectContaining({
				status: "complete",
				result: expect.objectContaining({
					contractVersion: "score-extraction-reviewer.v2",
					finalRanges: ["段落0-段落2"],
					patch: expect.objectContaining({ missingRanges: ["段落2"], removeRanges: [] }),
					reason: expect.stringContaining("运行时聚合 delta：add=段落2; remove=(empty); final=段落0-段落2"),
				}),
			}),
		);
		expect(workbench.isFinished).toBe(true);
	});

	it("returns deterministic and semantic issues together, then blocks an incomplete repair ledger", () => {
		const workbench = new ScoreReviewWorkbench(packet(), metadata());
		inspectInitialEvidence(workbench);
		workbench.propose({
			reason: "拟补回段落2。",
			finalRanges: ["段落0-段落2"],
			blockDecisions: [],
			outcome: "complete",
		});
		workbench.inspectSource();
		workbench.propose({
			reason: "拟补回段落2。",
			finalRanges: ["段落0-段落2"],
			blockDecisions: [],
			outcome: "complete",
		});

		const firstCheck = workbench.checkProposal();
		expect(firstCheck).toEqual(
			expect.objectContaining({
				status: "targeted_repair_required",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "block_decision_ledger_coverage" }),
					expect.objectContaining({ code: "targeted_semantic_repair_required" }),
				]),
			}),
		);
		workbench.propose({
			reason: "repair 后仍未提交 checker-owned block ledger。",
			finalRanges: ["段落0-段落2"],
			blockDecisions: [],
			outcome: "complete",
		});
		const secondCheck = workbench.checkProposal();
		expect(secondCheck).toEqual(expect.objectContaining({ status: "blocked_required" }));
		expect(workbench.activeToolName()).toBe("finalize_score_review");
		expect(
			workbench.finalize({ reason: "仍尝试 complete。", outcome: "complete" }),
		).toEqual(expect.objectContaining({ status: "finalization_rejected", expectedOutcome: "blocked" }));
		expect(
			workbench.finalize({ reason: "ledger 未闭合，按硬门禁阻断发布。", outcome: "blocked" }),
		).toEqual(expect.objectContaining({ status: "blocked" }));
	});

	it("rejects a changed-block quote copied from another block", () => {
		const workbench = new ScoreReviewWorkbench(packet(), metadata());
		inspectInitialEvidence(workbench);
		workbench.propose({
			reason: "拟补回段落2。",
			finalRanges: ["段落0-段落2"],
			blockDecisions: [
				{
					...addBlockTwoDecision()[0],
					sourceQuote: "技术方案完整性：完整得10分，不完整不得分。",
				},
			],
			outcome: "complete",
		});
		workbench.inspectSource();
		workbench.propose({
			reason: "拟补回段落2。",
			finalRanges: ["段落0-段落2"],
			blockDecisions: [
				{
					...addBlockTwoDecision()[0],
					sourceQuote: "技术方案完整性：完整得10分，不完整不得分。",
				},
			],
			outcome: "complete",
		});
		const check = workbench.checkProposal();
		expect(check).toEqual(
			expect.objectContaining({
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "block_decision_quote_mismatch", blockIds: [2] }),
					expect.objectContaining({ code: "targeted_semantic_repair_required" }),
				]),
			}),
		);
	});

	it("restores an active workbench from tool-result state", () => {
		const original = new ScoreReviewWorkbench(packet(), metadata());
		inspectInitialEvidence(original);
		original.propose({
			reason: "初稿保持现有范围。",
			finalRanges: ["段落0-段落1"],
			blockDecisions: [],
			outcome: "complete",
		});
		original.checkProposal();
		const snapshot = original.snapshot();

		const restored = new ScoreReviewWorkbench(packet(), metadata(), snapshot);
		expect(restored.stage).toBe("proposal");
		expect(restored.proposalCount).toBe(1);
		expect(restored.activeToolName()).toBe("repair_score_review_patch");
		expect(restored.snapshot()).toEqual(snapshot);
	});

	it("puts an unchanged proposal boundary into the checker-owned repair ledger", () => {
		const workbench = new ScoreReviewWorkbench(groupBoundaryPacket(), metadata());
		expect(workbench.inspectSource()).toEqual(
			expect.objectContaining({ status: "structure_map_page", complete: true }),
		);
		expect(workbench.inspectSource()).toEqual(
			expect.objectContaining({ status: "source_page", complete: true, ranges: ["段落0-段落3"] }),
		);
		expect(
			workbench.propose({
				reason: "初稿保持 locator 范围。",
				finalRanges: ["段落1-段落2"],
				blockDecisions: [],
				outcome: "complete",
			}),
		).toEqual(expect.objectContaining({ status: "initial_proposal_recorded" }));
		const challenge = workbench.checkProposal();
		expect(challenge).toEqual(
			expect.objectContaining({
				status: "targeted_repair_required",
				requiredDecisionBlockIds: [0, 1, 2, 3],
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "excluded_boundary_counterclaim", blockIds: [0, 1, 2] }),
				]),
			}),
		);

		expect(
			workbench.propose({
				reason:
					"段落1已建立评价组，段落0是同编号序列中的响应承诺成员；段落3是肯定的新章节边界。",
				finalRanges: ["段落0-段落2"],
				blockDecisions: [
					{
						blockId: 0,
						decision: "include_group_member",
						sourceQuote: "1.响应时限：承诺在接到通知后8小时内响应",
						supportingBlockIds: [1, 2],
					},
					{
						blockId: 1,
						decision: "include_target_leaf",
						sourceQuote: "2.实施方案：方案不完整或有明显缺陷",
						supportingBlockIds: [],
					},
					{
						blockId: 2,
						decision: "include_target_leaf",
						sourceQuote: "3.培训服务方案：不提供培训服务",
						supportingBlockIds: [],
					},
					{
						blockId: 3,
						decision: "exclude_non_target",
						sourceQuote: "第四章 合同条款",
						supportingBlockIds: [],
					},
				],
				outcome: "complete",
			}),
		).toEqual(expect.objectContaining({ status: "repair_proposal_recorded" }));
		expect(workbench.checkProposal()).toEqual(
			expect.objectContaining({ status: "ready_to_finalize", finalRanges: ["段落0-段落2"] }),
		);
	});

	it("keeps the first Pi-native version scoped to completeness", () => {
		expect(() => new ScoreReviewWorkbench(packet("release"), metadata())).toThrow(
			"only supports completeness packets",
		);
	});

	it("forces a blocked terminal path when the Pi continuation budget is exhausted", () => {
		const workbench = new ScoreReviewWorkbench(packet(), metadata());
		workbench.forceBlockedForRuntime("agent_stalled", "The Pi agent stopped before terminal output.");
		expect(workbench.activeToolName()).toBe("finalize_score_review");
		expect(workbench.finalize({ reason: "runtime continuation budget exhausted", outcome: "complete" })).toEqual(
			expect.objectContaining({ status: "finalization_rejected", expectedOutcome: "blocked" }),
		);
		expect(workbench.finalize({ reason: "runtime continuation budget exhausted", outcome: "blocked" })).toEqual(
			expect.objectContaining({ status: "blocked" }),
		);
	});
});
