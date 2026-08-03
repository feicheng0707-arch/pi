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

test("loads the Challenger partition serialization checksum", () => {
	expect(challengerVNext).toContain("`partition serialization checksum`");
	expect(challengerVNext).toContain("只能保留 1-8 个最小充分证据");
	expect(challengerVNext).toContain("不得按 target 逐项枚举");
	expect(challengerVNext).toContain("只有 source-proven hard-root descendants");
	expect(challengerVNext).toContain("共同 verdict、宽泛上位类别");
	expect(challengerVNext).toContain(
		"`(direction, Owner 状态, controlling role/mechanism, 直接 membership/exclusion source premise)`",
	);
	expect(challengerVNext).toContain("add premise 必须直接证明存在 `ATOM|HEADING`");
	expect(challengerVNext).toContain("不能从章节摘要或宽泛类别重新生成 ranges");
	expect(challengerVNext).toContain("`root boundary serialization checksum`");
	expect(challengerVNext).toContain("仅在 exit 非 `EOF` 时覆盖 exit");
	expect(challengerVNext).toContain("不能仅因属于采购程序就自动标成 `bidder_instructions` root");
	expect(challengerVNext).toContain("boundary 证据、肯定 survivor");
	expect(challengerVNext).toContain("partition 或 range schema 上限");
	expect(challengerVNext).toContain("必须围绕 survivor 拆洞");
	expect(challengerVNext).toContain("supporting IDs 永远不能代替 exact hole");
	expect(challengerVNext).toContain("完整 audit `target_ranges` 仍必须保持不裁剪");
	expect(challengerVNext.trim().endsWith("绝不能提交 schema-invalid JSON。")).toBe(true);
});

test("loads the Finalizer delete-only serialization checksum", () => {
	expect(targetedFinalizerVNext).toContain("### 4. TOOL SERIALIZATION PASS");
	expect(targetedFinalizerVNext).toContain("不是 keep ranges、最终 selection 或 Candidate 副本");
	expect(targetedFinalizerVNext).toContain("完整非空 `S0` 或任一完整 typed audit target set");
	expect(targetedFinalizerVNext).toContain("若 root/exit 不能肯定证明，则保持该范围");
	expect(targetedFinalizerVNext.trim().endsWith("不能依赖 Harness 拒绝。")).toBe(true);
});
