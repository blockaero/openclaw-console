import { NO_RETRY_STATUSES, RETRY_WAITS_MS } from "./policy.mjs";

// Three ARM attempts. After the first failure wait 5s and retry. After the
// second, wait 10s and retry. After the third, wait 20s and halt. No fourth
// request. 400, 401, 403, and 404 halt with no retry.

export function retryDecision(status, failuresSoFar) {
  if (NO_RETRY_STATUSES.has(status)) {
    return { action: "halt", retry: false, reason: `http_${status}` };
  }
  if (status === 429 || status === 503) {
    if (failuresSoFar >= 3) {
      return { action: "halt", retry: false, waitMs: RETRY_WAITS_MS[2], reason: "third_identical_error" };
    }
    return {
      action: "retry",
      retry: true,
      waitMs: RETRY_WAITS_MS[failuresSoFar - 1],
      reason: `http_${status}`,
    };
  }
  if (typeof status === "number" && status >= 400) {
    return { action: "fail", retry: false, reason: `http_${status}` };
  }
  return { action: "ok", retry: false, reason: "ok" };
}

export async function withRetry(attempt, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let failures = 0;
  let last;
  for (;;) {
    last = await attempt();
    const status = last?.httpStatus;
    if (status === undefined || status < 400) return { ok: true, result: last, failures };
    failures += 1;
    const decision = retryDecision(status, failures);
    if (!decision.retry) {
      const error = new Error(decision.reason);
      error.code = decision.action === "halt" ? "halt" : "call_failed";
      error.httpStatus = status;
      error.failures = failures;
      if (decision.waitMs && decision.action === "halt" && failures >= 3) {
        await sleep(decision.waitMs);
      }
      throw error;
    }
    await sleep(decision.waitMs);
  }
}
