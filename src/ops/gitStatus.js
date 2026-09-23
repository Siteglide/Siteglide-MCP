import {
  ensureProjectGitignore,
  getSiteglideGitignoreStatus,
  SITEGLIDE_METADATA_GITIGNORE_REASON,
  SITEGLIDE_USER_GITIGNORE_ENTRY,
  SITEGLIDE_PROJECT_GITIGNORE_PROBE
} from './gitignoreEnsure.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from './runCommand.js';

const GIT_PROBE_TIMEOUT_MS = 5000;
const GH_PROBE_TIMEOUT_MS = 8000;

/**
 * Shown when git is not ready — agent should present this once per chat, then ask if they want setup help.
 */
const PULL_BASELINE_GUIDANCE =
  'When git is ready but lastPullCommit is missing for an environment, run siteglide-cli pull <env> and choose Pull and merge to seed the merge-first baseline before relying on sync/deploy remote checks.';

/**
 * Call audience before git setup or explanations so language matches the user's experience.
 */
export const GIT_AUDIENCE_GUIDANCE =
  'Before explaining git or running guided setup, call the Siteglide MCP audience tool if target_audience is incomplete. ' +
  'Follow languageGuidance from audience (especially target_audience.git) to choose how much technical language to use and whether to define terms such as repo, remote, commit, merge, branch, stash, and PR.';

/**
 * Shown when git is ready locally but no remote is configured (or during setup wizard).
 */
/**
 * When MERGE_HEAD is present or git reports unmerged paths (merge-first pull/deploy/sync).
 */
export const MERGE_CONFLICT_RESOLUTION_GUIDANCE =
  'Merge conflict in progress: resolve conflict markers, explain the result, and get explicit user verbal approval before git add on any file. ' +
  'Do not git commit — siteglide-cli polls git and auto-commits the merge when every resolved file is staged and no unmerged paths remain. ' +
  'On sync, upload resumes automatically after the CLI finishes the merge.';

export const REMOTE_SETUP_GUIDANCE =
  'If the user opts into connecting a GitHub remote, elicit before acting: ' +
  '(a) which organisation or personal account, (b) new vs existing repo ' +
  '(new / existing-empty / existing-with-commits), (c) public or private. ' +
  'For existing remotes that already have commits while local Siteglide code exists: ' +
  'commit local work first, add remote, fetch, then merge with --allow-unrelated-histories; ' +
  'explain conflicts and never force-push without explicit consent. ' +
  'If the existing remote looks like a different full project, warn and confirm before merging. ' +
  'When connecting a remote for team work with the site as source of truth, recommend working on a feature branch (not main/master) so each developer can pull, sync, and deploy at their own pace without blocking the shared default branch. ' +
  'Root-level repo files (e.g. package.json, lockfiles, .gitignore, .siteglide/project/) are shared through git only: collaborators see those changes after a PR into main/master is merged and they pull that branch — not via Siteglide pull/sync/deploy alone.';

/**
 * @param {string} projectDir
 * @returns {Array<{ environment: string, lastPullCommit?: string | null, lastPulledAt?: string | null }>}
 */
export function listPullBaselines(projectDir) {
  const pullDir = join(projectDir, '.siteglide', 'user', 'pull');
  if (!existsSync(pullDir)) {
    return [];
  }
  const baselines = [];
  for (const name of readdirSync(pullDir)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const environment = name.replace(/\.json$/, '');
    try {
      const data = JSON.parse(readFileSync(join(pullDir, name), 'utf8'));
      baselines.push({
        environment,
        lastPullCommit: data.lastPullCommit || null,
        lastPulledAt: data.lastPulledAt || null
      });
    } catch {
      // skip invalid
    }
  }
  return baselines;
}

/**
 * @param {string} projectDir
 * @param {string} [environment]
 */
export function getPullBaselineStatus(projectDir, environment) {
  const baselines = listPullBaselines(projectDir);
  if (environment) {
    const match = baselines.find((entry) => entry.environment === environment);
    return {
      environment,
      hasBaseline: Boolean(match),
      lastPullCommit: match?.lastPullCommit ?? null,
      lastPulledAt: match?.lastPulledAt ?? null,
      needsPullBaseline: !match?.lastPullCommit
    };
  }
  return {
    baselines,
    needsPullBaseline: baselines.length === 0 || baselines.some((entry) => !entry.lastPullCommit)
  };
}

export const GIT_SETUP_OFFER_MESSAGE =
  'Siteglide strongly recommends using git alongside the siteglide-cli in order to unlock the full suite of tools and safety guardrails. ' +
  'Git is an open-source version-control system whereas Github is a commercial platform which hosts *remote* versions of your git projects in the cloud allowing for better collaboration in your team and reliable backups.';

/**
 * @param {string} projectDir
 * @param {(bin: string, args: string[]) => { ok: boolean, stdout: string }} run
 */
function getMergeConflictStatus(projectDir, run) {
  const mergeInProgress = existsSync(join(projectDir, '.git', 'MERGE_HEAD'));
  let unmergedPaths = [];
  const unmerged = run('git', ['diff', '--name-only', '--diff-filter=U']);
  if (unmerged.ok && unmerged.stdout) {
    unmergedPaths = unmerged.stdout.split(/\r?\n/).filter(Boolean);
  }
  const open = mergeInProgress || unmergedPaths.length > 0;
  return {
    open,
    mergeInProgress,
    unmergedPaths
  };
}

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

  const remoteSetupGuidance = REMOTE_SETUP_GUIDANCE;

  const withAudienceGuidance = (text) => `${GIT_AUDIENCE_GUIDANCE} ${text}`;

  let guidance;
  let setupOffer;
  if (needsSetupWizard) {
    setupOffer = {
      askOncePerChat: true,
      message: GIT_SETUP_OFFER_MESSAGE,
      question: 'Would you like help setting up git for this project?'
    };
    guidance = withAudienceGuidance(
      'Git is not fully set up. At most ONCE per unique chat, present setupOffer.message to the user, ' +
        'then ask setupOffer.question (MCP elicitation when available). ' +
        'Do not re-ask later in the same chat if already offered, accepted, or declined. ' +
        'If they accept: install git if needed, set user.name/email, git init. ' +
        siteglideGitignoreGuidance +
        ' ' +
        initialCommitGuidance +
        ' Remote/GitHub is optional and comes after the initial commit. ' +
        remoteSetupGuidance
    );
  } else if (remotes.length === 0) {
    guidance = withAudienceGuidance(
      'Git is ready locally. Offering a GitHub remote remains optional. ' +
        siteglideGitignoreGuidance +
        ' If this repo still has no commits, follow: ' +
        initialCommitGuidance +
        ' ' +
        remoteSetupGuidance
    );
  } else {
    guidance = withAudienceGuidance(
      'Git is ready. Use sync_status when checking whether siteglide-cli sync is active.'
    );
    const pullBaseline = getPullBaselineStatus(cwd);
    if (pullBaseline.needsPullBaseline) {
      guidance += ` ${PULL_BASELINE_GUIDANCE}`;
    }
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

  const pullBaseline = repoInitialized ? getPullBaselineStatus(cwd) : undefined;
  const pullBaselineGuidance =
    repoInitialized && pullBaseline?.needsPullBaseline ? PULL_BASELINE_GUIDANCE : undefined;

  const mergeConflict = repoInitialized ? getMergeConflictStatus(cwd, run) : { open: false, mergeInProgress: false, unmergedPaths: [] };
  const mergeResolutionGuidance = mergeConflict.open ? MERGE_CONFLICT_RESOLUTION_GUIDANCE : undefined;
  if (mergeConflict.open) {
    guidance = `${MERGE_CONFLICT_RESOLUTION_GUIDANCE} ${guidance}`;
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
    audienceGuidance: GIT_AUDIENCE_GUIDANCE,
    mergeConflict: mergeConflict.open
      ? {
          open: true,
          mergeInProgress: mergeConflict.mergeInProgress,
          unmergedPaths: mergeConflict.unmergedPaths
        }
      : undefined,
    mergeResolutionGuidance,
    pullBaseline,
    needsPullBaseline: pullBaseline?.needsPullBaseline,
    pullBaselineGuidance,
    setupOffer,
    gitignore,
    siteglideMetadataGitignore,
    initialCommitGuidance: needsSetupWizard || remotes.length === 0 ? initialCommitGuidance : undefined,
    remoteSetupGuidance: remotes.length === 0 || needsSetupWizard ? remoteSetupGuidance : undefined
  };
}
