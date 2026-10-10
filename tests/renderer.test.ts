import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  GraphvizWorkerRenderer,
  LAYOUT_TIMEOUT_MS,
} from "../src/rendering/renderer";
import {
  MAX_DOT_CHARACTERS,
  MAX_SVG_CHARACTERS,
  MAX_PENDING_RENDERS,
} from "../src/core/limits";

function setup(t: TestContext) {
  const timers = new Map<number, () => void>();
  const workers: FakeWorker[] = [];
  const revoked: string[] = [];
  let nextTimer = 0;
  let constructorFails = false;
  let postFails = false;
  class FakeWorker {
    messages: Array<{ id: number; dot: string }> = [];
    terminated = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor() {
      if (constructorFails) throw new Error("Worker unavailable");
      workers.push(this);
    }
    postMessage(message: { id: number; dot: string }) {
      if (postFails) throw new Error("postMessage failed");
      this.messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    reply(svg: string, id = this.messages[this.messages.length - 1].id) {
      this.onmessage?.({ data: { id, svg } });
    }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.assign(globalThis, {
    Worker: FakeWorker,
    window: {
      setTimeout(callback: () => void, delay: number) {
        assert.equal(delay, LAYOUT_TIMEOUT_MS);
        timers.set(++nextTimer, callback);
        return nextTimer;
      },
      clearTimeout(id: number) {
        timers.delete(id);
      },
    },
  });
  t.mock.method(URL, "createObjectURL", () => `blob:worker-${workers.length}`);
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  const renderer = new GraphvizWorkerRenderer();
  t.after(() => {
    renderer.dispose();
    for (const [name, previous] of [
      ["window", previousWindow],
      ["Worker", previousWorker],
    ] as const) {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return {
    renderer,
    workers,
    timers,
    revoked,
    failConstructor: () => {
      constructorFails = true;
    },
    failPost: () => {
      postFails = true;
    },
  };
}

test("a timed-out layout restarts the worker and preserves queued diagrams", async (t) => {
  const { renderer, workers, timers, revoked } = setup(t);
  const slow = assert.rejects(renderer.render("slow", "dot"), /exceeded/);
  const good = renderer.render("good", "dot");
  assert.equal(workers[0].messages.length, 1);
  [...timers.values()][0]();
  await slow;
  assert.equal(workers[0].terminated, true);
  assert.equal(revoked.length, 1);
  assert.equal(workers[1].messages[0].dot, "good");
  // A late response/error from the terminated worker must not finish the new job.
  workers[0].reply("stale", workers[1].messages[0].id);
  workers[0].onerror?.();
  workers[1].reply("good svg");
  assert.equal(await good, "good svg");
  assert.equal(timers.size, 0);
});

test("ordinary layout errors do not fail the next diagram", async (t) => {
  const { renderer, workers } = setup(t);
  const bad = assert.rejects(renderer.render("bad", "dot"), /syntax error/);
  const good = renderer.render("good", "dot");
  workers[0].onmessage?.({
    data: { id: workers[0].messages[0].id, error: "syntax error" },
  });
  await bad;
  workers[0].reply("svg");
  assert.equal(await good, "svg");
  assert.equal(workers.length, 1);
});

test("cancelling queued and active blocks preserves unrelated work", async (t) => {
  const { renderer, workers } = setup(t);
  const active = new AbortController();
  const queued = new AbortController();
  const first = assert.rejects(
    renderer.render("active", "dot", active.signal),
    /cancelled/,
  );
  const second = assert.rejects(
    renderer.render("queued", "dot", queued.signal),
    /cancelled/,
  );
  const good = renderer.render("good", "dot");
  queued.abort();
  assert.equal(workers.length, 1);
  active.abort();
  await Promise.all([first, second]);
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].messages[0].dot, "good");
  workers[1].reply("svg");
  assert.equal(await good, "svg");
});

test("disposal rejects outstanding work and permanently prevents new workers", async (t) => {
  const { renderer, workers, timers, revoked } = setup(t);
  const jobs = [
    renderer.render("first", "dot"),
    renderer.render("second", "dot"),
  ];
  const results = Promise.all(
    jobs.map((job) => assert.rejects(job, /stopped/)),
  );
  renderer.dispose();
  await results;
  renderer.dispose();
  await assert.rejects(renderer.render("late", "dot"), /stopped/);
  assert.equal(workers.length, 1);
  assert.equal(timers.size, 0);
  assert.equal(revoked.length, 1);
});

test("oversized and already-cancelled input never starts a worker", async (t) => {
  const { renderer, workers } = setup(t);
  await assert.rejects(
    renderer.render("x".repeat(MAX_DOT_CHARACTERS + 1), "dot"),
    /too large/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    renderer.render("small", "dot", controller.signal),
    /cancelled/,
  );
  assert.equal(workers.length, 0);
});

test("pending input is bounded by both job count and total characters", async (t) => {
  const { renderer, workers } = setup(t);
  let jobs = Array.from({ length: MAX_PENDING_RENDERS }, () =>
    renderer.render("x", "dot"),
  );
  let settled = Promise.allSettled(jobs);
  await assert.rejects(renderer.render("overflow", "dot"), /queue is full/);
  workers[0].reply("done");
  const replacement = renderer.render("replacement", "dot");
  renderer.dispose();
  await Promise.all([settled, assert.rejects(replacement, /stopped/)]);

  const second = new GraphvizWorkerRenderer();
  t.after(() => second.dispose());
  jobs = Array.from({ length: 4 }, () =>
    second.render("x".repeat(MAX_DOT_CHARACTERS), "dot"),
  );
  settled = Promise.allSettled(jobs);
  await assert.rejects(second.render("x", "dot"), /queue is full/);
  second.dispose();
  await settled;
});

test("oversized worker output fails only its diagram", async (t) => {
  const { renderer, workers } = setup(t);
  const large = assert.rejects(
    renderer.render("large output", "dot"),
    /SVG is too large/,
  );
  const good = renderer.render("small output", "dot");
  workers[0].reply("x".repeat(MAX_SVG_CHARACTERS + 1));
  await large;
  workers[0].reply("svg");
  assert.equal(await good, "svg");
});

for (const failure of ["constructor", "postMessage", "transport"]) {
  test(`${failure} failure releases resources without restart loops`, async (t) => {
    const harness = setup(t);
    if (failure === "constructor") harness.failConstructor();
    if (failure === "postMessage") harness.failPost();
    const failed = assert.rejects(
      harness.renderer.render("input", "dot"),
      /unavailable|failed/,
    );
    if (failure === "transport") harness.workers[0].onmessageerror?.();
    await failed;
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.revoked.length, 1);
    assert.ok(harness.workers.length <= 1);
  });
}
