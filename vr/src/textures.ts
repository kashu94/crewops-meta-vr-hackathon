import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import type { Candidate } from './desk.js';
import { INDIA, projectLatLon, SEAS } from './geo.js';
import { AIRLINES, COLOURS, rupees, STRATEGY } from './palette.js';

// Card faces, station labels and the map surface are drawn once on a canvas each. Text
// on a texture is sharp at arm's length and costs one draw call per object.

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function canvas(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  return { c, ctx };
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}

/** Wraps to at most `lines` lines, the last one cut short. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = word;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length > lines) out.length = lines;
  const last = out.length - 1;
  if (last >= 0 && words.join(' ').length > out.join(' ').length) out[last] = fit(ctx, `${out[last]}…`, max);
  return out;
}

export const CARD_PX = { w: 400, h: 560 };

export type CardVerdict = { legal: boolean; note: string } | null;

/** A crew card: dark glass with the airline's colour, the person's initials, how they
 * would come in and what it costs. Once the engine has checked them, its verdict is
 * stamped across the foot of the card. */
export function cardTexture(card: Candidate, airline: string | undefined, verdict: CardVerdict = null): CanvasTexture {
  const { c, ctx } = canvas(CARD_PX.w, CARD_PX.h);
  const tint = card.offered ? (AIRLINES[airline ?? '']?.colour ?? COLOURS.accent) : '#64748b';
  const W = CARD_PX.w;
  const H = CARD_PX.h;

  rounded(ctx, 8, 8, W - 16, H - 16, 36);
  const body = ctx.createLinearGradient(0, 0, 0, H);
  body.addColorStop(0, '#13213b');
  body.addColorStop(1, '#0a1222');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, 0, W, H * 0.6);
  sheen.addColorStop(0, `${tint}55`);
  sheen.addColorStop(0.45, `${tint}00`);
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.lineWidth = 5;
  ctx.strokeStyle = `${tint}cc`;
  rounded(ctx, 8, 8, W - 16, H - 16, 36);
  ctx.stroke();

  // initials avatar
  const initials = card.name
    .replace(/[^A-Za-z. ]/g, '')
    .split(/[ .]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  ctx.beginPath();
  ctx.arc(84, 92, 50, 0, Math.PI * 2);
  const av = ctx.createLinearGradient(34, 42, 134, 142);
  av.addColorStop(0, tint);
  av.addColorStop(1, '#0f172a');
  ctx.fillStyle = av;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 40px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, 84, 94);
  ctx.textAlign = 'left';

  ctx.fillStyle = card.offered ? tint : '#94a3b8';
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText((card.rank ?? 'Crew').toUpperCase(), 152, 74);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(card.crew_id + (card.base ? `  ·  ${card.base}` : ''), 152, 110);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f1f5f9';
  ctx.font = `700 48px ${FONT}`;
  ctx.fillText(fit(ctx, card.name, W - 64), 32, 214);

  if (card.offered) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(fit(ctx, STRATEGY[card.strategy ?? ''] ?? card.strategy ?? '', W - 64), 32, 262);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 66px ${FONT}`;
    ctx.fillText(card.cost_inr != null ? rupees(card.cost_inr) : '', 32, 352);
    ctx.fillStyle = '#64748b';
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText('COST TO CALL IN', 32, 388);
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText('Not on the engine’s list', 32, 262);
    ctx.fillStyle = '#94a3b8';
    ctx.font = `500 26px ${FONT}`;
    wrap(ctx, 'Same rank, same base. Drop on the table to see why not.', W - 64, 3).forEach(
      (line, i) => ctx.fillText(line, 32, 306 + i * 36),
    );
  }

  // the foot: an invitation, or the engine's verdict
  const footY = H - 118;
  if (verdict) {
    const colour = verdict.legal ? COLOURS.ok : COLOURS.bad;
    rounded(ctx, 26, footY, W - 52, 86, 22);
    ctx.fillStyle = verdict.legal ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.16)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(verdict.legal ? 'LEGAL' : 'NOT LEGAL', 48, footY + 38);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(fit(ctx, verdict.note, W - 100), 48, footY + 70);
  } else {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
    rounded(ctx, 26, footY + 22, W - 52, 56, 28);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('PINCH  ·  DROP ON THE TABLE', W / 2, footY + 58);
    ctx.textAlign = 'left';
  }
  return texture(c);
}

/** A station code with its city underneath, for a sprite above the pin. */
export function labelTexture(code: string, city: string): CanvasTexture {
  const { c, ctx } = canvas(256, 128);
  rounded(ctx, 8, 8, 240, 112, 26);
  ctx.fillStyle = 'rgba(4, 10, 24, 0.78)';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = COLOURS.ink;
  ctx.font = `700 52px ${FONT}`;
  ctx.fillText(code, 128, 66);
  ctx.fillStyle = COLOURS.muted;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(city, 128, 102);
  return texture(c);
}

/** One line of text on a dark pill: the seat's caption and short notices. */
export function captionTexture(text: string, colour: string = COLOURS.ink): CanvasTexture {
  const { c, ctx } = canvas(768, 112);
  rounded(ctx, 6, 6, 756, 100, 50);
  ctx.fillStyle = 'rgba(4, 10, 24, 0.82)';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(fit(ctx, text, 700), 384, 58);
  return texture(c);
}

/** The holotable's surface, `size` metres across: a dot-matrix India with a glowing
 * coastline, a graticule, range rings, bearing ticks and the seas' names. */
export function tableTexture(size: number): CanvasTexture {
  const px = 2048;
  const { c, ctx } = canvas(px, px);
  const mid = px / 2;
  const toPx = (lat: number, lon: number): [number, number] => {
    const [x, z] = projectLatLon(lat, lon);
    return [(x / size + 0.5) * px, (z / size + 0.5) * px];
  };

  const sea = ctx.createRadialGradient(mid, mid * 0.92, 60, mid, mid, mid);
  sea.addColorStop(0, 'rgba(14, 42, 80, 0.96)');
  sea.addColorStop(0.7, 'rgba(6, 18, 40, 0.94)');
  sea.addColorStop(1, 'rgba(3, 8, 20, 0.0)');
  ctx.fillStyle = sea;
  ctx.beginPath();
  ctx.arc(mid, mid, mid, 0, Math.PI * 2);
  ctx.fill();

  // graticule every 5 degrees
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.lineWidth = 2;
  for (let lon = 55; lon <= 110; lon += 5) {
    const [x1, y1] = toPx(0, lon);
    const [x2, y2] = toPx(45, lon);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  for (let lat = 0; lat <= 45; lat += 5) {
    const [x1, y1] = toPx(lat, 55);
    const [x2, y2] = toPx(lat, 110);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // the land: soft fill, a dot matrix inside it, a glowing coastline
  const land = new Path2D();
  INDIA.forEach(([lat, lon], i) => {
    const [x, y] = toPx(lat, lon);
    if (i === 0) land.moveTo(x, y);
    else land.lineTo(x, y);
  });
  land.closePath();
  const fill = ctx.createLinearGradient(0, mid * 0.3, 0, mid * 1.7);
  fill.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
  fill.addColorStop(1, 'rgba(45, 212, 191, 0.10)');
  ctx.fillStyle = fill;
  ctx.fill(land);
  ctx.fillStyle = 'rgba(125, 211, 252, 0.55)';
  const step = 15;
  for (let y = step / 2; y < px; y += step) {
    for (let x = step / 2; x < px; x += step) {
      if (ctx.isPointInPath(land, x, y)) {
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.save();
  ctx.shadowColor = 'rgba(56, 189, 248, 0.9)';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.95)';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke(land);
  ctx.restore();

  // range rings and bearing ticks around the rim
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.lineWidth = 2;
  for (const r of [0.3, 0.55, 0.8]) {
    ctx.setLineDash(r === 0.8 ? [] : [10, 14]);
    ctx.beginPath();
    ctx.arc(mid, mid, mid * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (let deg = 0; deg < 360; deg += 5) {
    const long = deg % 30 === 0;
    const a = (deg * Math.PI) / 180;
    const r1 = mid * 0.9;
    const r2 = mid * (long ? 0.85 : 0.875);
    ctx.strokeStyle = long ? 'rgba(125, 211, 252, 0.7)' : 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = long ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(mid + Math.sin(a) * r1, mid - Math.cos(a) * r1);
    ctx.lineTo(mid + Math.sin(a) * r2, mid - Math.cos(a) * r2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(186, 230, 253, 0.9)';
  ctx.font = `700 40px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('N', mid, mid * 0.08 + 40);

  ctx.fillStyle = 'rgba(125, 211, 252, 0.35)';
  ctx.font = `600 30px ${FONT}`;
  for (const s of SEAS) {
    const [x, y] = toPx(s.lat, s.lon);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillText(s.name.split('').join(String.fromCharCode(8202)), 0, 0);
    ctx.restore();
  }

  // fade the outer edge into nothing
  ctx.globalCompositeOperation = 'destination-in';
  const edge = ctx.createRadialGradient(mid, mid, mid * 0.86, mid, mid, mid * 0.99);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, px, px);
  return texture(c);
}

/** A soft round glow for beams, halos and shockwaves. */
export function glowTexture(): CanvasTexture {
  const { c, ctx } = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** A vertical fade, bright at the bottom: light beams and the seat's light column. */
export function beamTexture(): CanvasTexture {
  const { c, ctx } = canvas(16, 256);
  const g = ctx.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  return texture(c);
}

/** A small top-down airliner, for the aircraft flying the disrupted trip. */
export function aircraftTexture(): CanvasTexture {
  const { c, ctx } = canvas(128, 128);
  ctx.translate(64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  // nose up (towards -y), wings and tailplane
  ctx.moveTo(0, -52);
  ctx.quadraticCurveTo(7, -44, 7, -30);
  ctx.lineTo(7, -10);
  ctx.lineTo(52, 12);
  ctx.lineTo(52, 22);
  ctx.lineTo(7, 12);
  ctx.lineTo(6, 34);
  ctx.lineTo(20, 46);
  ctx.lineTo(20, 53);
  ctx.lineTo(0, 47);
  ctx.lineTo(-20, 53);
  ctx.lineTo(-20, 46);
  ctx.lineTo(-6, 34);
  ctx.lineTo(-7, 12);
  ctx.lineTo(-52, 22);
  ctx.lineTo(-52, 12);
  ctx.lineTo(-7, -10);
  ctx.lineTo(-7, -30);
  ctx.quadraticCurveTo(-7, -44, 0, -52);
  ctx.fill();
  return texture(c);
}
