/**
 * Global application constants shared across the OnceCode codebase.
 *
 * Keep values here when they are referenced by two or more modules,
 * represent "magic" numbers/strings, or carry domain-specific meaning
 * that benefits from a semantic name.
 */

/** Display name of the application. */
export const APP_NAME = 'OnceCode'

/** Semver version string embedded in API headers and client info. */
export const APP_VERSION = '0.1.0'

/** User-agent identifier used for outbound HTTP requests. */
export const APP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OnceCode/0.1'

/** Default filename expected inside every skill directory. */
export const SKILL_FILENAME = 'SKILL.md'

/**
 * Maximum number of command-history entries persisted between sessions.
 * Older entries are discarded on save.
 */
export const MAX_HISTORY_ENTRIES = 200

/** Maximum number of file entries returned by the list_files tool. */
export const MAX_LIST_FILES_RESULTS = 200
