# ARM read-only `tools/list` verification

Status: plan and procedure spec only. Run this later, once an ARM read-only level exists and a dedicated read-only key exists. This document does not run the procedure. Writing it did not call ARM, did not call MCP, did not send `initialize`, `tools/list`, or `tools/call`, and did not mint a key. It does not merge to `main` or to any pull request.

Parent plan: [PR #1](https://github.com/blockaero/openclaw-console/pull/1), file `docs/plans/openclaw-arm-readonly-smoke.md`. The static allow-list below is taken from sections 3, 7, and 13 of that file. This spec does not enlarge that list.

This is the section 15 thread "Allow-list check once `tools/list` exists." Names for BTB, certificates, and page text stay out of this file. They wait for the phase-3 spec.

## Preconditions

Do not start the later run until every line below is already true. This procedure does not create the level and does not mint the key.

- The ARM read-only level exists and is not an alias of L0.
- Ledger tools stay closed to bots.
- An unknown level is still L0.
- The `initialize` handshake is decision 5, already decided: one server-generated last-seen timestamp only. No `last_briefing_*` content, no counters, no runtime usage, no status, and no processing.
- Do not reopen decision 5.
- Decision 2 is not rewritten. Decision 2 still names the presence lease and the last-seen update as the only tolerated writes on later calls. This procedure does not change that decision, and it does not send `tools/call`.

## Credential

Use the dedicated read-only key. Never `ARM_MCP_PIN`. Never Todd's account. Do not print the key. Do not copy the key into git, this file, Slack, email, a snapshot, or the console ring.

The parent plan's v1 accounts example names the variable `ARM_SMOKE_PIN_AMERICAS`. That name is a reference, not a value. A fingerprint check, without printing either secret, must show that this key differs from `ARM_MCP_PIN` and is not Todd's personal credential. If it does not, halt.

## Later procedure

Run these steps only after the preconditions hold. This pull request does not run them.

1. Connect to `https://agentic-records-manager.com/mcp` (streamable HTTP), the endpoint named in section 3 of the parent plan. Authenticate with the dedicated read-only key. Do not print the key.
2. Send `initialize`. Apply decision 5 as written. The only handshake write allowed is one server-generated last-seen timestamp. If `last_briefing_*` content, a counter, runtime usage, status, or processing is part of that handshake, halt. Do not reopen decision 5. Do not rewrite decision 2.
3. Send `tools/list`.
4. Save the raw list exactly as the server returned it, including each tool's argument schema. Store it outside git, mode `0600`. Record a sha256 of those raw bytes. Do not edit names before saving.
5. Halt unless the advertised name set is a subset of the static allow-list in the next section. One name outside that set halts the run. Do not skip a bad name and continue. Do not call the names that were inside the set after a bad name appears.
6. Record the argument schemas that `tools/list` actually advertised. Do not invent cursors. A cursor, page, or limit field is recorded only when that schema names it. If the schema names none, the record says so.

`initialize` declares no sampling. A server `sampling/createMessage` or `roots/list` is an error, then a halt (section 13). `notifications/tools/list_changed` drops permission, and the catalog is listed again before any later use. This procedure still does not send `tools/call`.

## Static allow-list

Halt unless the advertised set is a subset of:

- `get_pulse_head`
- `get_account_pulse`
- `get_standing_playbook`
- `get_deliverable_rollup`
- `list_work_items`
- `list_priority_part_lists`
- `get_project_status`
- `registry_insights` only if that exact string appears in the advertised list

`get_briefing` is not on the list. If it is advertised, halt.

Any claim, complete, post, `put_pulse_head`, `report_runtime_usage`, `propose_*`, or other mutator halts. That includes the section 3 soft-writes and hard-banned names (`complete_work_item`, `post_session_message`, `send_records_request`, `notify_user`, `ledger_commit`, `form_0`, `party_stamp`, `commit_work_plan`, `approve_documents`, and confirm / commit / approve / attach / mint / invite / register / harvest / offer paths). A name that is not in the subset list is a halt even when it is not in that mutator list. Do not skip a bad name and continue.

A missing name is allowed. The check is subset, not equality. `registry_insights` is part of the allowed set only when the server advertises that exact string. A different spelling is not renamed into it. That different spelling is outside the set and halts the run.

Do not invent names for BTB, certificates, or page text. Those wait for the phase-3 spec. Section 13 names the same gap as trace, life limits, record text, asset records, and certificates. Placeholder names are not verified and are not added here.

## Argument schemas

Copy each advertised tool's argument schema from the saved raw list into the run record. Field names, types, and required flags come from that payload.

Do not invent cursors. Do not add `cursor`, `next_cursor`, `page`, or `limit` because the parent plan discusses pagination. Section 7 says argument names and cursor fields stay unverified until `tools/list` runs, and the harness refuses to invent a cursor parameter the schema does not list. This procedure is that recording step. It does not send a cursor, and it does not send `tools/call`.

## What this spec does not do

- It does not mint a key.
- It does not call ARM, MCP, `initialize`, `tools/list`, or `tools/call`.
- It does not reopen decision 5.
- It does not rewrite decision 2.
- It does not print a key, and it does not use `ARM_MCP_PIN` or Todd's account.
- It does not invent BTB, certificate, or page-text tool names.
- It does not merge to `main` or to any pull request.

## Link

https://github.com/blockaero/openclaw-console/pull/1
