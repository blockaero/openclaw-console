# How the read-only smoke runs after ARM ships

This repo holds the client, the guard, and the option B smoke as scaffolding. It does not mint a key, and it does not call ARM. The default commands (`npm test`, `npm run smoke`, `npm run jobs`) keep the guard halted and use a transport that refuses `https://agentic-records-manager.com/mcp`.

The parent decisions are [PR #1](https://github.com/blockaero/openclaw-console/pull/1). The standing-reader shape folded in from [PR #2](https://github.com/blockaero/openclaw-console/pull/2) and [PR #3](https://github.com/blockaero/openclaw-console/pull/3) is the tool-less `arm-ro` profile and the scripted jobs under `profiles/arm-ro/`. Follow-on specs stay in PRs #4–#8.

## Handshake

Decision 5, decided 2026-10-05. On `initialize`, ARM may write one server-generated last-seen timestamp. That write is server-side. This client does not send it.

The client `initialize` body is fixed:

- protocol `2025-03-26`
- `capabilities` empty, so no sampling and no roots
- `clientInfo.name` `arm-readonly-guard`

The client refuses overrides. It does not send briefing fields (`principals.last_briefing_*`), counters, runtime usage, status, processing, or a last-seen value of its own. If an `initialize` result carries briefing content, a counter, runtime usage, status, sampling, roots, processing, or a non-empty model list, the guard halts before `tools/list` and before any `tools/call`.

`get_briefing` is not on the call list. Later `tools/call` rows still follow decision 2 once an auditor exists. This scaffold does not ask ARM to suppress those columns, and it does not perform the column diff.

## What runs in this repo today

| Piece | Where | Behavior now |
|---|---|---|
| Tool-less profile direction | `profiles/arm-ro/openclaw.json` | Checked by tests. Not applied to OpenClaw. |
| Policy hook | `profiles/arm-ro/policy.mjs` | Blocks every tool call. |
| Scripted jobs | `profiles/arm-ro/jobs.json`, `src/jobs.mjs` | Exact slot, no catch-up. Default run stays halted. |
| Guard | `src/guard.mjs` | Starts halted. Subset check, caps, one request in flight. |
| Client | `src/client.mjs`, `src/handshake.mjs` | Builds the decision 5 body. Sends a call only through an injected transport. |
| Smoke | `src/smoke.mjs` | Option B result, `openclaw_mcp_exercised: false`, `pass: false`. |
| Local score | `src/score.mjs` | Citation check when a model object is supplied. No model process. |

`npm run smoke` prints that blocked result and exits 0. `--live` is refused the same way and does not open a socket.

## What stays blocked on ARM

Do not mint, and do not point this scaffold at production, until every line below is true:

1. ARM has a read-only level that is not an alias of L0. An unknown level stays L0. Ledger tools stay closed to bots.
2. `tools/list` for that level omits claim, complete, post message, put pulse head, runtime-usage reporting, and every other name outside the phase-2 list in `src/policy.mjs`.
3. `initialize` for that level matches decision 5: one server-generated last-seen timestamp, no briefing write, no counters, no runtime usage, no status, and no processing.
4. A human has cleared the halt. This process starts halted, and `clearHalt` stays refused until the caller passes `armReadonlyLevelReady: true` together with a non-production transport.

Also still outside this scaffold, after that level exists:

- Minting one key per account, fingerprinting it against `ARM_MCP_PIN`, and storing it. The smoke plan's one-shot name is the env var on the accounts entry (`key_env`). The standing reader uses a Credential Manager target (`key_ref`). This code records the name and does not read either secret.
- Quiescing the live worker and confirming its model base URL stays `http://127.0.0.1:11434`.
- The Neon auditor (PR #6): before-image, mid-image, after-image. `zero_writes.pass` stays false here.
- The Ops console `ollamaFetch` route (decision 3). `tv_capture` stays `not_run`. Model calls in this scaffold are not sent to Ollama and are not described as captured.
- `openclaw doctor` on the installed `v2026.9.4` before anyone applies `profiles/arm-ro/`.
- PRs #4, #5, #7, and #8: the live `tools/list` procedure, the guard process spec, phase-3 tool names, and the CI write-trap ladder. Phase 3 in `jobs.json` has an empty tool list on purpose.

## After the ARM level exists

The read sequence is already the body of `runSmoke`. A later change supplies an HTTP transport and lifts the production-URL refusal in the same reviewed commit. Until that commit, `assertTransportNotLive` rejects the production endpoint even if a caller sets `armReadonlyLevelReady`.

Operator order, once that transport exists:

1. Confirm the ARM read-only level on the server. Leave this repository's default entrypoints halted until that is true.
2. On the MSI, write the accounts file outside git, mode `0600`. Each entry has `account_id`, `label`, and `key_env`. v1 is one entry. The loop in `runSmoke` does not branch on an account id.
3. Mint one dedicated read-only key per entry. Keep it out of `ARM_MCP_PIN`, the live `openclaw.json`, git, and the snapshot.
4. Quiesce the live worker for the window. Do not bind port 8788. Do not point the live agent at the console.
5. Run the smoke with `armReadonlyLevelReady: true` and the injected transport. For each account the guard sends `initialize`, then `tools/list`. One extra advertised name halts the run before `tools/call`. A missing phase-2 name is skipped. `registry_insights` runs only when that exact string is advertised.
6. Allow-listed reads use the fixed order in `PHASE2_TOOLS`, one request in flight, with the caps from the plan (10 pages, 200 records, 32MB, pulse 256KB). A cursor is sent only when that tool's advertised schema names the field.
7. Stop ARM for that account. The model step stays off until the console route exists. Official counts stay in code. `src/score.mjs` scores a supplied model object; it does not call a model.
8. The auditor diffs the window. The result's `pass` becomes true only when every account passes, `zero_writes.pass` is true, and `tv_capture` is `pass`. This scaffold always returns `pass: false`.
9. After the after-image, stop the process, leave the halt in place, and revoke the smoke key outside the diff. Leave `ARM_MCP_PIN` in place. Do not complete a work item.

`openclaw_mcp_exercised` remains false for option B. A passing smoke is evidence about read scope, grounding, and capture. It is not operating rights for the live agent.

## Job hooks

Command jobs use run id `job:account:slot`. The slot time is the scheduled time, passed in as `slotUtc`. The hook runs only when `slotUtc` equals `nowUtc`. Any other slot is `missed` and is not replayed. A run id already marked done is skipped.

Phase 2 jobs (`j1`, `j2`, `j3`) fetch only their own tool list, and only names the latest subset check certified. Phrasing is off. The state machine stops at `SEAL` because the next state, `AUDIT_MID`, is the auditor.

The `arm-ro` profile does not receive an ARM URL. Jobs call the in-process guard. If the guard is down or halted, nothing falls through to ARM.
