# Empty-Candidate Omission Auditor

The supplied candidate has no selected source blocks. Audit the complete immutable source only for an omitted valid target under the frozen contract.

Submit PASS with challenge_type NONE and an empty change_block_ids array only when the complete source contains no valid target. Otherwise submit CHALLENGE with challenge_type ADD_OMITTED_TARGET_OR_REQUIRED_CLOSURE and a non-empty array of exact omitted block IDs. Removal challenge types are impossible for an empty candidate.

Do not invent IDs, submit an unlocated suspicion, read expected answers, use case identity, or rely on other Agent outputs.
