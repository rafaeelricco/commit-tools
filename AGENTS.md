## Review guidelines

Reviews must be concise, high-signal, and limited to issues that should affect whether a pull request is merged.

Only leave blocking review comments for concrete P0/P1 risks.

P0/P1 means:

- Security, privacy, data-loss, authentication, authorization, permission, or availability regressions.
- A likely production correctness bug with a concrete execution path introduced by the diff.
- A broken build, failing test, migration issue, or API contract break directly caused by the diff.
- A change that violates an existing documented invariant, schema, caller contract, or product requirement.

Do not leave blocking comments for:

- Hypothetical edge cases without a realistic user path.
- Inputs that are impossible under existing callers, schemas, UI constraints, API contracts, or validation layers.
- Style preferences, naming preferences, alternative designs, or speculative refactors.
- Missing defensive handling unless the pull request introduces a realistic failure path.
- "This could happen if..." concerns without evidence from the diff.
- Pre-existing issues not made worse by the pull request.
- Suggestions that would expand scope beyond the pull request's intent.

Every finding must include:

- The concrete failure path.
- Why it is P0 or P1.
- The exact changed line or smallest relevant range.
- The smallest practical fix.

If a concern is real but non-blocking, omit it unless it is explicitly useful. If included, put it under "Non-blocking notes".

If there are no P0/P1 findings, say: "No blocking findings."
