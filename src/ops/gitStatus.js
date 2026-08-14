import { spawnSync } from 'node:child_process';
import {
  ensureProjectGitignore,
  isSiteglideDirGitignored,
  SITEGLIDE_METADATA_GITIGNORE_REASON
} from './gitignoreEnsure.js';

/**
 * Shown when git is not ready — agent should present this once per chat, then ask if they want setup help.
 */
export const GIT_SETUP_OFFER_MESSAGE =
  'Siteglide strongly recommends using git alongside the siteglide-cli in order to unlock the full suite of tools and safety guardrails. ' +
  'Git is an open-source version-control system whereas Github is a commercial platform which hosts *remote* versions of your git projects in the cloud allowing for better collaboration in your team and reliable backups.';

/**
 * Git readiness probe for MCP wizards (no secrets).
 * @param {{ projectDir: string }} opts
 */
export function getGitStatus(opts) {
  const cwd = opts.projectDir;
  const run = (bin, args) => {
    const res = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true });
    return {
      ok: res.status === 0,
      stdout: (res.stdout || '').trim(),
      stderr: (res.stderr || '').trim()
    };
  };

  const ver = run('git', ['--version']);
  const installed = ver.ok;
  const name = installed ? run('git', ['config', 'user.name']) : { ok: false, stdout: '' };
  const email = installed ? run('git', ['config', 'user.email']) : { ok: false, stdout: '' };
  const identityConfigured = !!(name.stdout && email.stdout);
  const inside = installed
    ? run('git', ['rev-parse', '--is-inside-work-tree'])
    : { ok: false, stdout: '' };
  const repoInitialized = inside.ok && inside.stdout === 'true';

  let remotes = [];
  if (repoInitialized) {
    const remoteOut = run('git', ['remote', '-v']);
    if (remoteOut.ok && remoteOut.stdout) {
      remotes = [
        ...new Set(
          remoteOut.stdout
            .split(/\r?\n/)
            .map((line) => line.split(/\s+/)[0])
            .filter(Boolean)
        )
      ];
    }
  }

  const gh = run('gh', ['auth', 'status']);
  const missing = [];
  if (!installed) {
    missing.push('installed');
  }
  if (installed && !identityConfigured) {
    missing.push('identity');
  }
  if (installed && !repoInitialized) {
    missing.push('repoInitialized');
  }

  const needsSetupWizard = missing.length > 0;

  let gitignore = null;
  if (needsSetupWizard || repoInitialized) {
    gitignore = ensureProjectGitignore(cwd);
  }

  let siteglideMetadataGitignore;
  if (repoInitialized) {
    const ignored = isSiteglideDirGitignored(cwd, run);
    siteglideMetadataGitignore = {
      recommended: true,
      entry: '.siteglide/',
      ignored,
      reason: SITEGLIDE_METADATA_GITIGNORE_REASON,
      actionNeeded: !ignored,
      gitignoreEnsure: gitignore
        ? {
            path: gitignore.path,
            added: gitignore.added,
            alreadyPresent: gitignore.alreadyPresent,
            created: gitignore.created
          }
        : undefined
    };
  }

  const siteglideGitignoreGuidance =
    'Ensure .gitignore lists `.siteglide/` (local CLI metadata — updated during sync, deploy, and pull; not for remotes). ' +
    'Also list `.siteglide-config` (secrets). If .siteglide/ is still tracked after updating .gitignore, run ' +
    '`git rm -r --cached .siteglide/` and commit.';

  const initialCommitGuidance =
    'After git init (or when the repo has no commits yet), unless the user explicitly opts out: ' +
    'confirm .gitignore lists .siteglide/ (covers project-preferences.json and other local CLI state) and .siteglide-config, ' +
    'then git add all working-tree files (respect .gitignore; never force-add .siteglide-config / secrets), ' +
    'then commit with message exactly "initial commit". ' +
    'Do this BEFORE any optional remote/GitHub connect steps.';

  const remoteSetupGuidance =
    'If the user opts into connecting a GitHub remote, elicit before acting: ' +
    '(a) which organisation or personal account, (b) new vs existing repo ' +
    '(new / existing-empty / existing-with-commits), (c) public or private. ' +
    'For existing remotes that already have commits while local Siteglide code exists: ' +
    'commit local work first, add remote, fetch, then merge with --allow-unrelated-histories; ' +
    'explain conflicts and never force-push without explicit consent. ' +
    'If the existing remote looks like a different full project, warn and confirm before merging.';

  let guidance;
  let setupOffer;
  if (needsSetupWizard) {
    setupOffer = {
      askOncePerChat: true,
      message: GIT_SETUP_OFFER_MESSAGE,
      question: 'Would you like help setting up git for this project?'
    };
    guidance =
      'Git is not fully set up. At most ONCE per unique chat, present setupOffer.message to the user, ' +
      'then ask setupOffer.question (MCP elicitation when available). ' +
      'Do not re-ask later in the same chat if already offered, accepted, or declined. ' +
      'If they accept: install git if needed, set user.name/email, git init. ' +
      siteglideGitignoreGuidance +
      ' ' +
      initialCommitGuidance +
      ' Remote/GitHub is optional and comes after the initial commit. ' +
      remoteSetupGuidance;
  } else if (remotes.length === 0) {
    guidance =
      'Git is ready locally. Offering a GitHub remote remains optional. ' +
      siteglideGitignoreGuidance +
      ' If this repo still has no commits, follow: ' +
      initialCommitGuidance +
      ' ' +
      remoteSetupGuidance;
  } else {
    guidance = 'Git is ready. Prefer remote_check_status when sync/deploy conflicts are mentioned.';
    if (siteglideMetadataGitignore?.actionNeeded) {
      guidance +=
        ' Recommend gitignoring .siteglide/ (see siteglideMetadataGitignore.reason). ' +
        siteglideGitignoreGuidance;
    }
  }

  return {
    installed,
    identityConfigured,
    repoInitialized,
    remotes,
    ghAuthenticated: gh.ok,
    missing,
    needsSetupWizard,
    version: installed ? ver.stdout : undefined,
    userName: name.stdout || undefined,
    userEmail: email.stdout || undefined,
    guidance,
    setupOffer,
    gitignore,
    siteglideMetadataGitignore,
    initialCommitGuidance: needsSetupWizard || remotes.length === 0 ? initialCommitGuidance : undefined,
    remoteSetupGuidance: remotes.length === 0 || needsSetupWizard ? remoteSetupGuidance : undefined
  };
}
