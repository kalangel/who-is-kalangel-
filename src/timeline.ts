/**
 * Скролл-режиссура. Motion — единственный, кто знает про скролл;
 * рендер знает только число. Связь одна: eclipse.setPhase(p).
 *
 * Страница — не лента секций, а скраббер: сцена приколочена к экрану,
 * скролл проматывает по ней время. Поэтому такты текста тоже стоят
 * на месте и сменяют друг друга, а высоту прокрутки дают пустые якоря.
 */

import Lenis from 'lenis'
import { animate, scroll } from 'motion'
import type { Eclipse } from './eclipse'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Инерционный скролл. Не украшение: нативная прокрутка идёт дискретными
 * скачками по несколько десятков пикселей, и таймлайн, привязанный к ней,
 * дёргается — тело затмения прыгает вместо движения. Сглаживание
 * превращает скачки в непрерывную величину.
 *
 * Lenis прокручивает страницу по-настоящему, поэтому scroll() из motion
 * продолжает работать без переходников.
 */
function smoothScroll() {
  if (reduced) return

  const lenis = new Lenis({
    duration: 1.1,
    // Экспоненциальный выход: быстро подхватывает, мягко останавливается.
    easing: (t: number) => 1 - Math.pow(1 - t, 3.2),
    // Тач не трогаем: на телефоне своя инерция, поверх неё сглаживание
    // ощущается как залипание.
    smoothWheel: true,
    syncTouch: false,
  })

  const raf = (time: number) => {
    lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
}

/**
 * Оборачивает содержимое в маску: текст выезжает из-под края, а не
 * проступает из прозрачности. Проявление непрозрачностью — самый дешёвый
 * из возможных приёмов, его видно сразу.
 */
function mask(el: HTMLElement): HTMLElement {
  const inner = document.createElement('span')
  inner.className = 'reveal'
  inner.append(...el.childNodes)
  el.append(inner)
  el.classList.add('masked')
  return inner
}

export function bindTimeline(eclipse: Eclipse) {
  smoothScroll()

  const beats = Array.from(document.querySelectorAll<HTMLElement>('.beat'))
  const anchors = Array.from(document.querySelectorAll<HTMLElement>('.anchor'))

  // Прогресс всей страницы → фаза затмения.
  scroll((progress: number) => eclipse.setPhase(progress))

  // Подсказка о прокрутке нужна только пока не начали прокручивать.
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

  beats.forEach((beat, i) => {
    const anchor = anchors[i]
    if (!anchor) return

    // Смещения задаются парами [доля цели, доля контейнера] — только так
    // можно поставить ключи в разные точки прокрутки.
    //
    // Осторожно: одиночное число здесь означает НЕ долю прокрутки, а край
    // (target N% совмещается с container N%). Для якоря высотой в экран все
    // такие ключи сходятся в одну и ту же позицию, диапазон анимации
    // вырождается в ноль, и такт навсегда застревает на первом кадре.
    const offset: [number, number][] = [
      [0.5, 1],
      [0.5, 0.85],
      [0.5, 0.15],
      [0.5, 0],
    ]

    scroll(animate(beat, { opacity: [0, 1, 1, 0] }), { target: anchor, offset })

    // Строки выезжают из маски со сдвигом друг относительно друга: подпись
    // трогается первой, фраза догоняет. Одновременный въезд читается как
    // один блок, а не как набор.
    const rows = Array.from(beat.querySelectorAll<HTMLElement>('.label, .line, .cta'))
    rows.forEach((row, k) => {
      const inner = mask(row)
      const lead = 0.03 * k
      scroll(
        animate(inner, {
          y: ['115%', '0%', '0%', '-60%'],
          opacity: [0, 1, 1, 0],
        }),
        {
          target: anchor,
          offset: [
            [0.5, 1 - lead],
            [0.5, 0.82 - lead],
            [0.5, 0.15],
            [0.5, 0],
          ],
        },
      )
    })
  })
}
