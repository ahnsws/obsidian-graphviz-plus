/**
 * Read DOT statements from a preamble note.
 *
 * Raw text is accepted only when the note contains no fenced blocks. If fences
 * exist, the first blank, dot, or graphviz fence wins. This prevents prose or
 * an unrelated code sample from accidentally being injected as DOT.
 */
export function extractPreamble(text: string): string {
  const lines = text.split("\n");
  let sawFence = false;

  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s`~]*)/.exec(lines[i]);
    if (!open) continue;
    sawFence = true;
    const [, marker, info] = open;
    const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (/^(dot|graphviz)?$/i.test(info)) {
      return lines.slice(i + 1, end).join("\n").trim();
    }
    i = end;
  }

  return sawFence ? "" : text.trim();
}
