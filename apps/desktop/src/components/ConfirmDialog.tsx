import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@agentic-hub/ui";
import type { ApprovalRisk } from "@agentic-hub/ui/model";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Explicit confirmation for sensitive actions (pushes, merges, deploys).
 * The runtime refuses these without `confirm: true`, so this is the only path.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  risk,
  confirmLabel,
  onConfirm,
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  risk: ApprovalRisk;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-5" aria-describedby="confirm-description">
        <div className="flex items-start gap-3">
          <span className={risk === "high" ? "text-danger" : "text-warning"}>
            <ShieldAlert className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
              <Badge tone={risk === "high" ? "danger" : "warning"}>{risk} risk</Badge>
            </div>
            <DialogDescription id="confirm-description" className="mt-1.5 text-sm text-fg-muted">
              {description}
            </DialogDescription>
            {children ? <div className="mt-3">{children}</div> : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={risk === "high" ? "danger" : "primary"} onClick={onConfirm} disabled={busy} autoFocus={risk !== "high"}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
