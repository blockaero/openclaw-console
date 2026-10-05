import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.mjs";

test("a run streams input then output and keeps proposals off ARM", async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const started = await fetch(`${base}/api/reader/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paceMs: 0 }),
  });
  assert.equal(started.status, 202);

  const deadline = Date.now() + 2000;
  let batches = [];
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/model-io/batches`);
    const body = await response.json();
    batches = body.batches;
    const proposal = batches.find((batch) => batch.id === "propose_work_items_local");
    if (proposal && proposal.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.deepEqual(
    batches.map((batch) => batch.id),
    ["open_account", "open_session", "list_processed_records", "propose_work_items_local"],
  );
  for (const batch of batches) {
    assert.ok(batch.input);
    assert.equal(batch.status, "complete");
    assert.ok(batch.output);
  }
  const proposal = batches.at(-1);
  assert.equal(proposal.output.posted_to_arm, false);
  assert.ok(proposal.output.proposals.length >= 4);
  assert.equal(
    proposal.output.proposals.every((item) => item.posted_to_arm === false),
    true,
  );

  const one = await fetch(`${base}/api/model-io/batches/open_account`);
  assert.equal(one.status, 200);
  const account = await one.json();
  assert.equal(account.output.source, "fixture");

  server.close();
});
