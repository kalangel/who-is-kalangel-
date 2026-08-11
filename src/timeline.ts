/**
 * Скролл-режиссура. Страница — не лента секций, а скраббер: сцена приколочена
 * к экрану, прокрутка проматывает по ней время. Высоту дают пустые якоря.
 *
 * Единственная связь со сценой — `setPhase(p)`. Всё остальное, что живёт в
 * DOM (вордмарк, подсказка, ссылка), гасится и зажигается здесь же, по тому
 * же числу: два независимых источника правды рано или поздно разъезжаются.
 */

import Lenis from 'lenis'
import { scroll } from 'motion'
import type { Renderer } from './gl/renderer'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function S(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * Инерционный скролл. Не украшение: нативная прокрутка идёт скачками по
 * несколько десятков пикселей, и таймлайн, привязанный к ней, дёргается —
 * тело затмения прыгает вместо движения.
 */
function smoothScroll() {
  if (reduced) return
  const lenis = new Lenis({
    duration: 1.15,
    easing: (t: number) => 1 - Math.pow(1 - t, 3.2),
    smoothWheel: true,
    // На телефоне своя инерция, поверх неё сглаживание ощущается залипанием.
    syncTouch: false,
  })
  const raf = (time: number) => {
    lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
}

export function bindTimeline(renderer: Renderer) {
  const wordmark = document.querySelector<HTMLElement>('#wordmark')
  const hint = document.querySelector<HTMLElement>('.scroll-hint')
  const outro = document.querySelector<HTMLElement>('.outro')

  /** Кадр по фазе: `phase` гасит DOM ровно так же, как это делает прокрутка. */
  const apply = (p: number) => {
    renderer.setPhase(p)

    // Вордмарк живёт только в первом акте, внутри тени. Дальше имя исчезает
    // вместе с ответом — и возвращается уже созвездием, но это рисует шейдер.
    if (wordmark) {
      const out = S(0.045, 0.115, p)
      wordmark.style.opacity = String(1 - out)
      wordmark.style.transform = `scale(${1 + out * 0.5})`
      wordmark.style.filter = `blur(${out * 14}px)`
    }

    if (hint) hint.style.opacity = String(1 - S(0.004, 0.03, p))

    // Ссылка проявляется, когда горизонт уже закрыл кадр и смотреть больше
    // не на что. Это единственное действие на сайте.
    if (outro) {
      const on = S(0.955, 0.995, p)
      outro.style.opacity = String(on)
      outro.style.pointerEvents = on > 0.6 ? 'auto' : 'none'
      outro.style.transform = `scale(${0.94 + on * 0.06})`
    }
  }

  // Отладочный крючок: ?p=0.74 закрепляет фазу. Нужен для съёмки — иначе
  // каждый кадр раскадровки приходится ловить прокруткой, а с инерцией лениса
  // одно и то же число дважды не поймать.
  const pinned = new URLSearchParams(location.search).get('p')
  if (pinned !== null && Number.isFinite(Number(pinned))) {
    apply(clamp01(Number(pinned)))
    return
  }

  smoothScroll()
  scroll(apply)
}
