import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = await mkdtemp(join(tmpdir(), "graphviz-plus-tests-"));

try {
  await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [
      "tests/dot.test.ts",
      "tests/preamble.test.ts",
      "tests/svg.test.ts",
      "tests/worker.test.ts",
    ],
    outdir: outputDirectory,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: true,
  });
  const testFiles = [
    "dot.test.js",
    "preamble.test.js",
    "svg.test.js",
    "worker.test.js",
  ].map((file) => join(outputDirectory, file));
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
