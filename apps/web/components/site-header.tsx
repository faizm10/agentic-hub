"use client";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  cn,
  useTheme,
} from "@agentic-hub/ui";
import { useConnection } from "@agentic-hub/ui/client";
import { ChevronDown, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDataSource, type WebDataSource } from "@/lib/data-source";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/sessions", label: "Sessions" },
];

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="size-6" aria-hidden>
      <rect width="64" height="64" rx="14" className="fill-surface-3" />
      <path d="M20 44 32 18l12 26" fill="none" className="stroke-accent" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="37" r="3.5" className="fill-fg" />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { source, setSource } = useDataSource();
  const connection = useConnection();
  const { resolved, setPreference } = useTheme();

  const status =
    connection.status === "demo"
      ? { label: "Demo data", dot: "bg-info" }
      : connection.status === "connected"
        ? { label: "Control plane", dot: "bg-success" }
        : { label: "Not connected", dot: "bg-danger" };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md focus-ring">
          <Logo />
          <span className="hidden text-sm font-semibold tracking-tight text-fg sm:inline">Agentic Hub</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm transition-colors focus-ring",
                  active ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Data source: ${status.label}`}>
                <span className={cn("size-1.5 rounded-full", status.dot)} />
                <span className="hidden sm:inline">{status.label}</span>
                <ChevronDown className="text-fg-subtle" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Data source</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={source} onValueChange={(v) => setSource(v as WebDataSource)}>
                <DropdownMenuRadioItem value="control-plane" className="h-auto items-start py-2">
                  <div>
                    <div className="text-sm text-fg">Control plane</div>
                    <div className="text-xs text-fg-subtle">Authenticated relay to your devices. Not configured yet.</div>
                  </div>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="demo" className="h-auto items-start py-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm text-fg">
                      Demo data <Badge tone="info">Fixtures</Badge>
                    </div>
                    <div className="text-xs text-fg-subtle">Sample devices and sessions. Nothing is real.</div>
                  </div>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
          >
            {resolved === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>
    </header>
  );
}
