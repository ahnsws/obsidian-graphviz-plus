# Graphviz Plus

An Obsidian plugin that renders graphviz diagrams written in DOT, the graphviz
graph description language.

Note: written with the assistance of Claude Code; note that this has not been
robustly tested, and is only meant as a plugin for my personal use. However,
please feel free to open a feature request or submit a pull request if it is
lacking.

## Details

The plugin runs graphviz as WebAssembly in a Web Worker. There's no need to
install graphviz on your machine, and the plugin (should) work on both desktop
and mobile. Keeping layout in a worker means a complex graph cannot freeze the
Obsidian interface.

Two features beyond rendering:

- **a shared preamble**: there is a setting in which you can set your default
  styles; the plugin prepends it before every diagram
- **CSS control**: the plugin puts the SVG in the page rather than inside an
  `<img>` element, so a CSS snippet can select nodes and edges and set colors
  for all diagrams at once

## Installation

**BRAT** is a community obsidian plugin that installs a plugin from a github
release and keeps it up to date. It can be used to get the same version on every
machine.

1. install the community plugin **Obsidian42 - BRAT**
2. in BRAT, select **Add beta plugin**
3. enter this repository's github URL, then click **Add**
4. open **Settings > Community plugins** and turn on **Graphviz Plus**

## Example

Write a fenced code block and mark it `dot`:

````markdown
```dot
digraph { A-> B-> C }
```
````

In obsidian: the block renders in Reading view; in Live Preview, it renders once
you move the cursor out of the block.

Apart from inserting the preamble and selecting the layout engine described
below, the plugin passes the block to graphviz as you wrote it. Standard drawing
features work: node shapes, `subgraph cluster_...` containers, `arrowhead=...`,
HTML-like labels, etc. Active SVG content and embedded images are deliberately
removed from the result; safe `http`, `https`, `mailto`, `obsidian`, and local
fragment links are retained.

The plugin uses the `dot` code fence; hopefully this does not break other
plugins (but if it does, please feel free to open a PR).

## Layout engines

A layout engine is the algorithm that decides where nodes and edges go.
Graphviz ships several, and they suit different graph shapes:

| engine      | layout                                | use for                             |
| ----------- | ------------------------------------- | ----------------------------------- |
| `dot`       | hierarchical, nodes assigned to ranks | cascades and other DAGs             |
| `neato`     | spring model, by stress majorization  | small interaction networks          |
| `fdp`       | spring model, by force reduction      | medium interaction networks         |
| `sfdp`      | `fdp` with a multilevel solver        | large interaction networks          |
| `circo`     | circular                              | networks built from cycles          |
| `twopi`     | radial, around one root node          | trees with a single centre          |
| `osage`     | clusters packed into an array         | graphs that are mostly clusters     |
| `patchwork` | squarified treemap                    | trees where node area shows a value |

Set the engine for one block with the `layout` attribute, quoted or unquoted:

```dot
graph { layout=neato; A -- B -- C -- A }
```

The attribute must be in the outer graph scope, either as `layout=neato` or
`graph [layout=neato]`. A node, edge or subgraph attribute named `layout` does
not select the engine. If the outer graph assigns it more than once, the last
assignment wins, just like other DOT attributes. Unsupported engines produce a
clear error rather than silently falling back to a different layout.

Blocks that set no `layout` attribute use the engine from **Settings -> Graphviz
Plus -> Default layout engine**.

## Shared preamble

DOT has no include directive, so shared styles would otherwise be copied into
every block. Instead, put them in one note and name that note in the settings.

1. Create a note, for example `graphviz-preamble`.
2. Open **Settings -> Graphviz Plus**.
3. Enter the note's name or vault path in **Preamble note**.

The note holds either raw DOT or a fenced block marked `dot` or `graphviz`, or
marked with nothing. When it holds several fenced blocks, the plugin uses the
first block that carries one of those marks and ignores the rest. Example
contents:

```
rankdir=LR; bgcolor="transparent";
node [shape=box, style="rounded,filled", fontname="DejaVu Sans"];
edge [fontname="DejaVu Sans", arrowsize=0.8];
```

The plugin inserts this text directly after the `{` that opens the graph body,
where graph, node and edge attribute statements are legal. So the note holds
statements, not a whole graph: no `digraph { … }` wrapper.

If a note contains fenced blocks but none is blank or marked `dot` or
`graphviz`, the plugin inserts nothing. This prevents Markdown prose and
unrelated code samples from being sent to Graphviz as though they were DOT.

A block can still override anything the preamble sets, because the block's own
statements come after it.

Leave **Preamble note** empty to insert nothing. The settings tab reports
whether the path you entered refers to a note. If it doesn't refer to anything,
the plugin renders diagrams without a preamble.

## CSS styling

Obsidian supports stylesheets, so that a style can be applied to the entire
vault. Because the plugin puts the SVG in the page, a snippet can reach the
graph and set its colors.

1. copy `examples/graphviz.css` into `<vault>/.obsidian/snippets/`
2. turn it on under **Settings -> Appearance -> CSS snippets**

The snippet selects `.block-language-dot g.node`, `g.edge` and the entity
classes below. It overrides colors written in the DOT source, because SVG
presentation attributes such as `fill=` have lower priority than any CSS rule.

Give a node a class in DOT to pick its color:

```dot
IKK [class="complex", shape=record, label="{IKKα|IKKβ|NEMO}"]
```

The snippet defines the classes `complex`, `chemical`, `gene` and `process`. A
node with no class is drawn as a macromolecule. Its palette sits in one block of
CSS variables at the top of the file, so you change a color in one place.
The selectors cover Graphviz's default elliptical node as well as polygonal and
path-based shapes, and edge colors include their arrowheads.

Keep each color in one place: either in the DOT source, which renders the same
everywhere, or in the snippet, which applies across the vault. Setting a color
in both makes the DOT value unused.

## Settings

- **preamble note**: the note whose DOT the plugin inserts into every block;
  empty means no preamble
- **default layout engine**: the engine used by a block that sets no `layout`
  attribute; one of `dot`, `neato`, `fdp`, `sfdp`, `circo`, `twopi`, `osage` or
  `patchwork`; default is `dot`

## Errors

The plugin prints a DOT error inside the block and leaves the rest of the note
alone. For example, the erroneously structured block `digraph { A -> }` prints:

```
Graphviz error:
syntax error in line 1 near '}'
```

Graphviz reports syntactic errors only; it silently accepts any attributes or
any attribute values.

For reliability, the plugin also rejects a diagram larger than 250,000
characters and stops a layout that runs longer than 15 seconds. Layout happens
in a disposable worker, so stopping a pathological graph does not block the
editor and the next block can start with a fresh worker.

Before insertion, generated SVG passes through a strict allowlist. Event
handlers, inline styles, foreign elements, embedded images and unsafe link
protocols such as `javascript:`, `data:` and `file:` are removed. XML parsing by
itself is not treated as sanitization.

## Styles for pathway diagrams

`docs/diagram-conventions.md` describes the conventions these sample diagrams
follow: which node shape stands for which entity, which arrowhead stands for
which relation, and how to draw compartments. It follows SBGN, the Systems
Biology Graphical Notation, closely enough to stay readable to people who know
that notation. The `examples/diagrams/` folder holds worked examples, and
`examples/graphviz.css` is the optional vault-wide theme used with them.

## Development

Production TypeScript lives under `src/`, separated by responsibility:

```text
src/
├── main.ts                  # Obsidian lifecycle, settings and DOM integration
├── settings.ts              # Settings model and settings-tab UI
├── core/
│   ├── dot.ts               # DOT tokenization and engine selection
│   └── preamble.ts          # Markdown preamble extraction
├── rendering/
│   ├── renderer.ts          # Worker queue, limits and cancellation
│   ├── graphviz.worker.ts   # Graphviz WASM worker entry point
│   └── svg.ts               # SVG validation and sanitization
└── types/
    └── worker-source.d.ts   # Type for the build-time virtual module
```

Tests stay in `tests/`, build and release utilities in `scripts/`, worked files
in `examples/`, and historical planning material in `docs/archive/`. Package,
Obsidian manifest, license and build configuration files remain at the project
root, as is conventional for Node packages. The build still emits `main.js` at
the root because Obsidian expects that release asset there.

```bash
npm install
npm run dev   # esbuild rebuilds main.js on every save
npm test      # adversarial unit/integration tests
npm run check # type-check and validate release-version metadata

# Load the plugin from a test vault, to avoid conflicts with the installation
# vault:
ln -s "$PWD" "<test-vault>/.obsidian/plugins/graphviz-plus"
```

Then turn the plugin on, under **Settings -> Community plugins**. The community
plugin **Hot-Reload** (`pjeby/hot-reload`) reloads it after each rebuild, which
saves you the "Reload app without saving" command.

`npm run build` type-checks the source and writes the `main.js` that ships in a
release.

### Release

BRAT reads the assets of the latest github release, so the repository needs at
least one release that carries `main.js`, `manifest.json`, and `styles.css`. The
workflow in `.github/workflows/release.yml` builds and attaches those three
files when you push a tag.

To install without BRAT, copy those same three files into
`<vault>/.obsidian/plugins/graphviz-plus/`.

### Tests and release checks

Tests use Node's built-in test framework. TypeScript tests are bundled into a
temporary directory with the project's pinned esbuild, run under Node, and
removed afterward, so the repository stays clean and no test-only loader is
needed. The suite emphasizes behavioral boundaries: DOT scope and precedence,
comments and HTML labels, fenced-note selection, allowed URL protocols, and an
end-to-end malicious URL emitted by the real Graphviz WASM package.

CI runs `npm test` and `npm run build` for pushes and pull requests. Releases run
the same checks and additionally require the Git tag (with an optional `v`
prefix) to match `manifest.json`; `package.json`, `manifest.json`, and
`versions.json` must agree as well. Add a regression test before fixing any
future parser or sanitizer bug, and prefer testing observable behavior over
private implementation details.

## License

MIT. See `LICENSE`.
