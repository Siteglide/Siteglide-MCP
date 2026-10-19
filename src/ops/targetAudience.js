import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ABOUT_ME_REL,
  aboutMePath,
  migrateAboutMeToParent,
  resolveReadableAboutMePath
} from '../siteglide/aboutMePath.js';
import {
  EXPERIENCE_OPTIONS,
  canonicalizeTargetAudienceExperience,
  normalizeExperienceLevel,
  wantsExtraHelp
} from '../siteglide/experienceLevel.js';

export const ROLE_OPTIONS = [
  'designer',
  'business leader',
  'developer',
  'tester',
  'marketing',
  'seo',
  'support',
  'other'
];

export { EXPERIENCE_OPTIONS };

const GIT_DEFINITIONS = {
  repo: 'a local folder git is tracking (your project history lives here)',
  remote: 'a copy of the project hosted elsewhere (usually GitHub) for backup and teammates',
  commit: 'a saved snapshot of your files with a short message',
  merge: 'combining two lines of work into one; git may mark conflicts for you to resolve',
  stash: 'a temporary shelf for uncommitted local changes so you can switch tasks safely',
  branch: 'a named line of work you can switch between without losing commits'
};

const CLI_DEFINITIONS = {
  sync: 'watches your local files and uploads each save to the site as you work',
  deploy: 'uploads the whole local site (app/ or marketplace_builder/ and modules) in one go',
  pull: 'downloads the current site files onto your computer, overwriting local copies'
};

/** User-local path — matches siteglide-cli `projectPreferences.js`. */
export function preferencesPath(projectDir) {
  return aboutMePath(projectDir);
}

export { ABOUT_ME_REL };

function emptyAudience() {
  return { role: null, git: null, siteglideCli: null };
}

function pairExperienceFields(audience) {
  const git = audience.git == null ? null : audience.git;
  const siteglideCli = audience.siteglideCli == null ? null : audience.siteglideCli;
  if (git != null && siteglideCli == null) {
    return { ...audience, siteglideCli: git };
  }
  if (siteglideCli != null && git == null) {
    return { ...audience, git: siteglideCli };
  }
  return audience;
}

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @returns {string | null}
 */
function normalizeChoice(value, allowed) {
  if (value == null || value === '') {
    return null;
  }
  const raw = String(value).trim().toLowerCase();
  const hit = allowed.find((opt) => opt.toLowerCase() === raw);
  return hit || null;
}

/**
 * @param {string} projectDir
 * @returns {{ target_audience: { role: string|null, git: string|null, siteglideCli: string|null } }}
 */
export function readProjectPreferences(projectDir) {
  migrateAboutMeToParent(projectDir);
  const filePath = resolveReadableAboutMePath(projectDir);
  const fallback = { target_audience: emptyAudience() };
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    const ta = data && data.target_audience && typeof data.target_audience === 'object'
      ? data.target_audience
      : {};
    return {
      target_audience: pairExperienceFields(canonicalizeTargetAudienceExperience(ta))
    };
  } catch {
    return fallback;
  }
}

/**
 * @param {string} projectDir
 * @param {{ role?: string|null, git?: string|null, siteglideCli?: string|null }} audience
 */
export function writeProjectPreferences(projectDir, audience) {
  migrateAboutMeToParent(projectDir);
  const filePath = aboutMePath(projectDir);
  const current = readProjectPreferences(projectDir).target_audience;
  const next = {
    target_audience: canonicalizeTargetAudienceExperience({
      role: audience.role !== undefined ? audience.role : current.role,
      git: audience.git !== undefined ? normalizeExperienceLevel(audience.git) ?? current.git : current.git,
      siteglideCli: audience.siteglideCli !== undefined
        ? normalizeExperienceLevel(audience.siteglideCli) ?? current.siteglideCli
        : current.siteglideCli
    })
  };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { path: filePath, preferences: next };
}

/**
 * @param {{ role: string|null, git: string|null, siteglideCli: string|null }} audience
 */
export function missingAudienceFields(audience) {
  const paired = pairExperienceFields(audience);
  const missing = [];
  if (paired.git == null) {
    missing.push('git');
  }
  if (paired.siteglideCli == null) {
    missing.push('siteglideCli');
  }
  return missing;
}

/**
 * Language hints for the agent once preferences are filled.
 * @param {{ role: string|null, git: string|null, siteglideCli: string|null }} audience
 */
export function buildLanguageGuidance(audience) {
  const gitExtraHelp = wantsExtraHelp(audience.git);
  const cliExtraHelp = wantsExtraHelp(audience.siteglideCli);
  return {
    role: audience.role,
    roleInstruction:
      'The user\'s overall role is provided for context when set. Do not ask the user to choose a role — CLI pull collects help mode only.',
    git: {
      level: audience.git,
      defineWhenSpeaking: gitExtraHelp ? GIT_DEFINITIONS : null,
      instruction: gitExtraHelp
        ? 'User wants extra help with git terms. When asking questions or reporting git status, include short definitions of: repo, remote, commit, merge, stash, branch.'
        : 'User is familiar with git. Use normal git terms without extra definitions unless they ask.'
    },
    siteglideCli: {
      level: audience.siteglideCli,
      defineWhenSpeaking: cliExtraHelp ? CLI_DEFINITIONS : null,
      instruction: cliExtraHelp
        ? 'User wants extra help with Siteglide CLI. When mentioning sync, deploy, or pull, include a concise explanation of that command.'
        : 'User is familiar with Siteglide CLI. Use normal CLI terms without extra definitions unless they ask.'
    }
  };
}

/**
 * Read-only: return saved audience and language guidance. Does not write or prompt the user.
 * @param {{ projectDir: string }} opts
 */
export async function getTargetAudience(opts) {
  const { projectDir } = opts;
  const applied = readProjectPreferences(projectDir).target_audience;
  const missing = missingAudienceFields(applied);
  const complete = missing.length === 0;
  const path = preferencesPath(projectDir);

  const base = {
    complete,
    path,
    target_audience: applied,
    languageGuidance: buildLanguageGuidance(applied),
    readOnly: true
  };

  if (complete) {
    return base;
  }

  return {
    ...base,
    missing,
    hint:
      'Help mode is unset. Do not ask the user profile questions in chat — run siteglide-cli pull (interactive) or edit about-me.json. Use languageGuidance with familiar defaults until then.'
  };
}
