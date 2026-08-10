/**
 * Язык определяется адресом: /ru/, /en/, /de/. Переключателя в интерфейсе нет.
 * Тексты подставляются в элементы с атрибутом data-t.
 */

import ru from './content/ru.json'
import en from './content/en.json'
import de from './content/de.json'

export const LANGS = ['ru', 'en', 'de'] as const
export type Lang = (typeof LANGS)[number]

const DICT: Record<Lang, Record<string, string>> = { ru, en, de }

export function detectLang(pathname = location.pathname): Lang {
  const hit = LANGS.find((l) => pathname.includes(`/${l}/`) || pathname.endsWith(`/${l}`))
  return hit ?? 'en'
}

/** Язык по умолчанию для корня. Это маршрутизация, а не переключатель. */
export function preferredLang(): Lang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.slice(0, 2).toLowerCase()
    const hit = LANGS.find((l) => l === base)
    if (hit) return hit
  }
  return 'en'
}

export function applyContent(lang: Lang, root: ParentNode = document) {
  const dict = DICT[lang]
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    const key = el.dataset.t
    if (key && dict[key]) el.textContent = dict[key]
  })
}
