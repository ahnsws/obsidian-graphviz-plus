import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import esbuild from "esbuild";
import { embeddedGraphvizWorker } from "./worker-plugin.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "graphviz-plus-browser-"));
const manual = process.argv.includes("--manual");
let browser;
let browserClosed;
try {
  const bundle = await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: ["tests/browser-smoke.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2018",
    minify: true,
    plugins: [embeddedGraphvizWorker(true)],
  });
  const htmlPath = join(directory, "index.html");
  const source = bundle.outputFiles[0].text.replace(
    /<\/script/gi,
    "<\\/script",
  );
  await writeFile(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><title>Graphviz Plus smoke check</title>
    <pre>Running browser worker checks…</pre><script>${source}</script>`,
  );
  if (manual) {
    console.log(
      `Open ${pathToFileURL(htmlPath)} in a browser, with networking disabled, to inspect results.`,
    );
  } else {
    const executable = process.env.GRAPHVIZ_CHROME || "chromium";
    browser = spawn(
      executable,
      [
        "--headless",
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        `--user-data-dir=${join(directory, "profile")}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    browserClosed = new Promise((resolve) => browser.once("close", resolve));
    // Chrome's debugging pipe uses NUL-delimited CDP JSON on descriptors 3/4.
    let nextId = 0;
    let buffer = "";
    let stderr = "";
    let failure;
    const pending = new Map();
    const fail = (error) => {
      failure = error;
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };
    browser.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    browser.on("error", fail);
    browser.on("exit", (code) =>
      fail(new Error(`Browser exited (${code}): ${stderr}`)),
    );
    browser.stdio[3].on("error", fail);
    browser.stdio[4].on("error", (error) =>
      fail(
        new Error(`Browser debugging pipe failed: ${error.message}\n${stderr}`),
      ),
    );
    browser.stdio[4].on("data", (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error)
          request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        if (failure) {
          reject(failure);
          return;
        }
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        browser.stdio[3].write(
          JSON.stringify({ id, method, params, sessionId }) + "\0",
        );
      });
    const timeout = setTimeout(
      () => fail(new Error(`Browser smoke check timed out: ${stderr}`)),
      40_000,
    );
    try {
      const { targetId } = await send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      await send("Network.enable", {}, sessionId);
      await send(
        "Network.emulateNetworkConditions",
        {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        },
        sessionId,
      );
      await send(
        "Page.navigate",
        { url: pathToFileURL(htmlPath).href },
        sessionId,
      );
      const result = await send(
        "Runtime.evaluate",
        {
          expression: `new Promise((resolve, reject) => {
          const wait = () => window.graphvizSmoke ? window.graphvizSmoke.then(resolve, reject) : setTimeout(wait, 25);
          wait();
        })`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ||
            JSON.stringify(result.exceptionDetails),
        );
      if (!Array.isArray(result.result?.value))
        throw new Error("Browser returned no smoke results.");
      console.log(
        result.result.value.map((line) => `PASS: ${line}`).join("\n"),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
} finally {
  if (browser) {
    if (
      browser.pid &&
      browser.exitCode === null &&
      browser.signalCode === null
    ) {
      browser.kill();
    }
    await browserClosed;
  }
  if (!manual) await rm(directory, { recursive: true, force: true });
}
