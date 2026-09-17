import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  ensureProjectGitignore,
  getSiteglideGitignoreStatus,
  isSiteglideDirGitignored,
  SITEGLIDE_METADATA_GITIGNORE_REASON
} from '../../src/ops/gitignoreEnsure.js';
import { getGitStatus } from '../../src/ops/gitStatus.js';

function gitInit(dir) {
  assert.equal(spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8', windowsHide: true }).status, 0);
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, encoding: 'utf8', windowsHide: true });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: dir, encoding: 'utf8', windowsHide: true });
}

function runGit(dir, args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  return { ok: res.status === 0, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

describe('ensureProjectGitignore', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-gitignore-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates .gitignore with .siteglide/user/ and .siteglide-config', () => {
    const result = ensureProjectGitignore(dir);
    assert.equal(result.created, true);
    assert.deepEqual(result.added, ['.siteglide/user/', '.siteglide-config']);
    const text = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.match(text, /\.siteglide\/user\//);
    assert.match(text, /\.siteglide-config/);
  });

  it('does not duplicate existing lines and treats .siteglide/user as covering user/', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n.siteglide/user\n', 'utf8');
    const result = ensureProjectGitignore(dir);
    assert.equal(result.created, false);
    assert.deepEqual(result.added, ['.siteglide-config']);
    const again = ensureProjectGitignore(dir);
    assert.deepEqual(again.added, []);
    const text = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.equal(text.split('.siteglide-config').length - 1, 1);
  });

  it('does not add .siteglide/user/ when legacy .siteglide/ already covers it', () => {
    writeFileSync(join(dir, '.gitignore'), '.siteglide/\n.siteglide-config\n', 'utf8');
    const result = ensureProjectGitignore(dir);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.alreadyPresent, ['.siteglide/user/', '.siteglide-config']);
  });

  it('getSiteglideGitignoreStatus detects overBroad .siteglide/ ignore', () => {
    gitInit(dir);
    writeFileSync(join(dir, '.gitignore'), '.siteglide/\n', 'utf8');
    const status = getSiteglideGitignoreStatus(dir, (bin, args) => runGit(dir, args));
    assert.equal(status.userIgnored, true);
    assert.equal(status.projectIgnored, true);
    assert.equal(status.overBroad, true);
    assert.equal(isSiteglideDirGitignored(dir, (bin, args) => runGit(dir, args)), true);
  });

  it('isSiteglideDirGitignored uses git check-ignore on user/', () => {
    gitInit(dir);
    assert.equal(isSiteglideDirGitignored(dir, (bin, args) => runGit(dir, args)), false);
    writeFileSync(join(dir, '.gitignore'), '.siteglide/user/\n', 'utf8');
    assert.equal(isSiteglideDirGitignored(dir, (bin, args) => runGit(dir, args)), true);
  });

  it('SITEGLIDE_METADATA_GITIGNORE_REASON mentions user/ and project/', () => {
    assert.match(SITEGLIDE_METADATA_GITIGNORE_REASON, /`\.siteglide\/user\//);
    assert.match(SITEGLIDE_METADATA_GITIGNORE_REASON, /`\.siteglide\/project\//);
    assert.match(SITEGLIDE_METADATA_GITIGNORE_REASON, /sync, deploy, and pull/);
  });
});

describe('getGitStatus siteglideMetadataGitignore', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-git-status-'));
    gitInit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports siteglideMetadataGitignore with actionNeeded false when user/ is ignored', () => {
    const status = getGitStatus({ projectDir: dir });
    assert.equal(status.repoInitialized, true);
    assert.equal(status.siteglideMetadataGitignore.recommended, true);
    assert.equal(status.siteglideMetadataGitignore.userIgnored, true);
    assert.equal(status.siteglideMetadataGitignore.overBroad, false);
    assert.equal(status.siteglideMetadataGitignore.actionNeeded, false);
    assert.match(status.siteglideMetadataGitignore.reason, /`\.siteglide\/user\//);
  });

  it('sets actionNeeded when .siteglide/user/ is tracked', () => {
    mkdirSync(join(dir, '.siteglide', 'user'), { recursive: true });
    writeFileSync(join(dir, '.siteglide', 'user', 'state.txt'), 'local\n', 'utf8');
    runGit(dir, ['add', '.siteglide/user']);
    runGit(dir, ['commit', '-m', 'tracked siteglide user metadata']);
    const status = getGitStatus({ projectDir: dir });
    assert.equal(status.siteglideMetadataGitignore.actionNeeded, true);
    assert.equal(status.siteglideMetadataGitignore.userIgnored, false);
    assert.match(status.guidance, /git rm -r --cached \.siteglide\/user\//);
  });

  it('flags overBroad when .siteglide/ gitignore hides project/', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n.siteglide/\n.siteglide-config\n', 'utf8');
    const status = getGitStatus({ projectDir: dir });
    assert.equal(status.siteglideMetadataGitignore.overBroad, true);
    assert.equal(status.siteglideMetadataGitignore.actionNeeded, true);
    assert.match(status.guidance, /If `\.gitignore` currently lists `\.siteglide\/`, replace it with `\.siteglide\/user\/`/);
  });
});
