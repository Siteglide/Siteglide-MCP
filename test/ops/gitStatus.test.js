import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getGitStatus,
  getPullBaselineStatus,
  listPullBaselines,
  GIT_AUDIENCE_GUIDANCE,
  GIT_STATUS_TOOL_DESCRIPTION,
  MERGE_CONFLICT_RESOLUTION_GUIDANCE,
  REMOTE_SETUP_GUIDANCE,
  SITEGLIDE_USER_GITIGNORE_INSTRUCTION,
  HOME_BRANCH_FILE,
  buildTemporaryBranchRescueGuidance
} from '../../src/ops/gitStatus.js';
import { spawnSync } from 'node:child_process';

function gitInit(dir) {
  assert.equal(spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8', windowsHide: true }).status, 0);
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: dir, encoding: 'utf8', windowsHide: true });
}

describe('gitStatus pull baseline', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'sg-git-status-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('reports needsPullBaseline when lastPullCommit is missing', () => {
    const pullDir = join(projectDir, '.siteglide', 'user', 'pull');
    mkdirSync(pullDir, { recursive: true });
    writeFileSync(
      join(pullDir, 'staging.json'),
      `${JSON.stringify({ environment: 'staging', lastPulledAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`
    );

    assert.deepEqual(listPullBaselines(projectDir), [
      {
        environment: 'staging',
        lastPullCommit: null,
        lastPulledAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    assert.deepEqual(getPullBaselineStatus(projectDir, 'staging'), {
      environment: 'staging',
      hasBaseline: true,
      lastPullCommit: null,
      lastPulledAt: '2026-01-01T00:00:00.000Z',
      needsPullBaseline: true
    });
  });

  it('flags needsPullBaseline across environments', () => {
    const pullDir = join(projectDir, '.siteglide', 'user', 'pull');
    mkdirSync(pullDir, { recursive: true });
    writeFileSync(
      join(pullDir, 'staging.json'),
      `${JSON.stringify({ environment: 'staging', lastPulledAt: '2026-01-01T00:00:00.000Z', lastPullCommit: 'abc123' }, null, 2)}\n`
    );
    writeFileSync(
      join(pullDir, 'production.json'),
      `${JSON.stringify({ environment: 'production', lastPulledAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`
    );

    const summary = getPullBaselineStatus(projectDir);
    assert.equal(summary.needsPullBaseline, true);
    assert.equal(summary.baselines.length, 2);
  });
});

describe('gitStatus audienceGuidance', () => {
  it('points agents at read-only audience before git explanations', () => {
    assert.match(GIT_AUDIENCE_GUIDANCE, /read-only/);
    assert.match(GIT_AUDIENCE_GUIDANCE, /languageGuidance/);
    assert.match(GIT_AUDIENCE_GUIDANCE, /siteglide-cli pull/);
  });

  it('includes audienceGuidance and prefixes guidance for repos without remotes', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sg-git-status-audience-'));
    try {
      gitInit(projectDir);
      const status = getGitStatus({ projectDir });
      assert.equal(status.audienceGuidance, GIT_AUDIENCE_GUIDANCE);
      assert.match(status.guidance, /^Call the Siteglide MCP audience tool \(read-only\)/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe('gitStatus mergeResolutionGuidance', () => {
  it('requires user approval before git add and no agent commit', () => {
    assert.match(MERGE_CONFLICT_RESOLUTION_GUIDANCE, /verbal approval before git add/);
    assert.match(MERGE_CONFLICT_RESOLUTION_GUIDANCE, /Do not git commit/);
    assert.match(MERGE_CONFLICT_RESOLUTION_GUIDANCE, /auto-commits/);
  });

  it('surfaces mergeResolutionGuidance when a merge is in progress', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sg-git-status-merge-'));
    try {
      gitInit(projectDir);
      writeFileSync(join(projectDir, 'a.txt'), 'base\n');
      assert.equal(spawnSync('git', ['add', 'a.txt'], { cwd: projectDir, encoding: 'utf8', windowsHide: true }).status, 0);
      assert.equal(spawnSync('git', ['commit', '-m', 'base'], { cwd: projectDir, encoding: 'utf8', windowsHide: true }).status, 0);
      spawnSync('git', ['checkout', '-b', 'side'], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
      writeFileSync(join(projectDir, 'a.txt'), 'side\n');
      assert.equal(spawnSync('git', ['add', 'a.txt'], { cwd: projectDir, encoding: 'utf8', windowsHide: true }).status, 0);
      assert.equal(spawnSync('git', ['commit', '-m', 'side'], { cwd: projectDir, encoding: 'utf8', windowsHide: true }).status, 0);
      spawnSync('git', ['checkout', 'main'], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
      writeFileSync(join(projectDir, 'a.txt'), 'main\n');
      assert.equal(spawnSync('git', ['add', 'a.txt'], { cwd: projectDir, encoding: 'utf8', windowsHide: true }).status, 0);
      assert.equal(spawnSync('git', ['commit', '-m', 'main'], { cwd: projectDir, encoding: 'utf8', windowsHide: true }).status, 0);
      spawnSync('git', ['merge', '--no-ff', 'side'], { cwd: projectDir, encoding: 'utf8', windowsHide: true });

      const status = getGitStatus({ projectDir });
      assert.equal(status.mergeConflict?.open, true);
      assert.equal(status.mergeResolutionGuidance, MERGE_CONFLICT_RESOLUTION_GUIDANCE);
      assert.match(status.guidance, /verbal approval before git add/);
      assert.deepEqual(status.mergeConflict.unmergedPaths, ['a.txt']);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe('gitStatus siteglide user gitignore', () => {
  it('tool description tells agents to gitignore .siteglide/user/', () => {
    assert.match(GIT_STATUS_TOOL_DESCRIPTION, /\.siteglide\/user\//);
    assert.match(GIT_STATUS_TOOL_DESCRIPTION, /all files inside/);
  });

  it('adds .siteglide/user/ via gitignoreEnsure and surfaces instruction on fresh repo', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sg-git-status-gitignore-'));
    try {
      gitInit(projectDir);
      const status = getGitStatus({ projectDir });
      assert.equal(status.siteglideUserGitignoreInstruction, SITEGLIDE_USER_GITIGNORE_INSTRUCTION);
      assert.match(status.guidance, /\.siteglide\/user\//);
      assert.ok(status.gitignore);
      assert.ok(status.gitignore.added.includes('.siteglide/user/'));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe('gitStatus temporaryBranch', () => {
  const TEMP = 'temp-pull-from-staging-2026-10-16-1453';
  let projectDir;

  const git = (args) => {
    const res = spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', windowsHide: true });
    assert.equal(res.status, 0, res.stderr);
  };

  const commit = (file, content, message) => {
    writeFileSync(join(projectDir, file), content);
    git(['add', '-A']);
    git(['commit', '-m', message]);
  };

  const writeRecord = (overrides = {}) => {
    const filePath = join(projectDir, ...HOME_BRANCH_FILE.split('/'));
    mkdirSync(join(filePath, '..'), { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify({
      homeBranch: 'main',
      temporaryBranch: TEMP,
      command: 'deploy',
      environment: 'staging',
      mergeStrategy: 'last_pull_base',
      ownerPid: 999999999,
      phase: 'pulling',
      startedAt: now,
      updatedAt: now,
      ...overrides
    }));
  };

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'sg-git-status-temp-'));
    gitInit(projectDir);
    commit('.gitignore', '.siteglide/user/\n.siteglide-config\n', 'base');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('reports the home branch and discard-and-rerun rescue when the snapshot was not committed', () => {
    git(['checkout', '-b', TEMP]);
    writeRecord();
    const status = getGitStatus({ projectDir });
    const expectedGuidance = buildTemporaryBranchRescueGuidance({
      current: TEMP,
      homeBranch: 'main',
      command: 'deploy',
      environment: 'staging',
      phase: 'pulling',
      mergeStrategy: 'last_pull_base',
      snapshotCommitted: false,
      cliStillRunning: false
    });
    assert.deepEqual(status.temporaryBranch, {
      onTemporaryBranch: true,
      current: TEMP,
      homeBranch: 'main',
      command: 'deploy',
      environment: 'staging',
      phase: 'pulling',
      mergeStrategy: 'last_pull_base',
      snapshotCommitted: false,
      cliStillRunning: false,
      homeBranchExists: true,
      workingTreeDirty: false,
      homeBranchFile: HOME_BRANCH_FILE,
      rescueGuidance: expectedGuidance
    });
    assert.equal(status.guidance.startsWith(expectedGuidance), true);
    assert.match(expectedGuidance, /git checkout main and git branch -D temp-pull-from-staging-2026-10-16-1453/);
    assert.match(expectedGuidance, /siteglide-cli deploy staging again/);
  });

  it('tells the agent to finish the merge once the snapshot is committed', () => {
    git(['checkout', '-b', TEMP]);
    commit('remote.txt', 'remote\n', 'siteglide: remote full pull for merge-first deploy');
    writeRecord({ phase: 'snapshot_committed', mergeStrategy: 'orphan' });
    const status = getGitStatus({ projectDir });
    assert.equal(status.temporaryBranch.snapshotCommitted, true);
    assert.match(
      status.temporaryBranch.rescueGuidance,
      /git checkout main, then git merge --no-ff --allow-unrelated-histories temp-pull-from-staging-2026-10-16-1453/
    );
  });

  it('says wait when the owning CLI process is still running', () => {
    git(['checkout', '-b', TEMP]);
    writeRecord({ ownerPid: process.pid });
    const status = getGitStatus({ projectDir });
    assert.equal(status.temporaryBranch.cliStillRunning, true);
    assert.match(status.temporaryBranch.rescueGuidance, /that CLI process is still running/);
  });

  it('uses reflog advice when a temp-named branch has no record', () => {
    git(['checkout', '-b', 'siteglide-merge-sync/1-2']);
    const status = getGitStatus({ projectDir });
    assert.equal(status.temporaryBranch.onTemporaryBranch, true);
    assert.equal(status.temporaryBranch.homeBranch, null);
    assert.match(status.temporaryBranch.rescueGuidance, /use git reflog/);
  });

  it('marks a leftover record stale once the user is home and the temp branch is gone', () => {
    writeRecord();
    const status = getGitStatus({ projectDir });
    assert.deepEqual(status.temporaryBranch, {
      onTemporaryBranch: false,
      current: 'main',
      homeBranch: 'main',
      temporaryBranch: TEMP,
      temporaryBranchStillExists: false,
      stale: true,
      homeBranchFile: HOME_BRANCH_FILE
    });
    assert.equal(status.guidance.includes('temporary branch'), false);
  });

  it('reports nothing special on a normal branch', () => {
    git(['checkout', '-b', 'feature/header']);
    const status = getGitStatus({ projectDir });
    assert.deepEqual(status.temporaryBranch, { onTemporaryBranch: false, current: 'feature/header' });
  });
});

describe('gitStatus remoteSetupGuidance', () => {
  it('recommends feature branches and PR merge for root repo files', () => {
    assert.match(REMOTE_SETUP_GUIDANCE, /feature branch \(not main\/master\)/);
    assert.match(REMOTE_SETUP_GUIDANCE, /package\.json/);
    assert.match(REMOTE_SETUP_GUIDANCE, /PR into main\/master is merged/);
  });

  it('includes remoteSetupGuidance when the repo has no remotes', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sg-git-status-remote-'));
    try {
      gitInit(projectDir);
      const status = getGitStatus({ projectDir });
      assert.equal(status.remoteSetupGuidance, REMOTE_SETUP_GUIDANCE);
      assert.match(status.guidance, /feature branch \(not main\/master\)/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
