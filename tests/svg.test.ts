import assert from "node:assert/strict";
import test from "node:test";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { DOMParser } from "@xmldom/xmldom";
import {
  isSafeSvgHref,
  sanitizeSvg,
  parseAndSanitizeSvg,
} from "../src/rendering/svg";
import { MAX_SVG_CHARACTERS } from "../src/core/limits";

test("URL policy allows intentional links and rejects active/local protocols", () => {
  for (const href of [
    "https://example.com",
    "http://example.com",
    "mailto:user@example.com",
    "obsidian://open?vault=test",
    "#node1",
  ]) {
    assert.equal(isSafeSvgHref(href), true, href);
  }
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,boom",
    "file:///etc/passwd",
    "relative/path",
    "//example.com",
  ]) {
    assert.equal(isSafeSvgHref(href), false, href);
  }
});

test("oversized SVG is rejected before DOM parsing", () => {
  assert.throws(
    () => parseAndSanitizeSvg("x".repeat(MAX_SVG_CHARACTERS + 1)),
    /SVG is too large/,
  );
});

test("Graphviz javascript links are removed before SVG insertion", async () => {
  const graphviz = await Graphviz.load();
  const output = graphviz.layout(
    'digraph { bad [URL="javascript:alert(1)"]; good [URL="https://example.com"] }',
    "svg",
    "dot",
  );
  const document = new DOMParser().parseFromString(output, "image/svg+xml");
  const root = sanitizeSvg(document.documentElement as unknown as Element);
  const links = Array.from(root.getElementsByTagName("a"));

  assert.equal(links.length, 2);
  assert.equal(links[0].getAttribute("xlink:href"), null);
  assert.equal(links[1].getAttribute("xlink:href"), "https://example.com");
});

test("event handlers, style, images, and foreign elements are removed", () => {
  const input = `<svg xmlns="http://www.w3.org/2000/svg">
    <g onclick="alert(1)" style="fill:url(evil)"><path d="M0 0"/></g>
    <image href="https://example.com/tracker.png"/>
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
  </svg>`;
  const document = new DOMParser().parseFromString(input, "image/svg+xml");
  const root = sanitizeSvg(document.documentElement as unknown as Element);

  const group = root.getElementsByTagName("g")[0];
  assert.equal(group.hasAttribute("onclick"), false);
  assert.equal(group.hasAttribute("style"), false);
  assert.equal(root.getElementsByTagName("image").length, 0);
  assert.equal(root.getElementsByTagName("foreignObject").length, 0);
});

for (const role of ["node", "edge"]) {
  test(`HTML-like ${role} labels retain text formatting`, async () => {
    const graphviz = await Graphviz.load();
    const label = `<<B>bold</B> <I>italic</I> <U>under</U> <O>over</O>
      <S>strike</S> H<SUB>2</SUB> x<SUP>3</SUP> <U><S>both</S></U>>`;
    const statement = role === "node" ? "a" : "a -> b";
    const output = graphviz.layout(
      `digraph { ${statement} [label=${label}] }`,
      "svg",
      "dot",
    );
    const document = new DOMParser().parseFromString(output, "image/svg+xml");
    const root = sanitizeSvg(document.documentElement as unknown as Element);
    const group = Array.from(root.getElementsByTagName("g")).find(
      (element) => element.getAttribute("class") === role,
    );
    assert.ok(group);
    const texts = Array.from(group.getElementsByTagName("text"));
    for (const [text, attribute, value] of [
      ["bold", "font-weight", "bold"],
      ["italic", "font-style", "italic"],
      ["under", "text-decoration", "underline"],
      ["over", "text-decoration", "overline"],
      ["strike", "text-decoration", "line-through"],
      ["2", "baseline-shift", "sub"],
      ["3", "baseline-shift", "super"],
      ["both", "text-decoration", "underline,line-through"],
    ]) {
      const element = texts.find(
        (element) => element.textContent?.trim() === text,
      );
      assert.ok(element, `missing ${text}`);
      assert.equal(element.getAttribute(attribute), value, text);
    }
  });
}

test("HTML-like tables, ports, line breaks, and entities survive rendering", async () => {
  const graphviz = await Graphviz.load();
  const output = graphviz.layout(
    `digraph {
    a [shape=plain, label=<
      <TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0">
        <TR><TD PORT="out"><B>A &amp; B</B><BR/>x &lt; y</TD></TR>
      </TABLE>
    >];
    a:out -> b [label=<
      <TABLE BORDER="1"><TR><TD>edge<BR/>next</TD></TR></TABLE>
    >];
  }`,
    "svg",
    "dot",
  );
  const document = new DOMParser().parseFromString(output, "image/svg+xml");
  const root = sanitizeSvg(document.documentElement as unknown as Element);
  const groups = Array.from(root.getElementsByTagName("g"));
  const node = groups.find(
    (element) => element.getAttribute("class") === "node",
  );
  const edge = groups.find(
    (element) => element.getAttribute("class") === "edge",
  );
  assert.ok(node);
  assert.ok(edge);
  assert.ok(
    node.getElementsByTagName("polygon").length > 0,
    "node table border",
  );
  assert.ok(
    edge.getElementsByTagName("polygon").length > 1,
    "arrow and edge table border",
  );
  assert.match(
    edge.getElementsByTagName("title")[0].textContent || "",
    /a:out/,
  );
  for (const [group, first, second] of [
    [node, "A & B", "x < y"],
    [edge, "edge", "next"],
  ] as const) {
    const texts = Array.from(group.getElementsByTagName("text"));
    const line1 = texts.find((element) => element.textContent === first);
    const line2 = texts.find((element) => element.textContent === second);
    assert.ok(line1);
    assert.ok(line2);
    assert.notEqual(
      line1.getAttribute("y"),
      line2.getAttribute("y"),
      "separate lines",
    );
  }
});

test("HTML-like table links still follow the SVG URL policy", async () => {
  const graphviz = await Graphviz.load();
  const output = graphviz.layout(
    `digraph {
    a [shape=plain, label=<<TABLE><TR>
      <TD HREF="javascript:alert(1)"><U>bad</U></TD>
      <TD HREF="https://example.com/?a=1&amp;b=2"><SUP>good</SUP></TD>
    </TR></TABLE>>];
  }`,
    "svg",
    "dot",
  );
  const document = new DOMParser().parseFromString(output, "image/svg+xml");
  const root = sanitizeSvg(document.documentElement as unknown as Element);
  const links = Array.from(root.getElementsByTagName("a"));
  assert.equal(links.length, 2);
  assert.equal(links[0].getAttribute("xlink:href"), null);
  assert.equal(
    links[1].getAttribute("xlink:href"),
    "https://example.com/?a=1&b=2",
  );
});

test("label formatting accepts only Graphviz values on text elements", () => {
  const input = `<svg xmlns="http://www.w3.org/2000/svg">
    <g baseline-shift="sub" text-decoration="underline"/>
    <text baseline-shift="url(https://example.com)" text-decoration="underline,blink">bad</text>
    <text baseline-shift="inherit" text-decoration="url(https://example.com)">bad</text>
    <text style="baseline-shift:super" onclick="alert(1)">bad</text>
  </svg>`;
  const document = new DOMParser().parseFromString(input, "image/svg+xml");
  const root = sanitizeSvg(document.documentElement as unknown as Element);
  for (const element of Array.from(root.getElementsByTagName("*"))) {
    for (const attribute of [
      "baseline-shift",
      "text-decoration",
      "style",
      "onclick",
    ]) {
      assert.equal(element.hasAttribute(attribute), false, attribute);
    }
  }
});

for (const [style, gradientTag] of [
  ["filled", "linearGradient"],
  ["radial", "radialGradient"],
]) {
  test(`${gradientTag} definitions and local paint references survive sanitization`, async () => {
    const graphviz = await Graphviz.load();
    const output = graphviz.layout(
      `digraph { a [style=${style}, fillcolor="red:blue"] }`,
      "svg",
      "dot",
    );
    const document = new DOMParser().parseFromString(output, "image/svg+xml");
    const root = sanitizeSvg(document.documentElement as unknown as Element);
    const gradient = root.getElementsByTagName(gradientTag)[0];
    assert.ok(gradient);
    const id = gradient.getAttribute("id");
    assert.ok(id?.startsWith("graphviz-plus-"));
    assert.equal(
      root.getElementsByTagName("ellipse")[0].getAttribute("fill"),
      `url(#${id})`,
    );
    const stops = Array.from(gradient.getElementsByTagName("stop"));
    assert.equal(stops.length, 2);
    assert.deepEqual(
      stops.map((stop) => stop.getAttribute("stop-color")),
      ["red", "blue"],
    );
    assert.deepEqual(
      stops.map((stop) => stop.getAttribute("stop-opacity")),
      ["1", "1"],
    );
    assert.ok(stops.every((stop) => !stop.hasAttribute("style")));
  });
}

test("diagram IDs are unique and local links follow their own diagram", async () => {
  const graphviz = await Graphviz.load();
  const output = graphviz.layout(
    'digraph { a [id="destination", URL="#destination"]; b [URL="#note-heading"] }',
    "svg",
    "dot",
  );
  const roots = [1, 2].map(() =>
    sanitizeSvg(
      new DOMParser().parseFromString(output, "image/svg+xml")
        .documentElement as unknown as Element,
    ),
  );
  const allIds: string[] = [];
  for (const root of roots) {
    const groups = Array.from(root.getElementsByTagName("g"));
    const node = groups.find(
      (group) => group.getAttribute("class") === "node",
    )!;
    const links = Array.from(root.getElementsByTagName("a"));
    assert.equal(
      links[0].getAttribute("xlink:href"),
      `#${node.getAttribute("id")}`,
    );
    assert.equal(links[1].getAttribute("xlink:href"), "#note-heading");
    allIds.push(
      ...groups
        .map((group) => group.getAttribute("id"))
        .filter((id): id is string => !!id),
    );
  }
  assert.equal(new Set(allIds).size, allIds.length);
});

test("duplicate source IDs still receive unique DOM IDs", () => {
  const document = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">
    <g id="same"/><g id="same"/><a href="#same"/>
  </svg>`,
    "image/svg+xml",
  );
  const root = sanitizeSvg(document.documentElement as unknown as Element);
  const groups = root.getElementsByTagName("g");
  assert.notEqual(groups[0].getAttribute("id"), groups[1].getAttribute("id"));
  assert.equal(
    root.getElementsByTagName("a")[0].getAttribute("href"),
    `#${groups[0].getAttribute("id")}`,
  );
});

test("external and dangling paint URLs and arbitrary stop styles are removed", () => {
  const document = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="paint">
      <stop offset="0" style="stop-color:red;stop-opacity:1.;background:url(https://example.com)"/>
      <stop offset="1" style="stop-color:url(https://example.com);stop-opacity:1.;"/>
    </linearGradient></defs>
    <rect fill="url(https://example.com/paint.svg#x)" stroke="url(#missing)"/>
    <rect fill="u\\72l(https://example.com)"/>
    <rect fill="url(#paint)"/>
  </svg>`,
    "image/svg+xml",
  );
  const root = sanitizeSvg(document.documentElement as unknown as Element);
  const rectangles = root.getElementsByTagName("rect");
  assert.equal(rectangles[0].hasAttribute("fill"), false);
  assert.equal(rectangles[0].hasAttribute("stroke"), false);
  assert.equal(rectangles[1].hasAttribute("fill"), false);
  assert.match(
    rectangles[2].getAttribute("fill") || "",
    /^url\(#graphviz-plus-/,
  );
  for (const stop of Array.from(root.getElementsByTagName("stop"))) {
    assert.equal(stop.hasAttribute("style"), false);
    assert.equal(stop.hasAttribute("stop-color"), false);
  }
});
