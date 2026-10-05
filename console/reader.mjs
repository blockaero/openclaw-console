import { AS_OF, account, records, session } from "./fixtures.mjs";

// Reads the guard is allowed to perform. Local proposals are not in this set:
// an ARM propose_* call would create a row, and this reader refuses that name.
export const READ_TOOLS = Object.freeze([
  "open_account",
  "open_session",
  "list_processed_records",
]);

const READ_SET = new Set(READ_TOOLS);

const DENIED = new Set([
  "propose_work_item",
  "propose_work_items",
  "claim_work_item",
  "complete_work_item",
  "post_session_message",
  "put_pulse_head",
  "report_runtime_usage",
  "get_briefing",
]);

export function assertReadable(tool) {
  if (DENIED.has(tool) || !READ_SET.has(tool)) {
    const error = new Error(`tool_denied:${tool}`);
    error.code = "tool_denied";
    throw error;
  }
}

function daysUntil(isoDate, asOf) {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const today = Date.parse(`${asOf}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

export function proposeFromProcessed(processed, asOf = AS_OF) {
  const proposals = [];
  for (const record of processed) {
    if (record.life_limited === true && record.birth_record === false) {
      proposals.push({
        proposal_id: `prop-${record.record_id}-btb`,
        source_record_id: record.record_id,
        title: `Collect back-to-birth for ${record.part_number}`,
        reason: "Life-limited part has a processed release certificate and no birth record.",
        posted_to_arm: false,
      });
    }
    if (Array.isArray(record.missing_fields) && record.missing_fields.includes("time_cycles_since_overhaul")) {
      proposals.push({
        proposal_id: `prop-${record.record_id}-cycles`,
        source_record_id: record.record_id,
        title: `Request time and cycle statement for ${record.part_number}`,
        reason: "Processed shop visit is missing cycles since overhaul.",
        posted_to_arm: false,
      });
    }
    if (typeof record.expires_on === "string") {
      const days = daysUntil(record.expires_on, asOf);
      if (days >= 0 && days <= 30) {
        proposals.push({
          proposal_id: `prop-${record.record_id}-expiry`,
          source_record_id: record.record_id,
          title: `Renew ${record.doc_type_code} for ${record.part_number} before ${record.expires_on}`,
          reason: `Processed certificate expires in ${days} days.`,
          posted_to_arm: false,
        });
      }
    }
    if (record.doc_type_code == null) {
      proposals.push({
        proposal_id: `prop-${record.record_id}-doctype`,
        source_record_id: record.record_id,
        title: `Classify ${record.part_number} against the doc type registry`,
        reason: "Processed record has no doc type code.",
        posted_to_arm: false,
      });
    }
  }
  return proposals;
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One read-only run.
 * Order is fixed: open the account, open a session, list processed records,
 * then build a local work-item proposal. Nothing is sent to ARM.
 */
export async function executeRun(emit, options = {}) {
  const paceMs = options.paceMs ?? 0;
  const world = options.world ?? { account, records, session };

  const steps = [
    {
      tool: "open_account",
      title: "Open account",
      input: { tool: "open_account", account_id: world.account.account_id },
      output: () => ({ ...world.account }),
    },
    {
      tool: "open_session",
      title: "Open session",
      input: {
        tool: "open_session",
        account_id: world.account.account_id,
        mode: "read_only",
      },
      output: () => ({ ...world.session, account_id: world.account.account_id }),
    },
    {
      tool: "list_processed_records",
      title: "Processed records",
      input: {
        tool: "list_processed_records",
        session_id: world.session.session_id,
        filter: { status: "processed" },
      },
      output: () => {
        const processed = world.records.filter((record) => record.status === "processed");
        return { count: processed.length, records: processed };
      },
    },
  ];

  let processed = [];
  for (const step of steps) {
    assertReadable(step.tool);
    const batchId = step.tool;
    await emit({
      type: "input",
      batchId,
      tool: step.tool,
      title: step.title,
      input: step.input,
    });
    await sleep(paceMs);
    const output = step.output();
    if (step.tool === "list_processed_records") processed = output.records;
    await emit({
      type: "output",
      batchId,
      tool: step.tool,
      title: step.title,
      output,
    });
    await sleep(paceMs);
  }

  const proposals = proposeFromProcessed(processed);
  await emit({
    type: "input",
    batchId: "propose_work_items_local",
    tool: "propose_work_items_local",
    title: "Propose work items",
    input: {
      tool: "propose_work_items_local",
      session_id: world.session.session_id,
      posted_to_arm: false,
      record_ids: processed.map((record) => record.record_id),
    },
  });
  await sleep(paceMs);
  await emit({
    type: "output",
    batchId: "propose_work_items_local",
    tool: "propose_work_items_local",
    title: "Propose work items",
    output: {
      posted_to_arm: false,
      count: proposals.length,
      proposals,
    },
  });

  return { proposals };
}
