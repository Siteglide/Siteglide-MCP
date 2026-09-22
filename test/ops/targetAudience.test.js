import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getTargetAudience,
  readProjectPreferences,
  buildLanguageGuidance,
  preferencesPath
} from '../../src/ops/targetAudience.js';

describe('audience', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-audience-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a prompt when values are null', async () => {
    const status = await getTargetAudience({ projectDir: dir });
    assert.equal(status.complete, false);
    assert.deepEqual(status.missing, ['role', 'git', 'siteglideCli']);
    assert.equal(status.prompt.fields.role.options.includes('developer'), true);
    assert.deepEqual(status.prompt.fields.git.options, ['beginner', 'advanced']);
  });

  it('writes preferences under .siteglide/user/about-me.json and beginner language guidance', async () => {
    const status = await getTargetAudience({
      projectDir: dir,
      answers: {
        role: 'Designer',
        git: 'beginner',
        siteglideCli: 'beginner'
      }
    });
    assert.equal(status.complete, true);
    assert.equal(status.path, preferencesPath(dir));
    assert.equal(status.target_audience.role, 'designer');
    assert.equal(status.languageGuidance.git.defineWhenSpeaking.repo.includes('folder'), true);
    assert.equal(status.languageGuidance.siteglideCli.defineWhenSpeaking.sync.includes('watches'), true);
    assert.equal(status.languageGuidance.role, 'designer');
    const onDisk = JSON.parse(readFileSync(preferencesPath(dir), 'utf8'));
    assert.equal(onDisk.target_audience.git, 'beginner');
    const again = readProjectPreferences(dir);
    assert.equal(again.target_audience.siteglideCli, 'beginner');
  });

  it('omits definitions for advanced git and cli', () => {
    const guidance = buildLanguageGuidance({
      role: 'developer',
      git: 'advanced',
      siteglideCli: 'advanced'
    });
    assert.equal(guidance.git.defineWhenSpeaking, null);
    assert.equal(guidance.siteglideCli.defineWhenSpeaking, null);
  });
});
