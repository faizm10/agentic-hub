#!/usr/bin/env node
// Keeps the app version identical everywhere it is declared.
//   node scripts/version.mjs              print the current version
//   node scripts/version.mjs check [tag]  fail if files disagree (or differ from a vX.Y.Z tag)
//   node scripts/version.mjs set 0.4.0    write a new semantic version to every file
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/** Each target reads and writes one version occurrence. */
const targets = [
  ...['apps/desktop/package.json', 'apps/runtime/package.json', 'apps/web/package.json'].map(file => ({
    file,
    pattern: /("version":\s*")([^"]+)(")/,
  })),
  { file: 'apps/desktop/src-tauri/Cargo.toml', pattern: /(^\[package\][\s\S]*?^version = ")([^"]+)(")/m },
  { file: 'apps/runtime/src/control-plane.ts', pattern: /(export const RUNTIME_VERSION = ')([^']+)(')/ },
];

const read = target => {
  const match = target.pattern.exec(readFileSync(join(root, target.file), 'utf8'));
  if (!match) throw new Error(`No version found in ${target.file}`);
  return match[2];
};

const [command = 'print', arg] = process.argv.slice(2);
const versions = targets.map(target => [target.file, read(target)]);
const current = versions[0][1];

if (command === 'print') {
  console.log(current);
} else if (command === 'check') {
  const expected = arg ? arg.replace(/^v/, '') : current;
  const wrong = versions.filter(([, version]) => version !== expected);
  if (!SEMVER.test(expected)) { console.error(`"${expected}" is not a semantic version (X.Y.Z).`); process.exit(1); }
  if (wrong.length) {
    for (const [file, version] of wrong) console.error(`${file}: ${version} (expected ${expected})`);
    console.error('Run `node scripts/version.mjs set <version>` to sync them.');
    process.exit(1);
  }
  console.log(`All version files are at ${expected}.`);
} else if (command === 'set') {
  if (!arg || !SEMVER.test(arg)) { console.error('Usage: node scripts/version.mjs set X.Y.Z'); process.exit(1); }
  for (const target of targets) {
    const path = join(root, target.file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(target.pattern, `$1${arg}$3`));
  }
  console.log(`Set version ${arg} in ${targets.length} files. tauri.conf.json reads apps/desktop/package.json.`);
} else {
  console.error(`Unknown command "${command}".`);
  process.exit(1);
}
