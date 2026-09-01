import workerSource from "graphviz-worker-source";
import type { Engine } from "../core/dot";

/** Bound memory use before sending user-controlled input to the worker. */
export const MAX_DOT_CHARACTERS = 250_000;
/** Stop pathological layouts without blocking Obsidian's main thread. */
export const LAYOUT_TIMEOUT_MS = 15_000;

interface PendingRender {
  dot: string;
  engine: Engine;
  resolve(svg: string): void;
  reject(error: Error): void;
  timeout: number | null;
}

/**
 * Keep expensive WASM layout off Obsidian's UI thread. A timed-out layout
 * terminates the worker, which is the only reliable way to cancel synchronous
 * WebAssembly; the next diagram gets a clean worker and a fresh WASM load.
 */
export class GraphvizWorkerRenderer {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRender>();
  private workerBusy = false;

  render(dot: string, engine: Engine): Promise<string> {
    if (dot.length > MAX_DOT_CHARACTERS) {
      return Promise.reject(
        new Error(
          `Diagram is too large (${dot.length.toLocaleString()} characters; ` +
            `limit ${MAX_DOT_CHARACTERS.toLocaleString()}).`,
        ),
      );
    }

    this.getWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        dot,
        engine,
        resolve,
        reject,
        timeout: null,
      });
      this.dispatchNext();
    });
  }

  dispose() {
    this.failAll(new Error("Graphviz renderer stopped."));
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.workerUrl = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    let worker: Worker;
    try {
      worker = new Worker(this.workerUrl, { name: "graphviz-plus" });
    } catch (error) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
      throw error;
    }
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (pending.timeout !== null) window.clearTimeout(pending.timeout);
      this.pending.delete(data.id);
      this.workerBusy = false;
      if (typeof data.svg === "string") pending.resolve(data.svg);
      else pending.reject(new Error(data.error || "Graphviz worker failed."));
      this.dispatchNext();
    };
    worker.onerror = () => {
      this.failAll(new Error("Graphviz worker failed."));
    };
    this.worker = worker;
    return worker;
  }

  private dispatchNext() {
    if (this.workerBusy || !this.worker) return;
    const next = this.pending.entries().next();
    if (next.done) return;
    const [id, pending] = next.value;
    this.workerBusy = true;
    pending.timeout = window.setTimeout(() => {
      this.failAll(
        new Error(
          `Layout exceeded ${LAYOUT_TIMEOUT_MS / 1000} seconds and was stopped.`,
        ),
      );
    }, LAYOUT_TIMEOUT_MS);
    this.worker.postMessage({ id, dot: pending.dot, engine: pending.engine });
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      if (pending.timeout !== null) window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.workerBusy = false;
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
  }
}
