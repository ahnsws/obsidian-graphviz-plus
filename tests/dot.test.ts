import assert from "node:assert/strict";
import test from "node:test";
import { scanDot } from "../src/core/dot";

test("scanDot finds the outer body and a direct layout assignment", () => {
  const source = 'strict graph example { layout="neato"; a -- b }';
  assert.deepEqual(scanDot(source), {
    bodyBrace: source.indexOf("{"),
    layout: "neato",
    unsupportedLayout: null,
  });
});

test("the last outer graph layout assignment wins", () => {
  assert.equal(
    scanDot('graph { layout=dot; GRAPH ["layout"="sf" + "dp"]; a -- b }')
      .layout,
    "sfdp",
  );
});

test("node, edge, subgraph, differently-cased, and textual layouts are ignored", () => {
  const source = `digraph {
    node [layout=neato]
    edge [layout=fdp]
    subgraph cluster_a { layout=circo; a -> b }
    LAYOUT=twopi
    label="layout=osage {"
    html=<<FONT TITLE="x>y">layout=patchwork {</FONT>>
    // layout=neato
    /* layout=fdp */
  }`;
  assert.equal(scanDot(source).layout, null);
  assert.equal(scanDot(source).unsupportedLayout, null);
  assert.equal(scanDot(source).bodyBrace, source.indexOf("{"));
});

test("an unsupported final engine does not fall back to an earlier assignment", () => {
  const result = scanDot("graph { layout=dot; layout=nop }");
  assert.equal(result.layout, null);
  assert.equal(result.unsupportedLayout, "nop");
});

test("HTML text quotes do not hide the graph body or later assignments", () => {
  for (const label of [
    "It's fine",
    'Say "hello"',
    "<B>It's fine</B>",
    '<FONT FACE="x>y">text</FONT>',
  ]) {
    const source = `digraph { a [label=<${label}>]; layout=neato; a -> b }`;
    assert.equal(scanDot(source).layout, "neato", label);
    assert.equal(scanDot(source).bodyBrace, source.indexOf("{"), label);
  }
  const source = "digraph <It's a graph> { a -> b }";
  assert.equal(scanDot(source).bodyBrace, source.indexOf("{"));
});

test("continued strings, HTML IDs, and repeated graph attribute lists select layouts", () => {
  for (const assignment of [
    'layout="ne\\\nato"',
    'layout="ne\\\r\nato"',
    "layout=<neato>",
    "<layout>=<neato>",
    "graph [rankdir=LR][layout=neato]",
    'GRAPH [rankdir=LR] /* gap */ [layout="ne" + "ato"]',
  ]) {
    assert.equal(
      scanDot(`digraph { ${assignment}; a -> b }`).layout,
      "neato",
      assignment,
    );
  }
  assert.equal(scanDot("digraph { layout=<nop> }").unsupportedLayout, "nop");
  assert.equal(
    scanDot('digraph { layout="ne\\ato" }').unsupportedLayout,
    "ne\\ato",
  );
});

test("HTML labels and repeated node/edge lists cannot select the graph engine", () => {
  const source = `digraph {
    graph [layout=dot][layout=<neato>]
    "]" [layout=circo]
    "graph" [layout=twopi]
    node [shape=box][layout=fdp]
    a [label=<layout=circo>][layout=twopi]
    a -> b [color=red][layout=osage]
    subgraph cluster_a { graph [layout=patchwork][layout=sfdp] }
  }`;
  assert.equal(scanDot(source).layout, "neato");
});
