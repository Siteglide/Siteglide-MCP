import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getCachedInstalledEntry,
  isInstalledCacheFresh,
  mergeInstalledIntoDocument,
  readModulesProjectConfig,
  writeModulesProjectConfig
} from '../../src/ops/modulesProjectConfig.js';

describe('modulesProjectConfig', () => {
  it('isInstalledCacheFresh accepts timestamps within 2 hours', () => {
    const now = Date.parse('2026-09-17T15:00:00.000Z');
    assert.equal(isInstalledCacheFresh('2026-09-17T14:00:00.000Z', now), true);
    assert.equal(isInstalledCacheFresh('2026-09-17T12:59:59.999Z', now), false);
  });

  it('getCachedInstalledEntry returns modules when env entry is fresh', () => {
    const doc = {
      pull_behaviour: { include: [], exclude: [] },
      installed: {
        staging: {
          modules: ['core', 'siteglide_system'],
          last_checked: '2026-09-17T14:30:00.000Z'
        }
      }
    };
    const now = Date.parse('2026-09-17T15:00:00.000Z');
    assert.deepEqual(getCachedInstalledEntry(doc, 'staging', now), {
      modules: ['core', 'siteglide_system'],
      last_checked: '2026-09-17T14:30:00.000Z'
    });
  });

  it('getCachedInstalledEntry returns null when stale or missing', () => {
    const now = Date.parse('2026-09-17T15:00:00.000Z');
    assert.equal(getCachedInstalledEntry({}, 'staging', now), null);
    assert.equal(
      getCachedInstalledEntry(
        {
          installed: {
            staging: { modules: ['core'], last_checked: '2026-09-17T10:00:00.000Z' }
          }
        },
        'staging',
        now
      ),
      null
    );
    assert.equal(
      getCachedInstalledEntry(
        { installed: { staging: { last_checked: '2026-09-17T14:30:00.000Z' } } },
        'staging',
        now
      ),
      null
    );
  });

  it('mergeInstalledIntoDocument preserves pull_behaviour and other envs', () => {
    const merged = mergeInstalledIntoDocument(
      {
        pull_behaviour: { include: ['module_357'], exclude: [], usage: 'team note' },
        installed: {
          production: {
            modules: ['core'],
            last_checked: '2026-09-17T12:00:00.000Z'
          }
        }
      },
      'staging',
      ['core', 'user'],
      '2026-09-17T15:00:00.000Z'
    );

    assert.deepEqual(merged, {
      pull_behaviour: { include: ['module_357'], exclude: [], usage: 'team note' },
      installed: {
        production: {
          modules: ['core'],
          last_checked: '2026-09-17T12:00:00.000Z'
        },
        staging: {
          modules: ['core', 'user'],
          last_checked: '2026-09-17T15:00:00.000Z'
        }
      }
    });
  });

  it('read and write round-trip under .siteglide/project/modules.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'sg-mcp-modules-json-'));
    try {
      writeModulesProjectConfig(
        root,
        mergeInstalledIntoDocument({}, 'staging', ['core'], '2026-09-17T15:00:00.000Z')
      );
      const text = readFileSync(join(root, '.siteglide', 'project', 'modules.json'), 'utf8');
      assert.match(text, /"installed"/);
      assert.deepEqual(readModulesProjectConfig(root).installed, {
        staging: {
          modules: ['core'],
          last_checked: '2026-09-17T15:00:00.000Z'
        }
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
