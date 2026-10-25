import { ArrowRight, Laptop, LockKeyhole, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { currentUser } from "@/lib/server/auth";

export default async function HomePage() {
  // A missing database shouldn't take down the landing page.
  const user = await currentUser().catch(() => null);
  if (user) redirect("/app");
  const features = [
    { icon: <MessagesSquare className="size-5" />, title: "Chat with any model", body: "OpenAI and Anthropic models through the official APIs, with your own keys encrypted at rest." },
    { icon: <Laptop className="size-5" />, title: "Your agents, from anywhere", body: "Pair the desktop app to follow Codex, Claude Code and Muse Code sessions running on your computer." },
    { icon: <LockKeyhole className="size-5" />, title: "Private by design", body: "Your computer connects out to us. Nothing on it is exposed to the internet, and remote control is opt-in." },
  ];
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-fg">
          <Logo /> Agentic Hub
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-full px-4 py-2 text-fg-muted transition-colors hover:text-fg">
            Sign in
          </Link>
          <Link href="/signup" className="rounded-full bg-fg px-4 py-2 font-medium text-bg transition-opacity hover:opacity-85">
            Get started
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 pb-20 pt-16 text-center sm:pt-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.035em] text-fg sm:text-6xl">One workspace for your coding agents.</h1>
        <p className="mt-5 max-w-xl text-lg text-fg-muted">
          Codex, Claude Code and Muse Code in your repositories. OpenAI and Anthropic a message away. Streaming, approvals and diffs in one calm place.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="inline-flex items-center gap-2 rounded-full bg-fg px-6 py-3 text-sm font-medium text-bg transition-opacity hover:opacity-85">
            Create your account <ArrowRight className="size-4" />
          </Link>
          <a href="https://github.com/faizm10/agentic-hub#desktop-app" className="rounded-full border border-border px-6 py-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2">
            Get the desktop app
          </a>
        </div>
        <div className="mt-20 grid w-full gap-4 text-left sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-3xl border border-border bg-surface p-6">
              <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-surface-3 text-fg">{f.icon}</div>
              <h2 className="text-base font-semibold text-fg">{f.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
