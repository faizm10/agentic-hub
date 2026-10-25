import { themeBootstrapScript } from "@agentic-hub/ui/theme-script";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Agentic Hub", template: "%s · Agentic Hub" },
  description: "One workspace for your coding agents and AI models: Codex, Claude Code, Muse Code, OpenAI and Anthropic.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#16171c" },
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-dvh">
        {/* Applies the saved theme before hydration to avoid a flash. */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
