// Bundles the runtime and its workspace packages into one ESM file that the
// desktop app ships as a resource and runs with the user's Node.js (>= 22.13).
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist-bundle', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist-bundle/agentic-hub-runtime.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // The Claude Agent SDK's optional per-platform CLI binaries are not bundled:
  // the adapter drives the user's own signed-in `claude` executable instead.
  external: ['@anthropic-ai/claude-agent-sdk-*'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
