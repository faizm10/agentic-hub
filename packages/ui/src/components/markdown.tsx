"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Deliberately small Markdown subset (paragraphs, lists, fenced code,
 * inline code, bold, italics). Renders React nodes only — never HTML — so
 * agent output cannot inject markup.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("`"))
      out.push(
        <code key={key} className="rounded-[4px] border border-border bg-surface-2 px-1 py-px font-mono text-[0.86em] text-fg">
          {token.slice(1, -1)}
        </code>,
      );
    else if (token.startsWith("**")) out.push(<strong key={key} className="font-semibold text-fg">{token.slice(2, -2)}</strong>);
    else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { type: "p"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "code"; lang?: string; code: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^```(\S*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push({ type: "code", lang: fence[1] || undefined, code: code.join("\n") });
      continue;
    }
    if (/^\s*[-*] /.test(line) || /^\s*\d+\. /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\. /.test(lines[i]!) : /^\s*[-*] /.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^\s*(?:[-*]|\d+\.) /, ""));
        i++;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^```/.test(lines[i]!) && !/^\s*(?:[-*]|\d+\.) /.test(lines[i]!)) {
      para.push(lines[i++]!);
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

export function Markdown({ source, className, trailing }: { source: string; className?: string; trailing?: ReactNode }) {
  const blocks = parse(source);
  return (
    <div className={cn("space-y-2.5 text-base leading-relaxed text-fg/90", className)}>
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        const tail = isLast ? trailing : null;
        if (block.type === "code")
          return (
            <Fragment key={index}>
              <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-fg">
                <code>{block.code}</code>
              </pre>
              {tail}
            </Fragment>
          );
        if (block.type === "p")
          return (
            <p key={index}>
              {inline(block.text, `p${index}`)}
              {tail}
            </p>
          );
        const List = block.type;
        return (
          <List key={index} className={cn("space-y-1 pl-5", List === "ul" ? "list-disc marker:text-fg-subtle" : "list-decimal marker:text-fg-subtle")}>
            {block.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                {inline(item, `l${index}-${j}`)}
                {isLast && j === block.items.length - 1 ? tail : null}
              </li>
            ))}
          </List>
        );
      })}
      {blocks.length === 0 ? trailing : null}
    </div>
  );
}