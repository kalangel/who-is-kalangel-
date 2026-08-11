/**
 * Режиссура и проходы рендера.
 *
 * Сцена знает одно число — `phase ∈ [0,1]`. Здесь оно превращается в позицию
 * камеры, яркость диска, плотность неба и всё остальное. Вся арт-дирекция
 * живёт в `direct()`: это единственное место, где написано, что и когда
 * происходит на экране.
 *
 * Проходы за кадр:
 *   1. сцена            → HDR-цель (полный размер × renderScale)
 *   2. отбор ярких + ½  → bloom-цель A
 *   3. размытие H, V    → bloom-цель A (радиус 1)
 *   4. ещё ¼ и размытие → bloom-цель B (широкое гало)
 *   5. горизонтальный   → анаморфный след
 *   6. сведение         → экран
 */

import sceneFrag from './scene.frag.glsl?raw'
import brightFrag from './bright.frag.glsl?raw'
import blurFrag from './blur.frag.glsl?raw'
import compositeFrag from './composite.frag.glsl?raw'
import { createTarget, drawTo, program, resizeTarget, type Target } from './gl'
import type { Mark } from '../mark'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const emix = (a: number, b: number, t: number) => Math.exp(mix(Math.log(a), Math.log(b), t))

function S(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a || 1e-6))
  return t * t * (3 - 2 * t)
}

/** Колокол 0 → 1 → 0 внутри окна. */
function bump(a: number, b: number, x: number) {
  if (x <= a || x >= b) return 0
  return Math.sin(((x - a) / (b - a)) * Math.PI)
}

/** Прицельный параметр фотонной сферы: 3√3/2 при rs = 1. Именно этот радиус
 *  зритель видит как край тени, а не сам горизонт. */
const SHADOW_B = 2.598076

/** Раствор объектива в звёздных актах. От него считается и посадка марки. */
const FOV_SKY = 0.6

export interface Renderer {
  setPhase(p: number): void
  destroy(): void
}

interface Shot {
  dist: number
  pitch: number
  yaw: number
  fov: number
  hole: boolean
  lens: number
  disk: number
  glow: number
  limb: number
  swirl: number
  skyD: number
  skyG: number
  nebula: number
  mark: number
  focus: number
  starR: number
  starA: number
  flash: number
  white: number
  bloom: number
  aberr: number
  exposure: number
}

/**
 * СЦЕНАРИЙ. Восемь актов, ни одного скачка: окна перекрываются, поэтому
 * между актами нет момента, где что-то возникает или пропадает разом.
 *
 * `fov0` — раствор объектива в первом акте. Он считается снаружи, из ширины
 * вордмарка: по спеке кольцо описано вокруг логотипа, значит угловой размер
 * тени задаёт вёрстка, а не произвол.
 */
function direct(p: number, t: number, fov0: number): Shot {
  // ---- камера -------------------------------------------------------------
  let dist = 15.5
  dist = mix(dist, 11.5, S(0.1, 0.3, p))
  dist = mix(dist, 7.4, S(0.28, 0.44, p))
  dist = mix(dist, 2.0, S(0.42, 0.515, p)) // падение к горизонту

  let pitch = 0.012 // почти в плоскости диска: в первом акте его не видно
  pitch = mix(pitch, 0.3, S(0.11, 0.28, p))
  pitch = mix(pitch, 0.52, S(0.26, 0.42, p))
  pitch = mix(pitch, 0.08, S(0.42, 0.52, p))

  // Дрейф ограничен синусом, а не линейный: линейный за минуту наблюдения
  // уводит камеру на радиан и утаскивает созвездие за край кадра.
  let yaw = 0.9 * S(0.1, 0.46, p) + Math.sin(t * 0.06) * 0.035

  // После вспышки камера разворачивается на ту сторону неба, где потом
  // соберётся марка. Созвездие приколочено к миру, а не к экрану, — значит
  // прийти к нему обязана камера.
  yaw = mix(yaw, Math.sin(t * 0.05) * 0.03, S(0.56, 0.78, p))
  // Наклон уводится почти в ноль: марка живёт в мире на направлении −Z, и
  // каждая доля наклона смещает её по кадру. При 0.2 логотип уезжает на
  // треть экрана вверх и обрезается краем.
  pitch = mix(pitch, 0.02, S(0.56, 0.78, p))

  // Раствор. В первом акте его диктует вёрстка, дальше камера отходит, чтобы
  // дыра стала предметом в кадре, а не заслонкой во весь экран.
  let fov = fov0
  fov = mix(fov, 0.95, S(0.12, 0.32, p))
  fov = mix(fov, 1.15, S(0.4, 0.52, p))
  // К звёздным актам раствор обязан вернуться в узкий: небо разложено по
  // граням куба, и при угле шире этого в кадр попадает стык соседней грани.
  fov = mix(fov, FOV_SKY, S(0.52, 0.66, p))

  // ---- свет ---------------------------------------------------------------
  let disk = mix(0, 1.0, S(0.13, 0.3, p))
  disk = mix(disk, 1.8, S(0.34, 0.5, p))

  let glow = mix(1.0, 0.32, S(0.1, 0.3, p))
  glow = mix(glow, 0.06, S(0.3, 0.46, p))
  // За вспышкой светила в кадре больше нет. Остаток в 0.06 держал ровно в
  // центре экрана белую точку — на телефоне она читалась не звездой, а
  // дырой в небе рядом с гигантом.
  glow = mix(glow, 0.0, S(0.46, 0.54, p))

  // Кольцо на лимбе держит первый акт и гаснет, когда его работу забирает диск.
  let limb = mix(0.42, 0.16, S(0.12, 0.32, p))
  limb = mix(limb, 0.07, S(0.32, 0.48, p))

  // ---- небо ---------------------------------------------------------------
  // Плотность — не «сколько звёзд хочется», а сколько их разрешает экран.
  // Клетка мельче трёх-четырёх пикселей перестаёт читаться точкой, поэтому
  // отъезд добавляет звёзды слоями, а не одним множителем.
  //
  // Окна растянуты на весь отъезд и перекрываются. Раньше набор шёл двумя
  // короткими рывками (0.62–0.8 и 0.78–0.91), и вместе со ступенькой порога в
  // шейдере это давало ровно то, что на снимках: экран пустого неба, движение
  // пальца — и экран сплошной крупы.
  // Пять ступеней вместо двух, и первая начинается ещё за диском гиганта: небо
  // обязано густеть всё время, пока камера отходит. На двух ступенях весь счёт
  // звёзд набирал последний слой (их у слоя ∼ плотности в квадрате), и набор
  // укладывался в один экран прокрутки — тот самый скачок со снимков.
  let skyD = mix(1.05, 1.4, S(0.18, 0.46, p))
  skyD = mix(skyD, 2.6, S(0.48, 0.62, p))
  skyD = mix(skyD, 4.0, S(0.6, 0.74, p))
  skyD = mix(skyD, 6.4, S(0.72, 0.86, p))
  skyD = mix(skyD, 9.0, S(0.84, 0.96, p))

  let skyG = mix(0.55, 0.25, S(0.1, 0.3, p))
  skyG = mix(skyG, 1.05, S(0.5, 0.66, p))
  skyG = mix(skyG, 1.5, S(0.68, 0.9, p))

  // Туманность. Под дырой её почти нет, к звёздным актам небо разгорается:
  // оно должно светить, а не держать точки на чёрном.
  const nebula = mix(1.0, 3.4, S(0.58, 0.9, p))

  // ---- звезда-гигант ------------------------------------------------------
  // Единица здесь — высота кадра целиком: в шейдере uv нормируется на неё,
  // и по вертикали координата идёт от −0.5 до 0.5. Радиус 0.4 — это диаметр
  // в 0.8 экрана, те самые три четверти кадра.
  let starR = emix(2.0, 0.4, S(0.505, 0.61, p))
  starR = emix(starR, 0.0022, S(0.61, 0.84, p))
  const starA = S(0.5, 0.545, p) * (1 - S(0.8, 0.87, p))

  // ---- переходы -----------------------------------------------------------
  const flash = Math.pow(bump(0.43, 0.55, p), 3) * 5.0
  const white = S(0.49, 0.522, p) * (1 - S(0.535, 0.578, p))

  // ---- созвездие ----------------------------------------------------------
  // Рисунок должен успеть сложиться и постоять один экран сам по себе: если
  // дыра приходит на не дочитанное созвездие, ник никто не разберёт.
  // Окно длинное: рисунок собирается позвёздно, и на коротком окне вся
  // россыпь загорается почти разом — смотреть не на что.
  const mark = S(0.68, 0.86, p)

  // Фон отступает, пока читается имя, и возвращается к финалу: закрученные
  // дырой звёзды — половина того, ради чего сделан последний акт.
  const focus = 0.72 * S(0.72, 0.86, p) * (1 - S(0.9, 0.97, p))

  let hole = p < 0.508
  let swirl = 0
  let lens = 1

  // ---- акт VIII: дыра возвращается и выпивает созвездие --------------------
  // Порог здесь — не начало акта, а момент, когда дыра ВКЛЮЧАЕТСЯ в кадр. Она
  // включается заметно раньше, чем становится видна: на пятистах радиусах её
  // тень меньше звезды. Иначе разом менялся способ съёмки — небо без линзы на
  // небо с линзой, — и это читалось скачком, а не приближением.
  if (p > 0.845) {
    const q = S(0.845, 1.0, p)
    hole = true
    // Дыра приходит из глубины кадра точкой и вырастает до всего экрана.
    // Расстояние идёт по логарифму: угловой размер тени обратен дистанции,
    // и только на логарифме он растёт ровно, без рывка в конце.
    // Останов не вплотную: если подойти до конца, тень закрывает кадр
    // целиком и финал — просто чёрный экран. На этой дистанции горизонт
    // занимает три четверти высоты, и вокруг него остаётся горящее кольцо,
    // внутри которого и стоит ссылка. Дверь, а не заслонка.
    dist = emix(700, 9.0, q)
    pitch = mix(0.02, 0.3, q)
    yaw = Math.sin(t * 0.05) * 0.03
    fov = mix(FOV_SKY, 0.78, q)
    // Диск не приходит вместе с дырой: сначала в звёздах появляется искра,
    // и только потом она разгорается. Так у приближения есть отдельный такт,
    // а не одно событие «в кадре стало светло».
    disk = 0.02 + 2.6 * S(0.18, 0.85, q)
    glow = 0
    // Кольцо горит с первого кадра акта, а не разгорается следом. На семистах
    // радиусах тень меньше звезды, и без кольца объект попросту невидим: он
    // «появляется» тогда, когда уже занимает четверть кадра. С кольцом зритель
    // ведёт глазом искру, которая растёт в кольцо, а кольцо — в горизонт.
    limb = 0.13 + 0.22 * S(0.06, 0.55, q)
    swirl = 1.3 * S(0, 1, q)
    lens = S(0, 0.2, q)
  }

  let bloom = mix(0.3, 0.46, S(0.25, 0.45, p))
  // На плотном небе широкий блум работает молоком: тысяча точек, у каждой своё
  // гало, — и созвездие тонет в общем свечении.
  bloom = mix(bloom, 0.32, S(0.56, 0.7, p))
  bloom += flash * 0.04 + S(0.9, 1.0, p) * 0.3

  // Аберрация разгоняется в падении и обязана вернуться. Без возврата она
  // держалась на 0.62 до самого конца, и на снимках каждая звезда у края
  // кадра разобрана на красную и синюю точки — стекло, а не небо.
  let aberr = 0.12 + S(0.4, 0.52, p) * 0.55
  aberr = mix(aberr, 0.1, S(0.55, 0.66, p))
  aberr += S(0.93, 1.0, p) * 0.5

  const exposure = mix(0.95, 1.05, S(0.6, 0.9, p))

  return {
    dist,
    pitch,
    yaw,
    fov,
    hole,
    lens,
    disk,
    glow,
    limb,
    swirl,
    skyD,
    skyG,
    nebula,
    mark,
    focus,
    starR,
    starA,
    flash,
    white,
    bloom,
    aberr,
    exposure,
  }
}

export function createRenderer(canvas: HTMLCanvasElement, mark: Mark): Renderer {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  })
  if (!gl) throw new Error('webgl2 unavailable')

  // Без плавающих целей блум пришлось бы считать в 8 битах: всё, что ярче
  // белого, срезалось бы ещё до отбора, и свечения не осталось бы.
  const float = !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float')
  gl.getExtension('OES_texture_float_linear')

  const mobile = matchMedia('(pointer: coarse)').matches
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const steps = mobile ? 88 : 160

  const pScene = program(gl, sceneFrag.replace('#define STEPS 128', `#define STEPS ${steps}`))
  const pBright = program(gl, brightFrag)
  const pBlur = program(gl, blurFrag)
  const pComp = program(gl, compositeFrag)

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)

  const scene = createTarget(gl, 2, 2, float)
  const b1a = createTarget(gl, 2, 2, float)
  const b1b = createTarget(gl, 2, 2, float)
  const b2a = createTarget(gl, 2, 2, float)
  const b2b = createTarget(gl, 2, 2, float)
  const stA = createTarget(gl, 2, 2, float)
  const stB = createTarget(gl, 2, 2, float)

  const markTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, markTex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mark.canvas)
  // Мипы обязательны: шейдер берёт маску не точкой, а уровнем — одна выборка
  // должна усреднить целую клетку созвездия. Без этого тонкие штрихи буквы
  // попадают между клетками и слово рассыпается на случайные точки.
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  let phase = 0
  let w = 0
  let h = 0
  let rw = 0
  let rh = 0
  // Отладочный крючок: ?scale=1 закрепляет разрешение рендера. Нужен для
  // съёмки — софтверный растеризатор всегда проседает до нижней границы, и по
  // такому кадру нельзя судить ни о плотности неба, ни о читаемости созвездия.
  const pinned = Number(new URLSearchParams(location.search).get('scale'))
  const fixedScale = pinned > 0.2 && pinned <= 1 ? pinned : 0

  let scale = fixedScale || (mobile ? 0.85 : 1)
  let fov0 = 0.55
  let markHalf = 0.42
  let markDensity = 190
  let markLod = 0

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }

  function measureFov() {
    // Композиционный контракт из спеки: кольцо описано вокруг вордмарка.
    // Радиус тени в пикселях задаёт вёрстка (--star-r), отсюда — раствор.
    // Луч через точку экрана уходит под углом uv·fov, а uv — это доля высоты
    // кадра. Значит край тени садится на радиус R пикселей при fov = θ·h/R.
    //
    // Радиус берётся из коробки вордмарка, а не из переменной --star-r:
    // getComputedStyle отдаёт нерезолвленный calc(), parseFloat даёт NaN,
    // и композиция молча уезжает на запасное число.
    const wm = document.querySelector<HTMLElement>('#wordmark')
    const width = wm?.getBoundingClientRect().width ?? h * 0.35
    const starR = Math.max(width / 1.6, 1)
    fov0 = ((SHADOW_B / 15.5) * h) / starR

    // Марка вписывается в кадр по ширине. Фиксированная полуширина верна
    // ровно для одной пропорции экрана: на телефоне логотип 3:1 при ней
    // втрое шире окна, и от созвездия видно середину слова.
    const visHalfX = 0.5 * (w / h) * FOV_SKY
    markHalf = Math.min(0.42, visHalfX * 0.9)

    // Шаг клеток. Два ограничения сразу, и оба обязательные:
    //   • не мельче пяти пикселей ЦЕЛИ рендера — иначе клетка не
    //     разрешается, мип гасит слой, и на просевшем разрешении созвездие
    //     просто исчезает с экрана;
    //   • не мельче трёх с половиной пикселей ЭКРАНА — иначе звёзды сливаются,
    //     и вместо рисунка из точек получается светящаяся наклейка.
    // Отсюда шаг считается от цели, а не от окна.
    //
    // Клетка мельче прежней намеренно. На телефоне вордмарк шириной в экран
    // при шаге в пять экранных пикселей набирался сотней клеток по ширине —
    // по десятку на букву, и «kalangel» не читалось ни при какой яркости.
    const density = rh / h // = dpr × текущий масштаб рендера
    const cell = Math.max(5, 3.2 * density)
    markDensity = rh / (cell * FOV_SKY)

    // Уровень маски: одна выборка должна накрыть клетку целиком. Полшага вниз
    // от точного — рисунку нужна не идеальная фильтрация, а край буквы.
    const cellsAcross = Math.max(2 * markHalf * markDensity, 1)
    markLod = Math.max(0, Math.log2(Math.max(mark.canvas.width / cellsAcross, 1)) - 0.6)
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, mobile ? 2 : 2)
    w = innerWidth
    h = innerHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    rw = Math.round(canvas.width * scale)
    rh = Math.round(canvas.height * scale)
    resizeTarget(gl!, scene, rw, rh, float)
    resizeTarget(gl!, b1a, rw >> 1, rh >> 1, float)
    resizeTarget(gl!, b1b, rw >> 1, rh >> 1, float)
    resizeTarget(gl!, b2a, rw >> 2, rh >> 2, float)
    resizeTarget(gl!, b2b, rw >> 2, rh >> 2, float)
    resizeTarget(gl!, stA, rw >> 2, rh >> 2, float)
    resizeTarget(gl!, stB, rw >> 2, rh >> 2, float)
    measureFov()
  }

  const onPointer = (e: PointerEvent) => {
    pointer.tx = (e.clientX / innerWidth) * 2 - 1
    pointer.ty = -((e.clientY / innerHeight) * 2 - 1)
  }
  addEventListener('pointermove', onPointer, { passive: true })
  addEventListener('resize', resize)
  resize()

  const t0 = performance.now()
  let raf = 0
  let ema = 16
  let last = 0

  /**
   * Один проход размытия. Источник и приёмник обязаны быть разными целями:
   * читать и писать одну текстуру в одном вызове — неопределённое поведение,
   * на практике каша из прошлого кадра.
   */
  function pass(src: Target, dst: Target, dx: number, dy: number, radius: number) {
    gl!.bindTexture(gl!.TEXTURE_2D, src.tex)
    gl!.uniform2f(pBlur.u('uTexel'), 1 / src.w, 1 / src.h)
    gl!.uniform2f(pBlur.u('uDir'), dx, dy)
    gl!.uniform1f(pBlur.u('uRadius'), radius)
    drawTo(gl!, dst)
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const dt = last ? now - last : 16
    last = now
    ema = ema * 0.9 + Math.min(dt, 60) * 0.1

    // Динамическое разрешение. Трассировка геодезик стоит дорого, и лучше
    // отдать резкость, чем частоту: рывок в скролле заметнее мягкости.
    if (fixedScale) {
      // разрешение закреплено вручную — автоматика молчит
    } else if (ema > 26 && scale > 0.55) {
      scale = Math.max(0.55, scale - 0.05)
      resize()
    } else if (ema < 15 && scale < 1) {
      scale = Math.min(1, scale + 0.02)
      resize()
    }

    const t = reduced ? 0 : (now - t0) / 1000
    pointer.x += (pointer.tx - pointer.x) * 0.05
    pointer.y += (pointer.ty - pointer.y) * 0.05

    const s = direct(phase, t, fov0)

    // Базис камеры: смотрит в начало координат, третий столбец — «назад».
    const cp = Math.cos(s.pitch)
    const pos: [number, number, number] = [
      s.dist * Math.sin(s.yaw) * cp,
      s.dist * Math.sin(s.pitch),
      s.dist * Math.cos(s.yaw) * cp,
    ]
    const bz = norm(pos)
    const up: [number, number, number] = [0, 1, 0]
    const bx = norm(cross(up, bz))
    const by = cross(bz, bx)
    const basis = new Float32Array([bx[0], bx[1], bx[2], by[0], by[1], by[2], bz[0], bz[1], bz[2]])

    // ---- 1. сцена ----------------------------------------------------------
    pScene.use()
    gl!.uniform2f(pScene.u('uRes'), scene.w, scene.h)
    gl!.uniform1f(pScene.u('uTime'), t)
    gl!.uniform1f(pScene.u('uPhase'), phase)
    gl!.uniform2f(pScene.u('uPointer'), pointer.x, pointer.y)
    gl!.uniform3f(pScene.u('uCamPos'), pos[0], pos[1], pos[2])
    gl!.uniformMatrix3fv(pScene.u('uCamBasis'), false, basis)
    gl!.uniform1f(pScene.u('uFov'), s.fov)
    gl!.uniform1f(pScene.u('uHoleOn'), s.hole ? 1 : 0)
    gl!.uniform1f(pScene.u('uLensFade'), s.lens)
    gl!.uniform1f(pScene.u('uDisk'), s.disk)
    gl!.uniform1f(pScene.u('uGlow'), s.glow)
    gl!.uniform1f(pScene.u('uLimb'), s.limb)
    gl!.uniform1f(pScene.u('uSwirl'), s.swirl)
    gl!.uniform3f(pScene.u('uLightDir'), -bz[0], -bz[1], -bz[2])
    gl!.uniform1f(pScene.u('uSkyDensity'), s.skyD)
    gl!.uniform1f(pScene.u('uSkyGain'), s.skyG)
    gl!.uniform1f(pScene.u('uNebula'), s.nebula)
    gl!.uniform1f(pScene.u('uMarkAmt'), s.mark)
    gl!.uniform1f(pScene.u('uMarkFocus'), s.focus)
    gl!.uniform1f(pScene.u('uMarkHalf'), markHalf)
    gl!.uniform1f(pScene.u('uMarkDensity'), markDensity)
    gl!.uniform1f(pScene.u('uMarkLod'), markLod)
    gl!.uniform1f(pScene.u('uMarkAspect'), mark.aspect)
    gl!.uniform1f(pScene.u('uStarR'), s.starR)
    gl!.uniform1f(pScene.u('uStarAmt'), s.starA)
    gl!.uniform1f(pScene.u('uFlash'), s.flash)
    gl!.uniform1f(pScene.u('uWhite'), s.white)
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.bindTexture(gl!.TEXTURE_2D, markTex)
    gl!.uniform1i(pScene.u('uMark'), 0)
    drawTo(gl!, scene)

    // ---- 2. отбор ярких ----------------------------------------------------
    pBright.use()
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.bindTexture(gl!.TEXTURE_2D, scene.tex)
    gl!.uniform1i(pBright.u('uSrc'), 0)
    gl!.uniform2f(pBright.u('uTexel'), 1 / scene.w, 1 / scene.h)
    gl!.uniform1f(pBright.u('uThreshold'), 1.0)
    gl!.uniform1f(pBright.u('uKnee'), 0.6)
    drawTo(gl!, b1a)

    // ---- 3. два радиуса свечения + анаморфный след -------------------------
    pBlur.use()
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.uniform1i(pBlur.u('uSrc'), 0)

    // Тугое свечение вокруг источника: пинг-понг в половинном размере.
    pass(b1a, b1b, 1, 0, 1.0)
    pass(b1b, b1a, 0, 1, 1.0)

    // Широкое гало: тот же свет, но в четверти размера и с большим радиусом.
    pass(b1a, b2a, 1, 0, 2.4)
    pass(b2a, b2b, 0, 1, 2.4)

    // Анаморфный след: два прохода подряд по горизонтали — свет вытягивается
    // в линию, как на сферической оптике.
    pass(b1a, stA, 1, 0, 4.0)
    pass(stA, stB, 1, 0, 7.0)

    // ---- 4. сведение -------------------------------------------------------
    pComp.use()
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.bindTexture(gl!.TEXTURE_2D, scene.tex)
    gl!.uniform1i(pComp.u('uScene'), 0)
    gl!.activeTexture(gl!.TEXTURE1)
    gl!.bindTexture(gl!.TEXTURE_2D, b1a.tex)
    gl!.uniform1i(pComp.u('uBloom1'), 1)
    gl!.activeTexture(gl!.TEXTURE2)
    gl!.bindTexture(gl!.TEXTURE_2D, b2b.tex)
    gl!.uniform1i(pComp.u('uBloom2'), 2)
    gl!.activeTexture(gl!.TEXTURE3)
    gl!.bindTexture(gl!.TEXTURE_2D, stB.tex)
    gl!.uniform1i(pComp.u('uStreak'), 3)
    gl!.uniform2f(pComp.u('uRes'), canvas.width, canvas.height)
    gl!.uniform1f(pComp.u('uTime'), t)
    gl!.uniform1f(pComp.u('uBloom'), s.bloom)
    gl!.uniform1f(pComp.u('uAberr'), s.aberr)
    gl!.uniform1f(pComp.u('uVignette'), 0.45)
    gl!.uniform1f(pComp.u('uGrain'), 0.055)
    gl!.uniform1f(pComp.u('uExposure'), s.exposure)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
    gl!.viewport(0, 0, canvas.width, canvas.height)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }

  raf = requestAnimationFrame(frame)

  return {
    setPhase(p) {
      phase = clamp01(p)
    },
    destroy() {
      cancelAnimationFrame(raf)
      removeEventListener('pointermove', onPointer)
      removeEventListener('resize', resize)
    },
  }
}

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
