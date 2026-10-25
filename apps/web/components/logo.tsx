export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" className="fill-fg" />
      <path d="M20 44 32 18l12 26" fill="none" className="stroke-bg" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="37" r="3.5" className="fill-bg" />
    </svg>
  );
}
