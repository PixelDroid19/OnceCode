import type { ToolResult } from '../tool.js'

/** A single search string and its replacement, with optional global replace. */
export type Replacement = {
  search: string
  replace: string
  replaceAll?: boolean
}

/**
 * Apply a list of search/replace operations to `content` sequentially.
 * Returns the transformed text on success, or a ToolResult error on the
 * first replacement whose search string is not found.
 */
export function applyReplacements(
  content: string,
  replacements: Replacement[],
  filePath: string,
): { ok: true; content: string; applied: string[] } | { ok: false; result: ToolResult } {
  let text = content
  const applied: string[] = []

  for (const [index, replacement] of replacements.entries()) {
    if (!text.includes(replacement.search)) {
      return {
        ok: false,
        result: { ok: false, output: `Replacement ${index + 1} not found in ${filePath}` },
      }
    }

    text = replacement.replaceAll
      ? text.split(replacement.search).join(replacement.replace)
      : text.replace(replacement.search, replacement.replace)

    applied.push(
      replacement.replaceAll
        ? `#${index + 1} replaceAll`
        : `#${index + 1} replaceOnce`,
    )
  }

  return { ok: true, content: text, applied }
}
