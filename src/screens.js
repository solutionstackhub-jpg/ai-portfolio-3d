// What each computer shows on its display. Everything is drawn with the 2D canvas API into a
// small canvas that the 3D scene uses as the screen's picture. The displays are ultra-wide.

export const SCREEN = { width: 768, height: 328 };

const W = SCREEN.width;
const H = SCREEN.height;
const TAU = Math.PI * 2;
const BLUE = '#3f7dff';
const CYAN = '#4fd8ff';
const sans = (weight, size) => `${weight} ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
const mono = (size) => `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
const white = (alpha) => `rgba(232, 241, 255, ${alpha})`;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function box(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// Break a title into lines that fit.
function wrap(ctx, text, width) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
    if (ctx.measureText(next).width > width && lines[lines.length - 1]) lines.push(word);
    else lines[lines.length - 1] = next;
  }
  return lines;
}

// ---- the little app each kind of machine runs --------------------------------
// Each draws inside a box 364 wide and 232 tall, on the right half of the display.
const APPS = {
  chat(ctx, t) {
    const lines = [
      ['you', 'How do refunds work?'],
      ['ai', 'Within 5 days · policy.pdf'],
      ['you', 'And for annual plans?'],
    ];
    const loop = t % 8;
    ctx.font = sans(500, 17);
    lines.forEach(([who, text], i) => {
      const age = loop - i * 1.5;
      if (age < 0) return;
      const typing = who === 'ai' && age < 0.9;
      const width = (typing ? 66 : ctx.measureText(text).width + 32) * ease(age * 4);
      const x = who === 'you' ? 364 - width : 0;
      const y = 14 + i * 70;
      box(ctx, x, y, width, 46, 16, who === 'you' ? BLUE : white(0.12));
      if (age < 0.25) return;
      if (typing) {
        for (let d = 0; d < 3; d++) {
          ctx.fillStyle = white(0.4 + 0.5 * Math.max(0, Math.sin(age * 9 - d)));
          ctx.beginPath();
          ctx.arc(x + 21 + d * 12, y + 23, 3.6, 0, TAU);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = white(0.97);
        ctx.fillText(text, x + 16, y + 29);
      }
    });
  },

  search(ctx, t) {
    const loop = t % 7;
    const query = 'refund policy, annual plans';
    box(ctx, 0, 6, 364, 46, 23, white(0.08), white(0.24));
    ctx.font = mono(16);
    ctx.fillStyle = white(0.94);
    ctx.fillText(query.slice(0, Math.floor(loop * 14)) + (loop % 0.8 < 0.4 ? '▍' : ''), 22, 35);
    for (let i = 0; i < 3; i++) {
      const age = ease((loop - 2.3 - i * 0.45) * 2.5);
      if (age <= 0) continue;
      const y = 74 + i * 54;
      ctx.globalAlpha = age;
      box(ctx, 0, y, 38, 38, 9, BLUE);
      box(ctx, 54, y + 6, 210 - i * 34, 9, 4.5, white(0.42));
      box(ctx, 54, y + 23, 130 + i * 40, 9, 4.5, CYAN);
      ctx.font = mono(13);
      ctx.fillStyle = white(0.6);
      ctx.fillText(`p.${12 + i * 7}`, 322, y + 24);
      ctx.globalAlpha = 1;
    }
  },

  agents(ctx, t) {
    const nodes = [[26, 112], [128, 44], [128, 180], [236, 112], [336, 112]];
    const links = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]];
    const labels = ['plan', 'call tool', 'check', 'approve', 'done'];
    const step = Math.floor((t * 0.9) % links.length);
    ctx.lineWidth = 3;
    links.forEach(([a, b], i) => {
      ctx.strokeStyle = i === step ? CYAN : white(0.2);
      ctx.beginPath();
      ctx.moveTo(...nodes[a]);
      ctx.lineTo(...nodes[b]);
      ctx.stroke();
    });
    const [a, b] = links[step];
    const s = (t * 0.9) % 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(nodes[a][0] + (nodes[b][0] - nodes[a][0]) * s, nodes[a][1] + (nodes[b][1] - nodes[a][1]) * s, 6.5, 0, TAU);
    ctx.fill();
    ctx.font = mono(13);
    ctx.textAlign = 'center';
    nodes.forEach(([x, y], i) => {
      const live = i === links[step][1];
      ctx.fillStyle = live ? CYAN : BLUE;
      ctx.beginPath();
      ctx.arc(x, y, live ? 21 : 16, 0, TAU);
      ctx.fill();
      ctx.fillStyle = white(live ? 1 : 0.62);
      ctx.fillText(labels[i], Math.min(Math.max(x, 28), 336), y + 42);
    });
    ctx.textAlign = 'left';
  },

  gauge(ctx, t) {
    const loop = t % 7;
    ctx.font = mono(14);
    for (let i = 0; i < 4; i++) {
      const done = loop > 0.8 + i * 0.7;
      const y = 8 + i * 54;
      box(ctx, 0, y, 150, 38, 10, white(done ? 0.13 : 0.06));
      ctx.fillStyle = done ? CYAN : white(0.35);
      ctx.fillText(done ? '✓' : '·', 14, y + 25);
      ctx.fillStyle = white(done ? 0.94 : 0.45);
      ctx.fillText(`test set ${i + 1}`, 38, y + 25);
    }
    // a line that falls as caching takes effect
    ctx.fillStyle = white(0.62);
    ctx.fillText('cost / request', 186, 26);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const reach = ease(loop / 4);
    for (let i = 0; i <= 40 * reach; i++) {
      const u = i / 40;
      const y = 56 + u * 140 + Math.sin(u * 16) * 9 * (1 - u);
      if (i === 0) ctx.moveTo(186, y);
      else ctx.lineTo(186 + u * 178, y);
    }
    ctx.stroke();
  },

  stack(ctx, t) {
    const names = ['CLOUD', 'DATA', 'API', 'INTERFACE'];
    const lit = Math.floor((t * 1.1) % 5);
    ctx.font = mono(15);
    names.forEach((name, i) => {
      const y = 214 - i * 54;
      const on = i <= lit;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(196, y);
      ctx.lineTo(240, y - 30);
      ctx.lineTo(44, y - 30);
      ctx.closePath();
      ctx.fillStyle = on ? (i === lit ? CYAN : BLUE) : white(0.1);
      ctx.fill();
      ctx.fillStyle = white(on ? 0.96 : 0.4);
      ctx.fillText(name, 262, y - 9);
    });
  },

  steps(ctx, t) {
    const names = ['Understand', 'Prototype', 'Build', 'Ship'];
    const progress = (t * 0.28) % 1.25;
    const x0 = 34;
    const x1 = 330;
    box(ctx, x0, 87, x1 - x0, 7, 3.5, white(0.14));
    box(ctx, x0, 87, (x1 - x0) * Math.min(progress, 1), 7, 3.5, CYAN);
    ctx.textAlign = 'center';
    names.forEach((name, i) => {
      const x = x0 + ((x1 - x0) * i) / 3;
      const done = progress >= i / 3;
      ctx.fillStyle = done ? CYAN : '#14204f';
      ctx.beginPath();
      ctx.arc(x, 90, 20, 0, TAU);
      ctx.fill();
      ctx.font = mono(15);
      ctx.fillStyle = done ? '#04102e' : white(0.5);
      ctx.fillText(`0${i + 1}`, x, 95);
      ctx.font = sans(600, 15);
      ctx.fillStyle = white(done ? 0.96 : 0.45);
      ctx.fillText(name, x, 146);
    });
    ctx.textAlign = 'left';
  },

  mail(ctx, t, machine) {
    ctx.lineWidth = 3;
    box(ctx, 0, 30, 130, 92, 12, null, CYAN);
    ctx.beginPath();
    ctx.moveTo(5, 37);
    ctx.lineTo(65, 84);
    ctx.lineTo(125, 37);
    ctx.stroke();
    ctx.font = mono(18);
    ctx.fillStyle = white(0.96);
    ctx.fillText(`${machine.email ?? ''}${t % 1 < 0.5 ? '▍' : ''}`, 0, 168);
    ctx.font = sans(500, 16);
    ctx.fillStyle = white(0.6);
    ctx.fillText('say hello · I reply with a plan', 0, 198);
  },
};

// ---------------------------------------------------------------------------

function backdrop(ctx, top, bottom) {
  const sky = ctx.createLinearGradient(0, 0, W, H);
  sky.addColorStop(0, top);
  sky.addColorStop(1, bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
}

// Asleep: the machine's number and name, breathing slowly, and a band of light drifting across.
function standby(ctx, machine, index, time, hover) {
  backdrop(ctx, '#040a1f', '#0a1a4a');
  const drift = ((time * 0.11 + index * 0.37) % 1.6) - 0.3;
  const sheen = ctx.createLinearGradient(W * drift - 180, 0, W * drift + 180, H);
  sheen.addColorStop(0, 'rgba(90, 150, 255, 0)');
  sheen.addColorStop(0.5, 'rgba(90, 150, 255, 0.2)');
  sheen.addColorStop(1, 'rgba(90, 150, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  const breath = 0.5 + 0.5 * Math.sin(time * 1.6 + index);
  ctx.font = sans(800, 230);
  ctx.fillStyle = `rgba(110, 190, 255, ${0.5 + breath * 0.18 + hover * 0.3})`;
  ctx.fillText(String(index + 1).padStart(2, '0'), 40, 246);

  ctx.font = sans(700, 38);
  ctx.fillStyle = white(0.9);
  wrap(ctx, machine.label, 360)
    .slice(0, 2)
    .forEach((line, i) => ctx.fillText(line, 372, 128 + i * 44));
  ctx.font = mono(19);
  ctx.fillStyle = hover > 0.5 ? CYAN : white(0.55);
  ctx.fillText(hover > 0.5 ? '▸ CLICK TO BOOT' : 'STANDBY', 398, 232);
  ctx.fillStyle = `rgba(79, 216, 255, ${0.45 + breath * 0.55})`;
  ctx.beginPath();
  ctx.arc(380, 225, 6, 0, TAU);
  ctx.fill();
}

const BOOT_LOG = ['power .......... ok', 'memory ......... ok', 'model weights .. loaded', 'vector store ... mounted', 'tools .......... ready'];

function booting(ctx, machine, age) {
  backdrop(ctx, '#050b24', '#0b1d5c');

  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.strokeStyle = white(0.14);
  ctx.beginPath();
  ctx.arc(150, 142, 46, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = CYAN;
  ctx.beginPath();
  ctx.arc(150, 142, 46, age * 7, age * 7 + 1.9);
  ctx.stroke();
  ctx.lineCap = 'butt';
  box(ctx, 60, 232, 180, 7, 3.5, white(0.16));
  box(ctx, 60, 232, 180 * Math.min(age / 1.15, 1), 7, 3.5, CYAN);

  ctx.font = mono(17);
  ctx.fillStyle = CYAN;
  ctx.fillText(`> boot ${machine.id}`, 320, 78);
  ctx.fillStyle = white(0.82);
  BOOT_LOG.slice(0, Math.floor(age * 5)).forEach((line, i) => ctx.fillText(line, 320, 112 + i * 30));

  // the flash of a display coming alive
  if (age < 0.2) {
    ctx.fillStyle = `rgba(225, 240, 255, ${1 - age / 0.2})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function running(ctx, machine, index, time, age) {
  backdrop(ctx, '#071033', '#0d2470');

  for (let d = 0; d < 3; d++) {
    ctx.fillStyle = white(0.3);
    ctx.beginPath();
    ctx.arc(46 + d * 17, 40, 5, 0, TAU);
    ctx.fill();
  }
  ctx.font = mono(14);
  ctx.fillStyle = white(0.55);
  ctx.fillText(`~/lab/${String(index + 1).padStart(2, '0')}-${machine.id}`, 104, 45);
  ctx.textAlign = 'right';
  ctx.fillStyle = CYAN;
  ctx.fillText('● ONLINE', W - 36, 45);
  ctx.textAlign = 'left';

  ctx.font = sans(700, 31);
  ctx.fillStyle = '#fff';
  wrap(ctx, machine.title, 300)
    .slice(0, 4)
    .forEach((line, i) => ctx.fillText(line, 36, 108 + i * 38));

  ctx.font = mono(13);
  let x = 36;
  for (const tag of (machine.tags ?? []).slice(0, 3)) {
    const width = ctx.measureText(tag).width + 20;
    if (x + width > 340) break;
    box(ctx, x, 268, width, 28, 8, 'rgba(79, 216, 255, 0.14)', 'rgba(79, 216, 255, 0.4)');
    ctx.fillStyle = white(0.9);
    ctx.fillText(tag, x + 10, 287);
    x += width + 8;
  }

  ctx.save();
  ctx.translate(372, 66);
  ctx.lineWidth = 2;
  (APPS[machine.screen] ?? APPS.steps)(ctx, Math.max(0, age - 1.3), machine);
  ctx.restore();
}

// state: { power 0..1, age: seconds since it was switched on, time, hover 0..1 }
export function drawScreen(ctx, machine, index, { power, age, time, hover }) {
  if (power < 0.02) {
    standby(ctx, machine, index, time, hover);
    return;
  }
  if (age < 1.3) booting(ctx, machine, age);
  else running(ctx, machine, index, time, age);
  if (power < 1) {
    ctx.fillStyle = `rgba(4, 8, 22, ${1 - power})`;
    ctx.fillRect(0, 0, W, H);
  }
}
