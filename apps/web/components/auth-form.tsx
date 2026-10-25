"use client";

import { Button, Input } from "@agentic-hub/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Logo } from "./logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Something went wrong. Try again.");
      }
      router.replace("/app");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-flex items-center gap-2.5 font-semibold text-fg">
          <Logo /> Agentic Hub
        </Link>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{signup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1.5 text-sm text-fg-muted">{signup ? "Chat with models on the web and follow your desktop agents." : "Sign in to continue."}</p>
        <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-fg">Email</span>
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-fg">Password</span>
            <Input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={signup ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
            />
            {signup ? <span className="mt-1 block text-xs text-fg-subtle">At least 10 characters.</span> : null}
          </label>
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy} className="h-10 w-full rounded-full bg-fg text-bg hover:bg-fg/85">
            {busy ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-fg-muted">
          {signup ? "Already have an account? " : "New to Agentic Hub? "}
          <Link href={signup ? "/login" : "/signup"} className="font-medium text-fg underline-offset-2 hover:underline">
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </div>
  );
}
