"use client";

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Check, Copy } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../lib/cn";
import { useCopy } from "../lib/use-copy";

const LANGUAGES = { bash, css, diff, go, java, javascript, json, markdown, python, ruby, rust, sql, swift, typescript, xml, yaml };
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);
hljs.registerAliases(["sh", "shell", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx", "mts"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["patch"], { languageName: "diff" });
hljs.registerAliases(["rb"], { languageName: "ruby" });

/**
 * Highlighted HTML for `code`. highlight.js escapes the source text and only
 * adds `<span class="hljs-…">` wrappers, so model output cannot inject markup.
 * Unknown languages fall back to escaped plain text.
 */
export function highlightCode(code: string, lang?: string): string | null {
  const language = lang?.toLowerCase();
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const { copied, copy } = useCopy();
  const html = useMemo(() => highlightCode(code, lang), [code, lang]);
  return (
    <div className={cn("group/code overflow-hidden rounded-xl border border-border bg-surface-2", className)}>
      <div className="flex h-8 items-center justify-between border-b border-border px-3 text-2xs text-fg-subtle">
        <span className="font-mono">{lang || "text"}</span>
        <button
          type="button"
          onClick={() => void copy(code)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-surface-3 hover:text-fg focus-ring"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[0.8rem] leading-[1.6] text-fg" data-selectable>
        {html ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
      </pre>
    </div>
  );
}
