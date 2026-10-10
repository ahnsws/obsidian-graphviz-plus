import workerSource from "graphviz-worker-source";
import type { Engine } from "../core/dot";
import {
  assertDotSize,
  assertSvgSize,
  MAX_PENDING_RENDERS,
  MAX_QUEUED_CHARACTERS,
} from "../core/limits";

export const LAYOUT_TIMEOUT_MS = 15_000;

interface PendingRender {
  dot: string;
  engine: Engine;
  resolve(svg: string): void;
  reject(error: Error): void;
  cleanup(): void;
}

/** Serial WASM layouts with bounded input and per-block cancellation. */
export class GraphvizWorkerRenderer {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRender>();
  private activeId: number | null = null;
  private timeout: number | null = null;
  private queuedCharacters = 0;
  private disposed = false;

  async render(
    dot: string,
    engine: Engine,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.disposed) throw new Error("Graphviz renderer stopped.");
    if (signal?.aborted) throw new Error("Graphviz render cancelled.");
    assertDotSize(dot);
    if (
      this.pending.size >= MAX_PENDING_RENDERS ||
      this.queuedCharacters + dot.length > MAX_QUEUED_CHARACTERS
    ) {
      throw new Error(
        "Graphviz render queue is full. Refresh diagrams after pending layouts finish.",
      );
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        if (this.activeId === id) this.stopWorker();
        this.finish(id, new Error("Graphviz render cancelled."));
      };
      this.pending.set(id, {
        dot,
        engine,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", cancel),
      });
      this.queuedCharacters += dot.length;
      signal?.addEventListener("abort", cancel, { once: true });
      this.dispatchNext();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.failAll(new Error("Graphviz renderer stopped."));
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.workerUrl = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    const worker = new Worker(this.workerUrl, { name: "graphviz-plus" });
    worker.onmessage = ({ data }) => {
      // Ignore late callbacks from a terminated worker and unrelated replies.
      if (this.worker !== worker || data?.id !== this.activeId) return;
      try {
        if (typeof data.svg !== "string")
          throw new Error(data.error || "Graphviz worker failed.");
        assertSvgSize(data.svg);
        this.finish(data.id, undefined, data.svg);
      } catch (error) {
        this.finish(
          data.id,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };
    // Startup/transport failures may affect every job. Do not endlessly restart.
    worker.onerror = worker.onmessageerror = () => {
      if (this.worker === worker)
        this.failAll(
          new Error("Graphviz worker failed to start or communicate."),
        );
    };
    this.worker = worker;
    return worker;
  }

  private dispatchNext(): void {
    if (this.disposed || this.activeId !== null) return;
    const next = this.pending.entries().next();
    if (next.done) return;
    const [id, pending] = next.value;
    try {
      const worker = this.getWorker();
      this.activeId = id;
      this.timeout = window.setTimeout(() => {
        this.stopWorker();
        this.finish(
          id,
          new Error(
            `Layout exceeded ${LAYOUT_TIMEOUT_MS / 1000} seconds and was stopped.`,
          ),
        );
      }, LAYOUT_TIMEOUT_MS);
      worker.postMessage({ id, dot: pending.dot, engine: pending.engine });
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private finish(id: number, error?: Error, svg = ""): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (this.activeId === id) {
      if (this.timeout !== null) window.clearTimeout(this.timeout);
      this.timeout = null;
      this.activeId = null;
    }
    this.pending.delete(id);
    this.queuedCharacters -= pending.dot.length;
    pending.cleanup();
    if (error) pending.reject(error);
    else pending.resolve(svg);
    this.dispatchNext();
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
  }

  private failAll(error: Error): void {
    if (this.timeout !== null) window.clearTimeout(this.timeout);
    this.timeout = null;
    this.activeId = null;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    this.queuedCharacters = 0;
    this.stopWorker();
  }
}
