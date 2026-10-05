import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE2_SET } from "./policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function profilePaths(from = root) {
  return {
    profile: join(from, "profiles", "arm-ro", "openclaw.json"),
    jobs: join(from, "profiles", "arm-ro", "jobs.json"),
  };
}

export function loadArmRoDirection(from = root) {
  const paths = profilePaths(from);
  const profile = JSON.parse(readFileSync(paths.profile, "utf8"));
  const jobs = JSON.parse(readFileSync(paths.jobs, "utf8"));
  assertProfileDirection(profile);
  assertJobCatalog(jobs);
  return { profile, jobs, paths };
}

export function assertProfileDirection(profile) {
  const problems = [];
  const encoded = JSON.stringify(profile);
  if (encoded.includes("agentic-records-manager.com")) problems.push("arm_url");
  if (encoded.includes("ARM_MCP_PIN")) problems.push("live_pin_name");
  if (encoded.includes("armpin_")) problems.push("pin_literal");
  if (encoded.includes("get_briefing")) problems.push("briefing_tool");
  if ("mcp" in profile) problems.push("mcp_block");
  if (profile.gateway?.port !== 19789) problems.push("port");
  if (profile.gateway?.bind !== "loopback") problems.push("bind");
  if (profile.agents?.defaults?.heartbeat?.every !== "0m") problems.push("heartbeat");
  const agent = profile.agents?.entries?.["arm-ro"];
  if (!agent) problems.push("agent");
  if (!Array.isArray(agent?.model?.fallbacks) || agent.model.fallbacks.length !== 0) problems.push("fallbacks");
  if (JSON.stringify(agent?.modelPolicy?.allow) !== JSON.stringify(["ollama/qwen3:8b"])) problems.push("model_policy");
  const params = profile.models?.providers?.ollama?.models?.[0]?.params;
  if (params?.temperature !== 0) problems.push("temperature");
  if (params?.seed !== 7) problems.push("seed");
  if (params?.thinking !== false) problems.push("thinking");
  if (profile.models?.providers?.ollama?.baseUrl !== "http://127.0.0.1:11434") problems.push("ollama_base");
  if (profile.tools?.profile !== "minimal") problems.push("tools_profile");
  if (!Array.isArray(profile.tools?.deny) || profile.tools.deny.length === 0) problems.push("tools_deny");
  if (profile.tools?.allow) problems.push("tools_allow");
  if (profile.tools?.codeMode?.enabled !== false) problems.push("code_mode");
  if (profile.tools?.elevated?.enabled !== false) problems.push("elevated");
  if (problems.length > 0) {
    const error = new Error(`profile_direction:${problems.join(",")}`);
    error.code = "profile_direction";
    error.problems = problems;
    throw error;
  }
  return profile;
}

export function assertJobCatalog(catalog) {
  const problems = [];
  if (catalog.exact !== true) problems.push("exact");
  if (catalog.catch_up !== false) problems.push("catch_up");
  if (catalog.tz !== "America/Los_Angeles") problems.push("tz");
  if (!Array.isArray(catalog.jobs)) problems.push("jobs");
  for (const job of catalog.jobs ?? []) {
    for (const tool of job.tools ?? []) {
      if (!PHASE2_SET.has(tool)) problems.push(`tool:${job.id}:${tool}`);
    }
    if ((job.tools ?? []).includes("get_briefing")) problems.push(`briefing:${job.id}`);
    if (job.phase === 3 && (job.tools ?? []).length > 0) problems.push(`phase3_tools:${job.id}`);
  }
  if (problems.length > 0) {
    const error = new Error(`job_catalog:${problems.join(",")}`);
    error.code = "job_catalog";
    error.problems = problems;
    throw error;
  }
  return catalog;
}

export function runId(jobId, accountLabel, slotUtc) {
  return `${jobId}:${accountLabel}:${slotUtc}`;
}

export function planSlot({ jobId, accountLabel, slotUtc, nowUtc, doneRunIds = [] }) {
  const id = runId(jobId, accountLabel, slotUtc);
  if (typeof slotUtc !== "string" || typeof nowUtc !== "string") {
    return { action: "blocked", reason: "slot_required", run_id: id };
  }
  if (doneRunIds.includes(id)) return { action: "skip", reason: "already_done", run_id: id };
  if (slotUtc !== nowUtc) return { action: "missed", reason: "no_catch_up", run_id: id };
  return { action: "run", reason: "exact_slot", run_id: id };
}
