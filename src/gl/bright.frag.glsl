#version 300 es
precision highp float;

/* Отбор ярких мест + уменьшение вдвое. Порог мягкий: жёсткий даёт ступеньку
   на кромке свечения, и блум читается наклеенным ореолом. */

out vec4 fragColor;
in vec2 vUv;

uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;

void main() {
  vec3 c = vec3(0.0);
  c += texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;

  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, l - uThreshold) / max(l, 1e-4);

  fragColor = vec4(c * k, 1.0);
}
