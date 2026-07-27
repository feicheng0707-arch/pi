---
name: score-extraction-reviewer
description: Review normal single-package Word score-extraction candidate ranges with isolated Pi capabilities. Use when a benchmark, replay, or caller provides an xique.score-review.packet.v1 completeness JSON packet and needs the atomic-removal v53, bounded-membership v51, strict adversarial-debate v19 or preserved v18 experiment, untrusted-candidate Pi-native targeted-repair v9 route, preserved source-blind v8, candidate-aware v7, or independent-proposal v6.3 routes, the xq-parity baseline, the Owner/Boundary v5 baseline, the bounded dual-review route, or the deterministic coarse-scope graph. Use v1 or the main-session workbench only when explicitly requested as baselines.
---

# Score Extraction Reviewer

## Mandatory product principles

Before running, modifying, or evaluating this capability, read `references/product-principles.md` in full. It defines the core objective, evaluation standard, and non-negotiable constraints for semantic ownership, blind evaluation, and quality claims. If a prompt, Extension path, benchmark harness, or local instruction conflicts with it, treat the run as invalid instead of working around the principle.

Use the isolated xq-parity capability for normal single-package Word `completeness` review.

## Run the capability

1. Obtain the path to an immutable `xique.score-review.packet.v1` JSON packet.
2. Require `reviewMode: completeness`; this packet is the accepted Locator boundary.
3. Call `review_score_extraction_ranges_xq_parity` exactly once with `packetPath`.
4. Report status, final ranges, aggregate patch delta, Checker status, Owner/Boundary decisions, budget usage, and final reason.

Do not load the packet source into the main conversation, manually replay worker prompts, switch models, edit the packet, or repair a failed result outside the capability. Preserve provider, contract, timeout, and budget failures as failures.

The Extension runs fresh Pi loops for Completeness and Release. Release invokes fresh Owner and Boundary loops as tools; each Gate closes only through one schema-validated terminal tool, never free-form JSON parsing. Boundary treats the parent proposal as a hypothesis, restores any deletion without an affirmative source boundary, and submits compact exact quote atoms instead of copying whole tables. A pass may receive one completion nudge per changed tool contract, with a hard total cap of three, so a transport/tool miss in map, source-read, or decision does not consume recovery for every later stage. The frozen Production Checker is a separate call; only a deterministic JSON-contract failure permits one fresh same-model protocol retry, without semantic repair or fallback. Code owns stage order, schemas, source/range validation, one deterministic set patch, budgets, timeouts, prompt hashes, and trace. LLMs own every semantic keep/drop, Owner, and Boundary judgment.

## Experimental Pi-native bounded-membership v51 route

Use `review_score_extraction_ranges_pi_native_bounded_membership_v51` only for the frozen v51 experiment.

The Doubao 2.0 Lite Reviewer receives the complete immutable source and frozen candidate, then opens one exact addition or removal challenge. An empty candidate uses a separate omission-only contract and may pass after one call. Runtime mechanically forms unlabeled Set A and Set B; the Doubao 2.0 Pro Primary sees neither provenance nor Reviewer narrative and returns only the final retained subset of the exact difference. Common IDs stay locked, so a broad challenge may be partially accepted without creating a third free answer.

When an exact difference contains an oversized atomic block, one optional Pro Planner chooses bounded literal target and boundary queries. Code performs only NFKC, case, punctuation, and whitespace-insensitive literal search with source offsets; the excerpts are attention evidence, not a semantic verdict. The path has one, two, or at most three calls, no retry, Release, vote, best-of-N, ledger, or fourth call. Any failure preserves candidate with explicit degraded status.

Read `references/pi-native-bounded-membership-agent.md`, the corresponding `*-reviewer.md`, `*-empty-reviewer.md`, `*-primary.md`, and `*-inspection-planner.md` role files, plus each adjacent `*-task.md` user-contract slice. The accepted single-prompt contract remains frozen in `references/accepted-score-candidate-v019.txt`. v51 is not the default and its gate10 result is development regression evidence only.

## Experimental Pi-native atomic-removal v53 route

Use `review_score_extraction_ranges_pi_native_atomic_removal_v53` only for the frozen v53 experiment.

v53 preserves the v51 complete-source Lite Reviewer and bounded two-stage shape. It adds two purely structural mode-specific second calls. When a removal envelope contains exactly one candidate-present indivisible block whose source text crosses the frozen oversized-block threshold, the second call is a specialized Pro Atomic Removal Verifier instead of the literal Planner plus general Primary. Other short removals bundled into that envelope remain mechanically locked to candidate because they lack an independent second authorization.

When the Reviewer proposes exactly one non-oversized candidate-absent block immediately adjacent to a candidate interval, the second call is a Single Immediate-Edge Addition Judge. It compares only the clipped candidate with candidate-plus-edge and focuses the Pro model on shared local evaluators, bidirectional peer-effect inheritance, necessary closure, and affirmative Owner/lifecycle/controller boundaries. Code selects this Prompt only from membership, adjacency and size; it never decides whether the edge is semantically in the group.

The Verifier must scan that physical block to the end and choose exactly `RETAIN_ATOMIC_BLOCK` or `AUTHORIZE_REMOVAL`, with one constant-size distinctive source literal query. Code validates only route membership, block size, a unique normalized literal match, canonical exact quote offsets, budget and trace; it never interprets the query or quote. Retain preserves candidate, authorize applies the exact one-block removal. Invalid or ambiguous query, schema/provider/capacity failure or any incomplete result fails closed to candidate preservation.

Read `references/pi-native-atomic-removal-agent.md`, `references/pi-native-atomic-removal-verifier.md`, `references/pi-native-atomic-removal-verifier-task.md`, `references/pi-native-edge-addition-primary.md`, and `references/pi-native-edge-addition-primary-task.md`, plus the inherited v51 Reviewer, empty-candidate, Primary and Planner contracts. Both specialized paths use exactly two calls; ordinary v53 paths retain the v51 one/two/three-call envelope. There is no ledger, retry, vote, best-of-N, Release or fourth call. v53 is a development experiment and cannot replace xq-parity before protected regression and a new sealed holdout pass.

## Experimental Pi-native adversarial-debate release v18 route

Use `review_score_extraction_ranges_pi_native_adversarial_debate_release` to test whether a final judge benefits from seeing the complete bounded debate instead of another isolated vote.

Calls 1 and 2 are byte-identical to v13: one forced residual challenge followed by one claim-blind Primary subset decision. Only when Primary changes candidate does Call 3 run. It receives the complete Reviewer envelope, the untrusted Reviewer attack, Primary approvals/rejections and untrusted response, plus the same full source. It may approve any subset of the Reviewer envelope but cannot add a new issue or touch unchallenged blocks.

The final role must judge source membership rather than the quality of the authored scoring rule. Defects, empty values, contradictions or negative results inside an evaluation rule do not make that source non-target; supplier drafting actions and ideal attributes do not become evaluation effects without an independent evaluator relation. Reviewer and Primary prose are adversarial arguments only, never source evidence.

v18 keeps the same two-or-three-call envelope as v13/v14, has no retry, ledger, fourth call, best-of-N or code-side semantic decision, and fails closed to candidate preservation. It is an experiment, not the default capability.

## Experimental Pi-native strict adversarial-debate v19 route

Use `review_score_extraction_ranges_pi_native_strict_adversarial_debate_release` to test the v18 follow-up that removes direction recovery and closes one bounded recall ceiling.

The Reviewer receives both candidate ranges and the exact candidate block IDs. Additions must be candidate-absent and removals candidate-present; an invalid direction fails closed after one call instead of being mechanically reinterpreted. The semantic task is range membership, not whether the authored scoring rule is internally complete, reasonable or defect-free.

Call 3 normally remains conditional on a Primary override. One additional purely structural case may invoke it: the Reviewer challenges removal of the entire non-empty candidate and Primary rejects the whole challenge. The Release then reads the complete attack, response and source, but remains confined to the Reviewer envelope. Ordinary Primary preservation still stops at two calls.

v19 has no retry, ledger, fourth call, semantic code route or answer-aware trigger. It is an experiment, not the default capability.

## Experimental Pi-native targeted-repair v9 route

Use `review_score_extraction_ranges_pi_native_targeted_repair` when testing the current residual-repair hypothesis.

Read `references/pi-native-targeted-repair-agent.md`, `references/pi-native-targeted-repair-reviewer.md`, and `references/pi-native-targeted-repair-finalizer.md`. The accepted Prompt remains frozen in `references/accepted-score-candidate-v019.txt`; its output is the protected product candidate and its hash remains capability provenance, but neither the Prompt text nor accepted identity enters either worker.

Call 1 sees candidate as an untrusted external patch and the complete v4 source representation without Runtime-inferred `Q` sequence facts. It submits one complete `proposal_ranges` only to define a bounded challenge envelope: Set B only blocks are possible additions and Set A only blocks are possible removals. Because envelope is a falsification hypothesis rather than a verdict, Call 1 must open at least one exact changed block; a same-set submission fails closed after one call and preserves candidate with degraded status.

When a material envelope exists, Call 2 receives candidate, envelope, exact mechanical differences, and complete source, but not Reviewer claim/evidence leads. It may publish candidate, the whole envelope, or a partial repair inside the envelope. Blocks common to candidate and envelope are mechanically locked; Finalizer cannot add or remove anything outside the Reviewer-opened dispute.

The candidate therefore changes only after one role opens the exact changed-block envelope and the independent Finalizer publishes the repaired set. Provider/schema/context/budget failure and Finalizer degradation preserve candidate with explicit degraded status. There is no Primary regeneration, hidden retry, third call, ledger, keyword router, code-side semantic challenge, or offline semantic repair.

v9 is not the default until its frozen known-issue, protected-regression, and sealed-holdout gates pass. Keep xq-parity as the default.

## Preserved Pi-native source-blind residual v8 baseline

Use `review_score_extraction_ranges_pi_native_blind_residual` only to reproduce the failed source-blind full-proposal experiment.

Read `references/pi-native-blind-residual-agent.md`, `references/pi-native-blind-residual-challenger.md`, and `references/pi-native-blind-residual-adjudicator.md`. The accepted Prompt remains frozen in `references/accepted-score-candidate-v019.txt`; its output is the protected first judgment and its hash remains capability provenance, but neither its text nor candidate ranges enter Call 1.

Call 1 receives only the complete immutable source, candidate-neutral mechanical facts, and the independent strict semantic contract. Its v4 context omits Runtime-inferred `Q` sequence facts. It submits exactly one complete proposal. Runtime mechanically compares normalized block sets; a different proposal invokes one binary Adjudicator with candidate, proposal, exact added/removed IDs, and complete source. Challenger claim and evidence leads are withheld from Call 2.

The candidate changes only through this two-key override. Same-set review uses one call; different-set review uses exactly two. Provider/schema/context/budget failure and Adjudicator degradation preserve candidate with explicit degraded status. There is no Primary regeneration, hidden retry, third answer, ledger, keyword router, code-side semantic challenge, or offline semantic repair.

v8 produced no `wrong→correct` result on its frozen risk4 development gate and is preserved only as a named failed baseline. Keep v7/v6.3 as additional failed baselines; do not combine prompts, context formats, artifacts, or capability hashes across routes.

## Preserved Pi-native residual-challenge v7 baseline

Use `review_score_extraction_ranges_pi_native_residual` when testing whether an asymmetric residual audit can repair the frozen single-prompt candidate without repeating its container-first common mode.

Read `references/pi-native-residual-agent.md`, `references/pi-native-residual-challenger.md`, and `references/pi-native-residual-adjudicator.md`. The accepted Prompt remains frozen in `references/accepted-score-candidate-v019.txt`; its output is the protected first judgment and its hash remains capability provenance, but its legacy input/output interface and broad container-first wording are not injected into either v7 worker.

Call 1 is candidate-aware and receives candidate plus the complete candidate-neutral source representation. It submits exactly one complete proposal: the identical candidate when no material residual defect is proven, or one exact replacement when it proves a material omission or contamination. Runtime only compares normalized block sets and computes exact added/removed IDs. A different proposal invokes one binary Adjudicator, which may only accept candidate, accept the exact proposal, or degrade.

The candidate changes only through this two-key override. Same-set review uses one call; different-set review uses exactly two. Provider/schema/context/budget failure and Adjudicator degradation preserve candidate with explicit degraded status. There is no Primary regeneration, hidden retry, third answer, ledger, keyword router, code-side semantic challenge, or offline semantic repair.

v7 failed its frozen risk gate and is preserved only for comparison. v6.3 remains a second named failed baseline; do not combine artifacts or capability hashes across routes.

## Experimental Pi-native independent-proposal review v6.3 route

Use `review_score_extraction_ranges_pi_native` only to reproduce the preserved candidate-blind v6.3 baseline.

Read `references/pi-native-agent.md`, `references/pi-native-challenger.md`, and `references/pi-native-adjudicator.md` for the complete route contract. The exact accepted `score_candidate_v019` Prompt remains frozen in `references/accepted-score-candidate-v019.txt` and is the shared semantic contract for both roles. This same-contract design failed its formal risk6 gate and is not the current quality candidate.

`initialRanges` is the first semantic judgment and protected product output, but it is private from Call 1. One candidate-blind Independent Reviewer receives the complete source plus candidate-neutral mechanical topology and must return exactly one complete `proposal`. The proposal contains `proposal_ranges`, one short `proposal_claim`, and a small non-empty set of numeric source `evidence_block_ids`; it has no semantic degraded branch. Runtime mechanically compares its block set with candidate and computes the exact added/removed delta. A different contract-valid proposal invokes one Proposal Adjudicator. It may return only `accept_candidate`, `accept_proposal`, or `degraded`; it cannot emit ranges or create a third answer.

If the independent proposal normalizes to the same block set as candidate, Runtime records `reviewerSameProposalNormalized`, records `proposal_matches_candidate` as the Adjudicator skip reason, and publishes candidate after one call. This is pure set-equivalence normalization, not a semantic repair or a second-call trigger.

The candidate changes only when the Independent Reviewer submits a different exact proposal and the Adjudicator accepts that proposal. Reviewer provider/schema/context/budget failure, Adjudicator `degraded` or failure, invalid IDs, or any other incomplete review publishes the unchanged candidate with `status: degraded` and `reviewDegraded: true`; this fallback is candidate protection, not evidence that review succeeded.

The same-proposal path adds exactly one model call and a different-proposal path exactly two. Both roles see the same candidate-neutral full-source evidence; only the Adjudicator additionally sees candidate, proposal and Runtime-computed exact delta. There is no Primary regeneration, Owner pre-gate, pagination/search loop, semantic keyword probe, per-block ledger, hidden retry, third call, or code-side keep/drop. Code owns only prompt composition, immutable packet/SHA, context preflight, canonical address mapping, neutral topology, schema, strict ranges, mechanical set comparison/delta, budgets and trace. Exact role-input hashes enter the result. Until the frozen A/B and sealed-holdout gates are accepted, keep the xq-parity capability as the default.

Reviewer input must be byte-identical for identical source packets even when `initialRanges` differs. It must not contain candidate ranges, C/N membership markers, candidate audit, source name, review context, expected fields, historical outputs, or evaluator data.

## Preserved Pi-native Owner/Boundary v5 baseline

Use `review_score_extraction_ranges_pi_native_owner_boundary` only when the preserved v5 experiment or a direct comparison is explicitly requested.

Read `references/pi-native-owner-boundary-agent.md`, `references/pi-native-owner-gate.md`, `references/pi-native-boundary-gate.md`, and `references/pi-native-owner-none-boundary-gate.md` for that frozen route. Its candidate-blind Owner followed by Boundary topology is not the v6.3 product path and must not leak into the v6.3 Reviewer or Adjudicator contract.

## Experimental dual-review route

Use `review_score_extraction_ranges_dual_review` only when the user requests the low-cost v3 experiment or an A/B against the baseline.

The Extension constructs one frozen compact full-source context, preserving large atomic blocks as readable `段落N#K` fragments. A fresh Finalizer makes the main judgment. A fresh Challenger receives the Finalizer proposal plus a deterministic targeted slice containing Locator/Finalizer ranges, headings, score and pass/fail probes, cross-chapter references, and precision-risk tails. Every retained continuous range must carry one exact direct-leaf scope witness; this is range-level proof, not a per-block ledger. Clean agreement publishes after exactly two model calls. A material disagreement may use one third call over only `disputed_ranges` and their local boundary evidence. There is no fourth call. If the disagreement remains unresolved, the result is `needs_review` with `finalRanges: null`.

Code only builds and indexes context, validates immutable hashes, strict ranges, exact quotes, disagreement scope, and hard call/token limits. It does not decide score semantics. Until the A/B gate is accepted, keep `review_score_extraction_ranges_xq_parity` as the default capability.

## Experimental scope-graph route

The current frozen v90 scope-graph implementation adds a destructive-precision terminal review for Owner disputes. The final role receives bounded proposal source plus both roles' short adversarial arguments, tests the nearest controller and evaluator effect before specificity, and may only select a read-only proposal or apply a bounded unit patch. Units carrying the chosen proposal's typed Owner addresses are mechanically protected from deletion. v90 achieved 29/29 exact block-set matches on the frozen known29 development/regression denominator with Doubao 2.0 Lite, zero retries, zero `needs_review`, and at most three calls per case. This is development evidence, not sealed-holdout generalization evidence.

Use `review_score_extraction_ranges_scope_graph` only when the user requests the v5 coarse-scope experiment or its A/B gate.

The Extension deterministically uses controllers and numbering to segment selectable base units, then adds overlapping structural closures for direct table prefixes, same-label notes, bounded consecutive numbered table tails, numbered parent-to-table spans, sequence groups, cross-reference bridges, and bounded bridge-to-sequence spans with structurally attached local tails. This is analogous to an AST: parent controllers define boundaries but are not themselves a license to retain every descendant. Code exposes possible structural closures but never decides whether a unit is a target score scope. It also exposes crossing `base_scope` / `table_scope` topology as overlap, base-only, table-only, and union ranges; the LLM alone decides whether both units are one authored score representation. The final repair schema only enforces a structurally coherent expression of that decision: select both pair IDs for an authored union, or omit the crossing base and use narrower units for a boundary cut. Finalizer makes the main unit judgment. The general Challenger receives only the Finalizer's selected unit IDs and expanded blocks, not its Owner claim, quotes, or rationale. It treats that visible patch as untrusted, audits topology-driven uncovered structural units for shared omissions, then attacks selected units for precision before submitting its own complete unit set. For partial-sequence adjudication it also does not receive Finalizer's proposed boundary labels, preventing author-claim anchoring while preserving the visible patch and omitted-member audit. Each submission carries one constant-size Owner claim whose `owner_basis` discriminates the required and forbidden controller, target, effect, and repeated-result addresses. Runtime validates address existence, basis consistency, and selected-unit containment without inferring semantics, then compares both expanded block unions and the typed Owner semantic signature: basis, controller role, lifecycle, evaluated object, and evaluation effect. Clean agreement takes two calls only when both agree; identical blocks with conflicting Owner semantics enter the same bounded third-call repair. Exact quotes are optional trace leads: source-anchored fragments are retained and unanchored prose is discarded, while the typed block addresses remain mandatory for a positive Owner claim. One material disagreement may use one targeted third call over disputed units. There is no fourth call, no arbitrary model-authored range, and no per-block ledger. A fully reviewed no-target document may publish the empty set; an unknown unit or invalid typed address fails closed as `needs_review` with the completed prior-stage trace and is not retried or silently accepted.

The v5 contract keeps the normal clean path at two calls and one material non-sequence disagreement at three. Four constant-size common-mode risks may also use the third call: distributed paragraph-only `explicit_evaluator + qualitative_result`, a selected base crossing into an unselected adjacent table, a continuous Locator interval whose leading evaluation controller chain was jointly omitted even though at least one independent role still cites it as positive evidence, or an atomic explicit-evaluator agreement that leaves a graph-exposed split cross-reference bridge closure unselected. The last risk only opens a bounded structural patch over that split closure; the LLM still decides from source whether to add it. The final audit rechecks only the bounded Owner or boundary claim; code opens the dispute but never decides the semantic answer. Atomic score tables with no such topology risk and ordinary score/deduction agreements remain two-call paths. A terminal-tool or strict-schema miss may receive at most one same-model protocol-only correction inside the same hard three-call budget, and only when at least one later provider call remains after that correction; the correction preserves the failed assistant/tool-result transcript and disables thinking so it only repairs the terminal schema. If Finalizer uses the first two calls for its semantic turn and protocol-only correction, the sole remaining call is folded into a terminal adversarial adjudicator instead of a dispute-only Challenger. It receives the complete source when it fits the frozen context cap, independently submits the exact minimal complete unit union, and its contract-valid semantic result publishes directly without a fourth repair. Runtime only chooses this route and validates the submitted structure; it does not decide which units are semantically correct. A last available call never attempts a fourth-call correction and fails closed with its completed trace if its terminal contract is invalid. Terminal reasons and exact quotes are schema-bounded to prevent a structured decision from exhausting its output budget. A contract-valid semantic verdict is never rerun. Every semantic role uses the same frozen Doubao 2.0 Lite model. Finalizer and Challenger keep thinking enabled on their semantic turns, including destructive patch review; protocol-only correction alone disables thinking. When a proposal is a strict subset of an inferred numbered sequence, the second call normally loads `references/scope-graph-sequence-challenger.md` as a Partial-Sequence Adjudicator. If Finalizer already used a protocol-only correction, the sole remaining call goes directly to `references/scope-graph-sequence-repair.md`; runtime converts that final verifier result into the Challenger trace without making a semantic code judgment. Otherwise, if the second judgment restores the complete sequence, it publishes in two calls; if it still publishes a strict subset, the remaining third call uses the same Boundary Verifier to test only the asserted positive boundary. This is claim verification, not best-of-N voting. Runtime locks every candidate-retained block, so the verifier can only restore omitted audited-sequence members and cannot create a new deletion. If a non-sequence proposal later creates a partial-sequence dispute, the same third-call sequence repair remains the Lite fail-closed fallback. These prompt slices check group inheritance and typed positive boundary roles without a block ledger. Missing or mismatched sequence-boundary proof cannot be rewritten into agreement with Finalizer. Increasing-number inference also preserves marker families, so a parenthesized child list cannot absorb a following peer `N、` controller.

When the two contract-valid judgments form an exact empty-versus-nonempty Owner dispute and no partial sequence, crossing pair, split closure, or protocol failure is involved, the third call becomes a binary Owner Stop-Gate adjudicator. The same schema handles a `distributed_qualitative_explicit_evaluator` common-mode audit after both roles agree on the exact same positive proposal: runtime adds only a neutral empty-set alternative, without deciding which is correct. The adjudicator receives only the positive Owner addresses, both sides' short quotes, and local ancestors/neighbors; it checks controller, evaluator effect, then specificity, and chooses one read-only proposal. Runtime reuses that proposal exactly and never asks the model to reconstruct the large range.

Prefer a closed `table_scope` over stripping its direct title or linked local note, except that removable attachment numbers, directories, and page wrappers are not semantic titles; use exposed base units for the minimal title-plus-table closure. Use `parent_table_scope` only when the model determines that a numbered method/preamble and the later score table jointly define one scoring unit. A new peer controller after the table remains independently selectable, so deterministic grouping does not force semantic retention.

Treat `bridge_sequence_scope` as a candidate for a distributed pass/fail chain, not as evidence that the chain is a target. Select it only when the source proves that its bridge, direct numbered parent, intervening scopes, numbered consequence sequence, and local conclusion jointly define the same technical/service evaluation. Otherwise select smaller units or omit it.

## Packet boundary

Require:

- `schemaVersion`: `xique.score-review.packet.v1`
- `reviewMode`: `completeness`
- `version`: `docx-body-blocks-v2`
- immutable `sourceName`, `sourceSha256`, `initialRanges`, and ordered `blocks`
- explicit `locatorContext` with Locator mode, `ranges|null` outcome, complete-source coverage, and window count
- every block carries `textMarkerKind`, `textMarkerToken`, `sequenceGroupStartBlockId`, `candidateParentBlockId`, and `candidateAncestorBlockIds`
- strict ranges in the form `段落N` or `段落N-段落M`

For the xq-parity baseline, when `locatorContext` records a complete `windowed_accepted_prompt` null result, return `windowed_locator_null` without starting candidate-relative Reviewer, Checker, Release, Owner, or Boundary calls. The Pi-native residual-review route intentionally does not inherit that shortcut: an empty candidate still receives full-source adversarial review. In add-only Completeness, an attempted terminal decision cannot truncate an already represented structural sequence before its last selected member; read the unresolved members and include them in the candidate unless source evidence requires `blocked`.

Treat the packet as the only interchange boundary. Do not load code, credentials, configuration, or runtime state from another repository.

## Runtime boundary

Use `pi-score-reviewer-doubao/doubao-seed-2-0-lite-260428` for the v53/v51 Reviewer, all v19 and v18 roles, both Pi-native v9 roles, both v8 roles, both v7 roles, both v6.3 roles, both preserved Owner/Boundary v5 roles, and every scope-graph semantic role. Use `pi-score-reviewer-doubao/doubao-seed-2-0-pro-260215` for the v53 Atomic Removal Verifier and ordinary bounded Primary/optional Planner, and for the v51 Primary and optional literal-inspection Planner. The xq-parity route continues to use `pi-score-reviewer-doubao/doubao-seed-1-6-251015` only for its frozen legacy Production Checker. Supply credentials through `PI_SCORE_REVIEWER_API_KEY`; optionally override the endpoint with `PI_SCORE_REVIEWER_BASE_URL`. Freeze the model and do not add fallback models for A/B runs.

This version does not parse DOCX, run the upstream Locator, publish service artifacts, or integrate with external endpoints. It consumes an existing block packet and returns the reviewed range contract.

## Explicit baselines

- For the Pi-native targeted-repair v9 experiment, call `review_score_extraction_ranges_pi_native_targeted_repair` once.
- For the Pi-native atomic-removal v53 experiment, call `review_score_extraction_ranges_pi_native_atomic_removal_v53` once.
- For the Pi-native bounded-membership v51 experiment, call `review_score_extraction_ranges_pi_native_bounded_membership_v51` once.
- For the Pi-native adversarial-debate release v18 experiment, call `review_score_extraction_ranges_pi_native_adversarial_debate_release` once.
- For the Pi-native strict adversarial-debate release v19 experiment, call `review_score_extraction_ranges_pi_native_strict_adversarial_debate_release` once.
- For the Pi-native source-blind residual v8 experiment, call `review_score_extraction_ranges_pi_native_blind_residual` once.
- For the Pi-native residual-challenge v7 experiment, call `review_score_extraction_ranges_pi_native_residual` once.
- For the Pi-native independent-proposal review v6.3 experiment, call `review_score_extraction_ranges_pi_native` once.
- For the preserved Owner/Boundary v5 baseline, call `review_score_extraction_ranges_pi_native_owner_boundary` once.
- For the v3 dual-review experiment, call `review_score_extraction_ranges_dual_review` once.
- For the v5 deterministic scope-graph experiment, call `review_score_extraction_ranges_scope_graph` once.
- For the v1 opaque baseline, call `review_score_extraction_ranges` once.
- For the v2 main-session experiment, call `open_score_review_workbench` and follow its active tools.

Do not use an experimental or preserved baseline route as the default path.
