import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getTargetAudience,
  readProjectPreferences,
  buildLanguageGuidance,
  preferencesPath,
  writeProjectPreferences
} from '../../src/ops/targetAudience.js';

describe('audience', () => {
  let parentDir;
  let dir;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'sg-audience-'));
    dir = join(parentDir, 'project');
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
  });

  it('read-only getTargetAudience reports missing git and siteglideCli without role', async () => {
    const status = await getTargetAudience({ projectDir: dir });
    assert.equal(status.complete, false);
    assert.equal(status.readOnly, true);
    assert.deepEqual(status.missing, ['git', 'siteglideCli']);
    assert.equal(status.prompt, undefined);
    assert.equal(typeof status.hint, 'string');
    assert.equal(status.hint.includes('siteglide-cli pull'), true);
  });

  it('read-only getTargetAudience does not write when preferences were empty', async () => {
    await getTargetAudience({ projectDir: dir });
    assert.throws(() => readFileSync(preferencesPath(dir), 'utf8'));
  });

  it('returns complete audience and language guidance when help mode is set', async () => {
    writeProjectPreferences(dir, {
      git: 'extra help',
      siteglideCli: 'extra help'
    });
    const status = await getTargetAudience({ projectDir: dir });
    assert.equal(status.complete, true);
    assert.equal(status.readOnly, true);
    assert.equal(status.path, preferencesPath(dir));
    assert.equal(status.target_audience.git, 'extra help');
    assert.equal(status.target_audience.siteglideCli, 'extra help');
    assert.equal(status.languageGuidance.git.defineWhenSpeaking.repo.includes('folder'), true);
    assert.equal(status.languageGuidance.siteglideCli.defineWhenSpeaking.sync.includes('watches'), true);
    const onDisk = JSON.parse(readFileSync(preferencesPath(dir), 'utf8'));
    assert.equal(onDisk.target_audience.git, 'extra help');
    const again = readProjectPreferences(dir);
    assert.equal(again.target_audience.siteglideCli, 'extra help');
  });

  it('accepts legacy beginner and advanced on disk as aliases', async () => {
    writeProjectPreferences(dir, {
      git: 'beginner',
      siteglideCli: 'advanced'
    });
    const status = await getTargetAudience({ projectDir: dir });
    assert.equal(status.complete, true);
    assert.equal(status.target_audience.git, 'extra help');
    assert.equal(status.target_audience.siteglideCli, 'familiar');
  });

  it('omits definitions for familiar git and cli', () => {
    const guidance = buildLanguageGuidance({
      role: 'developer',
      git: 'familiar',
      siteglideCli: 'familiar'
    });
    assert.equal(guidance.git.defineWhenSpeaking, null);
    assert.equal(guidance.siteglideCli.defineWhenSpeaking, null);
  });
});
