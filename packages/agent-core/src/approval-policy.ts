import type { ApprovalPolicy, ApprovalRisk } from '@agentic-hub/types';

export interface RiskAssessment { risk: ApprovalRisk; reasons: string[] }

/** Tools that only read. Providers usually don't ask for these, but some do. */
const READ_ONLY_TOOLS = new Set(['read', 'glob', 'grep', 'ls', 'notebookread', 'todowrite', 'todoread']);
const FILE_EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'filechange', 'apply_patch', 'applypatch']);
const COMMAND_TOOLS = new Set(['bash', 'commandexecution', 'shell', 'exec', 'run_command', 'execute']);

/** Commands that only inspect or build locally. Matched as whole-word prefixes. */
export const SAFE_COMMAND_PREFIXES = [
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'which', 'file', 'stat', 'tree', 'find', 'grep', 'rg', 'ag', 'diff',
  'git status', 'git diff', 'git log', 'git show', 'git branch', 'git rev-parse', 'git blame', 'git ls-files', 'git remote -v',
  'node --version', 'node -v', 'npm --version', 'pnpm --version',
  'pnpm test', 'pnpm lint', 'pnpm typecheck', 'pnpm build', 'pnpm run test', 'pnpm run lint', 'pnpm run typecheck', 'pnpm run build',
  'npm test', 'npm run test', 'npm run lint', 'npm run typecheck', 'npm run build',
  'yarn test', 'yarn lint', 'yarn build', 'bun test',
  'tsc', 'npx tsc', 'pnpm exec tsc', 'vitest', 'npx vitest', 'pnpm vitest', 'jest', 'npx jest', 'eslint', 'npx eslint', 'prettier --check',
  'cargo check', 'cargo test', 'cargo build', 'cargo clippy', 'cargo fmt --check', 'go test', 'go build', 'go vet', 'pytest', 'python -m pytest',
];

/** Patterns that always need a human, whatever the policy says. */
const HIGH_RISK: [RegExp, string][] = [
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, 'Deletes files recursively or forcibly'],
  [/\b(sudo|doas|su)\b/, 'Runs with elevated privileges'],
  [/\bgit\s+push\b/, 'Pushes to a remote'],
  [/--force\b|\s-f\b.*\bpush\b|\bpush\b.*\s-f\b|--force-with-lease/, 'Force operation'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|branch\s+-D|filter-branch|filter-repo)/, 'Discards Git history or local work'],
  [/\b(vercel|netlify|fly|railway|heroku|firebase|wrangler)\b[^|;&]*\b(deploy|--prod|publish|promote)\b|\bvercel\s+--prod\b/, 'Deploys an application'],
  [/--prod(uction)?\b|\bproduction\b/i, 'Targets production'],
  [/\b(npm|pnpm|yarn|cargo|gem|twine|poetry)\s+publish\b/, 'Publishes a package'],
  [/\b(chmod|chown|chgrp|setfacl|icacls)\b/, 'Changes file permissions or ownership'],
  [/\b(gh\s+(secret|auth|repo\s+delete|api\s+-X\s*(DELETE|PUT|PATCH))|vercel\s+env|aws\s+iam|gcloud\s+iam)\b/i, 'Changes credentials, secrets or permissions'],
  [/(^|[\s/'"])(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|\.pgpass|id_rsa|id_ed25519|\.ssh\/|\.aws\/|\.kube\/config|credentials(\.json)?|secrets?\.(json|ya?ml|toml))(\s|$|['"])/i, 'Touches secrets or credentials'],
  [/\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh|python|node)\b/, 'Pipes a download into a shell'],
  [/\b(mkfs|dd\s+if=|diskutil\s+erase|shutdown|reboot|killall|launchctl)\b/, 'System-level operation'],
  [/\b(drop\s+(table|database|schema)|truncate\s+table|delete\s+from)\b/i, 'Destructive database statement'],
  [/\b(kubectl|terraform|pulumi)\s+(apply|delete|destroy|up)\b/, 'Changes infrastructure'],
  [/\.github\/workflows\//, 'Changes CI workflows'],
];

const SHELL_META = /[;&|`$<>]|\$\(/;

function detailOf(description: string): string {
  const index = description.lastIndexOf(' — ');
  return (index >= 0 ? description.slice(index + 3) : description).trim();
}

function matchesPrefix(command: string, prefix: string): boolean {
  const p = prefix.trim();
  return command === p || command.startsWith(`${p} `);
}

/** Scores one approval request. Unknown tools and commands are medium, never low. */
export function assessApproval(toolName: string, description: string, options: { trustedCommands?: string[]; cwd?: string } = {}): RiskAssessment {
  const tool = toolName.toLowerCase();
  const detail = detailOf(description);
  const text = `${description}\n${detail}`;
  const reasons = HIGH_RISK.filter(([pattern]) => pattern.test(text)).map(([, reason]) => reason);
  if (reasons.length) return { risk: 'high', reasons: [...new Set(reasons)] };
  if (READ_ONLY_TOOLS.has(tool)) return { risk: 'low', reasons: ['Read-only tool'] };
  if (FILE_EDIT_TOOLS.has(tool)) {
    const root = options.cwd?.replace(/\/+$/, '');
    const inside = !detail.includes('..') && !detail.startsWith('~') && (!detail.startsWith('/') || Boolean(root && detail.startsWith(`${root}/`)));
    if (!inside) return { risk: 'medium', reasons: ['Edits a file that may be outside the workspace'] };
    return { risk: 'low', reasons: ['Edits files in the workspace'] };
  }
  if (COMMAND_TOOLS.has(tool)) {
    const command = detail.replace(/\s+/g, ' ');
    if (!command || SHELL_META.test(command)) return { risk: 'medium', reasons: ['Compound or unparsed shell command'] };
    const trusted = [...SAFE_COMMAND_PREFIXES, ...(options.trustedCommands ?? [])].some(prefix => matchesPrefix(command, prefix));
    return trusted ? { risk: 'low', reasons: ['Trusted command'] } : { risk: 'medium', reasons: ['Command is not in the trusted list'] };
  }
  return { risk: 'medium', reasons: ['Tool is not classified as low risk'] };
}

/** Whether the policy may answer this request without the user. High risk never qualifies. */
export function shouldAutoApprove(policy: ApprovalPolicy, toolName: string, assessment: RiskAssessment): boolean {
  if (policy.mode !== 'trusted' || assessment.risk !== 'low') return false;
  if (FILE_EDIT_TOOLS.has(toolName.toLowerCase())) return policy.autoApproveFileEdits;
  return true;
}
