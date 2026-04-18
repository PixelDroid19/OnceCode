import { pathToFileURL } from 'node:url'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { ONCECODE_DIR } from '@/config/store.js'
import type { BuiltinLanguage, LanguageSetting } from './languages.js'
import {
  detectSystemLanguage,
  formatLanguageDisplay,
  resolveLanguage,
} from './languages.js'
import en from './locales/en.js'
import es from './locales/es.js'

type TranslationValue = string
type TranslationDict = Record<string, TranslationValue>

const BUILTIN_TRANSLATIONS: Record<BuiltinLanguage, TranslationDict> = {
  en,
  es,
}

let currentLanguage: BuiltinLanguage = 'en'
let translations: TranslationDict = BUILTIN_TRANSLATIONS.en

/** Returns the current built-in UI language. */
export function getCurrentLanguage(): BuiltinLanguage {
  return currentLanguage
}

/** Returns the display label for the current UI language. */
export function getCurrentLanguageLabel(): string {
  return formatLanguageDisplay(currentLanguage)
}

/** Returns the filesystem directory where user locale packs can live. */
export function getUserLocalesDirectory(): string {
  return path.join(ONCECODE_DIR, 'locales')
}

async function readUserTranslations(language: BuiltinLanguage): Promise<TranslationDict> {
  const localePath = path.join(getUserLocalesDirectory(), `${language}.js`)
  try {
    await access(localePath)
  } catch {
    return {}
  }

  try {
    const module = await import(pathToFileURL(localePath).href)
    const loaded = module.default ?? module
    if (typeof loaded !== 'object' || loaded === null) {
      return {}
    }

    return loaded as TranslationDict
  } catch {
    return {}
  }
}

/** Loads translations for the requested language and makes them active. */
export async function initializeI18n(setting?: LanguageSetting): Promise<void> {
  currentLanguage = resolveLanguage(setting)
  translations = {
    ...BUILTIN_TRANSLATIONS.en,
    ...BUILTIN_TRANSLATIONS[currentLanguage],
    ...(await readUserTranslations(currentLanguage)),
  }
}

/** Changes the active UI language. */
export async function setLanguage(setting: LanguageSetting): Promise<void> {
  await initializeI18n(setting)
}

/** Returns the default built-in language that would be chosen automatically. */
export function getAutoDetectedLanguage(): BuiltinLanguage {
  return detectSystemLanguage()
}

/** Translates a user-visible string and interpolates `{{param}}` placeholders. */
export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = translations[key] ?? key
  if (!params) {
    return template
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}
