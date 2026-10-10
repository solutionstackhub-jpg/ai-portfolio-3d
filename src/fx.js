import * as THREE from 'three';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { COLORS } from './studio.js';

// The headline as solid 3D letters. They stand up one by one, lean with the cursor and rise
// where it passes over them.
//
// Every letter is extruded from the page's own heading font and placed exactly where the
// (invisible) HTML letter sits, so line breaks and sizes stay with CSS. The letters are drawn
// into their own small canvas, laid over the headline, with a camera that sees the page as a
// flat sheet at a fixed distance.

const PERSPECTIVE = 1100; // px: how far the camera stands from the page
const PAD = 90; // px of room around the headline for letters that lean or rise out of its box
const RAD = Math.PI / 180;

const clamp = THREE.MathUtils.clamp;

const TEXT_VERTEX = /* glsl */ `
  attribute vec2 aCentre;
  attribute float aIndex;
  attribute float aGrad;
  uniform float uEnter;
  uniform float uCount;
  uniform vec2 uPointer;
  uniform float uLift;
  uniform float uSpan;
  varying vec3 vNormal;
  varying float vGrad;
  varying float vAcross;

  void main() {
    // letters stand up one after another
    float t = clamp((uEnter * (uCount + 10.0) - aIndex) / 10.0, 0.0, 1.0);
    t = 1.0 - pow(1.0 - t, 3.0);
    float angle = (1.0 - t) * -1.5708;
    float c = cos(angle);
    float s = sin(angle);

    vec3 q = (position - vec3(aCentre, 0.0)) * mix(0.55, 1.0, t);
    q = vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
    vec3 n = vec3(normal.x, c * normal.y - s * normal.z, s * normal.y + c * normal.z);

    // and rise towards the cursor when it passes over them
    vec2 away = aCentre - uPointer;
    float near = exp(-dot(away, away) / (uSpan * uSpan));
    q.z += near * uLift - (1.0 - t) * 90.0;
    q.y -= (1.0 - t) * 26.0;

    vNormal = normalize(normalMatrix * n);
    vGrad = aGrad;
    vAcross = position.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(q + vec3(aCentre, 0.0), 1.0);
  }
`;

const TEXT_COLORS = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec2 uRange;
  varying vec3 vNormal;
  varying float vGrad;
  varying float vAcross;
`;

function textMaterials() {
  const uniforms = {
    uEnter: { value: 0 },
    uCount: { value: 1 },
    uPointer: { value: new THREE.Vector2(9999, 9999) },
    uLift: { value: 0 },
    uSpan: { value: 60 },
    uInk: { value: new THREE.Color('#f4f8ff') },
    uA: { value: new THREE.Color('#5d8dff') },
    uB: { value: new THREE.Color(COLORS.cyan) },
    uRange: { value: new THREE.Vector2(0, 1) },
  };
  // the faces you read: white, or the blue-to-cyan gradient for the highlighted words
  const front = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TEXT_VERTEX,
    fragmentShader: /* glsl */ `
      ${TEXT_COLORS}
      void main() {
        float u = clamp((vAcross - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
        gl_FragColor = vec4(mix(uInk, mix(uA, uB, u), vGrad), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  // the depth of each letter: blue, lit from above
  const side = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TEXT_VERTEX,
    fragmentShader: /* glsl */ `
      ${TEXT_COLORS}
      void main() {
        float u = clamp((vAcross - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
        float light = 0.55 + 0.45 * dot(normalize(vNormal), normalize(vec3(-0.3, 0.8, 0.5)));
        vec3 colour = mix(mix(uA, uB, u) * 0.85, mix(uA, uB, u) * 0.42, vGrad);
        gl_FragColor = vec4(colour * light, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { uniforms, front, side };
}

// Break a heading into one span per letter (grouped by word, so lines still break between words).
function splitLetters(root) {
  if (root.dataset.split) return [...root.querySelectorAll('.char')];
  root.dataset.split = 'true';
  root.setAttribute('aria-label', root.textContent);
  const walk = (node, grad) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const fragment = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            fragment.append(' ');
            continue;
          }
          const word = document.createElement('span');
          word.className = 'word';
          word.setAttribute('aria-hidden', 'true');
          for (const letter of Array.from(part)) {
            const span = document.createElement('span');
            span.className = 'char';
            span.textContent = letter;
            if (grad) span.dataset.grad = '1';
            word.append(span);
          }
          fragment.append(word);
        }
        child.replaceWith(fragment);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child, grad || child.classList.contains('grad'));
      }
    }
  };
  walk(root, false);
  return [...root.querySelectorAll('.char')];
}

// Where the font's baseline sits inside a letter's box, measured from the page itself.
function baselineOffset(letter) {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  letter.parentElement.insertBefore(probe, letter);
  const offset = probe.getBoundingClientRect().bottom - letter.getBoundingClientRect().top;
  probe.remove();
  return offset;
}

// Extrude a list of placed letters into two meshes' worth of triangles: faces and sides.
function buildLetters(font, letters, size, depth) {
  const parts = [
    { position: [], normal: [], centre: [], index: [], grad: [] },
    { position: [], normal: [], centre: [], index: [], grad: [] },
  ];
  letters.forEach((letter, order) => {
    const shapes = font.generateShapes(letter.text, size);
    if (!shapes.length) return;
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 5 });
    geometry.translate(letter.x, letter.y, -depth);
    const position = geometry.attributes.position.array;
    const normal = geometry.attributes.normal.array;
    for (const group of geometry.groups) {
      const part = parts[group.materialIndex];
      for (let v = group.start; v < group.start + group.count; v++) {
        part.position.push(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
        part.normal.push(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]);
        part.centre.push(letter.cx, letter.cy);
        part.index.push(order);
        part.grad.push(letter.grad ? 1 : 0);
      }
    }
    geometry.dispose();
  });
  return parts.map((part) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normal, 3));
    geometry.setAttribute('aCentre', new THREE.Float32BufferAttribute(part.centre, 2));
    geometry.setAttribute('aIndex', new THREE.Float32BufferAttribute(part.index, 1));
    geometry.setAttribute('aGrad', new THREE.Float32BufferAttribute(part.grad, 1));
    return geometry;
  });
}

// A child's box inside `root`, ignoring transforms.
function innerBox(el, root) {
  let x = 0;
  let y = 0;
  for (let node = el; node && node !== root; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.autoClear = false;
  const root = document.documentElement;
  root.classList.add('fx');

  const camera = new THREE.PerspectiveCamera(30, 1, 20, PERSPECTIVE * 3);
  camera.position.z = PERSPECTIVE;

  let font = null;
  const pointer = { x: -9999, y: -9999, nx: 0, ny: 0, active: false };
  const stage = { x: 0, y: 0, width: 1, height: 1 }; // the part of the window the canvas covers

  const items = [...document.querySelectorAll('[data-fx="text"]')].map((el, order) => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    return { el, scene, group, box: { x: 0, y: 0, w: 0, h: 0 }, rx: 0, ry: 0, wanted: true, amount: 0, wait: 2.2 + order * 0.2, phase: Math.random() * 10 };
  });

  addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.nx = (event.clientX / innerWidth) * 2 - 1;
    pointer.ny = (event.clientY / innerHeight) * 2 - 1;
    pointer.active = true;
  });
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.active = false;
  });

  // ---- rebuilt whenever the headline's box changes -------------------------
  function layoutText(item) {
    const { el } = item;
    const letters = splitLetters(el);
    if (!letters.length) return;
    const { w, h } = item.box;
    const size = parseFloat(getComputedStyle(el).fontSize);
    const baseline = baselineOffset(letters[0]);
    const placed = letters.map((span) => {
      const box = innerBox(span, el);
      return {
        text: span.textContent,
        x: box.x - w / 2,
        y: h / 2 - (box.y + baseline),
        cx: box.x + box.w / 2 - w / 2,
        cy: h / 2 - (box.y + box.h / 2),
        grad: span.dataset.grad === '1',
      };
    });
    const graded = placed.filter((letter) => letter.grad);
    const range = graded.length ? graded : placed;
    item.materials ??= textMaterials();
    item.materials.uniforms.uRange.value.set(Math.min(...range.map((l) => l.x)), Math.max(...range.map((l) => l.cx * 2 - l.x)));
    item.materials.uniforms.uCount.value = placed.length;
    item.materials.uniforms.uSpan.value = size * 1.1;
    item.size = size;
    const [faces, sides] = buildLetters(font, placed, size, size * 0.12);
    item.group.clear();
    item.body?.forEach((old) => old.geometry.dispose());
    item.body = [new THREE.Mesh(faces, item.materials.front), new THREE.Mesh(sides, item.materials.side)];
    item.group.add(...item.body);
  }

  function layout() {
    if (!font) return;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const item of items) {
      // the element itself is never transformed, so this is its resting place
      const rect = item.el.getBoundingClientRect();
      const box = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      const resized = Math.abs(box.w - item.box.w) > 0.5 || Math.abs(box.h - item.box.h) > 0.5;
      item.box = box;
      if (resized && box.w > 2) layoutText(item);
      left = Math.min(left, box.x - PAD);
      top = Math.min(top, box.y - PAD);
      right = Math.max(right, box.x + box.w + PAD);
      bottom = Math.max(bottom, box.y + box.h + PAD);
    }
    if (left === Infinity) return;
    // the canvas covers only the headline and the room its letters need: a small surface is
    // cheap for the browser to lay over the 3D scene on every frame
    Object.assign(stage, { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top) });
    Object.assign(canvas.style, { left: `${stage.x}px`, top: `${stage.y}px`, width: `${stage.width}px`, height: `${stage.height}px` });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(stage.width, stage.height, false);
  }

  let layoutQueued = false;
  const queueLayout = () => {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      layout();
    });
  };
  layout();
  new ResizeObserver(queueLayout).observe(document.body);
  addEventListener('resize', queueLayout);

  // Wait for the page's web font before measuring letters, then for the outline data.
  Promise.all([fetch('fonts/jakarta-800.json').then((response) => response.json()), document.fonts.ready])
    .then(([data]) => {
      // the 3D letters are placed on the HTML letters, so they need the same font to be showing
      if (!document.fonts.check('800 40px "Plus Jakarta Sans"')) return;
      font = new Font(data);
      root.classList.add('fx-text');
      layout();
    })
    .catch((error) => console.warn('3D headline unavailable:', error));

  // ---- every frame ---------------------------------------------------------
  let last = 0;
  let time = 0;
  let blank = false;

  renderer.setAnimationLoop((ms) => {
    const now = ms / 1000;
    const dt = Math.min(now - last, 1);
    last = now;
    time += dt;

    // coming and going: `amount` runs from 0 (away) to 1 (every letter standing)
    for (const item of items) {
      if (item.wait > 0) item.wait -= dt;
      else item.amount = clamp(item.amount + (item.wanted ? dt / 1.5 : -dt / 0.45), 0, 1);
    }
    // nothing to show (a workstation is open): wipe the canvas once and do no more work
    if (!items.some((item) => item.materials && item.amount > 0)) {
      if (!blank) {
        renderer.setScissorTest(false);
        renderer.clear();
        blank = true;
      }
      return;
    }
    blank = false;

    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    const ease = 1 - Math.exp(-dt * 9);

    for (const item of items) {
      const { box } = item;
      if (!item.materials || box.w < 2 || item.amount <= 0) continue;

      // lean with the cursor, drift a little when left alone
      const rx = Math.sin(time * 0.9 + item.phase) * 0.9 + (pointer.active ? -pointer.ny * 6 : 0);
      const ry = Math.cos(time * 0.7 + item.phase * 1.7) * 1.3 + (pointer.active ? pointer.nx * 9 : 0);
      item.rx += (rx - item.rx) * ease;
      item.ry += (ry - item.ry) * ease;
      item.group.rotation.set(-item.rx * RAD, item.ry * RAD, 0);

      const uniforms = item.materials.uniforms;
      uniforms.uEnter.value = item.amount;
      const overText = pointer.active && pointer.y > box.y - 50 && pointer.y < box.y + box.h + 50;
      uniforms.uLift.value += ((overText ? item.size * 0.4 : 0) - uniforms.uLift.value) * ease;
      uniforms.uPointer.value.set(pointer.x - (box.x + box.w / 2), box.y + box.h / 2 - pointer.y);

      // draw it into its own window of the canvas
      const width = box.w + PAD * 2;
      const height = box.h + PAD * 2;
      const left = box.x - PAD - stage.x;
      const bottom = stage.height - (box.y - PAD - stage.y + height);
      renderer.setViewport(left, bottom, width, height);
      renderer.setScissor(left, bottom, width, height);
      camera.fov = (2 * Math.atan(height / 2 / PERSPECTIVE)) / RAD;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.render(item.scene, camera);
    }
  });

  return {
    layout: queueLayout,
    // bring an element's 3D letters in, or send them away
    show(el, on) {
      const item = items.find((candidate) => candidate.el === el);
      if (item) item.wanted = on;
    },
  };
}
