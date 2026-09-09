# Comms message retrieval tracking (pointer)

This plan is orchestrated from the comms repo. The living document is
`~/code/comms/docs/plans/implemented/message-retrieval-tracking.md`.

Comms Web's share was phase 6 there, and it is done: the receipts route and
validator consume `{subscribers, inspectors}` with `seen_at`, `inspected_at`,
and `seen_count`, `MessageReceipts.svelte` renders four per-agent states plus an
inspectors section, and the unused store-level receipts fetch is gone.

**Compatibility:** this Comms Web requires a comms daemon at schema version 2 or
later. Against an older daemon the receipts panel reports "Read status
unavailable" rather than crashing.
