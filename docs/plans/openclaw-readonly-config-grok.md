# Read-only OpenClaw (production configuration)

Status: the live ARM reader is still a plan. No ARM or MCP call was made. No key was minted. `tools/list` was not run. A local console in this repo can play the fixture run (open account, open session, processed records, local work-item proposals) and show each step's input and output. Start it with `node console/server.mjs`. Those proposals are not posted to ARM. The server changes in section 5 are still required before a live key.

This is the standing reader that comes after the smoke in [docs/plans/openclaw-arm-readonly-smoke.md](openclaw-arm-readonly-smoke.md) (branch `cursor/openclaw-arm-readonly-smoke-7095`, PR #1). That smoke is option B: a harness outside OpenClaw. This plan is the later OpenClaw profile. It does not replace the smoke, and it does not reconfigure the live worker.

**Recommendation.** Keep the live Americas worker (`main`, full envelope) untouched. Add a second local path: a loopback MCP guard that holds a dedicated read-only key, and an OpenClaw agent `arm-reader` whose only ARM route is that guard. The model narrates. It does not choose tools, accounts, or the next state. Nothing in this profile claims, completes, posts, proposes, or starts ARM's Claude pipeline.

## Executive summary

Useful read-only work is answering questions and writing digests from records ARM already stores: pulse and project status, open work items (never claimed), playbook and registry gaps, and a code-computed change diff. Traceability lookups, certificate-expiry scans, and questions over OCR text wait until a live `tools/list` on the read-only key shows a tool that returns those rows without enqueueing OCR or classification. Page images stay in GCS. This profile does not fetch them and does not call Moondream.

ARM has no read-only level today. Reported L0 can still claim, complete, post, and set the pulse head, and runtime-usage reporting is allowed at every level. A client allow-list on today's pin is not read-only. The guard refuses to forward any `tools/call` until ARM ships a level whose advertised tool list is a subset of the allow-list below, `initialize` does not write `principals.last_briefing_*` for that level, and read handlers cannot start Claude work.

Approved smoke decisions still apply: dedicated key, Americas via a config list, Ops-console capture only as an explicit exception, and the only accepted soft writes are `principals.last_seen_at`, `principal_credentials.last_used_at`, and that principal's `chat_run_leases` heartbeat. Todd still has to say whether the standing reader keeps those three, or whether ARM must suppress them too.

## 1. How to read this plan

| Label | Meaning |
|---|---|
| **Verified in this repo** | Seen in `blockaero/openclaw-console` during this writing. |
| **Inherited from the smoke plan** | Stated in PR #1's plan. This session did not re-open the MSI, Neon, or ARM. |
| **Doc-derived** | Tool names from the smoke plan's MSI notes. Not confirmed by `tools/list`. |
| **Reported, not verified here** | From the smoke plan's report of `github.com/Block-Aero/[REDACTED]`. That repo returned HTTP 404 there. This session did not retry it. |
| **Published** | Public OpenClaw, Ollama, MCP, or model-card docs fetched for this plan. |
| **Assumed** | Planning inference. Not confirmed. |

**Verified in this repo.** `main` is commit `8363a1d`. The only other branch content read was the smoke plan. There is still no `openclaw.json` in git.

## 2. What "useful by reading only" means

The reader may:

- Build a status digest from pulse, project status, deliverable rollup, and work-item lists already stored.
- Answer a question by quoting fields in a snapshot the guard just stored.
- Diff today's snapshot against the previous one and narrate only the rows the diff names.
- Report gaps the code already computed: a work item with no doc type, a registry code that is not in the local copy of `doc_type_registry`, a pulse body marked truncated, OCR text absent.

The reader may not:

- Create, edit, claim, complete, approve, attach, mint, invite, register, harvest, or post anything in ARM.
- Send mail, Slack, or a session message. Heartbeat delivery target is `none`.
- Call `get_briefing` (it is the likely writer of `principals.last_briefing_*`).
- Call `report_runtime_usage` or any path that inserts `arm_agent_runtime_usage`.
- Trigger OCR, classification, extraction, briefing generation, or any other ARM pipeline step. ARM's own health, as recorded in the smoke plan, reports `vision_provider=claude` and `ai_model=claude-sonnet-5`. A read that causes that path to run is a failure even if the tool name sounds like a read.
- Fetch `record_blobs.gcs_uri`. Page bytes are not in Postgres. Existing `ocr_artifacts.page_texts` / `formatted_text` may be quoted only when a allow-listed tool returns them. Missing text is a gap, not a job to enqueue.
- Choose the next tool. The state machine in section 3 does.

"Cost-free" means no Claude call and no new row, for this principal, in `pipeline_log`, `chain_operations`, `asset_write_ledger`, `login_events`, `email_log`, or `arm_agent_runtime_usage`. Presence lease and last-seen are the smoke plan's decision 2. They are not free of writes. Section 13 asks Todd whether the standing reader keeps them.

## 3. Architecture

```text
arm-reader (OpenClaw agent, loopback gateway :18789)
    tools.allow = prefixed names only
    before_tool_call allow-list (fail closed)
    model calls -> 127.0.0.1:11434 only
        |
        |  MCP, no Authorization header
        v
arm-readonly-guard (127.0.0.1:18790)   <-- only process with the read-only pin
    fixed method set, static tool allow-list, arg denylist
    initialize capabilities omit sampling
        |
        v
https://agentic-records-manager.com/mcp     server envelope is the real lock
```

The live worker stays on its own pin (`ARM_MCP_PIN`) and its own model `baseUrl` `http://127.0.0.1:11434`. The reader never receives that pin. The guard never binds port 8788.

**Inherited from the smoke plan.** The Ops console that captures model traffic is port 8788. `app/openclaw_mcp_gateway.py` is reported to default to 8788. Those two already conflict with each other. The guard uses **18790** (**assumed** free; confirm on the MSI before the process exists). Gateway stays 18789. Ollama stays 11434.

**Published.** OpenClaw's gateway default bind is loopback, with a multiplexed port for control and HTTP. The MSI notes recorded `127.0.0.1:18789`. Keep that bind. Do not expose the reader.

**Published.** Configured MCP servers show up as plugin tools under `bundle-mcp`, named `serverName__toolName`. For a server key `arm`, the ids this plan will put in `tools.allow` are `arm__<tool>`. **Assumed** until `openclaw doctor` on the MSI prints the real ids. The guard's allow-list is the unprefixed ARM tool name.

### Where the guard lives

There is no shared ARM client library (**reported, not verified here**). OpenClaw talks to whatever URL is in `mcp.servers`. Putting the pin in that config, even behind a prompt rule, leaves a full HTTP client in the agent process.

The guard is a new local MCP proxy, a later change, not this PR. It is the only ARM client the reader has. It:

- Listens on `127.0.0.1:18790` only.
- Loads the pin from its own process environment, never from `openclaw.json` and never from `ARM_MCP_PIN`.
- Rewrites `initialize` to a fixed body: `protocolVersion` `2025-03-26`, no `sampling` capability, `clientInfo.name` `arm-readonly-guard`. Forwarding OpenClaw's capability blob is forbidden, because sampling lets the server ask the client to run a model (**published** MCP lifecycle).
- Forwards only `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`.
- Refuses `resources/*`, `prompts/*`, `sampling/*`, and any other method. The doc-derived resource `arm://account/pulse` is not tried. If pulse is needed, it is the tool `get_account_pulse`.
- On `notifications/tools/list_changed`, drops every in-flight call permission and re-runs the precheck before the next `tools/call`.

OpenClaw-side policy is a second lock, not the one that holds the secret:

- Agent id `arm-reader`. Not `main`. Workspace separate from the worker.
- `tools.profile: "minimal"`. `tools.allow` lists the prefixed read tools and nothing else. **Published:** `allow` and `deny` apply even when the sandbox is off; deny wins; `allow` and `alsoAllow` cannot both be set in the same scope.
- `tools.deny` still lists `group:runtime`, `group:fs`, `group:ui`, `group:web`, `group:messaging`, `group:nodes`, `group:media`, `group:automation`. A future tool that a profile starts allowing must hit the deny list.
- `tools.codeMode` left at the default `false`. **Published:** code mode puts MCP behind a guest `MCP.<server>.<tool>()` bridge. This profile does not enable that.
- `tools.elevated.enabled: false`.
- A plugin `before_tool_call` (and, if the build on the MSI has it, `registerTrustedToolPolicy`) whose allow-list is the same prefixed names. **Published:** `block: true` is terminal; a thrown error or the 15s hook timeout fails closed for `before_tool_call`. `block: false` does not override a block. The hook does not call `requireApproval`. An approval that can resolve to `allow-once` is a way to say yes. This profile has no yes path.
- `before_agent_run` blocks the turn when the selected model is not in the routing table. That contains a Control UI `/model` switch.
- No channel binding. Heartbeat `target: "none"`. Shell, ADB, browser, Slack, and email skills are not loaded for this agent. The worker may still have them. That is a reason the profiles stay split.

If the guard is down, the plugin blocks. OpenClaw must not fall through to `https://agentic-records-manager.com/mcp`. Startup lint: `arm-reader`'s MCP URL host is `127.0.0.1` and the port is `18790`. Any other URL is a broken config and the agent does not start.

### State machine

The worker loop in the ARM docs (briefing, pull work, claim at most 3, complete, propose when unsure) is forbidden here. Code owns every transition. The model is called only from `NARRATE`, and the call has tools omitted.

| State | Who decides | Exit |
|---|---|---|
| `HALTED` | A human deletes the halt file | `PRECHECK` |
| `PRECHECK` | Guard | `tools/list` is a subset of the allow-list, no mutator name, `readOnlyHint` not required for the decision. Else `HALTED`. |
| `SNAPSHOT` | Fixed tool order, one RPC in flight | Snapshot JSONL written, or `HALTED` on a bad status. |
| `AUDIT_MID` | Neon read-only diff | Only decision-2 columns for this principal. Else `HALTED` and kill switch. |
| `DIFF` | Code, previous snapshot vs this one, by etag then payload hash | No change → `IDLE`. Change → `NARRATE`. |
| `NARRATE` | Routing table picks the model | Citation check fails → store the failure, do not retry into a tool. Then `AUDIT_AFTER`. |
| `AUDIT_AFTER` | Same diff as mid | Model step must add no ARM delta. Else `HALTED`. |
| `IDLE` | Clock | Next cadence tick → `PRECHECK`, unless `HALTED`. |

`get_briefing` is not a state.

### Model routing

Fixed table. The model does not pick a row. OpenClaw fallbacks for this agent are `qwen3:8b` only, and only when `qwen3:14b` fails to load. No cloud model is in the fallback list. **Published:** an explicit user `/model` choice does not walk fallbacks; `before_agent_run` still rejects a model outside the table. Heartbeat model overrides do not inherit the session fallback chain, so the heartbeat row names `qwen3:8b` itself.

Sampling for every local row: `temperature` 0, `seed` 20261005, `top_p` 1, `think` / `thinking` false. **Published:** Ollama accepts `options.seed`, `options.temperature`, `options.num_ctx`, and top-level `keep_alive`. OpenClaw's native Ollama provider forwards `seed` and `temperature`, injects `options.num_ctx`, and with `temperature: 0` normalizes `top_p` to 1. `params.thinking: false` disables Qwen-style thinking.

| Task type | Model | `num_ctx` | Input cap (est. tokens) | `num_predict` | Cloud |
|---|---|---|---|---|---|
| Heartbeat tick, empty diff | none | — | — | — | no |
| Heartbeat tick, non-empty diff | `qwen3:8b` | 4096 | 1,500 | 256 | no |
| Status digest, gap report, change narration | `qwen3:14b` | 4096 | 2,400 | 1,024 | no |
| Record Q&A over one snapshot object | `qwen3:14b` | 4096 | 2,400 | 1,024 | no |
| `hard_judgment` | disabled | — | — | — | off until Todd names a provider |

`qwen3:8b` is the fallback row for the 14b tasks if `ollama ps` cannot show the 14b load as 100% GPU. It is not a second opinion. `deepseek-r1:14b` is not in the table. `moondream` is not in the table.

### VRAM budget (12 GB RTX 4070)

Not measured on the MSI in this session. The reader asks Ollama for the window below and then reads `ollama ps`. A load that is not `100% GPU` is aborted. The job is not "good enough" on a CPU split.

| Fact | Source | Use |
|---|---|---|
| Ollama's API default context is 4,096. `OLLAMA_CONTEXT_LENGTH` overrides it. | Published, docs.ollama.com FAQ | Set `num_ctx` on the request anyway. |
| Modelfile `PARAMETER num_ctx` default is documented as 2,048. | Published, docs.ollama.com Modelfile | Same remedy. Do not rely on either default. |
| `qwen3:8b` download 5.2 GB, library badge 40K. `qwen3:14b` download 9.3 GB, library badge 40K. | Published, ollama.com/library/qwen3 | The badge is the model max, not a 12 GB resident window. Do not request 40,960. |
| Qwen3 native context 32,768; 131,072 only with YaRN. `config.json` often has `max_position_embeddings` 40,960 and `rope_scaling` null. | Published, Qwen3 technical report and Hugging Face card for the 32B sibling; the smoke plan already treated 8B/14B as the same family | YaRN stays off. 32K is not requested on this GPU. |
| `deepseek-r1:14b` download 9.0 GB, library badge 128K. | Published, ollama.com/library/deepseek-r1 | Unused. A third-party note says this distill has no GQA, so KV grows faster than Qwen3. Not verified on the card page fetched here. |
| `moondream:latest` 1.7 GB, library badge 2K. | Published, ollama.com/library/moondream | Unused. Page bytes are not local. |
| Qwen3-14B Q4_K_M on a 12 GB 4070 is a tight fit: third-party estimates put 4k-context resident use around 10.4–10.7 GB of ~11 GB usable, and 32k context as an OOM. | Third-party (localmodel.run, llmconfigurator, smeltcore). They disagree by about a gigabyte. | Plan on 4,096. Try 8,192 only if a one-token probe shows `100% GPU` and leaves the process up. Never 32,768. |

**Assumed.** A Windows desktop compositor reserves some of the 12 GB. The `ollama ps` check is the measurement. Third-party tok/s figures are not used.

Moondream is kept loaded on this machine today (**inherited from the user brief and the smoke plan**). `OLLAMA_MAX_LOADED_MODELS` is a server-wide knob (**published** FAQ; default is 3 per GPU). Do not set it. It would change the live worker. The reader instead:

- Sends `keep_alive: 0` for `moondream` only when it is about to load `qwen3:14b`.
- Aborts the 14b call if `ollama ps` still shows another model and the 14b load is not 100% GPU.
- Uses `OLLAMA_NUM_PARALLEL=1` only if Todd accepts a server-wide change. **Published:** parallel slots multiply context memory. Until that is explicitly changed, the reader still requests `num_ctx` 4096 and aborts on CPU offload. Do not raise parallelism to "go faster."

Set `OLLAMA_NO_CLOUD=1` (or `disable_ollama_cloud` in the Ollama server json) so a cloud model tag cannot be selected through Ollama. **Published** FAQ. That is a server-wide switch. Call it out to Todd before flipping it, because it also disables Ollama cloud for the worker.

`hard_judgment` stays off. If Todd later names a provider and a pinned model id, the row turns on only when a deterministic rule fires (two cited fields contradict, or the local citation check failed twice). The model does not set `needs_cloud`. Record text would leave the machine on that row. Default is off.

## 4. ARM allow-list

A name is callable only when all of these are true:

1. It is in the static allow-list in this section.
2. The read-only key's `tools/list` includes it.
3. `tools/list` as a whole is a subset of this allow-list. One extra name, including a renamed mutator, halts the run. The guard does not "skip the bad tool and continue."
4. ARM's envelope allows it for this principal. A denial (`tool_denied_for_principal`, `envelope_denies_tool`) is a stop, not a retry. **Inherited from the smoke plan** as the denial names on the MSI notes.
5. Every argument key is in that tool's advertised `inputSchema`, and none of the keys match the denylist. The denylist is a substring check, case-insensitive: `process`, `ocr`, `classify`, `extract`, `brief`, `generate`, `reprocess`, `force`, `enqueue`, `claim`, `complete`, `approve`, `commit`, `post`, `notify`, `send`, `stamp`, `ledger`. **Assumed** as a client backstop. Real argument names are unknown until `tools/list`.
6. The guard's copy of the pure-read registry and the registry ARM reports for that tool (section 5) both say `pure_read`.

`readOnlyHint` is not in that list. **Published** MCP 2025-03-26: annotations are hints, clients must treat them as untrusted unless the server is trusted, and the defaults are the cautious ones (`readOnlyHint` false, `destructiveHint` true). ARM should set the hints anyway. The guard still uses the static list.

### Allowed (all doc-derived, none verified by `tools/list`)

| Tool | Status | v1 use | Cost-free bar |
|---|---|---|---|
| `get_pulse_head` | Doc-derived | One call per snapshot | No pipeline row, no Claude |
| `get_account_pulse` | Doc-derived. Etag/delta, 256 KB cap | One call. Store etag. Do not poll at 15–30 s | Same. Truncation flag stored, not "fixed" by another call |
| `get_standing_playbook` | Doc-derived | One call | Same |
| `get_deliverable_rollup` | Doc-derived | One call | Same |
| `list_work_items` | Doc-derived | Paged, caps below. Never claim or complete | Same. A response that shows `claimed_by` changed to this principal is a halt |
| `list_priority_part_lists` | Doc-derived | Paged, caps below | Same |
| `get_project_status` | Doc-derived | One call | Same |
| `registry_insights` | Doc-derived. Exact advertised name unverified | One call, and only if the advertised string is exactly this | Same |

Fixed call order is the table order. Caps, **proposed** in the smoke plan and reused here: 10 pages per list tool, 200 records per tool, 32 MB raw JSON per snapshot, pulse stops at the doc-derived 256 KB cap. One request in flight. Follow a cursor only if the schema or the page names one.

### Not allowed

| Name or class | Why |
|---|---|
| `get_briefing` | Dropped in the smoke plan. Columns `principals.last_briefing_version`, `last_briefing_at`, `last_briefing_via` exist. Decision 2 does not allow them to move. |
| claim work item, `complete_work_item` | Writes. Reported to exist even at L0. |
| `post_session_message`, `notify_user`, `send_records_request` | Posts or sends. |
| `put_pulse_head` | Writes the pulse head. |
| `report_runtime_usage` | Inserts `arm_agent_runtime_usage` when tokens > 0. Doc-derived name; table name is schema-verified in the smoke plan. |
| `propose_*` | Proposal rows. |
| `ledger_commit`, `form_0`, `party_stamp`, `commit_work_plan`, `approve_documents`, offer accept/send, factory staff APIs | Hard banned in the smoke plan. |
| Any tool whose name is not in the allowed table | Fail closed. |
| `resources/read` of `arm://account/pulse` | Unverified side channel. Not used. |

**Not in the allow-list, and not invented here.** No tool name was verified for back-to-birth rows, certificate forms, or `ocr_artifacts.page_texts`. Those tables exist (**inherited from the smoke plan**, schema read). The jobs that need them are phase 5 and stay off until a real `tools/list` entry is classified `pure_read` and added to this file in a later revision. This plan does not propose names for them.

### How a call is proved non-mutating and cost-free before it is sent

Before is a static proof. After is a measurement. Both are required. A static proof that is wrong fails the after-check, and the after-check's failure removes the tool.

Before the guard sends `tools/call`:

- The six gates above pass.
- Kill switch is clear (section 7).
- The previous run for this account ended `IDLE` or `AUDIT_AFTER` with a clean diff. A `HALTED` account does not get a courtesy retry.
- The account id on the request, if the schema has one, equals the config entry for this key. The client does not hardcode the Americas id in code. It does refuse a mismatch.
- `initialize` has already been audited once this process life for `last_briefing_*` unchanged (section 5). Until that audit exists, `tools/call` is not sent.

The guard does not ask the model whether a tool is safe.

After each snapshot, and again after narration:

- Read-only SQL, the role from the smoke plan, not the application role.
- Diff `pipeline_log`, `chain_operations`, `asset_write_ledger`, `login_events`, `email_log`, `arm_agent_runtime_usage`, and `agent_work_items` columns `claimed_at`, `claimed_by`, `status`, `finished_at`, `result`.
- Diff `principals.last_briefing_*` for this principal. A change fails.
- Allow only decision-2 columns for this principal: `principals.last_seen_at`, `principal_credentials.last_used_at`, `chat_run_leases` heartbeat columns `heartbeat_at`, `started_at`, `status` for this `principal_id`. Any other `kind` fails. `kind` values were not enumerated in the smoke plan.
- These last-seen columns are not allowed: `account_users.last_seen_at`, `part_identities.last_seen_at`, `photo_marking_priors.last_seen`, `demo_visits.last_seen`.
- A new `pipeline_log` row fails even when the only effect was Claude. Cost is `cost_usd` on that table (**inherited**).

**Gap.** The smoke plan does not say `pipeline_log` has a `principal_id`. `chain_operations` has `actor`. If a row cannot be attributed, any new row during the window fails the reader. That will also trip when the live worker OCRs during the window. Section 5 requires ARM to stamp the principal on those tables so the standing reader can run beside the worker. Until that stamp exists, the reader runs only in a window where the worker's ARM plug is disconnected, same as the smoke.

## 5. What ARM must change on the server

This PR does not change ARM. Reported contract (**not verified in this session**): role narrowed by autonomy L0–L4; ledger tools closed to bots; `tools/list` shows only callable tools; unknown level means L0; no read-only role; no per-key scopes found; L0 can claim, complete, post, and set the pulse head; runtime-usage reporting is allowed at every level. Files named in that report, still unread here: `app/principal_envelope.py`, `app/routers/mcp.py`, `app/openclaw_mcp_gateway.py`, `deploy/AGENT_RUNTIME.md`, `deploy/GROK_RM_SKILL.md`, `deploy/ARM_RM_HEARTBEAT.md`, `AGENT_AUTONOMY_PLAN.md`.

Required before a key is minted:

1. Add a bot level that is not an alias of L0. Name it `read_only`. Unknown level stays L0, so a missing level does not become the reader.
2. In the envelope, `tools/list` for `read_only` returns only tools in a server-side pure-read registry. `tools/call` denies every other name with the existing denial, even if the client sends it. Filtering the list without enforcing the call is not the change.
3. The registry omits claim, complete, post message, put pulse head, `report_runtime_usage`, `propose_*`, `send_records_request`, `notify_user`, ledger tools, and the hard-banned set in section 4. `get_briefing` stays off until its briefing write is gone.
4. A handler is added to the registry only with a test that it does not call the Claude vision/LLM path and does not insert the log tables in section 4. Missing OCR or a missing classification returns the stored artifact or a gap flag. It does not enqueue work.
5. `initialize` for a `read_only` principal does not write `principals.last_briefing_*`. **Reported** that `deploy/AGENT_RUNTIME.md` says initialize may update those columns. That write is outside decision 2.
6. No implicit `arm_agent_runtime_usage` insert on a `read_only` call, and `report_runtime_usage` is denied at this level. Token totals stay on the MSI.
7. Stamp `principal_id` (or the existing actor column, if one already covers the row) on `pipeline_log`, `chain_operations`, `asset_write_ledger`, `login_events`, `email_log`, and `arm_agent_runtime_usage`. The reader cannot prove a cost-free call if those rows are anonymous.
8. Bind the principal to one account. An argument account id that does not match is denied. v1's account is the Americas row the smoke plan recorded (`accounts.id` `88fc877e-6b5d-407f-bbab-88ee95db0f04`). The client still loops a config list and does not branch on that id.
9. On every `read_only` tool result, include two fields the guard checks before it accepts the payload: `processing_enqueued: false` and `models_invoked: []`. Absent either field, the guard treats the call as unproven and halts. **This is an ARM extension. It is not in MCP 2025-03-26.** Mark the schema so a normal MCP client can ignore it.
10. Set annotations `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` on those tools. Hints are not the lock. They stop a future client from defaulting the tool to "destructive."
11. Keep decision 2 as the only side effects, until Todd says otherwise: `principals.last_seen_at`, `principal_credentials.last_used_at`, and the presence lease row for that principal. No other column moves. If Todd wants a true zero-write reader, ARM adds a flag that skips those three as well. This plan does not assume that flag exists.
12. Do not build per-key scopes as a substitute. The reported search found none. A level the envelope understands is the change that matches the code that exists. Scopes can follow. They are not the blocker.

The pure-read registry is the determinism boundary on the server. Adding a tool is a reviewed edit to that registry plus a test, not a prompt change and not a model judgment.

## 6. Job catalog

Each job reads the snapshot the guard wrote. Narration uses the smoke plan's citation check: JSON only, closed classification labels, every cited path must match the payload, digit runs of length 4 or more in the summary must appear in the source JSON. One repair retry on a parse failure. No third call. Output is not sent back to ARM.

| Job | Inputs | ARM reads | Model | Output |
|---|---|---|---|---|
| Status digest | Config account list, one account per run | The allowed table, in order | `qwen3:14b` if the snapshot is non-empty; else no model | A short digest whose claims are citation-checked. Counts are harness counts, not model counts. |
| Change detection | Previous snapshot etag and payload hash | `get_account_pulse`, then the rest only if the etag changed | `qwen3:8b` on the diff only | "No change" is code, with no model call. A change narration lists the paths the diff computed. |
| Gap report | Snapshot plus a local copy of doc-type codes | Allowed table. Registry file is local reference data, not a new ARM call | `qwen3:14b` to phrase the gaps the code found | Missing doc type, unknown code, truncated pulse, absent page text. The model does not invent a code. |
| Question over stored text | One snapshot object the user named by id | No extra ARM call if the object is already in the latest snapshot. If it is not, one snapshot cycle, then the question | `qwen3:14b`, one object, tools omitted | Answer that quotes paths. Refuses when the object is absent. |
| Traceability lookup | Part or asset id | None until a pure-read tool for `btb_*` is on the allow-list | — | Not in v1. The gap is the output: "no read tool verified." |
| Certificate or life-limit expiry | — | None until a pure-read tool returns those rows | — | Not in v1. Do not scan Neon for the row bodies. |
| OCR question | — | None that fetches `gcs_uri` or starts OCR | Moondream not used | Not in v1. If a later tool returns `page_texts`, the text joins the Q&A job. Images stay out. |

Excluded from every snapshot, same as the smoke plan: `neon_auth`, KYC documents, credentials, invitations, wallets and invoices, form 0, harvest, offers, and chat message bodies.

## 7. Guardrails

| Control | Where it is enforced | Fail-closed behavior |
|---|---|---|
| Tool allow-list | ARM envelope, guard, OpenClaw `tools.allow`, `before_tool_call` | Any name outside the list is not sent. A `tools/list` that is not a subset halts all calls. |
| Argument denylist | Guard | Unknown key or denied key: the call is not sent, the run halts. |
| No sampling | Guard rewrites `initialize` | A server sampling request is a protocol error and a halt. |
| Audit diff | Read-only SQL before narration and after | Unexpected delta halts, revokes nothing by itself, and sets the kill switch so the next tick does not run. |
| Kill switch | A halt file the guard reads before every RPC, plus `ARM_READER_ENABLED=0` in the guard process | Default for a new install is disabled. The file existing, the env var `0`, a hook timeout, or three identical errors stops ARM traffic. |
| Standing rule | Guard | The same error three times stops the run. 400, 401, 403, 404 are not retried. 403 is not a miss. |
| Secrets | Guard process environment only | See below. |
| Prompt injection | Narration request omits tools. Record bytes sit in a data fence. Output is parsed as JSON and not executed. | A model request to call a tool is a failed citation, not a call. |

Kill switch order, after the after-image so a revoke does not land inside the diff:

1. Stop the guard. Confirm it is not listening on 18790.
2. Leave the halt file in place.
3. Revoke the reader key. That is an admin action outside the diff window. Leave `ARM_MCP_PIN` in place.
4. Confirm the worker's `openclaw.json` model `baseUrl` is still `http://127.0.0.1:11434` and its MCP URL was never pointed at the guard.
5. Do not complete a work item if one was claimed. Stop and tell Todd.

### Secrets on Windows

**Inherited from the smoke plan.** The live secret is the user env var `ARM_MCP_PIN`. The MSI notes also placed a bearer under `mcp.servers.arm` in `~/.openclaw/openclaw.json`. This session did not re-open the laptop, so it still cannot show whether that JSON holds a literal.

The reader pin is a different secret. It is not written to `openclaw.json`, git, the snapshot, the console ring, Slack, or email.

**Published.** On OpenClaw v2026.9.4, which the MSI notes recorded, GitHub issue 141972 reports that `mcp.servers.*.headers` does not accept a SecretRef (the schema was string/number/boolean). A later PR (69417) proposes SecretRef for MCP env and headers. Do not depend on that PR being what the MSI runs. The guard makes it irrelevant: the OpenClaw config has no ARM header.

**Published.** OpenClaw file SecretRefs fail closed on Windows when ACL verification is unavailable. A user-wide environment variable is the wrong store for the reader pin, because a user-level variable is inherited by every process of that user, including the gateway (**published** Ollama FAQ describes the same Windows user-env inheritance; OpenClaw's own process would see it too).

Store the pin as an environment variable on the guard's service or scheduled task only. Name it from the accounts config `key_env` (v1: `ARM_READONLY_PIN_AMERICAS`). Do not also define it as a user or system variable. Startup check, hashes only: the guard has the var, a process listing of the gateway does not show the name in its environment block, and the hash differs from `ARM_MCP_PIN`. Printing the value fails the check.

Accounts config stays on the MSI, mode `0600`, outside git, the same shape as the smoke plan. v1 has one entry. The id below is inherited from the smoke plan's Neon read, not re-read here.

```json
{
  "accounts": [
    {
      "account_id": "88fc877e-6b5d-407f-bbab-88ee95db0f04",
      "label": "block-aero-americas-nap8",
      "key_env": "ARM_READONLY_PIN_AMERICAS"
    }
  ]
}
```

Illustrative OpenClaw fragment. Not applied by this PR.

```json5
{
  agents: {
    entries: {
      "arm-reader": {
        workspace: "~/.openclaw/workspace-arm-reader",
        model: { primary: "ollama/qwen3:14b", fallbacks: ["ollama/qwen3:8b"] },
        heartbeat: {
          every: "30m",
          activeHours: { start: "06:00", end: "20:00", timezone: "America/Los_Angeles" },
          model: "ollama/qwen3:8b",
          isolatedSession: true,
          lightContext: true,
          target: "none",
        },
        tools: {
          profile: "minimal",
          allow: [
            "arm__get_pulse_head",
            "arm__get_account_pulse",
            "arm__get_standing_playbook",
            "arm__get_deliverable_rollup",
            "arm__list_work_items",
            "arm__list_priority_part_lists",
            "arm__get_project_status",
            "arm__registry_insights",
          ],
          deny: [
            "group:runtime",
            "group:fs",
            "group:ui",
            "group:web",
            "group:messaging",
            "group:nodes",
            "group:media",
            "group:automation",
          ],
        },
      },
    },
  },
  mcp: {
    servers: {
      arm: { url: "http://127.0.0.1:18790/mcp" },
    },
  },
}
```

The `arm__` prefix is **assumed**. If doctor prints different ids, the allow list changes to those ids and the guard's unprefixed list does not. `registry_insights` stays in the file only while it remains the exact advertised name. A mismatch means delete it, not guess.

Models on this agent set `temperature: 0`, `seed: 20261005`, `top_p: 1`, `num_ctx: 4096`, `thinking: false` in the Ollama provider entry. **Published** path: `models.providers.ollama.models[].params`.

## 8. Heartbeats and routines

The live worker heartbeat stays as the MSI notes described it: `qwen3:8b`, every 30 minutes, 06:00–20:00 America/Los_Angeles, `isolatedSession`, `lightContext`. This plan does not edit it. The BOM heartbeat files that still say port 8787 stay untouched.

The reader heartbeat is a separate agent, same clock and cadence, `target: "none"`, model `qwen3:8b` only when the diff is non-empty.

| Rule | Behavior |
|---|---|
| Cadence | 30 minutes inside 06:00–20:00 America/Los_Angeles. Outside that window the guard accepts no reader RPC. The worker's 15–30 s pulse poll is not copied. |
| Idempotency | Snapshot key is account id + tool name + etag, or payload hash when no etag. Unchanged etag → no model call, and the rest of the tool order is skipped. Replaying a stored snapshot does not call ARM. |
| One in flight | A tick that starts while the previous tick is in `SNAPSHOT` or `NARRATE` is dropped, not queued. |
| Backoff | HTTP 429 or 503: 5 s, then 10 s, then 20 s. The third failure writes the halt file. |
| No retry | 400, 401, 403, 404. |
| Halt | While the halt file exists, heartbeats do not call ARM and do not call the model. A human clears it. |
| Lease | Each allowed RPC may still move decision-2 columns. The diff expects that and nothing else. |

**Published.** `isolatedSession: true` avoids heartbeat model bleed into the shared session. `lightContext: true` keeps the heartbeat prompt small. Use both. The empty-diff path should not reach the model at all: `before_agent_reply` returns `{ handled: true }` with no reply when the guard's latest diff is empty. That is code, not a hope that the model says `NO_REPLY`.

## 9. Observability

The live agent's model URL stays `http://127.0.0.1:11434`. **Inherited:** `ollamaFetch` only sees calls the Ops console itself makes, and decision 3's console exception was for the smoke harness, not for this standing agent. Do not point `arm-reader` at port 8788.

Replay store, on the MSI, mode `0600`, outside git: `~/openclaw-reader/runs/<utc>/<account_id>/`.

| Artifact | Contents | Replay role |
|---|---|---|
| `snapshot.jsonl` | Manifest, each RPC's arg keys and response hash, each record payload | The only model input. A replay uses this file and does not call ARM. |
| `trace.jsonl` | `run_id`, state transitions, method, tool, duration, etag, `processing_enqueued`, `models_invoked`, audit summary, model, `num_ctx`, seed, temperature, `prompt_eval_count`, prompt sha256 | Explains which action ran. |
| `prompt.txt` | The exact narration prompt | Same seed + same prompt is the replay. Prose may still differ across GPU drivers. The action must not. |
| `audit.json` | Before/mid/after diffs and the decision-2 rows | The pass/fail record. |

Prompt text is not what the TV shows by default. A later console importer may read `trace.jsonl` into the Context view. That importer is not this PR, and it is opt-in per run (`tv_content: redacted` unless Todd sets `full` for a sitting). The ring (30 batches or about 20 MB, **inherited**) is the wrong place for the standing record. The JSONL is the record.

**Published.** `model_call_started` / `model_call_ended` can log timing without raw conversation text. Use them as a cross-check that a narration happened. They are not the replay.

Every run is explainable when the trace lists the states, the tool names in order, the etag, the model row, and the audit result. "The model decided to look" is not a state the trace is allowed to contain.

## 10. Phased checklist

- [ ] **Phase 0 — this document.** Plan only. No key, no ARM call, no config edit.
- [ ] **Phase 1 — ARM.** Ship section 5. `tools/list` for a `read_only` principal is a subset of section 4. `initialize` does not touch `last_briefing_*`. Handlers cannot enqueue Claude. Log rows carry a principal. Todd has answered section 13 items 1 and 2.
- [ ] **Phase 2 — smoke.** Run option B from the smoke plan on that key. Pass means the audit is clean and the harness never had a tool. `openclaw_mcp_exercised` stays false. A failed smoke stops the later phases.
- [ ] **Phase 3 — guard.** Loopback process on 18790, pin only in that process, method and tool allow-lists in code, halt file defaulting to disabled. Unit tests: a mutator name is not forwarded; a `tools/list` superset halts; sampling is stripped; a missing `processing_enqueued` halts.
- [ ] **Phase 4 — profile.** Create `arm-reader` as in section 7. Confirm doctor ids. Confirm the gateway process environment does not contain the reader pin. Confirm the worker `baseUrl` is unchanged. First live cycle is one account, one snapshot, audit, no narration if the audit is not clean.
- [ ] **Phase 5 — jobs.** Enable digest, change detection, and gap report. Q&A only over snapshot objects. Traceability, expiry, and OCR stay off until a pure-read tool is added to section 4 in writing.
- [ ] **Phase 6 — beside the worker.** Only after log rows are attributable. Until then the worker's ARM path stays disconnected for any reader window, as in the smoke.

## 11. Non-determinism register

| Place | Why it varies | How it is contained |
|---|---|---|
| Narration prose | Temperature 0 and a seed are not a bit-stable guarantee across Ollama or driver upgrades. Ollama's docs say a seed makes the same prompt return the same text. Treat that as the vendor claim. | The model does not choose the state, the tool, the arguments, or the account. The citation check rejects unsupported claims. A different paragraph with the same citations is still the same action. |
| Which records are narrated | A model asked to "pick the important ones" will drift. | Code selects: changed etag first, then the gap list, cap 20 objects, the smoke plan's sample cap. |
| `hard_judgment` | A cloud model is a second non-deterministic system, and it exports record text. | The row is off. A future rule fires from contradictions in cited fields, not from the model asking. |
| OpenClaw fallback and `/model` | Failover timing and a UI override can change the model. | Fallback list is `qwen3:8b` only. `before_agent_run` rejects anything else. No cloud id is configured. |
| `tools/list` order and `list_changed` | The server can reorder or add tools. | Guard sorts names, hashes the set, and halts unless the set is a subset of section 4. |
| Pulse contents | The account changes. | Etag and payload hash. Unchanged means no model call. |
| Hook timeout (15 s) and hook errors | **Published** fail-closed for `before_tool_call`. | A timeout blocks the tool. It does not allow it. |
| Ollama queueing | **Published:** a busy server returns 503; queued requests run in order when memory is short. | One request in flight. 503 backs off three times, then the halt file. |
| GPU residency | Another model (Moondream kept loaded) can force CPU offload. | Abort unless `ollama ps` shows 100% GPU for the chosen tag. Do not flip the server-wide max-loaded-models knob in this phase. |
| Audit raced by the worker | Anonymous `pipeline_log` rows. | Until ARM stamps a principal, any new row fails, and the reader does not run while the worker is connected to ARM. |
| Clock | A timezone mistake looks like a missed day or a night run. | `America/Los_Angeles` is set on the heartbeat. Outside the window the guard refuses. |

Model judgment is confined to `NARRATE`. Everywhere else the input determines the action.

## 12. Risks

1. **The envelope is the only real lock, and it does not exist yet.** OpenClaw policy and the guard are bypassable by anyone who puts `ARM_MCP_PIN` back into a profile. Phase 4's lint has to make that URL impossible for `arm-reader`, and the worker pin must stay on the worker only.
2. **A read that enqueues Claude will look like a successful tool call.** The client cannot see `pipeline_log` from inside MCP. Without `processing_enqueued` / `models_invoked` and an attributable `pipeline_log`, the after-diff is the only proof, and it is too late to stop the charge. The halt file stops the next call. It does not un-bill the one that ran.
3. **Decision 2 still writes.** Last-seen and the lease are creates or updates. They are accepted for the smoke. Calling the standing reader "read-only" without saying so overclaims. Section 13 asks for an explicit keep-or-suppress.
4. **Unverified tool names.** Section 4 may not match production. The precheck is designed to halt on that, which is safe and also means v1 may do nothing useful until the names are confirmed. That outcome is a pass of the safety bar, not a prompt to add tools.
5. **12 GB is shared with a kept-loaded Moondream and the worker's models.** A 14b digest can OOM or spill to CPU. Spilling changes latency and can truncate context while HTTP still returns 200 (**inherited** from the smoke plan's operator note). The abort on a non-100% GPU load is the mitigation.
6. **Secret inheritance on Windows.** A user-level env var would land in the gateway. The plan avoids that. A scheduled-task env is only as tight as the task ACL. Verify with a process listing before the first connect.
7. **Port 18790 is assumed free.** If something else binds it, do not move the guard to 8788.
8. **This session did not read ARM source.** Section 5 can be wrong in detail (column names, initialize behavior). It is not wrong in the requirement: the server must refuse mutators for this principal, including the ones L0 has today.

## 13. Open questions for Todd

1. **Blocks the first `initialize`.** Same question as the smoke plan: either ARM skips `principals.last_briefing_*` for `read_only`, or you approve an exception for `initialize` only. Until one of those is true, the guard does not connect.
2. **Blocks the meaning of "read-only."** Keep decision 2 (last-seen, credential last-used, presence lease) for the standing reader, or require ARM to suppress those too? This plan keeps them until you say otherwise.
3. Name a cloud model for `hard_judgment`, or leave it off. Off is the plan.
4. May the reader run while the live worker is still connected to ARM? Only after log rows carry a principal. Until then, no.
5. Is `OLLAMA_NO_CLOUD=1` acceptable on this machine? It also disables Ollama cloud for the worker.
6. Confirm on the MSI, when a later phase starts: port 18790 is free, the live secret is only `ARM_MCP_PIN`, and `openclaw.json` does not also store a pin literal. Unverified here.

Closed by the smoke plan and not reopened: dedicated key, Americas through a config list, console capture as a smoke-only exception, no Moondream on GCS blobs in v1.

## 14. Smallest next 3 steps

1. ARM ships the `read_only` level and the side-effect rules in section 5. Do not mint a key before `tools/list` for that level would omit claim, complete, post, put pulse head, and runtime-usage reporting.
2. You answer section 13 items 1 and 2 (`initialize` briefing columns, and whether the lease stays).
3. Run the option B smoke from PR #1 against that key. Only a clean audit starts the guard (phase 3). The OpenClaw profile comes after the guard's unit tests, not before.

## 15. Sources

Fetched 2026-10-05. ARM was not called.

Published, used:

- OpenClaw gateway runbook, https://docs.openclaw.ai/gateway/ — loopback gateway, default port 18789 in the startup snippet.
- OpenClaw tool policy, https://docs.openclaw.ai/gateway/config-tools/tool-policy — profiles, `tools.allow` / `tools.deny`, MCP ids, sandbox gate, `tools.codeMode`.
- OpenClaw tool-call hooks, https://docs.openclaw.ai/plugins/hooks/tool-policy — `before_tool_call` block semantics.
- OpenClaw hook reference (via search snippet and the tool-policy page) — 15 s fail-closed timeout on `before_tool_call`.
- OpenClaw heartbeat, https://docs.openclaw.ai/gateway/heartbeat — `isolatedSession`, `lightContext`, heartbeat model bleed.
- OpenClaw Ollama advanced, https://docs.openclaw.ai/providers/ollama/advanced — `num_ctx` injection, `seed`, `temperature`, `thinking`.
- OpenClaw model failover, https://docs.openclaw.ai/model-failover — explicit `/model` does not walk fallbacks.
- OpenClaw secrets, https://docs.openclaw.ai/gateway/secrets — SecretRefs; Windows file ACL fail-closed described in the fetched secrets doc.
- GitHub issue openclaw/openclaw#141972 — on v2026.9.4, `mcp.servers.*.headers` reported not to accept SecretRef.
- MCP lifecycle 2025-03-26, https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle — `initialize` capabilities, including sampling.
- MCP tools 2025-03-26, https://modelcontextprotocol.io/specification/2025-03-26/server/tools — `tools/list`, `tools/call`, annotations untrusted, human-in-the-loop SHOULD.
- MCP blog, 2026-03-16, "Tool Annotations as Risk Vocabulary" — hint defaults are not enforcement.
- Ollama chat API, https://docs.ollama.com/api/chat — `seed`, `temperature`, `num_ctx`, `keep_alive`.
- Ollama FAQ, https://docs.ollama.com/faq — default context 4096, `ollama ps`, `keep_alive`, `OLLAMA_MAX_LOADED_MODELS`, `OLLAMA_NUM_PARALLEL`, `OLLAMA_NO_CLOUD`, Windows user env inheritance.
- Ollama Modelfile, https://docs.ollama.com/modelfile — `num_ctx` parameter default 2048, seed claim.
- Ollama library qwen3, https://ollama.com/library/qwen3 — 8b 5.2 GB / 40K badge, 14b 9.3 GB / 40K badge.
- Ollama library deepseek-r1, https://ollama.com/library/deepseek-r1 — 14b 9.0 GB / 128K badge.
- Ollama library moondream, https://ollama.com/library/moondream — latest 1.7 GB / 2K badge.
- Qwen3 technical report, https://arxiv.org/html/2505.09388 — long-context stage to 32,768 and YaRN for 4× at inference.
- Hugging Face Qwen/Qwen3-32B card — 32,768 native, 131,072 with YaRN, `max_position_embeddings` 40,960. Cited as the family card. The 14B card was not fetched separately.

Third-party VRAM estimates, not measurements: localmodel.run, llmconfigurator.com, smeltcore.com recipe for Qwen3-14B on a 12 GB 4070. They agree the card is tight at Q4 and that a 32k window does not fit. They do not agree on the exact gigabyte. `ollama ps` on the MSI is the check that matters.

Inherited, not re-verified here: the smoke plan in this repo's PR #1, including the public ARM identity (`arm`, protocol `2025-03-26`, version `0.185.10`, Claude Sonnet as ARM's own model), the Americas account id, the decision-2 columns, the log tables, and the MSI OpenClaw layout (gateway `v2026.9.4`, direct Ollama, no hard tool allow-list, worker heartbeat).

Could not verify: ARM source files, live `tools/list`, argument names, pagination fields, whether `registry_insights` is the exact tool name, which tool returns BTB or OCR text, whether `pipeline_log` has a principal column, whether port 18790 is free, whether the MSI `openclaw.json` stores a pin literal, and token rates on this RTX.
