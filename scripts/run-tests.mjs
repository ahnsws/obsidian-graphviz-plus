import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { embeddedGraphvizWorker } from "./worker-plugin.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = await mkdtemp(join(tmpdir(), "graphviz-plus-tests-"));

try {
  const testNames = (await readdir(join(projectRoot, "tests")))
    .filter((file) => file.endsWith(".test.ts"))
    .sort();
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: testNames.map((file) => `tests/${file}`),
    outdir: outputDirectory,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: true,
    plugins: [
      embeddedGraphvizWorker(true),
      {
        name: "test-obsidian-host",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({
            path: join(projectRoot, "tests/helpers/obsidian.ts"),
          }));
        },
      },
    ],
  });
  const testFiles = testNames.map((file) =>
    join(outputDirectory, file.replace(/\.ts$/, ".js")),
  );
  for (const testFile of testFiles) {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [testFile], { stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  }
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
