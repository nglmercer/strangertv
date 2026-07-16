export const VERTEX_SHADER_SRC = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uProjection;
  uniform mat4 uModelView;
  uniform mat3 uNormalMatrix;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(uNormalMatrix * aNormal);
    vec4 mvPos = uModelView * vec4(aPosition, 1.0);
    vViewPosition = -mvPos.xyz;
    gl_Position = uProjection * mvPos;
  }
`

export const FRAGMENT_SHADER_SRC = `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  uniform vec3 uLightDir;

  uniform vec3 uChassisColor;
  uniform vec3 uScreenColor;
  uniform vec3 uStarColor;
  uniform float uPart; // 0.0 = Chassis, 1.0 = Screen, 2.0 = Star

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uLightDir);
    vec3 v = normalize(vViewPosition);

    // Front/back lighting balance
    float diff = max(dot(n, l), 0.0) * 0.8 + 0.2;

    vec3 halfDir = normalize(l + v);

    vec3 baseColor = uChassisColor;
    float shininess = 16.0;
    float specStrength = 0.4;

    if (uPart > 1.5) {
      baseColor = uStarColor;
      shininess = 64.0;      // Super polished chrome star & orbit ring
      specStrength = 1.2;
    } else if (uPart > 0.5) {
      baseColor = uScreenColor;
      shininess = 48.0;      // High glossy piano-black screen glass
      specStrength = 0.8;
    }

    float specFactor = pow(max(dot(n, halfDir), 0.0), shininess);

    vec3 ambient = baseColor * 0.25;
    vec3 diffuse = baseColor * diff * 0.75;
    vec3 specular = vec3(1.0, 0.95, 0.9) * specFactor * specStrength; // Slightly warm metallic sheen

    gl_FragColor = vec4(ambient + diffuse + specular, 1.0);
  }
`

export function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("WebGL Compilation Error:", gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}
