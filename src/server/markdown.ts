// Reddit's rich-text format (RTJSON) rejects list items nested more than two
// tiers deep: reddit.submitPost throws
//   "INVALID_RTJSON: List items cannot exceed 2 levels of nesting".
// Podcast show notes (e.g. Accidental Tech Podcast) routinely nest bullet lists
// 3–4 tiers deep in their content:encoded HTML, which node-html-markdown faithfully
// reproduces as deeply-indented Markdown. That Markdown is fine for the interactive
// (custom) post — it renders client-side with react-markdown — but breaks self and
// link posts, whose Markdown body Reddit converts to RTJSON on submit.

// Number of list tiers Reddit's RTJSON accepts. Kept conservative (a top-level
// list plus one nested tier) so submission never fails; deeper items are pulled
// up to the deepest allowed tier rather than dropped.
const MAX_LIST_TIERS = 2;
const INDENT = "  "; // Markdown indent per nesting tier.

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])(\s.*)$/;
const FENCE_RE = /^\s*(```+|~~~+)/;

/**
 * Flatten Markdown list nesting deeper than {@link MAX_LIST_TIERS} tiers so the
 * result submits cleanly as a Reddit self/link post.
 *
 * Nesting depth is derived from *relative* indentation via a stack, so it is
 * robust to whatever indent step the source used. Only list-marker lines are
 * re-indented; fenced code blocks and ordinary paragraphs pass through untouched
 * (a non-blank, non-list line ends the current list, matching Markdown semantics).
 */
export function clampListNesting(markdown: string, maxTiers: number = MAX_LIST_TIERS): string {
  const cap = Math.max(0, maxTiers - 1); // deepest allowed 0-based tier
  const stack: number[] = [];             // raw indent widths along the nesting path
  let inFence = false;
  let fenceChar = "";
  const out: string[] = [];

  for (const line of markdown.split("\n")) {
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = (fence[1] ?? "").charAt(0);
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
      }
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const m = line.match(LIST_ITEM_RE);
    if (!m) {
      // Blank lines keep a list going; any other text terminates it.
      if (line.trim() !== "") stack.length = 0;
      out.push(line);
      continue;
    }

    const indent = (m[1] ?? "").replace(/\t/g, "    ").length;
    while (stack.length && (stack[stack.length - 1] ?? 0) >= indent) stack.pop();
    stack.push(indent);
    const tier = Math.min(stack.length - 1, cap);
    out.push(INDENT.repeat(tier) + (m[2] ?? "") + (m[3] ?? ""));
  }

  return out.join("\n");
}
