import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  ensureProjectGitignore,
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

  it('creates .gitignore with .siteglide/ and .siteglide-config', () => {
    const result = ensureProjectGitignore(dir);
    assert.equal(result.created, true);
    assert.deepEqual(result.added, ['.siteglide/', '.siteglide-config']);
    const text = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.match(text, /\.siteglide\//);
    assert.match(text, /\.siteglide-config/);
  });

  it('does not duplicate existing lines and treats .siteglide as covering the directory', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n.siteglide\n', 'utf8');
    const result = ensureProjectGitignore(dir);
    assert.equal(result.created, false);
    assert.deepEqual(result.added, ['.siteglide-config']);
    const again = ensureProjectGitignore(dir);
    assert.deepEqual(again.added, []);
    const text = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.equal(text.split('.siteglide-config').length - 1, 1);
  });

  it('isSiteglideDirGitignored uses git check-ignore', () => {
    gitInit(dir);
    assert.equal(isSiteglideDirGitignored(dir, (bin, args) => runGit(dir, args)), false);
    writeFileSync(join(dir, '.gitignore'), '.siteglide/\n', 'utf8');
    assert.equal(isSiteglideDirGitignored(dir, (bin, args) => runGit(dir, args)), true);
  });

  it('SITEGLIDE_METADATA_GITIGNORE_REASON mentions sync deploy pull', () => {
    assert.match(SITEGLIDE_METADATA_GITIGNORE_REASON, /sync, deploy, and pull/);
    assert.match(SITEGLIDE_METADATA_GITIGNORE_REASON, /remote repository/);
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

  it('reports siteglideMetadataGitignore with actionNeeded when not ignored', () => {
    const status = getGitStatus({ projectDir: dir });
    assert.equal(status.repoInitialized, true);
    assert.equal(status.siteglideMetadataGitignore.recommended, true);
    assert.equal(status.siteglideMetadataGitignore.ignored, true);
    assert.equal(status.siteglideMetadataGitignore.actionNeeded, false);
    assert.match(status.siteglideMetadataGitignore.reason, /sync, deploy, and pull/);
  });

  it('sets actionNeeded when .siteglide/ is not gitignored and already tracked', () => {
    mkdirSync(join(dir, '.siteglide'), { recursive: true });
    writeFileSync(join(dir, '.siteglide', 'state.txt'), 'local\n', 'utf8');
    runGit(dir, ['add', '.siteglide']);
    runGit(dir, ['commit', '-m', 'tracked siteglide']);
    const status = getGitStatus({ projectDir: dir });
    assert.equal(status.siteglideMetadataGitignore.actionNeeded, true);
    assert.equal(status.siteglideMetadataGitignore.ignored, false);
    assert.match(status.guidance, /git rm -r --cached \.siteglide\//);
  });
});
