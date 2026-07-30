---
name: word-requirement-extraction-reviewer
description: Review and minimally repair a frozen single-prompt candidate for normal single-package Word tender requirement-range extraction. Use when a complete immutable paragraph packet and upstream candidate ranges already exist, and the goal is to fix residual omissions, wrong-direction content, false nulls, or source-fidelity failures without regenerating the extraction from zero.
---

# Word Requirement Extraction Reviewer

Before running, modifying, or evaluating this capability, read `references/product-principles.md` in full. Treat any conflicting implementation or benchmark result as invalid.

## Workflow

1. Keep the upstream mature single-prompt output as the protected first judgment.
2. Build an answer-free `xique.word-requirement-review.packet.v1` packet containing the complete immutable source blocks, candidate provenance, and `initialRanges`. When the original DOCX is available, the packet may also contain same-source `xique.word-structure-evidence.v1` metadata produced by an atomic adapter: only high-confidence block alignment, body order, paragraph/table form, style/outline, formatting, table size, and outline ancestry.
3. Call `review_word_requirement_extraction_candidate` once with the packet path.
4. Report the structured result, final ranges, added/removed ranges, provider calls, token usage, latency, hashes, and degraded state.

The capability uses one candidate-aware Doubao residual Reviewer as the primary semantic judge. A Reviewer pass or mechanically empty challenge ends after one model call. A material challenge invokes one independent GLM Release that sees the complete source and only the mechanical overlay, not the Reviewer narrative, evidence leads, preserve expression, or history. Reviewer-proposed Candidate deletions are marked `REMOVE_REVIEW`, challenged external additions are marked `ADD_REVIEW`, and every other Candidate block is protected `BASE_KEEP`. Release may trace an over-deletion in `restored_remove_ranges` and rejects an addition by omitting it from `accepted_add_ranges`.

Its ordinary candidate-wide deletion authority is a source-proven announcement/notice, bidder/supplier-instruction, bid/response/quotation-format, or contract-terms/format veto submitted in `hard_excluded_ranges`; every approved four-carrier deletion uses that field regardless of marker. Once Release still affirms a root after its residual attack, it must project every authorized Candidate or `ADD_REVIEW` descendant through the semantic exit to `hard_excluded_ranges`; retaining a descendant requires first retracting or narrowing the root or proving an earlier different-Owner exit. If a `buyer_issued` + `present` Reviewer nevertheless proposes ordinary removal of the complete Candidate, the Harness withdraws that remove envelope before Release. All Candidate blocks start as `BASE_KEEP`. After Release submits its typed hard delta, the Harness may expose outside-carrier precision only when at least one Candidate block is hard-excluded and every remaining Candidate block forms exactly one non-empty continuous block-address run. The run may be a prefix, suffix, middle island, or the sole surviving Candidate interval after every other Candidate interval is fully hard-excluded. Two residual runs, no Candidate hard exclusion, or no remaining Candidate grants no residual authority.

Address-only transitions and this residual derivation are content-blind permissions, never Owner or keep/remove judgments. Release first writes a compact `hard_carrier_reason` hypothesis and an adversarial `residual_reason` that may correct it, then submits optional explicit restorations, authorized hard/outside exclusions, and accepted additions. The Extension deletes only explicitly authorized blocks, mechanically restores every other `REMOVE_REVIEW` block, gives accepted additions precedence over overlapping exclusions, derives `final = Candidate - authorized hard exclusions - authorized outside-carrier exclusions + accepted challenged additions`, and diffs the result; it never interprets either reason or decides Owner. There is no third call, retry, block ledger, keyword scan, or code-side semantic repair.

Before compressing a multi-block outside-carrier deletion, Reviewer and Release perform a counterexample-first duty attack over independently addressable source blocks: restore the strongest surviving post-award work-duty island, split around it, then continue only on the remaining subranges. The attack reports compact survivor ranges or none; it does not add a call or a block ledger.

The exact hard-boundary residual rule is address-only: subtract submitted Candidate hard exclusions from the complete Candidate address set. Authority exists only when the subtraction removes at least one Candidate block and leaves exactly one non-empty continuous address run; all other Candidate blocks, including every block in any other Candidate interval, must already be hard-excluded. If the complete source is an uninstantiated template, generic supply or quotation rules, drafting instructions, default duties, blank lists/tables, and pointers to absent materials cannot reopen local membership after the whole-source terminal decision.

An isolated invitation, agency, public-tender, or welcome-to-participate preamble never extends announcement Owner across a later peer procurement-content, scope, site, schedule, quality, specification, drawing, list, or technical-requirement root unless the same uninterrupted notification sequence actually continues. Outside a proven response-format or pre-award proof root, Reviewer and Release strip only response, statement, confirmation, guarantee, or commitment wrapping once. An indivisible block remains requirement when the operative remainder predicates that the offered work, service, or product itself must meet a substantive technical or result baseline, even without a separate implementation verb or project parameter and even between commercial blocks. A remainder that only names general compliance, response, no deviation, or acceptance as the object of a bidder declaration or commitment, without an independent property, action, or result of the offered work, remains a separable pre-award proof atom.

## Boundaries

- Do not parse DOCX, run the upstream candidate, or access another repository from the Extension.
- An external atomic DOCX adapter may provide optional structure evidence, but it must bind to the packet source hash and must not emit Owner, membership, keep/drop, expected-answer, or case-specific fields. Low-confidence and unmatched alignments are omitted.
- Do not provide expected answers, Production output, historical winners, evaluator labels, or case-specific hints in the packet.
- Do not reinterpret a wider same-project contract, blank response format, or reference directory as a defect unless source evidence proves a material wrong direction under the semantic contract.
- Treat provider, capacity, schema, range, or Release failure as degraded review and preserve the candidate unchanged.
- Keep engineering, goods, and services under the same semantic contract. File adapters may vary; the semantic Prompt must not branch on project, industry, template, case ID, source hash, or known answer.

## References

- Read `references/runtime-contract.md` for the compact runtime priority order shared by Reviewer and Release.
- Read `references/semantic-contract.md` when auditing the requirement membership definition.
- Read `references/reviewer.md` when changing the residual attack.
- Read `references/release.md` when changing the independent publication decision.

## Runtime

Reviewer uses `pi-requirement-reviewer-doubao/doubao-seed-2-0-lite-260428`. Supply credentials through `PI_REQUIREMENT_REVIEWER_API_KEY`; optionally override the endpoint with `PI_REQUIREMENT_REVIEWER_BASE_URL`.

Challenge Release uses `pi-requirement-release-glm/glm-5.2`. Supply credentials through `PI_REQUIREMENT_RELEASE_API_KEY`; optionally override the endpoint with `PI_REQUIREMENT_RELEASE_BASE_URL`.
