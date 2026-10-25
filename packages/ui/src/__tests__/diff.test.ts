import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, toSplitRows } from "../lib/diff";

const patch = `@@ -1,4 +1,5 @@ function foo()
 keep
-old
+new
+extra
 tail
\\ No newline at end of file
`;

describe("parseUnifiedDiff", () => {
  it("parses hunks with line numbers", () => {
    const [hunk] = parseUnifiedDiff(patch);
    expect(hunk).toBeDefined();
    expect(hunk!.section).toBe("function foo()");
    expect(hunk!.lines.map((l) => [l.kind, l.oldNumber, l.newNumber, l.text])).toEqual([
      ["context", 1, 1, "keep"],
      ["del", 2, undefined, "old"],
      ["add", undefined, 2, "new"],
      ["add", undefined, 3, "extra"],
      ["context", 3, 4, "tail"],
    ]);
  });

  it("pairs deletions with additions for split view", () => {
    const rows = toSplitRows(parseUnifiedDiff(patch)[0]!.lines);
    expect(rows.map((r) => [r.left?.text, r.right?.text])).toEqual([
      ["keep", "keep"],
      ["old", "new"],
      [undefined, "extra"],
      ["tail", "tail"],
    ]);
  });

  it("handles new files", () => {
    const [hunk] = parseUnifiedDiff("@@ -0,0 +1,2 @@\n+a\n+b\n");
    expect(hunk!.lines.map((l) => l.newNumber)).toEqual([1, 2]);
  });
});
