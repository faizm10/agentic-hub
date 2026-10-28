import { lstat, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { HubError } from '@agentic-hub/agent-core';
import { statusOf } from '@agentic-hub/git';
import type { FileContent, FileEntry } from '@agentic-hub/types';

const MAX_READ = 2_000_000;
const HIDDEN = new Set(['.git', 'node_modules', '.next', '.turbo', 'dist', 'target', '.DS_Store', '.vercel', '.cache', 'coverage']);

const LANGUAGES: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.md': 'markdown', '.mdx': 'markdown', '.css': 'css', '.scss': 'scss', '.less': 'less', '.html': 'html', '.vue': 'html', '.svelte': 'html',
  '.rs': 'rust', '.go': 'go', '.py': 'python', '.rb': 'ruby', '.java': 'java', '.kt': 'kotlin', '.swift': 'swift', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cs': 'csharp',
  '.sh': 'shell', '.zsh': 'shell', '.bash': 'shell', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'ini', '.ini': 'ini', '.sql': 'sql', '.xml': 'xml', '.svg': 'xml', '.php': 'php',
  '.graphql': 'graphql', '.dockerfile': 'dockerfile',
};

export function languageOf(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  return LANGUAGES[extname(name)] ?? 'plaintext';
}

/**
 * Resolves a workspace-relative path and refuses anything that escapes the
 * root, including through symlinks. `mustExist: false` allows a new file whose
 * parent directory exists inside the root.
 */
export async function resolveInside(root: string, path: string, mustExist = true): Promise<string> {
  if (!path || isAbsolute(path) || path.includes('\0')) throw new HubError('VALIDATION_ERROR', 400, 'Use a path relative to the repository');
  const canonicalRoot = await realpath(root);
  const target = join(canonicalRoot, path);
  const rel = relative(canonicalRoot, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new HubError('VALIDATION_ERROR', 400, 'Path is outside the repository');
  if (rel.split(sep)[0] === '.git') throw new HubError('VALIDATION_ERROR', 400, 'The .git directory is not editable here');
  let real: string;
  try { real = await realpath(target); }
  catch {
    if (mustExist) throw new HubError('NOT_FOUND', 404, 'File not found');
    real = join(await realpath(join(target, '..')).catch(() => { throw new HubError('NOT_FOUND', 404, 'Folder not found'); }), basename(target));
  }
  const realRel = relative(canonicalRoot, real);
  if (realRel.startsWith('..') || isAbsolute(realRel)) throw new HubError('VALIDATION_ERROR', 400, 'Path resolves outside the repository');
  return real;
}

export async function listDirectory(root: string, path: string): Promise<FileEntry[]> {
  const dir = path ? await resolveInside(root, path) : await realpath(root);
  if (!(await stat(dir)).isDirectory()) throw new HubError('VALIDATION_ERROR', 400, 'Not a folder');
  const changed = new Set((await statusOf(root).catch(() => [])).map(file => file.path));
  const base = relative(await realpath(root), dir);
  const entries = await readdir(dir, { withFileTypes: true });
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (HIDDEN.has(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await stat(join(dir, entry.name)).then(s => s.isDirectory(), () => false)));
    const size = isDir ? null : await lstat(join(dir, entry.name)).then(s => s.size, () => null);
    result.push({ name: entry.name, path: rel, type: isDir ? 'directory' : 'file', size, changed: isDir ? [...changed].some(p => p.startsWith(`${rel}/`)) : changed.has(rel) });
  }
  return result.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
}

export async function readWorkspaceFile(root: string, path: string): Promise<FileContent> {
  const file = await resolveInside(root, path);
  const info = await stat(file);
  if (!info.isFile()) throw new HubError('VALIDATION_ERROR', 400, 'Not a file');
  const buffer = await readFile(file);
  const head = buffer.subarray(0, 8_000);
  const binary = head.includes(0);
  const truncated = buffer.length > MAX_READ;
  return { path, size: info.size, binary, truncated, language: languageOf(path), content: binary ? '' : buffer.subarray(0, MAX_READ).toString('utf8') };
}

/** Writes atomically (temp file + rename) so an editor save never leaves half a file. */
export async function writeWorkspaceFile(root: string, path: string, content: string): Promise<FileContent> {
  const file = await resolveInside(root, path, false);
  const existing = await stat(file).catch(() => null);
  if (existing && !existing.isFile()) throw new HubError('VALIDATION_ERROR', 400, 'Not a file');
  const temp = `${file}.agentic-hub-${process.pid}.tmp`;
  await writeFile(temp, content, { mode: existing ? existing.mode & 0o777 : 0o644 });
  await rename(temp, file);
  return readWorkspaceFile(root, path);
}
