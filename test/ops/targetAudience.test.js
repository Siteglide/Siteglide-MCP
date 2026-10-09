import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getTargetAudience,
  readProjectPreferences,
  buildLanguageGuidance,
  preferencesPath
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

  it('returns a prompt when values are null', async () => {
    const status = await getTargetAudience({ projectDir: dir });
    assert.equal(status.complete, false);
    assert.deepEqual(status.missing, ['role', 'git', 'siteglideCli']);
    assert.equal(status.prompt.fields.role.options.includes('developer'), true);
    assert.deepEqual(status.prompt.fields.git.options, ['extra help', 'familiar']);
  });

  it('writes preferences under parent .siteglide/user/about-me.json and extra-help language guidance', async () => {
    const status = await getTargetAudience({
      projectDir: dir,
      answers: {
        role: 'Designer',
        git: 'extra help',
        siteglideCli: 'extra help'
      }
    });
    assert.equal(status.complete, true);
    assert.equal(status.path, preferencesPath(dir));
    assert.equal(status.target_audience.role, 'designer');
    assert.equal(status.languageGuidance.git.defineWhenSpeaking.repo.includes('folder'), true);
    assert.equal(status.languageGuidance.siteglideCli.defineWhenSpeaking.sync.includes('watches'), true);
    assert.equal(status.languageGuidance.role, 'designer');
    const onDisk = JSON.parse(readFileSync(preferencesPath(dir), 'utf8'));
    assert.equal(onDisk.target_audience.git, 'extra help');
    const again = readProjectPreferences(dir);
    assert.equal(again.target_audience.siteglideCli, 'extra help');
  });

  it('accepts legacy beginner and advanced answers as aliases', async () => {
    const status = await getTargetAudience({
      projectDir: dir,
      answers: {
        role: 'developer',
        git: 'beginner',
        siteglideCli: 'advanced'
      }
    });
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
