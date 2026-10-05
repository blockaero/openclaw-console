import assert from "node:assert/strict";
import test from "node:test";
import { executeRun, assertReadable } from "./reader.mjs";

test("run opens the account, a session, processed records, then local proposals", async () => {
  const events = [];
  const result = await executeRun((event) => events.push(event), { paceMs: 0 });

  const tools = events.filter((event) => event.type === "input").map((event) => event.tool);
  assert.deepEqual(tools, [
    "open_account",
    "open_session",
    "list_processed_records",
    "propose_work_items_local",
  ]);

  const listed = events.find(
    (event) => event.type === "output" && event.tool === "list_processed_records",
  );
  assert.equal(listed.output.records.some((record) => record.status !== "processed"), false);
  assert.equal(listed.output.records.some((record) => record.record_id === "rec-inbox"), false);

  const proposed = events.find(
    (event) => event.type === "output" && event.tool === "propose_work_items_local",
  );
  assert.equal(proposed.output.posted_to_arm, false);
  assert.equal(proposed.output.count, result.proposals.length);
  assert.ok(result.proposals.length >= 4);

  const sourceIds = new Set(listed.output.records.map((record) => record.record_id));
  for (const proposal of result.proposals) {
    assert.equal(proposal.posted_to_arm, false);
    assert.equal(sourceIds.has(proposal.source_record_id), true);
  }
  assert.equal(
    result.proposals.some((proposal) => proposal.source_record_id === "rec-ad-status"),
    false,
  );
});

test("ARM mutators are refused", () => {
  for (const tool of ["propose_work_item", "claim_work_item", "complete_work_item", "get_briefing"]) {
    assert.throws(() => assertReadable(tool), (error) => error.code === "tool_denied");
  }
});
