import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  aboutMePath,
  legacyAboutMePath,
  migrateAboutMeToParent,
  resolveReadableAboutMePath
} from '../../src/siteglide/aboutMePath.js';

describe('aboutMePath', () => {
  let parentDir;
  let projectDir;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'sg-about-me-'));
    projectDir = join(parentDir, 'site');
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
  });

  it('resolves about-me.json in the parent .siteglide/user directory', () => {
    assert.equal(
      aboutMePath(projectDir),
      join(parentDir, '.siteglide', 'user', 'about-me.json')
    );
  });

  it('migrates legacy project-level file to the parent on first access', () => {
    const legacyPath = legacyAboutMePath(projectDir);
    mkdirSync(join(projectDir, '.siteglide', 'user'), { recursive: true });
    writeFileSync(
      legacyPath,
      `${JSON.stringify({ target_audience: { role: 'seo', git: null, siteglideCli: 'beginner' } }, null, 2)}\n`,
      'utf8'
    );

    migrateAboutMeToParent(projectDir);

    const parentPath = join(parentDir, '.siteglide', 'user', 'about-me.json');
    assert.equal(existsSync(legacyPath), false);
    assert.equal(existsSync(parentPath), true);
    const onDisk = JSON.parse(readFileSync(parentPath, 'utf8')).target_audience;
    assert.equal(onDisk.role, 'seo');
    assert.equal(onDisk.siteglideCli, 'extra help');
    assert.equal(resolveReadableAboutMePath(projectDir), parentPath);
  });
});
