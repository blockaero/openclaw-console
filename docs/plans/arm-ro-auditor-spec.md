# Independent auditor for the ARM read-only reader

Status: plan and spec only. This document specifies the auditor named in [PR #1](https://github.com/blockaero/openclaw-console/pull/1), section 13 and section 15. It does not add auditor code, a package, a SQL file, a Neon role, or a Windows user. It does not call ARM or any MCP server, does not run `tools/list` or `tools/call`, does not mint a key, and does not run SQL. It does not merge to `main`.

Parent plan: `docs/plans/openclaw-arm-readonly-smoke.md` on branch `cursor/openclaw-arm-readonly-smoke-7095`. Decisions 1–5 in that file stay as Todd Siena approved or decided them on 2026-10-05. This spec follows decision 2 and decision 5. It does not rewrite decision 2. Decision 5 is closed and is not reopened here.

**From PR #1, read from git on 2026-10-05.** Evidence labels in the parent plan still apply. This session did not re-open the MSI, Neon, or ARM.

## Recommendation

The auditor runs on the MSI laptop as Windows user `svc-armro-audit`, bound to loopback `127.0.0.1:18951`, holding a Neon `SELECT` role and nothing else.

Block Aero infrastructure, with the auditor off the laptop, is the recorded alternative. This spec does not choose it.

That placement is the laptop row already fixed in PR #1 section 13. PR #3 asked whether the auditor should run on the laptop or in Block Aero infrastructure and recommended the laptop with `SELECT` only. This file records that recommendation as the spec and leaves the infrastructure alternative unchosen.

## What this process is

| | |
|---|---|
| Windows user | `svc-armro-audit` |
| Listens | `127.0.0.1:18951` |
| Holds | a Neon `SELECT` role only |
| Talks to | Neon (ARM-pooled). Loopback callers on the MSI for the checkpoints below. |
| Does not hold | an ARM key, `ARM_MCP_PIN`, a smoke pin, or a guard token |

The auditor is the only process with database access. The guard holds no Neon credential. The read-only OpenClaw profile holds no ARM key and no Neon credential. If the auditor is down, the guard has no second path into Neon and does not answer the diff itself.

Port `18951` is assumed free, as PR #1 section 13 states. Confirm that on the MSI before any process exists. The auditor never binds `8788`, `18789`, or `19789`.

An illustrative Neon role name from PR #3 is `armro_auditor`. This document does not create that role. The requirement is the grant shape: `SELECT` only, on ARM-pooled `proud-shadow-85694415`, default branch. The role is not the application role. It has no `INSERT`, `UPDATE`, `DELETE`, or DDL. `default_transaction_read_only` on the session is defense in depth. The grants are the limit. A statement timeout is set on the session so a heavy `count(*)` cannot run unbounded. PR #3 assumed 5 seconds. That number is not an approval. A timeout ends the checkpoint as unfinished.

The credential lives with `svc-armro-audit` only. It is not a Windows user environment variable, not `ARM_MCP_PIN`, and not a value in `openclaw.json` or in git. The parent plan's standing-reader secret rule is Credential Manager for that user. This spec keeps that rule and does not write a connection string.

The auditor reads the primary compute. PR #3 notes that a Neon read replica is asynchronous and can miss a row that was just written. Replica lag is an unfinished check.

Project **arm-edge-proto** (`weathered-dawn-91178683`) stays unread, as in the parent plan.

## Loopback checkpoints

The guard is the only ARM client. It tells the auditor which checkpoint is due. The auditor does not infer that from ARM, because it has no ARM key and does not call MCP.

The listener accepts connections on `127.0.0.1:18951` only. Each request names `run_id`, `account_id`, `principal_id`, and the checkpoint. The auditor returns a verdict. It does not forward the request anywhere except Neon `SELECT`.

| Checkpoint | When | Who asks | Pass condition |
|---|---|---|---|
| `baseline` | Before the first ARM call of the run | Guard, during `PRECHECK` | Watched images saved. A failure here is unfinished. |
| `after_initialize` | Immediately after MCP `initialize`, before `tools/list` and `tools/call` | Guard | Decision 5 only. One server-generated last-seen timestamp. |
| `mid` | After fetch, before any model call. State `AUDIT_MID`. | Guard | Decision 2 columns for this principal only, plus a clean log diff. |
| `post` | After output. State `AUDIT_POST`. | Guard | No new ARM delta from the model step. |
| `late` | 15 minutes after the run. State `LATE_AUDIT`. | The auditor's own timer | No late processing row. |

`PRECHECK` in the parent state machine also requires the baseline image to be clean before fetch starts: no unexpected delta already open, halt clear, and this principal identifiable. The guard and the auditor both have to finish that step. An auditor that does not answer leaves the run unfinished.

The smoke harness in PR #1 (option B, steps 2, 5, and 9) uses the same process and the same rules: before-image, mid-image, after-image. The standing reader adds `after_initialize` as its own checkpoint and adds the 15-minute late check. One auditor, both callers. This document does not build either caller.

## Tables the diff watches

There is no table named `audit` or `audit_log`. `schema_migrations` has a version `email_log_audit`. The table is `email_log`. The result field `audit.table` stays `null`. When the log diff is clean, `audit.status` is `no_audit_table_use_pipeline_and_chain_logs`, matching PR #1 section 9.

The auditor diffs these, and fails a new row in the log tables:

| Table | What a change means |
|---|---|
| `pipeline_log` | Processing. Carries `model_id` and `cost_usd`. A new row is processing, including a row whose only effect was ARM calling its own model. |
| `chain_operations` | Platform HTTP: `method`, `path`, `actor`, `origin`. |
| `asset_write_ledger` | Asset writes. |
| `login_events` | See the unresolved flag below. The smoke plan fails any new row. |
| `email_log` | Mail log. |
| `arm_agent_runtime_usage` | COGS table behind `report_runtime_usage`. |

`agent_work_items` is included as a column diff, not as an unnamed audit table. A change to any of `claimed_at`, `claimed_by`, `status`, `finished_at`, or `result` fails the run. The auditor does not claim or complete a work item to reverse one.

PR #3 proposed a wider watch list (`notifications`, `chat_messages` counts, pulse heads, meter and hours, review queue, planning intents, proposals, OCR, blobs, factory jobs). This spec does not add that list. The tables above are the parent plan's set.

The decision 2 and decision 5 columns sit beside that set. They are named below. The auditor also fails a move of these last-seen columns, which PR #1 section 2a already excludes from the allow-list:

- `account_users.last_seen_at`
- `part_identities.last_seen_at`
- `photo_marking_priors.last_seen`
- `demo_visits.last_seen`

Business `updated_at` on `accounts`, `principals` (other than the one allowed last-seen field), `account_runtime_status`, `certificate_forms`, `doc_type_registry`, and any other business row stays a failure. The auditor reads `information_schema.columns` before it checksums a table. It does not guess a column name. A table with no stable id and no usable timestamp is `checksum: unavailable`. That checkpoint cannot pass.

The diff stores ids, timestamps, principal ids, and the named work-item columns. It does not store record bodies, credential hashes, `token_hash`, or human emails. `neon_auth` stays out. `principal_credentials` is read only for `last_used_at` on the named principal's credential row.

## Handshake (decision 5)

**Decided 2026-10-05 by Todd. Closed. This spec does not reopen it.**

MCP `initialize` may show one server-generated last-seen timestamp, and that is the only handshake write. The catalog name for that timestamp is `principals.last_seen_at` on the principal that made the call. The auditor allows that one column to move on `after_initialize`. Everything else on that checkpoint fails the run.

Fail the handshake when any of these moved or appeared:

- `principals.last_briefing_*` content: `last_briefing_version`, `last_briefing_at`, `last_briefing_via`
- a counter (including a move in `arm_agent_meter` or `arm_agent_hours`; this spec does not invent further counter column names, and any other unexpected column move fails)
- runtime usage: a new `arm_agent_runtime_usage` row
- status: a status column on that principal, on `account_runtime_status`, on `agent_work_items`, or on `chat_run_leases`
- processing: a new `pipeline_log` row, or any other new row in the log tables above

`principal_credentials.last_used_at` and the `chat_run_leases` heartbeat columns are decision 2. They are not the one handshake timestamp. A move of either during `after_initialize` fails the handshake.

This is the same rule as the cloud session "PLAN: ARM real read-only level spec (not L0 alias)" on `Block-Aero/[REDACTED]`. <!-- pragma: allowlist secret -->

The parent plan still does not send `initialize`. This spec does not send it either. Once a read-only level exists and matches decision 5, the guard may send `initialize`, and this checkpoint is how the auditor scores it.

## Later calls (decision 2, unchanged)

Decision 2 is not rewritten. Until Todd says to suppress them, later `tools/call` checkpoints (`mid` and `post`, and the smoke plan's mid-image and after-image) may still move only these, and only for the principal of this run:

- `principals.last_seen_at`
- `principal_credentials.last_used_at` on that principal's credential row (`token_hash` stays unread)
- that principal's `chat_run_leases` heartbeat columns: `heartbeat_at`, `started_at`, `status`

`chat_run_leases` is keyed by `conversation_id` and has `principal_id`, `account_id`, `kind`, and `heartbeat_at`. The MSI phrase `bot:<principal_id>` is not a column. A new lease row is on the allow-list only when `principal_id` is this run's principal and `kind` is a presence heartbeat. `kind` values were not enumerated in PR #1. The auditor records `kind_seen`. A `kind` it cannot show is a presence heartbeat fails the checkpoint.

Counts of those allowed rows have to match the ARM calls the guard reports for that principal. The auditor does not invent the call count. The guard supplies it. A mismatch fails.

Section 14 of the parent plan still asks whether the standing reader must suppress these three. This spec keeps them tolerated on later calls. A Todd instruction to suppress them replaces this paragraph. It does not change the handshake rule above.

`get_briefing` stays off the call list. A `last_briefing_*` move at `mid` or `post` fails, the same as on the handshake.

## Attribution, the smoke, and the live worker

Log rows need a `principal_id` before the standing reader runs beside the live worker. This spec does not claim that column exists today. PR #1 did not verify it. `chain_operations` has `actor`. That is not, by itself, proof that every watched table is attributable.

Until each watched log table carries a principal stamp the auditor can filter on:

- any new row in `pipeline_log`, `chain_operations`, `asset_write_ledger`, `login_events`, `email_log`, or `arm_agent_runtime_usage` fails the window
- the standing reader does not run beside the live worker
- the live worker's ARM path stays disconnected for the window, same as the smoke

Attribution is a gate before unattended runs. It is not a gate before the smoke. Option B may run in a quiet window without that stamp. The smoke still fails any new row in those tables. A stamp is required before an unattended reader shares a window with the worker. This document does not add the stamp. That change belongs in ARM.

After a reviewed schema shows `principal_id` (or an equivalent actor column that already identifies this principal) populated on those tables, the standing-reader diff counts rows for this principal and rows that carry this run's request id. Rows from other actors stay visible in the archive and do not, by themselves, fail that later mode. Reaching that mode is a later revision. It is not the smoke, and it is not this PR.

## `login_events` (unresolved, not decided)

PR #1 section 14 item 1 stays open. This spec does not decide it.

| Position | Rule |
|---|---|
| This smoke plan, and the Grok plan it reconciled | Any new `login_events` row fails the window. |
| Opus (PR #3) | One attributed `login_events` row per session would be allowed, so ARM keeps login auditing. |

The auditor records every new `login_events` row (id and timestamp only). It sets `unresolved_login_events` when the count is non-zero. It does not mark that window clean. It does not apply Opus's one-row allowance. It does not close section 14. Todd picks one rule before the first session. Until then, a new `login_events` row is a flagged unresolved delta under the smoke plan's fail-on-any-new-row rule.

## If the auditor cannot finish

An unfinished check is quarantined. Quarantine is not a clean result.

Unfinished means any of: the process is down, the loopback call times out, Neon errors, the statement times out, the primary cannot be read, replica lag is suspected, a watched table cannot be named from `information_schema`, the checksum is `unavailable`, or the diff returns a partial image. The verdict is `unverified`.

On `unverified`:

- the output of that run is quarantined
- the archive keeps the partial image and the reason
- the output is not delivered and is not marked `DONE`
- the next run stays blocked until a later audit finishes and is clean
- the guard halts; it does not skip the checkpoint and continue

A missing auditor is the same verdict. The guard does not treat silence as clean.

## Late audit

`LATE_AUDIT` runs 15 minutes after the run, on the auditor's own timer, after `post`. The parent plan keeps this state because ARM's model path can land after the window.

A late processing row retracts the output and halts. A processing row is a new `pipeline_log` row (`model_id`, `cost_usd`), including one that appeared only on the late image. The archive mark is `retracted`. The output is not delivered. The run is not clean. The auditor does not delete the output, does not call ARM, and does not revoke a key.

Any other new row in the watched log tables on the late image also leaves the run unclean. A late move of an `agent_work_items` claim column halts. Decision 2 columns that move because some other client called ARM are recorded; they do not excuse a processing row.

If the late check itself cannot finish, the verdict is `unverified` and the output is quarantined. A skipped late audit is not a pass. PR #3 assumed ARM's async work lands within 15 minutes. That interval is the parent plan's figure. ARM confirming a longer tail would be a later edit to this number.

## Verdicts

| Verdict | When | What happens |
|---|---|---|
| `clean` | Log diff clean, handshake matches decision 5, later calls match decision 2 only, late check clean | Continue. `audit.status` is `no_audit_table_use_pipeline_and_chain_logs`. `audit.table` is `null`. `new_rows` is 0. |
| `violation` | A write or a processing signal outside those rules | Halt. Keep the output out of delivery. `audit.status` is `changed`. |
| `unverified` | The auditor cannot finish | Quarantine. Not clean. Block the next run until an audit is clean. |
| `flagged_unresolved_login_events` | A new `login_events` row, section 14 still open | Not clean. Recorded beside the smoke plan's fail rule. The question stays open. |
| `retract` | Late processing row | Output marked `retracted`. Halt. |

`clean` requires every checkpoint that the run owes, including `late` once the timer has fired. `post` alone does not make the run clean.

Allowed decision 2 deltas are copied into `zero_writes.allowed_soft_writes` in the shape PR #1 section 9 already defines (`presence_lease`, `last_seen`, `last_used`, with `principal_id`). They are not `unexpected_deltas`. A handshake last-seen timestamp is recorded on its own, as decision 5, and is not used to widen decision 2.

## What the auditor refuses to do

- Hold or read an ARM key. Call `initialize`, `tools/list`, or `tools/call`.
- Give the guard a Neon credential, or accept a Neon credential from the guard.
- Run `INSERT`, `UPDATE`, `DELETE`, or DDL. Mint a role. Change a grant.
- Read record bodies, `gcs_uri` payloads, KYC, `neon_auth`, or credential hashes.
- Treat quarantine, silence, a timeout, or a missing late check as clean.
- Run beside the live worker before log rows carry a principal stamp.
- Decide `login_events`. Reopen decision 5. Rewrite decision 2.
- Start a listener on `8788` or on the live gateway port.
- Complete a claimed work item, revoke a key, or restore `openclaw.json`. Those stay with the guard's kill switch and with Todd, outside this process.

## Non-goals

- No auditor code, tests, or dependency in this pull request.
- No Windows account, scheduled task, firewall rule, or Neon role is created from this document.
- No merge of this branch to `main`, and no merge of PR #1, PR #2, or PR #3.
- The guard spec, the CI write-trap spec, the future `tools/list` check, and the phase-3 tool spec stay their own threads (PR #1 section 15).

## Open points this spec leaves with Todd

Inherited from PR #1 section 14, not closed here:

1. `login_events`, as flagged above.
2. Whether the standing reader must suppress decision 2's three columns. Until you say so, later calls may still move them.
3. The statement-timeout seconds. A timeout is unfinished. The number 5 is PR #3's assumption, not an approval.
4. Whether ARM's async tail can exceed 15 minutes. The late check uses 15 minutes until you change it.
5. The extended watch list in PR #3. It is not part of this diff.
