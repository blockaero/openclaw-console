# Read-only OpenClaw for ARM: production configuration plan

Status: plan only, written 2026-10-05 for Todd. While writing it, nothing called ARM or any MCP server, no key was minted, and no code, OpenClaw config, Ops console, Neon, or ARM setting was changed. It extends the smoke-test plan in [PR #1](https://github.com/blockaero/openclaw-console/pull/1) (`docs/plans/openclaw-arm-readonly-smoke.md` on branch `cursor/openclaw-arm-readonly-smoke-7095`) and keeps that plan's four approved decisions.

## Executive summary

- **What it is.** A second OpenClaw gateway profile, `arm-ro`, on the same Windows laptop. It turns records already in ARM into digests, reports, and answers for the Americas account. It never asks ARM to do work.
- **The model never touches ARM.** The OpenClaw agent in this profile has no tools at all. ARM is reached only through a small local process, the **ARM read guard**. The guard holds the read-only key under its own Windows user and sends only certified read calls with schema-checked arguments. Code refuses everything else.
- **Jobs are scripts, not agent turns.** Scheduled work runs as OpenClaw command jobs. These run "deterministic scripts … without starting a model-backed turn" [S7]. Code fetches, diffs, and computes every number. A pinned local model (qwen3:8b, temperature 0, JSON schema) only phrases text. A code template replaces it whenever validation fails.
- **ARM must change first.** Today ARM has no read-only level, L0 can claim, complete, and post, and `initialize` may write briefing timestamps (reported).
  - Before any key is minted, ARM needs a read-only level without claim, complete, post, pulse head, or runtime usage. It also needs no handshake writes, a no-processing mode, and read-only transactions (S1–S7, section 3.4).
  - Before unattended runs, ARM needs audit attribution, per-call receipts, a per-release manifest, and a kill flag (S8, S9, S14, S16).
- **Proof before use.** A tool becomes callable only after a certification ladder: declaration, code review, CI write-trap, Neon branch diff, and an attended canary (C0–C4). After that, receipts and an audit diff check every run (C5).
- **Fail closed.** The system halts until a human clears it on any of these:
  - a write outside the approved last-seen and lease columns;
  - any processing signal;
  - an unexpected `tools/list`;
  - a hook or guard failure;
  - an audit that cannot be completed.
- **Phases.**
  - Phase 0: decisions and ARM changes.
  - Phase 1: local build against a mock ARM.
  - Phase 2: attended canary and three status jobs.
  - Phase 3: unattended runs, plus traceability, expiry, gap, and OCR-text lookups.
  - Phase 4: optional free-text questions, vision, and cloud.

Top risks are hidden side effects inside "read" tools, the live full-worker pin sitting in plaintext user environment on the same laptop, and audit attribution (section 10).

## How to read this plan

| Label | Meaning |
| --- | --- |
| **Verified in this repo** | Seen in `blockaero/openclaw-console` while writing. `main` is `8363a1d` and holds only `README.md`. |
| **From PR #1** | Stated in the PR #1 plan, with that plan's evidence (MSI discovery notes, a scoped Neon catalog read, public `GET /mcp` and `/health`). Not re-checked here. |
| **Reported, not verified here** | From the task brief and Todd's review of the private ARM repo. This session could not read that repo (name probes returned 404), so there are no line citations. |
| **Doc-derived** | ARM tool names from ARM docs, as relayed in PR #1. Not checked against a live `tools/list`. |
| **Cited [Sn]** | Public source in section 15, read on 2026-10-05. |
| **Assumed** | Planning inference. All are listed in section 13. |
| **Proposed** | A design choice this plan recommends. Nothing is built. |

## 0. Inherited decisions and open blockers

**From PR #1.** Approved by Todd on 2026-10-05.

| # | Decision | Consequence here |
| --- | --- | --- |
| D1 | Dedicated read-only key per account. Never the live pin, never Todd's account. | The guard holds one RO key per accounts-list entry. |
| D2 | The only allowed soft writes are the RO principal's `principals.last_seen_at`, its `principal_credentials.last_used_at`, and its `chat_run_leases` heartbeat (`heartbeat_at`, `started_at`, `status`). | Every other write anywhere in ARM fails the run. |
| D3 | The smoke harness may send model calls through the MSI Ops console `ollamaFetch` capture. The live agent stays on `http://127.0.0.1:11434`. | Extending this to RO routines needs Todd (Q5). |
| D4 | Americas only, from an accounts list, no hardcoding. | Same list shape. The key ref changes form (section 5.5, Q12). |

Blockers carried forward:

| # | Blocker | Source | Blocks |
| --- | --- | --- | --- |
| B1 | ARM has no read-only role or level. Even L0 can claim, complete, post, and set the pulse head. Runtime-usage reporting is allowed at every level. No per-key scopes were found. | Reported, not verified here | Minting any key |
| B2 | `initialize` may update `principals.last_briefing_*`. | Reported, not verified here | Sending `initialize`, and so any MCP session |
| B3 | PR #1's audit is a whole-table "no new rows" check. Whether each audit table carries a principal or request id was not established (`chain_operations` has `actor`). | From PR #1 | Unattended runs |
| B4 | No known read tool returns BTB events, certificates, life limits, or `page_texts`. | From PR #1 | Phase 3 jobs |

## 1. What "useful by reading only" means

### 1.1 Definition of a read-only call

A call is **read-only** in this plan when it causes none of the following for the RO principal:

1. An insert, update, or delete in any ARM table. The exceptions are that principal's D2 columns and any handshake row Todd approves under Q1.
2. An enqueued job, scheduled task, or deferred work item.
3. A call to any AI provider: vision, LLM, OCR, classification, extraction, embedding, or briefing generation. ARM's own path is Claude: PR #1's public `/health` read shows `vision_provider=claude` and `ai_model=claude-sonnet-5`.
4. An outbound request to a third party or to the Block Aero platform.
5. Anything another user can see change: notifications, messages, claims, or presence beyond D2.

A call is **cost-free** when it adds no metered provider usage and no `arm_agent_runtime_usage` row. ARM's own CPU and database reads are not counted (Assumed acceptable).

### 1.2 Useful outputs

The RO agent is useful when it turns existing records into something a person acts on. Every number must trace to a record id and a sealed snapshot.

| Output | Example | Needs | Phase |
| --- | --- | --- | --- |
| Status digest | "Since 09:05: 3 items opened, 1 finished, 2 claims older than 30 min." | pulse, work items, rollups | 2 |
| Change detection | "Standing playbook changed (2 lines). Priority list P-12 added 4 parts." | playbook, priority lists | 2 |
| Traceability lookup | "P/N x, S/N y: birth record, 3 shop visits, no records between 2019-03 and 2021-07." | BTB events (new tool) | 3 |
| Expiry and gap report | "4 life limits due within 90 days. Asset z has no release certificate for its last shop visit." | life limits, record index, doc registry (new tools) | 3 |
| Answer from existing text | "Block 12 of record r reads '…' (page 2)." | existing `page_texts` (new tool) | 3 |

These are out of scope by definition:

- anything that needs new OCR, classification, extraction, or a briefing;
- anything that tells ARM something (claim, complete, propose, message, pulse head);
- records requests to third parties;
- page images in v1. They live in GCS behind `record_blobs.gcs_uri` (From PR #1), and fetching them leaves the machine.

Outputs stay local in v1, in the run archive and the Ops console. Where else they go is Q6. Wherever they go, ARM is not the channel.

## 2. Architecture

### 2.1 Components

All rows are **Proposed** except where marked otherwise.

| Component | Windows user | Listens on | Holds | Talks to |
| --- | --- | --- | --- | --- |
| Live OpenClaw gateway (unchanged) | Todd's user | 127.0.0.1:18789 (From PR #1) | `ARM_MCP_PIN` (Reported) | ARM, Ollama |
| RO OpenClaw gateway, `--profile arm-ro` | `svc-armro-agent` | 127.0.0.1:19789 | guard token only | guard, Ollama |
| ARM read guard (new, this repo) | `svc-armro-guard` | 127.0.0.1:18950 | one RO key per account, in Credential Manager | ARM `/mcp` over HTTPS, auditor |
| Auditor (new, this repo) | `svc-armro-audit` | 127.0.0.1:18951 | read-only Neon role credential | Neon, SELECT only |
| Ollama (shared, unchanged) | existing | 127.0.0.1:11434 (From PR #1) | models | — |
| Ops console (unchanged unless Q5) | existing | :8788 (From PR #1) | 30-batch ring | Ollama |

Rules that follow from the table:

- The RO gateway has no `mcp.servers` entry for ARM, no ARM URL, and no ARM key. No path exists from an OpenClaw model turn to ARM.
- The guard is the only process with an RO key. It accepts requests only from loopback, and only with the guard token.
- The auditor is the only process with database access. It holds no ARM key, and the guard holds no Neon credential.
- This plan does not modify the live agent. Q2 asks whether it keeps running.

The guard lives in this repo, not in ARM's `app/openclaw_mcp_gateway.py`, for three reasons:

- That file was not readable here; it is reported only.
- It defaults to port 8788, which the Ops console already uses (section 2.7).
- A client-side check should not depend on the server it checks.

If that module turns out to be an agent-side proxy, it can be reviewed later (Q11).

Layout in this repo (Proposed):

- `guard/`
- `auditor/`
- `routines/`
- `plugin/`, the OpenClaw policy plugin
- `policy/`: catalog, certificates, argument schemas, routing table, audit queries
- `tests/`, including a mock ARM

### 2.2 Enforcement layers

| Layer | Mechanism | Kind |
| --- | --- | --- |
| L0 OS | Separate Windows users. The RO key exists only in the guard user's credential vault. | Structural |
| L1 OpenClaw tool policy | `tools.profile: "minimal"` plus an explicit deny of every tool group and every high-risk tool (section 2.4). The agent's effective tool list must be empty. | Defense in depth; version-sensitive |
| L2 No ARM route | No `mcp.servers` entry for ARM in the RO profile. | Structural |
| L3 Policy plugin | A trusted tool policy that blocks every tool call and raises an alert. A throwing hook also blocks: "Tool call blocked because before_tool_call hook failed" [S6]. | Code, fails closed |
| L4 ARM read guard | Allow-lists for methods, tools, and arguments; budgets; receipt checks. | Authoritative on the client |
| L5 ARM RO level | Server envelope (S1). | Authoritative on the server |
| L6 Auditor | Database diff per run, plus receipts. | Detective, fails closed |

The design assumes any single layer can fail. L4 and L5 are the two that must both hold.

L1 is not trusted alone, because tool-group membership changes between OpenClaw versions:

- The current docs say `group:openclaw` covers built-in tools "except `read`/`write`/`edit`/`apply_patch`/`exec`/`process`/`canvas`". `minimal` now includes `gateway` (update only) [S1].
- An older copy of the tools doc (OpenClaw commit `b40da2cb`, not re-opened in this session) said an allow-list that names only unknown or unloaded plugin tools is ignored with a warning.

Phase 1 tests the effective tool list on the installed v2026.9.4. The test is repeated after every OpenClaw upgrade. In option 4B (section 4.3) it is also run with the guard's MCP face both up and down.

### 2.3 The ARM read guard

**Proposed.** A small Node service. Node matches OpenClaw and the Ops console (Assumed preference).

Local API. It binds loopback only and requires the bearer guard token. It rejects any request that carries an `Origin` header, since only browsers send one. The MCP spec asks local servers to validate `Origin` against DNS rebinding [S21].

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/runs` | Open a run for `{job, account_label, slot_utc}`. Refused if killed or halted, if the ARM version gate fails, or if the auditor baseline is not clean. |
| `POST /v1/runs/{run_id}/calls` | One certified read, `{tool, args}`. Only inside an open run. |
| `POST /v1/runs/{run_id}/close` | End the run and return the post-run audit verdict. |
| `GET /v1/health` | Halt and kill state, ARM version gate, catalog state, last audit verdict. |

There is no endpoint for arbitrary JSON-RPC and no pass-through.

Per-call pipeline. Every step is code. If a step fails, the guard refuses the call with a reason.

1. The kill file and the HALT marker are both absent.
2. The run is open, its baseline audit is clean, and run budget remains.
3. The tool is in `policy/catalog.yaml` with status `certified` for the current ARM version. Its `tools/list` entry for this session hashes to the certified schema.
4. Arguments validate against the tool's pinned JSON Schema (`additionalProperties: false`, enums, string patterns). `account_id` equals the run's accounts-list entry. Page size is at most the cap.
5. Caps from PR #1 hold: at most 10 pages per list tool, 200 records per tool, and 32 MB per account per run. Only one request is in flight at a time.
6. The JSON-RPC `id` and the `X-Request-Id` header are both `armro:<run_id>:<seq>`.
7. Send with a 20 s timeout. On timeout, send `notifications/cancelled` for that request, as the spec says senders should [S20], and count it as transient.
8. Check the response:
   - the id matches;
   - the size is under the cap;
   - `isError` is mapped (section 6.4);
   - once S9 ships, the receipt is within D2 (section 3.5);
   - the result has no job or queue markers (section 5.3).
9. Append the call to `guard-calls.jsonl`: the request, the SHA-256 of the response body, the receipt, timings, and the SHA-256 of the previous line (a hash chain). Then return the body.

The routine writes the body into its snapshot. Replay checks each snapshot body against the hash the guard logged, which proves the snapshot is what ARM returned.

MCP method policy toward ARM, per MCP 2025-03-26 [S20][S21][S23]:

| Method or message | Policy |
| --- | --- |
| `initialize` | Once per run session, first, never batched [S20]. Declares no client capabilities (no `roots`, no `sampling`). Blocked until B2 is resolved. |
| `notifications/initialized` | Once, after `initialize` [S20]. |
| `tools/list` | Once per session. Follow the cursor up to 5 pages (Assumed cap), then compare with the catalog (below). |
| `tools/call` | Certified tools only, through the pipeline above. |
| `resources/read` | Certified URIs only. If `arm://account/pulse` is certified, it replaces `get_account_pulse`; the guard never uses both. |
| `ping` | Not sent in v1. Answered if ARM sends one. |
| `notifications/cancelled` | Only for the guard's own timed-out request. |
| `resources/list`, `resources/templates/list`, `resources/subscribe`, `resources/unsubscribe`, `prompts/list`, `prompts/get`, `completion/complete`, `logging/setLevel` | Never sent. |
| JSON-RPC batches | Never sent. Batching is new in this protocol version [S22]. |
| Server request `sampling/createMessage` or `roots/list` | Answer with an error, then HALT. The guard declared neither capability, so such a request means the server is misbehaving. |
| `notifications/tools/list_changed` | End the run. Suspend calls until the catalog is re-checked. |
| `notifications/message`, `notifications/progress`, any other notification | Logged. |
| HTTP GET for an SSE stream | Not opened [S21]. |
| HTTP DELETE of a session | Not sent in v1 (Q10). |
| HTTP 404 on a session | Abort the run, with no re-initialize inside it. The spec requires a new `initialize` for a new session [S21], and the next run does that. |

Catalog check on `tools/list`:

- A certified tool whose input schema or annotations hash has changed is suspended.
- A certified tool that is missing is suspended.
- A tool that is not in the catalog under any status (`proposed`, `c2_passed`, …) HALTs the system. The RO level should list only catalogued tools, so an extra tool means the server envelope changed outside the certification process.
- This is stricter than D1's "a mutator stops the run", because annotations cannot prove a tool is read-only. The schema says clients "should never make tool use decisions based on ToolAnnotations received from untrusted servers" [S23].

Version gate:

- Before each run, the guard reads the public `GET https://agentic-records-manager.com/mcp` (no auth, From PR #1) and compares `version` with the versions in the catalog.
- A new version suspends all tools until one of two things happens: the per-release manifest (S14) shows the certified tools unchanged, or a human re-certifies them.
- Assumed: the unauthenticated GET writes nothing. PR #1 made the same read.

### 2.4 RO OpenClaw profile

**Proposed, illustrative, not applied.** Install it as `svc-armro-agent` from an elevated terminal, "as the intended service user" [S17], using `openclaw --profile arm-ro setup` and then `openclaw --profile arm-ro gateway install --port 19789`. A profile gets its own config, state directory, workspace, managed service name, and base port [S4]. Loopback bind and port settings are per [S3]. Key paths follow the current docs and must be validated against v2026.9.4 with `openclaw doctor`. No skills are installed in the RO workspace.

```json5
// %USERPROFILE%\.openclaw-arm-ro\openclaw.json for svc-armro-agent (illustrative)
{
  gateway: { port: 19789, bind: "loopback" },

  tools: {
    profile: "minimal",
    deny: [
      "group:openclaw", "group:runtime", "group:fs", "group:sessions", "group:memory",
      "group:web", "group:ui", "group:automation", "group:messaging", "group:nodes",
      "group:agents", "group:media", "group:plugins",
      "exec", "process", "code_execution", "bash", "read", "write", "edit", "apply_patch",
      "browser", "canvas", "gateway", "session_status", "cron", "automations",
      "plugins", "openclaw", "transcripts", "message", "nodes", "computer",
    ],
    codeMode: { enabled: false },
    elevated: { enabled: false },
  },

  agents: {
    defaults: { heartbeat: { every: "0m" } },
    entries: {
      "arm-ro": {
        model: { primary: "ollama/qwen3:8b", fallbacks: [] },
        modelPolicy: { allow: ["ollama/qwen3:8b"] },
      },
    },
  },

  models: {
    providers: {
      ollama: {
        api: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        apiKey: "ollama-local",
        models: [{
          id: "qwen3:8b",
          contextTokens: 8192,
          params: { num_ctx: 8192, temperature: 0, seed: 7, num_predict: 600, thinking: false, keep_alive: "30m" },
        }],
      },
    },
  },

  logging: {
    // redactPatterns replaces the default list [S12]. Copy the installed defaults first, then add:
    redactPatterns: [ /* ...installed defaults..., */ "armpin_[A-Za-z0-9_-]+", "armro_[A-Za-z0-9_-]+", "armguard_[A-Za-z0-9_-]+" ],
  },

  plugins: { load: { paths: ["C:\\arm-ro\\plugin\\arm-ro-policy.ts"] } },
}
```

Why each part is there:

- **The deny list** names every group and then each high-risk tool. Group membership changed between doc versions, and deny wins over allow [S1]. `group:plugins` is denied because the RO agent needs no plugin tools. The policy plugin registers a policy and commands, not tools.
- **A plugin allow-list** should restrict loading to the policy plugin alone. OpenClaw's security docs flag plugins that load without an explicit allow-list [S14]. The key name depends on the installed version.
- **`heartbeat.every: "0m"`** disables heartbeats, which "run full agent turns" [S10]. Command jobs do the scheduled work instead (section 6).
- **Model pinning.**
  - `fallbacks: []` makes the primary model strict [S9].
  - `modelPolicy.allow` pins overrides to one model. An empty list would mean allow-any [S10], so it is never `[]`.
  - `session_status` is denied because calling it with a model argument writes a session model override [S9].
- **`params`** are forwarded as native `/api/chat` options, and `thinking: false` becomes top-level `think: false` [S11]. The native API is used because OpenClaw's docs say `/v1` "breaks tool calling" [S11].
- **The model block** matters only for an accidental chat turn and for Phase 4. Routines call Ollama themselves, with settings from `policy/routing.yaml` (section 2.5).

The policy plugin, `plugin/arm-ro-policy.ts` (Proposed):

- `api.registerTrustedToolPolicy` with no matcher (so it matches all tools). It returns `{ block: true, blockReason: "arm-ro: no tools" }` and writes an alert line. Trusted policies run before ordinary hooks, and an installed plugin must declare the policy id in `contracts.trustedToolPolicies` [S5].
- An ordinary `before_tool_call` hook doing the same, as a second check. `block: true` is terminal [S5].
- The Phase 3 slash commands, through `api.registerCommand`. A handler can answer with `{ text }` without running the agent [S5]. Commands call the guard or read the run archive, and code renders the reply.
- A hook cannot add a tool the host omitted [S5], so the plugin can only narrow.

Security checks on the profile:

- `openclaw --profile arm-ro security audit --deep` with no critical findings, including `models.small_params` [S15].
- `openclaw --profile arm-ro secrets audit --check` [S16].

### 2.5 Deterministic model routing

**Proposed.** `policy/routing.yaml` is a fixed table keyed by task type. Its SHA-256 goes into every run manifest. Changing it takes a pull request, never a runtime decision. No model chooses routes.

| Task | Engine | Model | Settings | Validator | On failure |
| --- | --- | --- | --- | --- | --- |
| T0 health tick | code | none | — | — | alert |
| T1 fetch, diff, compute | code | none | — | unit tests, golden files | run FAILED |
| T2 phrase a digest (optional per job) | local Ollama | qwen3:8b, pinned digest | `temperature 0`, `seed 7`, `think false`, `format` set to a JSON schema [S25][S27], `num_predict 600`, `num_ctx 8192` | schema valid; every number and id in the text is in `facts.json`; no repeated n-grams | code template |
| T3 classify a free-text question (Phase 4) | local Ollama | qwen3:8b | same, enum schema, `num_predict 64` | value is in the closed intent set | reply with the command list |
| T4 pick a quote from retrieved text (J7) | local Ollama | qwen3:8b | same, `num_predict 200` | answer is an exact substring of a retrieved passage | "not found in existing text" |
| T5 describe an image (Phase 4, Q7) | local Ollama | moondream | `num_ctx 2048`, `num_predict 128`, `temperature 0` | — | skip |
| T6 hard judgment | not used in v1 | — | — | — | — |

T6 rules for later phases:

- **Local.** qwen3:14b runs only alone, in a scheduled window, at `num_ctx 4096`, and is then unloaded with `keep_alive: 0` [S24]. It is used only for a task type where the Phase 1 evaluation shows qwen3:8b failing its validator.
- **Cloud.** Only after Q4. It needs a pinned model id, a budget, redaction, a `cloud_eligible` flag per task, and advisory-only output.
- **deepseek-r1:14b is not routed.**
  - Its weights alone are 9.0 GB [S29].
  - Local guides recommend temperature 0.6 for it [S36], which conflicts with fixed decoding.
  - Its reasoning trace length varies run to run (Assumed).

Model choices and why:

- **qwen3:8b only.** It is the only routed text model. It fits with headroom (section 2.6), and the live heartbeat already uses it (From PR #1), so its weights are often already loaded.
- **Temperature 0 is a deliberate trade.** Qwen's card recommends temperature 0.7 for non-thinking mode and says "DO NOT use greedy decoding" for thinking mode [S31]. This plan uses temperature 0 with thinking off, for determinism. Ollama's structured-output docs recommend temperature 0 [S27].
  - The cost is possible repetition. The schema, the `num_predict` cap, a repetition check, and the template fallback contain it.
  - `seed` only matters when sampling [S28 #586]. At temperature 0 it is harmless, and it is recorded.
- **Pinned digests.** An Ollama tag can be re-pulled to new weights. The routine compares the tag's digest from `/api/tags` [S24] with the pinned digest. The library prefix for qwen3:8b is `500a1f067a9f` [S29]; Phase 1 records the full digest. A mismatch means template output and an alert, never a different model.
- **Tool-calling quality** does not matter in v1, because no model calls tools. For reference only, Qwen self-reports these BFCL v3 scores [S35]:
  - Qwen3-8B: 68.1% thinking, 60.2% non-thinking.
  - Qwen3-14B: 70.4% thinking, 61.5% non-thinking.
  - Multi-turn figures conflicted between sources and are omitted.

Phase 2 ships template-only output. T2 is switched on per job only after the Phase 1 evaluation passes its validator on at least 99% of fixtures (Assumed threshold, Q14).

### 2.6 VRAM and context budget (RTX 4070, 12 GB)

At f16, KV cache per token is 2 × layers × KV heads × head dimension × 2 bytes. The head dimension is 128 for all three models.

| Model | Layers | KV heads | KV per token |
| --- | --- | --- | --- |
| qwen3:8b | 36 [S32] | 8 [S32] | 144 KiB |
| qwen3:14b | 40 [S31] | 8 [S31] | 160 KiB |
| deepseek-r1:14b | 48 [S29] | 8 [S29] | 192 KiB |

| Configuration | Weights | KV | Overhead (Assumed) | Estimate | Fits in ~11 GB usable (Assumed)? |
| --- | --- | --- | --- | --- | --- |
| qwen3:8b at 8,192 | 5.2 GB [S29] | 1.21 GB | ~0.5 GB | ~6.9 GB | Yes |
| qwen3:8b at 8,192 + moondream | + 1.7 GB [S29] | small | ~0.4 GB | ~9.2 GB | Yes |
| qwen3:14b at 4,096 | 9.3 GB [S29] | 0.67 GB | ~0.7 GB | ~10.7 GB | Tight; alone only |
| qwen3:14b at 8,192 | 9.3 GB | 1.34 GB | ~0.7 GB | ~11.3 GB | No |
| qwen3:14b + moondream (the live agent's setup) | 11.0 GB | — | — | ~12.5 GB | No |
| deepseek-r1:14b at 4,096 | 9.0 GB [S29] | 0.8 GB | ~0.7 GB | ~10.5–10.8 GB [S36] | Not routed |

Third-party estimates for qwen3:14b on this card run from 10.5 GB to 13.1 GB [S34]. Phase 1 measures every row on the box with `/api/ps` (`size`, `size_vram`) [S24] and replaces this table.

Throughput matters only for timeouts, not routing. On an RTX 4070, Qwen3-8B Q4 generates about 71 tok/s at 4k context and 52 tok/s at 16k. Qwen3-14B generates about 42.5 tok/s at 4k [S33]. A 600-token digest therefore takes about 10 s on qwen3:8b (Assumed: generation dominates).

Rules (Proposed):

- **R1.** One RO text model: qwen3:8b at `num_ctx 8192`.
- **R2.** The RO side does not use moondream in v1, but its budget allows for the live agent keeping moondream loaded.
- **R3.** qwen3:14b runs only alone, at 4,096, in a scheduled window, and is unloaded afterwards.
- **R4.** Before a model call, `/api/ps` must show the model with `size_vram == size`, meaning it is fully on the GPU [S24]. Otherwise the routine uses the template. Partial offload changes speed and may change numerics (Assumed).
- **R5.** Never vary `num_ctx` for a model between calls. Phase 1 reads the live agent's qwen3:8b context. If it is at least 8,192, the RO side uses the same value, so both share one loaded runner (Assumed: a different `num_ctx` forces a reload).
- **R6.** Do not change global Ollama settings without Todd: `OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_LOADED_MODELS`, or `OLLAMA_KV_CACHE_TYPE`. They are server-wide and would change the live agent too [S26].
  - By default there is one parallel request per model, up to three loaded models per GPU, and a model must fit fully to load beside others [S26].
  - KV quantization at q8_0 roughly halves KV memory [S26][S30], but it is a global setting.
- **R7.** The routine caps prompt input at 6,000 tokens using a fixed byte estimate, and checks `prompt_eval_count` after the call. Ollama documents a `truncate` error mode only for embeddings [S24], so this plan treats silent truncation in chat as possible (Assumed).

### 2.7 Ports and the 8788 conflict

| Port | Owner | Source |
| --- | --- | --- |
| 18789 | live OpenClaw gateway | From PR #1 |
| 18791, 18800–18899 | live gateway browser control and CDP range: browser control is base + 2, and CDP runs from browser control + 9 to + 108 | Cited [S4] |
| 19789 | RO gateway | Proposed. The docs use 19789 as the example second base and ask for at least 120 ports between bases [S4]. |
| 19791, 19800–19899 | RO derived ports | Cited [S4] |
| 18950 | ARM read guard | Proposed, illustrative. Phase 1 checks it is free. |
| 18951 | auditor | Proposed, illustrative |
| 11434 | Ollama | From PR #1 |
| 8788 | Ops console | From PR #1 |
| 8788 | `app/openclaw_mcp_gateway.py` default | Reported, not verified here |
| 8787 | stale port in `heartbeat.json` and `openclaw-heartbeat.json`, which also have a UTF-8 BOM | From PR #1 |

**Conflict.** ARM's `openclaw_mcp_gateway.py` reportedly defaults to 8788, the port the Ops console already uses. Starting it on this laptop would either fail to bind or, if the console were down, take the port the capture path expects. This plan never starts it, and ARM should move its default (S13).

The stale 8787 references belong to the live agent and are out of scope. They are listed so nobody copies them into the RO profile.

## 3. ARM integration

### 3.1 Read-only tool allow-list

No tool name below has been verified against a live `tools/list`. That call needs a key, so by design it was not made. "Doc-derived" names come from ARM docs via PR #1. "Placeholder" names are tools ARM would have to build or confirm (B4, S12).

| Tool | Used by | Status | Condition to certify | Phase |
| --- | --- | --- | --- | --- |
| `get_pulse_head` | J1 | Doc-derived | Reading the head must not move it. The RO agent keeps its own position locally and never calls `put_pulse_head`. If the head is per principal, J1 drops this call. | 2 |
| `get_account_pulse` or resource `arm://account/pulse` | J1 | Doc-derived (etag/delta, 256 KB cap) | The delta must be computed from the client's etag, not from a server-side cursor that advances. Certify one form only. | 2 |
| `get_standing_playbook` | J3 | Doc-derived | — | 2 |
| `get_deliverable_rollup` | J2 | Doc-derived | Must not recompute or cache a rollup by writing. | 2 |
| `list_work_items` | J2 | Doc-derived | Must not claim, mark seen, or touch the `agent_work_items` claim fields. | 2 |
| `list_priority_part_lists` | J3 | Doc-derived | — | 2 |
| `get_project_status` | J2 | Doc-derived | — | 2 |
| `registry_insights` | J8 | Doc-derived; exact name unverified | Exact-name match only. Dropped if the name differs. | 2, conditional |
| `get_part_trace` | J4 | Placeholder | Reads `btb_*` tables only. | 3 |
| `list_life_limits` | J5 | Placeholder | Reads `btb_life_limits`. | 3 |
| `get_record_text` | J7 | Placeholder | Returns existing `ocr_artifacts.page_texts` only. If none exist, returns `isError` with `processing_required` and never starts OCR. | 3 |
| `list_asset_records` | J6 | Placeholder | Record metadata only: no blob bytes, no signed URLs. | 3 |
| `get_doc_type_registry` | J6 | Placeholder | Reference data (~159 types, From PR #1). | 3 |
| `list_certificates` | J4, J6 | Placeholder | `certificate_forms` metadata. | 3 |

The guard's callable set is the intersection of this table, the certificates, and the RO principal's `tools/list`. Nothing else can be called.

### 3.2 Never callable

These stay uncallable even if ARM lists them for the RO principal, which would HALT the guard (section 2.3):

- **`get_briefing`.** It writes `last_briefing_*` and may generate a briefing (From PR #1).
- **Soft writes:**
  - claim, which takes a 30-minute lease;
  - `complete_work_item`;
  - `post_session_message`;
  - `report_runtime_usage`;
  - `propose_*`;
  - `put_pulse_head`;
  - `send_records_request`;
  - `notify_user`.
- **Hard-banned tools:**
  - `ledger_commit`, `form_0`, `party_stamp`, `commit_work_plan`;
  - any confirm, commit, approve, attach, mint, invite, register, or harvest tool;
  - `approve_documents`;
  - offer accept or send;
  - Factory staff APIs.
- **Tools in excluded data areas:**
  - any tool that returns blob bytes or signed URLs (v1);
  - any tool that reads `chat_messages` (Q8);
  - any tool that reads the tables PR #1 excludes: `neon_auth`, `account_kyc_documents`, `principal_credentials`, `account_users`, `account_invitations`, `acc_*`, `form0_*`, `harvest_*`, `records_offers`, or `records_request_uploads`.
- **Egress tools.** Any tool that calls the Block Aero platform or another outside host at request time. A platform call would log `chain_operations`, and the platform stamps an API key's `LastUsed` on success [S47].

### 3.3 How each read is proven non-mutating and cost-free

A tool can be called only when its certificate says `certified` for the running ARM version. The ladder:

| Step | Who | What | Evidence |
| --- | --- | --- | --- |
| C0 Declare | ARM | Declares the side-effect class (`read_pure`, `read_presence`, `soft_write`, `write`, `processing`, `egress`), the cost class (`none`, `ai`), tables read and written, outside hosts, and async work. Only `read_pure` and `read_presence` with cost `none` can be certified. | Registry entry (S6) |
| C1 Review | ARM and the platform architect | Read the handler's call graph for writes, provider calls, job enqueues, cursor updates, caches that write, and platform calls. | Review note |
| C2 CI write-trap | ARM CI, every release | See the steps below the table. | CI artifact per release |
| C3 Branch diff | ARM with Todd | Run against a staging ARM on a Neon branch of production with no AI credentials. Branches are copy-on-write [S46]. Compare table counts, the `pg_stat_user_tables` insert, update, and delete counters, and the egress log, before and after. | Diff report |
| C4 Attended canary | Todd | Production, Americas, in a quiet window, through the guard, with the PR #1 attestation. | Canary report |
| C5 Continuous | Guard and auditor | A receipt on every call (S9) and an audit diff on every run (section 5.2). | Run archive |

C2 runs each handler on fixtures with these traps:

- The handler runs inside `SET TRANSACTION READ ONLY`, which blocks INSERT, UPDATE, DELETE, MERGE, COPY FROM, and DDL [S44].
- The AI, OCR, embedding, briefing, HTTP, and enqueue clients are patched to raise.
- The D2 presence writer is counted separately.
- Fixtures include unprocessed documents, missing OCR text, a stale briefing, and the maximum page size.

`SET TRANSACTION READ ONLY` is "a high-level notion of read-only that does not prevent all writes to disk" [S44], and it does not stop calls to outside services. That is why C2 traps the provider and HTTP clients too. C3 assumes ARM can run a staging instance against a Neon branch (Assumed).

A certificate entry in `policy/certificates.yaml` (Proposed):

```yaml
- tool: get_pulse_head
  arm_version: "0.185.10"
  input_schema_sha256: "<hex>"
  annotations_sha256: "<hex>"
  impl_sha256: "<hex from the S14 manifest>"
  side_effect_class: read_presence
  cost_class: none
  evidence: { c1: "<review link>", c2: "<CI run>", c3: "<diff report>", c4: "<run_id>" }
  caps: { max_calls_per_run: 1, max_response_bytes: 262144 }
  args_schema: policy/args/get_pulse_head.json
  status: certified   # proposed | c2_passed | c3_passed | certified | suspended | retired
```

A tool must be re-certified on any of these:

- a new ARM version without an S14 manifest that shows the tool unchanged;
- a change to its schema or annotations hash;
- `tools/list_changed`;
- any violation;
- a 403 on a certified tool.

### 3.4 Server-side changes ARM must make

**Recommendation only. This plan does not change ARM.**

| ID | Change | Why | Needed before |
| --- | --- | --- | --- |
| S1 | Add a `read_only` level or role, or real per-key scopes, whose envelope is an explicit list of certified tools. Effective access is role ∩ level ∩ key scope, and `tools/list` shows only that list. An unknown level stays L0, so a missing level never becomes read-only by accident. The Block Aero platform's External API already scopes keys to an endpoint allow-list enforced by method and route [S47]. | B1 | Minting |
| S2 | For RO principals, `initialize` and authentication write nothing except D2 columns. In particular they do not write `principals.last_briefing_*`. | B2 | First `initialize` |
| S3 | RO principals cannot call `report_runtime_usage`, and no server path writes `arm_agent_runtime_usage`, `arm_agent_meter`, or `arm_agent_hours` for them. | Known gap 1 | Minting |
| S4 | A no-processing mode for RO principals. Any path that would call the vision or LLM provider, run OCR, classify, extract, embed, generate a briefing, or enqueue pipeline or factory work raises before any side effect. The tool returns `isError: true` with code `processing_required`. No lazy processing. | Cost rule | Minting |
| S5 | RO tool handlers run in read-only database transactions. D2 presence writes go through one separate, narrow writer. No mark-read, no cursor advance, no write-through caches. Etag and delta are computed from client-supplied values. | Non-mutation | Minting |
| S6 | Side-effect and cost classes are declared per tool, and every tool in the RO level has a CI write-trap (C2). A tool cannot join the RO level without passing. | Proof | Minting |
| S7 | RO keys are account-bound, scoped, revocable, and short-lived, with a distinct prefix (for example `armro_`). | D1, D4, hygiene | Minting |
| S8 | `principal_id` and `request_id` columns (or equivalents) on the six audit tables and the extended list (section 5.2). `X-Request-Id` is carried into async jobs. | B3 | Unattended runs |
| S9 | A per-call receipt in the result's `_meta` (section 3.5). The schema reserves `_meta` on results for metadata [S23]. | Detection | Unattended runs |
| S10 | Accurate annotations on RO tools (`readOnlyHint: true`, `openWorldHint: false`). Useful for humans; the guard does not trust them [S23]. | Hygiene | Should |
| S11 | Per-key rate limits, and `Retry-After` on 429. | Backoff | Should |
| S12 | The Phase 3 read tools in section 3.1. | B4 | Phase 3 |
| S13 | Move the `openclaw_mcp_gateway.py` default off 8788. | Port conflict | Should |
| S14 | A per-release RO manifest listing, for each RO tool: name, input schema hash, implementation hash, classes, and C2 result. | Re-certification without downtime | Unattended runs |
| S15 | Send `notifications/tools/list_changed` when the RO envelope changes. | Detection | Should |
| S16 | A server flag that disables all RO principals at once. | Kill switch K4 | Unattended runs |

### 3.5 Per-call receipt

**Proposed** (S9). Returned in `result._meta`:

```json
"_meta": {
  "arm/receipt": {
    "request_id": "armro:j1:block-aero-americas-nap8:2026-10-06T13:05:00Z:3",
    "principal_id": "prin_…",
    "account_id": "88fc877e-6b5d-407f-bbab-88ee95db0f04",
    "side_effect_class": "read_presence",
    "db_writes": [{ "table": "principals", "column": "last_seen_at", "rows": 1 }],
    "enqueued_jobs": 0,
    "ai_calls": 0,
    "egress_hosts": [],
    "cost_usd": 0,
    "arm_version": "0.185.10",
    "tool_impl_sha256": "…"
  }
}
```

The guard HALTs when any of these is true:

- `db_writes` names anything outside D2, or more than one row of a D2 column;
- `enqueued_jobs` is greater than 0;
- `ai_calls` is greater than 0;
- `egress_hosts` is not empty;
- `cost_usd` is greater than 0;
- the principal or account differs from the run's;
- the version or implementation hash differs from the certificate.

Before S9 ships, a missing receipt is allowed only in attended runs. Afterwards, `require_receipts: true` makes a missing receipt a HALT.

A receipt is ARM reporting on itself. The auditor checks it independently (section 5.2).

## 4. Read-only jobs

**Proposed.** Each job is a Node routine in `routines/`, run by an OpenClaw command job (section 6). The model column refers to section 2.5.

| Job | Inputs | ARM reads (max calls per run) | Logic in code | Model | Output | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| J1 Pulse change digest | accounts list; last sealed pulse snapshot and etag | `get_pulse_head`, `get_account_pulse` with etag (2) | Set diff by item id: added, removed, changed (hash of the normalized item) | T2, optional | `digest.md`, `diff.json` | 2 |
| J2 Work-queue status | accounts list; aging buckets (Q14) | `list_work_items` paged, `get_deliverable_rollup`, `get_project_status` (12) | Counts by status; age buckets; claims older than the 30-minute lease; overdue items if due dates exist | T2, optional | `queue.md`, `queue.json` | 2 |
| J3 Playbook and priority-list watch | last hashes | `get_standing_playbook`, `list_priority_part_lists` paged (11) | SHA-256 of normalized text; line diff; list membership diff | none | `changes.md`, only when something changed | 2 |
| J4 Traceability lookup (on demand) | P/N and S/N from `/ro-trace` | `get_part_trace`, `list_certificates` (2, plus pages) | Order events by date; apply gap rules from `policy/gap-rules.yaml` (Q13) | none | Cited chain table with record ids | 3 |
| J5 Life-limit and expiry report | thresholds (Q14) | `list_life_limits` paged (10) | Remaining = limit − used; due within 30, 60, or 90 days of the slot time; sorted by remaining, then id | none | `expiry.md`, `expiry.json` | 3 |
| J6 Document gap report | required doc types per asset or event (Q13) | `list_asset_records` paged, `get_doc_type_registry` (11) | Set difference: required minus present | none | `gaps.md`, `gaps.json` | 3 |
| J7 Answer from existing OCR text (on demand) | record id and question from `/ro-text` | `get_record_text` (1) | BM25 over paragraphs with a fixed tokenizer; ties broken by page, then offset; top three passages verbatim | T4, optional | Answer with record id, page, and exact quote; or "not found"; or "not processed" | 3 |
| J8 Coverage metrics (weekly) | latest sealed J5 and J6 snapshots | none new; `registry_insights` if certified (1) | Share of assets with a birth record, with OCR text, with no gaps | none | `coverage.md` | 3 |
| J9 Health tick | none | none | Guard and auditor health; Ollama `/api/ps` and `/api/tags` digests; console reachability; kill and HALT state; disk space | none | Console tile; alert on change | 1 |

ARM load in Phase 2:

- J1 runs 14 times a day, J2 twice, and J3 once. That is at most 63 `tools/call` per day, typically about 40, plus one session handshake per run.
- For comparison, the live worker polls the pulse every 15–30 seconds (From PR #1). Over a 14-hour day (Assumed window) that is about 1,700–3,400 polls.

### 4.1 Questions without an agent turn (Phase 3)

The slash commands form a fixed routing table. Each one maps to a single routine, and code renders the answer. No model chooses anything.

| Command | Does | ARM calls |
| --- | --- | --- |
| `/ro-status` | Shows the latest J1 and J2 outputs from the archive | none |
| `/ro-queue` | Shows the latest J2 output | none |
| `/ro-trace <pn> <sn>` | Runs J4 for one part | live, certified |
| `/ro-text <record_id> <question>` | Runs J7 for one record | live, certified |
| `/ro-health` | Shows the J9 state | none |

Arguments must match fixed patterns in `policy/args/*.json`. Anything else gets the command list back.

### 4.2 What replaces the worker loop

The live worker's loop is briefing, pull, claim up to three, complete, and propose when unsure (Reported). The RO loop has no briefing, claim, completion, or proposal. It is the run state machine in section 6.2: precheck, fetch, seal, audit, compute, phrase, validate, emit, audit, commit.

### 4.3 Free-text questions (Phase 4, optional)

Two options, in order of preference.

**4A (recommended): `/ro-ask <question>`.**

- The plugin calls T3 to classify the question into a closed intent set: `status`, `queue`, `trace`, `text`, or `unknown`.
- Code, not the model, extracts parameters with fixed patterns. Each parameter must appear verbatim in the question.
- Code calls the routine and renders the answer. T2 may phrase it.
- The model is only a classifier.

**4B: a normal agent turn with MCP tools.** The tools (`ro_status`, `ro_queue`, `ro_trace`, `ro_text`) are served by the guard's own MCP face. This option needs:

- `mcp.servers["arm-ro"]` with `toolFilter.include` [S2];
- exact `tools.alsoAllow` names such as `arm-ro__ro_status` [S1];
- `group:plugins` removed from the deny list;
- `supportsParallelToolCalls: false` [S2];
- a per-turn cap of three calls in the policy plugin;
- a check that every number and id in the reply came from a tool result.

Two limits apply to 4B:

- `allow` and `alsoAllow` cannot be set in the same scope [S1].
- As far as this session could read [S2][S16], values in `mcp.servers.*.headers` are plain environment substitutions, not SecretRefs. This needs verifying.

4B needs its own review.

## 5. Guardrails

### 5.1 Code-enforced allow-list

The allow-list is enforced in three places, each in code:

- the policy plugin, which gives the agent no tools;
- the guard, through its method, tool, and argument policy (section 2.3);
- ARM's RO level (S1).

Prompt text is not a control anywhere in this design. The live agent's rules are prompt text only (Reported); this plan does not repeat that gap.

### 5.2 Fail-closed audit diff

**Proposed.** The auditor brackets every run.

Watched set:

- **Approved in PR #1:**
  - no new rows in `pipeline_log`, `chain_operations`, `asset_write_ledger`, `login_events`, `email_log`, or `arm_agent_runtime_usage`;
  - no change to the `agent_work_items` fields `claimed_at`, `claimed_by`, `status`, `finished_at`, or `result`.
- **The RO principal's own row:** only D2 columns may change. `last_briefing_*` must not.
- **Proposed extension (Q3):**
  - `notifications`;
  - `chat_messages`, row count and max id only;
  - `account_pulse_heads`, `arm_agent_meter`, `arm_agent_hours`;
  - `review_queue_entries`, `agent_planning_intents`, `account_target_list_proposals`;
  - `ocr_artifacts`, `processed_files`, `record_blobs`, `factory_jobs`.

Method:

- The queries are fixed, index-backed, and kept in `policy/audit.sql`, reviewed by ARM. Per table they read the max id or max `created_at`; for `agent_work_items` they read the claim fields. They read no record bodies.
- Snapshots are taken at four points:
  - baseline, before the first call;
  - mid, after the fetch and before any model call;
  - post, after output;
  - late, 15 minutes after the run (Assumed), to catch async work. ARM should confirm its longest async delay.
- **Before S8**, any change in a watched table during the window fails the run. That works only in an attended quiet window with the live agent paused (Q2).
- **After S8**, only rows attributed to the RO principal or carrying an `armro:` request id count. Rows from other actors are ignored.

Verdicts:

| Verdict | Meaning | Action |
| --- | --- | --- |
| `clean` | No attributed change outside D2 | Continue |
| `violation` | A write or a processing signal | HALT, create kill file K1, suspend the tool, keep outputs out of delivery |
| `unverified` | The auditor could not finish (Neon error, timeout, replica lag) | Quarantine outputs; block the next runs until an audit is clean |

Database access (Proposed):

- A Neon role `armro_auditor` with SELECT only on the watched tables. Better still, SELECT only on ARM-owned views that expose just ids, timestamps, and the principal and request columns.
- `default_transaction_read_only = on` and `statement_timeout = 5s` on the role are defense in depth only. `default_transaction_read_only` is a default the session can change [S44], so the grants are the real limit.
- The auditor reads the primary. Neon read replicas are asynchronous [S45] and can miss a row that was just written.

Q3 asks whether the auditor should run in Block Aero infrastructure instead of on the laptop.

### 5.3 Processing-trigger detection

Any one of these HALTs the run and suspends the tool:

1. **Receipt:** `ai_calls`, `enqueued_jobs`, `cost_usd`, or `egress_hosts` is non-zero or non-empty.
2. **Audit:** a new attributed row in `pipeline_log` (which carries `model_id` and `cost_usd`, From PR #1), `ocr_artifacts`, `processed_files`, or `factory_jobs`.
3. **Late audit:** the same check, 15 minutes later.
4. **Latency:** a call slower than five times that tool's p95 from attended runs (Assumed factor) is marked `suspect_processing`. The run's outputs are quarantined until a human looks.
5. **Shape:** a result containing any job or queue marker listed in `policy/processing-markers.yaml`, such as `job_id`, `queued`, or `status: processing`.

`processing_required` from S4 is not a violation. It means ARM correctly refused to process, and the job reports "not processed in ARM".

### 5.4 Kill switch

| ID | Action | Effect |
| --- | --- | --- |
| K1 | Create `C:\ProgramData\arm-ro\KILL` | The guard refuses every call; routines exit quietly at precheck |
| K2 | `schtasks /end /tn "<guard task>"` | No process holds the RO key, so no ARM path exists |
| K3 | `schtasks /end` on the RO gateway's task. The task name comes from `openclaw --profile arm-ro gateway status --deep` [S4]; OpenClaw documents ending its task this way [S17]. | No schedules and no commands run |
| K4 | Revoke the RO key in ARM, or set the S16 flag | The server refuses all RO principals |
| K5 | Optional Windows Firewall outbound block on the guard's program path | Network-level stop |

The system HALTs automatically on any of these:

- any audit violation;
- a receipt failure;
- a catalog mismatch on a certified tool;
- an unknown tool in `tools/list`;
- a server `sampling/createMessage` or `roots/list` request;
- a 401 or 403;
- a snapshot hash mismatch;
- a policy-plugin block, meaning the agent tried to call a tool;
- three failed runs of one job with the same error class.

A HALT writes `C:\ProgramData\arm-ro\HALTED` with the reason and the run id. Only a human clears it, with a logged command (`guardctl clear --reason "…"`). Nothing restarts automatically.

The first HALT exits non-zero, so the OpenClaw job records an error. Later runs exit 0 quietly while the system stays halted (section 6.4).

### 5.5 Secrets on Windows

**Live pin exposure (Reported, not verified here).**

- The live pin `ARM_MCP_PIN` is a Windows user environment variable.
- User variables are stored under `HKEY_CURRENT_USER\Environment` [S40][S43], and a child process inherits its parent's environment by default [S39].
- So every process that user starts can read the live full-worker pin, including the live agent's shell, ADB, and browser skills.
- This plan does not change the live agent. Todd should know the RO design does not reduce that exposure (R2).

**RO key storage.**

- The RO key is never an environment variable, never set with `setx`, never in `openclaw.json`, and never in logs.
- It is a generic credential in `svc-armro-guard`'s Windows Credential Manager [S42], protected with DPAPI for that user's logon [S41]. The guard reads it into memory at start.
- The guard's scheduled task uses a Password logon. OpenClaw's Windows docs say an S4U task "does not provide Windows network credentials or access to encrypted files" [S17]. This plan assumes the same limit applies to the guard's DPAPI secret (Assumed; tested in Phase 1).
- The fallback is a machine-scope DPAPI file. `CRYPTPROTECT_LOCAL_MACHINE` lets any local user decrypt [S41], so the file's ACL would be the only control.
- OpenClaw SecretRefs "are not a process-isolation boundary" [S16]. This design relies on Windows users, not OpenClaw's secret handling, to protect the ARM key.

**Guard token.**

- A random 256-bit local token, with the Proposed prefix `armguard_`.
- It is stored in a file that only `svc-armro-agent` and `svc-armro-guard` can read.
- It is rotated monthly and after any security HALT.
- It only opens the guard's certified reads, so a leaked token gives read access within the same limits.

**Key reference in the accounts list.** D4's key ref changes form: the entry names a Credential Manager target instead of an environment variable (Q12).

```json
{ "accounts": [ { "account_id": "88fc877e-6b5d-407f-bbab-88ee95db0f04", "label": "block-aero-americas-nap8", "key_ref": "credman:armro/block-aero-americas-nap8" } ] }
```

**Other checks.**

- Todd checks once that the RO key is not the live pin, by comparing the first 8 hex characters of each key's SHA-256. Nobody prints a key; the Block Aero REST skill says "Never log or echo full keys" [S47].
- **Redaction.** OpenClaw's `logging.redactPatterns` replaces the default list [S12]. The RO profile therefore copies the defaults and then adds the `armpin_`, `armro_`, and `armguard_` prefixes.
- **Transcripts.** Transcript redaction landed in OpenClaw PR #73563 [S18]. Phase 1 checks whether v2026.9.4 includes it.
- **Egress proxy.** OpenClaw's egress proxy is off by default and covers only Gateway-hosted exec [S16]. It is not part of this design.

### 5.6 Untrusted record text

Record and OCR text is untrusted input. OpenClaw's security docs treat untrusted content as a prompt-injection risk and recommend a reader agent with no tools to handle it. For small models they recommend "read-only tools, strong sandboxing, minimal filesystem access, strict allowlists" [S14]. In this plan:

- No model call has tools.
- Model output is parsed against a schema. Only validated fields are used, and only as display text. Model output is never used as a route, a tool name, or an argument.
- Numbers and ids in any output are rendered by code from `facts.json`, or checked against it.
- In 4A, parameters come from the user's text through fixed patterns, not from the model.

## 6. Heartbeats and routines

### 6.1 Cadence

The RO agent's OpenClaw heartbeat is off, because heartbeats run full agent turns [S10]. Schedules are command jobs [S7][S8]. For example:

```text
openclaw --profile arm-ro automations add \
  --name ro-j1-pulse \
  --cron "5 6-19 * * *" --tz America/Los_Angeles --exact \
  --command-argv '["C:\\Program Files\\nodejs\\node.exe","C:\\arm-ro\\routines\\run.mjs","--job","j1"]' \
  --timeout-seconds 600 --no-deliver
```

| Job | Schedule (America/Los_Angeles) | Runs |
| --- | --- | --- |
| J9 health | every 30 min, 06:00–20:00 | 29 a day |
| J1 pulse digest | 5 minutes past each hour, 06:05–19:05 | 14 a day |
| J2 work queue | 07:15 and 15:15 | 2 a day |
| J3 playbook watch | 06:10 | 1 a day |
| J5 expiry | 05:30 | 1 a day |
| J6 gaps | 05:40 | 1 a day |
| J8 coverage | Monday 05:50 | weekly |
| Late audit | 15 minutes after each ARM run, on the auditor's own timer | — |

Scheduling rules:

- Creating, editing, or running a job requires `operator.admin` [S8]. The agent cannot schedule anything, because the `automations` and `cron` tools are denied.
- `--exact` turns off OpenClaw's staggering [S8], so the slots are identical every day. `--tz` sets the evaluation time zone [S8]. No RO job runs in the 01:00–03:00 window where DST transitions happen.
- Phase 1 reads the live heartbeat's actual minutes and moves RO slots away from them (Assumed: they are unknown today).
- A command that prints only `NO_REPLY` is suppressed [S8].

### 6.2 Run state machine

| State | Does | Next | On failure |
| --- | --- | --- | --- |
| PRECHECK | Checks kill and HALT are absent and `DONE` is absent for this run id; checks guard health and the ARM version gate; if T2 is on, checks model digest and residency; opens the run at the guard, which takes the auditor baseline | FETCH | SKIP (recorded) or HALT |
| FETCH | Certified reads in a fixed order, within caps | SEAL | FAILED, or HALT on a violation |
| SEAL | Writes `snapshot.jsonl` and its SHA-256; checks each body against the guard's hash | AUDIT_MID | HALT |
| AUDIT_MID | Auditor delta since baseline | COMPUTE | HALT on violation; QUARANTINE if unverified |
| COMPUTE | Pure functions over the snapshot; writes `facts.json` and its SHA-256 | PHRASE or RENDER | FAILED |
| PHRASE | T2, if enabled for the job | VALIDATE | RENDER |
| VALIDATE | Schema, fact, and repetition checks | EMIT | RENDER |
| RENDER | Code template from `facts.json` | EMIT | FAILED |
| EMIT | Writes outputs; delivers per Q6, with the run id as the dedupe key | AUDIT_POST | FAILED |
| AUDIT_POST | Closes the run at the guard; auditor delta | COMMIT | HALT or QUARANTINE |
| COMMIT | Atomic write of job state (etag, hashes); writes the `DONE` marker | IDLE | FAILED |
| LATE_AUDIT | Auditor check 15 minutes later | — | HALT; outputs marked `retracted` |

### 6.3 Idempotency

- The run id is `<job>:<account_label>:<slot_utc>`. The slot is the scheduled time, not the wall clock.
- Each attempt writes to its own folder (section 7.1). Running a slot that already has `DONE` does nothing.
- There is no catch-up. A slot missed while the laptop slept is logged as `missed` at the next run and is not replayed.
- "Now" in every computation is the slot time, so a replay produces the same facts.
- Job state is committed only after a clean post-run audit, by atomic rename.

### 6.4 Backoff and errors

| Condition | Action |
| --- | --- |
| 429, 503, timeout, connection refused | Retry inside the run after 5 s, then 10 s, then 20 s. Honor `Retry-After` up to 300 s. No jitter: there is only one client, so no thundering herd. |
| Third identical transient error in a run | Run FAILED, recorded, exit 0 |
| Same error class in three consecutive runs of a job | HALT. This matches the live standing rule "the same error three times means stop" (From PR #1). |
| 401 or 403 | HALT; suspend the tool. A 403 can be ambiguous (the Block Aero platform skill notes this for its own API [S47]), so it is never retried. |
| Other 4xx | Run FAILED; no retry |
| `isError` with `processing_required` | Normal outcome, reported as "not processed" |
| Other `isError` or JSON-RPC error | Run FAILED |
| Session 404 mid-run | Run FAILED; the next run opens a new session |

Routines own their retries. They exit 0 for every handled outcome, so OpenClaw's own retry backoff after consecutive errors (30 s, 1 min, 5 min, 15 min, 60 min [S8]) never adds off-slot runs. They exit non-zero only when entering HALT, which records an error in OpenClaw [S8].

Failure alerts default to firing after two consecutive failures, with a one-hour cooldown. They need a delivery route, and a per-job `failureAlert` object can tune them [S8]. The RO jobs set the threshold to one failure once Q6 gives them a route. Until then, a HALT shows on the console tile and in the archive.

## 7. Observability and replay

### 7.1 Run archive (authoritative)

Location: `C:\arm-ro\runs\<job>\<account_label>\<slot_utc>\<attempt>\`. The folder is ACL'd to the three service users and Todd, and kept 90 days (Assumed, Q14).

| File | Contents |
| --- | --- |
| `manifest.json` | OpenClaw version; Ollama `/api/version` [S24]; model digests; ARM version; hashes of the guard, routine, catalog, certificates, routing table, and prompts; account label and key-ref name (never the key) |
| `state.jsonl` | Each state transition, with time and reason |
| `guard-calls.jsonl` | The guard's hash-chained log for this run (section 2.3) |
| `snapshot.jsonl` and `.sha256` | Bodies ARM returned, in call order |
| `facts.json` and `.sha256` | Computed facts |
| `model-calls.jsonl` | Full request (model, digest, options, messages) and full response, with `prompt_eval_count`, `eval_count`, and `load_duration` [S24], plus the console batch id if Q5 is approved |
| `validation.json` | Validator results, and which output path was used |
| `output/` | What was emitted |
| `audit.json` | Baseline, mid, post, and late snapshots and verdicts |
| `DONE` or `HALTED` | Terminal marker |

### 7.2 Ops console

This needs Q5, an extension of D3. Three additions are proposed:

1. Routine model calls go through an existing console route that calls `ollamaFetch`, so the TV's Context batch view shows each assembled prompt. The batch id is written into `model-calls.jsonl`.
2. A read-only runs index that reads the archive. For each run it shows job, slot, path through the state machine, audit verdict, facts hash, and a link to the output.
3. A health tile showing HALTED, KILL, ARM version, and the last audit verdict.

The console ring holds 30 batches, or about 20 MB (From PR #1), so it is the live view. Replay uses the archive. Without Q5, routines call Ollama directly, and only the archive records model calls.

### 7.3 OpenClaw's own logs

- JSONL file logs with redaction [S12].
- OpenTelemetry traces and metrics, which are on by default, with logs off [S13].
- Transcript redaction [S18].

In Phases 1–3 the RO agent should have no model turns. A transcript appearing at all is therefore a signal and raises an alert.

### 7.4 Replay and explain

- `routines/replay.mjs <run_dir>` re-runs COMPUTE and VALIDATE from the sealed snapshot without calling ARM. `facts.json` must match its SHA-256 exactly. With `--phrase`, it also re-runs T2 on the same model digest and reports any text difference.
- A nightly canary replays the previous day's J1 runs.
  - A facts mismatch is a code bug and HALTs.
  - A phrasing difference is logged as drift (N1). If drift passes a threshold (Q14), the job is switched to template-only by pull request.
- Any line of output can be explained by following the chain: the line names facts ids, the facts name snapshot records, the snapshot records match the guard's hashes, and the manifest pins every version involved.

## 8. Non-determinism register

| ID | Where | Why it varies | Containment | Test |
| --- | --- | --- | --- | --- |
| N1 | T2 phrasing | Model text | Temperature 0, pinned digest, schema, fact validator, template fallback; template-only in Phase 2 | Nightly replay drift |
| N2 | T3 intent classification (4A) | Model choice | Closed intent set; `unknown` returns the command list | Fixture set |
| N3 | Parameters (4A) | User wording | Fixed patterns; must appear verbatim | Unit tests |
| N4 | T4 quote selection | Model choice | Exact-substring check; "not found" otherwise | Fixture set |
| N5 | Agent reply (4B only) | Agent turn | Numbers and ids checked against tool results; per-turn cap | Transcript checker |
| N6 | First call after a model load | Reported to differ from later identical calls [S28 #7854, #16197] | Check `load_duration`; after a reload, discard and retry once | Phase 1 measurement |
| N7 | Ollama shared with the live agent | Parallel requests reported inconsistent [S28 #5636]; seed and temperature not always enough [S28 #5321] | One RO request at a time; fixed slots; default `OLLAMA_NUM_PARALLEL` of 1 [S26] | Phase 1 repeat test |
| N8 | Partial GPU offload | Different kernels and memory | `size_vram == size`, or template (R4) | J9 |
| N9 | ARM data | Records change | Sealed snapshots; outputs carry snapshot time | Replay |
| N10 | ARM version or envelope | Server changes | Version gate, catalog hashes, S14 manifest | Precheck |
| N11 | Network timing | Latency, retries | Fixed, bounded backoff with no jitter | Mock ARM tests |
| N12 | Scheduler | Sleep, DST, staggering | `--exact`, named time zone, no catch-up | DST and sleep tests |
| N13 | OpenClaw model selection | Failover and overrides | `fallbacks: []`, `modelPolicy.allow`, `session_status` denied [S9][S10] | Config test |
| N14 | OpenClaw tool policy across versions | Group membership changes [S1]; the older note about allow-lists failing open | Explicit deny list; L3 plugin; guard; effective-tool-list test on every upgrade | Phase 1 and every upgrade |
| N15 | Cloud tier (Phase 4) | Anthropic says temperature 0 is "not fully deterministic", and newer models accept only temperature 1.0 [S37]; OpenAI's seed is best effort [S38] | Disabled in v1; advisory only; never routes | — |
| N16 | Prompt truncation | Silent truncation possible (Assumed) | Byte budget before the call; `prompt_eval_count` check after (R7) | Unit test |
| N17 | moondream (Phase 4) | Vision model output | Not used in v1 | — |
| N18 | Retrieval ranking (J7) | Ties, tokenization | BM25 with a fixed tokenizer and tie-break; no embeddings | Golden files |
| N19 | Question wording | Humans | Slash commands in Phase 3; the 4A classifier later | — |
| N20 | Time-based logic | Wall clock | Slot time used as "now" | Replay |
| N21 | Ollama, driver, or model upgrades | Numerics | Digests and versions in the manifest; upgrades by pull request with a new baseline | Nightly replay |
| N22 | Late async work in ARM | Delay | Late audit; retraction | Mock ARM test |

## 9. Phased checklist

**Phase 0: decisions and ARM prerequisites (no changes on the laptop)**

- [ ] Todd answers Q1 (handshake writes) and Q2 (coexist or replace).
- [ ] Todd answers Q3, Q5, Q6, Q11, and Q12 before Phase 2.
- [ ] ARM ships S1–S7 on staging for the doc-derived reads.
- [ ] ARM completes C0 and C1 per tool. The platform architect reviews this plan.
- [ ] ARM CI produces C2 results per tool.
- Exit: a staging RO principal's `tools/list` shows only tools that passed C2.

**Phase 1: local build against a mock ARM (no ARM calls, no key)**

- [ ] Create `svc-armro-agent`, `svc-armro-guard`, and `svc-armro-audit`.
- [ ] Install the `arm-ro` profile on 19789 as `svc-armro-agent` [S4][S17], then run `openclaw doctor`.
- [ ] Build the guard, the auditor (against a local Postgres fixture), the policy plugin, routines J1–J3 and J9, the templates, and replay.
- [ ] Build a mock ARM that can return each of these:
  - normal results;
  - `isError`;
  - `processing_required`;
  - `tools/list_changed`;
  - a `sampling/createMessage` request;
  - a session 404;
  - 429 with `Retry-After`;
  - an oversize body;
  - an unknown tool in `tools/list`;
  - a bad receipt.
- [ ] Run the tests:
  - the agent's effective tool list is empty;
  - a throwing hook blocks the call;
  - all three key prefixes are redacted;
  - `security audit --deep` and `secrets audit --check` are clean;
  - kill switch drills K1–K3;
  - HALT and clear;
  - DST and sleep behavior;
  - ports 19789–19899, 18950, and 18951 are free.
- [ ] Measure Ollama on the box:
  - record full digests;
  - measure each VRAM row with `/api/ps`;
  - send 100 identical T2 calls and record whether outputs match;
  - check the first call after a load.
- [ ] Read the live agent's qwen3:8b context and heartbeat minutes. Set R5 and the RO slot minutes from them.
- [ ] If Q5 is yes, confirm or add the console route.
- Exit: all tests pass, and replaying mock runs gives byte-identical facts.

**Phase 2: attended production (Americas only)**

- [ ] C3 branch-diff evidence for each Phase 2 tool.
- [ ] ARM mints the Americas RO key (S7). Todd stores it in `svc-armro-guard`'s Credential Manager and runs the fingerprint check.
- [ ] `initialize` is unblocked, either by Todd answering Q1 or by ARM shipping S2.
- [ ] C4 canary: PR #1's option B through the guard, in a quiet window, with the PR #1 attestation plus the auditor.
- [ ] Enable J1–J3 attended and template-only for a fixed period (Assumed five business days, Q14).
- [ ] Turn T2 on per job only after its evaluation passes.
- Exit: no violations, no unverified audits, and clean receipts if S9 has shipped.

**Phase 3: unattended runs and lookups**

- [ ] ARM ships S8, S9, S14, and S16. Set `require_receipts: true`.
- [ ] Run J1–J3 unattended with the attributed audit.
- [ ] ARM ships S12. Certify those tools through C0–C4, then enable J4–J8 and the slash commands.
- Exit: a fixed clean period (Assumed two weeks, Q14).

**Phase 4: optional; each item is a separate decision**

- [ ] 4A free-text questions.
- [ ] moondream, only with an image tool that returns bytes without outside calls (Q7).
- [ ] Cloud tier (Q4).
- [ ] More accounts: one list entry and one RO key each.

## 10. Risks

| # | Risk | Mitigation | Residual |
| --- | --- | --- | --- |
| R1 | **Hidden side effects in "read" tools**, such as lazy OCR or briefing generation, rollup recompute, cursor advance, async jobs, or platform calls. A read that triggers processing costs Claude usage and breaks the core rule. | S4, S5, C1–C3, receipts, late audit | High until S4 and S9 ship |
| R2 | **The live full-worker pin on the same laptop.** `ARM_MCP_PIN` is reportedly a plaintext user environment variable. Every process of that user inherits it, including the shell, ADB, and browser skills. | Out of scope here; the RO side never sees the pin. Recommend moving it to Credential Manager under a separate user. | Unchanged by this plan |
| R3 | **Audit attribution.** Without S8, the diff cannot tell RO writes from the live agent's or human users'. That forces quiet windows, produces false alarms, and invites loosening the check. Async rows may also land after the window. | Attended quiet windows only until S8; late audit; `unverified` blocks runs | Medium |
| R4 | OpenClaw policy semantics drift between versions | Explicit denies, L3, guard, test on every upgrade | Low |
| R5 | Prompt injection through record text into a small model | No tools in model calls; validated output; code renders facts | Low |
| R6 | VRAM contention with the live agent, whose 14b-plus-moondream setup is already over budget | Fixed slots, residency check, template fallback, no global setting changes | Medium |
| R7 | Determinism drift after upgrades | Pinned digests, manifests, nightly replay | Low |
| R8 | Console ring eviction | The archive is authoritative | Low |
| R9 | Port 8788 collision | Never start `openclaw_mcp_gateway.py` here; S13 | Low |
| R10 | A Neon credential on the laptop | SELECT-only views; its own Windows user; the Q3 alternative | Medium |
| R11 | ARM's release cadence forcing frequent re-certification | S14 manifest | Medium until S14 |
| R12 | An S4U task cannot read the guard's DPAPI secret | Password-logon task; Phase 1 test | Low |
| R13 | Digests go stale while the live worker keeps acting | Outputs carry the snapshot time | Low |
| R14 | Cloud egress of record text (Phase 4) | Off in v1; Q4 | — |

## 11. Open questions for Todd

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | May the handshake write anything for the RO principal: `principals.last_briefing_*`, or a `login_events` row per session? | No to `last_briefing_*`; ARM ships S2. Yes to one attributed `login_events` row per session, so ARM keeps login auditing. |
| Q2 | Does the live full-worker agent keep running beside the RO agent? | Coexist, but pause it for the Phase 2 canary until S8 ships. |
| Q3 | Approve the extended audit list? Should the auditor run on the laptop or in Block Aero infrastructure? | Approve the list. Laptop with SELECT-only views for v1. |
| Q4 | Any cloud model for the RO side? | Not in v1. |
| Q5 | Extend D3 so RO routines' model calls, and a runs view, use the Ops console? | Yes, read-only views only. |
| Q6 | Where do digests go: local only, or a direct message to you, and on which channel? | Local only for Phase 2. |
| Q7 | Moondream on the RO side? | Not in v1. |
| Q8 | Keep `chat_messages` excluded from reads? May the auditor count its rows? | Exclude reads; allow counts. |
| Q9 | Is the RTX 4070 laptop the MSI `DESKTOP-3CKU4OO`, and is 11434 a local Ollama on it? | — |
| Q10 | Does ARM session expiry or DELETE write anything? Should the guard send DELETE? | ARM to answer; no DELETE until then. |
| Q11 | Guard and auditor code in this repo, or in ARM's `openclaw_mcp_gateway.py`? | This repo. |
| Q12 | RO key lifetime, rotation, and revocation; who mints keys; whether Credential Manager becomes the key ref, which changes D4's form | ARM mints; 90-day keys (Assumed); Credential Manager. |
| Q13 | Which document types are required per asset or event for gap reports, and who owns that list? | — |
| Q14 | Thresholds: expiry windows, aging buckets, phrasing pass rate, drift limit, latency factor, attended and clean periods, archive retention | Use the values marked Assumed in this plan until set. |

## 12. Smallest next three steps

1. **Todd answers Q1 and Q2.** They decide whether any MCP session can start, and how audits can work before attribution exists.
2. **ARM ships S1–S5 on staging, with C2 write-trap tests for the eight doc-derived reads.** That is the minimum before a key can be minted.
3. **Build the guard, auditor, policy plugin, and RO profile in this repo against a mock ARM (Phase 1).** This makes no ARM calls. The first real call afterwards is PR #1's option B, run through the guard.

## 13. Assumptions

| # | Assumption | Where it matters |
| --- | --- | --- |
| A1 | One machine hosts the live gateway, Ollama, and the Ops console (Q9). | 2.1, 2.6 |
| A2 | About 11 GB of the 12 GB VRAM is usable, after display and driver reserves. | 2.6 |
| A3 | Per-model runtime overhead is 0.4–0.8 GB. | 2.6 |
| A4 | Changing `num_ctx` on a loaded model reloads it. | R5 |
| A5 | Partial CPU offload can change outputs, not just speed. | R4, N8 |
| A6 | Ollama chat may silently truncate an over-long prompt. | R7, N16 |
| A7 | ARM can run a staging instance against a Neon branch. | C3 |
| A8 | `pg_stat_user_tables` counters settle within seconds after a test. | C3 |
| A9 | ARM's async work lands within 15 minutes. | 5.2 late audit |
| A10 | A latency factor of 5× p95 separates processing from normal reads. | 5.3 |
| A11 | Thresholds: 99% validator pass rate, five business days attended, two weeks clean, 90-day archive, 90-day keys. | 2.5, 9, 7.1, Q12 |
| A12 | The unauthenticated `GET /mcp` writes nothing. | 2.3 version gate |
| A13 | The live pulse polling runs about 14 hours a day. | 4 load comparison |
| A14 | The live heartbeat's minute marks are unknown until Phase 1. | 6.1 |
| A15 | The S4U limit on encrypted data applies to the guard's Credential Manager secret. | 5.5 |
| A16 | deepseek-r1:14b's reasoning length varies run to run. | 2.5 |
| A17 | CLI flags and config keys in current OpenClaw docs exist in v2026.9.4. | 2.4, 6.1 |
| A18 | Node is the preferred language for the guard, auditor, and routines. | 2.3 |

## 14. Not verified

- **ARM source.** Every "Reported" fact, including the envelope contract, the `initialize` write, the `ARM_MCP_PIN` storage, and the 8788 default. This session's probes of the ARM repo returned 404.
- **Every ARM tool name.** A live `tools/list` was not called, by design.
- Whether ARM accepts `tools/call` without `initialize`. The spec requires `initialize` first [S20].
- Whether `get_account_pulse` keeps a server-side cursor, whether `get_pulse_head` is per principal, and whether authentication writes `login_events` per session.
- **OpenClaw v2026.9.4 versus the current docs.** This covers tool-group contents, `minimal`, `alsoAllow`, `modelPolicy`, the `automations add` flags, `failureAlert` fields, and the scheduled-task name for a profile install.
- The older note that an allow-list naming only unknown tools is ignored (commit `b40da2cb`). It was not re-opened.
- Whether `mcp.servers.*.headers` accepts SecretRefs. This session's reading says no [S2][S16].
- **VRAM and throughput figures.** They are third-party estimates that conflict for qwen3:14b [S33][S34][S36], and they were not measured.
- **BFCL scores.** Vendor self-reported, read through aggregators [S35].
- Whether the machine with the RTX 4070 is the MSI (Q9).

## 15. Sources

Read on 2026-10-05. OpenClaw docs URLs were mapped through the docs index at https://docs.openclaw.ai/llms.txt.

**OpenClaw**

- [S1] Tool policy: https://docs.openclaw.ai/gateway/config-tools/tool-policy ; https://docs.openclaw.ai/gateway/config-tools
- [S2] MCP servers (`mcp.servers`, `toolFilter`, `requestTimeoutMs`, `supportsParallelToolCalls`): https://docs.openclaw.ai/gateway/config-extensions
- [S3] Gateway config: https://docs.openclaw.ai/gateway/config-gateway
- [S4] Multiple gateways and derived ports: https://docs.openclaw.ai/gateway/multiple-gateways
- [S5] Plugin tool-policy hooks, trusted policies, and commands: https://docs.openclaw.ai/plugins/hooks/tool-policy ; https://docs.openclaw.ai/plugins/hooks/reference
- [S6] `before_tool_call` source at commit `fbdf5937`: https://github.com/openclaw/openclaw/blob/fbdf5937/src/agents/agent-tools.before-tool-call.ts
- [S7] Automation payloads (command payloads): https://docs.openclaw.ai/automation/cron-jobs/payloads
- [S8] Automations CLI (schedules, `--exact`, delivery, backoff, failure alerts, `operator.admin`): https://docs.openclaw.ai/cli/cron
- [S9] Model failover and `session_status` overrides: https://docs.openclaw.ai/concepts/model-failover
- [S10] Agents config (`modelPolicy`) and heartbeat: https://docs.openclaw.ai/gateway/config-agents ; https://docs.openclaw.ai/gateway/config-agents/heartbeat-compaction-and-streaming ; https://docs.openclaw.ai/gateway/heartbeat
- [S11] Ollama provider: https://docs.openclaw.ai/providers/ollama
- [S12] Logging and redaction: https://docs.openclaw.ai/gateway/logging
- [S13] OpenTelemetry: https://docs.openclaw.ai/gateway/opentelemetry/configuration
- [S14] Security and prompt injection: https://docs.openclaw.ai/gateway/security ; https://docs.openclaw.ai/gateway/security/prompt-injection
- [S15] Security audit checks: https://docs.openclaw.ai/gateway/security/audit-checks
- [S16] Secrets: https://docs.openclaw.ai/gateway/secrets
- [S17] Windows (Scheduled Task, S4U, service user): https://docs.openclaw.ai/platforms/windows
- [S18] Transcript redaction: https://github.com/openclaw/openclaw/pull/73563

**MCP 2025-03-26**

- [S20] Lifecycle: https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle
- [S21] Transports (Streamable HTTP, sessions, Origin): https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- [S22] Changelog (batching, tool annotations): https://modelcontextprotocol.io/specification/2025-03-26/changelog
- [S23] Schema (`ToolAnnotations`, `_meta`, `isError`, `list_changed`): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-03-26/schema.ts

**Ollama**

- [S24] API reference (`/api/ps`, `/api/tags`, `/api/version`, `keep_alive`, `load_duration`, embed `truncate`): https://github.com/ollama/ollama/blob/main/docs/api.md
- [S25] Chat API: https://docs.ollama.com/api/chat
- [S26] FAQ (context defaults, parallelism, loaded models, KV cache type): https://docs.ollama.com/faq
- [S27] Structured outputs: https://docs.ollama.com/capabilities/structured-outputs
- [S28] Determinism issues: https://github.com/ollama/ollama/issues/586 ; https://github.com/ollama/ollama/issues/5321 ; https://github.com/ollama/ollama/issues/5636 ; https://github.com/ollama/ollama/issues/7854 ; https://github.com/ollama/ollama/issues/16197
- [S29] Model library pages (sizes, digests, metadata): https://ollama.com/library/qwen3 ; https://ollama.com/library/deepseek-r1:14b ; https://ollama.com/library/moondream
- [S30] KV cache quantization: https://github.com/ollama/ollama/pull/5894

**Models and benchmarks**

- [S31] Qwen3-14B model card: https://huggingface.co/Qwen/Qwen3-14B
- [S32] Qwen3-8B model card: https://huggingface.co/Qwen/Qwen3-8B
- [S33] RTX 4070 throughput: https://www.hardware-corner.net/gpu-llm-benchmarks/rtx-4070/ ; https://smeltcore.com/recipes/qwen3-14b-on-rtx-4070-q4-k-m-gguf-via-ollama-or-llama-cpp/
- [S34] qwen3:14b VRAM estimates: https://localmodel.run/can-i-run/qwen3-14b/nvidia-rtx-4070-12gb ; https://vramguide.com/can-i-run/qwen3-14b-on-rtx-4070/ ; https://willitrunai.com/can-run/qwen-3-14b-on-rtx-4070-12gb
- [S35] BFCL v3 (vendor self-reported scores): https://genailist.net/benchmark/bfcl-v3 ; https://modelbeats.com/benchmarks/bfcl-v3
- [S36] DeepSeek-R1 14B local guide (VRAM, temperature): https://localaimaster.com/blog/deepseek-r1-local-setup-guide

**Cloud APIs**

- [S37] Anthropic Messages API (temperature): https://platform.claude.com/docs/en/api/cli/messages/create
- [S38] OpenAI chat completions (seed, `system_fingerprint`): https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/ ; https://developers.openai.com/api/docs/guides/advanced-usage

**Windows**

- [S39] Process environment inheritance: https://learn.microsoft.com/en-us/windows/win32/procthread/inheritance
- [S40] User environment variable storage: https://learn.microsoft.com/en-us/dotnet/api/system.environment.setenvironmentvariable
- [S41] DPAPI `CryptProtectData`: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
- [S42] Handling passwords (Credential Manager): https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords
- [S43] User environment variables: https://learn.microsoft.com/en-us/windows/win32/shell/user-environment-variables

**Postgres and Neon**

- [S44] `SET TRANSACTION`: https://www.postgresql.org/docs/current/sql-set-transaction.html
- [S45] Neon computes and read replicas: https://neon.com/docs/manage/computes ; https://neon.com/docs/introduction/read-replicas
- [S46] Neon branching: https://neon.com/docs/introduction/branching

**Block Aero**

- [S47] `Block-Aero/blockaero-claude-plugin` v0.2.0 at commit `edff30c`, read from the local plugin cache: `skills/block-aero-rest-client/SKILL.md` lines 76–89 (tenant-scoped keys, endpoint allow-list enforced by method and route, `LastUsed` stamping, never echo keys) and lines 107–112 (API key middleware, ambiguous 403); `CLAUDE.md` line 22 (tenant isolation is mandatory).

Earlier evidence for ARM, the MSI, and Neon is in the PR #1 plan, not here.
