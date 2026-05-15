import {
  Canvas,
  Fill,
  Shader,
  Skia,
  useClock,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

const source = Skia.RuntimeEffect.Make(`
uniform vec3 uResolution;
uniform float uTime;

float ring(vec2 uv, float radius, float width) {
  return 1.0 - smoothstep(width, width + 0.014, abs(length(uv) - radius));
}

vec4 main(vec2 fragCoord) {
  vec2 center = uResolution.xy * 0.5;
  float size = min(uResolution.x, uResolution.y);
  vec2 uv = (fragCoord - center) / size * 2.0;
  float dist = length(uv);
  float t = uTime;
  float angle = atan(uv.y, uv.x);
  float sweep = fract((angle + 3.14159265) / 6.2831853 - t * 0.45);

  vec3 purple = vec3(0.611765, 0.262745, 0.996078);
  vec3 cyan = vec3(0.298039, 0.760784, 0.913725);
  vec3 blue = vec3(0.062745, 0.078431, 0.600000);

  float outer = ring(uv, 0.55, 0.055);
  float tail = smoothstep(0.0, 0.18, sweep) * (1.0 - smoothstep(0.48, 1.0, sweep));
  float pulse = 0.72 + 0.28 * sin(t * 3.6);
  vec3 ringColor = mix(purple, cyan, smoothstep(0.0, 0.85, sweep));
  vec3 color = ringColor * outer * tail * pulse;
  float alpha = outer * tail;
  color += blue * ring(uv, 0.34, 0.022) * 0.26;
  alpha += ring(uv, 0.34, 0.022) * 0.18;

  float softMask = 1.0 - smoothstep(0.72, 0.86, dist);
  color *= softMask;
  alpha = clamp(alpha * softMask, 0.0, 1.0);

  return vec4(color * alpha, alpha);
}
`);

type OrbLoaderProps = {
  size?: number;
};

export function OrbLoader({ size = 42 }: OrbLoaderProps) {
  const clock = useClock();

  const uniforms = useDerivedValue(() => ({
    uResolution: [size, size, 1],
    uTime: clock.value / 1000,
  }), [clock, size]);

  if (source === null) {
    return null;
  }

  return (
    <Canvas style={{ width: size, height: size }}>
      <Fill>
        <Shader source={source} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
