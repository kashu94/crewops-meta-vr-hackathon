import { CanvasTexture, createSystem, effect, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Entity } from '@iwsdk/core';
import type { Check, Desk } from './desk.js';
import { COLOURS, SEVERITY } from './palette.js';
import type { Detail, Verdict } from './types.js';

// The duty timeline, standing behind the table: the disrupted trip's legs day by day (in
// India time, as crew control reads them), and, once a card has been checked, that
// person's tightest duty limits as gauges. It shows why the engine said yes or no.

const W = 2048;
const H = 440;
const SIZE = { w: 0.82, h: 0.176 };
const PLACE = { x: 0, y: 0.355, z: -0.4 };
const IST_MINUTES = 330;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GAUGES: [string, string][] = [
  ['RULE-FDP-01', 'FLIGHT DUTY PERIOD'],
  ['RULE-DUTY-02', 'DUTY, 7 DAYS'],
  ['RULE-FLT-03', 'FLYING, 28 DAYS'],
];

export class TimelineSystem extends createSystem({}) {
  private canvas = document.createElement('canvas');
  private texture!: CanvasTexture;

  init(): void {
    const desk = (this.globals as Record<string, unknown>).desk as Desk;
    const root = (this.globals as Record<string, unknown>).workspace as Entity;
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const board = new Mesh(
      new PlaneGeometry(SIZE.w, SIZE.h),
      new MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    board.name = 'duty-timeline';
    board.position.set(PLACE.x, PLACE.y, PLACE.z);
    this.world.createTransformEntity(board, { parent: root, persistent: true });
    this.cleanupFuncs.push(
      effect(() => {
        const detail = desk.detail.value;
        const check = desk.check.value;
        const chosen = desk.chosen.value;
        const verdicts = desk.verdicts.value;
        // the card in the seat keeps its gauges once nothing is being held
        const shown: Check | null =
          check ?? (chosen && verdicts[chosen.crew_id] ? { state: 'done', crew_id: chosen.crew_id, result: verdicts[chosen.crew_id] } : null);
        this.draw(detail, shown);
      }),
    );
  }

  private draw(detail: Detail | null, check: Check | null): void {
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 40);
    ctx.fillStyle = 'rgba(10, 18, 34, 0.94)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1f3b63';
    ctx.stroke();

    const seat = detail?.seats[0];
    const flights = seat?.context?.flights ?? [];
    ctx.fillStyle = COLOURS.accent;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText('DUTY TIMELINE', 48, 70);
    ctx.fillStyle = '#64748b';
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(seat ? `${seat.pairing_id}  ·  ${seat.role}  ·  IST` : 'Choose a disruption', 400, 70);

    // the trip, one column per day
    const days = [...new Set(flights.map((f) => localDate(f.dep_utc)))];
    const left = 48;
    const right = 1180;
    const top = 104;
    const lane = 150;
    const colour = SEVERITY[detail?.severity?.level ?? 'medium'] ?? COLOURS.warn;
    const width = (right - left - (days.length - 1) * 24) / Math.max(1, days.length);
    days.forEach((day, d) => {
      const x0 = left + d * (width + 24);
      const legs = flights.filter((f) => localDate(f.dep_utc) === day);
      const start = Math.min(...legs.map((f) => minutes(f.dep_utc))) - 30;
      const end = Math.max(...legs.map((f) => minutes(f.arr_utc))) + 30;
      const scale = width / (end - start);
      ctx.fillStyle = '#0f1b31';
      ctx.beginPath();
      ctx.roundRect(x0, top, width, lane + 160, 20);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = `800 32px ${FONT}`;
      ctx.fillText(dayLabel(day), x0 + 20, top + 44);
      // hour ticks
      ctx.font = `600 26px ${FONT}`;
      for (let h = Math.ceil(start / 60); h * 60 <= end; h += 3) {
        const x = x0 + (h * 60 - start) * scale;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.fillRect(x, top + 60, 2, lane + 40);
        ctx.fillStyle = '#64748b';
        ctx.fillText(`${String(h % 24).padStart(2, '0')}:00`, x + 6, top + lane + 140);
      }
      for (const f of legs) {
        const x = x0 + (minutes(f.dep_utc) - start) * scale;
        const w = Math.max(40, (minutes(f.arr_utc) - minutes(f.dep_utc)) * scale);
        const tint = check?.state === 'done' && check.result.legal ? COLOURS.ok : f.state === 'crewed' ? COLOURS.crewed : colour;
        ctx.fillStyle = `${tint}33`;
        ctx.strokeStyle = tint;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x, top + 70, w, 150, 16);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f1f5f9';
        ctx.font = `800 34px ${FONT}`;
        ctx.fillText(f.flight_no, x + 12, top + 116, w - 20);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = `600 30px ${FONT}`;
        ctx.fillText(`${f.from}`, x + 12, top + 158, w - 20);
        ctx.fillText(`${f.to}`, x + 12, top + 196, w - 20);
      }
    });

    // the checked person's tightest limits
    const gx = 1220;
    ctx.fillStyle = '#0f1b31';
    ctx.beginPath();
    ctx.roundRect(gx, top, W - gx - 48, lane + 160, 20);
    ctx.fill();
    if (check?.state !== 'done') {
      ctx.fillStyle = '#64748b';
      ctx.font = `600 34px ${FONT}`;
      ctx.fillText('Drop a crew card on the table', gx + 36, top + 130);
      ctx.fillText('to see their duty limits here.', gx + 36, top + 180);
      this.texture.needsUpdate = true;
      return;
    }
    const r = check.result;
    ctx.fillStyle = r.legal ? COLOURS.ok : COLOURS.bad;
    ctx.font = `800 32px ${FONT}`;
    ctx.fillText(`${r.name.toUpperCase()}  ·  ${r.legal ? 'LEGAL' : 'NOT LEGAL'}`, gx + 32, top + 46);
    GAUGES.forEach(([rule, label], i) => {
      const v = tightest(r.verdicts, rule);
      const y = top + 84 + i * 76;
      ctx.fillStyle = '#94a3b8';
      ctx.font = `700 24px ${FONT}`;
      ctx.fillText(label, gx + 32, y + 22);
      const bx = gx + 32;
      const bw = W - 48 - bx - 250;
      ctx.fillStyle = '#16294a';
      ctx.beginPath();
      ctx.roundRect(bx, y + 34, bw, 26, 13);
      ctx.fill();
      if (!v || v.used == null || !v.limit) return;
      const share = Math.min(1, v.used / v.limit);
      const tone = v.status !== 'PASS' ? COLOURS.bad : share > 0.85 ? COLOURS.warn : COLOURS.ok;
      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.roundRect(bx, y + 34, Math.max(26, bw * share), 26, 13);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText(`${trim(v.used)} / ${trim(v.limit)} h`, bx + bw + 20, y + 58);
    });
    this.texture.needsUpdate = true;
  }
}

/** The day with the least headroom for a rule (a failure beats any pass). */
function tightest(verdicts: Verdict[], rule: string): Verdict | undefined {
  return verdicts
    .filter((v) => v.rule_id === rule)
    .sort((a, b) => Number(a.status === 'PASS') - Number(b.status === 'PASS') || (a.headroom ?? 1e9) - (b.headroom ?? 1e9))[0];
}

function minutes(utc: string): number {
  const d = new Date(utc);
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_MINUTES) % (24 * 60);
}

function localDate(utc: string): string {
  return new Date(new Date(utc).getTime() + IST_MINUTES * 60_000).toISOString().slice(0, 10);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function dayLabel(iso: string): string {
  return `${iso.slice(8)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
