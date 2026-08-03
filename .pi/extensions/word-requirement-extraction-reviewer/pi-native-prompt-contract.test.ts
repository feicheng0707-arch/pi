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

test("keeps the v24 Challenger concise and mechanically complete", () => {
	expect(Buffer.byteLength(challengerVNext, "utf8")).toBeLessThanOrEqual(
		13 * 1024,
	);
	expect(challengerVNext).toContain("# Candidate-S0 独立 Challenger v24");
	expect(challengerVNext).toContain("它是唯一业务语义源");
	expect(challengerVNext).not.toContain("## 共享语义门");

	const orderedStages = [
		"**Source-first discovery**",
		"**Recovery before root inheritance**",
		"**Root map**",
		"**Atomic closure**",
		"**Heading fixed point**",
		"**Audit routing**",
	].map((marker) => challengerVNext.indexOf(marker));
	expect(orderedStages.every((index) => index >= 0)).toBe(true);
	expect(orderedStages).toEqual(
		[...orderedStages].sort((left, right) => left - right),
	);

	expect(challengerVNext).toContain(
		"`exit_block_id_exclusive` 是 first peer 或 `\"EOF\"`",
	);
	expect(challengerVNext).toContain(
		"`projected_s0_anchor_block_id` 必须取自本项 `I`",
	);
	expect(challengerVNext).toContain(
		"其 source-proven descendants 必须对 exact remove、neutral audit 和 add 完全沉默",
	);
	expect(challengerVNext).toContain("supporting IDs不能代替 exact hole");
	expect(challengerVNext).toContain("严格子集");
	expect(challengerVNext).toContain("`recovery/root XOR checksum`");
	expect(challengerVNext).toContain("必须满足 `H∩Q=∅`");
	expect(challengerVNext).toContain("再重新计算 `I=S0∩H`");
	expect(challengerVNext).toContain(
		"提交 `exit_block_id_exclusive=P`，绝不能提交 `L`",
	);
	expect(challengerVNext).toContain("同时含两个不同地址 `L` 与 `P`");
	expect(challengerVNext).toContain(
		"绝不能同时提交相互重叠的两项让 Finalizer替你选择",
	);
	expect(challengerVNext).toContain(
		"顶层恰有 `hard_carrier_root_challenges`、`remove_partitions`、`remove_audit_partitions` 与 `add_partitions` 四个 non-nullable arrays",
	);
	expect(challengerVNext).toContain('`response_format={"type":"json_object"}`');
});

test("keeps the v23 Finalizer challenge-last and delete-only", () => {
	expect(Buffer.byteLength(targetedFinalizerVNext, "utf8")).toBeLessThanOrEqual(
		13 * 1024,
	);
	expect(targetedFinalizerVNext).toContain(
		"# Candidate-S0 Targeted Finalizer v23",
	);
	expect(targetedFinalizerVNext).toContain("是唯一业务语义源");
	expect(targetedFinalizerVNext).not.toContain("## 共享语义门");

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
