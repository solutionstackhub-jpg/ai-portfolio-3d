import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COLORS, makeStudio, quality } from './studio.js';
import { SCREEN, drawScreen } from './screens.js';

// The lab. A dark hall: a mirror-black floor, a stage that climbs in three steps towards the
// AI core, server racks down both walls, light strips overhead running to a ring of light at
// the far end. Workstations stand in two wings along the aisle. Each one is a topic of the
// site: click it and it boots, lights its corner of the room, and the page unfolds its text.
// The core at the top of the steps is the contact point.

const FOV = 42;
const RISE = 0.36; // height of one step of the stage
const EDGES = [Infinity, 2.9, -1.4, -5.6]; // the z at which each level begins (level 0 is the floor)
const HALL = { half: 7.5, back: -40, ceiling: 6.4 };
const FOG = 0.03;
// Where desks stand in one wing, nearest first; the other wing mirrors it.
const SLOTS = [
  { x: 2.95, z: 5.0, level: 0 },
  { x: 2.6, z: 0.6, level: 1 },
  { x: 1.75, z: -3.6, level: 2 },
  { x: 3.6, z: -7.4, level: 3 },
];
const CORE = new THREE.Vector3(0, RISE * 3, -7.6);
const VIEW = new THREE.Vector3(0, 2.75, 11.4); // where the visitor stands
const UP = new THREE.Vector3(0, 1, 0);

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (x) => x * x * (3 - 2 * x);
const ramp = (t, start, length) => clamp((t - start) / length, 0, 1);
const levelAt = (z) => (z <= EDGES[3] ? 3 : z <= EDGES[2] ? 2 : z <= EDGES[1] ? 1 : 0);

const mesh = (geometry, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
};
const solid = (m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

// A canvas to paint a texture on.
function paint(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Something that gives off light: colours above 1 are what the glow pass picks up.
const lit = (color, strength = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) });

// Bend a flat panel into a gentle curve, edges towards the viewer.
function bend(geometry, amount) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + amount * p.getX(i) ** 2);
  geometry.computeVertexNormals();
  return geometry;
}

// A flat strip of light along a path. `across` is the direction of its width.
function ribbon(points, across, width, start, into) {
  let along = start;
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = points[i];
    if (i > 0) along += Math.hypot(x - points[i - 1][0], y - points[i - 1][1], z - points[i - 1][2]);
    const base = into.position.length / 3;
    const dx = (across[0] * width) / 2;
    const dz = (across[1] * width) / 2;
    into.position.push(x + dx, y, z + dz, x - dx, y, z - dz);
    into.uv.push(along, 1, along, -1);
    if (i > 0) into.index.push(base - 2, base - 1, base, base, base - 1, base + 1);
  }
  return along;
}

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFog;
  uniform float uDensity;
  vec3 haze(vec3 colour, vec3 world) {
    float d = distance(cameraPosition, world) * uDensity;
    return mix(uFog, colour, exp(-d * d));
  }
`;
const fogUniforms = () => ({ uFog: { value: new THREE.Color(COLORS.void) }, uDensity: { value: FOG } });

// The floor: a dark mirror with faint tile seams. The seams light up in rings around the cursor.
const FLOOR_SHADER = {
  name: 'LabFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2(99, 99) },
    uPointerOn: { value: 0 },
    uAccent: { value: new THREE.Color(COLORS.cyan) },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    ...fogUniforms(),
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uPointer;
    uniform float uPointerOn;
    uniform vec3 uAccent;
    uniform vec2 uTexel;
    varying vec4 vUv;
    varying vec3 vWorld;
    ${FOG_GLSL}

    void main() {
      vec2 uv = vUv.xy / vUv.w;
      float d = distance(cameraPosition, vWorld);
      // a polished floor, not a perfect mirror: soften the picture a little
      vec2 o = uTexel * (1.2 + d * 0.1);
      vec3 mirror = texture2D(tDiffuse, uv).rgb * 0.36
        + (texture2D(tDiffuse, uv + vec2(o.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(o.x, 0.0)).rgb
        + texture2D(tDiffuse, uv + vec2(0.0, o.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, o.y)).rgb) * 0.16;
      // more mirror-like at a glancing angle, the way real floors are
      vec3 toEye = normalize(cameraPosition - vWorld);
      float glance = pow(1.0 - clamp(toEye.y, 0.0, 1.0), 3.0);
      vec3 col = color + mirror * mix(0.3, 0.9, glance);

      vec2 g = abs(fract(vWorld.xz / 1.2 - 0.5) - 0.5) / fwidth(vWorld.xz / 1.2);
      float seam = 1.0 - min(min(g.x, g.y), 1.0);
      col += uAccent * seam * 0.035;

      float reach = distance(vWorld.xz, uPointer);
      float near = exp(-reach * reach / 5.0) * uPointerOn;
      float ring = 0.5 + 0.5 * sin(reach * 3.2 - uTime * 3.6);
      col += uAccent * (near * 0.07 + seam * near * ring * 1.1);

      gl_FragColor = vec4(haze(col, vWorld), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

// The fronts of the server racks along a wall: rows of small lights, some steady, some blinking.
const RACK_SHADER = {
  uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uBlue: { value: new THREE.Color(COLORS.blue) }, uCyan: { value: new THREE.Color(COLORS.cyan) }, ...fogUniforms() },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uOn;
    uniform vec3 uBlue;
    uniform vec3 uCyan;
    varying vec2 vUv;
    varying vec3 vWorld;
    ${FOG_GLSL}

    float hash(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    void main() {
      vec2 p = vec2(vUv.x * 40.0, vUv.y * 38.0); // 40 racks along the wall, 38 units up each
      vec2 cell = floor(p);
      vec2 f = fract(p);
      float door = step(0.07, f.x) * step(f.x, 0.93);
      float slot = floor(f.x * 10.0);
      float fx = fract(f.x * 10.0);
      float h = hash(vec3(cell, slot));
      float steady = step(0.8, h);
      float blink = step(0.4, fract(h * 13.0 + uTime * (0.3 + h * 1.4)));
      float alive = steady * mix(1.0, blink, step(0.93, h));
      float bulb = smoothstep(0.2, 0.34, fx) * smoothstep(0.8, 0.66, fx) * smoothstep(0.36, 0.46, f.y) * smoothstep(0.66, 0.56, f.y);
      vec3 lamp = mix(uBlue, uCyan, fract(h * 5.3));
      lamp = mix(lamp, vec3(1.0), step(0.95, fract(h * 9.1)) * 0.7);
      float unit = smoothstep(0.08, 0.14, f.y) * smoothstep(0.96, 0.9, f.y);
      vec3 col = vec3(0.012, 0.016, 0.03) * (0.5 + 0.5 * unit) * door + lamp * bulb * alive * door * uOn * 1.15;
      gl_FragColor = vec4(haze(col, vWorld), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

// A shaft of light: brightest where you look through its middle, fading along its length.
const BEAM_SHADER = {
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vAlong;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      vAlong = uv.y;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uStrength;
    uniform float uFlip;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vAlong;
    void main() {
      float core = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.2);
      float along = mix(vAlong, 1.0 - vAlong, uFlip);
      gl_FragColor = vec4(uColor, core * pow(along, 1.6) * uStrength);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};
const beam = (strength, flip = 0) =>
  new THREE.ShaderMaterial({
    ...BEAM_SHADER,
    uniforms: { uColor: { value: new THREE.Color(COLORS.cyan) }, uStrength: { value: strength }, uFlip: { value: flip } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

// What a hologram is made of: bright at its outline, with scan lines running through it.
const HOLO_SHADER = {
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vHeight;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      vHeight = (modelMatrix * vec4(position, 1.0)).y;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uTime;
    uniform float uAmount;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vHeight;
    void main() {
      float edge = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.5);
      float scan = 0.7 + 0.3 * sin(vHeight * 110.0 - uTime * 6.0);
      gl_FragColor = vec4(uColor * (0.7 + edge * 1.5), (0.05 + edge * 0.6) * scan * uAmount);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

// The floating sign over each workstation, built from a few solids.
const SIGNS = {
  chat(m) {
    const tail = mesh(new THREE.ConeGeometry(0.07, 0.13, 4), m, -0.12, -0.2, 0);
    tail.rotation.set(0, Math.PI / 4, Math.PI * 0.92);
    return [mesh(new RoundedBoxGeometry(0.52, 0.34, 0.12, 4, 0.07), m, 0, 0.02, 0), tail, ...[-0.12, 0, 0.12].map((x) => mesh(new THREE.SphereGeometry(0.034, 16, 12), m, x, 0.02, 0.08))];
  },
  search(m) {
    const handle = mesh(new THREE.CapsuleGeometry(0.035, 0.15, 6, 12), m, 0.14, -0.14, 0);
    handle.rotation.z = Math.PI / 4;
    return [mesh(new THREE.TorusGeometry(0.15, 0.04, 14, 48), m, -0.05, 0.05, 0), handle];
  },
  agents(m) {
    const points = [[-0.17, 0.12, 0], [0.17, 0.12, 0], [0, -0.16, 0]];
    const rods = points.map((a, i) => {
      const from = new THREE.Vector3(...a);
      const to = new THREE.Vector3(...points[(i + 1) % 3]);
      const rod = mesh(new THREE.CylinderGeometry(0.014, 0.014, from.distanceTo(to), 8), m);
      rod.position.copy(from).add(to).multiplyScalar(0.5);
      rod.quaternion.setFromUnitVectors(UP, to.sub(from).normalize());
      return rod;
    });
    return [...points.map((p) => mesh(new THREE.SphereGeometry(0.085, 24, 16), m, ...p)), ...rods];
  },
  gauge(m) {
    const needle = mesh(new THREE.ConeGeometry(0.03, 0.2, 12), m, 0.06, 0.0, 0.03);
    needle.rotation.z = -0.62;
    return [mesh(new THREE.TorusGeometry(0.2, 0.04, 12, 40, Math.PI), m, 0, -0.09, 0), needle, mesh(new THREE.SphereGeometry(0.05, 16, 12), m, 0, -0.09, 0.03)];
  },
  stack(m) {
    return [0, 1, 2, 3].map((i) => {
      const plate = mesh(new RoundedBoxGeometry(0.42, 0.04, 0.42, 2, 0.015), m, 0, -0.18 + i * 0.12, 0);
      return plate;
    });
  },
  steps(m) {
    return [0, 1, 2, 3].map((i) => mesh(new RoundedBoxGeometry(0.1, 0.1 + i * 0.1, 0.16, 2, 0.02), m, -0.195 + i * 0.13, -0.2 + (0.1 + i * 0.1) / 2, 0));
  },
  mail(m) {
    return [mesh(new RoundedBoxGeometry(0.5, 0.32, 0.06, 3, 0.03), m)];
  },
};

export function createScene(canvas, { machines, labelRoot, onChange = () => {}, onLead = () => {} }) {
  // full: through a wide-range buffer, with bloom and shadows. lite: straight to the screen, where
  // the browser's own edge smoothing costs least. (See studio.js for how the mode is chosen.)
  const full = quality.mode === 'full';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !full, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = full;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.void);
  scene.fog = new THREE.FogExp2(COLORS.void, FOG);
  // Reflections of the studio on every glossy surface are the dearest thing in the picture
  // (measured: over a third of the work per pixel), so only full mode has them.
  scene.environment = full ? makeStudio(renderer) : null;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 140);
  // Small things are left out of the floor's mirror image: the mirror's own camera sees layer 0
  // only, and `detail` moves an object (and what it holds) to a layer just this camera sees.
  const DETAIL = 1;
  camera.layers.enable(DETAIL);
  const detail = (...objects) => {
    for (const object of objects) object.traverse((child) => child.layers.set(DETAIL));
  };

  // In full mode the picture is drawn into a wide-range buffer first, so that bright things can
  // spill light (bloom) before it is fitted to the screen. Four samples per pixel keep edges clean.
  // (Graphics chips that cannot draw into such a buffer get a plain one, and no bloom.)
  const wideRange = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  let composer = null;
  let bloom = null;
  if (full) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: wideRange ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.26, 0.35, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ---- light ---------------------------------------------------------------
  scene.add(new THREE.HemisphereLight('#24396f', '#04050a', full ? 0.5 : 1.1));
  const key = new THREE.SpotLight('#cfe0ff', 900, 44, 0.72, 0.9, 1.6);
  key.position.set(0, 11.5, 9.5);
  key.target.position.set(0, 0, -1.5);
  key.castShadow = full;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 34;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  key.shadow.autoUpdate = false;
  scene.add(key, key.target);
  // from the far end of the hall towards the visitor: it outlines every edge that faces away
  const back = new THREE.DirectionalLight('#5a9dff', 0.45);
  back.position.set(0, 6, -30);
  scene.add(back);
  // a small light that travels with the cursor, so highlights slide over the machines
  const lamp = new THREE.PointLight(COLORS.cyan, 0, 8, 1.6);
  // and one that stands in front of whichever display matters most right now. (Every light is
  // worked out again for every pixel, so the other displays make do with painted-on glow.)
  const deskLamp = new THREE.PointLight('#9fdcff', 0, 5.5, 1.8);
  scene.add(lamp, deskLamp);

  // ---- materials -----------------------------------------------------------
  const spot = paint(256, 256, (ctx) => {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  });
  const glow = (color, opacity = 1) =>
    new THREE.MeshBasicMaterial({ map: spot, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const tiles = (repeatX, repeatY) => {
    const texture = paint(256, 256, (ctx) => {
      ctx.fillStyle = '#b9c2d8';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, 256, 256);
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    return texture;
  };
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: '#232a3d', metalness: 0.9, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#0c1019', metalness: 0.6, roughness: 0.42 }),
    desk: new THREE.MeshStandardMaterial({ color: '#10141f', metalness: 0.5, roughness: 0.28 }),
    mat: new THREE.MeshStandardMaterial({ color: '#06080d', roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: '#020409', metalness: 0.6, roughness: 0.07 }),
    pane: new THREE.MeshStandardMaterial({ color: '#9fc4ff', metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.14, envMapIntensity: 2 }),
    wall: new THREE.MeshStandardMaterial({ color: '#080b13', metalness: 0.55, roughness: 0.55 }),
    lid: new THREE.MeshStandardMaterial({ color: '#8f9bb8', metalness: 1, roughness: 0.24 }),
    inside: new THREE.MeshBasicMaterial({ color: '#03050a' }),
    keys: new THREE.MeshBasicMaterial({}),
  };

  // without the studio to reflect, bare metal would turn black: make it duller and lighter instead
  if (!full) {
    for (const material of Object.values(M)) {
      if (!material.isMeshStandardMaterial) continue;
      material.metalness *= 0.3;
      material.color.lerp(new THREE.Color('#5b6a94'), 0.22);
    }
  }

  // ---- the hall ------------------------------------------------------------
  // floor: a mirror that draws the room a second time, upside down
  const ground = new Reflector(new THREE.PlaneGeometry(70, 44), { shader: FLOOR_SHADER, color: '#04060c', clipBias: 0.003, multisample: 0 });
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 10);
  scene.add(ground);
  // what the slowest devices get instead of the mirror: a plain polished floor
  const plainFloor = mesh(new THREE.PlaneGeometry(70, 44), new THREE.MeshStandardMaterial({ color: '#070a13', metalness: 0.85, roughness: 0.32 }), 0, 0, 10);
  plainFloor.rotation.x = -Math.PI / 2;
  plainFloor.visible = false;
  scene.add(plainFloor);
  const shadowCatcher = mesh(new THREE.PlaneGeometry(70, 44), new THREE.ShadowMaterial({ opacity: 0.6 }), 0, 0.004, 10);
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  shadowCatcher.visible = full;
  scene.add(shadowCatcher);

  // the stage: three wide steps up to the core, each with a line of light along its edge
  const edgeLights = [];
  for (let level = 1; level <= 3; level++) {
    const depth = EDGES[level] - HALL.back;
    const material = new THREE.MeshStandardMaterial({ color: full ? '#141a2b' : '#1b2338', metalness: full ? 0.55 : 0.2, roughness: 0.48, map: tiles(HALL.half * 2 / 1.2, depth / 1.2) });
    const step = mesh(new THREE.BoxGeometry(HALL.half * 2, RISE, depth), material, 0, RISE * (level - 0.5), HALL.back + depth / 2);
    step.receiveShadow = true;
    const edge = mesh(new THREE.BoxGeometry(HALL.half * 2, 0.026, 0.026), lit(COLORS.cyan, 0), 0, RISE * level - 0.02, EDGES[level] + 0.004);
    edgeLights.push(edge.material);
    scene.add(step, edge);
  }

  // server racks down both walls
  const rackFaces = [];
  for (const side of [-1, 1]) {
    scene.add(mesh(new THREE.BoxGeometry(1.2, 5.6, 56), M.wall, side * (HALL.half + 0.62), 2.8, -13));
    const face = mesh(new THREE.PlaneGeometry(56, 5.0), new THREE.ShaderMaterial({ ...RACK_SHADER, uniforms: THREE.UniformsUtils.clone(RACK_SHADER.uniforms) }), side * (HALL.half + 0.01), 2.7, -13);
    face.rotation.y = (-side * Math.PI) / 2;
    rackFaces.push(face.material);
    scene.add(face);
  }

  // ceiling: dark, with four strips of light running the length of the hall
  const ceiling = mesh(new THREE.PlaneGeometry(17.4, 56), M.wall, 0, HALL.ceiling, -13);
  ceiling.rotation.x = Math.PI / 2;
  scene.add(ceiling);
  const stripLight = lit(COLORS.ice, 0);
  for (const x of [-5.3, -1.9, 1.9, 5.3]) scene.add(mesh(new THREE.BoxGeometry(0.07, 0.04, 54), stripLight, x, HALL.ceiling - 0.04, -13));
  for (let z = 3.5; z > HALL.back; z -= 6.5) scene.add(mesh(new THREE.BoxGeometry(17.4, 0.34, 0.34), M.wall, 0, HALL.ceiling - 0.17, z));

  // the far end: a wall and a ring of light, which also outlines everything in front of it
  scene.add(mesh(new THREE.PlaneGeometry(17.4, 8), M.wall, 0, 3.2, HALL.back + 0.05));
  const gateLight = lit(COLORS.ice, 0);
  scene.add(mesh(new THREE.TorusGeometry(3.1, 0.06, 12, 96), gateLight, 0, 3.5, HALL.back + 0.6));
  const gateGlow = mesh(new THREE.PlaneGeometry(13, 8.5), glow(COLORS.blue, 0), 0, 3.3, HALL.back + 0.4);
  gateGlow.material.fog = false;
  scene.add(gateGlow);

  // dust hanging in the air
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 500 * 3 }, (_, i) => [(Math.random() - 0.5) * 16, Math.random() * 6, 7 - Math.random() * 32][i % 3]), 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ map: spot, color: '#9fc8ff', size: 0.06, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  // ---- the core ------------------------------------------------------------
  const core = new THREE.Group();
  core.position.copy(CORE);
  core.add(mesh(new THREE.CylinderGeometry(1.5, 1.66, 0.16, 72), M.steel, 0, 0.08, 0));
  const coreLight = lit(COLORS.cyan, 0);
  for (const [radius, tube] of [[1.5, 0.02], [1.05, 0.012], [0.6, 0.012]]) {
    const ring = mesh(new THREE.TorusGeometry(radius, tube, 8, 96), coreLight, 0, 0.165, 0);
    ring.rotation.x = Math.PI / 2;
    core.add(ring);
  }
  // the processor floats above its base, tipped towards the visitor
  const chipTilt = new THREE.Group();
  chipTilt.position.y = 1.9;
  chipTilt.rotation.x = 0.66;
  const chip = new THREE.Group();
  chipTilt.add(chip);
  chip.add(
    mesh(new RoundedBoxGeometry(2.2, 0.12, 2.2, 4, 0.05), M.dark),
    mesh(new RoundedBoxGeometry(1.7, 0.1, 1.7, 4, 0.04), M.steel, 0, 0.1, 0),
    mesh(new RoundedBoxGeometry(1.16, 0.09, 1.16, 4, 0.04), M.lid, 0, 0.19, 0),
  );
  const emblem = mesh(
    new THREE.PlaneGeometry(1.04, 1.04),
    new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: paint(512, 512, (ctx) => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.font = '800 220px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText('AI', 256, 318);
        ctx.lineWidth = 7;
        ctx.strokeRect(40, 40, 432, 432);
      }),
    }),
    0, 0.237, 0,
  );
  emblem.rotation.x = -Math.PI / 2;
  chip.add(emblem);
  const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.03, 0.2), M.lid, 72);
  const pinMatrix = new THREE.Matrix4();
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < 18; k++) {
      pinMatrix.makeRotationY((side * Math.PI) / 2).multiply(new THREE.Matrix4().makeTranslation(-0.935 + k * 0.11, -0.01, 1.14));
      pins.setMatrixAt(side * 18 + k, pinMatrix);
    }
  }
  chip.add(pins);
  for (let side = 0; side < 4; side++) {
    const bar = new THREE.Group();
    bar.rotation.y = (side * Math.PI) / 2;
    bar.add(mesh(new THREE.BoxGeometry(1.5, 0.02, 0.024), coreLight, 0, 0.155, 0.86));
    chip.add(bar);
  }
  const rings = [1.75, 2.0, 2.25].map((radius, i) => {
    const ring = mesh(new THREE.TorusGeometry(radius, 0.011, 8, 128), coreLight);
    ring.userData.tilt = [1.25, 0.9, 1.5][i];
    chipTilt.add(ring);
    return ring;
  });
  const shaftUp = mesh(new THREE.CylinderGeometry(0.16, 0.7, HALL.ceiling - CORE.y - 2.2, 32, 1, true), beam(0, 1), 0, 2.2 + (HALL.ceiling - CORE.y - 2.2) / 2, 0);
  const shaftDown = mesh(new THREE.CylinderGeometry(1.0, 0.5, 1.7, 32, 1, true), beam(0, 0), 0, 0.95, 0);
  const coreGlow = mesh(new THREE.PlaneGeometry(9, 9), glow(COLORS.blue, 0), 0, 1.9, -0.6);
  const coreLamp = new THREE.PointLight(COLORS.cyan, 0, 18, 1.7);
  coreLamp.position.set(0, 2.4, 1.2);
  const coreHit = mesh(new THREE.BoxGeometry(3, 3, 3), M.inside, 0, 1.9, 0);
  coreHit.visible = false;
  core.add(chipTilt, shaftUp, shaftDown, coreGlow, coreLamp, coreHit);
  scene.add(core);

  // ---- shared parts of a workstation ---------------------------------------
  const G = {
    top: new RoundedBoxGeometry(2.0, 0.05, 0.92, 3, 0.018),
    mat: new THREE.PlaneGeometry(1.24, 0.46),
    leg: new THREE.BoxGeometry(0.06, 0.775, 0.78),
    modesty: new THREE.BoxGeometry(1.76, 0.42, 0.03),
    strip: new THREE.BoxGeometry(1.92, 0.012, 0.012),
    base: new RoundedBoxGeometry(0.52, 0.02, 0.27, 3, 0.009),
    neck: new THREE.BoxGeometry(0.07, 0.44, 0.03),
    shell: bend(new THREE.BoxGeometry(1.5, 0.66, 0.034, 28, 1, 1), 0.1),
    bezel: bend(new THREE.PlaneGeometry(1.5, 0.66, 28, 1), 0.1),
    display: bend(new THREE.PlaneGeometry(1.455, 0.622, 28, 1), 0.1),
    halo: new THREE.PlaneGeometry(3.2, 1.9),
    keyboard: new RoundedBoxGeometry(0.75, 0.014, 0.25, 3, 0.006),
    key: new THREE.BoxGeometry(0.04, 0.007, 0.038),
    mouse: new RoundedBoxGeometry(0.06, 0.028, 0.1, 3, 0.013),
    tower: new RoundedBoxGeometry(0.22, 0.48, 0.44, 3, 0.02),
    window: new THREE.PlaneGeometry(0.4, 0.44),
    fan: new THREE.PlaneGeometry(0.17, 0.17),
    front: new THREE.BoxGeometry(0.008, 0.3, 0.004),
    deskSpill: new THREE.PlaneGeometry(1.7, 0.7),
    floorSpill: new THREE.PlaneGeometry(4.2, 3.2),
    hit: new THREE.BoxGeometry(2.1, 1.9, 1.0),
  };
  const traceShader = {
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    // dim while idle; bright, with packets of light running out from the core, under load
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPower;
      uniform float uOn;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float body = smoothstep(0.0, 0.5, 1.0 - abs(vUv.y));
        float packet = pow(fract(vUv.x * 0.3 - uTime * 0.8), 10.0);
        float light = (0.22 + uPower * (0.55 + packet * 2.6)) * uOn;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), uPower * packet * 0.7) * 1.4, body * light);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
  const trace = (parts) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(parts.position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(parts.uv, 2));
    geometry.setIndex(parts.index);
    return mesh(
      geometry,
      new THREE.ShaderMaterial({
        ...traceShader,
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uOn: { value: 0 }, uColor: { value: new THREE.Color(COLORS.cyan) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
  };
  // The inside of a tower is one painted picture (boards, memory, a graphics card) and each fan one
  // spinning picture, so a tower is six things to draw instead of fourteen. Painted in white; the
  // material's colour then lights it.
  const towerInside = paint(256, 282, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 282);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    for (const y of [77, 205]) {
      ctx.beginPath();
      ctx.arc(186, y, 56, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeRect(14, 22, 116, 100);
    ctx.fillStyle = '#fff';
    for (let s = 0; s < 3; s++) ctx.fillRect(40 + s * 24, 36, 9, 70);
    ctx.fillRect(18, 182, 130, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(18, 214, 130, 5);
    ctx.fillRect(18, 150, 60, 5);
  });
  const fanPicture = paint(128, 128, (ctx) => {
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(64, 64, 55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 11;
    for (let b = 0; b < 3; b++) {
      const angle = (b * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(64 - Math.cos(angle) * 46, 64 - Math.sin(angle) * 46);
      ctx.lineTo(64 + Math.cos(angle) * 46, 64 + Math.sin(angle) * 46);
      ctx.stroke();
    }
  });
  const off = new THREE.Color(COLORS.dim);
  const cyan = new THREE.Color(COLORS.cyan);
  const blue = new THREE.Color(COLORS.blue);
  const keyOff = new THREE.Color('#0d1220');
  const keyOn = new THREE.Color(0.75, 1.15, 1.5);
  const mixed = new THREE.Color();
  const tint = new THREE.Color();

  // the three lines of light down the middle of the aisle, from the core to the front
  const eps = 0.012;
  const spineStart = CORE.z + 1.75;
  const spineParts = { position: [], uv: [], index: [] };
  for (const x of [-0.15, 0, 0.15]) {
    const path = [[x, RISE * 3 + eps, spineStart]];
    for (let level = 3; level >= 1; level--) {
      path.push([x, RISE * level + eps, EDGES[level] + eps], [x, RISE * (level - 1) + eps, EDGES[level] + eps]);
    }
    path.push([x, eps, 4.1]);
    ribbon(path, [1, 0], 0.04, 0, spineParts);
  }
  const spine = trace(spineParts);
  detail(spine, dust, shadowCatcher);
  scene.add(spine);
  const alongSpine = (z) => z - spineStart + RISE * (3 - levelAt(z));

  // ---- the workstations and the core, as the things you can open -----------
  const desks = machines.filter((machine) => !machine.core);
  const leftCount = Math.ceil(desks.length / 2);

  function buildDesk(machine, index, order) {
    const side = order < leftCount ? -1 : 1;
    const slot = SLOTS[Math.min(side < 0 ? order : desks.length - 1 - order, SLOTS.length - 1)];
    const floor = slot.level * RISE;
    const group = new THREE.Group();
    group.position.set(side * slot.x, floor, slot.z);
    group.rotation.y = 0.7 * Math.atan2(VIEW.x - side * slot.x, VIEW.z - slot.z);
    const centre = side * 0.12; // the monitor and keyboard sit a little away from the tower

    // desk
    const strip = mesh(G.strip, lit(COLORS.dim), 0, 0.775, 0.462);
    const mat = mesh(G.mat, M.mat, centre + 0.1, 0.8012, 0.2);
    mat.rotation.x = -Math.PI / 2;
    mat.receiveShadow = true;
    group.add(solid(mesh(G.top, M.desk, 0, 0.775, 0)), solid(mesh(G.leg, M.steel, -0.92, 0.3875, 0)), solid(mesh(G.leg, M.steel, 0.92, 0.3875, 0)), mesh(G.modesty, M.dark, 0, 0.5, -0.4), strip, mat);

    // monitor: a curved ultra-wide on a stand; its picture is a canvas (see screens.js)
    const screen = document.createElement('canvas');
    screen.width = SCREEN.width;
    screen.height = SCREEN.height;
    const texture = new THREE.CanvasTexture(screen);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const head = new THREE.Group();
    head.position.set(centre, 1.42, -0.2);
    const halo = mesh(G.halo, glow(COLORS.blue, 0), 0, 0, -0.14);
    const display = mesh(G.display, new THREE.MeshBasicMaterial({ map: texture }), 0, 0, 0.019);
    head.add(halo, solid(mesh(G.shell, M.steel)), mesh(G.bezel, M.glass, 0, 0, 0.0175), display);
    group.add(head, solid(mesh(G.base, M.steel, centre, 0.81, -0.22)), mesh(G.neck, M.steel, centre, 1.03, -0.27));

    // keyboard with a light under every key, and a mouse
    const keys = new THREE.InstancedMesh(G.key, M.keys, 75);
    const place = new THREE.Matrix4();
    for (let k = 0; k < 75; k++) {
      keys.setMatrixAt(k, place.makeTranslation(centre + ((k % 15) - 7) * 0.047, 0.8175, 0.22 + (Math.floor(k / 15) - 2) * 0.046));
      keys.setColorAt(k, keyOff);
    }
    const keyboard = solid(mesh(G.keyboard, M.steel, centre, 0.807, 0.22));
    const mouse = solid(mesh(G.mouse, M.dark, centre + 0.56, 0.814, 0.24));
    group.add(keyboard, keys, mouse);

    // the tower: a glass side facing the aisle, with fans and boards lit inside
    const tower = new THREE.Group();
    tower.position.set(-side * 0.8, 0.8, -0.1);
    const inner = [
      new THREE.MeshBasicMaterial({ map: towerInside, color: COLORS.dim }),
      new THREE.MeshBasicMaterial({ map: fanPicture, color: COLORS.dim, transparent: true, depthWrite: false }),
      lit(COLORS.dim),
    ];
    const pane = new THREE.Group();
    pane.position.set(-side * 0.111, 0.24, 0);
    pane.rotation.y = (-side * Math.PI) / 2;
    const fans = [0.1, -0.1].map((y) => mesh(G.fan, inner[1], 0.09, y, 0.005));
    pane.add(mesh(G.window, inner[0]), ...fans, mesh(G.window, M.pane, 0, 0, 0.014));
    const front = mesh(G.front, inner[2], 0, 0.26, 0.221);
    tower.add(solid(mesh(G.tower, M.steel, 0, 0.24, 0)), pane, front);
    group.add(tower);

    // light spilling from the display: behind it, across the desk, onto the floor, and a real lamp
    const deskSpill = mesh(G.deskSpill, glow(COLORS.cyan, 0), centre, 0.803, 0.1);
    deskSpill.rotation.x = -Math.PI / 2;
    const floorSpill = mesh(G.floorSpill, glow(COLORS.blue, 0), 0, 0.014, 1.1);
    floorSpill.rotation.x = -Math.PI / 2;
    group.add(deskSpill, floorSpill);

    // the sign floating above it
    const holo = new THREE.ShaderMaterial({
      ...HOLO_SHADER,
      uniforms: { uColor: { value: new THREE.Color(COLORS.cyan) }, uTime: { value: 0 }, uAmount: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const sign = new THREE.Group();
    sign.position.set(centre, 2.42, -0.2);
    sign.add(...(SIGNS[machine.screen] ?? SIGNS.mail)(holo));
    group.add(sign);

    const hit = mesh(G.hit, M.inside, 0, 0.95, 0);
    hit.visible = false;
    hit.userData.index = index;
    detail(mat, keyboard, keys, mouse, pane, front, deskSpill, floorSpill, sign);
    group.add(hit);
    scene.add(group);

    // its line of light from the aisle
    const parts = { position: [], uv: [], index: [] };
    for (const dz of [-0.06, 0.06]) {
      ribbon([[side * 0.24, floor + eps, slot.z + dz], [side * (slot.x - 0.75), floor + eps, slot.z + dz]], [0, 1], 0.04, alongSpine(slot.z), parts);
    }
    const branch = trace(parts);
    detail(branch);
    scene.add(branch);

    const yaw = group.rotation.y;
    return {
      kind: 'desk', machine, index, group, head, display, texture, halo, strip, keys, inner, fans, deskSpill, floorSpill, holo, sign, branch, side, floor,
      context: screen.getContext('2d'),
      facing: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), // out of the display, towards the viewer
      right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
      tagAt: new THREE.Vector3(centre, 1.83, -0.2),
      lampAt: new THREE.Vector3(centre, 1.3, 0.8),
      on: false, onAt: 0, power: 0, hover: 0, yaw: 0, lit: false,
    };
  }

  let deskOrder = 0;
  const targets = machines.map((machine, index) => {
    if (!machine.core) return buildDesk(machine, index, deskOrder++);
    coreHit.userData.index = index;
    return { kind: 'core', machine, index, group: core, tagAt: new THREE.Vector3(0, 3.45, 0), on: false, onAt: 0, power: 0, hover: 0 };
  });
  const deskTargets = targets.filter((target) => target.kind === 'desk');
  const coreTarget = targets.find((target) => target.kind === 'core');
  const hitBoxes = [...deskTargets.map((target) => target.group.children.at(-1)), ...(coreTarget ? [coreHit] : [])];

  // the small label over each thing you can open
  for (const target of targets) {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'tag';
    tag.dataset.ui = '';
    tag.innerHTML = `<b>${String(target.index + 1).padStart(2, '0')}</b><span>${target.machine.label}</span>`;
    tag.addEventListener('click', () => select(target.index));
    labelRoot?.append(tag);
    target.tag = tag;
  }

  // the pool of light under the cursor, and the rings a click sends out
  const pool = mesh(new THREE.PlaneGeometry(4.4, 4.4), glow(COLORS.cyan, 0));
  pool.rotation.x = -Math.PI / 2;
  scene.add(pool);
  const ripples = [0, 1, 2].map(() => {
    const ring = mesh(new THREE.RingGeometry(0.94, 1, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.cyan).multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.userData.start = -10;
    scene.add(ring);
    return ring;
  });
  detail(pool, ...ripples);

  // ---- size and quality ----------------------------------------------------
  const view = { width: 1, height: 1, narrow: false };

  function resize() {
    view.width = canvas.clientWidth;
    view.height = canvas.clientHeight;
    view.narrow = view.width < 900 || view.width / view.height < 1.05;
    renderer.setPixelRatio(quality.ratio);
    renderer.setSize(view.width, view.height, false);
    if (composer) {
      composer.setPixelRatio(quality.ratio);
      composer.setSize(view.width, view.height);
      bloom.enabled = wideRange && quality.bloom;
    }
    // the mirror image is drawn smaller than the screen (it is softened anyway), or not at all
    ground.visible = quality.mirror > 0;
    plainFloor.visible = !ground.visible;
    if (ground.visible) {
      const mirrorWidth = Math.max(64, Math.round(view.width * quality.ratio * quality.mirror));
      const mirrorHeight = Math.max(64, Math.round(view.height * quality.ratio * quality.mirror));
      ground.getRenderTarget().setSize(mirrorWidth, mirrorHeight);
      ground.material.uniforms.uTexel.value.set(1 / mirrorWidth, 1 / mirrorHeight);
    }
    camera.aspect = view.width / view.height;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(canvas);
  addEventListener('quality', resize);

  // ---- state ---------------------------------------------------------------
  let active = -1; // the thing the camera has flown to, or -1 for the whole hall
  let browse = 0; // on narrow screens: the one in front of you
  let hovered = -1;
  let overUi = false;
  let time = 0;
  let last = 0;
  let frame = 0;
  let slow = 0;
  let measured = 0;
  let shadowAt = 0; // when the shadows are next due to be redrawn
  let lampDesk = null; // the workstation the desk lamp stands at

  const pointer = { x: 0, y: 0, clientX: 0, clientY: 0, active: false, moved: false };
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(UP, 0);
  const underCursor = new THREE.Vector3(0, 0, 6);
  const poolAt = new THREE.Vector3(0, 0, 6);
  const probe = new THREE.Vector3();

  const notify = () => onChange({ active, browse, hovered, online: targets.map((target) => target.on) });

  function power(index, on = true) {
    const target = targets[index];
    if (target.on === on) return;
    target.on = on;
    target.onAt = time;
    shadowAt = time + 1.2;
  }

  function select(index) {
    active = index;
    if (index >= 0) {
      browse = index;
      power(index);
    }
    notify();
  }

  // Where a ray meets the floor or one of the steps.
  function surface(ray, out) {
    for (let level = 3; level >= 0; level--) {
      plane.constant = -level * RISE;
      if (ray.intersectPlane(plane, out) && (level === 0 || out.z <= EDGES[level])) return true;
    }
    return false;
  }

  function ripple(point) {
    const ring = ripples.reduce((oldest, candidate) => (candidate.userData.start < oldest.userData.start ? candidate : oldest));
    ring.position.set(point.x, point.y + 0.03, point.z);
    ring.userData.start = time;
  }

  // ---- pointer -------------------------------------------------------------
  addEventListener('pointermove', (event) => {
    pointer.x = (event.clientX / view.width) * 2 - 1;
    pointer.y = 1 - (event.clientY / view.height) * 2;
    pointer.clientX = event.clientX;
    pointer.clientY = event.clientY;
    pointer.active = event.pointerType === 'mouse';
    pointer.moved = true;
  });
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.active = false;
    hovered = -1;
  });

  let pressAt = null;
  addEventListener('pointerdown', (event) => {
    pressAt = event.target.closest?.('[data-ui]') ? null : { x: event.clientX, y: event.clientY };
  });
  addEventListener('pointerup', (event) => {
    if (!pressAt) return;
    const dx = event.clientX - pressAt.x;
    const dy = event.clientY - pressAt.y;
    pressAt = null;
    // a sideways swipe moves to the next one (touch screens); anything else is a click
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (active < 0) {
        browse = (browse + (dx < 0 ? 1 : -1) + targets.length) % targets.length;
        notify();
      }
      return;
    }
    if (Math.hypot(dx, dy) > 10) return;
    ndc.set((event.clientX / view.width) * 2 - 1, 1 - (event.clientY / view.height) * 2);
    raycaster.setFromCamera(ndc, camera);
    const [first] = raycaster.intersectObjects(hitBoxes, false);
    if (surface(raycaster.ray, probe)) ripple(probe);
    if (first) select(first.object.userData.index);
    else if (active >= 0) select(-1);
  });

  // ---- camera --------------------------------------------------------------
  const eye = new THREE.Vector3(0, 7.5, 25);
  const look = new THREE.Vector3(0, 2.2, -4);
  const eyeGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const vector = new THREE.Vector3();

  function aim() {
    const target = targets[active >= 0 ? active : browse];
    if (active >= 0 && !view.narrow) {
      // desktop, something open: it sits on the left, with room for its text on the right
      if (target.kind === 'core') {
        eyeGoal.copy(CORE).add(vector.set(1.9, 3.2, 6.4));
        lookGoal.copy(CORE).add(vector.set(2.0, 1.75, 0));
      } else {
        const { group, facing, right, floor } = target;
        eyeGoal.copy(group.position).addScaledVector(facing, 3.5).addScaledVector(right, 0.85).setY(floor + 1.6);
        lookGoal.copy(group.position).addScaledVector(right, 1.02).setY(floor + 1.32);
      }
    } else if (view.narrow) {
      // phone: one thing in front of you; open, it moves to the top to leave room for its text
      const open = active >= 0;
      if (target.kind === 'core') {
        eyeGoal.copy(CORE).add(vector.set(0, 2.3, open ? 9.5 : 8.5));
        lookGoal.copy(CORE).add(vector.set(0, open ? 0.1 : 2.1, 0));
      } else {
        const { group, facing, floor } = target;
        eyeGoal.copy(group.position).addScaledVector(facing, open ? 6.2 : 7.4).setY(floor + (open ? 1.9 : 2.3));
        lookGoal.copy(group.position).setY(floor + (open ? 0.1 : 1.35));
      }
    } else {
      // the whole hall; stand further back in narrower windows so both wings stay in view
      const backOff = Math.max(1, 1.62 / camera.aspect) - 1;
      eyeGoal.set(VIEW.x, VIEW.y + backOff * 1.6, VIEW.z + backOff * 9);
      lookGoal.set(0, 1.62, -2.5);
    }
  }

  // ---- every frame ---------------------------------------------------------
  renderer.setAnimationLoop((ms) => {
    const now = ms / 1000;
    const elapsed = now - last;
    // follow real time even when frames are slow; only a long pause (a hidden tab) is cut short
    const dt = Math.min(elapsed, 1);
    last = now;
    time += dt;
    frame++;

    // Watch the pace once the hall is up: whenever 40 frames in a row average under ~40 a second,
    // give something up (see quality.lower), then let the change settle before counting again.
    if (time > 3 && elapsed < 0.25) {
      if (measured >= 0) slow += elapsed;
      if (++measured === 40) {
        measured = slow / 40 > 0.025 && quality.lower() ? -20 : 0;
        slow = 0;
      }
    }
    const quick = 1 - Math.exp(-dt * 9);
    const calm = 1 - Math.exp(-dt * 3.2);
    const warm = frame < 4; // the first frames draw everything once, so nothing has to be prepared mid-click
    // shadows are drawn once, and again after a display has stood up or lain down
    if (full && time >= shadowAt) {
      key.shadow.needsUpdate = true;
      shadowAt = Infinity;
    }

    // the hall wakes up: ceiling strips, then the steps from the front, the far ring, the core
    const flicker = (start) => {
      const k = ramp(time, start, 0.7);
      return k >= 1 ? 1 : k * (Math.sin(time * 70 + start * 9) > -0.2 ? 1 : 0.25);
    };
    stripLight.color.set(COLORS.ice).multiplyScalar(1.05 * flicker(0.2));
    edgeLights.forEach((material, i) => material.color.set(COLORS.cyan).multiplyScalar(1.5 * flicker(0.7 + i * 0.3)));
    gateLight.color.set(COLORS.ice).multiplyScalar(1.7 * flicker(1.3));
    gateGlow.material.opacity = 0.16 * ramp(time, 1.3, 1.2);
    rackFaces.forEach((material) => {
      material.uniforms.uTime.value = time;
      material.uniforms.uOn.value = ramp(time, 0.5, 1.6);
    });
    const coreUp = smooth(ramp(time, 1.8, 1.2));

    // camera: glide to the current view, lean with the cursor, and drift a little when left alone
    aim();
    camera.getWorldDirection(vector);
    side.crossVectors(vector, UP).normalize();
    lift.crossVectors(side, vector);
    // (while the pointer is on the text window the room holds still, so the text is easy to read and click)
    const reach = active >= 0 ? (overUi ? 0.06 : 0.3) : view.narrow ? 0.25 : 1.15;
    const swayX = pointer.active ? pointer.x : Math.sin(time * 0.22) * 0.35;
    const swayY = pointer.active ? pointer.y : Math.sin(time * 0.17) * 0.25;
    eyeGoal.addScaledVector(side, swayX * reach).addScaledVector(lift, swayY * reach * 0.45);
    lookGoal.addScaledVector(side, -swayX * reach * 0.25);
    eye.lerp(eyeGoal, calm);
    look.lerp(lookGoal, calm);
    camera.position.copy(eye);
    camera.lookAt(look);
    camera.updateMatrixWorld();

    // what is under the cursor: something to open, and a point on the floor
    if (pointer.moved || frame % 6 === 0) {
      pointer.moved = false;
      ndc.set(pointer.x, pointer.y);
      raycaster.setFromCamera(ndc, camera);
      const before = hovered;
      overUi = Boolean(pointer.active && document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest('[data-ui]'));
      hovered = pointer.active && !overUi ? (raycaster.intersectObjects(hitBoxes, false)[0]?.object.userData.index ?? -1) : -1;
      if (pointer.active) surface(raycaster.ray, underCursor);
      if (hovered !== before) notify();
    }
    poolAt.lerp(underCursor, 1 - Math.exp(-dt * 12));
    pool.position.set(poolAt.x, poolAt.y + 0.02, poolAt.z);
    pool.material.opacity += ((pointer.active ? 0.55 : 0) - pool.material.opacity) * quick;
    lamp.position.set(poolAt.x, poolAt.y + 1.5, poolAt.z + 0.5);
    lamp.intensity += ((pointer.active ? 14 : 0) - lamp.intensity) * quick;
    const floorUniforms = ground.material.uniforms;
    floorUniforms.uPointer.value.set(poolAt.x, poolAt.z);
    floorUniforms.uPointerOn.value = pool.material.opacity / 0.55;
    floorUniforms.uTime.value = time;
    for (const ring of ripples) {
      const age = (time - ring.userData.start) / 1.1;
      ring.visible = warm || age < 1;
      ring.scale.setScalar(0.2 + age * 3.4);
      ring.material.opacity = (1 - age) ** 2;
    }

    // ---- the workstations ---------------------------------------------------
    let online = 0;
    for (const target of targets) {
      const { index } = target;
      target.power += ((target.on ? 1 : 0) - target.power) * (1 - Math.exp(-dt * 4));
      target.hover += ((index === hovered && index !== active ? 1 : 0) - target.hover) * quick;
      if (target.on) online++;
      if (target.kind !== 'desk') continue;

      const p = target.power;
      const age = target.on ? time - target.onAt : 0;
      const wake = flicker(1.7 + index * 0.14); // the standby picture comes on with the hall

      // asleep, the display hangs its head; awake, it stands up. It also turns to watch the cursor.
      const toCursor = Math.atan2(poolAt.x - target.group.position.x, poolAt.z - target.group.position.z) - target.group.rotation.y;
      const watch = pointer.active && active < 0 ? clamp(Math.atan2(Math.sin(toCursor), Math.cos(toCursor)) * 0.4, -0.24, 0.24) : 0;
      target.yaw += (watch - target.yaw) * calm;
      target.head.rotation.set(lerp(0.2, -0.04, smooth(clamp(p * 1.2, 0, 1))) - target.hover * 0.07, target.yaw, 0);

      // everything that lights up with it
      target.display.material.color.setScalar((lerp(0.62, 1.5, p) + target.hover * 0.3) * wake);
      target.halo.material.opacity = p * 0.5 + target.hover * 0.12;
      target.deskSpill.material.opacity = p * 0.42;
      target.floorSpill.material.opacity = p * 0.32 + target.hover * 0.05;
      target.strip.material.color.lerpColors(off, cyan, clamp(p + target.hover * 0.6, 0, 1)).multiplyScalar(1 + p * 1.3);
      tint.lerpColors(off, blue, p).multiplyScalar(1 + p * 1.6);
      for (const material of target.inner) material.color.copy(tint);
      for (const fan of target.fans) fan.rotation.z -= dt * (1.5 + p * 22) * p;
      target.branch.material.uniforms.uTime.value = time;
      target.branch.material.uniforms.uPower.value = p;
      target.branch.material.uniforms.uOn.value = wake;
      target.holo.uniforms.uTime.value = time;
      target.holo.uniforms.uAmount.value = p;
      target.sign.visible = warm || p > 0.01;
      target.sign.scale.setScalar(smooth(clamp(p * 1.3, 0, 1)) * 0.85);
      target.sign.rotation.y += dt * 0.7;
      target.sign.position.y = 2.42 + Math.sin(time * 1.3 + index) * 0.03;

      // the keyboard lights up key by key when the machine starts, then keeps a slow shimmer
      if ((p > 0.01 || target.lit) && (frame + index) % 2 === 0) {
        target.lit = p > 0.01;
        for (let k = 0; k < 75; k++) {
          const wave = clamp(age * 5 - (k % 15) * 0.2 - Math.floor(k / 15) * 0.12, 0, 1);
          const shimmer = 0.75 + 0.25 * Math.sin(time * 2.2 + k * 0.7);
          target.keys.setColorAt(k, mixed.lerpColors(keyOff, keyOn, p * wave * shimmer));
        }
        target.keys.instanceColor.needsUpdate = true;
      }

      // redraw the display: every other frame while something is happening on it, now and then otherwise
      const busy = index === active || target.hover > 0.02 || Math.abs(p - (target.on ? 1 : 0)) > 0.01 || (target.on && age < 2);
      if ((frame + index * 2) % (busy ? 2 : 12) === 0) {
        drawScreen(target.context, target.machine, index, { power: p, age, time, hover: target.hover });
        target.texture.needsUpdate = true;
      }
    }

    // the one real desk lamp goes to the open workstation, or else the one under the cursor;
    // it only changes desks while it is dark, so the light never jumps
    const lead = targets[active >= 0 ? active : hovered];
    const wanted = lead?.kind === 'desk' ? lead : null;
    if (wanted && wanted !== lampDesk && deskLamp.intensity < 0.4) lampDesk = wanted;
    deskLamp.intensity += ((wanted && wanted === lampDesk ? wanted.power * 9 + wanted.hover * 1.5 : 0) - deskLamp.intensity) * quick;
    if (lampDesk) lampDesk.group.localToWorld(deskLamp.position.copy(lampDesk.lampAt));

    // ---- the core: it works harder the more machines are running ------------
    const load = online / targets.length;
    const drive = (coreTarget ? Math.max(coreTarget.power, coreTarget.hover * 0.5) : 0) * 0.6 + load * 0.6;
    coreLight.color.lerpColors(blue, cyan, 0.5 + 0.5 * Math.sin(time * 2.2)).multiplyScalar((1.25 + drive * 0.8) * coreUp);
    emblem.material.color.set(COLORS.cyan).multiplyScalar((1.1 + drive * 1.3 + 0.15 * Math.sin(time * 3)) * coreUp);
    chipTilt.position.y = 1.9 + Math.sin(time * 0.9) * 0.07;
    chip.rotation.y = Math.sin(time * 0.3) * 0.4;
    rings.forEach((ring, i) => {
      ring.rotation.set(ring.userData.tilt, time * (0.25 + i * 0.12) * (1 + drive * 2) * (i % 2 ? -1 : 1), 0);
      ring.scale.setScalar(coreUp);
    });
    shaftUp.material.uniforms.uStrength.value = (0.1 + drive * 0.22) * coreUp;
    shaftDown.material.uniforms.uStrength.value = (0.06 + drive * 0.14) * coreUp;
    coreGlow.material.opacity = (0.035 + drive * 0.08) * coreUp;
    coreGlow.quaternion.copy(camera.quaternion);
    coreLamp.intensity = (11 + drive * 16) * coreUp;
    spine.material.uniforms.uTime.value = time;
    spine.material.uniforms.uPower.value = load;
    spine.material.uniforms.uOn.value = coreUp;
    dust.position.y = Math.sin(time * 0.1) * 0.25;
    dust.rotation.y = Math.sin(time * 0.05) * 0.06;

    // ---- labels, and where the page should attach its text window -----------
    for (const target of targets) {
      vector.copy(target.tagAt);
      target.group.localToWorld(vector).project(camera);
      const shown = time > 2.4 && active < 0 && vector.z < 1 && (!view.narrow || target.index === browse);
      const { tag } = target;
      tag.style.opacity = shown ? 1 : 0;
      tag.style.pointerEvents = shown ? 'auto' : 'none';
      tag.style.transform = `translate3d(${((vector.x * 0.5 + 0.5) * view.width).toFixed(1)}px, ${((0.5 - vector.y * 0.5) * view.height).toFixed(1)}px, 0) translate(-50%, -100%)`;
      tag.classList.toggle('is-on', target.on);
      tag.classList.toggle('is-hot', target.index === hovered);
    }
    if (active >= 0) {
      const target = targets[active];
      if (target.kind === 'core') vector.copy(CORE).add(probe.set(1.25, 2.0, 0.3));
      else target.head.localToWorld(vector.set(0.78, 0, 0.08));
      vector.project(camera);
      onLead((vector.x * 0.5 + 0.5) * view.width, (0.5 - vector.y * 0.5) * view.height, true);
    } else {
      onLead(0, 0, false);
    }

    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  });

  notify();

  return {
    select,
    // move to the next or previous one
    step(direction) {
      const from = active >= 0 ? active : browse;
      const next = (from + direction + targets.length) % targets.length;
      if (active >= 0) select(next);
      else {
        browse = next;
        notify();
      }
    },
    // switch every workstation on, one after another
    bootAll() {
      targets.forEach((target, i) => setTimeout(() => {
        power(i);
        notify();
      }, i * 190));
    },
  };
}
