/**
 * Monaco from the app bundle, not a CDN: the desktop CSP only allows
 * `script-src 'self'`. Language workers are emitted by Vite as local files.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

// The editor shows single files without a project, so unresolved imports would be noise.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  defaults.setCompilerOptions({ jsx: monaco.typescript.JsxEmit.Preserve, target: monaco.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true });
}

monaco.editor.defineTheme("agentic-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#141416", "editorGutter.background": "#141416", "editor.lineHighlightBackground": "#1d1d21", "editorLineNumber.foreground": "#55555c" },
});
monaco.editor.defineTheme("agentic-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#fdfdfc", "editorGutter.background": "#fdfdfc", "editor.lineHighlightBackground": "#f3f3f1", "editorLineNumber.foreground": "#a6a6ac" },
});

loader.config({ monaco });

export { monaco };
