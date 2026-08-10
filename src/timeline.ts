/**
 * Скролл-режиссура. Motion — единственный, кто знает про скролл;
 * сцена знает только число. Связь одна: scene.setPhase(p).
 *
 * Страница — не лента секций, а скраббер: сцена приколочена к экрану,
 * скролл проматывает по ней время. Высоту прокрутки дают пустые якоря.
 */

import Lenis from 'lenis'
import { animate, scroll } from 'motion'
import type { Scene } from './scene'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Инерционный скролл. Не украшение: нативная прокрутка идёт скачками по
 * несколько десятков пикселей, и таймлайн, привязанный к ней, дёргается —
 * тело затмения прыгает вместо движения.
 *
 * Lenis прокручивает страницу по-настоящему, поэтому scroll() из motion
 * работает без переходников.
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

export function bindTimeline(scene: Scene) {
  smoothScroll()

  const anchors = Array.from(document.querySelectorAll<HTMLElement>('.anchor'))

  // Прогресс всей страницы → фаза сцены. Больше связей нет.
  scroll((progress: number) => scene.setPhase(progress))

  // Подсказка нужна только пока не начали прокручивать.
  const hint = document.querySelector<HTMLElement>('.scroll-hint')
  if (hint && anchors[0]) {
    scroll(animate(hint, { opacity: [1, 0] }), {
      target: anchors[0],
      offset: [
        [0.5, 0.5],
        [0.5, 0.1],
      ],
    })
  }

  // Ссылка проявляется на схлопывании, когда на экране уже почти ничего нет.
  const outro = document.querySelector<HTMLElement>('.outro')
  const last = anchors[anchors.length - 1]
  if (outro && last) {
    scroll(animate(outro, { opacity: [0, 0, 1] }), {
      target: last,
      offset: [
        [0.5, 1],
        [0.5, 0.35],
        [0.5, 0],
      ],
    })
  }
}
