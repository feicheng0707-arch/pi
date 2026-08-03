import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { loadRequirementReviewPrompts } from "./index.ts";

const promptDirectory = new URL(
	"../../skills/word-requirement-extraction-reviewer/references/",
	import.meta.url,
);
const [prompts, challengerVNext, targetedFinalizerVNext] = await Promise.all([
	loadRequirementReviewPrompts(promptDirectory.pathname),
	readFile(new URL("challenger-vnext.md", promptDirectory), "utf8"),
	readFile(new URL("targeted-finalizer-vnext.md", promptDirectory), "utf8"),
]);

test("loads the recovery eligibility and directional Owner challenge contract", () => {
	expect(prompts.piNativeSemanticContract).toContain("`recovery eligibility gate`");
	expect(prompts.piNativeSemanticContract).toContain(
		"任一项单独或合并都不能证明 boundary independence",
	);
	expect(prompts.piNativeSemanticContract).toContain(
		"不要求先由 Word path、编号层级、物理位置或显式同级标题证明",
	);
	expect(prompts.piNativeSemanticContract).toContain(
		"即使外层附件标签、编号或 Word outline 仍继承前一 carrier",
	);

	expect(prompts.witness).toContain("两条 Owner 修复通道不得混用");
	expect(prompts.witness).toContain(
		"`owner_boundary_challenges` 只表达“provisional 错误选中了一个应由 hard root 删除的 span”",
	);
	expect(prompts.witness).toContain(
		"`anchor_block_id` 必须直接落入 `MECHANICAL_TARGET_AUTHORIZATION.remove_from_provisional`",
	);
	expect(prompts.witness).toContain("非空净删除交集");
	expect(prompts.witness).toContain(
		"必须使用 `add_to_provisional` 的 `kind=owner_boundary`",
	);
	expect(prompts.witness).toContain("若没有合法 add target，宁可省略卡");

	expect(prompts.finalizer).toContain("`recovery/claim checksum`");
	expect(prompts.finalizer).toContain(
		"若其 exit 为 EOF 或在 source order 上晚于 `R`",
	);
	expect(prompts.finalizer).toContain(
		"Witness 应以 `add_to_provisional kind=owner_boundary` 指向被误排 singleton",
	);
	expect(prompts.finalizer).toContain("`heading admission checksum`");
	expect(prompts.finalizer).toContain("`payment-tail checksum`");

	expect(prompts.productPrinciples).toContain("是累计 source-functional 证据");
	expect(prompts.productPrinciples).toContain("typed Owner span 是删除通道");
	expect(prompts.productPrinciples).toContain(
		"`add_to_provisional kind=owner_boundary` 的释放通道",
	);
});

test("keeps the v33 root-free Challenger concise and mechanically complete", () => {
	expect(Buffer.byteLength(challengerVNext, "utf8")).toBeLessThanOrEqual(
		13 * 1024,
	);
	expect(challengerVNext).toContain("# Candidate-S0 独立 Challenger v33");
	expect(challengerVNext).toContain("最多 160 字符");
	expect(challengerVNext).toContain("它是唯一业务语义源");
	expect(challengerVNext).not.toContain("## 共享语义门");
	expect(challengerVNext).not.toContain("hard_carrier_root_challenges");

	const orderedStages = [
		"**Source-first discovery**",
		"**Recovery before root inheritance**",
		"**Internal root suppression map**",
		"**Atomic closure**",
		"**Heading fixed point**",
		"**Audit-first routing**",
	].map((marker) => challengerVNext.indexOf(marker));
	expect(orderedStages.every((index) => index >= 0)).toBe(true);
	expect(orderedStages).toEqual(
		[...orderedStages].sort((left, right) => left - right),
	);

	expect(challengerVNext).toContain(
		"其 source-proven descendants 必须对 exact remove、neutral audit 和 add 完全沉默",
	);
	expect(challengerVNext).toContain("supporting IDs 不能代替 exact hole");
	expect(challengerVNext).toContain("严格子集");
	expect(challengerVNext).toContain("`recovery/root XOR checksum`");
	expect(challengerVNext).toContain("必须满足 `H∩Q=∅`");
	expect(challengerVNext).toContain(
		"顶层恰有 `remove_partitions`、`remove_audit_partitions` 与 `add_partitions` 三个 non-nullable arrays",
	);
	expect(challengerVNext).toContain("schema/transport hard cap 是 4");
	expect(challengerVNext).toContain(
		"`target_ranges` 恰有一个 singleton `段落N`",
	);
	expect(challengerVNext).toContain("必须包含 target");
	expect(challengerVNext).toContain("合计 1-4 个");
	expect(challengerVNext).toContain("协议 cap 仍是 12");
	expect(challengerVNext).toContain("提交 13-32 个会拒绝该完整 audit");
	expect(challengerVNext).toContain("容量未超限时");
	expect(challengerVNext).toContain("不截断、不挑选、不保留前 N 个");
	expect(challengerVNext).toContain('`response_format={"type":"json_object"}`');
});

test("keeps the v26 Finalizer challenge-last, root-independent, and delete-only", () => {
	expect(Buffer.byteLength(targetedFinalizerVNext, "utf8")).toBeLessThanOrEqual(
		13 * 1024,
	);
	expect(targetedFinalizerVNext).toContain(
		"# Candidate-S0 Targeted Finalizer v26",
	);
	expect(targetedFinalizerVNext).toContain("是唯一业务语义源");
	expect(targetedFinalizerVNext).not.toContain("## 共享语义门");
	expect(targetedFinalizerVNext).not.toContain("hard_root_review_groups");
	expect(targetedFinalizerVNext).not.toContain("Root challenge");
	expect(targetedFinalizerVNext).toContain("独立全 source hard-root sweep");

	const orderedStages = [
		"### 0. INDEPENDENT T0 FREEZE",
		"### 1. CHALLENGER FALSIFICATION",
		"### 2. ROOT, RECOVERY AND RESIDUAL CLOSURE",
		"### 1. AUDIT PASS",
		"### 2. GLOBAL RESIDUAL PASS",
		"### 3. HEADING FIXED-POINT PASS",
		"### 4. TOOL SERIALIZATION PASS",
	].map((marker) => targetedFinalizerVNext.indexOf(marker));
	expect(orderedStages.every((index) => index >= 0)).toBe(true);
	expect(orderedStages).toEqual(
		[...orderedStages].sort((left, right) => left - right),
	);

	expect(targetedFinalizerVNext).toContain(
		"必须是首个 source-proven 异质 peer block ID",
	);
	expect(targetedFinalizerVNext).toContain(
		"对每个 `T0` retained block 主动寻找",
	);
	expect(targetedFinalizerVNext).toContain(
		"对每个 `T0` proposed remove 主动寻找",
	);
	expect(targetedFinalizerVNext).toContain("直至 fixed-point");
	expect(targetedFinalizerVNext).toContain(
		"per-block actor reset + epilogue scan",
	);
	expect(targetedFinalizerVNext).toContain("### 4. TOOL SERIALIZATION PASS");
	expect(targetedFinalizerVNext).toContain("不是 keep ranges、最终 selection 或 Candidate 副本");
	expect(targetedFinalizerVNext).toContain("完整非空 `S0` 或任一完整 typed audit target set");
	expect(targetedFinalizerVNext).toContain("若 root/exit 不能肯定证明，则保持该范围");
	expect(targetedFinalizerVNext).toContain("`Δ-⊆S0`");
	expect(targetedFinalizerVNext).toContain("`Δ+⊆ADD_ENVELOPE");
	expect(targetedFinalizerVNext).toContain("`Δ-∩V=∅`");
});
