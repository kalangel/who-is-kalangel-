import './styles.css'
import { applyContent, detectLang } from './i18n'
import { bindTimeline } from './timeline'
import { buildMark } from './mark'
import { createRenderer } from './gl/renderer'
import { WORDMARK_SVG } from './wordmark'

/** Канал ещё не выдан. Впиши сюда https://t.me/… и CTA станет ссылкой. */
const TELEGRAM_URL: string = ''

const lang = detectLang()
document.documentElement.lang = lang
applyContent(lang)

const wordmark = document.querySelector<HTMLElement>('#wordmark')!
wordmark.innerHTML = WORDMARK_SVG

const cta = document.querySelector<HTMLElement>('.cta')!
if (TELEGRAM_URL) {
  const a = document.createElement('a')
  a.href = TELEGRAM_URL
  a.rel = 'noopener'
  a.target = '_blank'
  a.textContent = cta.textContent
  cta.replaceChildren(a)
}

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!

/**
 * Маска марки строится до первого кадра: созвездие в финале собирается по ней,
 * и подменять текстуру на ходу — значит получить кадр, где половина звёзд уже
 * в рисунке, а половина ещё нет.
 */
buildMark().then((mark) => {
  try {
    const renderer = createRenderer(canvas, mark)
    bindTimeline(renderer)
    document.body.classList.add('ready')
  } catch (err) {
    // WebGL2 нет — показываем статичный первый экран, а не пустоту.
    console.warn(err)
    document.body.classList.add('fallback')
  }
})
