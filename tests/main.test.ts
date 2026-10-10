import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { App, PluginManifest } from "obsidian";
import { DOMParser } from "@xmldom/xmldom";
import GraphvizPlusPlugin from "../src/main";
import { GraphvizWorkerRenderer } from "../src/rendering/renderer";
import { MAX_DOT_CHARACTERS } from "../src/core/limits";
import { Plugin, TFile, MarkdownRenderChild } from "./helpers/obsidian";

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

class BlockElement {
  messages: string[] = [];
  svg: Element | null = null;
  empty() {
    this.messages = [];
    this.svg = null;
  }
  createDiv(options: { text?: string }) {
    if (options.text) this.messages.push(options.text);
    return {
      appendChild: (svg: Element) => {
        this.svg = svg;
      },
    };
  }
  createEl(_tag: string, options: { text: string }) {
    this.messages.push(options.text);
  }
}

async function setup(
  t: TestContext,
  read: () => Promise<string> = async () => "",
) {
  const file = new TFile("preamble.md");
  const app = {
    vault: { getAbstractFileByPath: () => file, cachedRead: read },
    metadataCache: { getFirstLinkpathDest: () => file },
  };
  const plugin = new GraphvizPlusPlugin(
    app as unknown as App,
    {} as PluginManifest,
  );
  const host = plugin as unknown as Plugin;
  await plugin.onload();
  const originalParser = Object.getOwnPropertyDescriptor(
    globalThis,
    "DOMParser",
  );
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.assign(globalThis, {
    DOMParser,
    document: new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      "image/svg+xml",
    ),
  });
  t.after(() => {
    plugin.onunload();
    for (const [name, previous] of [
      ["DOMParser", originalParser],
      ["document", originalDocument],
    ] as const) {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  function add(source = "digraph { a -> b }") {
    const el = new BlockElement();
    let child!: MarkdownRenderChild;
    host.processor(source, el as unknown as HTMLElement, {
      addChild(block: MarkdownRenderChild) {
        child = block;
        child.onload();
      },
    });
    return {
      el,
      get child() {
        return child;
      },
    };
  }
  return { plugin, host, add };
}

test("unload during preamble reading prevents later worker work and DOM updates", async (t) => {
  let finishRead!: (value: string) => void;
  const { plugin, add } = await setup(
    t,
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  plugin.settings.preamblePath = "preamble";
  const render = t.mock.method(
    GraphvizWorkerRenderer.prototype,
    "render",
    async () => "unused",
  );
  const { el } = add();
  assert.ok(finishRead);
  plugin.onunload();
  finishRead("rankdir=LR;");
  await nextTurn();
  assert.equal(render.mock.callCount(), 0);
  assert.deepEqual(el.messages, ["Rendering graph…"]);
});

test("removing a block aborts its render and ignores late results", async (t) => {
  const { add } = await setup(t);
  let signal: AbortSignal | undefined;
  let finish!: (value: string) => void;
  t.mock.method(
    GraphvizWorkerRenderer.prototype,
    "render",
    (_dot: string, _engine: string, inputSignal?: AbortSignal) => {
      signal = inputSignal;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
  );
  const block = add();
  await nextTurn();
  block.child.onunload();
  assert.equal(signal?.aborted, true);
  finish('<svg xmlns="http://www.w3.org/2000/svg"/>');
  await nextTurn();
  assert.equal(block.el.svg, null);
});

test("refresh command rereads preamble and settings for displayed blocks", async (t) => {
  let note = "rankdir=LR;";
  const { plugin, host, add } = await setup(t, async () => note);
  plugin.settings.preamblePath = "preamble";
  const calls: Array<{ dot: string; engine: string }> = [];
  t.mock.method(
    GraphvizWorkerRenderer.prototype,
    "render",
    async (dot: string, engine: string) => {
      calls.push({ dot, engine });
      return '<svg xmlns="http://www.w3.org/2000/svg"/>';
    },
  );
  const block = add();
  await nextTurn();
  assert.match(calls[0].dot, /rankdir=LR/);
  assert.ok(block.el.svg);
  note = "rankdir=TB;";
  plugin.settings.defaultEngine = "neato";
  host.commands
    .find((command) => command.id === "refresh-diagrams")!
    .callback();
  await nextTurn();
  assert.match(calls[1].dot, /rankdir=TB/);
  assert.equal(calls[1].engine, "neato");
  block.child.onunload();
  host.commands[0].callback();
  await nextTurn();
  assert.equal(calls.length, 2);
});

test("oversized source is rejected before reading the preamble", async (t) => {
  let reads = 0;
  const { plugin, add } = await setup(t, async () => {
    reads++;
    return "";
  });
  plugin.settings.preamblePath = "preamble";
  const render = t.mock.method(
    GraphvizWorkerRenderer.prototype,
    "render",
    async () => "unused",
  );
  const { el } = add("x".repeat(MAX_DOT_CHARACTERS + 1));
  await nextTurn();
  assert.match(el.messages[0], /too large/);
  assert.equal(reads, 0);
  assert.equal(render.mock.callCount(), 0);
});

test("oversized preamble and combined DOT are rejected before rendering", async (t) => {
  let note = "x".repeat(MAX_DOT_CHARACTERS + 1);
  const { plugin, add } = await setup(t, async () => note);
  plugin.settings.preamblePath = "preamble";
  const render = t.mock.method(
    GraphvizWorkerRenderer.prototype,
    "render",
    async () => "unused",
  );
  const first = add();
  await nextTurn();
  assert.match(first.el.messages[0], /too large/);
  note = "x".repeat(MAX_DOT_CHARACTERS);
  const second = add();
  await nextTurn();
  assert.match(second.el.messages[0], /too large/);
  assert.equal(render.mock.callCount(), 0);
});
