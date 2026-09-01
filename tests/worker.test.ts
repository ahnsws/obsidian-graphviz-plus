import assert from "node:assert/strict";
import test from "node:test";

interface WorkerResponse {
  id: number;
  svg?: string;
  error?: string;
}

let receive: ((event: { data: { id: number; dot: string; engine: "dot" } }) => void) | null = null;
let resolveResponse: ((response: WorkerResponse) => void) | null = null;

Object.assign(globalThis, {
  self: {
    set onmessage(handler: typeof receive) {
      receive = handler;
    },
    postMessage(response: WorkerResponse) {
      resolveResponse?.(response);
    },
  },
});

function render(id: number, dot: string): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    resolveResponse = resolve;
    receive?.({ data: { id, dot, engine: "dot" } });
  });
}

test("worker renders valid DOT and serializes Graphviz failures", async () => {
  await import("../src/rendering/graphviz.worker.js");
  const rendered = await render(1, "digraph { a -> b }");
  assert.equal(rendered.id, 1);
  assert.match(rendered.svg || "", /<svg[\s>]/);

  const failed = await render(2, "digraph { a -> }");
  assert.equal(failed.id, 2);
  assert.match(failed.error || "", /syntax error/i);
});
