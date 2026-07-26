import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCronAction } from "./cron-policy.ts";

test("does nothing when the app is disabled", () => {
  assert.equal(decideCronAction(false, "true"), "disabled");
  assert.equal(decideCronAction(false, "false"), "disabled");
  assert.equal(decideCronAction(false, null), "disabled");
});

test("seeds (no posting) on the first enabled run after install", () => {
  // Fresh install: appEnabled defaults to true, no prior state recorded.
  assert.equal(decideCronAction(true, null), "seed");
});

test("seeds (no posting) when the app is toggled off then back on", () => {
  // Previous cron saw the app disabled; enabling must not dump the backlog.
  assert.equal(decideCronAction(true, "false"), "seed");
});

test("posts normally once a baseline is already established", () => {
  assert.equal(decideCronAction(true, "true"), "post");
});
