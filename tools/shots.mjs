/**
 * Съёмка раскадровки. Кадры, а не код: по спеке картинка проверяется глазами.
 *
 *   node tools/shots.mjs [фазы через запятую] [phone|desk]
 *
 * `?scale=1` обязателен: софтверный растеризатор всегда проседает до нижней
 * границы динамического разрешения, и по такому кадру нельзя судить ни о
 * плотности неба, ни о читаемости созвездия.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const PHASES = (process.argv[2] || '0,0.08,0.18,0.27,0.36,0.45,0.5,0.55,0.62,0.7,0.78,0.86,0.92,0.97,1')
  .split(',')
  .map(Number)
const MODE = process.argv[3] || 'phone'
const OUT = process.env.SHOTS_OUT || 'shots'
const BASE = process.env.SHOTS_BASE || 'http://localhost:5173/ru/'

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})

const ctx =
  MODE === 'phone'
    ? await browser.newContext({
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      })
    : await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const page = await ctx.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (/kalangel|error|Error/.test(t)) console.log('  ·', t)
})

for (const p of PHASES) {
  await page.goto(`${BASE}?scale=1&p=${p}`, { waitUntil: 'load' })
  // Кадру нужно время: шейдер тяжёлый, а на softwar'е первый кадр идёт секунды.
  await page.waitForTimeout(4200)
  const name = `${OUT}/${MODE}-${String(p).replace('.', '_')}.png`
  await page.screenshot({ path: name })
  console.log(name)
}

await browser.close()
