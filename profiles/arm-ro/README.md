# arm-ro profile direction

This directory is the tool-less read-only profile from the reconciled standing-reader plan. It is not installed. Do not copy it onto the MSI until `openclaw doctor` has been run against OpenClaw `v2026.9.4` and the ARM read-only level exists.

`openclaw.json` has no `mcp.servers` entry, no ARM URL, and no ARM key. Heartbeats are off (`every: 0m`). The effective tool list is empty: `tools.profile` is `minimal`, the deny list covers the OpenClaw tool groups, and `profiles/arm-ro/policy.mjs` blocks every tool call. Model narration, when a later phase turns it on, is `qwen3:8b` at temperature 0, seed 7, thinking off. Fallbacks are empty.

Jobs are command jobs in `jobs.json`: `--exact`, `America/Los_Angeles`, no catch-up. The slot is the scheduled time. A missed slot is logged and not replayed. Phase 2 jobs are template-only and refuse ARM until a C4 certificate is supplied. Phase 3 has no tool names. Unattended runs also need C5 and a receipt. This directory does not contain either certificate.

The smoke one-shot is `node src/smoke.mjs`. It is not a standing schedule. How that run proceeds after ARM ships the read-only level is `docs/smoke-after-arm.md`.
