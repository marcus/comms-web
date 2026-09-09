# Comms message retrieval tracking (pointer)

This plan is orchestrated from the comms repo. The living document is
`~/code/comms/docs/plans/active/message-retrieval-tracking.md`.

Comms Web's share is phase 6 there: consume the new receipts shape
(`{subscribers, inspectors}` with `seen_at`, `inspected_at`, `seen_count`),
render four per-agent states plus an inspectors section in
`src/lib/MessageReceipts.svelte`, and drop the unused store-level receipts fetch.
