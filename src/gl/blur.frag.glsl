#version 300 es
precision highp float;

/* Разделимое гауссово размытие для блума. Два прохода вместо одного дают
   тот же результат за 13 выборок вместо 169, поэтому направление приходит
   униформой, а шейдер один. */

out vec4 fragColor;
in vec2 vUv;

uniform sampler2D uSrc;
uniform vec2 uTexel;      // 1/размер источника
uniform vec2 uDir;        // (1,0) или (0,1)
uniform float uRadius;

void main() {
  // Веса линейной выборки: шесть текселей за шесть обращений покрывают
  // ядро в 13 пикселей, потому что билинейный фильтр складывает пары.
  const float w[7] = float[7](0.1964, 0.2969, 0.0944, 0.0103, 0.0021, 0.0006, 0.0002);
  const float o[7] = float[7](0.0, 1.4117, 3.2941, 5.1764, 7.0588, 8.9411, 10.8235);

  vec3 acc = texture(uSrc, vUv).rgb * w[0];
  for (int i = 1; i < 7; i++) {
    vec2 d = uDir * uTexel * o[i] * uRadius;
    acc += texture(uSrc, vUv + d).rgb * w[i];
    acc += texture(uSrc, vUv - d).rgb * w[i];
  }
  fragColor = vec4(acc, 1.0);
}
