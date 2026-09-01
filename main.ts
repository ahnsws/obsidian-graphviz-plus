import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";
import { Graphviz, type Engine } from "@hpcc-js/wasm-graphviz";

/**
 * The layout engines the plugin supports. Graphviz also accepts `nop` and
 * `nop2`, but those require positions to be known, so we leave them out.
 */
const ENGINES: Engine[] = [
  "dot",
  "neato",
  "fdp",
  "sfdp",
  "circo",
  "twopi",
  "osage",
  "patchwork",
];

function isEngine(name: string): name is Engine {
  return (ENGINES as string[]).includes(name);
}

interface GraphvizPlusSettings {
  /** Vault path or note name of the preamble note; empty = no preamble */
  preamblePath: string;
  /** The engine used by a block that sets no `layout=` attribute */
  defaultEngine: Engine;
}

const DEFAULT_SETTINGS: GraphvizPlusSettings = {
  preamblePath: "",
  defaultEngine: "dot",
};

// Load the Graphviz WASM module once for the whole app. The first call compiles
// it; later calls reuse the compiled module.
let graphvizPromise: Promise<Graphviz> | null = null;

function loadGraphviz(): Promise<Graphviz> {
  if (!graphvizPromise) {
    // Do not keep a rejected promise: one failed load must not disable the
    // plugin until Obsidian restarts. Clear it so the next call tries again.
    graphvizPromise = Graphviz.load().catch((e) => {
      graphvizPromise = null;
      throw e;
    });
  }
  return graphvizPromise;
}

export default class GraphvizPlusPlugin extends Plugin {
  settings: GraphvizPlusSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();
    // Start compiling in the background. If it fails, each block reports the
    // error when it renders, so the rejection needs no handler here.
    loadGraphviz().catch(() => {});
    this.registerMarkdownCodeBlockProcessor("dot", (source, el) =>
      this.render(source, el),
    );
    this.addSettingTab(new GraphvizPlusSettingTab(this.app, this));
  }

  /** The engine to use when a block names none. Falls back to `dot` if the
   *  stored setting is not one of ENGINES. */
  get fallbackEngine(): Engine {
    return isEngine(this.settings.defaultEngine)
      ? this.settings.defaultEngine
      : "dot";
  }

  private async render(source: string, el: HTMLElement) {
    el.empty();
    el.createDiv({ cls: "graphviz-plus-loading", text: "Rendering graph…" });
    try {
      const graphviz = await loadGraphviz();
      const { bodyBrace, layout } = scanDot(source);
      const dot = await this.withPreamble(source, bodyBrace);
      const svg = parseSvg(
        graphviz.layout(dot, "svg", layout ?? this.fallbackEngine),
      );
      // Replace the loading line only once the whole diagram is ready, so a
      // failure leaves the block in one state, not half-written.
      el.empty();
      // Put the SVG element itself in the page rather than an <img>, so a CSS
      // snippet can select g.node, g.complex and the rest.
      el.createDiv({ cls: "graphviz-plus" }).appendChild(svg);
    } catch (err) {
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
    const preamble = extractPreamble(await this.app.vault.cachedRead(file));
    if (!preamble) return source;
    const head = source.slice(0, bodyBrace + 1);
    const tail = source.slice(bodyBrace + 1);
    return `${head}\n${preamble}\n${tail}`;
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/**
 * Turn Graphviz output into an element the page can hold.
 *
 * The output is a complete XML document (made of declaration, DOCTYPE, and
 * `<svg>`) so it is parsed as XML and only the `<svg>` root is kept. Parsing
 * is used instead of assigning to innerHTML: the result stays in the SVG
 * namespace, which the CSS selectors need, and no markup from the note is run
 * as HTML.
 */
function parseSvg(svg: string): Element {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("Graphviz returned output that is not valid SVG.");
  }
  return document.importNode(root, true);
}

/**
 * Read the DOT out of a preamble note. The note holds either raw DOT, or a
 * fenced block marked `dot` or `graphviz` (or marked with nothing). The first
 * such block is used; a note with no fence is used whole.
 */
function extractPreamble(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s`~]*)/.exec(lines[i]);
    if (!open) continue;
    const [, marker, info] = open;
    // A closing fence uses the same character, and is at least as long.
    const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (/^(dot|graphviz)?$/i.test(info)) {
      return lines
        .slice(i + 1, end)
        .join("\n")
        .trim();
    }
    // A block in another language: step past its closing fence, so that fence
    // is not read as the start of a new block.
    i = end;
  }
  return text.trim();
}

interface DotScan {
  /** Offset of the `{` that opens the graph body, or -1 if the source has none. */
  bodyBrace: number;
  /** The engine named by the first `layout=` attribute, or null if none names one. */
  layout: Engine | null;
}

/** Matches `layout=<engine>`, with or without quotes, at the scan position. */
const LAYOUT_ATTR =
  /layout[ \t\r\n]*=[ \t\r\n]*"?[ \t]*([A-Za-z][A-Za-z0-9_]*)/iy;

/** Characters that continue a DOT identifier. */
const NAME_CHAR = /[\w.]/;

/**
 * Read, in one pass, the two facts the plugin needs from DOT source: where the
 * graph body opens, and which layout engine the block asks for.
 *
 * The pass steps over quoted strings, HTML strings (`<...>`) and comments, so a
 * `{` or the text `layout=` inside a label or a comment is not read as code.
 * Doing both in one pass also keeps the two results consistent with each other.
 */
function scanDot(src: string): DotScan {
  let bodyBrace = -1;
  let layout: Engine | null = null;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (c === '"') {
      // Quoted string. A backslash escapes the next character.
      while (++i < src.length && src[i] !== '"') if (src[i] === "\\") i++;
    } else if (c === "<") {
      // HTML string. Angle brackets nest, so count them.
      let depth = 1;
      while (++i < src.length && depth > 0) {
        if (src[i] === "<") depth++;
        else if (src[i] === ">") depth--;
      }
      i--;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
    } else if (c === "/" && src[i + 1] === "/") {
      i = endOfLine(src, i);
    } else if (c === "#" && (i === 0 || src[i - 1] === "\n")) {
      // Graphviz discards a line that starts with `#` as a C preprocessor line.
      i = endOfLine(src, i);
    } else if (c === "{") {
      if (bodyBrace < 0) bodyBrace = i;
    } else if (
      layout === null &&
      (c === "l" || c === "L") &&
      !NAME_CHAR.test(i > 0 ? src[i - 1] : "")
    ) {
      LAYOUT_ATTR.lastIndex = i;
      const m = LAYOUT_ATTR.exec(src);
      if (m) {
        const name = m[1].toLowerCase();
        if (isEngine(name)) layout = name;
        i = LAYOUT_ATTR.lastIndex - 1;
      }
    }
  }
  return { bodyBrace, layout };
}

/** The index just before the next line break, so the caller's loop step lands
 *  on the break itself and the next line is scanned from its first character. */
function endOfLine(src: string, from: number): number {
  const nl = src.indexOf("\n", from);
  return nl < 0 ? src.length : nl - 1;
}

class GraphvizPlusSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GraphvizPlusPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const setting = new Setting(containerEl)
      .setName("Preamble note")
      .setDesc(
        "The plugin inserts the text of this note at the top of every dot block, " +
          "so rankdir, node[…] and edge[…] defaults are written once instead of " +
          "in every block. The note holds raw DOT, or a fenced dot block. Leave " +
          "it empty to insert nothing.",
      );
    const status = containerEl.createDiv({
      cls: "graphviz-plus-setting-status",
    });

    const showStatus = (path: string) => {
      const p = path.trim();
      const file = p && this.plugin.resolvePreambleFile(p);
      if (!p) status.setText("No preamble note set.");
      else if (file) status.setText(`Reads ${file.path}`);
      else
        status.setText(
          `No note found at "${p}". Blocks render without a preamble.`,
        );
    };

    setting.addText((t) =>
      t
        .setPlaceholder("graphviz-preamble")
        .setValue(this.plugin.settings.preamblePath)
        .onChange(async (v) => {
          this.plugin.settings.preamblePath = v;
          await this.plugin.saveSettings();
          showStatus(v);
        }),
    );
    showStatus(this.plugin.settings.preamblePath);

    new Setting(containerEl)
      .setName("Default layout engine")
      .setDesc("Used by a block that sets no layout= attribute.")
      .addDropdown((d) => {
        ENGINES.forEach((e) => d.addOption(e, e));
        d.setValue(this.plugin.fallbackEngine).onChange(async (v) => {
          if (!isEngine(v)) return;
          this.plugin.settings.defaultEngine = v;
          await this.plugin.saveSettings();
        });
      });
  }
}
