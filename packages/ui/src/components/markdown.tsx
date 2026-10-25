"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { CodeBlock } from "./code-block";

/**
 * Markdown for agent and model output: headings, paragraphs, lists, quotes,
 * tables, rules, fenced code (highlighted), inline code, links, bold and
 * italics. Everything renders as React nodes, so model output cannot inject
 * markup; links are limited to http(s) and mailto and open externally.
 */

const SAFE_URL = /^(https?:|mailto:)/i;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[0.85em] text-fg">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push(<strong key={key} className="font-semibold text-fg">{inline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith("~~")) {
      out.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out.push(<SafeLink key={key} href={m[2]!}>{m[1]}</SafeLink>);
    } else if (/^https?:/.test(token)) {
      out.push(<SafeLink key={key} href={token}>{token}</SafeLink>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  if (!SAFE_URL.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
      {children}
    </a>
  );
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul" | "ol"; items: string[]; start?: number }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; lang?: string; code: string; open: boolean };

const LIST = /^\s*(?:[-*+]|\d+[.)]) /;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) code.push(lines[i++]!);
      const open = i >= lines.length;
      i++;
      blocks.push({ type: "code", lang: fence[2] || undefined, code: code.join("\n"), open });
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "h", level: heading[1]!.length, text: heading[2]!.replace(/\s+#+\s*$/, "") });
      i++;
      continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+[.)] /.test(line);
      const start = ordered ? Number(/^\s*(\d+)/.exec(line)![1]) : undefined;
      const items: string[] = [];
      while (i < lines.length && (LIST.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length))) {
        if (LIST.test(lines[i]!)) items.push(lines[i]!.replace(LIST, ""));
        else items[items.length - 1] += ` ${lines[i]!.trim()}`;
        i++;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items, start });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^\s*(```|~~~)/.test(lines[i]!) &&
      !LIST.test(lines[i]!) &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !/^\s*>/.test(lines[i]!)
    ) {
      para.push(lines[i++]!);
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }
  return blocks;
}

const HEADING = ["text-xl", "text-lg", "text-base", "text-base", "text-sm", "text-sm"];

function withBreaks(text: string, key: string) {
  return text.split("\n").map((line, j, all) => (
    <Fragment key={`${key}-${j}`}>
      {inline(line, `${key}-${j}`)}
      {j < all.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

export function Markdown({ source, className, trailing }: { source: string; className?: string; trailing?: ReactNode }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={cn("space-y-3 text-[0.9375rem] leading-[1.7] text-fg/90", className)}>
      {blocks.map((block, index) => {
        const tail = index === blocks.length - 1 ? trailing : null;
        switch (block.type) {
          case "code":
            return (
              <Fragment key={index}>
                <CodeBlock code={block.code} lang={block.lang} />
                {tail}
              </Fragment>
            );
          case "h": {
            const Tag = `h${Math.min(block.level + 1, 6)}` as "h2";
            return (
              <Tag key={index} className={cn("pt-2 font-semibold tracking-[-0.01em] text-fg", HEADING[block.level - 1])}>
                {inline(block.text, `h${index}`)}
                {tail}
              </Tag>
            );
          }
          case "hr":
            return <hr key={index} className="my-4 border-border" />;
          case "quote":
            return (
              <blockquote key={index} className="border-l-2 border-border-strong pl-4 text-fg-muted">
                {withBreaks(block.text, `q${index}`)}
                {tail}
              </blockquote>
            );
          case "table":
            return (
              <div key={index} className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-surface-2">
                    <tr>
                      {block.header.map((cell, j) => (
                        <th key={j} className="border-b border-border px-3 py-2 text-left font-medium text-fg">
                          {inline(cell, `th${index}-${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border last:border-0">
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 align-top">
                            {inline(cell, `td${index}-${r}-${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "p":
            return (
              <p key={index}>
                {withBreaks(block.text, `p${index}`)}
                {tail}
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.type;
            return (
              <List
                key={index}
                start={block.start}
                className={cn("space-y-1.5 pl-6", List === "ul" ? "list-disc marker:text-fg-subtle" : "list-decimal marker:text-fg-subtle")}
              >
                {block.items.map((item, j) => (
                  <li key={j} className="pl-1">
                    {inline(item, `l${index}-${j}`)}
                    {tail && j === block.items.length - 1 ? tail : null}
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
      {blocks.length === 0 ? trailing : null}
    </div>
  );
}
