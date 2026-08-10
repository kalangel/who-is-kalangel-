import './styles.css'
import { createScene, type Scene } from './scene'
import { applyContent, detectLang } from './i18n'
import { bindTimeline } from './timeline'
import { WORDMARK_SVG } from './wordmark'

/** Канал ещё не выдан. Впиши сюда https://t.me/… и CTA станет ссылкой. */
const TELEGRAM_URL: string = ''

const lang = detectLang()
document.documentElement.lang = lang
applyContent(lang)

const wordmark = document.querySelector<HTMLElement>('#wordmark')!
wordmark.innerHTML = WORDMARK_SVG

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!

// Шрифты меняют ширину вордмарка после загрузки. Пересобираем сцену, когда
// они доехали, — иначе композиция встанет по метрике фолбэка.
const scene = createScene(canvas, wordmark)
document.fonts?.ready.then(() => window.dispatchEvent(new Event('resize')))

// Местное время посетителя. Данные бесплатные, эффект — присутствие.
const clock = document.querySelector<HTMLElement>('#clock')
if (clock) {
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString(lang, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }
  tick()
  setInterval(tick, 1000)
}

// Плитка зерна: монохромный шум, склеивается сама с собой по краям за счёт
// повтора. 128 достаточно, чтобы повтор не читался, и это 16 КБ памяти.
{
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 145
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)

  const grain = document.createElement('div')
  grain.className = 'grain'
  grain.setAttribute('aria-hidden', 'true')
  grain.style.backgroundImage = `url(${c.toDataURL()})`
  document.body.append(grain)
}

bindTimeline(scene)

// Ссылка на канал ещё не выдана. Пока её нет, CTA остаётся текстом:
// мёртвая ссылка хуже её отсутствия, а ссылка «куда-нибудь» — хуже обеих.
if (TELEGRAM_URL) {
  document.querySelectorAll<HTMLElement>('.cta').forEach((el) => {
    const a = document.createElement('a')
    a.href = TELEGRAM_URL
    a.rel = 'noopener'
    a.target = '_blank'
    a.textContent = el.textContent
    el.replaceChildren(a)
  })
}

// Точка входа не импортируется, поэтому единственный способ отдать рендер
// наружу — объявленный глобал. Именно объявленный: с типом и в своём
// пространстве имён, а не подброшенный в window россыпью.
declare global {
  interface Window {
    kalangel?: { scene: Scene }
  }
}

window.kalangel = { scene }
