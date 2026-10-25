import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiffViewer } from "../components/diff-viewer";
import { TooltipProvider } from "../primitives/tooltip";

const diff = { path: "src/a.ts", status: "modified" as const, patch: "@@ -1,2 +1,2 @@\n keep\n-old\n+new\n" };

describe("DiffViewer", () => {
  it("renders stats and switches between unified and split layouts", async () => {
    render(
      <TooltipProvider>
        <DiffViewer diff={diff} />
      </TooltipProvider>,
    );
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Diff of src/a.ts" });
    // unified: hunk header + 3 lines
    expect(table.querySelectorAll("tr")).toHaveLength(4);
    await userEvent.click(screen.getByRole("radio", { name: "Split" }));
    // split: hunk header + keep row + paired old/new row
    expect(table.querySelectorAll("tr")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Split" })).toHaveAttribute("aria-checked", "true");
  });

  it("explains binary files", () => {
    render(
      <TooltipProvider>
        <DiffViewer diff={{ ...diff, binary: true }} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/Binary file/)).toBeInTheDocument();
  });
});
