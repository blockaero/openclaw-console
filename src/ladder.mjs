// Client-side half of the certification ladder. C0–C3 run in ARM CI, which is
// not this repository. Nothing here marks a tool certified, and nothing here
// mints a key. Smoke (C4) is the canary and does not require a prior certificate.
// Standing jobs require C4. Unattended runs require C5 and a receipt.

import { isPhase2Tool } from "./policy.mjs";
import { isPhase3Placeholder } from "./phase3.mjs";

const RANK = Object.freeze({ C0: 0, C1: 1, C2: 2, C3: 3, C4: 4, C5: 5 });

export function ladderAllows(name, { mode = "smoke", certification = {} } = {}) {
  if (isPhase3Placeholder(name) || !isPhase2Tool(name)) {
    return { ok: false, reason: "tool_denied", name };
  }
  if (mode === "smoke") return { ok: true, reason: "c4_is_the_smoke", name };
  const need = mode === "unattended" ? "C5" : "C4";
  const record = certification[name];
  const rank = RANK[record?.through];
  if (record?.pass !== true || rank === undefined || rank < RANK[need]) {
    return { ok: false, reason: "uncertified", name, need };
  }
  if (mode === "unattended" && record.receipt !== true) {
    return { ok: false, reason: "receipt_missing", name, need };
  }
  return { ok: true, reason: need, name };
}
