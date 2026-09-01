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
    scanDot(
      'graph { layout=dot; GRAPH ["layout"="sf" + "dp"]; a -- b }',
    ).layout,
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
