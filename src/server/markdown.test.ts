import { test } from "node:test";
import assert from "node:assert/strict";
import { clampListNesting } from "./markdown.ts";

test("flattens list nesting deeper than 2 tiers (ATP repro)", () => {
  const input = [
    "* Topic",
    "  * Sub point",
    "    * Sub-sub point",
    "      * Sub-sub-sub point",
  ].join("\n");

  const out = clampListNesting(input);
  // No list-item line may be indented more than one nesting tier (2 spaces).
  for (const line of out.split("\n")) {
    const m = line.match(/^(\s*)([-*+]|\d+[.)])\s/);
    if (m) assert.ok((m[1] ?? "").length <= 2, `over-indented list item: ${JSON.stringify(line)}`);
  }
  assert.equal(out, ["* Topic", "  * Sub point", "  * Sub-sub point", "  * Sub-sub-sub point"].join("\n"));
});

test("leaves already-shallow lists unchanged in depth", () => {
  const input = ["1. First", "  * child", "2. Second"].join("\n");
  const out = clampListNesting(input);
  assert.equal(out, input);
});

test("preserves ordered-list markers and inline text", () => {
  const input = ["1. One", "  1) Nested", "    - deep"].join("\n");
  const out = clampListNesting(input);
  assert.equal(out, ["1. One", "  1) Nested", "  - deep"].join("\n"));
});

test("does not touch fenced code blocks", () => {
  const input = ["```", "        * not a list, it is code", "```"].join("\n");
  const out = clampListNesting(input);
  assert.equal(out, input);
});

test("non-list text ends the current list and is passed through", () => {
  const input = ["* item", "      * deep", "", "Paragraph text.", "* new item"].join("\n");
  const out = clampListNesting(input);
  assert.equal(out, ["* item", "  * deep", "", "Paragraph text.", "* new item"].join("\n"));
});
