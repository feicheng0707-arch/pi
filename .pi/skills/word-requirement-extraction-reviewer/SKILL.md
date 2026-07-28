---
name: word-requirement-extraction-reviewer
description: Review and minimally repair a frozen single-prompt candidate for normal single-package Word tender requirement-range extraction. Use when a complete immutable paragraph packet and upstream candidate ranges already exist, and the goal is to fix residual omissions, wrong-direction content, false nulls, or source-fidelity failures without regenerating the extraction from zero.
---

# Word Requirement Extraction Reviewer

Before running, modifying, or evaluating this capability, read `references/product-principles.md` in full. Treat any conflicting implementation or benchmark result as invalid.

## Workflow

1. Keep the upstream mature single-prompt output as the protected first judgment.
2. Build an answer-free `xique.word-requirement-review.packet.v1` packet containing the complete immutable source blocks, candidate provenance, and `initialRanges` only.
3. Call `review_word_requirement_extraction_candidate` once with the packet path.
4. Report the structured result, final ranges, added/removed ranges, provider calls, token usage, latency, hashes, and degraded state.

The capability uses one candidate-aware Doubao residual Reviewer as the primary semantic judge. A Reviewer pass or mechanically empty challenge ends after one model call. A material challenge invokes one independent Gemini Release that sees the complete source and only the mechanically bounded challenge overlay, not the Reviewer narrative, evidence leads, or history. An add-only challenge keeps every Candidate block as mandatory `BASE_KEEP` and lets Release decide only `ADD_REVIEW`. If the Reviewer proposes any effective Candidate deletion, the complete Candidate becomes a bounded recheck surface: proposed deletions are prioritized as `REMOVE_REVIEW`, all other Candidate blocks are marked `KEEP_RECHECK`, and Release may independently restore an over-deletion or remove a false protection anywhere inside Candidate. Unchallenged OUT blocks remain unavailable. The Extension only computes address sets, enforces OUT permissions, and diffs the final set against Candidate; it does not interpret the reason or make a semantic correction. The fixed cross-model second role exists to adjudicate one challenge-gated Candidate recheck, not to regenerate unrestricted source extraction, vote, or run best-of-N. There is no third call, retry, block ledger, or code-side semantic repair.

## Boundaries

- Do not parse DOCX, run the upstream candidate, or access another repository from the Extension.
- Do not provide expected answers, Production output, historical winners, evaluator labels, or case-specific hints in the packet.
- Do not reinterpret a wider same-project contract, blank response format, or reference directory as a defect unless source evidence proves a material wrong direction under the semantic contract.
- Treat provider, capacity, schema, range, or Release failure as degraded review and preserve the candidate unchanged.
- Keep engineering, goods, and services under the same semantic contract. File adapters may vary; the semantic Prompt must not branch on project, industry, template, case ID, source hash, or known answer.

## References

- Read `references/semantic-contract.md` when auditing the requirement membership definition.
- Read `references/reviewer.md` when changing the residual attack.
- Read `references/release.md` when changing the independent publication decision.

## Runtime

Reviewer uses `pi-requirement-reviewer-doubao/doubao-seed-2-0-lite-260428`. Supply credentials through `PI_REQUIREMENT_REVIEWER_API_KEY`; optionally override the endpoint with `PI_REQUIREMENT_REVIEWER_BASE_URL`.

Challenge Release uses `pi-requirement-release-gemini/gemini-3.5-flash`. Supply credentials through `PI_REQUIREMENT_RELEASE_API_KEY`; optionally override the endpoint with `PI_REQUIREMENT_RELEASE_BASE_URL`.
