import { pathToFileURL } from "node:url";
import { createGuard } from "./guard.mjs";
import { loadArmRoDirection, planSlot } from "./profile.mjs";

export async function runScriptedJob({
  jobId,
  accountLabel,
  slotUtc,
  nowUtc,
  doneRunIds,
  guard,
  armReadonlyLevelReady = false,
} = {}) {
  const catalog = loadArmRoDirection().jobs;
  const job = catalog.jobs.find((item) => item.id === jobId);
  if (!job) {
    return { action: "blocked", reason: "unknown_job", arm_calls: 0 };
  }
  if (job.phase === 3 || job.blocked) {
    return {
      action: "blocked",
      reason: job.blocked ?? "phase3_waiting_on_arm_tool",
      arm_calls: 0,
      tools: [],
    };
  }

  const slot = planSlot({ jobId, accountLabel, slotUtc, nowUtc, doneRunIds });
  if (slot.action !== "run") return { ...slot, arm_calls: 0, tools: job.tools };

  const active = guard ?? createGuard({ halted: true });
  if (armReadonlyLevelReady === true) {
    active.clearHalt({ armReadonlyLevelReady: true });
  }
  const pre = await active.precheck();
  if (!pre.ok) {
    return {
      action: "blocked",
      reason: pre.reason,
      run_id: slot.run_id,
      arm_calls: active.armCalls,
      state: active.state,
      tools: [],
    };
  }

  const fetched = [];
  for (const tool of job.tools) {
    if (!pre.certified.includes(tool)) continue;
    await active.call(tool, {});
    fetched.push(tool);
  }
  return {
    action: "fetched",
    reason: "template_only",
    run_id: slot.run_id,
    tools: fetched,
    phrase: false,
    arm_calls: active.armCalls,
    state: "SEAL",
    next: "AUDIT_MID",
    next_blocked: "auditor_not_in_this_scaffold",
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const jobId = argument("--job");
  if (!jobId) {
    const { jobs } = loadArmRoDirection();
    process.stdout.write(`${JSON.stringify({ jobs: jobs.jobs.map((job) => job.id), arm_calls: 0, blocked_on: "arm_read_only_level" }, null, 2)}\n`);
    return;
  }
  const result = await runScriptedJob({
    jobId,
    accountLabel: argument("--account") ?? "example",
    slotUtc: argument("--slot"),
    nowUtc: argument("--now"),
    armReadonlyLevelReady: false,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
