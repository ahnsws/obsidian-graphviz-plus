import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { embeddedGraphvizWorker } from "./scripts/worker-plugin.mjs";

const banner = `/* Graphviz Plus (Obsidian plugin). This file is generated from src/main.ts.
   Edit files under src/ and rebuild; edits here are overwritten. */`;

const prod = process.argv[2] === "production";

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
  plugins: [embeddedGraphvizWorker(prod)],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
