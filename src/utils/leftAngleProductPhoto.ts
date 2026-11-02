import calibrationJson from "../../snapink_billboard_angle_left_calibration.json?raw";

type PointPx = [number, number];

interface LeftAngleCalibration {
  hat_master: string;
  hat_master_size_px: [number, number];
  render_size_px: [number, number];
  sleeve_source_size_px: [number, number];
  sleeve_height_percent: number;
  mesh_control_points_hat_native_px: Array<{
    source_u: number;
    upper_hat_native_px: PointPx;
    lower_hat_native_px: PointPx;
  }>;
}

// Keep the approved calibration file as the source of truth. Coordinates are
// only converted from native hat pixels to its saved render canvas at render time.
export const LEFT_ANGLE_CALIBRATION = JSON.parse(calibrationJson) as LeftAngleCalibration;
export const LEFT_ANGLE_HAT_URL = `/${LEFT_ANGLE_CALIBRATION.hat_master.replace(/^public\//, "")}`;

const vertexShaderSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = (a_position + 1.0) * 0.5;
  }
`;

function makeFragmentShaderSource() {
  const controls = LEFT_ANGLE_CALIBRATION.mesh_control_points_hat_native_px;
  const tests = controls.slice(0, -1).map((control, index) => {
    const nextIndex = index + 1;
    const u0 = control.source_u.toFixed(8);
    const u1 = controls[nextIndex].source_u.toFixed(8);
    return `
      if (!mapped) mapped = mapTriangle(p, top${index}, top${nextIndex}, bottom${nextIndex}, vec2(${u0}, vTop), vec2(${u1}, vTop), vec2(${u1}, vBottom), uv);
      if (!mapped) mapped = mapTriangle(p, top${index}, bottom${nextIndex}, bottom${index}, vec2(${u0}, vTop), vec2(${u1}, vBottom), vec2(${u0}, vBottom), uv);`;
  }).join("\n");
  const nodes = controls.map((_, index) => `
      vec2 top${index} = expandedTop(u_meshNodes[${index}].xy, u_meshNodes[${index}].zw, u_heightScale);
      vec2 bottom${index} = expandedBottom(u_meshNodes[${index}].xy, u_meshNodes[${index}].zw, u_heightScale);`).join("");

  return `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_hat;
    uniform sampler2D u_sleeve;
    uniform vec2 u_canvasSize;
    uniform float u_heightScale;
    uniform vec4 u_meshNodes[${controls.length}];

    float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
    vec2 expandedTop(vec2 top, vec2 bottom, float scale) {
      vec2 center = (top + bottom) * 0.5;
      return center + (top - center) * scale;
    }
    vec2 expandedBottom(vec2 top, vec2 bottom, float scale) {
      vec2 center = (top + bottom) * 0.5;
      return center + (bottom - center) * scale;
    }
    bool mapTriangle(vec2 p, vec2 a, vec2 b, vec2 c, vec2 ua, vec2 ub, vec2 uc, out vec2 uv) {
      float denominator = cross2(b - a, c - a);
      if (abs(denominator) < 0.00001) return false;
      float wb = cross2(p - a, c - a) / denominator;
      float wc = cross2(b - a, p - a) / denominator;
      float wa = 1.0 - wb - wc;
      if (wa < -0.0001 || wb < -0.0001 || wc < -0.0001) return false;
      uv = wa * ua + wb * ub + wc * uc;
      return true;
    }

    void main() {
      vec4 hat = texture2D(u_hat, v_uv);
      vec2 p = vec2(v_uv.x * u_canvasSize.x, (1.0 - v_uv.y) * u_canvasSize.y);
      float vTop = 0.5 - 0.5 * u_heightScale;
      float vBottom = 0.5 + 0.5 * u_heightScale;
      ${nodes}
      vec2 uv = vec2(0.0);
      bool mapped = false;
      ${tests}
      vec3 rgb = hat.rgb;
      if (mapped && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        vec4 sleeve = texture2D(u_sleeve, vec2(uv.x, 1.0 - uv.y));
        rgb = mix(rgb, sleeve.rgb, sleeve.a);
      }
      gl_FragColor = vec4(rgb, 1.0);
    }
  `;
}

function compileShader(gl: WebGLRenderingContext, kind: number, source: string) {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error("The left-angle product renderer could not create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const details = gl.getShaderInfoLog(shader) || "Unknown GLSL error.";
    gl.deleteShader(shader);
    throw new Error(`The left-angle product renderer failed to compile: ${details}`);
  }
  return shader;
}

function createTexture(gl: WebGLRenderingContext, image: TexImageSource) {
  const texture = gl.createTexture();
  if (!texture) throw new Error("The left-angle product renderer could not create an image texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return texture;
}

export async function renderLeftAngleProductPhoto(
  hatImage: HTMLImageElement,
  sleeveImage: HTMLImageElement,
): Promise<Blob> {
  const [width, height] = LEFT_ANGLE_CALIBRATION.render_size_px;
  const [nativeWidth, nativeHeight] = LEFT_ANGLE_CALIBRATION.hat_master_size_px;
  if (hatImage.naturalWidth !== nativeWidth || hatImage.naturalHeight !== nativeHeight) {
    throw new Error(`The V27 left-angle hat master must be ${nativeWidth} × ${nativeHeight} pixels.`);
  }
  const controls = LEFT_ANGLE_CALIBRATION.mesh_control_points_hat_native_px;
  const sourceSize = LEFT_ANGLE_CALIBRATION.sleeve_source_size_px;
  if (controls.length < 2 || controls.length > 16 || sourceSize.length !== 2) {
    throw new Error("The V27 left-angle mesh calibration is incomplete or unsupported.");
  }

  const hatCanvas = document.createElement("canvas");
  hatCanvas.width = width;
  hatCanvas.height = height;
  const hatContext = hatCanvas.getContext("2d");
  if (!hatContext) throw new Error("The left-angle hat background could not be prepared.");
  hatContext.imageSmoothingEnabled = true;
  hatContext.imageSmoothingQuality = "high";
  hatContext.drawImage(hatImage, 0, 0, width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext("webgl", { alpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("WebGL is unavailable for the calibrated left-angle product render.");
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (sleeveImage.naturalWidth > maxTextureSize || sleeveImage.naturalHeight > maxTextureSize) {
    throw new Error(`The Studio sleeve export exceeds this browser's ${maxTextureSize}px WebGL texture limit.`);
  }

  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, makeFragmentShaderSource());
  const program = gl.createProgram();
  if (!program) throw new Error("The left-angle product renderer could not create a program.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "The left-angle product renderer could not link.");
  }
  gl.useProgram(program);

  const position = gl.getAttribLocation(program, "a_position");
  const hatLocation = gl.getUniformLocation(program, "u_hat");
  const sleeveLocation = gl.getUniformLocation(program, "u_sleeve");
  const canvasSizeLocation = gl.getUniformLocation(program, "u_canvasSize");
  const heightLocation = gl.getUniformLocation(program, "u_heightScale");
  const meshLocation = gl.getUniformLocation(program, "u_meshNodes[0]");
  const buffer = gl.createBuffer();
  if (!buffer || position < 0 || !hatLocation || !sleeveLocation || !canvasSizeLocation || !heightLocation || !meshLocation) {
    throw new Error("The left-angle product renderer is missing a required WebGL input.");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  createTexture(gl, hatCanvas);
  gl.uniform1i(hatLocation, 0);
  gl.activeTexture(gl.TEXTURE1);
  createTexture(gl, sleeveImage);
  gl.uniform1i(sleeveLocation, 1);
  gl.uniform2f(canvasSizeLocation, width, height);
  gl.uniform1f(heightLocation, LEFT_ANGLE_CALIBRATION.sleeve_height_percent / 100);
  const meshNodes = new Float32Array(controls.length * 4);
  controls.forEach((control, index) => {
    const [upperX, upperY] = control.upper_hat_native_px;
    const [lowerX, lowerY] = control.lower_hat_native_px;
    meshNodes.set([
      upperX * width / nativeWidth,
      upperY * height / nativeHeight,
      lowerX * width / nativeWidth,
      lowerY * height / nativeHeight,
    ], index * 4);
  });
  gl.uniform4fv(meshLocation, meshNodes);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The left-angle product PNG could not be encoded.")),
    "image/png",
  ));
}

export interface ProductPhotoZipEntry {
  filename: string;
  blob: Blob;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createProductPhotoZip(entries: ProductPhotoZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.filename);
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    const checksum = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 33, true); // DOS date 1980-01-01
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, bytes);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 33, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}
