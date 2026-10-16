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
  'Call the Siteglide MCP audience tool (read-only) for languageGuidance before explaining git. ' +
  'Do not ask the user profile or help-mode questions — if audience.complete is false, suggest siteglide-cli pull or editing about-me.json.';

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

/** Agent-facing instruction: gitignore `.siteglide/user/` and everything under it. */
export const SITEGLIDE_USER_GITIGNORE_INSTRUCTION =
  'Ensure `.gitignore` lists `.siteglide/user/` so the entire folder and all files inside it are ignored (local CLI runtime — sync, locks, preferences; not for remotes). ' +
  'Also list `.siteglide-config` (secrets). ' +
  'Do not gitignore the whole `.siteglide/` directory — `.siteglide/project/` (for example modules.json) should be committed with the team. ' +
  'If anything under `.siteglide/user/` is still tracked after updating `.gitignore`, run `git rm -r --cached .siteglide/user/` and commit. ' +
  'If `.gitignore` currently lists `.siteglide/`, replace it with `.siteglide/user/` so project settings stay shareable.';

/** Written by siteglide-cli merge-first before it leaves the home branch (see lib/git/homeBranch.js). */
export const HOME_BRANCH_FILE = '.siteglide/user/git/home-branch.json';

/** Branch names siteglide-cli merge-first creates (see tempBranchNameForMode in lib/git/mergeFirst.js). */
export const TEMPORARY_BRANCH_PATTERNS = [
  /^temp-pull-from-/,
  /^siteglide-merge-deploy\//,
  /^siteglide-merge-sync\//
];

/** Mirrors OWNER_PID_MAX_AGE_MS in siteglide-cli: an older owner pid may belong to an unrelated process. */
const OWNER_PID_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const SNAPSHOT_COMMIT_PREFIX = 'siteglide: remote ';

export const GIT_STATUS_TOOL_DESCRIPTION =
  'Probe git install, user.name/user.email, repo init, remotes, optional gh auth, and pull baseline (lastPullCommit) for this project. ' +
  'When temporaryBranch.onTemporaryBranch is true, the user is stuck on a siteglide-cli "Pull and merge" temporary branch: follow temporaryBranch.rescueGuidance before anything else to return them to their home branch and finish or restart the merge. ' +
  'Call audience (read-only) for languageGuidance before explaining git. ' +
  'During git setup, always ensure `.gitignore` lists `.siteglide/user/` (entire folder and all files inside — local CLI runtime, not for remotes) and `.siteglide-config`; follow guidance, siteglideUserGitignoreInstruction, siteglideMetadataGitignore, and gitignoreEnsure in the tool result. ' +
  'If paths under `.siteglide/user/` are already tracked, untrack with `git rm -r --cached .siteglide/user/` before commit. Keep `.siteglide/project/` committable — do not gitignore all of `.siteglide/`. ' +
  'If needsSetupWizard is true, elicit whether the user wants guided setup (install git, identity, git init; remote optional). ' +
  'If needsPullBaseline is true after git is ready, guide the user to siteglide-cli pull <env> → Pull and merge. ' +
  'When mergeConflict.open is true (or the user asks to solve merge conflicts), follow mergeResolutionGuidance: user approval before git add; do not git commit — CLI auto-commits when staged. ' +
  'Specialize in setup and conflict recovery; CLI owns routine pull/deploy git prompts.';

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
 * @param {string} projectDir
 * @returns {object | null}
 */
export function readHomeBranchRecord(projectDir) {
  try {
    const data = JSON.parse(readFileSync(join(projectDir, ...HOME_BRANCH_FILE.split('/')), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} record
 * @returns {boolean}
 */
function isOwnerStillRunning(record) {
  const at = Date.parse(record.updatedAt || record.startedAt || '');
  if (Number.isNaN(at) || Date.now() - at > OWNER_PID_MAX_AGE_MS) {
    return false;
  }
  return isPidAlive(record.ownerPid);
}

/**
 * @param {(bin: string, args: string[]) => { ok: boolean, stdout: string }} run
 * @param {string} branch
 * @returns {boolean}
 */
function branchExists(run, branch) {
  return run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

/**
 * Agent-facing rescue steps for a user left on a merge-first temporary branch.
 * @param {{
 *   current: string,
 *   homeBranch: string | null,
 *   command: string,
 *   environment: string | null,
 *   phase: string | null,
 *   mergeStrategy: string | null,
 *   snapshotCommitted: boolean,
 *   cliStillRunning: boolean
 * }} info
 * @returns {string}
 */
export function buildTemporaryBranchRescueGuidance(info) {
  const env = info.environment || '<environment>';
  const home = info.homeBranch;
  const cliCommand = `siteglide-cli ${info.command} ${env}`;

  if (info.cliStillRunning) {
    return (
      `The user is on ${info.current}, a temporary branch that ${cliCommand} is still using for "Pull and merge" — that CLI process is still running. ` +
      'Do not switch branches, commit, or delete anything. Tell the user to wait for it to finish (or stop it with Ctrl+C in its terminal), then call git_status again.'
    );
  }

  const homeLabel = home || 'their home branch';
  const situation =
    `The user is on ${info.current}, a temporary branch that ${cliCommand} created for "Pull and merge". ` +
    `Their home branch (the branch they were working on) is ${home || 'not recorded'}. ` +
    `"Pull and merge" is meant to download the live site's files onto this temporary branch, commit them as a snapshot, switch back to ${homeLabel}, ` +
    'merge the snapshot in so any differences show up as normal git conflicts, and then delete the temporary branch. ' +
    'The user is not meant to stay here or do new work on it. Their own work is safe: it was committed on the home branch before this branch was created. ' +
    `Being here means the process stopped part-way (phase: ${info.phase || 'unknown'}). ` +
    'Explain this to the user in plain language (follow audience languageGuidance) and get their go-ahead before changing anything. ';

  const always =
    `Always: never force-push, never delete ${homeLabel}, and never delete the temporary branch before its snapshot has been merged or deliberately discarded. ` +
    'If a checkout is refused, stop and explain why rather than forcing it.';

  if (!home) {
    return (
      situation +
      `No home branch was recorded, so do not guess: use git reflog to find the branch that was checked out before ${info.current}, and confirm it with the user before switching. ` +
      'Then follow the matching steps below once the home branch is known: if the latest commit here is not a "siteglide: remote ..." snapshot, discard and re-run; otherwise merge it into the home branch. ' +
      always
    );
  }

  if (!info.snapshotCommitted) {
    return (
      situation +
      'The download did not finish (no snapshot commit), so do not merge this branch. ' +
      'With the user\'s approval, discard the partial download here (git reset --hard, then git clean -fd — never -x, which would delete ignored files such as .siteglide-config), ' +
      `then git checkout ${home} and git branch -D ${info.current}. ` +
      `Then ask the user to run ${cliCommand} again and choose "Pull and merge". ` +
      always
    );
  }

  const allowUnrelated = info.mergeStrategy === 'orphan' ? ' --allow-unrelated-histories' : '';
  return (
    situation +
    'The snapshot was committed, so finish what the CLI started: ' +
    `git checkout ${home}, then git merge --no-ff${allowUnrelated} ${info.current}. ` +
    'Resolve any conflicts using mergeResolutionGuidance — the user must approve each resolution before git add. ' +
    `Once the merge is committed, git branch -D ${info.current}. ` +
    `The CLI did not get to record the new pull baseline, so recommend running siteglide-cli pull ${env} once afterwards. ` +
    always
  );
}

/**
 * Whether the user is on (or left behind) a merge-first temporary branch.
 * @param {string} projectDir
 * @param {(bin: string, args: string[]) => { ok: boolean, stdout: string }} run
 */
export function getTemporaryBranchStatus(projectDir, run) {
  const head = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const current = head.ok && head.stdout && head.stdout !== 'HEAD' ? head.stdout : null;
  const record = readHomeBranchRecord(projectDir);
  const matchesRecord = Boolean(current && record && record.temporaryBranch === current);
  const onTemporaryBranch = Boolean(
    current && (matchesRecord || TEMPORARY_BRANCH_PATTERNS.some((pattern) => pattern.test(current)))
  );

  if (!onTemporaryBranch) {
    if (record) {
      const temporaryBranchStillExists = record.temporaryBranch ? branchExists(run, record.temporaryBranch) : false;
      return {
        onTemporaryBranch: false,
        current,
        homeBranch: record.homeBranch || null,
        temporaryBranch: record.temporaryBranch || null,
        temporaryBranchStillExists,
        stale: current === record.homeBranch && !temporaryBranchStillExists,
        homeBranchFile: HOME_BRANCH_FILE
      };
    }
    return { onTemporaryBranch: false, current };
  }

  const usable = matchesRecord ? record : null;
  const homeBranch = usable?.homeBranch || null;
  const lastSubject = run('git', ['log', '-1', '--format=%s']);
  const snapshotCommitted = lastSubject.ok && lastSubject.stdout.startsWith(SNAPSHOT_COMMIT_PREFIX);
  const porcelain = run('git', ['status', '--porcelain']);
  const info = {
    current,
    homeBranch,
    command: usable?.command || 'pull',
    environment: usable?.environment || null,
    phase: usable?.phase || null,
    mergeStrategy: usable?.mergeStrategy || null,
    snapshotCommitted,
    cliStillRunning: usable ? isOwnerStillRunning(usable) : false
  };

  return {
    onTemporaryBranch: true,
    ...info,
    homeBranchExists: homeBranch ? branchExists(run, homeBranch) : false,
    workingTreeDirty: porcelain.ok ? porcelain.stdout.length > 0 : null,
    homeBranchFile: HOME_BRANCH_FILE,
    rescueGuidance: buildTemporaryBranchRescueGuidance(info)
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

  const siteglideGitignoreGuidance = SITEGLIDE_USER_GITIGNORE_INSTRUCTION;

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
    } else if (repoInitialized) {
      guidance += ` ${siteglideGitignoreGuidance}`;
    }
  }

  const siteglideUserGitignoreInstruction =
    needsSetupWizard || repoInitialized ? SITEGLIDE_USER_GITIGNORE_INSTRUCTION : undefined;

  const pullBaseline = repoInitialized ? getPullBaselineStatus(cwd) : undefined;
  const pullBaselineGuidance =
    repoInitialized && pullBaseline?.needsPullBaseline ? PULL_BASELINE_GUIDANCE : undefined;

  const mergeConflict = repoInitialized ? getMergeConflictStatus(cwd, run) : { open: false, mergeInProgress: false, unmergedPaths: [] };
  const mergeResolutionGuidance = mergeConflict.open ? MERGE_CONFLICT_RESOLUTION_GUIDANCE : undefined;
  if (mergeConflict.open) {
    guidance = `${MERGE_CONFLICT_RESOLUTION_GUIDANCE} ${guidance}`;
  }

  const temporaryBranch = repoInitialized ? getTemporaryBranchStatus(cwd, run) : undefined;
  if (temporaryBranch?.onTemporaryBranch) {
    guidance = `${temporaryBranch.rescueGuidance} ${guidance}`;
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
    temporaryBranch,
    pullBaseline,
    needsPullBaseline: pullBaseline?.needsPullBaseline,
    pullBaselineGuidance,
    setupOffer,
    gitignore,
    siteglideMetadataGitignore,
    siteglideUserGitignoreInstruction,
    initialCommitGuidance: needsSetupWizard || remotes.length === 0 ? initialCommitGuidance : undefined,
    remoteSetupGuidance: remotes.length === 0 || needsSetupWizard ? remoteSetupGuidance : undefined
  };
}
