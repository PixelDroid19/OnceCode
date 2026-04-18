/**
 * Terminal UI layout constants.
 *
 * Provides sensible defaults for terminal dimensions, panel widths, and
 * content truncation limits so the TUI renders correctly across a wide
 * range of terminal sizes.
 */

/** Minimum panel width to prevent layout corruption on narrow terminals. */
export const MIN_TERMINAL_WIDTH = 60

/** Fallback value when `process.stdout.rows` is unavailable. */
export const DEFAULT_TERMINAL_ROWS = 40

/** Fallback value when `process.stdout.columns` is unavailable. */
export const DEFAULT_TERMINAL_COLS = 100

/**
 * Number of rows reserved for chrome (header, prompt, footer) when
 * computing the expanded permission-prompt window size.
 */
export const EXPANDED_WINDOW_MARGIN = 20

/** Minimum height of an expanded scrollable detail window. */
export const EXPANDED_WINDOW_MIN_ROWS = 8

/** Maximum lines shown in a collapsed permission-prompt detail block. */
export const COLLAPSED_DETAIL_LIMIT = 16

/** Maximum character width for tool-body preview (read_file). */
export const TOOL_PREVIEW_MAX_CHARS_READ = 1_000

/** Maximum line count for tool-body preview (read_file). */
export const TOOL_PREVIEW_MAX_LINES_READ = 20

/** Maximum character width for tool-body preview (other tools). */
export const TOOL_PREVIEW_MAX_CHARS_DEFAULT = 1_800

/** Maximum line count for tool-body preview (other tools). */
export const TOOL_PREVIEW_MAX_LINES_DEFAULT = 36

/** Character limit before a collapsed tool-output line is truncated. */
export const COLLAPSED_TOOL_LINE_LIMIT = 140

/** Default character limit for the `truncateForDisplay` helper. */
export const DISPLAY_TRUNCATION_LIMIT = 180
