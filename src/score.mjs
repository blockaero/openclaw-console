import { CLASSIFICATIONS } from "./policy.mjs";

function parseOutput(value) {
  if (typeof value === "string") return JSON.parse(value);
  if (value && typeof value === "object") return value;
  throw new Error("not_json");
}

export function lookupPath(payload, path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("[") || path.includes(" ")) {
    return { found: false };
  }
  const parts = path.split(".");
  let current = payload;
  for (const part of parts) {
    if (part.length === 0 || !current || typeof current !== "object" || Array.isArray(current)) {
      return { found: false };
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) return { found: false };
    current = current[part];
  }
  return { found: true, value: current };
}

function valuesMatch(source, cited) {
  if (typeof source === "string" || typeof cited === "string") {
    return String(source).trim() === String(cited).trim();
  }
  return Object.is(source, cited);
}

function digitRuns(text) {
  return typeof text === "string" ? (text.match(/\d{4,}/g) ?? []) : [];
}

export function scoreModelOutput({ recordId, payload, modelOutput, repairOutput }) {
  const unsupported = [];
  const falseMissing = [];
  const identifiers = [];
  let parsed;
  let repaired = false;
  try {
    parsed = parseOutput(modelOutput);
  } catch {
    if (repairOutput === undefined) {
      return { pass: false, reason: "parse", unsupported_citations: [], false_missing: [], identifiers_not_in_source: [] };
    }
    try {
      parsed = parseOutput(repairOutput);
      repaired = true;
    } catch {
      return { pass: false, reason: "parse", repaired: false, unsupported_citations: [], false_missing: [], identifiers_not_in_source: [] };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { pass: false, reason: "shape", repaired, unsupported_citations: [], false_missing: [], identifiers_not_in_source: [] };
  }
  if (parsed.record_id !== recordId) {
    return { pass: false, reason: "record_id", repaired, unsupported_citations: [], false_missing: [], identifiers_not_in_source: [] };
  }
  if (!CLASSIFICATIONS.includes(parsed.classification)) {
    return { pass: false, reason: "classification", repaired, unsupported_citations: [], false_missing: [], identifiers_not_in_source: [] };
  }

  const canonical = JSON.stringify(payload ?? null);
  for (const run of digitRuns(parsed.summary)) {
    if (!canonical.includes(run)) identifiers.push(run);
  }

  for (const cited of parsed.cited_fields ?? []) {
    const looked = lookupPath(payload, cited?.path);
    if (!looked.found || !valuesMatch(looked.value, cited?.value)) {
      unsupported.push({ path: cited?.path ?? null, model_value: cited?.value });
    }
  }
  for (const anomaly of parsed.anomalies ?? []) {
    const looked = lookupPath(payload, anomaly?.path);
    if (!looked.found || !valuesMatch(looked.value, anomaly?.source_value)) {
      unsupported.push({ path: anomaly?.path ?? null, model_value: anomaly?.source_value });
    }
  }
  for (const path of parsed.missing_fields ?? []) {
    const looked = lookupPath(payload, path);
    if (looked.found && looked.value !== null && looked.value !== undefined) falseMissing.push(path);
  }

  const pass = unsupported.length === 0 && falseMissing.length === 0 && identifiers.length === 0;
  return {
    pass,
    reason: pass ? "ok" : "citation",
    repaired,
    unsupported_citations: unsupported,
    false_missing: falseMissing,
    identifiers_not_in_source: identifiers,
  };
}
