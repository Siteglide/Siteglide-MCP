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
  MERGE_CONFLICT_RESOLUTION_GUIDANCE,
  REMOTE_SETUP_GUIDANCE
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
  it('requires audience before git explanations', () => {
    assert.match(GIT_AUDIENCE_GUIDANCE, /audience tool/);
    assert.match(GIT_AUDIENCE_GUIDANCE, /languageGuidance/);
  });

  it('includes audienceGuidance and prefixes guidance for repos without remotes', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sg-git-status-audience-'));
    try {
      gitInit(projectDir);
      const status = getGitStatus({ projectDir });
      assert.equal(status.audienceGuidance, GIT_AUDIENCE_GUIDANCE);
      assert.match(status.guidance, /^Before explaining git/);
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
