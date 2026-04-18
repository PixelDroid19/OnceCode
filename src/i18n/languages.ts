/** Built-in UI languages shipped with OnceCode. */
export type BuiltinLanguage = 'en' | 'es'

/** User-configurable UI language setting. */
export type LanguageSetting = BuiltinLanguage | 'auto'

/** Metadata describing a built-in UI language. */
export type LanguageDefinition = {
  code: BuiltinLanguage
  id: string
  fullName: string
  nativeName: string
}

/** Built-in language packs bundled with the CLI. */
export const SUPPORTED_LANGUAGES: readonly LanguageDefinition[] = [
  {
    code: 'en',
    id: 'en-US',
    fullName: 'English',
    nativeName: 'English',
  },
  {
    code: 'es',
    id: 'es-ES',
    fullName: 'Spanish',
    nativeName: 'Español',
  },
]

/** Returns the built-in language selected by the current system locale. */
export function detectSystemLanguage(): BuiltinLanguage {
  const envLanguage =
    process.env.ONCECODE_LANG || process.env.LC_ALL || process.env.LANG
  if (envLanguage) {
    const normalized = normalizeLanguageInput(envLanguage)
    if (normalized) {
      return normalized
    }
  }

  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    const normalized = normalizeLanguageInput(locale)
    if (normalized) {
      return normalized
    }
  } catch {
    // Fall back to the default built-in language.
  }

  return 'en'
}

/** Resolves the configured UI language, applying `auto` detection when needed. */
export function resolveLanguage(setting?: LanguageSetting): BuiltinLanguage {
  if (!setting || setting === 'auto') {
    return detectSystemLanguage()
  }

  return setting
}

/** Parses a user-provided language argument into a supported built-in language. */
export function normalizeLanguageInput(input: string): BuiltinLanguage | null {
  const lowered = input.trim().toLowerCase()
  if (!lowered) {
    return null
  }

  for (const language of SUPPORTED_LANGUAGES) {
    if (
      lowered === language.code ||
      lowered === language.id.toLowerCase() ||
      lowered === language.fullName.toLowerCase() ||
      lowered === language.nativeName.toLowerCase()
    ) {
      return language.code
    }
  }

  return null
}

/** Returns the formatted display label for a built-in language. */
export function formatLanguageDisplay(language: BuiltinLanguage): string {
  const definition = SUPPORTED_LANGUAGES.find(item => item.code === language)
  if (!definition) {
    return language
  }

  return definition.nativeName === definition.fullName
    ? `${definition.fullName} [${definition.id}]`
    : `${definition.nativeName} (${definition.fullName}) [${definition.id}]`
}

/** Returns the supported language identifiers in a help-friendly format. */
export function getSupportedLanguageIds(separator = '|'): string {
  return SUPPORTED_LANGUAGES.map(language => language.id).join(separator)
}
