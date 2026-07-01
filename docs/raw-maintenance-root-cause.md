# Raw Maintenance Delete Root Cause

The failing user path is: admin deletes a floor skeleton row in the raw editor, the browser posts `deleteRow` to the raw-maintenance endpoint, the service deletes matching relational `floor_segments` and `spaces`, and then the response path rebuilds the visible dataset.

The previous regression tests stopped after the service call and checked only relational tables. They did not exercise the real response/read path. In production, `sendVisibleDataset` calls `buildVisibleDataset`, and that function still synchronizes visible legacy JSON payloads back into relational tables. Old plan-copy payloads can still contain full `floor_segments` and `spaces`; after a relation-first delete, that stale payload can upsert the deleted skeleton and bound spaces again. The same read-time synchronization also adds heavy write work to login, delete, and refresh operations, which explains the slow UI.

The fix must make visible-dataset reads relation-first and non-mutating once relational data exists, while keeping legacy synchronization only as a fallback for old deployments that have not been backfilled yet. Raw-maintenance deletes must also clean matching plan-space overrides so copy-scoped spaces bound to a deleted global skeleton do not remain visible.
