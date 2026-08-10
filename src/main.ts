import './styles.css'
import { createEclipse, type Eclipse } from './eclipse'
import { applyContent, detectLang } from './i18n'
import { WORDMARK_SVG } from './wordmark'

const lang = detectLang()
document.documentElement.lang = lang
applyContent(lang)

const wordmark = document.querySelector<HTMLElement>('#wordmark')!
wordmark.innerHTML = WORDMARK_SVG

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!

// Шрифты меняют ширину вордмарка после загрузки, а от неё считается радиус
// кольца. Пересобираем сцену, когда шрифты доехали, — иначе кольцо встанет
// по метрике фолбэка.
const eclipse = createEclipse(canvas, wordmark)
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

// ─────────────────────────────────────────────────────────────────────
// ОСТАВЛЕНО НА MOTION — единственная невыполненная анимация проекта.
//
// Скролл-таймлайн гонит phase от 0 к 1 и разводит появление текста по
// фазам (см. docs/eclipse-spec.md, разделы 5 и 7):
//
//   import { scroll, animate } from 'motion'
//   scroll(({ y }) => eclipse.setPhase(y.progress))
//
// Пока таймлайна нет, phase зафиксирована на 0.5 — полная фаза. Кадр живой
// за счёт вращения короны, но по скроллу не меняется. Это ожидаемое
// состояние, а не недоделка.
// ─────────────────────────────────────────────────────────────────────

// Точка входа не импортируется, поэтому единственный способ отдать рендер
// файлу с таймлайном — объявленный глобал. Именно объявленный: с типом и
// в своём пространстве имён, а не подброшенный в window россыпью.
declare global {
  interface Window {
    kalangel?: { eclipse: Eclipse }
  }
}

window.kalangel = { eclipse }
