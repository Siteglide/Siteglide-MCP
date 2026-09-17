import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseListModulesResponse } from '../../src/ops/installedModules.js';

describe('parseListModulesResponse', () => {
  it('returns module names from pull-style API payload', () => {
    assert.deepEqual(parseListModulesResponse({ data: ['core', 'module_984', 'payments'] }), [
      'core',
      'module_984',
      'payments'
    ]);
  });

  it('returns empty array when no modules are installed', () => {
    assert.deepEqual(parseListModulesResponse({ data: [] }), []);
  });

  it('returns empty array for missing or malformed payloads', () => {
    assert.deepEqual(parseListModulesResponse(null), []);
    assert.deepEqual(parseListModulesResponse({}), []);
    assert.deepEqual(parseListModulesResponse({ data: 'core' }), []);
  });

  it('drops non-string entries', () => {
    assert.deepEqual(parseListModulesResponse({ data: ['core', 42, null, 'user'] }), ['core', 'user']);
  });
});
