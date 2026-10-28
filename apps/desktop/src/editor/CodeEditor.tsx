import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "@agentic-hub/ui";
import { useEffect, useRef } from "react";
import "./monaco-setup";

export interface CodeEditorProps {
  path: string;
  value: string;
  language: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

/** Monaco with one model per file path, so undo history and cursor survive tab switches. */
export default function CodeEditor({ path, value, language, readOnly, onChange, onSave }: CodeEditorProps) {
  const { resolved } = useTheme();
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);
  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    editor.focus();
  };
  return (
    <Editor
      path={path}
      value={value}
      language={language}
      theme={resolved === "dark" ? "agentic-dark" : "agentic-light"}
      onChange={(next) => onChange(next ?? "")}
      onMount={onMount}
      loading={<div className="p-4 text-sm text-fg-muted">Loading editor…</div>}
      options={{
        readOnly,
        fontSize: 13,
        fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        renderLineHighlight: "line",
        padding: { top: 10 },
        tabSize: 2,
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        stickyScroll: { enabled: true },
      }}
    />
  );
}
