# ARM read-only guard

Status: plan/spec only. This file specifies the local ARM read guard recommended in section 13 of [the smoke plan](docs/plans/openclaw-arm-readonly-smoke.md) on [PR #1](https://github.com/blockaero/openclaw-console/pull/1). It does not build the process. Node is a suggestion, because the Ops console is Node. It is not a package, a service, or a dependency added by this pull request.

This document does not change application code, OpenClaw config, the MSI Ops console, Neon, or ARM. No ARM or platform API was called while writing it. `tools/list` and `tools/call` were not called. No key is minted. This pull request does not merge to `main`.

**Next step for the whole program.** ARM adds a real read-only level that is not an alias of L0, before any key is minted. Ledger tools stay closed to bots. An unknown level stays L0. That level's `initialize` follows decision 5. This spec does not mint, and it does not make that server change. The level is the cloud session named in section 15 of the smoke plan. This file does not open a second copy of that work.

## What this guard is

One Windows process. It is the only process that holds the read-only ARM key, and the only process that talks to ARM. If it is down, nothing falls through to ARM. The read-only OpenClaw profile does not get an ARM URL, an ARM key, or an `mcp.servers` entry for ARM.

| | |
|---|---|
| Windows user | `svc-armro-guard` |
| Listen | `127.0.0.1:18950` |
| Holds | one read-only key per account, in that user's Credential Manager |
| Talks to | `https://agentic-records-manager.com/mcp` only |
| Suggested language | Node. A note, not a build. |

The port is assumed free. Confirm it on the MSI before any process exists. Never bind `8788`. Never bind `18789`. This guard also does not bind `19789` (the `arm-ro` profile) or `18951` (the auditor). Those are other processes.

Neighbors, from the smoke plan, not built here:

| Component | Windows user | Listens | Holds |
|---|---|---|---|
| Live gateway, unchanged | Todd's user | `127.0.0.1:18789` | `ARM_MCP_PIN` |
| Read-only profile `arm-ro` | `svc-armro-agent` | `127.0.0.1:19789` | a local guard token only |
| This guard | `svc-armro-guard` | `127.0.0.1:18950` | the read-only keys |
| Auditor | `svc-armro-audit` | `127.0.0.1:18951` | a Neon `SELECT` role only |

The guard holds no Neon credential. The auditor holds no ARM key. The live worker stays on `ARM_MCP_PIN` and on `baseUrl` `http://127.0.0.1:11434`. Do not start `openclaw_mcp_gateway` on port 8788.

## Credential

The long-lived read-only key is never a Windows user environment variable. A user variable is inherited by every process of that user. Store each account's key in `svc-armro-guard`'s Credential Manager (DPAPI for that user). The accounts-list entry names that target, one ref per account (decision 4). Illustrative target, from the smoke plan: `credman:armro/block-aero-americas-nap8`. The secret is not written into the config file, git, Slack, email, the JSONL, or the console ring.

The key is not `ARM_MCP_PIN`. It is not Todd's personal credential. It is not the live pin in `~/.openclaw/openclaw.json`. It is not the smoke harness variable `ARM_SMOKE_PIN_AMERICAS`. That name stays the one-shot process environment in section 5 of the smoke plan. This spec does not rewrite that example. The Grok alternative (a scheduled-task environment variable `ARM_READONLY_PIN_AMERICAS`) is not this guard.

Startup compares a hash of the Credential Manager secret to a hash of `ARM_MCP_PIN` and refuses to print either value. A match, a missing target, or a user-level environment variable that already holds the key is a halt. The live `ARM_MCP_PIN` stays where it is. Moving it is out of scope.

No key exists to store until the read-only level exists. This spec does not mint one.

## Who may call the guard

Loopback only. A call that is not from `127.0.0.1` is refused and does not reach ARM.

Every accepted call carries the local guard token. `svc-armro-agent` is the holder of that token. The token is not the ARM key and is not `ARM_MCP_PIN`. A missing or wrong token is refused locally. The refusal is not an ARM request.

The guard does not queue. One ARM request is in flight. A second loopback call while that request is open is refused locally and does not start a second ARM call.

The caller names the account ref (the Credential Manager target name, never the key) and the tool. The guard resolves the key. The caller never receives the key.

## Upstream

The only outbound URL is `https://agentic-records-manager.com/mcp`. No second host. No Neon. No Ollama. No Ops console. No `gcs_uri` fetch. No platform `/api/v2`. Transport and protocol are the ones the smoke plan already recorded for that URL: JSON-RPC over HTTP, protocol `2025-03-26`. This spec does not re-probe that server.

Methods the guard may send, and only after the read-only level exists and a human has cleared the halt:

1. `initialize`, under decision 5.
2. `tools/list`, as the subset check.
3. `tools/call`, and only for a certified read.

Anything else inbound from the server or from the local caller is an error, then a halt. In particular the guard has no sampling capability and no roots capability.

## Decision 5 (handshake)

**Decided 2026-10-05 by Todd. Not open. This spec does not reopen it.**

`initialize` may write one server-generated last-seen timestamp. That is the only handshake write. No other fields:

- no `principals.last_briefing_*` content
- no counters
- no runtime usage
- no status

The handshake triggers no processing. A read does not start Claude, OCR, classification, extraction, or an enqueue. A move of `last_briefing_*`, a counter, runtime usage, status, or any processing on that handshake halts the guard.

Decision 2 is not rewritten. On later `tools/call` rows, the tolerated soft writes stay decision 2 until Todd says otherwise: the presence lease for this principal (`chat_run_leases` heartbeat) and the last-seen update on that same principal or credential (`principals.last_seen_at`, `principal_credentials.last_used_at`). Every other write still fails the run. The guard does not ask ARM to suppress those decision 2 columns. Suppression is section 14 of the smoke plan, and it is still Todd's.

The guard does not see Neon. The column diff belongs to the auditor spec, not to this process. The guard's own halt on the handshake is the protocol rule above: it does not send a second `initialize` to "fix" a bad one, and it stops forwarding.

This document does not send `initialize`.

## Catalog check

`tools/list` must be a subset of the static allow-list below. One extra name halts the guard. The guard does not skip the bad tool and continue. An empty list is a subset. A name on the static list that the server does not advertise is not called. That absence is not an extra name and is not a halt.

`notifications/tools/list_changed` drops permission immediately. Forwarding stops. The guard then runs `tools/list` again. If the new list is not a subset, the guard stays halted. A human clears a halt. Nothing auto-restarts.

`registry_insights` is called only when that exact name is advertised. A different registry or insights name is an extra name and halts.

Live `tools/list` has not been run. Argument names, cursors, and pagination fields stay unverified. The guard records the raw page fields it sees and does not invent a cursor parameter the schema does not list. The procedure that compares a future live list to this static list is a separate thread. This spec does not run that call.

## Sampling and roots

`initialize` declares no sampling capability. The guard does not implement a handler that returns a model message.

`sampling/createMessage` from the server, or from a local caller, is an error, then a halt.

`roots/list` is an error, then a halt.

The guard does not offer roots, resources, or prompts as capabilities.

## Static allow-list (phase 2)

Doc-derived names only. Do not invent tool names. Opus placeholder names for trace, life limits, record text, asset records, and certificates are not on this list and are not called. Those jobs wait for a later revision that classifies a real `tools/list` entry as pure-read.

Fixed order. The model does not pick the tool or the account.

| Order | Tool | Rule |
|---|---|---|
| 1 | `get_pulse_head` | Forward only if advertised. |
| 2 | `get_account_pulse` | Forward only if advertised. Not also the resource `arm://account/pulse`. |
| 3 | `get_standing_playbook` | Forward only if advertised. |
| 4 | `get_deliverable_rollup` | Forward only if advertised. |
| 5 | `list_work_items` | Forward only if advertised. Paged, under the caps. Never claim or complete. |
| 6 | `list_priority_part_lists` | Forward only if advertised. Paged, under the caps. |
| 7 | `get_project_status` | Forward only if advertised. |
| 8 | `registry_insights` | Forward only if that exact name is advertised. |

Off the list, even if some other document mentions them:

- `get_briefing`
- `report_runtime_usage`
- claim, `complete_work_item`, `post_session_message`, `put_pulse_head`
- `propose_*`, `send_records_request`, `notify_user`
- `ledger_commit`, `form_0`, `party_stamp`, `commit_work_plan`, `approve_documents`
- confirm, commit, approve, attach, mint, invite, register, harvest
- the resource `arm://account/pulse`, and any `resources/read`

If `tools/list` advertises any of those, or any other name not in the table, the guard halts before the first `tools/call`.

A certified read is a name in that table that the latest successful subset check also advertised. The guard forwards only those. Certification ladder work (declare, review, write-trap, branch diff, canary) is the separate CI thread. This guard enforces the static list. It does not widen it.

## Caps

Per account, per run:

- 10 pages per list tool
- 200 records per tool
- 32MB of raw JSON per account
- one request in flight

`get_account_pulse` also stops at the doc-derived 256KB cap from the smoke plan. When the body sits on that cap, or the payload says it is partial, the guard records `truncated: true` and does not ask for the rest by some other method.

Page size is the tool schema default. Do not send a larger page than the schema maximum. If no maximum is advertised, send no size override on the first page and record what came back. Follow a next cursor only when the response or the schema names one. Stop on an empty page, a repeated cursor, a short page, or a cap.

## Errors

No retry on HTTP 400, 401, 403, or 404. Those halt.

On HTTP 429 or 503, wait 5 seconds and retry. If that attempt returns the same error, wait 10 seconds and retry. If that attempt returns the same error, wait 20 seconds and halt. Do not send another request after the 20 second wait. The same error three times stops the guard. A local refusal (bad token, non-loopback, second call while one is in flight) does not go to ARM and does not count as that ARM error.

Do not call pulse on a timer. The live agent's 15–30 second cadence is not a license for this process.

## Permission

The guard starts halted. A halt file stays in place until a human deletes it. Nothing auto-restarts.

| State | ARM calls | Exit |
|---|---|---|
| `HALTED` | none | A human deletes the halt file, and the read-only level already exists. Else stay here. |
| `PRECHECK` | `initialize`, then `tools/list` | Subset check passes and decision 5 holds. Else `HALTED`. |
| `FORWARD` | certified `tools/call` only, one in flight, fixed order | Caps done, or a violation. A violation drops permission and returns to `HALTED`. |
| Recheck | `tools/list` after `notifications/tools/list_changed` | Subset passes restores `FORWARD`. Else `HALTED`. |

Dropping permission means in-memory allow-forward is cleared before the recheck returns. A call that arrives during the recheck is refused.

An unchanged etag skips every ARM call after the etag check. Replay reads the sealed snapshot and does not call ARM. The guard log (tool name, arguments with secrets removed, response byte length, etag or cursor, `truncated`, duration) is what the seal compares. The TV ring is not the record.

## Kill switch

After the after-image, not inside the diff window:

1. Stop this process. Confirm it is gone. No more MCP calls.
2. Leave the halt file in place.
3. Revoke the read-only key as an admin action outside the window. Leave `ARM_MCP_PIN`.
4. Do not complete a work item. This guard must not have claimed one. Completing one would be a second write.

Confirm the live worker `baseUrl` is still `http://127.0.0.1:11434`. That check belongs to the operator, not to a new ARM call.

## What this spec does not do

- It does not add a service, a package, a scheduled task, or OpenClaw config.
- It does not mint a key, print a key, or copy `ARM_MCP_PIN`.
- It does not call ARM, `tools/list`, or `tools/call`.
- It does not edit decision 2. Later `tools/call` soft writes stay decision 2 until Todd says otherwise.
- It does not reopen decision 5.
- It does not invent tool names, cursor fields, or a resource read for `arm://account/pulse`.
- It does not bind 8788 or 18789.
- It does not hold a Neon credential, fetch GCS, load a model, or post `report_runtime_usage`.
- It does not merge to `main`.

The auditor, the CI write-traps, the future `tools/list` comparison procedure, and phase-3 tool names are other threads. They link back to [PR #1](https://github.com/blockaero/openclaw-console/pull/1), as this file does.
