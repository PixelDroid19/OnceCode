import { describe, expect, it } from 'vitest'
import { parseLocalToolShortcut } from '@/commands/shortcuts.js'

describe('local-tool-shortcuts', () => {
  it('parses /ls', () => {
    expect(parseLocalToolShortcut('/ls src')).toEqual({
      toolName: 'list_files',
      input: { path: 'src' },
    })
  })

  it('parses /grep', () => {
    expect(parseLocalToolShortcut('/grep todo::src')).toEqual({
      toolName: 'grep_files',
      input: { pattern: 'todo', path: 'src' },
    })
  })

  it('parses /patch', () => {
    expect(parseLocalToolShortcut('/patch app.ts::foo::bar::baz::qux')).toEqual({
      toolName: 'patch_file',
      input: {
        path: 'app.ts',
        replacements: [
          { search: 'foo', replace: 'bar' },
          { search: 'baz', replace: 'qux' },
        ],
      },
    })
  })

  it('returns null for invalid payloads', () => {
    expect(parseLocalToolShortcut('/patch app.ts::only-one')).toBeNull()
    expect(parseLocalToolShortcut('/unknown')).toBeNull()
  })
})
