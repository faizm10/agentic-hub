const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

export function formatRelative(iso: string, now: number = Date.now()) {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Bucket ISO timestamps into history groups like "Today", "Yesterday", "Previous 7 days". */
export function dayBucket(iso: string, now: Date = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(iso).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - 86400_000) return "Yesterday";
  if (t >= startOfToday - 7 * 86400_000) return "Previous 7 days";
  return "Older";
}

export function splitPath(path: string) {
  const index = path.lastIndexOf("/");
  return index === -1 ? { dir: "", name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}
