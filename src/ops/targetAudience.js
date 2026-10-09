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
      target_audience: canonicalizeTargetAudienceExperience(ta)
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
  const missing = [];
  if (audience.role == null) {
    missing.push('role');
  }
  if (audience.git == null) {
    missing.push('git');
  }
  if (audience.siteglideCli == null) {
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
      'The user\'s overall role is provided for context. Interpret it yourself when choosing tone, examples, and how much CMS vs code detail to include.',
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

function isFormCapabilityError(error) {
  const msg = error?.message || String(error);
  return /does not support form elicitation/i.test(msg);
}

/**
 * Prompt via MCP form elicitation when fields are null.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {string[]} missing
 */
async function elicitAudienceForm(mcpServer, missing) {
  const properties = {};
  if (missing.includes('role')) {
    properties.role = {
      type: 'string',
      title: 'Your role',
      description: 'Which best describes you?',
      enum: ROLE_OPTIONS
    };
  }
  if (missing.includes('git')) {
    properties.git = {
      type: 'string',
      title: 'Git explanations',
      description: 'When we explain git (local version control, not GitHub), do you want extra help with terms or are you familiar?',
      enum: EXPERIENCE_OPTIONS
    };
  }
  if (missing.includes('siteglideCli')) {
    properties.siteglideCli = {
      type: 'string',
      title: 'Siteglide CLI explanations',
      description: 'When we explain Siteglide CLI (pull, sync, deploy), do you want extra help or are you familiar?',
      enum: EXPERIENCE_OPTIONS
    };
  }

  const result = await mcpServer.server.elicitInput({
    mode: 'form',
    message:
      'Tell Siteglide how you work so the assistant can match your experience. ' +
      'Pick a role and for git and Siteglide CLI choose extra help or familiar.',
    requestedSchema: {
      type: 'object',
      properties,
      required: missing
    }
  });

  if (result.action !== 'accept' || !result.content) {
    return { ok: false, reason: `User ${result.action || 'dismissed'} target-audience prompt.` };
  }

  return { ok: true, content: result.content };
}

/**
 * @param {{
 *   projectDir: string,
 *   server?: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
 *   answers?: { role?: string, git?: string, siteglideCli?: string }
 * }} opts
 */
export async function getTargetAudience(opts) {
  const { projectDir, server, answers = {} } = opts;
  const current = readProjectPreferences(projectDir).target_audience;

  const applied = {
    role: normalizeChoice(answers.role, ROLE_OPTIONS) ?? current.role,
    git: normalizeExperienceLevel(answers.git) ?? current.git,
    siteglideCli: normalizeExperienceLevel(answers.siteglideCli) ?? current.siteglideCli
  };

  let missing = missingAudienceFields(applied);
  let elicitError = null;

  if (missing.length && server) {
    try {
      const elicited = await elicitAudienceForm(server, missing);
      if (elicited.ok) {
        applied.role = normalizeChoice(elicited.content.role, ROLE_OPTIONS) ?? applied.role;
        applied.git = normalizeExperienceLevel(elicited.content.git) ?? applied.git;
        applied.siteglideCli = normalizeExperienceLevel(elicited.content.siteglideCli) ?? applied.siteglideCli;
        missing = missingAudienceFields(applied);
      } else {
        elicitError = elicited.reason;
      }
    } catch (error) {
      if (!isFormCapabilityError(error)) {
        elicitError = error?.message || String(error);
      } else {
        elicitError = 'Client does not support form elicitation; ask in chat, then call this tool with answers.';
      }
    }
  }

  if (!missing.length) {
    const written = writeProjectPreferences(projectDir, applied);
    return {
      complete: true,
      path: written.path,
      target_audience: written.preferences.target_audience,
      languageGuidance: buildLanguageGuidance(written.preferences.target_audience),
      options: { role: ROLE_OPTIONS, git: EXPERIENCE_OPTIONS, siteglideCli: EXPERIENCE_OPTIONS }
    };
  }

  return {
    complete: false,
    path: preferencesPath(projectDir),
    target_audience: applied,
    missing,
    elicitError,
    prompt: {
      message:
        'Please choose your role and experience so the assistant can match how it explains git and Siteglide CLI.',
      fields: {
        role: { options: ROLE_OPTIONS, current: applied.role },
        git: { options: EXPERIENCE_OPTIONS, current: applied.git },
        siteglideCli: { options: EXPERIENCE_OPTIONS, current: applied.siteglideCli }
      }
    },
    nextStep:
      'Ask the user (MCP form if available, otherwise chat) for each missing field using prompt.fields[].options, ' +
      'then call audience again with role, git, and siteglideCli set. Do not invent answers.'
  };
}
