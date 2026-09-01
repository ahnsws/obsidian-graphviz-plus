import { Graphviz } from "@hpcc-js/wasm-graphviz";
import type { Engine } from "../core/dot";

interface RenderRequest {
  id: number;
  dot: string;
  engine: Engine;
}

let graphvizPromise: Promise<Graphviz> | null = null;

function loadGraphviz(): Promise<Graphviz> {
  if (!graphvizPromise) {
    graphvizPromise = Graphviz.load().catch((error) => {
      graphvizPromise = null;
      throw error;
    });
  }
  return graphvizPromise;
}

self.onmessage = async ({ data }: MessageEvent<RenderRequest>) => {
  try {
    const graphviz = await loadGraphviz();
    const svg = graphviz.layout(data.dot, "svg", data.engine);
    self.postMessage({ id: data.id, svg });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
