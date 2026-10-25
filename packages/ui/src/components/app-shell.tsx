"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type LayoutStorage } from "react-resizable-panels";
import { cn } from "../lib/cn";
import { safeStorage } from "../lib/storage";
import { useMediaQuery } from "../lib/use-media-query";

const layoutStorage: LayoutStorage = {
  getItem: (key) => safeStorage.get<string | null>(key, null),
  setItem: (key, value) => safeStorage.set(key, value),
};

function ResizeHandle({ label }: { label: string }) {
  return (
    <Separator
      aria-label={label}
      className="group relative w-px shrink-0 bg-border outline-none transition-colors data-[separator=hover]:bg-accent/60 data-[separator=active]:bg-accent focus-visible:bg-accent"
    >
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  );
}

export interface AppShellProps {
  sidebar: ReactNode;
  main: ReactNode;
  inspector?: ReactNode;
  /** Full-width strip above everything (connection/demo banner). */
  banner?: ReactNode;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  onInspectorOpenChange: (open: boolean) => void;
  /** Distinguishes persisted layouts (e.g. "desktop", "web"). */
  layoutId?: string;
  className?: string;
}

/**
 * Three-area workspace. On wide windows the sidebar and inspector are
 * resizable, collapsible panels with persisted sizes; on narrow windows
 * they become overlay drawers so the conversation keeps full width.
 */
export function AppShell({
  sidebar,
  main,
  inspector,
  banner,
  sidebarOpen,
  inspectorOpen,
  onSidebarOpenChange,
  onInspectorOpenChange,
  layoutId = "workspace",
  className,
}: AppShellProps) {
  const compact = useMediaQuery("(max-width: 899px)");
  const sidebarRef = usePanelRef();
  const inspectorRef = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `agentic-hub.layout.${layoutId}`, storage: layoutStorage });
  const syncing = useRef(false);

  useEffect(() => {
    if (compact) return;
    const panel = sidebarRef.current;
    if (!panel) return;
    syncing.current = true;
    if (sidebarOpen && panel.isCollapsed()) panel.expand();
    if (!sidebarOpen && !panel.isCollapsed()) panel.collapse();
    syncing.current = false;
  }, [sidebarOpen, compact, sidebarRef]);

  useEffect(() => {
    if (compact) return;
    const panel = inspectorRef.current;
    if (!panel) return;
    syncing.current = true;
    if (inspectorOpen && panel.isCollapsed()) panel.expand();
    if (!inspectorOpen && !panel.isCollapsed()) panel.collapse();
    syncing.current = false;
  }, [inspectorOpen, compact, inspectorRef]);

  if (compact) {
    return (
      <div className={cn("relative flex h-full min-h-0 flex-col bg-bg", className)}>
        {banner}
        <div className="relative flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">{main}</main>
          {sidebarOpen || inspectorOpen ? (
            <button
              type="button"
              aria-label="Close panel"
              className="absolute inset-0 z-30 bg-black/30 animate-in fade-in-0 dark:bg-black/55"
              onClick={() => {
                onSidebarOpenChange(false);
                onInspectorOpenChange(false);
              }}
            />
          ) : null}
          {sidebarOpen ? (
            <div className="absolute inset-y-0 left-0 z-40 w-[min(300px,86vw)] border-r border-border shadow-lg animate-in slide-in-from-left-4 fade-in-0">
              {sidebar}
            </div>
          ) : null}
          {inspectorOpen && inspector ? (
            <div className="absolute inset-y-0 right-0 z-40 w-[min(420px,92vw)] border-l border-border bg-surface shadow-lg animate-in slide-in-from-right-4 fade-in-0">
              {inspector}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-bg", className)}>
      {banner}
      <Group orientation="horizontal" id={`agentic-hub.layout.${layoutId}`} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} className="min-h-0 flex-1">
        <Panel
          id="sidebar"
          panelRef={sidebarRef}
          collapsible
          collapsedSize={0}
          defaultSize={264}
          minSize={208}
          maxSize={400}
          onResize={(size) => {
            const open = size.inPixels > 0;
            if (!syncing.current && open !== sidebarOpen) onSidebarOpenChange(open);
          }}
          className="min-w-0"
        >
          {sidebar}
        </Panel>
        <ResizeHandle label="Resize sidebar" />
        <Panel id="main" minSize={380} className="min-w-0">
          <main className="flex h-full min-w-0 flex-col">{main}</main>
        </Panel>
        <ResizeHandle label="Resize inspector" />
        <Panel
          id="inspector"
          panelRef={inspectorRef}
          collapsible
          collapsedSize={0}
          defaultSize={400}
          minSize={300}
          maxSize="60%"
          onResize={(size) => {
            const open = size.inPixels > 0;
            if (!syncing.current && open !== inspectorOpen) onInspectorOpenChange(open);
          }}
          className="min-w-0 bg-surface"
        >
          {inspector}
        </Panel>
      </Group>
    </div>
  );
}