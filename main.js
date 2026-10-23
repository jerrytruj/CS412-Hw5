const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;

uniform mat4 uModelView;
uniform mat4 uProjection;

out vec3 vPosition;
out vec3 vNormal;

void main() {
  vec4 p = uModelView * vec4(aPosition, 1.0);
  vPosition = p.xyz;
  vNormal = mat3(uModelView) * aNormal;
  gl_Position = uProjection * p;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec3 vPosition;
in vec3 vNormal;

uniform vec3 uLightPos;     // light 1, eye space
uniform vec3 uLightColor;   // light 1 color
uniform vec3 uLightPos2;    // light 2, eye space
uniform vec3 uLightColor2;  // light 2 color
uniform vec3 uColor;
uniform float uKs;          // specular strength, 0 = matte
uniform float uShininess;   // highlight tightness
uniform bool uFlat;

out vec4 fragColor;

// Diffuse + specular from one light
vec3 shadeLight(vec3 lightPos, vec3 lightColor, vec3 N, vec3 V, vec3 Kd, vec3 Ks) {
  vec3 L = normalize(lightPos - vPosition);
  vec3 R = reflect(-L, N);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(V, R), 0.0), uShininess);
  return lightColor * (Kd * diff + Ks * spec);
}

void main() {
  vec3 Ka = 0.2 * uColor;
  vec3 Kd = 0.8 * uColor;
  vec3 Ks = vec3(uKs);

  vec3 N = normalize(vNormal);
  if (uFlat) N = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
  vec3 V = normalize(-vPosition);           // camera sits at the origin

  vec3 result = Ka;                                              // ambient, added once
  result += shadeLight(uLightPos, uLightColor, N, V, Kd, Ks);    // light 1
  result += shadeLight(uLightPos2, uLightColor2, N, V, Kd, Ks);  // light 2

  fragColor = vec4(result, 1.0);
}
`;

// WebGL setup
const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl2");

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

// Fixed attribute slots, so the meshes stay valid when the shaders are recompiled
const ATTRIBUTES = { aPosition: 0, aNormal: 1 };

function createProgram(vsSource, fsSource) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
  for (const name in ATTRIBUTES) gl.bindAttribLocation(prog, ATTRIBUTES[name], name);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

// Shader editors
const vertEditor = document.getElementById("vertEditor");
const fragEditor = document.getElementById("fragEditor");
const shaderError = document.getElementById("shaderError");
vertEditor.value = VERTEX_SHADER;
fragEditor.value = FRAGMENT_SHADER;

let program, uModelView, uProjection, uColor, uKs, uShininess, uFlat;
let uLightPos, uLightColor, uLightPos2, uLightColor2;

function updateProgram() {
  try {
    const prog = createProgram(vertEditor.value, fragEditor.value);
    gl.deleteProgram(program);
    program = prog;
    gl.useProgram(program);
    uModelView = gl.getUniformLocation(program, "uModelView");
    uProjection = gl.getUniformLocation(program, "uProjection");
    uColor = gl.getUniformLocation(program, "uColor");
    uKs = gl.getUniformLocation(program, "uKs");
    uShininess = gl.getUniformLocation(program, "uShininess");
    uFlat = gl.getUniformLocation(program, "uFlat");
    uLightPos = gl.getUniformLocation(program, "uLightPos");
    uLightColor = gl.getUniformLocation(program, "uLightColor");
    uLightPos2 = gl.getUniformLocation(program, "uLightPos2");
    uLightColor2 = gl.getUniformLocation(program, "uLightColor2");
    shaderError.textContent = "";
  } catch (e) {
    shaderError.textContent = e.message.replace(/\0/g, "");  // some drivers end the log with \0
  }
}
updateProgram();
vertEditor.addEventListener("input", updateProgram);
fragEditor.addEventListener("input", updateProgram);

function bindAttribute(name, data) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.vertexAttribPointer(ATTRIBUTES[name], 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(ATTRIBUTES[name]);
}

function createMesh({ positions, normals, indices }) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  bindAttribute("aPosition", positions);
  bindAttribute("aNormal", normals);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  return { vao, count: indices.length };
}

const cubeMesh = createMesh(createCube());
const cylinderMesh = createMesh(createCylinder(32));
const armMesh = createMesh(createCylinder(8));
const sphereMesh = createMesh(generateSphere(1, 10, 10));
const coneMesh = createMesh(generateCone(0.06, 0.6, 20));

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 1);
const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100);

// Two lights, fixed in the world
const lightWorld = [3, 4, 5];            // light 1 (warm white), moved by the sliders
const lightWorld2 = [-4, 2, 3];          // light 2 (cool blue), from the other side
const lightColor1 = [1.0, 0.95, 0.85];
const lightColor2 = [1.0, 0.95, 0.85];

// Interactive controls
let dragRotX = 0, dragRotY = -0.5;      // mouse drag
let camX = 0, camY = 0, camZ = -9;      // arrow keys, w, s
let sliderAngle = 0;                    // degrees
let spinning = false, spinAngle = 0;    // Start/Stop button
let lowerAngle = 0, upperAngle = 0, handAngle = 0;    // segment sliders, in degrees

let mouseDown = false, lastX, lastY;
canvas.addEventListener("mousedown", e => { mouseDown = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("mouseup", () => mouseDown = false);
window.addEventListener("mousemove", e => {
  if (!mouseDown) return;
  dragRotY += (e.clientX - lastX) * 0.01;
  dragRotX += (e.clientY - lastY) * 0.01;
  lastX = e.clientX; lastY = e.clientY;
});

document.addEventListener("keydown", e => {
  if (e.target === vertEditor || e.target === fragEditor) return;  // let the editors use the keys
  const step = 0.2;
  switch (e.key) {
    case "ArrowUp": camY -= step; break;
    case "ArrowDown": camY += step; break;
    case "ArrowLeft": camX += step; break;
    case "ArrowRight": camX -= step; break;
    case "w": camZ += step; break;
    case "s": camZ -= step; break;
    default: return;
  }
  e.preventDefault();  // keep the arrow keys from scrolling the page
});

const axisSelect = document.getElementById("axisSelect");
document.getElementById("slider").addEventListener("input", e => {
  sliderAngle = Number(e.target.value);
  document.getElementById("sliderValue").textContent = sliderAngle;
});
document.getElementById("spinButton").addEventListener("click", () => spinning = !spinning);


function createNode(mesh, color, shape) {
  return { mesh, color, shape, ks: 0.5, shininess: 32, flat: false, joint: null, children: [] };
}

// Lower arm: scale the cylinder then move it up by 0.6 so its bottom sits at the joint
const lowerArm = createNode(armMesh, [1, 0.2, 0.2],
  multiply(translate(0, 0.6, 0), scale(0.3, 0.6, 0.3)));

// Upper arm: scale the cube then move it up by 0.5 so its bottom sits at the joint
const upperArm = createNode(cubeMesh, [0.2, 0.4, 1],
  multiply(translate(0, 0.5, 0), scale(0.2, 0.5, 0.2)));

// Hand: sphere centered on the wrist joint, so no lift
const hand = createNode(sphereMesh, [1, 0.2, 0.2], scale(0.25, 0.25, 0.25));

// Fingers: cones already at real size, lifted by half their height (0.3)
const fingers = [0, 1, 2].map(() =>
  createNode(coneMesh, [0.2, 0.4, 1], translate(0, 0.3, 0)));

// Tabletop: flat slab centered on its own origin, now the root of everything
const tabletop = createNode(cubeMesh, [0.6, 0.6, 0.6], scale(2.0, 0.1, 2.0));

// Legs: hang down from the underside of the slab (shape shifted down by half its length)
const legCorners = [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]];
const legs = legCorners.map(([x, z]) => {
  const leg = createNode(cylinderMesh, [0.45, 0.45, 0.45],
    multiply(translate(0, -0.5, 0), scale(0.12, 0.5, 0.12)));
  leg.joint = translate(x, -0.1, z);   // legs never move, so set the joint once
  return leg;
});

// Materials: ks = specular strength (0 = matte), shininess = highlight tightness
lowerArm.ks = 0;
lowerArm.flat = true;
hand.ks = 1.0; hand.shininess = 64;
tabletop.ks = 0.3; tabletop.shininess = 16;
for (const leg of legs) leg.ks = 0.1;

tabletop.children.push(lowerArm);
for (const leg of legs) tabletop.children.push(leg);
lowerArm.children.push(upperArm);
upperArm.children.push(hand);
for (const f of fingers) hand.children.push(f);

// Connect a slider to a callback and keep its number label in sync
function hookSlider(sliderId, labelId, onChange) {
  const slider = document.getElementById(sliderId);
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    document.getElementById(labelId).textContent = v;
    onChange(v);
  });
}

hookSlider("handShine", "handShineValue", v => hand.shininess = v);
hookSlider("armSpec", "armSpecValue", v => lowerArm.ks = v);
hookSlider("lowerSlider", "lowerValue", v => lowerAngle = v);
hookSlider("upperSlider", "upperValue", v => upperAngle = v);
hookSlider("handSlider", "handValue", v => handAngle = v);

// Light switches: each light can be turned on or off
const lightOn = [true, true];
document.getElementById("light1On").addEventListener("change", e => lightOn[0] = e.target.checked);
document.getElementById("light2On").addEventListener("change", e => lightOn[1] = e.target.checked);

// Flat shading switches
document.getElementById("armFlat").addEventListener("change", e => lowerArm.flat = e.target.checked);
document.getElementById("handFlat").addEventListener("change", e => hand.flat = e.target.checked);

function drawNode(node, frame) {
  gl.uniformMatrix4fv(uModelView, false, multiply(frame, node.shape));
  gl.uniform3fv(uColor, node.color);
  gl.uniform1f(uKs, node.ks);
  gl.uniform1f(uShininess, node.shininess);
  gl.uniform1i(uFlat, node.flat ? 1 : 0);
  gl.bindVertexArray(node.mesh.vao);
  gl.drawElements(gl.TRIANGLES, node.mesh.count, gl.UNSIGNED_SHORT, 0);
}

// Data structure
function drawTree(root, rootFrame) {
  const stack = [[root, rootFrame]];
  while (stack.length > 0) {
    const [node, parentFrame] = stack.pop();
    const frame = multiply(parentFrame, node.joint);
    drawNode(node, frame);
    for (const child of node.children) stack.push([child, frame]);
  }
}

// Render loop
let lastTime = 0;
function render(time) {
  const t = time / 1000;
  if (spinning) spinAngle += t - lastTime;
  lastTime = t;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Camera moves with the keys; the lights stay fixed in the world.
  const view = translate(camX, camY, camZ);
  gl.uniformMatrix4fv(uProjection, false, projection);

  // Move each light into eye space
  gl.uniform3fv(uLightPos, transformPoint(view, lightWorld));
  gl.uniform3fv(uLightPos2, transformPoint(view, lightWorld2));

  // A light that is switched off sends black, so it adds nothing to the shading
  gl.uniform3fv(uLightColor, lightOn[0] ? lightColor1 : [0, 0, 0]);
  gl.uniform3fv(uLightColor2, lightOn[1] ? lightColor2 : [0, 0, 0]);

  // Whole-model rotation
  const axisRotation = ROTATE[axisSelect.value](sliderAngle * Math.PI / 180 + spinAngle);
  const rotation = multiply(multiply(rotateY(dragRotY), rotateX(dragRotX)), axisRotation);

  // Tabletop (root): moved up from the camera's level, then the whole-model rotation
  tabletop.joint = multiply(translate(0, -1.2, 0), rotation);

  // Lower arm: stands on top of the slab (no rotation here, the tabletop already has it)
  lowerArm.joint = multiply(translate(0, 0.1, 0), rotateZ(lowerAngle * Math.PI / 180));

  // Upper arm (child)
  upperArm.joint = multiply(translate(0, 1.2, 0), rotateZ(upperAngle * Math.PI / 180));

  // Hand and fingers
  hand.joint = multiply(translate(0, 1.0, 0), rotateZ(handAngle * Math.PI / 180));
  fingers.forEach((f, i) => {
    const spin = rotateY(i * 2 * Math.PI / 3);    // 0, 120, 240 degrees around the hand
    const tilt = rotateZ(0.5);                    // lean outward
    f.joint = multiply(multiply(spin, tilt), translate(0, 0.25, 0));
  });

  drawTree(tabletop, view);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);