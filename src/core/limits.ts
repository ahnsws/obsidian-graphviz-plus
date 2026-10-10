/** Bounds for UI-thread parsing and retained worker input. Counts UTF-16 units. */
export const MAX_DOT_CHARACTERS = 250_000;
export const MAX_SVG_CHARACTERS = 5_000_000;
export const MAX_PENDING_RENDERS = 64;
export const MAX_QUEUED_CHARACTERS = 1_000_000;

export function assertDotSize(dot: string): void {
  if (dot.length > MAX_DOT_CHARACTERS) {
    throw new Error(
      `Diagram is too large (${dot.length.toLocaleString()} characters; ` +
        `limit ${MAX_DOT_CHARACTERS.toLocaleString()}).`,
    );
  }
}

export function assertSvgSize(svg: string): void {
  if (svg.length > MAX_SVG_CHARACTERS) {
    throw new Error(
      `Rendered SVG is too large (limit ${MAX_SVG_CHARACTERS.toLocaleString()} characters).`,
    );
  }
}
