import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER_SEGMENTS = ['.siteglide', 'user', 'mcp-session.json'];

/**
 * @param {string} projectDir
 * @returns {string}
 */
export function mcpSessionMarkerPath(projectDir) {
  return join(projectDir, ...MARKER_SEGMENTS);
}

/**
 * @param {string} projectDir
 * @returns {{ pid: number, startedAt: string, projectDir: string, version: string } | null}
 */
export function readMcpSessionMarker(projectDir) {
  const filePath = mcpSessionMarkerPath(projectDir);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object') {
      return null;
    }
    const pid = Number(data.pid);
    if (!Number.isInteger(pid) || typeof data.startedAt !== 'string') {
      return null;
    }
    return {
      pid,
      startedAt: data.startedAt,
      projectDir: typeof data.projectDir === 'string' ? data.projectDir : projectDir,
      version: typeof data.version === 'string' ? data.version : 'unknown'
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ projectDir: string, pid?: number, startedAt: string, version: string }} opts
 */
export function writeMcpSessionMarker(opts) {
  const filePath = mcpSessionMarkerPath(opts.projectDir);
  mkdirSync(join(opts.projectDir, '.siteglide', 'user'), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        pid: opts.pid ?? process.pid,
        startedAt: opts.startedAt,
        projectDir: opts.projectDir,
        version: opts.version
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  return filePath;
}

/**
 * @param {string} projectDir
 */
export function clearMcpSessionMarker(projectDir) {
  const filePath = mcpSessionMarkerPath(projectDir);
  try {
    unlinkSync(filePath);
  } catch {
    // ignore
  }
}
