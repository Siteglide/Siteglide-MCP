import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read AI-readable remote-check / stash conflict logs under .siteglide/
 * @param {{ projectDir: string, environment?: string }} opts
 */
export function getRemoteCheckStatus(opts) {
  const projectDir = opts.projectDir;
  const dir = join(projectDir, '.siteglide', 'remote-check');
  const conflicts = [];

  if (existsSync(dir)) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const envName = name.replace(/\.json$/, '');
      if (opts.environment && opts.environment !== envName) {
        continue;
      }
      try {
        conflicts.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      } catch {
        // skip
      }
    }
  }

  let stashConflict = null;
  const stashPath = join(projectDir, '.siteglide', 'git', 'last-stash-conflict.json');
  if (existsSync(stashPath)) {
    try {
      stashConflict = JSON.parse(readFileSync(stashPath, 'utf8'));
    } catch {
      stashConflict = null;
    }
  }

  let mergeManifests = [];
  const mergeDir = join(projectDir, '.siteglide', 'merge');
  if (existsSync(mergeDir)) {
    try {
      for (const name of readdirSync(mergeDir)) {
        if (!name.endsWith('.json')) {
          continue;
        }
        mergeManifests.push(JSON.parse(readFileSync(join(mergeDir, name), 'utf8')));
      }
    } catch {
      mergeManifests = [];
    }
  }

  return {
    activeConflict: conflicts.length > 0 || !!stashConflict,
    environments: conflicts,
    stashConflict,
    mergeManifests
  };
}
