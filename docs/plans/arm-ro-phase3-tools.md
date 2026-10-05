# ARM additions required before phase-3 jobs

Status: plan and spec only. This file does not change ARM, OpenClaw, the MSI Ops console, Neon, or application code. It does not mint a key. It does not send `initialize`, `tools/list`, or `tools/call`. It does not merge to `main`. It does not merge [PR #1](https://github.com/blockaero/openclaw-console/pull/1).

Parent: [PR #1](https://github.com/blockaero/openclaw-console/pull/1), file `docs/plans/openclaw-arm-readonly-smoke.md`. The facts below are taken from that file's section 2a (tables and columns), section 3 (MSI table names and doc-derived tools), section 13 (phase 2 allow-list, certification ladder, phase-3 wait), and section 14 (unresolved required-doc list and thresholds). This session did not re-query Neon, did not open the ARM repository, and did not call ARM.

The server change, when someone with access makes it, belongs in the ARM application repo `github.com/Block-Aero/block-aero-ai-records-manager`. This pull request does not edit that repo. <!-- pragma: allowlist secret -->

## Decisions this file does not reopen

Decision 5 is **DECIDED** (2026-10-05, Todd). It is not an open question here.

`initialize` may write one server-generated last-seen timestamp, and that is the only handshake write. No `principals.last_briefing_*` content. No counters. No runtime usage. No status. The handshake triggers no processing. A move of `last_briefing_*`, a counter, runtime usage, status, or any processing on that handshake fails the run.

Decision 2 is not rewritten. On later `tools/call` rows, the tolerated soft writes stay the ones decision 2 already names: the smoke principal's presence lease and that principal's last-seen (parent section 2a names `principals.last_seen_at`, `principal_credentials.last_used_at`, and a `chat_run_leases` heartbeat for that `principal_id`). This file does not ask ARM to suppress those columns, and it does not add any other write to the allow-list.

Minting still waits on a real read-only role or level. That level is not an alias of L0. Today's reported L0 still includes claim, complete, post message, and put pulse head, and runtime-usage reporting is allowed at every current level (parent section 2b, reported, not verified in this session). Unknown level stays L0. Ledger tools stay closed to bots. Do not mint a key in order to discover phase-3 tool names. Do not mint because this spec exists.

## Phase 2 stays the doc-derived status tools

Phase 2 jobs, when they are built, use only the doc-derived status tools already named in parent section 13. Those names are doc-derived. They are not a live `tools/list`. A phase-2 job still calls one only when the read-only key's `tools/list` advertises that exact string and the static allow-list already contains it.

| Doc-derived status tool | Phase |
|---|---|
| `get_pulse_head` | 2 |
| `get_account_pulse` (the tool, not also the resource `arm://account/pulse`) | 2 |
| `get_standing_playbook` | 2 |
| `get_deliverable_rollup` | 2 |
| `list_work_items` | 2 |
| `list_priority_part_lists` | 2 |
| `get_project_status` | 2 |
| `registry_insights`, only when that exact name is advertised | 2 |

`get_briefing` stays off. Phase 2 does not gain trace, life-limit, certificate, stored-text, or gap tools. Shipping a phase-3 capability on the server does not add it to a phase-2 job.

## What is already known, and what is not a tool name

**Schema-verified in parent section 2a.** No MCP tool name was attached to these tables.

| Store | What the catalog read showed | What a phase-3 read may use it for |
|---|---|---|
| `ocr_artifacts` | `formatted_text`, `page_texts`, `page_count`, `provider`, `detected_language` | Text already stored. |
| `record_blobs` | `gcs_uri`, `mime_type`, `size_bytes`, `file_name`, `doc_fingerprint`. Page bytes are not in Postgres. | Not a fetch target. `gcs_uri` is an object-storage locator. |
| `processed_files` | `file_id`, `file_name`, `file_hash` | Not the text store. |
| `doc_type_registry` | Reference data, about 159 types. Categories: Aerodrome Data, Commercial Data, Compliance Data, Design Data, Logistics Data, Maintenance Records. Conceptual classes set on some rows: `aircraft_oem_delivery`, `engine_oem_birth`, `incident_clearance`, `material_transfer_certificate`, `operator_configuration`, `identity_marking`, `removal_event_record`. | Reference catalog only. |
| `certificate_forms` | Table exists. `updated_at` exists on this table. | Stored certificate rows. A read that bumps `updated_at` fails the parent zero-write check. |
| `btb_life_limits` | Named with the other `btb_*` tables. Columns of this table were not listed in section 2a. | Stored life-limit rows. Do not invent column names. |

**Table names verified on the MSI (parent section 3).** SQL was not run for that note. The records / BTB / assets group includes `btb_events`, `btb_event_records`, `btb_event_assets`, `btb_shop_visits`, `btb_life_limits`, `btb_markup_rounds`, `btb_time_cycle_observations`, `btb_containment_intervals`, `work_events`, `part_identities`, `arm_asset_identities`, `asset_*`, `record_blobs`, `ocr_artifacts`, `processed_files`, `certificate_forms`, `form0_*`, `cert_chain`.

Parent section 2a states the gap directly: those tables exist, and nothing in the catalog names the MCP tool that returns a BTB row or a certificate. Parent section 3 says the doc-derived reads may not expose `btb_*`, `record_blobs`, or `certificate_forms`. Coverage of MCP-visible records is not coverage of every Neon table.

`form0_*` stays on the hard-banned side of the smoke plan (`form_0` and the other commit / stamp paths). This spec does not ask for a form tool. `cert_chain` is a table name from the MSI notes. No tool for it was verified, and this spec does not name one.

## What ARM adds before any phase-3 job exists

A phase-3 job does not exist until each capability it needs is a real `tools/list` entry, classified pure-read, certified, and copied into a later revision of the static allow-list. This file describes the capability. It does not choose the advertised name.

Pure-read, for every capability below, means all of the following at once:

- The read-only level's `tools/list` is the only place the entry appears. L0 and the live L3 worker do not gain it. The level is not an alias of L0.
- The call reads stored rows for the caller’s account. It does not claim, complete, post a message, put a pulse head, or report runtime usage.
- It does not insert `pipeline_log`, `chain_operations`, `asset_write_ledger`, `login_events`, `email_log`, `arm_agent_runtime_usage`, or `factory_jobs`. It does not change `agent_work_items` claim fields.
- It does not start Claude, OCR, classification, extraction, embedding, briefing generation, or an enqueue. ARM’s public health, as recorded in parent section 2a, reports `vision_provider=claude` and `ai_model=claude-sonnet-5`. A read that reaches that path fails.
- It does not write business `updated_at` columns. Parent section 2a confirms `updated_at` on `certificate_forms` and `doc_type_registry`, among others.
- Decision 2 is the only later-call soft write, and only for the read-only principal. Decision 5 is the only `initialize` write. This file does not send either call.
- Ledger tools stay closed.

Certification is the parent section 13 ladder, stacked with the fail-closed subset check. Both are required. Neither is done by writing this file.

1. Declare the side-effect class as pure-read.
2. Review that declaration.
3. CI write-trap, including `SET TRANSACTION READ ONLY` and traps on the provider path. That trap work is the separate CI thread, not this file.
4. Neon-branch diff.
5. Attended canary (the parent plan’s option B).
6. A receipt and an audit on every later run.

Any `tools/list` name outside the static allow-list halts the system. A new entry that is merely present on `tools/list` is not yet callable.

### Back-to-birth / traceability

ARM adds a pure-read of stored back-to-birth rows. The `btb_*` tables exist. No MCP tool name for them was verified.

The read returns stored trace rows already in those tables (events, event records, event assets, shop visits, and the other `btb_*` tables the server already persists for the account). It does not create a birth record, a shop visit, a markup round, or a containment interval. It does not call the platform. It does not write `part_identities.last_seen_at` (parent section 2a: that column is outside decision 2).

Ordering, gap rules inside a date range, and which identifier is the lookup key were not verified. This spec does not invent them. A traceability job stays off until the real `tools/list` entry has been classified and a later revision adds that exact string.

### Life limits and certificate expiry

ARM adds a pure-read of stored `btb_life_limits` rows and stored `certificate_forms` rows. Both tables exist. No MCP tool name for either was verified.

The read returns the stored fields the server already has. It does not compute "due within N days." Expiry windows are unresolved in parent section 14. This spec does not set 30, 60, or 90 days, and it does not adopt any window assumed in [PR #3](https://github.com/blockaero/openclaw-console/pull/3). It does not invent column names for remaining life.

The read does not stamp, approve, or commit a certificate. It does not bump `certificate_forms.updated_at`. A life-limit or expiry job that applies a window stays off until Todd sets that window and a later revision has added the classified `tools/list` name.

### Stored OCR text

ARM adds a pure-read of text already in `ocr_artifacts.page_texts` and `ocr_artifacts.formatted_text`. Those columns are schema-verified. `page_count`, `provider`, and `detected_language` are on the same table and may be returned with the text. No MCP tool name for this read was verified.

The read returns that stored text. It does not fetch `record_blobs.gcs_uri`. It does not sign a URL. It does not read object storage. It does not return page bytes. It does not start OCR. It does not start classification. It does not start extraction. It does not call Claude.

Missing text is a gap. The result says the stored text is absent. That absence does not enqueue OCR, a factory job, a pipeline row, or a model call. It does not insert `ocr_artifacts` or `processed_files`. A later job records the gap. It does not treat the gap as work to start.

The wire shape of that gap (a receipt, a flag, or some other field) is parent section 14 item 5 and is still open. This spec does not pick `processing_enqueued`, `models_invoked`, or `processing_required` as the contract. Those strings are proposals in the other plans. They are not verified fields.

Moondream stays skipped. Parent section 8 already sets `moondream: skipped_no_images` when no allow-listed tool returns page text or an image the key is allowed to read. This capability returns stored text, not an image, and it does not change that skip.

### Gap-report inputs

`doc_type_registry` is reference data, about 159 types, with the categories and conceptual classes listed above. A pure-read of that registry, once a real `tools/list` entry exists and is certified, can return those reference rows. The read does not bump `doc_type_registry.updated_at`. The model still does not invent a `doc_type_code`. No MCP tool name for the registry read was verified. `registry_insights` is a phase-2 status candidate, and only when that exact name is advertised. It is not this registry read, and this spec does not redefine it.

The required-doc-type list for a gap report is unresolved. Parent section 14 item 6 leaves required document types, expiry windows, aging buckets, phrasing pass rate, drift limit, and archive retention for Todd. [PR #3](https://github.com/blockaero/openclaw-console/pull/3) left the owner of that list blank and marked several numbers as assumed (99% validator pass, five attended business days, two clean weeks, 90-day archive). Those assumptions are not approvals. This spec does not invent Todd's thresholds and does not turn the registry categories or conceptual classes into a required-doc list.

A gap job stays off until both of these exist: Todd's required-doc-type list, and a certified pure-read whose `tools/list` name a later revision has added. The registry alone is not the required list. Present-document rows, if a later certified read returns them, are still only the "present" side. They do not define "required."

## Placeholder names are not verified and must not be called

[PR #3](https://github.com/blockaero/openclaw-console/pull/3) (`docs/plans/openclaw-readonly-config-opus.md`) listed placeholder strings for phase-3 lookups. [PR #2](https://github.com/blockaero/openclaw-console/pull/2) did not verify a tool name for `btb_*`; it recorded the gap as "no read tool verified." Parent section 13 already says those placeholder names are not verified and are not called.

The strings below are that historical list. They are not `tools/list` entries. They are not an allow-list. They must not be sent as `tools/call`. Quoting them here does not certify them. A match between one of these strings and a future `tools/list` entry would still be uncallable until that entry is classified pure-read and a later revision adds that exact string.

| Placeholder string from PR #3 | Why it is not callable |
|---|---|
| `get_part_trace` | No live `tools/list` entry. Not classified. Not in the static allow-list. |
| `list_life_limits` | Same. |
| `get_record_text` | Same. |
| `list_asset_records` | Same. |
| `get_doc_type_registry` | Same. |
| `list_certificates` | Same. |

Other names in those plans (slash commands, a guard MCP face, phase-4 tool ids) are also not ARM `tools/list` entries verified here. This file does not call them and does not add them.

A tool becomes callable only after a real `tools/list` entry is classified pure-read and added in a later revision. This revision adds none.

## Order before a phase-3 job

1. The real read-only level exists and is not an alias of L0. Minting waits on that level. This file does not mint.
2. `initialize` on that level follows decision 5 only. Decision 2 is unchanged for later calls.
3. Phase-2 jobs, if they run, use only the doc-derived status tools above.
4. ARM implements one pure-read capability from the four sections above. The advertised name is whatever `tools/list` on that level returns. This file does not choose it.
5. That entry is classified pure-read and passes the certification ladder.
6. A later revision of the static allow-list adds that exact string, and only that string, for that capability.
7. Gap and expiry jobs still wait on Todd's required-doc-type list and thresholds (parent section 14). A certified read does not supply those numbers.

Until step 6, the phase-3 job for that capability does not exist. Until step 7, a gap report or an expiry window does not exist even if the read does.

## What this file does not change

- Decision 1, decision 2, decision 3, and decision 4, as written in the parent. Decision 5 stays decided and does not replace decision 2.
- The mint gate. No key is minted from this document.
- The phase-2 allow-list. No phase-3 name is added.
- Parent section 14. Required document types and numeric thresholds stay unresolved. The proof-object shape stays unresolved.
- Option B as the smoke. This file does not run it.
- The ARM repository. The change specified here is for a later session that can read `github.com/Block-Aero/block-aero-ai-records-manager`. <!-- pragma: allowlist secret -->
