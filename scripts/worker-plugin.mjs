import esbuild from "esbuild";

/** The same embedded browser worker is used in releases and smoke tests. */
export function embeddedGraphvizWorker(prod) {
  return {
    name: "embedded-graphviz-worker",
    setup(build) {
      build.onResolve({ filter: /^graphviz-worker-source$/ }, () => ({
        path: "graphviz-worker-source",
        namespace: "graphviz-worker",
      }));
      build.onLoad({ filter: /.*/, namespace: "graphviz-worker" }, async () => {
        const result = await esbuild.build({
          absWorkingDir: build.initialOptions.absWorkingDir,
          entryPoints: ["src/rendering/graphviz.worker.ts"],
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          target: "es2018",
          minify: prod,
          metafile: true,
          logLevel: "silent",
        });
        return {
          contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
          loader: "js",
          watchFiles: Object.keys(result.metafile.inputs),
        };
      });
    },
  };
}
