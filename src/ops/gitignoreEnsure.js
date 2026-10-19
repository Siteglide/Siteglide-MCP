import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Lines git_status setup must keep in the project .gitignore. */
export const GITIGNORE_ENSURE_LINES = ['.siteglide/user/', '.siteglide-config'];

export const SITEGLIDE_USER_GITIGNORE_ENTRY = '.siteglide/user/';
export const SITEGLIDE_PROJECT_GITIGNORE_PROBE = '.siteglide/project/modules.json';

/** Why agents should keep `.siteglide/user/` out of git remotes. */
export const SITEGLIDE_METADATA_GITIGNORE_REASON =
  'The `.siteglide/user/` folder holds local-only CLI state (sync status, locks, AI preferences). ' +
  'It changes during sync, deploy, and pull and should not be shared in a remote repository. ' +
  '`.siteglide/project/` (for example modules.json) is team-shareable — gitignore `.siteglide/user/` only, not the whole `.siteglide/` directory.';

/**
 * @param {(bin: string, args: string[]) => { ok: boolean }} runGit
 * @param {string} relativePath
 * @returns {boolean}
 */
function isPathGitignored(runGit, relativePath) {
  const res = runGit('git', ['check-ignore', '-q', '--', relativePath]);
  return res.ok;
}

/**
 * @param {string} projectDir
 * @param {(bin: string, args: string[]) => { ok: boolean }} runGit
 * @returns {{ userIgnored: boolean, projectIgnored: boolean, overBroad: boolean }}
 */
export function getSiteglideGitignoreStatus(projectDir, runGit) {
  const userIgnored =
    isPathGitignored(runGit, '.siteglide/user') ||
    isPathGitignored(runGit, '.siteglide/user/');
  const projectIgnored = isPathGitignored(runGit, SITEGLIDE_PROJECT_GITIGNORE_PROBE);
  return {
    userIgnored,
    projectIgnored,
    overBroad: projectIgnored
  };
}

/**
 * Whether git currently ignores `.siteglide/user/`.
 * @param {string} projectDir
 * @param {(bin: string, args: string[]) => { ok: boolean }} runGit
 * @returns {boolean}
 */
export function isSiteglideDirGitignored(projectDir, runGit) {
  return getSiteglideGitignoreStatus(projectDir, runGit).userIgnored;
}

/**
 * @param {Set<string>} existing
 * @param {string} line
 * @returns {boolean}
 */
function gitignoreLineCovered(existing, line) {
  if (existing.has(line)) {
    return true;
  }
  if (line === '.siteglide/user/') {
    return (
      existing.has('.siteglide/user') ||
      existing.has('.siteglide/') ||
      existing.has('.siteglide')
    );
  }
  return false;
}

/**
 * Ensure Siteglide local/secret paths are listed in the project .gitignore.
 * Adds `.siteglide/user/` (not the whole `.siteglide/` tree).
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
    if (gitignoreLineCovered(existing, line)) {
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
