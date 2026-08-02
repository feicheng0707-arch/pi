---
name: word-requirement-extraction-reviewer
description: Review and minimally repair a frozen single-prompt candidate for normal single-package Word tender requirement-range extraction with a bounded Pi-native Finalizer/Witness loop. Use when a complete immutable paragraph packet and upstream candidate ranges already exist, and the goal is to remove residual false-positive scope or repair a false-null without regenerating the production candidate.
---

# Word Requirement Extraction Reviewer

Before running, modifying, or evaluating this capability, read `references/product-principles.md`, `references/pi-native-semantic-contract.md`, and `references/pi-native-runtime-contract.md` in full. Treat any conflicting implementation or benchmark result as invalid.

## Workflow

1. Keep the mature single-prompt output as the upstream first judgment.
2. Build an answer-free `xique.word-requirement-review.packet.v1` packet containing the complete immutable source, candidate provenance, and `initialRanges`. Optional Word structure evidence may contain only mechanically extracted, source-bound layout facts.
3. Call `review_word_requirement_extraction_candidate_pi_native` exactly once with the packet path.
4. Report final ranges, patch, degraded state, all three role calls, Token usage, latency, model identities, Prompt/input hashes, run registry, provisional decision, Witness challenges, final decision, and validator failure.

The active route is one Pi Agent loop with a fixed `GLM provisional -> Doubao 2.0 Pro Witness -> same GLM final` sequence. The first GLM tool call is provisional and returns a Harness review packet without terminating the loop. The second GLM call runs in a fresh deterministic neutral-replay provider context built from the original immutable user input plus the normalized provisional submission and Harness review packet; historical assistant/toolResult roles and tool-call IDs are not replayed. Witness independently returns one strict direct-JSON object with two required array lanes: `exclude` and `select`. `exclude` contains zero to three independent counterexample cards and `select` contains zero or one; an empty lane is `[]`. Direction is mechanically derived from the lane and is not a model field. Lane names, card count/order, and supporting-block count carry no authority, and the Witness cannot override the Finalizer. Each card contains exactly one continuous range, one premise, and 1-8 supporting focus blocks. Witness scans across source-functional partitions before reusing a card slot on the same continuous premise cluster. This bounded capacity does not change the source-quote limits, provider-call count, or Harness semantic boundary. A Witness premise should remain one compact sentence, with roughly 192 Chinese characters as an advisory target rather than a local schema limit; the hard resource bound is the single 2400-token Witness output cap. An `exclude` card requires an affirmative exclusion predicate in the target source plus self-falsification against any surviving action, state, result, or standard-applicability predicate; repetition, redundancy, coverage elsewhere, or a shorter/neater result alone cannot authorize it. The second GLM tool call is the only publishable semantic decision. Before each typed submission, Finalizer internally applies a symmetric atomic fixed point across selected ranges and excluded gaps; this adds no ledger or call. Finalizer reasons are structurally bounded to 1200 owner characters; residual reason targets 2400 characters and has an 8000-character hard maximum. Over-budget reasons fail closed and are never silently truncated.

Prompt loading and evidence presentation are role-specific. Finalizer receives the Pi-native semantic contract, runtime contract, and `finalizer.md`; Witness receives only the self-contained `witness.md` plus the current run's bounded source, structured provisional ranges/claims, and exact JSON schema. Do not forward the Finalizer's `owner_reason` or `residual_reason` to Witness: those narrative justifications anchor the independent review without granting new source evidence. Do not concatenate Finalizer publication, replay, trace, and runtime rules into the Witness system prompt: those rules are enforced by the Harness and dilute the Witness's narrow counterexample task.

Witness focus blocks are deduplicated and grouped only by provisional state plus contiguous block IDs into `exclude_scan_selected_islands` and `select_scan_excluded_islands`. Each source block and its text appear once; these groups are address navigation, not semantic labels or priorities.

Each Finalizer turn must contain exactly one valid `submit_final_selection`, which is the sole authoritative output. The Prompt still requires no prose. If a provider nevertheless emits ordinary text in the same turn, the Harness does not parse, interpret, or use it; it records only the exact concatenated text character count and SHA-256 as auxiliary trace and marks `forwarded=false`. Before the second Finalizer model context, the Harness validates the provisional tool-call/tool-result pair, then removes the historical assistant/toolResult roles, tool-call ID, and auxiliary text and appends the normalized provisional submission plus review packet to the original user input. Finalizer trace stores raw tool arguments, normalized structured submissions, and auxiliary-text metadata; it does not persist the raw Finalizer assistant message. Thinking content, an unknown or additional tool call, truncation, or invalid tool arguments still fail closed.

Final publication requires exactly two Finalizer calls and one Witness call, valid schemas and ranges, and:

```text
FINAL_SELECTION ∩ FINAL_HARD_ROOT_PROJECTION = ∅
```

After provisional submission, the Harness exposes any typed selection/claim overlap as `mechanical_contract_blockers.selection_intersects_hard_claim_ranges`. Treat it like compiler feedback: it identifies an inconsistent address intersection but does not decide whether source requires changing the selection, the claim exit, or both. The Finalizer must resolve it in the second typed submission; code never resolves it semantically.

Any provider, timeout, abort, capacity, JSON, turn-shape, schema, nonexistent source address, call-count, or final-consistency failure preserves the upstream Candidate unchanged and marks the review degraded. Empty Witness lanes must be `[]`. Missing lanes or card fields, `null`, string `"null"`, empty card objects, old `kind=none`/primary/secondary slots, direction fields, and extra fields all fail closed; there is no coercion or partial-JSON repair. Witness raw trace contains the exact assistant JSON text, while normalized Witness trace contains the parsed object only after native `JSON.parse` succeeds. Each card is independently checked against visible focus, provisional state, one contiguous focus group, and `AUDIT_UNIVERSE`; a dynamically unauthorized card is rejected trace-only with its lane and stable zero-based card index, while other valid cards may continue under `partial` coverage. If a Finalizer encodes EOF as `exit_block_id_exclusive = terminalBlockId + 1`, the Harness mechanically normalizes that one-past-end address to `null`; it does not infer that a hard root is valid or that its Owner reaches EOF, and every other nonexistent or invalid exit still fails closed. For one submitted range, the Harness may mechanically discard ordinary `OUT` spill only when the remaining addresses are non-empty and form exactly one continuous island inside the declared run; all-`OUT`, cross-run, unavailable-block, or multi-island submissions still fail closed. There is no retry, fourth call, best-of-N, voting, block ledger, keyword scan, or code-side semantic repair.

## Scope

- For a non-empty Candidate, `AUDIT_UNIVERSE` is exactly the Candidate address set. This version can repair false-positive membership and scope precision, but cannot claim arbitrary remote `OUT` omission repair.
- For an empty Candidate, `AUDIT_UNIVERSE` mechanically expands to the complete source so the Agent can repair a common-mode false-null.
- `RUN_REGISTRY` is created only from address continuity. It carries no Owner, confidence, or expected-answer signal.
- Different canonical `block_id` values are mechanically separable output atoms. Heading/body closure remains a model judgment.

## Boundaries

- Do not parse DOCX, run the upstream Candidate, or access another repository from the Extension.
- Do not provide expected answers, Production output, historical winners, evaluator labels, case-specific hints, or answer-derived structure evidence.
- Keep engineering, goods, and services under the same semantic contract. Do not branch on project, industry, template, case ID, source hash, or known answer.
- Code may provide only Pi harness adaptation and atomic mechanical tools: packet/hash validation, canonical addresses, answer-free layout, schema, context/call/Token/timeout budgets, bounded focus, set consistency, patching, and trace. It must not interpret source wording or decide Owner, membership, keep/drop, or repair direction.

## References

- Read `references/finalizer.md` for the active two-turn Finalizer role.
- Read `references/witness.md` for the active bounded adversarial Witness role.
- Read `references/pi-native-runtime-contract.md` for the active execution and failure contract.
- Read `references/pi-native-semantic-contract.md` for the active requirement-membership contract.
- Treat `references/reviewer.md`, `references/release.md`, `references/runtime-contract.md`, and `references/semantic-contract.md` as the V1 legacy overlay baseline only. Do not mix them into the Pi-native model context.

## Runtime

Finalizer uses `pi-requirement-release-glm/glm-5.2`. Supply `PI_REQUIREMENT_RELEASE_API_KEY`; optionally override `PI_REQUIREMENT_RELEASE_BASE_URL`.

Witness uses `pi-requirement-reviewer-doubao/doubao-seed-2-0-pro-260215`. Supply `PI_REQUIREMENT_REVIEWER_API_KEY`; optionally override `PI_REQUIREMENT_REVIEWER_BASE_URL`.

`Content-Type: application/json` serializes the Doubao request body. Witness runs with `tools=[]`; the provider payload removes tools, tool choice, parallel tool calls, and reasoning effort, sets thinking disabled, and uses `response_format: {"type":"json_object"}`. The exact `PiNativeSemanticWitnessSchema` remains in the Witness Prompt and is enforced locally after native `JSON.parse` with TypeBox plus per-card cross-field validation. Provider JSON mode is transport assistance, not semantic authority or a replacement for the local contract. The one-call hard limit and 2400-token output cap remain unchanged.
