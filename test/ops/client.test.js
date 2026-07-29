import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listEnvironments, resolveAuth } from '../../src/ops/client.js';
import { classifyEnvironment } from '../../src/ops/security.js';

describe('listEnvironments / resolveAuth', () => {
  let dir;
  let configPath;
  const prev = {};

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-mcp-'));
    configPath = join(dir, '.siteglide-config');
    writeFileSync(
      configPath,
      JSON.stringify({
        staging: {
          url: 'https://demo.staging-siteglide.com/',
          email: 'a@b.com',
          token: 'SECRET_TOKEN'
        },
        live: {
          url: 'https://demo.us-siteglide.com/',
          email: 'a@b.com',
          token: 'SECRET_TOKEN'
        }
      })
    );
    for (const k of ['MPKIT_URL', 'MPKIT_TOKEN', 'MPKIT_EMAIL', 'CONFIG_FILE_PATH']) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('summary mode returns name+host without classification or secrets', () => {
    const envs = listEnvironments(configPath, { details: false });
    assert.equal(envs.length, 2);
    for (const e of envs) {
      assert.ok(e.name);
      assert.ok(e.host);
      assert.equal(e.classification, undefined);
      assert.equal(e.url, undefined);
      assert.equal(e.token, undefined);
      assert.equal(e.email, undefined);
    }
  });

  it('details mode includes url and classification', () => {
    const envs = listEnvironments(configPath, { details: true });
    const byName = Object.fromEntries(envs.map((e) => [e.name, e]));
    assert.equal(byName.staging.classification, 'staging');
    assert.equal(byName.live.classification, 'production');
    assert.ok(byName.staging.url.includes('staging-siteglide.com'));
    assert.equal(byName.live.token, undefined);
    assert.equal(byName.live.email, undefined);
  });

  it('resolveAuth does not expose secrets in thrown messages for missing env', () => {
    assert.throws(() => resolveAuth('missing', configPath), /No settings for environment/);
  });

  it('classifyEnvironment matches listEnvironments details', () => {
    const auth = resolveAuth('live', configPath);
    assert.equal(classifyEnvironment(auth), 'production');
    assert.equal(auth.token, 'SECRET_TOKEN');
  });
});
