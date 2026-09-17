import {
  ensureProjectGitignore,
  getSiteglideGitignoreStatus,
  SITEGLIDE_METADATA_GITIGNORE_REASON,
  SITEGLIDE_USER_GITIGNORE_ENTRY,
  SITEGLIDE_PROJECT_GITIGNORE_PROBE
} from './gitignoreEnsure.js';
import { runCommand } from './runCommand.js';

const GIT_PROBE_TIMEOUT_MS = 5000;
const GH_PROBE_TIMEOUT_MS = 8000;

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
  const run = (bin, args, timeoutMs = GIT_PROBE_TIMEOUT_MS) => {
    return runCommand(bin, args, { cwd, timeoutMs });
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

  const gh = run('gh', ['auth', 'status'], GH_PROBE_TIMEOUT_MS);
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
    const gitignoreStatus = getSiteglideGitignoreStatus(cwd, run);
    siteglideMetadataGitignore = {
      recommended: true,
      userEntry: SITEGLIDE_USER_GITIGNORE_ENTRY,
      projectEntry: '.siteglide/project/',
      ignored: gitignoreStatus.userIgnored,
      userIgnored: gitignoreStatus.userIgnored,
      projectIgnored: gitignoreStatus.projectIgnored,
      overBroad: gitignoreStatus.overBroad,
      reason: SITEGLIDE_METADATA_GITIGNORE_REASON,
      actionNeeded: !gitignoreStatus.userIgnored || gitignoreStatus.overBroad,
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
    'Ensure .gitignore lists `.siteglide/user/` (local CLI runtime — sync, locks, preferences; not for remotes) and `.siteglide-config` (secrets). ' +
    'Do not gitignore the whole `.siteglide/` directory — `.siteglide/project/` (for example modules.json) should be committed with the team. ' +
    'If `.siteglide/user/` is still tracked after updating .gitignore, run `git rm -r --cached .siteglide/user/` and commit. ' +
    'If `.gitignore` currently lists `.siteglide/`, replace it with `.siteglide/user/` so project settings stay shareable.';

  const initialCommitGuidance =
    'After git init (or when the repo has no commits yet), unless the user explicitly opts out: ' +
    'confirm .gitignore lists `.siteglide/user/` and `.siteglide-config`, then git add all working-tree files ' +
    '(respect .gitignore; never force-add .siteglide-config / secrets; allow `.siteglide/project/` to be committed), ' +
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
    guidance = 'Git is ready. Use sync_status when checking whether siteglide-cli sync is active.';
    if (siteglideMetadataGitignore?.actionNeeded) {
      guidance +=
        ' Recommend gitignoring `.siteglide/user/` only (see siteglideMetadataGitignore.reason). ' +
        siteglideGitignoreGuidance;
      if (siteglideMetadataGitignore.overBroad) {
        guidance +=
          ` Replace any broad \`.siteglide/\` gitignore entry with \`${SITEGLIDE_USER_GITIGNORE_ENTRY}\` so \`${SITEGLIDE_PROJECT_GITIGNORE_PROBE}\` can stay tracked.`;
      }
    }
  }

  return {
    installed,
    identityConfigured,
    repoInitialized,
    remotes,
    ghAuthenticated: gh.timedOut ? false : gh.ok,
    ghProbe: gh.timedOut || gh.errorCode
      ? {
          ok: gh.ok,
          timedOut: gh.timedOut,
          errorCode: gh.errorCode,
          note: gh.timedOut
            ? 'gh auth status exceeded the MCP timeout — GitHub CLI may be waiting on network or credentials. Git checks above are still valid.'
            : gh.errorCode === 'ENOENT'
              ? 'GitHub CLI (gh) is not installed.'
              : undefined
        }
      : undefined,
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
