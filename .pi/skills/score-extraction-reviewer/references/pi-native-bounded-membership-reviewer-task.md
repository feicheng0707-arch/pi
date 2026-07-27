<V34_OPTIONAL_EXPLICIT_ACTION_REVIEW>
PASS is available only when untrustedCandidateBlockIds is empty and the full source proves there is no omitted valid target. For every non-empty candidate, submit one exact CHALLENGE hypothesis so the direction-blind judge can test it.
Otherwise submit CHALLENGE with exactly one action and one non-empty change_block_ids array. The challenge_type name is the literal Runtime action:
ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE means every listed ID is absent from the candidate and must be added.
REMOVE_ALL_NO_VALID_EVALUATOR means every candidate ID must be removed; change_block_ids must equal the complete candidate membership.
REMOVE_SEPARABLE_NON_TARGET_OR_BOUNDARY_OVERRUN means every listed candidate-present ID must be removed.
Before REMOVE_ALL, test immediate candidate edges and the complete local peer chain. If the candidate starts after an omitted peer that shares an established local negative-result or evaluation group, challenge that omitted peer with ADD instead.
Open at most one issue. The terminal schema intentionally has no evidence ledger or narrative field; submit only verdict, challenge_type, and exact change_block_ids.
</V34_OPTIONAL_EXPLICIT_ACTION_REVIEW>
