import { Button, Markdown, cn } from "@agentic-hub/ui";
import { errorMessage, useClient, useIdeUpdate, useOpenIdeUpdate } from "@agentic-hub/ui/client";
import { ArrowDownToLine, CircleAlert, Download, LoaderCircle, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { appVersion, checkForUpdate, installUpdate, restartToUpdate, useUpdater, type UpdaterState } from "../platform/updater";

function percent(state: Extract<UpdaterState, { status: "downloading" }>) {
  return state.total ? Math.min(100, Math.round((state.downloaded / state.total) * 100)) : null;
}

export function useAppVersion() {
  const [version, setVersion] = useState(__APP_VERSION__);
  useEffect(() => {
    let live = true;
    void appVersion().then((v) => live && setVersion(v), () => {});
    return () => {
      live = false;
    };
  }, []);
  return version;
}

/** Compact sidebar control. Renders nothing unless an update needs the user. */
export function UpdatePill({ onOpenDetails }: { onOpenDetails: () => void }) {
  const state = useUpdater();
  if (state.status === "available")
    return (
      <button type="button" onClick={() => void installUpdate()} className="update-pill focus-ring" title={`Install version ${state.version}`}>
        <ArrowDownToLine className="size-3.5" /> Update available
        <span className="font-mono text-2xs opacity-80">v{state.version}</span>
      </button>
    );
  if (state.status === "downloading") {
    const p = percent(state);
    return (
      <button type="button" onClick={onOpenDetails} className="update-pill focus-ring" aria-live="polite">
        <LoaderCircle className="size-3.5 animate-spin" /> Downloading{p === null ? "…" : ` ${p}%`}
        <span className="update-pill-progress" style={{ width: `${p ?? 30}%` }} aria-hidden />
      </button>
    );
  }
  if (state.status === "ready")
    return (
      <button type="button" onClick={() => void restartToUpdate()} className="update-pill focus-ring">
        <RotateCw className="size-3.5" /> Restart to update
      </button>
    );
  return null;
}

/** Settings → About panel: version, check button, release notes, progress and errors. */
export function UpdatePanel() {
  const state = useUpdater();
  const version = useAppVersion();
  if (state.status === "unsupported") return <BrowserUpdatePanel version={version} />;

  const busy = state.status === "checking" || state.status === "downloading";
  const notes = state.status === "available" || state.status === "downloading" ? state.notes : state.status === "error" ? state.notes : undefined;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg">
        Agentic Hub <span className="font-mono text-xs text-fg-muted">v{version}</span>
      </p>
      <p className={cn("text-sm", state.status === "error" ? "text-danger" : "text-fg-muted")} aria-live="polite">
        {state.status === "checking"
          ? "Checking for updates…"
          : state.status === "available"
            ? `Version ${state.version} is available.`
            : state.status === "downloading"
              ? `Downloading version ${state.version}…`
              : state.status === "ready"
                ? `Version ${state.version} is installed. Restart to finish.`
                : state.status === "error"
                  ? (
                      <span className="inline-flex items-start gap-1.5">
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {state.message}
                      </span>
                    )
                  : state.checkedAt
                    ? "You're on the latest version."
                    : "Updates are checked automatically on launch and every 6 hours."}
      </p>
      {state.status === "downloading" ? (
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(state) ?? undefined}>
          <div className={cn("h-full rounded-full bg-accent transition-[width] duration-300", percent(state) === null && "animate-pulse")} style={{ width: `${percent(state) ?? 35}%` }} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {state.status === "available" || (state.status === "error" && state.version) ? (
          <Button size="sm" variant="primary" onClick={() => void installUpdate()}>
            <Download /> {state.status === "error" ? "Try again" : `Install ${state.version}`}
          </Button>
        ) : null}
        {state.status === "ready" ? (
          <Button size="sm" variant="primary" onClick={() => void restartToUpdate()}>
            <RotateCw /> Restart now
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void checkForUpdate()} disabled={busy || state.status === "ready"}>
          <RefreshCw className={state.status === "checking" ? "animate-spin" : ""} /> Check for updates
        </Button>
      </div>
      {notes ? (
        <details className="max-w-xl rounded-lg border border-border bg-surface px-3 py-2 text-sm" open>
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">Release notes</summary>
          <div className="mt-2 max-h-60 overflow-y-auto">
            <Markdown source={notes} />
          </div>
        </details>
      ) : null}
      <p className="text-xs text-fg-subtle">Updates are downloaded from GitHub Releases and installed only if their signature matches the key built into this app.</p>
    </div>
  );
}

/** Browser preview: no installer, so fall back to the runtime's release check. */
function BrowserUpdatePanel({ version }: { version: string }) {
  const client = useClient();
  const ideUpdate = useIdeUpdate(client.mode === "live");
  const open = useOpenIdeUpdate();
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg">
        Agentic Hub <span className="font-mono text-xs text-fg-muted">v{version}</span>
      </p>
      <p className="text-sm text-fg-muted">
        {client.mode === "demo"
          ? "Switch to the local runtime to check for releases."
          : ideUpdate.isPending
            ? "Checking GitHub releases…"
            : ideUpdate.isError
              ? errorMessage(ideUpdate.error)
              : `${ideUpdate.data?.detail ?? ""} Automatic installs work in the desktop app.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void ideUpdate.refetch()} disabled={client.mode === "demo" || ideUpdate.isFetching}>
          <RefreshCw className={ideUpdate.isFetching ? "animate-spin" : ""} /> Check again
        </Button>
        {ideUpdate.data?.available ? (
          <Button size="sm" variant="primary" onClick={() => void open.mutate()} disabled={open.isPending}>
            <Download /> Open release page
          </Button>
        ) : null}
      </div>
      {open.isError ? <p className="text-xs text-danger">{errorMessage(open.error)}</p> : null}
    </div>
  );
}
