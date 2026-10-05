import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("scaffold sources do not open a network client", () => {
  const files = readdirSync("src").filter((name) => name.endsWith(".mjs"));
  for (const name of files) {
    const source = readFileSync(join("src", name), "utf8");
    assert.equal(source.includes("node:http"), false, name);
    assert.equal(source.includes("node:https"), false, name);
    assert.equal(source.includes("node:net"), false, name);
    assert.equal(source.includes("fetch("), false, name);
    assert.equal(source.includes("undici"), false, name);
  }
});
