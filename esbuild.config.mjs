import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/* Graphviz Plus (Obsidian plugin). This file is generated from main.ts.
   Edit main.ts and rebuild; edits here are overwritten. */`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["main.ts"],
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
  // @hpcc-js/wasm-graphviz inlines its WASM as base64, so no loader/external file is needed.
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
