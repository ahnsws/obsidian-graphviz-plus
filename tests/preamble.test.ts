import assert from "node:assert/strict";
import test from "node:test";
import { extractPreamble } from "../src/core/preamble";

test("raw preamble text is trimmed when no fence exists", () => {
  assert.equal(extractPreamble("\n rankdir=LR;\n"), "rankdir=LR;");
});

test("the first eligible preamble fence is selected", () => {
  const note = `Explanation
\n\`\`\`js
notDot()
\`\`\`
\n~~~graphviz
rankdir=LR;
~~~
\n\`\`\`dot
rankdir=TB;
\`\`\``;
  assert.equal(extractPreamble(note), "rankdir=LR;");
});

test("a note with only unrelated fences produces no preamble", () => {
  assert.equal(extractPreamble("prose\n```js\nnotDot()\n```"), "");
});
