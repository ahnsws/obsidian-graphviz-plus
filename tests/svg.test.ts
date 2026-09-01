import assert from "node:assert/strict";
import test from "node:test";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { DOMParser } from "@xmldom/xmldom";
import { isSafeSvgHref, sanitizeSvg } from "../src/rendering/svg";

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
