import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENCE_OPTIONS,
  normalizeExperienceLevel,
  wantsExtraHelp
} from '../../src/siteglide/experienceLevel.js';

describe('experienceLevel', () => {
  it('EXPERIENCE_OPTIONS are extra help and familiar', () => {
    assert.deepEqual(EXPERIENCE_OPTIONS, ['extra help', 'familiar']);
  });

  it('normalizes legacy beginner and advanced aliases', () => {
    assert.equal(normalizeExperienceLevel('beginner'), 'extra help');
    assert.equal(normalizeExperienceLevel('advanced'), 'familiar');
  });

  it('wantsExtraHelp accepts legacy beginner', () => {
    assert.equal(wantsExtraHelp('beginner'), true);
    assert.equal(wantsExtraHelp('advanced'), false);
  });
});
