import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Lines git_status setup must keep in the project .gitignore. */
export const GITIGNORE_ENSURE_LINES = ['.siteglide/', '.siteglide-config'];

/** Why agents should keep `.siteglide/` out of git remotes. */
export const SITEGLIDE_METADATA_GITIGNORE_REASON =
  'The .siteglide/ folder tracks local CLI state (pull/deploy/sync baselines, conflict logs, preferences). ' +
  'It changes during sync, deploy, and pull operations and should not be shared in a remote repository — ' +
  'committing it can create false appearances of conflict.';

/**
 * Whether git currently ignores `.siteglide/` (via check-ignore rules).
 * @param {string} projectDir
 * @param {(bin: string, args: string[]) => { ok: boolean }} runGit
 * @returns {boolean}
 */
export function isSiteglideDirGitignored(projectDir, runGit) {
  for (const entry of ['.siteglide', '.siteglide/']) {
    const res = runGit('git', ['check-ignore', '-q', '--', entry]);
    if (res.ok) {
      return true;
    }
  }
  return false;
}

/**
 * Ensure Siteglide local/secret paths are listed in the project .gitignore.
 * Covers `.siteglide/project-preferences.json` via the `.siteglide/` directory entry.
 * @param {string} projectDir
 * @returns {{ path: string, added: string[], alreadyPresent: string[], created: boolean }}
 */
export function ensureProjectGitignore(projectDir) {
  const filePath = join(projectDir, '.gitignore');
  const created = !existsSync(filePath);
  let text = '';
  if (!created) {
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      text = '';
    }
  }

  const existing = new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const added = [];
  const alreadyPresent = [];
  const suffix = [];

  for (const line of GITIGNORE_ENSURE_LINES) {
    const covered =
      existing.has(line) ||
      (line === '.siteglide/' && existing.has('.siteglide'));
    if (covered) {
      alreadyPresent.push(line);
      continue;
    }
    added.push(line);
    suffix.push(line);
  }

  if (suffix.length) {
    let out = text;
    if (out.length && !out.endsWith('\n')) {
      out += '\n';
    }
    out += `${suffix.join('\n')}\n`;
    writeFileSync(filePath, out, 'utf8');
  }

  return { path: filePath, added, alreadyPresent, created: created && suffix.length > 0 };
}
