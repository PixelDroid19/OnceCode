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

// ── Context window management ──────────────────────────────────────

/** Default context window size (tokens) for models without a specific rule. */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** Token buffer reserved before the context limit; compaction triggers when used tokens reach `contextWindow - maxOutputTokens - COMPACTION_BUFFER_TOKENS`. */
export const COMPACTION_BUFFER_TOKENS = 20_000

/** Max output tokens allowed for the compaction summary request. */
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

/** Maximum number of retries when the compaction request itself is too large. */
export const COMPACT_MAX_RETRIES = 3

/** Fraction of the summarize-set to drop on each retry when compaction overflows. */
export const COMPACT_RETRY_DROP_RATIO = 0.2

/** Maximum token budget reserved for working memory carried inside the compacted context. */
export const COMPACT_WORKING_MEMORY_MAX_TOKENS = 2_500

/** Number of recent user turns whose tool outputs are protected from micro-compaction. */
export const MICRO_COMPACT_PROTECT_TURNS = 3

/** Minimum size before old assistant progress messages are compacted away. */
export const MIN_PROGRESS_MESSAGE_CHARS = 120

/** Minimum size before old tool call inputs are replaced with a compact placeholder. */
export const MIN_TOOL_CALL_INPUT_CHARS = 160

/** Placeholder text that replaces compacted old tool call inputs. */
export const COMPACTED_TOOL_CALL_INPUT = '[Old tool call input compacted]'

/** Placeholder text that replaces compacted old assistant progress messages. */
export const COMPACTED_PROGRESS_MESSAGE = '[Old progress update compacted]'

/** Maximum consecutive auto-compact failures before the circuit breaker disables auto-compaction. */
export const MAX_CONSECUTIVE_COMPACT_FAILURES = 3

/**
 * Fraction of conversation (by character count) to summarize during compaction.
 * The remaining portion (most recent messages) is kept verbatim for continuity.
 */
export const COMPACT_SUMMARIZE_RATIO = 0.7

/** Characters-per-token ratio used for rough estimation (matches industry standard). */
export const CHARS_PER_TOKEN = 4

/** Context usage percentage at which the TUI shows a yellow warning. */
export const CONTEXT_WARNING_THRESHOLD = 0.6

/** Context usage percentage at which the TUI shows a red warning. */
export const CONTEXT_ERROR_THRESHOLD = 0.8

/** Placeholder text that replaces cleared tool output during micro-compaction. */
export const CLEARED_TOOL_OUTPUT = '[Old tool result content cleared]'
