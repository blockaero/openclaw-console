export function computeFacts(records) {
  const byType = {};
  for (const record of records) {
    const type = record?.record_type ?? "unknown";
    byType[type] = (byType[type] ?? 0) + 1;
  }
  const ordered = Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b)));
  return { records: records.length, by_type: ordered };
}

export function renderTemplate(facts) {
  const lines = [`Records: ${facts.records}`];
  for (const [type, count] of Object.entries(facts.by_type)) {
    lines.push(`${type}: ${count}`);
  }
  return `${lines.join("\n")}\n`;
}
