/**
 * Тонкая обвязка над WebGL2. Ровно то, что нужно сцене: программа из пары
 * шейдеров, один полноэкранный треугольник и цели рендера для блума.
 *
 * Никакого фреймворка. Вся сцена — это один фрагментный шейдер, поэтому
 * геометрии в проекте не существует в принципе.
 */

/** Полноэкранный ТРЕУГОЛЬНИК, а не квад: одна лишняя вершина, зато нет шва
 *  по диагонали, на котором GPU дважды считает пиксели стыка. */
export const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // Номера строк в логе драйвера бесполезны без исходника — печатаем с ними.
    const log = gl.getShaderInfoLog(sh) ?? ''
    const numbered = src
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(4)} | ${l}`)
      .join('\n')
    throw new Error(`shader compile failed:\n${log}\n${numbered}`)
  }
  return sh
}

export interface Program {
  use(): void
  /** Кеширует локейшены: getUniformLocation в кадровом цикле — это мусор в GC. */
  u(name: string): WebGLUniformLocation | null
  handle: WebGLProgram
}

export function program(gl: WebGL2RenderingContext, fragSrc: string): Program {
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`link failed: ${gl.getProgramInfoLog(p)}`)
  }
  const cache = new Map<string, WebGLUniformLocation | null>()
  return {
    handle: p,
    use: () => gl.useProgram(p),
    u(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name))
      return cache.get(name)!
    },
  }
}

export interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}

/**
 * Цель рендера в плавающей точке. HDR обязателен: ядро звезды и допплеровский
 * бок диска светят далеко за единицу, и именно этот запас потом собирает блум.
 * В 8 битах всё выше белого просто отрезается, и свечения не будет.
 */
export function createTarget(gl: WebGL2RenderingContext, w: number, h: number, float: boolean): Target {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()!
  const t: Target = { fbo, tex, w: 0, h: 0 }
  resizeTarget(gl, t, w, h, float)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return t
}

export function resizeTarget(
  gl: WebGL2RenderingContext,
  t: Target,
  w: number,
  h: number,
  float: boolean,
) {
  w = Math.max(1, Math.round(w))
  h = Math.max(1, Math.round(h))
  if (t.w === w && t.h === h) return
  t.w = w
  t.h = h
  gl.bindTexture(gl.TEXTURE_2D, t.tex)
  if (float) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  }
}

export function drawTo(gl: WebGL2RenderingContext, t: Target | null) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null)
  if (t) gl.viewport(0, 0, t.w, t.h)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}
