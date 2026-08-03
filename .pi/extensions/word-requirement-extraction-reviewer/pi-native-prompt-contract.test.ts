import { expect, test } from "vitest";
import { loadRequirementReviewPrompts } from "./index.ts";

const prompts = await loadRequirementReviewPrompts(
	new URL("../../skills/word-requirement-extraction-reviewer/references", import.meta.url).pathname,
);

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
