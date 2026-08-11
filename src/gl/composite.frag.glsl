#version 300 es
precision highp float;

/* Сведение кадра. Здесь HDR превращается в картинку: блум, анаморфный след,
   хроматическая аберрация по краям, плёночная кривая, виньетка и зерно.

   Это не украшательство поверх готового: сцена намеренно светит далеко за
   единицу, и без этого прохода она выглядит пережжённой. */

out vec4 fragColor;
in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform sampler2D uStreak;
uniform vec2  uRes;
uniform float uTime;
uniform float uBloom;
uniform float uAberr;
uniform float uVignette;
uniform float uGrain;
uniform float uExposure;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

/* ACES, приближение Нарковича. Держит перегруз в цвете: без него ядро звезды
   уходит в плоский белый круг, а с ним — золотится к краю. */
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 q = uv - 0.5;
  float r2 = dot(q, q);

  // Аберрация растёт от центра: в середине кадра стекло идеальное, по краям
  // разъезжается. Равномерная по кадру читается браком, а не оптикой.
  // Множитель маленький намеренно: звезда занимает пиксель, и сдвиг даже в
  // три пикселя разбирает её на красную и синюю точки.
  float k = uAberr * (0.15 + r2 * 3.4);
  vec2 off = q * k * 0.008;
  vec3 col;
  col.r = texture(uScene, uv + off).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - off).b;

  vec3 b = texture(uBloom1, uv).rgb * 0.62 + texture(uBloom2, uv).rgb * 0.85;
  vec3 st = texture(uStreak, uv).rgb;

  col += b * uBloom;
  col += st * uBloom * 0.30 * vec3(1.0, 0.86, 0.72);

  col *= uExposure;
  col = aces(col);

  // Виньетка и лёгкий тёплый подъём в тенях: чистый чёрный на экране
  // телефона выглядит выключенным пикселем, а не темнотой.
  float vig = 1.0 - uVignette * smoothstep(0.18, 0.95, r2 * 2.0);
  col *= vig;
  col += vec3(0.016, 0.009, 0.006) * (1.0 - r2);

  // Зерно. Дёргается покадрово: ползущее читается текстурой поверх кадра.
  float g = hash(gl_FragCoord.xy + fract(uTime) * 941.0) - 0.5;
  col += g * uGrain * (0.25 + 0.75 * (1.0 - dot(col, vec3(0.33))));

  fragColor = vec4(col, 1.0);
}
