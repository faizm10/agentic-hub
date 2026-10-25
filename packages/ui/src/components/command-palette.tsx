"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "../primitives/dialog";
import { Kbd } from "../primitives/kbd";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  shortcut?: string;
  hint?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({ open, onOpenChange, commands }: { open: boolean; onOpenChange: (open: boolean) => void; commands: PaletteCommand[] }) {
  const groups = [...new Set(commands.map((c) => c.group))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command label="Command palette" className="flex flex-col" loop>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-fg-subtle" />
            <Command.Input placeholder="Search sessions, projects and commands…" className="h-11 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle" />
            <Kbd keys="escape" />
          </div>
          <Command.List className="max-h-[min(380px,60vh)] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-sm text-fg-subtle">No results.</Command.Empty>
            {groups.map((group) => (
              <Command.Group
                key={group}
                heading={group}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
              >
                {commands
                  .filter((c) => c.group === group)
                  .map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`${c.group} ${c.label} ${c.id}`}
                      keywords={c.keywords}
                      disabled={c.disabled}
                      onSelect={() => {
                        onOpenChange(false);
                        c.run();
                      }}
                      className="flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm text-fg data-[disabled=true]:opacity-40 data-[selected=true]:bg-surface-3 [&_svg]:size-4 [&_svg]:text-fg-subtle"
                    >
                      {c.icon}
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.hint ? <span className="truncate text-xs text-fg-subtle">{c.hint}</span> : null}
                      {c.shortcut ? <Kbd keys={c.shortcut} /> : null}
                    </Command.Item>
                  ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}