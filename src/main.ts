import { Plugin, MarkdownRenderChild, TFile, normalizePath } from "obsidian";
import { isEngine, scanDot, type Engine } from "./core/dot";
import { extractPreamble } from "./core/preamble";
import { assertDotSize } from "./core/limits";
import { GraphvizWorkerRenderer } from "./rendering/renderer";
import { parseAndSanitizeSvg } from "./rendering/svg";
import {
  DEFAULT_SETTINGS,
  GraphvizPlusSettingTab,
  type GraphvizPlusSettings,
} from "./settings";

export default class GraphvizPlusPlugin extends Plugin {
  settings: GraphvizPlusSettings = { ...DEFAULT_SETTINGS };
  private renderer = new GraphvizWorkerRenderer();
  private blocks = new Set<GraphvizBlock>();
  private stopped = false;

  async onload() {
    await this.loadSettings();
    this.registerMarkdownCodeBlockProcessor("dot", (source, el, ctx) => {
      if (this.stopped) return;
      const block = new GraphvizBlock(
        el,
        (signal) => this.render(source, el, signal),
        () => this.blocks.delete(block),
      );
      this.blocks.add(block);
      ctx.addChild(block);
    });
    this.addCommand({
      id: "refresh-diagrams",
      name: "Refresh diagrams",
      callback: () => {
        for (const block of this.blocks) block.refresh();
      },
    });
    this.addSettingTab(new GraphvizPlusSettingTab(this.app, this));
  }

  onunload() {
    this.stopped = true;
    this.renderer.dispose();
    for (const block of this.blocks) block.onunload();
    this.blocks.clear();
  }

  /** The engine to use when a block names none. Falls back to `dot` if the
   *  stored setting is not one of ENGINES. */
  get fallbackEngine(): Engine {
    return isEngine(this.settings.defaultEngine)
      ? this.settings.defaultEngine
      : "dot";
  }

  private async render(source: string, el: HTMLElement, signal: AbortSignal) {
    if (signal.aborted || this.stopped) return;
    el.empty();
    el.createDiv({ cls: "graphviz-plus-loading", text: "Rendering graph…" });
    try {
      assertDotSize(source);
      const { bodyBrace } = scanDot(source);
      const dot = await this.withPreamble(source, bodyBrace);
      if (signal.aborted || this.stopped) return;
      // Scan after preamble insertion so a block can override a preamble's
      // layout assignment in the same way it overrides other graph attributes.
      const { layout, unsupportedLayout } = scanDot(dot);
      if (unsupportedLayout !== null) {
        throw new Error(`Unsupported layout engine "${unsupportedLayout}".`);
      }
      const output = await this.renderer.render(
        dot,
        layout ?? this.fallbackEngine,
        signal,
      );
      if (signal.aborted || this.stopped) return;
      const svg = parseAndSanitizeSvg(output);
      // Replace the loading line only once the whole diagram is ready, so a
      // failure leaves the block in one state, not half-written.
      el.empty();
      // Put the SVG element itself in the page rather than an <img>, so a CSS
      // snippet can select g.node, g.complex and the rest.
      el.createDiv({ cls: "graphviz-plus" }).appendChild(svg);
    } catch (err) {
      if (signal.aborted || this.stopped) return;
      el.empty();
      el.createEl("pre", {
        cls: "graphviz-plus-error",
        text:
          "Graphviz error:\n" +
          (err instanceof Error ? err.message : String(err)),
      });
    }
  }

  /**
   * Insert the preamble note's text directly after the `{` that opens the graph
   * body, where graph, node and edge attributes are legal.
   *
   * The source is returned unchanged:
   * - when the block has no body,
   * - when no preamble note is set, or
   * - when the configured path names no note.
   * A path that names no note must not stop diagrams from rendering; the
   * settings tab reports it instead. A note that exists but cannot be read is
   * a different case: that error reaches the block, because something is
   * actually wrong.
   */
  private async withPreamble(
    source: string,
    bodyBrace: number,
  ): Promise<string> {
    if (bodyBrace < 0) return source;
    const file = this.resolvePreambleFile(this.settings.preamblePath);
    if (!file) return source;
    const note = await this.app.vault.cachedRead(file);
    assertDotSize(note);
    const preamble = extractPreamble(note);
    if (!preamble) return source;
    const head = source.slice(0, bodyBrace + 1);
    const tail = source.slice(bodyBrace + 1);
    const combined = `${head}\n${preamble}\n${tail}`;
    assertDotSize(combined);
    return combined;
  }

  /** Find the preamble note. Accepts a vault path with or without the `.md`
   *  suffix, or a bare note name as written in a wiki link. */
  resolvePreambleFile(path: string): TFile | null {
    const p = (path || "").trim();
    if (!p) return null;
    for (const candidate of [p, p.endsWith(".md") ? p : p + ".md"]) {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(candidate));
      if (f instanceof TFile) return f;
    }
    const byLink = this.app.metadataCache.getFirstLinkpathDest(p, "");
    return byLink instanceof TFile ? byLink : null;
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = {
      preamblePath:
        typeof saved?.preamblePath === "string" ? saved.preamblePath : "",
      defaultEngine: isEngine(saved?.defaultEngine)
        ? saved.defaultEngine
        : "dot",
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/** Obsidian unloads this child when the corresponding code block is removed. */
class GraphvizBlock extends MarkdownRenderChild {
  private controller: AbortController | null = null;
  private stopped = false;

  constructor(
    el: HTMLElement,
    private renderBlock: (signal: AbortSignal) => Promise<void>,
    private remove: () => void,
  ) {
    super(el);
  }

  onload(): void {
    this.refresh();
  }

  refresh(): void {
    if (this.stopped) return;
    this.controller?.abort();
    this.controller = new AbortController();
    void this.renderBlock(this.controller.signal);
  }

  onunload(): void {
    this.stopped = true;
    this.controller?.abort();
    this.remove();
  }
}
