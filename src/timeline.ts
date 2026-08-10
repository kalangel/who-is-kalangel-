/**
 * Скролл-режиссура. Motion — единственный, кто знает про скролл;
 * рендер знает только число. Связь одна: eclipse.setPhase(p).
 *
 * Страница — не лента секций, а скраббер: сцена приколочена к экрану,
 * скролл проматывает по ней время. Поэтому такты текста тоже стоят
 * на месте и сменяют друг друга, а высоту прокрутки дают пустые якоря.
 */

import { animate, scroll } from 'motion'
import type { Eclipse } from './eclipse'

export function bindTimeline(eclipse: Eclipse) {
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
    //
    // Середина якоря против низа, четверти и верха экрана: окно ровно в один
    // экран с центром на якоре. Окна соседних тактов стыкуются, но не
    // перекрываются — призрака предыдущей фразы не будет.
    scroll(
      animate(beat, {
        opacity: [0, 1, 1, 0],
        filter: ['blur(6px)', 'blur(0px)', 'blur(0px)', 'blur(6px)'],
      }),
      {
        target: anchor,
        offset: [
          [0.5, 1],
          [0.5, 0.85],
          [0.5, 0.15],
          [0.5, 0],
        ],
      },
    )
  })
}
