import * as THREE from 'three';

// Shared look for both 3D layers: one family of colours (deep navy, electric blue, cyan, white),
// the quality setting, and the "studio" whose light every glossy surface reflects.

export const COLORS = {
  void: '#05070f', // the dark of the room and its haze
  blue: '#2f6bff',
  cyan: '#45d4ff',
  ice: '#dcebff',
  dim: '#16203c', // a light that is switched off
};

// ---- How much to draw -------------------------------------------------------
// The lab can be drawn two ways, and the choice is made once, when the page loads:
//
//   full – drawn into a wide-range buffer, with bloom and shadows. For dedicated graphics cards.
//   lite – drawn straight to the screen: no bloom pass, no shadows. For laptop graphics and phones.
//
// The choice follows the name of the graphics chip, unless the visitor picked a mode with the
// button in the top bar (remembered in the browser) or the address says `?full` or `?lite`.
// Either way, if frames still come slowly the scene steps down further by itself (see `lower`).
// `?dpr=1` fixes the sharpness by hand, and `?hold` switches the automatic steps off.
const query = new URLSearchParams(location.search);
const asked = Number(query.get('dpr'));

function graphicsChip() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}
const STRONG = /nvidia|geforce|quadro|radeon(\(tm\))? (rx|pro)|apple m\d|apple gpu|intel\(r\) arc|arc\(tm\)/i;

function remembered() {
  try {
    return localStorage.getItem('lab-fx');
  } catch {
    return null;
  }
}

const chip = graphicsChip();
const mode = query.has('full') ? 'full' : query.has('lite') ? 'lite' : ['full', 'lite'].includes(remembered()) ? remembered() : STRONG.test(chip) ? 'full' : 'lite';
const small = Math.min(innerWidth, innerHeight) < 700; // a phone: few pixels to fill, so it can afford to be sharper

// What is given up, in order, when frames come slowly.
const STEPS = {
  full: [{ ratio: 1.25 }, { ratio: 1 }, { bloom: false }, { mirror: 0.35 }, { ratio: 0.8 }],
  lite: [{ ratio: 1 }, { mirror: 0.3 }, { ratio: 0.8 }, { mirror: 0 }, { ratio: 0.65 }],
};

export const quality = {
  mode,
  chip,
  ratio: asked > 0 ? asked : Math.min(devicePixelRatio, mode === 'full' || small ? 1.5 : 1.25), // canvas pixels per CSS pixel
  bloom: mode === 'full',
  // size of the floor's mirror image relative to the screen; 0 switches the mirror off (`?mirror=0`)
  mirror: query.has('mirror') ? Number(query.get('mirror')) : mode === 'full' ? 0.5 : 0.4,
  step: 0,
  lower() {
    if (query.has('hold')) return false;
    const steps = STEPS[mode];
    while (quality.step < steps.length) {
      const change = steps[quality.step++];
      if (change.ratio !== undefined && (asked > 0 || change.ratio >= quality.ratio)) continue; // already there
      Object.assign(quality, change);
      dispatchEvent(new Event('quality'));
      return true;
    }
    return false;
  },
  // the visitor's own choice: remember it and start again in that mode
  choose(next) {
    try {
      localStorage.setItem('lab-fx', next);
    } catch {
      // private windows may refuse; the address still carries the choice
    }
    const url = new URL(location.href);
    url.searchParams.delete('full');
    url.searchParams.delete('lite');
    url.searchParams.set(next, '');
    location.replace(url.href.replace(/=(?=&|$)/g, ''));
  },
};

// A dark room with a few long lamps: it gives metal and glass their crisp streaks of light
// without lifting the shadows. Built from shapes, so no image file is needed.
export function makeStudio(renderer) {
  const studio = new THREE.Scene();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(30, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float horizon = 1.0 - abs(vDir.y);
          vec3 col = mix(vec3(0.004, 0.006, 0.014), vec3(0.03, 0.07, 0.2), pow(horizon, 3.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  studio.add(dome);

  const lamp = (color, width, height, position) => {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    panel.position.set(...position);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
  };
  lamp(new THREE.Color(14, 16, 20), 22, 1.6, [0, 16, 6]);
  lamp(new THREE.Color(8, 10, 14), 22, 1.2, [0, 16, -8]);
  lamp(new THREE.Color(2, 6, 14), 2, 16, [-18, 4, 6]);
  lamp(new THREE.Color(2, 8, 14), 2, 16, [18, 4, -2]);
  lamp(new THREE.Color(3, 8, 12), 10, 3, [0, 3, 20]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(studio, 0.02).texture;
  pmrem.dispose();
  return texture;
}
