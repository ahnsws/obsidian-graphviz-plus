import { GraphvizWorkerRenderer } from "../src/rendering/renderer";
import { parseAndSanitizeSvg } from "../src/rendering/svg";
import { scanDot } from "../src/core/dot";

declare global {
  interface Window {
    graphvizSmoke: Promise<string[]>;
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejects(job: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await job;
  } catch (error) {
    check(pattern.test(String(error)), `Unexpected failure: ${error}`);
    return;
  }
  throw new Error(`Expected rejection: ${pattern}`);
}

async function run(): Promise<string[]> {
  const results: string[] = [];
  const renderer = new GraphvizWorkerRenderer();
  try {
    await rejects(renderer.render("digraph { a -> }", "dot"), /syntax error/i);
    const source = `digraph <It's a graph> {
      graph [rankdir=LR][layout=<dot>]
      a [shape=plain, label=<<TABLE BORDER="1"><TR><TD PORT="out">
        <B>A &amp; B</B><BR/><U>under</U> H<SUB>2</SUB>O
      </TD></TR></TABLE>>];
      b [style=filled, fillcolor="red:blue", id="target", URL="#target"];
      a:out -> b [label=<<S>old</S> x<SUP>2</SUP>>];
    }`;
    check(
      scanDot(source).bodyBrace === source.indexOf("{"),
      "HTML graph name scan",
    );
    const roots = await Promise.all(
      [source, source].map(async (dot) => {
        const svg = parseAndSanitizeSvg(await renderer.render(dot, "dot"));
        document.body.appendChild(svg);
        return svg;
      }),
    );
    results.push(
      "Embedded browser worker starts offline and recovers after invalid DOT",
    );
    const ids = roots.flatMap((root) =>
      Array.from(root.querySelectorAll("[id]"), (el) => el.id),
    );
    check(new Set(ids).size === ids.length, "SVG ID collision");
    for (const root of roots) {
      for (const selector of [
        '[text-decoration="underline"]',
        '[text-decoration="line-through"]',
        '[baseline-shift="sub"]',
        '[baseline-shift="super"]',
        "linearGradient stop[stop-color]",
      ]) {
        check(
          root.querySelector(selector),
          `Missing label/gradient feature: ${selector}`,
        );
      }
      check(root.textContent?.includes("A & B"), "XML entity decoding");
      for (const element of Array.from(root.querySelectorAll("[fill]"))) {
        const reference = /^url\(#(.+)\)$/.exec(
          element.getAttribute("fill") || "",
        );
        if (reference)
          check(
            root.querySelector(`[id="${reference[1]}"]`),
            "Missing local paint target",
          );
      }
      const link = root.querySelector("a")!;
      const href = link.getAttribute("xlink:href")!;
      check(
        href.startsWith("#") && root.querySelector(`[id="${href.slice(1)}"]`),
        "Local link target",
      );
    }
    results.push(
      "Labels, tables, entities, gradients, and scoped references survive browser DOM parsing",
    );
    let invalidRejected = false;
    try {
      parseAndSanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>');
    } catch {
      invalidRejected = true;
    }
    check(invalidRejected, "Malformed XML accepted");
    const controller = new AbortController();
    const cancelled = rejects(
      renderer.render("digraph { a -> b }", "dot", controller.signal),
      /cancelled/,
    );
    const next = renderer.render("digraph { c -> d }", "dot");
    controller.abort();
    await cancelled;
    check(
      (await next).includes("<svg"),
      "Cancellation failed to preserve queued layout",
    );
    results.push(
      "Active cancellation restarts the Blob worker and preserves queued layouts",
    );
    const stopped = rejects(
      renderer.render("digraph { a -> b }", "dot"),
      /stopped/,
    );
    renderer.dispose();
    await stopped;
    await rejects(renderer.render("digraph { a -> b }", "dot"), /stopped/);
    results.push("Disposal prevents new worker work");
    return results;
  } finally {
    renderer.dispose();
  }
}

window.graphvizSmoke = run();
void window.graphvizSmoke.then(
  (results) => {
    document.querySelector("pre")!.textContent = results
      .map((line) => `PASS: ${line}`)
      .join("\n");
  },
  (error) => {
    document.querySelector("pre")!.textContent = `FAIL: ${error}`;
  },
);
