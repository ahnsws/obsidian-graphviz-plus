import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// CI and source archives do not need local Git hooks.
if (!process.env.CI) {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const git = (...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const repository = git("rev-parse", "--is-inside-work-tree");
  if (repository.status === 0) {
    const current = git("config", "--get", "core.hooksPath");
    const hooksPath = current.stdout.trim();
    if (hooksPath && hooksPath !== ".githooks") {
      console.warn(
        `Keeping existing Git hooks at ${hooksPath}. Add npm run lint to your pre-commit hook.`,
      );
    } else {
      const installed = git("config", "--local", "core.hooksPath", ".githooks");
      if (installed.status !== 0) {
        throw new Error(installed.stderr || "Unable to install Git hooks.");
      }
      console.log("Pre-commit hook enabled: formatting and TypeScript checks.");
    }
  }
}
