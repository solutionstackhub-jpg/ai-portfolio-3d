import { content } from './content.js';
import { createScene } from './scene.js';
import { createStage } from './fx.js';
import { quality } from './studio.js';

// ---------------------------------------------------------------------------
// 1. Build the page from content.js
//    The page is one screen: the 3D lab fills it, and the interface sits on top
//    like the read-outs of a control room. The headline stands at the bottom of
//    the aisle; a text window unfolds next to whatever is switched on.
// ---------------------------------------------------------------------------
const ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  link: '<path d="M7 17 17 7M9 7h8v8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  power: '<path d="M12 4v8"/><path d="M7.5 7a7 7 0 1 0 9 0"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
const esc = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const two = (n) => String(n + 1).padStart(2, '0');
const clamp = (x, low, high) => Math.min(Math.max(x, low), Math.max(low, high));

const { hero, machines } = content;
const displayName = content.name || content.role;
const contactIndex = Math.max(0, machines.findIndex((machine) => machine.core || machine.email));

document.title = content.name ? `${content.name} · ${content.role}` : content.role;

document.getElementById('top').innerHTML = `
  <a class="brand" href="./">
    ${content.photo ? `<img src="${esc(content.photo)}" alt="">` : '<i></i>'}
    <span><b>${esc(displayName)}</b>${content.name ? `<small>${esc(content.role)}</small>` : ''}</span>
  </a>
  <p class="status" id="status" aria-live="polite"><i></i><span>0/${machines.length} online</span></p>
  <button class="mode" type="button" data-mode title="Graphics: full adds bloom and shadows, lite runs faster. Click to switch.">FX · ${quality.mode}</button>
  <button class="btn" type="button" data-open="${contactIndex}">${esc(hero.primary)}${icon('arrow')}</button>`;

// The text of one machine as a column of strips that unfold one below the other.
function strips(machine, index) {
  const points = (machine.points ?? [])
    .map((line) => {
      const cut = line.indexOf(':');
      return cut > 0 ? `<li><b>${esc(line.slice(0, cut))}</b>${esc(line.slice(cut + 1))}</li>` : `<li>${esc(line)}</li>`;
    })
    .join('');
  const tags = (machine.tags ?? []).map((tag) => `<span>${esc(tag)}</span>`).join('');
  const actions = [
    machine.email && `<a class="btn btn--solid" href="mailto:${esc(machine.email)}">${icon('mail')}${esc(machine.email)}</a>`,
    ...(machine.links ?? []).map((link) => `<a class="btn" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)}${icon('link')}</a>`),
  ].filter(Boolean).join('');

  const profile = machine.core && content.name && `<div class="fold fold--me">${content.photo ? `<img src="${esc(content.photo)}" alt="Portrait of ${esc(content.name)}">` : ''}<p><b>${esc(content.name)}</b><span>${esc(content.role)}</span><em><i></i>${esc(hero.status)}</em></p></div>`;

  return [
    `<div class="fold fold--bar"><code>~/lab/${two(index)}-${esc(machine.id)}</code><button class="panel-close" type="button" data-open="-1" aria-label="Close">${icon('close')}</button></div>`,
    `<div class="fold"><p class="kicker"><i></i>${machine.core ? 'AI core' : `Workstation ${two(index)}`} · online</p><h2>${esc(machine.title)}</h2></div>`,
    profile,
    machine.text && `<div class="fold"><p>${esc(machine.text)}</p></div>`,
    points && `<div class="fold"><ul class="points">${points}</ul></div>`,
    tags && `<div class="fold"><p class="tags">${tags}</p></div>`,
    actions && `<div class="fold fold--actions">${actions}</div>`,
    `<div class="fold fold--foot"><button type="button" data-step="-1">${icon('back')}Prev</button><span>${two(index)} / ${two(machines.length - 1)}</span><button type="button" data-step="1">Next${icon('arrow')}</button></div>`,
  ]
    .filter(Boolean)
    .map((strip, i) => strip.replace('class="fold', `style="--i:${i}" class="fold`))
    .join('');
}

document.getElementById('app').innerHTML = `
  <section class="hero" id="hero">
    <p class="pill"><i></i>${esc(hero.status)}</p>
    <h1 data-fx="text">${esc(hero.title[0])} <span class="grad">${esc(hero.title[1])}</span></h1>
    <p class="lede">${content.name ? `I’m ${esc(content.name)}, ${/^[aeiou]/i.test(content.role) ? 'an' : 'a'} ${esc(content.role)}. ` : ''}${esc(hero.text)}</p>
    <p class="hint"><span class="for-mouse">${esc(hero.hint)}</span><span class="for-touch">${esc(hero.hintTouch ?? hero.hint)}</span></p>
  </section>

  <nav class="bar" data-ui aria-label="Workstations">
    <button class="boot" type="button" data-boot>${icon('power')}<span>${esc(hero.secondary)}</span></button>
    <div class="index" id="index">
      ${machines.map((machine, i) => `<button type="button" data-open="${i}"><b>${two(i)}</b><span>${esc(machine.label)}</span></button>`).join('')}
    </div>
  </nav>

  <svg class="lead" id="lead" aria-hidden="true"><path/><circle r="4.5"/></svg>
  <aside class="panel" id="panel" data-ui aria-live="polite"><div class="panel-sheet" id="sheet"></div></aside>

  <div class="hud" aria-hidden="true">
    <i class="corner corner--tl"></i><i class="corner corner--tr"></i><i class="corner corner--bl"></i><i class="corner corner--br"></i>
    <p class="readout readout--left" id="coords">X +0.00 · Y +0.00</p>
    <p class="readout readout--right" id="load">CORE LOAD 00%</p>
  </div>
  <div class="cursor" id="cursor" aria-hidden="true"><i></i><span></span></div>

  <!-- shown only when the browser cannot draw 3D: the same text as a plain list -->
  <section class="plain">
    ${machines.map((machine, i) => `<article>${strips(machine, i)}</article>`).join('')}
  </section>`;

// ---------------------------------------------------------------------------
// 2. Start the two 3D layers (the page still works without WebGL)
//    scene.js – the lab: hall, core, workstations
//    fx.js    – the headline as solid 3D letters
// ---------------------------------------------------------------------------
const root = document.documentElement;
const panel = document.getElementById('panel');
const sheet = document.getElementById('sheet');
const lead = document.getElementById('lead');
const indexItems = [...document.querySelectorAll('#index button')];
const statusText = document.querySelector('#status span');
const loadText = document.getElementById('load');
const heading = document.querySelector('.hero h1');
const cursor = document.getElementById('cursor');
const cursorLabel = cursor.querySelector('span');
const wide = () => innerWidth >= 900;

let scene = null;
let stage = null;
let state = { active: -1, browse: 0, hovered: -1, online: machines.map(() => false) };
let shown = -1; // the machine whose text is in the window
let swap = 0;

// Fold the window shut, change its text, and unfold it again.
function showPanel(index) {
  if (index === shown) return;
  shown = index;
  const turn = ++swap;
  panel.classList.remove('is-open');
  if (index < 0) return;
  setTimeout(() => {
    if (turn !== swap) return;
    sheet.innerHTML = strips(machines[index], index);
    requestAnimationFrame(() => requestAnimationFrame(() => turn === swap && panel.classList.add('is-open')));
  }, 230);
}

function onChange(next) {
  state = next;
  const { active, browse, hovered, online } = state;
  root.classList.toggle('is-focus', active >= 0);
  stage?.show(heading, active < 0);
  const current = active >= 0 ? active : wide() ? -1 : browse;
  indexItems.forEach((item, i) => {
    item.classList.toggle('is-active', i === current);
    item.classList.toggle('is-on', online[i]);
    item.classList.toggle('is-hot', i === hovered);
  });
  // in a narrow window the bar is wider than the screen: keep the current item in view
  if (!wide()) indexItems[current]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  const count = online.filter(Boolean).length;
  statusText.textContent = `${count}/${online.length} online`;
  loadText.textContent = `CORE LOAD ${String(Math.round((count / online.length) * 100)).padStart(2, '0')}%`;
  root.classList.toggle('is-live', count > 0);

  // the cursor says what a click will do
  cursor.classList.toggle('is-hot', hovered >= 0);
  if (hovered >= 0) cursorLabel.textContent = machines[hovered].core ? 'Contact' : online[hovered] ? 'Open' : 'Boot';
  showPanel(active);
}

// The text window stays pinned beside whatever is open, and a line ties the two together.
const leadPath = lead.querySelector('path');
const leadDot = lead.querySelector('circle');
const windowSize = { width: 0, height: 0 }; // measured when it changes, not on every frame
new ResizeObserver(() => {
  windowSize.width = panel.offsetWidth;
  windowSize.height = sheet.offsetHeight;
}).observe(sheet);
function onLead(x, y, on) {
  const open = on && wide();
  lead.classList.toggle('is-on', open && panel.classList.contains('is-open'));
  if (!open) {
    if (!wide()) panel.style.transform = '';
    return;
  }
  const left = clamp(x + 64, 24, innerWidth - windowSize.width - 28);
  const top = clamp(y - 150, 92, innerHeight - windowSize.height - 96);
  panel.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
  const bend = Math.max(30, (left - x) * 0.5);
  leadPath.setAttribute('d', `M${x.toFixed(1)} ${y.toFixed(1)} C${(x + bend).toFixed(1)} ${y.toFixed(1)} ${(left - bend).toFixed(1)} ${(top + 26).toFixed(1)} ${left.toFixed(1)} ${(top + 26).toFixed(1)}`);
  leadDot.setAttribute('cx', x.toFixed(1));
  leadDot.setAttribute('cy', y.toFixed(1));
}

try {
  scene = createScene(document.getElementById('scene'), {
    machines,
    labelRoot: document.getElementById('anchors'),
    onChange,
    onLead,
  });
} catch (error) {
  console.warn('3D scene unavailable:', error);
  root.classList.add('no-webgl');
}

if (scene) {
  try {
    stage = createStage(document.getElementById('fx'));
  } catch (error) {
    console.warn('3D headline unavailable:', error);
    root.classList.remove('fx', 'fx-text');
  }
}

// ---------------------------------------------------------------------------
// 3. Controls: bottom bar, keyboard, wheel
// ---------------------------------------------------------------------------
document.addEventListener('click', (event) => {
  const opener = event.target.closest('[data-open]');
  const stepper = event.target.closest('[data-step]');
  if (opener) scene?.select(Number(opener.dataset.open));
  else if (stepper) scene?.step(Number(stepper.dataset.step));
  else if (event.target.closest('[data-boot]')) scene?.bootAll();
  else if (event.target.closest('[data-mode]')) quality.choose(quality.mode === 'full' ? 'lite' : 'full');
});

addEventListener('keydown', (event) => {
  if (event.key === 'Escape') scene?.select(-1);
  else if (event.key === 'ArrowRight') scene?.step(1);
  else if (event.key === 'ArrowLeft') scene?.step(-1);
});

// Scrolling walks through the lab: the hall first, then each workstation in turn.
let wheelFree = 0;
addEventListener('wheel', (event) => {
  // (unless the pointer is on a text window that has its own scrolling, as on a phone)
  const scrolls = event.target.closest?.('.panel') && panel.scrollHeight > panel.clientHeight + 1;
  if (!scene || scrolls || Math.abs(event.deltaY) < 12 || performance.now() < wheelFree) return;
  const next = state.active + (event.deltaY > 0 ? 1 : -1);
  if (next < -1 || next >= machines.length) return;
  wheelFree = performance.now() + 750;
  scene.select(next);
}, { passive: true });

// ---------------------------------------------------------------------------
// 4. A ring that trails the pointer and says what a click will do, and a read-out of where it is.
//    The system pointer stays visible: it never lags, whatever the 3D scene is doing.
// ---------------------------------------------------------------------------
if (scene && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const coords = document.getElementById('coords');
  const signed = (value) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`;
  const at = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };

  addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    at.tx = event.clientX;
    at.ty = event.clientY;
    cursor.classList.add('is-shown');
    cursor.classList.toggle('is-ui', Boolean(event.target.closest?.('a, button')));
    coords.textContent = `X ${signed((event.clientX / innerWidth) * 2 - 1)} · Y ${signed(1 - (event.clientY / innerHeight) * 2)}`;
    // the text window leans a little towards the pointer
    panel.style.setProperty('--lean-y', `${((event.clientX / innerWidth) * 2 - 1) * -4}deg`);
    panel.style.setProperty('--lean-x', `${((event.clientY / innerHeight) * 2 - 1) * 3}deg`);
  });
  document.documentElement.addEventListener('pointerleave', () => cursor.classList.remove('is-shown'));
  addEventListener('pointerdown', () => cursor.classList.add('is-down'));
  addEventListener('pointerup', () => cursor.classList.remove('is-down'));

  const follow = () => {
    at.x += (at.tx - at.x) * 0.3;
    at.y += (at.ty - at.y) * 0.3;
    cursor.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
    requestAnimationFrame(follow);
  };
  follow();
}
