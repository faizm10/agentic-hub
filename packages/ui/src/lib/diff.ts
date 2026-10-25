export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  section?: string;
  lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Parse the hunks of a single-file unified diff. File headers are skipped. */
export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    const match = HUNK_RE.exec(raw);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      current = { header: raw, oldStart: oldLine, newStart: newLine, section: match[5] || undefined, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") current.lines.push({ kind: "add", text, newNumber: newLine++ });
    else if (marker === "-") current.lines.push({ kind: "del", text, oldNumber: oldLine++ });
    else if (marker === " " || raw === "") current.lines.push({ kind: "context", text, oldNumber: oldLine++, newNumber: newLine++ });
  }
  // A trailing newline in the patch yields a phantom empty context line.
  for (const hunk of hunks) {
    const last = hunk.lines.at(-1);
    if (last && last.kind === "context" && last.text === "" && hunk === hunks.at(-1)) hunk.lines.pop();
  }
  return hunks;
}

export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

/** Pair deletions with additions so a side-by-side view lines up edits. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}
