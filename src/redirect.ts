import { preferredLang } from './i18n'

// replace, а не assign: корень не должен оставаться в истории,
// иначе кнопка «назад» зациклит посетителя на редиректе.
location.replace(`./${preferredLang()}/`)
