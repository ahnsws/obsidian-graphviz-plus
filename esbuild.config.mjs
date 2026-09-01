import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/* Graphviz Plus (Obsidian plugin). This file is generated from src/main.ts.
   Edit files under src/ and rebuild; edits here are overwritten. */`;

const prod = process.argv[2] === "production";

// Bundle Graphviz and its WASM into a Web Worker, then expose that bundle to
// src/main.ts as a string. This keeps releases to Obsidian's standard three files
// while ensuring CPU-heavy layout never runs on the editor's UI thread.
const embeddedGraphvizWorker = {
  name: "embedded-graphviz-worker",
  setup(build) {
    build.onResolve({ filter: /^graphviz-worker-source$/ }, () => ({
      path: "graphviz-worker-source",
      namespace: "graphviz-worker",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "graphviz-worker" },
      async () => {
        const result = await esbuild.build({
          entryPoints: ["src/rendering/graphviz.worker.ts"],
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          target: "es2018",
          minify: prod,
          logLevel: "silent",
        });
        return {
          contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
          loader: "js",
          watchFiles: ["src/rendering/graphviz.worker.ts", "src/core/dot.ts"],
        };
      },
    );
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  plugins: [embeddedGraphvizWorker],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
