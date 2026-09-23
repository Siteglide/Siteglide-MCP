import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve a `.siteglide/` subpath — prefer `user/` layout, fall back to a flat `.siteglide/` root.
 * @param {string} projectDir
 * @param {...string} segments
 */
function resolveSiteglidePath(projectDir, ...segments) {
	const candidates = [
		join(projectDir, '.siteglide', 'user', ...segments),
		join(projectDir, '.siteglide', ...segments)
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return candidates[0];
}

/**
 * Read JSON files from a directory (first existing candidate path).
 * @param {string} projectDir
 * @param {string[]} dirSegments
 * @param {string | undefined} environment
 */
function readJsonDir(projectDir, dirSegments, environment) {
	const dir = resolveSiteglidePath(projectDir, ...dirSegments);
	const out = [];
	if (!existsSync(dir)) {
		return out;
	}
	let names = [];
	try {
		names = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		if (!name.endsWith('.json')) {
			continue;
		}
		const envName = name.replace(/\.json$/, '');
		if (environment && environment !== envName) {
			continue;
		}
		try {
			out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
		} catch {
			// skip invalid
		}
	}
	return out;
}

/**
 * Read a single JSON file (first existing candidate).
 * @param {string} projectDir
 * @param {string[]} fileSegments
 */
function readJsonFile(projectDir, fileSegments) {
	const candidates = [
		join(projectDir, '.siteglide', 'user', ...fileSegments),
		join(projectDir, '.siteglide', ...fileSegments)
	];
	for (const filePath of candidates) {
		if (!existsSync(filePath)) {
			continue;
		}
		try {
			return JSON.parse(readFileSync(filePath, 'utf8'));
		} catch {
			return null;
		}
	}
	return null;
}

export const MERGE_CONFLICT_AGENT_GUIDANCE =
  'Resolve conflict markers and explain the result. Do not git add or git commit until the user verbally approves. ' +
  'After approval, git add each resolved file; Siteglide CLI auto-commits the merge when everything is staged. ' +
  'On sync, upload resumes automatically after merge complete — no need to re-save the file.';

/**
 * Read AI-readable remote-check / stash / sync conflict logs under `.siteglide/`.
 * @param {{ projectDir: string, environment?: string }} opts
 */
export function getRemoteCheckStatus(opts) {
	const projectDir = opts.projectDir;
	const conflicts = readJsonDir(projectDir, ['remote-check'], opts.environment);
	const stashConflict = readJsonFile(projectDir, ['git', 'last-stash-conflict.json']);
	const mergeManifests = readJsonDir(projectDir, ['merge'], opts.environment);
	const syncCurrentConflict = readJsonFile(projectDir, ['sync', 'current-conflict.json']);

	const activeConflict =
		conflicts.length > 0 || !!stashConflict || !!syncCurrentConflict;

	return {
		activeConflict,
		environments: conflicts,
		stashConflict,
		mergeManifests,
		syncCurrentConflict,
    paths: {
      remoteCheckDir: '.siteglide/user/remote-check',
      mergeDir: '.siteglide/user/merge',
      stashConflictLog: '.siteglide/user/git/last-stash-conflict.json',
      syncCurrentConflict: '.siteglide/user/sync/current-conflict.json'
    },
    agentGuidance:
      syncCurrentConflict?.agentGuidance ||
      (conflicts[0] && conflicts[0].agentGuidance) ||
      (activeConflict ? MERGE_CONFLICT_AGENT_GUIDANCE : undefined) ||
      'When activeConflict is true, call this tool instead of scraping the CLI terminal. Follow recommendedActions[].id when present.',
    mergeResolutionGuidance: MERGE_CONFLICT_AGENT_GUIDANCE
	};
}
