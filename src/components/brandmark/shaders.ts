export const VERTEX_SHADER_SRC = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec2 aUv;

  uniform mat4 uProjection;
  uniform mat4 uModelView;
  uniform mat3 uNormalMatrix;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec2 vUv;

  void main() {
    vec4 viewPosition = uModelView * vec4(aPosition, 1.0);
    vNormal = normalize(uNormalMatrix * aNormal);
    vViewPosition = -viewPosition.xyz;
    vUv = aUv;
    gl_Position = uProjection * viewPosition;
  }
`

export const FRAGMENT_SHADER_SRC = `
  precision highp float;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec2 vUv;

  uniform sampler2D uScreenTexture;
  uniform vec3 uChassisColor;
  uniform vec3 uBezelColor;
  uniform float uPart;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewPosition);

    if (uPart > 0.5 && uPart < 1.5) {
      vec3 content = texture2D(uScreenTexture, vUv).rgb;
      float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
      float glassSweep = pow(max(dot(n, normalize(vec3(-0.35, 0.72, 0.58))), 0.0), 42.0);
      vec3 reflection = vec3(0.12, 0.14, 0.17) * fresnel * 0.22;
      gl_FragColor = vec4(content + reflection + vec3(glassSweep * 0.035), 1.0);
      return;
    }

    vec3 keyDirection = normalize(vec3(-0.55, 0.78, 0.72));
    vec3 fillDirection = normalize(vec3(0.78, 0.20, 0.58));
    vec3 rimDirection = normalize(vec3(0.62, 0.46, -0.64));
    float key = max(dot(n, keyDirection), 0.0);
    float fill = max(dot(n, fillDirection), 0.0);
    float backRim = max(dot(n, rimDirection), 0.0);
    float viewRim = pow(1.0 - max(dot(n, v), 0.0), 2.4);

    vec3 baseColor = uPart > 1.5 ? uBezelColor : uChassisColor;
    float specularPower = uPart > 1.5 ? 54.0 : 20.0;
    float specularStrength = uPart > 1.5 ? 0.28 : 0.20;
    vec3 halfDirection = normalize(keyDirection + v);
    float specular = pow(max(dot(n, halfDirection), 0.0), specularPower);

    float light = 0.27 + key * 0.56 + fill * 0.20;
    vec3 color = baseColor * light;
    color += vec3(1.0, 0.47, 0.20) * specular * specularStrength;
    color += baseColor * viewRim * 0.13;
    color += vec3(1.0, 0.36, 0.12) * backRim * viewRim * 0.10;
    gl_FragColor = vec4(color, 1.0);
  }
`

export function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to allocate a WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compilation error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

export function createProgram(
  gl: WebGLRenderingContext,
  vertexSource = VERTEX_SHADER_SRC,
  fragmentSource = FRAGMENT_SHADER_SRC,
): { program: WebGLProgram; vertexShader: WebGLShader; fragmentShader: WebGLShader } {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  let fragmentShader: WebGLShader | null = null
  let program: WebGLProgram | null = null

  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    program = gl.createProgram()
    if (!program) throw new Error('Unable to allocate a WebGL program')
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'Unknown WebGL link error')
    }
    return { program, vertexShader, fragmentShader }
  } catch (error) {
    if (program) gl.deleteProgram(program)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    gl.deleteShader(vertexShader)
    throw error
  }
}
