/** Pure DOT helpers shared by the Obsidian adapter and unit tests. */

export const ENGINES = [
  "dot",
  "neato",
  "fdp",
  "sfdp",
  "circo",
  "twopi",
  "osage",
  "patchwork",
] as const;

export type Engine = (typeof ENGINES)[number];

export function isEngine(name: string): name is Engine {
  return (ENGINES as readonly string[]).includes(name);
}

export interface DotScan {
  /** Offset of the `{` that opens the outer graph body, or -1. */
  bodyBrace: number;
  /** Last supported top-level graph layout assignment. */
  layout: Engine | null;
  /** Last top-level layout value when it is not supported. */
  unsupportedLayout: string | null;
}

interface Token {
  kind: "id" | "string" | "symbol";
  value: string;
  start: number;
}

/**
 * Scan the small, well-defined part of DOT needed by the plugin.
 *
 * Unlike a text search, this tokenizes strings, HTML labels, and comments, and
 * only accepts layout assignments in the outer graph scope: either
 * `layout=...` or `graph [layout=...]`. Later assignments win, matching DOT's
 * attribute behavior. Node, edge, and subgraph attributes are ignored.
 */
export function scanDot(src: string): DotScan {
  const tokens = tokenizeDot(src);
  let bodyBrace = -1;
  let braceDepth = 0;
  const bracketRoles: Array<"graph" | "other"> = [];
  let layout: Engine | null = null;
  let unsupportedLayout: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === "symbol") {
      if (token.value === "{") {
        if (bodyBrace < 0) bodyBrace = token.start;
        braceDepth++;
      } else if (token.value === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (token.value === "[") {
        const previous = tokens[i - 1];
        bracketRoles.push(
          braceDepth === 1 &&
            previous?.kind === "id" &&
            previous.value.toLowerCase() === "graph"
            ? "graph"
            : "other",
        );
      } else if (token.value === "]") {
        bracketRoles.pop();
      }
      continue;
    }

    const inDirectGraphScope = braceDepth === 1 && bracketRoles.length === 0;
    const inGraphAttributes =
      braceDepth === 1 && bracketRoles[bracketRoles.length - 1] === "graph";
    if (
      (token.kind !== "id" && token.kind !== "string") ||
      token.value !== "layout" ||
      (!inDirectGraphScope && !inGraphAttributes)
    ) {
      continue;
    }

    const equals = tokens[i + 1];
    const value = tokens[i + 2];
    if (
      equals?.kind !== "symbol" ||
      equals.value !== "=" ||
      (value?.kind !== "id" && value?.kind !== "string")
    ) {
      continue;
    }

    let assignedValue = value.value;
    let valueEnd = i + 2;
    while (
      value.kind === "string" &&
      tokens[valueEnd + 1]?.kind === "symbol" &&
      tokens[valueEnd + 1].value === "+" &&
      tokens[valueEnd + 2]?.kind === "string"
    ) {
      assignedValue += tokens[valueEnd + 2].value;
      valueEnd += 2;
    }

    if (isEngine(assignedValue)) {
      layout = assignedValue;
      unsupportedLayout = null;
    } else {
      layout = null;
      unsupportedLayout = assignedValue;
    }
  }

  return { bodyBrace, layout, unsupportedLayout };
}

function tokenizeDot(src: string): Token[] {
  const tokens: Token[] = [];

  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = afterLine(src, i);
      continue;
    }
    if (c === "#" && (i === 0 || src[i - 1] === "\n")) {
      i = afterLine(src, i);
      continue;
    }
    if (c === '"') {
      const start = i++;
      let value = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          value += src[i + 1];
          i += 2;
        } else {
          value += src[i++];
        }
      }
      if (i < src.length) i++;
      tokens.push({ kind: "string", value, start });
      continue;
    }
    if (c === "<") {
      i = afterHtmlString(src, i);
      continue;
    }
    if ("{}[]=;,+".includes(c)) {
      tokens.push({ kind: "symbol", value: c, start: i++ });
      continue;
    }

    const start = i;
    while (
      i < src.length &&
      !/\s/.test(src[i]) &&
      !"{}[]=;,+<>\"".includes(src[i]) &&
      !(src[i] === "/" && ["/", "*"].includes(src[i + 1]))
    ) {
      i++;
    }
    if (i === start) i++;
    else tokens.push({ kind: "id", value: src.slice(start, i), start });
  }

  return tokens;
}

/** Skip a balanced HTML-like DOT string while respecting quoted attributes. */
function afterHtmlString(src: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "<") depth++;
    else if (c === ">" && --depth === 0) return i + 1;
  }
  return src.length;
}

function afterLine(src: string, from: number): number {
  const newline = src.indexOf("\n", from);
  return newline < 0 ? src.length : newline + 1;
}
