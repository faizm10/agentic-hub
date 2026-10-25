import type { ReactNode } from "react";

export function ScreenHeader({ title, toolbar, actions, subtitle }: { title: ReactNode; toolbar?: ReactNode; actions?: ReactNode; subtitle?: ReactNode }) {
  return (
    <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2">
      {toolbar}
      <div className="flex min-w-0 flex-1 items-baseline gap-2 px-1">
        <h1 className="truncate text-sm font-medium text-fg">{title}</h1>
        {subtitle ? <span className="truncate text-xs text-fg-subtle">{subtitle}</span> : null}
      </div>
      {actions}
    </header>
  );
}

export function ScreenBody({ children, width = "max-w-3xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={`mx-auto w-full ${width} px-6 py-8`}>{children}</div>
    </div>
  );
}
