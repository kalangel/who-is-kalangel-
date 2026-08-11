/**
 * ВРЕМЕННЫЙ ЛОГОТИП.
 *
 * Настоящий вордмарк пока существует только растром в переписке — файла в
 * репозитории нет, а трассировать картинку, которой у меня нет на диске,
 * нельзя. Поэтому здесь честная заглушка, собранная из тех элементов
 * настоящей марки, которые задаются геометрией точно: центральная
 * четырёхлучевая звезда, боковые искры и вертикальные засечки по краям.
 *
 * Начертание слова «kalangel» набрано серифом-заменителем и НЕ повторяет
 * оригинальную готическую отрисовку.
 *
 * Чтобы поставить настоящий: положить `wordmark.svg` в `public/`. Он подхватится
 * сам — и в вёрстке, и в маске созвездия (`mark.ts`). Требование к файлу одно:
 * текст переведён в кривые, иначе растеризация в маску потеряет шрифт.
 */

export const MARK_VIEWBOX: [number, number] = [800, 260]

/** Четырёхлучевая звезда: вертикальные лучи длинные, горизонтальные короткие. */
const star = (cx: number, cy: number, v: number, h: number) =>
  `M ${cx} ${cy - v}
   C ${cx + h * 0.08} ${cy - v * 0.3} ${cx + h * 0.3} ${cy - v * 0.08} ${cx + h} ${cy}
   C ${cx + h * 0.3} ${cy + v * 0.08} ${cx + h * 0.08} ${cy + v * 0.3} ${cx} ${cy + v}
   C ${cx - h * 0.08} ${cy + v * 0.3} ${cx - h * 0.3} ${cy + v * 0.08} ${cx - h} ${cy}
   C ${cx - h * 0.3} ${cy - v * 0.08} ${cx - h * 0.08} ${cy - v * 0.3} ${cx} ${cy - v} Z`

const box = (x: number, y: number, w: number, h: number) =>
  `M ${x} ${y} h ${w} v ${h} h ${-w} Z`

export const MARK_PATHS: string[] = [
  star(400, 130, 128, 62),
  star(126, 130, 34, 42),
  star(674, 130, 34, 42),
  box(52, 58, 7, 144),
  box(741, 58, 7, 144),
]

export const MARK_TEXT = {
  text: 'kalangel',
  x: 400,
  y: 152,
  size: 128,
  font: `'Prata', Georgia, serif`,
}

export const WORDMARK_SVG = `
<svg viewBox="0 0 ${MARK_VIEWBOX[0]} ${MARK_VIEWBOX[1]}" role="img" aria-label="kalangel" fill="currentColor">
  ${MARK_PATHS.map((d) => `<path d="${d}"/>`).join('\n  ')}
  <text x="${MARK_TEXT.x}" y="${MARK_TEXT.y}" text-anchor="middle"
        font-family="${MARK_TEXT.font}"
        font-size="${MARK_TEXT.size}" letter-spacing="2">${MARK_TEXT.text}</text>
</svg>`
