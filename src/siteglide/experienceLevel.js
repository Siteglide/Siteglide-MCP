/**
 * Target-audience git / Siteglide CLI experience labels — matches siteglide-cli `experienceLevel.js`.
 */

export const EXPERIENCE_OPTIONS = ['extra help', 'familiar'];

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeExperienceLevel(value) {
  if (value == null || value === '') {
    return null;
  }
  const raw = String(value).trim().toLowerCase();
  if (raw === 'beginner' || raw === 'extra help') {
    return 'extra help';
  }
  if (raw === 'advanced' || raw === 'familiar') {
    return 'familiar';
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function wantsExtraHelp(value) {
  return normalizeExperienceLevel(value) === 'extra help';
}

/**
 * @param {{ role?: string|null, git?: string|null, siteglideCli?: string|null }} ta
 */
export function canonicalizeTargetAudienceExperience(ta) {
  const src = ta && typeof ta === 'object' ? ta : {};
  return {
    role: src.role == null ? null : src.role,
    git: src.git == null ? null : normalizeExperienceLevel(src.git),
    siteglideCli: src.siteglideCli == null ? null : normalizeExperienceLevel(src.siteglideCli)
  };
}
