// =====================================================================
// 공포 색보정 셰이더 (팀원 postfx.js 의 HorrorShader 이식)
//   채도 낮추기 + 어두운 곳 붉은 기 + 비네팅 + 필름 노이즈 + 색수차 + 심장 박동 맥동
//   리빌딩: 붉은 서재·공포 테마의 '중간/높음' 품질에서 OutputPass 뒤에 한 번 더 그린다.
// =====================================================================
export const GRADE_PRESETS = {
  study: { desaturate: 0.22, vignette: 1.0, grain: 0.045, aberration: 0.0018, warm: 1 },
  horror: { desaturate: 0.35, vignette: 1.1, grain: 0.06, aberration: 0.0012, warm: 0 },
};

export function makeGradeShader(preset) {
  return {
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
      desaturate: { value: preset.desaturate },
      vignette: { value: preset.vignette },
      grain: { value: preset.grain },
      aberration: { value: preset.aberration },
      warm: { value: preset.warm },
      pulse: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float time, desaturate, vignette, grain, aberration, pulse, warm;
      varying vec2 vUv;
      float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 c = vUv - 0.5;
        float d = length(c);
        vec2 off = c * aberration * (1.0 + d * 3.0);
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum), desaturate);
        vec3 tintDark = mix(vec3(0.95, 1.0, 1.04), vec3(1.05, 0.92, 0.88), warm);
        vec3 tintLight = mix(vec3(0.97, 1.0, 1.0), vec3(1.0, 0.98, 0.94), warm);
        col *= mix(tintDark, tintLight, smoothstep(0.0, 0.6, lum));
        float v = smoothstep(0.85, 0.2, d * (vignette + pulse * 0.6));
        col *= mix(0.15, 1.0, v);
        col += vec3(0.25, 0.0, 0.0) * pulse * (1.0 - v);
        float n = rand(vUv * vec2(1920.0, 1080.0) + fract(time * 13.0)) - 0.5;
        col += n * grain;
        col *= 0.97 + 0.03 * sin(time * 50.0) * sin(time * 3.1);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  };
}
