const batchesEl = document.querySelector("#batches");
const inputEl = document.querySelector("#input");
const outputEl = document.querySelector("#output");
const proposalsEl = document.querySelector("#proposals");
const proposalList = document.querySelector("#proposal-list");
const replay = document.querySelector("#replay");

const batches = new Map();
let selectedId = null;

function show(batch) {
  selectedId = batch.id;
  inputEl.textContent = JSON.stringify(batch.input, null, 2);
  outputEl.textContent = batch.output
    ? JSON.stringify(batch.output, null, 2)
    : "Waiting for output.";
  renderList();
  renderProposals(batch);
}

function renderList() {
  batchesEl.replaceChildren();
  for (const batch of batches.values()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", batch.id === selectedId ? "true" : "false");
    button.textContent = batch.title;
    const status = document.createElement("small");
    status.textContent = batch.status === "complete" ? "output ready" : "input sent";
    button.append(status);
    button.addEventListener("click", () => show(batch));
    item.append(button);
    batchesEl.append(item);
  }
}

function renderProposals(batch) {
  if (!batch.output || !Array.isArray(batch.output.proposals)) return;
  proposalList.replaceChildren();
  for (const proposal of batch.output.proposals) {
    const item = document.createElement("li");
    item.textContent = proposal.title;
    const why = document.createElement("span");
    why.textContent = ` — ${proposal.reason} Not posted.`;
    item.append(why);
    proposalList.append(item);
  }
  proposalsEl.hidden = false;
}

function applyBatch(batch) {
  batches.set(batch.id, batch);
  if (!selectedId || selectedId === batch.id || batch.status === "awaiting_output") {
    show(batch);
  } else {
    renderList();
  }
}

const stream = new EventSource("/api/model-io/stream");
stream.onopen = async () => {
  const existing = await fetch("/api/model-io/batches").then((response) => response.json());
  for (const batch of existing.batches) applyBatch(batch);
  if (existing.batches.length === 0 && !existing.running) run();
};
stream.onmessage = (message) => {
  const event = JSON.parse(message.data);
  if (event.type === "reset") {
    batches.clear();
    selectedId = null;
    proposalsEl.hidden = true;
    proposalList.replaceChildren();
    inputEl.textContent = "Waiting for the run.";
    outputEl.textContent = "Output appears after each input.";
    renderList();
    return;
  }
  if (event.type === "batch") applyBatch(event.batch);
};

async function run() {
  replay.disabled = true;
  try {
    await fetch("/api/reader/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paceMs: 700 }),
    });
  } finally {
    window.setTimeout(() => {
      replay.disabled = false;
    }, 8000);
  }
}

replay.addEventListener("click", run);
run();
