export const VERTEX_SHADER_SRC = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uProjection;
  uniform mat4 uModelView;
  uniform mat3 uNormalMatrix;
  varying vec3 vNormal;
  void main() {
    vNormal = uNormalMatrix * aNormal;
    gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
  }
`

export const FRAGMENT_SHADER_SRC = `
  precision highp float;
  varying vec3 vNormal;
  uniform vec3 uLightDir;

  uniform vec3 uChassisColor;
  uniform vec3 uScreenColor;
  uniform vec3 uStarColor;
  uniform float uPart; // 0.0 = Chassis, 1.0 = Screen, 2.0 = Star

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uLightDir);
    float diff = clamp(dot(n, l), 0.0, 1.0);

    // Dynamic specularity based on material type
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(l + viewDir);
    float specFactor = pow(max(dot(n, halfDir), 0.0), 32.0);

    vec3 baseColor = uChassisColor;
    float shininess = 0.25;

    if (uPart > 1.5) {
      baseColor = uStarColor;
      shininess = 0.85; // Mirror shine on gold/orange star
    } else if (uPart > 0.5) {
      baseColor = uScreenColor;
      shininess = 0.50; // High glossy screen reflections
    }

    vec3 ambient = baseColor * 0.22;
    vec3 diffuse = baseColor * diff * 0.78;
    vec3 specular = vec3(1.0) * specFactor * shininess;

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
