// Every exercise file loads, has a starter, and the untouched starter code does NOT pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { loadExercise, runChecks } = require("./exercise_harness.cjs");

const root = new URL("../courses/", import.meta.url).pathname;
for (const course of fs.readdirSync(root)) {
  const dir = path.join(root, course, "exercises");
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    test(`${course}/${f}: loads and the starter does not pass`, async () => {
      const ex = loadExercise(path.join(dir, f));
      assert.equal(ex.id, f.replace(/\.js$/, ""));
      assert.ok(ex.starter && ex.prompt && typeof ex.tests === "function");
      const r = await runChecks(ex, ex.starter);
      assert.equal(r.passed, false);
    });
  }
}
