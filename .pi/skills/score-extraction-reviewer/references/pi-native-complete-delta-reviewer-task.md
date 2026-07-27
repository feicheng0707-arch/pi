<ORTHOGONAL_COMPLETE_DELTA_REVIEW>
First reconstruct the exact minimal complete answer from source. Then compare it with untrustedCandidateBlockIds.

If untrustedCandidateBlockIds is empty and the reconstructed answer is also empty, submit verdict=PASS, challenge_type=NONE, and change_block_ids=[]. Otherwise submit verdict=CHALLENGE. For a non-empty candidate, CHALLENGE is mandatory: construct the strongest complete source-grounded alternate answer rather than confirming the candidate.

Choose one attack coordinate before listing IDs:

- EDGE_OR_LOCAL_GROUP_COMPLETION: the alternate repairs one or more candidate edges or completes an interrupted local group.
- REMOVE_ALL_NO_VALID_EVALUATOR: the complete candidate lacks a valid evaluation relation after the edge and local-group test.
- REMOVE_SEPARABLE_NON_TARGET_OR_BOUNDARY_OVERRUN: the alternate removes separable internal or trailing pollution while retaining some candidate target.
- ADD_REMOTE_OMITTED_TARGET_OR_REQUIRED_CLOSURE: the alternate adds only remote omitted target or closure after candidate precision is already correct.
- MIXED_COMPLETE_DELTA: the one alternate answer requires both additions and removals, or combines local/remote corrections.

The type is a reasoning coordinate only. Runtime derives actual add/remove direction from candidate membership and never treats the label as semantic authority.

Before choosing REMOVE_ALL_NO_VALID_EVALUATOR, perform this mandatory local-group veto: inspect both immediate candidate edges and the uninterrupted peer list. If at least two candidate or edge peers contain direct negative, graded, comparative, pass/fail, rejection, deduction, or qualitative results, a local evaluation group exists. REMOVE_ALL is then forbidden. If the candidate begins after a leading peer in that group, use EDGE_OR_LOCAL_GROUP_COMPLETION, add the omitted leading peer, and retain all existing group members unless an affirmative new boundary proves otherwise. In that situation change_block_ids contains only the omitted candidate-absent peer IDs; never repeat candidate-present IDs that the alternate retains.

List the complete symmetric difference between that alternate answer and the candidate: every candidate-absent ID that the proposal adds and every candidate-present ID that it removes. Runtime derives direction mechanically from membership.

The array may mix additions and removals and may contain up to 512 IDs. It must describe the whole corrected answer, not one issue, one edge, or one convenient subset. Submit only the terminal fields; no narrative or evidence ledger.

For a non-empty candidate, every candidate-absent change_block_id must be inside candidateAbsentAdditionEnvelopeRanges. Candidate-present removals remain unrestricted. Runtime mechanically ignores and traces out-of-envelope additions.
</ORTHOGONAL_COMPLETE_DELTA_REVIEW>
