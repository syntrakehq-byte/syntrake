# News Core N0 reconciliation and N2-A contract

Status: candidate contract for a Draft PR stacked on the frozen N1 SHA
`97843b131e7e7fd5224c86fff8a6a3a6db2a2d28`.

## Authority and N0 status

The corrected specification and acceptance matrix from PR #90 are the only
active N0 documents for this candidate. PR #89 is the historical predecessor
of that correction; it must not be treated as a second, concurrent contract.
The PR #90 version supersedes the conflicting wording from #89 while keeping
the 37 acceptance criteria and their test semantics unchanged.

The documents remain review-ready rather than formally approved: an
independent approval gate is still required. This reconciliation therefore
does not declare N0 approved.

## Capability boundaries

| Phase | Canonical responsibility | Explicit boundary |
| --- | --- | --- |
| N1 | Real source collection, provenance, checkpoints, PostgreSQL persistence, executor, recovery and sessionless execution | Does not create semantic revision history |
| N2 | Safe publication identity, provider deduplication, structural relations, immutable append-only revisions and the PIT guarantees required to read them | Does not classify facts, confirm events, or build full semantic intelligence |
| N2-A | Revision rows, per-revision provenance, dependency validation, atomic finalization, idempotent replay and controlled PIT reads | No Market matching, event classification, cross-provider semantic merge, or public API |
| N3 | Factual classification, event confirmation/corroboration, derived factual intelligence and complete semantic history | Consumes N2 identities/revisions; it does not redefine them |
| N5 | Consumer interfaces and end-to-end operational validation | Does not move persistence or identity rules into an API layer |

This resolves the apparent N2/N3 overlap: mechanical revision storage and
historical visibility belong to N2; factual/semantic interpretation of those
revisions belongs to N3. The matrix's PIT and revision criteria remain in the
same tests, but their ownership is now explicit.

## N2-A contract

`publication_revisions` is append-only by `(publication_id, revision_no)`.
Every revision has a stable ID, an optional `supersedes_revision_id`, and a
separate provenance row. A revision is inserted as `PENDING`, assigned a new
visibility frontier, and becomes `COMMITTED` only in the same finalization
protocol used by N1. The reader function requires both committed state and
`as_known_at <= cutoff` plus the frontier cutoff.

Revision 1 is backfilled only from timestamps already stored by N1. No
historical timestamp is invented. A replay with the same immutable payload is
idempotent; a conflicting payload is rejected. A superseding revision must
refer to a committed revision of the same publication whose temporal state is
valid.

## Acceptance preservation

The relevant existing criteria remain unchanged:

- `N0-T02`: the prior revision remains readable after a correction;
- `N0-T12`: a correction is absent from an earlier cutoff;
- `N0-T24`: rollback leaves no partial revision or provenance;
- `N0-T28`: source-clock conflict does not become PIT availability;
- `N0-T29`: concurrent replay creates one revision.

The N2-A PG17 test is an implementation of those criteria, not a replacement
for the 37-criterion matrix. The remaining matrix criteria stay owned by the
phases assigned in PR #90 and are not silently marked complete here.

## N2-B risks and dependencies

N2-B still requires an explicit contract for structural relations and safe
identity correspondence across providers. It must reuse the N1 publication,
observation, frontier and lease contracts, and must not introduce a second
financial identity authority or depend on Market Core Draft contracts.
Cross-provider semantic deduplication, event classification and corroboration
remain out of scope until N3 decisions are approved.
