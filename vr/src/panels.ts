import {
  createSystem,
  effect,
  RayInteractable,
  VisibilityState,
  type Entity,
  type UIKit,
  type UIKitMLAsset,
} from '@iwsdk/core';
import type { Desk } from './desk.js';
import { COLOURS, inr, SEVERITY, STRATEGY } from './palette.js';
import { cue } from './sound.js';
import type { Detail, FeedItem, Verdict } from './types.js';
import { canListen, listen, say, stopSpeaking } from './voice.js';

// The spatial panels around the table. Left: what is waiting on the desk and the
// three-step guide. Right: the seat being covered and the verdict on the card over it.
// Behind the table, at eye level: the CrewOps Agent. All three are UIKitML documents; this
// system fills their fixed slots from the desk's signals.

const ROWS = 4;
const VERDICTS = 7;
const QUESTIONS = 3;

/** Where each panel stands on the desk, in workspace metres, and how far it turns in. */
const PLACES = {
  desk: { x: -0.47, y: 0.21, z: -0.03, yaw: 0.72, scale: 1 },
  seat: { x: 0.47, y: 0.21, z: -0.03, yaw: -0.72, scale: 1 },
  agent: { x: 0, y: 0.57, z: -0.42, yaw: 0, scale: 1.15 },
} as const;

type Element = UIKit.Component & {
  setProperties(props: Record<string, unknown>): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
type Find = (id: string) => Element;

export class PanelSystem extends createSystem({}) {
  private briefed = false;

  init(): void {
    void this.build();
  }

  private async build(): Promise<void> {
    const root = (this.globals as Record<string, unknown>).workspace as Entity;
    const desk = this.desk();
    const [left, right, back] = await Promise.all([
      this.world.assets.instantiate<UIKitMLAsset>('desk-panel'),
      this.world.assets.instantiate<UIKitMLAsset>('seat-panel'),
      this.world.assets.instantiate<UIKitMLAsset>('agent-panel'),
    ]);
    for (const [panel, place] of [
      [left, PLACES.desk],
      [right, PLACES.seat],
      [back, PLACES.agent],
    ] as const) {
      panel.position.set(place.x, place.y, place.z);
      panel.rotation.set(0, place.yaw, 0);
      panel.scale.setScalar(place.scale);
      const entity = this.world.createTransformEntity(panel, { parent: root, persistent: true });
      entity.addComponent(RayInteractable);
    }
    const finder = (panel: UIKitMLAsset): Find => (id) => panel.requireElementById(id) as Element;
    this.wireDesk(finder(left), desk);
    this.wireSeat(finder(right), desk);
    this.wireAgent(finder(back), desk);
  }

  private wireDesk(el: Find, desk: Desk): void {
    const xr = el('xr-button');
    const recenter = el('recenter-button');
    const exit = el('exit-button');
    this.on(xr, () => this.world.launchXR());
    this.on(exit, () => this.world.exitXR());
    this.on(recenter, () => ((this.globals as Record<string, unknown>).recenter as () => void)?.());
    for (let i = 0; i < ROWS; i++) {
      this.on(el(`row-${i}`), () => {
        const item = desk.feed.peek()[i];
        if (item && item.disruption_id !== desk.selected.peek()) {
          cue.select();
          void desk.select(item.disruption_id);
        }
      });
    }

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const flat = state === VisibilityState.NonImmersive;
        if (!flat && !this.briefed) {
          this.briefed = true;
          setTimeout(() => this.brief(desk), 900);
        }
        xr.setProperties({ display: flat && this.world.xrEnabled ? 'flex' : 'none' });
        exit.setProperties({ display: flat ? 'none' : 'flex' });
        recenter.setProperties({ display: flat ? 'none' : 'flex' });
      }),
      effect(() => {
        const me = desk.me.value;
        const sample = desk.backend.mode === 'sample';
        el('desk-eyebrow').setProperties({
          text: desk.approving
            ? 'CREW CONTROL  |  APPROVALS'
            : `CREW CONTROL${me?.desk ? `  |  ${me.desk.replace('desk-', 'DESK ')}` : ''}`,
        });
        el('desk-mode').setProperties({
          text: sample
            ? 'Sample operation, worked out by the real engine. Nothing is sent.'
            : me
              ? `Signed in as ${me.user_id}. Live operation.`
              : 'Signing in...',
        });
      }),
      effect(() => {
        const feed = desk.feed.value;
        const selected = desk.selected.value;
        for (let i = 0; i < ROWS; i++) this.fillRow(el, i, feed[i], selected);
        el('desk-empty').setProperties({ display: feed.length ? 'none' : 'flex' });
        const noun = desk.approving ? 'plan' : 'disruption';
        el('desk-title').setProperties({
          text: feed.length === 1 ? `1 ${noun} waiting` : `${feed.length} ${noun}s waiting`,
        });
      }),
      effect(() => {
        desk.me.value;
        const steps = desk.approving
          ? ['Choose a plan', 'Check every rule on the cover', 'Approve, or send it back']
          : ['Choose a disruption', 'Drop a crew card on the table', 'Submit for a second approval'];
        steps.forEach((text, i) => el(`step-${i + 1}-text`).setProperties({ text }));
      }),
      effect(() => {
        // the guide: done, current, or still to come
        const reviewed = desk.check.value?.state === 'done';
        const done = desk.approving
          ? [desk.detail.value !== null, reviewed, desk.sent.value > 0]
          : [desk.detail.value !== null, desk.chosen.value !== null, desk.sent.value > 0];
        const current = done.findIndex((d) => !d);
        done.forEach((isDone, i) => {
          const step = i + 1;
          const now = i === current;
          el(`step-${step}-dot`).setProperties({
            text: isDone ? 'OK' : String(step),
            backgroundColor: isDone ? '#14532d' : now ? '#0369a1' : '#16294a',
            color: isDone ? '#86efac' : now ? '#ffffff' : '#8ea3bf',
          });
          el(`step-${step}-text`).setProperties({
            color: isDone ? '#86efac' : now ? '#f1f5f9' : '#64748b',
          });
        });
      }),
    );
  }

  private fillRow(el: Find, i: number, item: FeedItem | undefined, selected: string | null): void {
    const row = el(`row-${i}`);
    if (!item) {
      row.setProperties({ display: 'none' });
      return;
    }
    const level = item.severity?.level ?? 'low';
    const colour = SEVERITY[level] ?? COLOURS.warn;
    const [who, rest] = item.summary.split(':', 2);
    const active = item.disruption_id === selected;
    row.setProperties({
      display: 'flex',
      backgroundColor: active ? '#12294a' : '#0f1b31',
      borderColor: active ? '#38bdf8' : '#1a3052',
    });
    el(`row-${i}-bar`).setProperties({ backgroundColor: colour });
    el(`row-${i}-sev`).setProperties({ text: level.toUpperCase(), backgroundColor: colour });
    el(`row-${i}-airline`).setProperties({ text: (item.airlines ?? []).join(' ') });
    el(`row-${i}-title`).setProperties({ text: clip(who ?? item.summary, 44) });
    el(`row-${i}-meta`).setProperties({
      text: clip((rest ?? '').trim() || (item.severity?.reasons ?? []).join(', '), 56),
    });
  }

  private wireSeat(el: Find, desk: Desk): void {
    this.on(el('submit-button'), () => void (desk.approving ? desk.approve() : desk.submit()));
    this.on(el('reset-button'), () => (desk.approving ? void desk.sendBack() : desk.clearChoice()));

    this.cleanupFuncs.push(
      effect(() => this.fillSeat(el, desk.detail.value)),
      effect(() => {
        const detail = desk.detail.value;
        const chosen = desk.chosen.value;
        const check = desk.check.value;
        const best = detail?.seats[0]?.options[0];
        let label = 'THE ENGINE RECOMMENDS';
        let tone: string = '#8ea3bf';
        let name = best ? best.action.replace(/^Assign /, '') : 'No cover to recommend';
        let meta = best ? `${STRATEGY[best.strategy] ?? best.strategy}  |  ${inr(best.cost_inr)}` : '';
        let verdicts: Verdict[] = [];
        if (desk.approving && desk.plan) {
          label = 'PROPOSED BY ' + (desk.plan.submitted_by ?? 'A CONTROLLER').toUpperCase();
          meta = `Plan ${desk.plan.plan_id}  |  ${inr(desk.plan.total_cost_inr ?? 0)}`;
        }
        if (check?.state === 'checking') {
          label = 'CHECKING EVERY RULE';
          tone = '#f1f5f9';
          name = check.crew_id;
          meta = 'Asking the legality engine...';
        } else if (check?.state === 'failed') {
          label = 'NO VERDICT';
          tone = COLOURS.warn;
          meta = check.message;
        } else if (check?.state === 'done') {
          const r = check.result;
          const seated = chosen?.crew_id === r.crew_id;
          label = desk.approving
            ? r.legal
              ? 'PROPOSED COVER IS LEGAL'
              : 'PROPOSED COVER FAILS A RULE'
            : seated
              ? 'IN THE SEAT'
              : r.legal
                ? 'LEGAL FOR THIS TRIP'
                : 'NOT LEGAL FOR THIS TRIP';
          tone = r.legal ? COLOURS.ok : COLOURS.bad;
          name = `${r.name} (${r.crew_id})`;
          meta = r.legal
            ? `${r.rank}  |  passes all ${new Set(r.verdicts.map((v) => v.rule_id)).size} rules`
            : `${r.rank}  |  ${new Set(r.blocking.map((v) => v.rule_id)).size} rule(s) fail`;
          verdicts = summarise(r.verdicts, r.blocking);
        } else if (chosen) {
          label = 'IN THE SEAT';
          tone = COLOURS.ok;
          name = `${chosen.name} (${chosen.crew_id})`;
        }
        el('pick-label').setProperties({ text: label, color: tone });
        el('pick-icon').setProperties({ color: tone });
        el('pick-name').setProperties({ text: clip(name, 38) });
        el('pick-meta').setProperties({ text: clip(meta, 64) });
        for (let i = 0; i < VERDICTS; i++) {
          const v = verdicts[i];
          if (!v) {
            el(`v-${i}`).setProperties({ display: 'none' });
            continue;
          }
          const pass = v.status === 'PASS';
          el(`v-${i}`).setProperties({ display: 'flex' });
          el(`v-${i}-pill`).setProperties({
            text: pass ? 'PASS' : 'FAIL',
            backgroundColor: pass ? '#22c55e' : '#ef4444',
            color: pass ? '#052e16' : '#ffffff',
          });
          el(`v-${i}-text`).setProperties({
            text: clip(`${v.rule_id}  ${v.detail}`, 58),
            color: pass ? '#cbd5e1' : '#fca5a5',
          });
        }
      }),
      effect(() => el('status-text').setProperties({ text: desk.status.value })),
      effect(() => {
        const busy = desk.busy.value;
        desk.me.value; // the role decides the wording
        const approving = desk.approving;
        el('submit-text').setProperties({
          text: busy ? 'Working...' : approving ? 'Approve and commit' : 'Submit for approval',
        });
        el('reset-text').setProperties({ text: approving ? 'Send back' : 'Recommended' });
        el('seat-eyebrow').setProperties({ text: approving ? 'PLAN FOR YOUR APPROVAL' : 'SEAT TO COVER' });
      }),
      effect(() => {
        if (desk.sent.value > 0) cue.sent();
      }),
    );
  }

  private fillSeat(el: Find, detail: Detail | null): void {
    const seat = detail?.seats[0];
    if (!detail || !seat) {
      el('seat-title').setProperties({ text: detail ? 'Nothing to cover' : 'Choose a disruption' });
      el('seat-sub').setProperties({ text: detail ? clip(detail.summary, 90) : 'Pick one on the left.' });
      return;
    }
    const ctx = seat.context ?? {};
    const flights = ctx.flights ?? [];
    const uncrewed = flights.filter((f) => f.state !== 'crewed').length;
    const dates = (ctx.dates ?? []).map((d) => `${d.slice(8)} ${month(d)}`).join(', ');
    el('seat-title').setProperties({ text: `${seat.pairing_id}  |  ${seat.role}` });
    el('seat-sub').setProperties({
      text: [
        detail.airlines?.map((a) => a.name).join(', '),
        [ctx.aircraft_type, ctx.aircraft].filter(Boolean).join(' '),
        ctx.base,
        dates,
      ]
        .filter(Boolean)
        .join('  |  '),
    });
    const tone = SEVERITY[detail.severity?.level ?? 'medium'] ?? COLOURS.warn;
    el('stat-flights').setProperties({ text: `${uncrewed} of ${flights.length}`, color: tone });
    el('stat-pax').setProperties({ text: String(seat.impact.passengers ?? 0), color: tone });
    el('stat-out').setProperties({ text: seat.crew_out ?? '-', color: '#f1f5f9' });
  }

  private wireAgent(el: Find, desk: Desk): void {
    for (let i = 0; i < QUESTIONS; i++) {
      this.on(el(`q-${i}`), () => {
        const question = desk.suggestions()[i];
        if (question) void this.askAndSay(desk, question);
      });
    }
    const mic = el('mic-button');
    mic.setProperties({ display: canListen() ? 'flex' : 'none' });
    this.on(mic, () => {
      stopSpeaking();
      el('mic-text').setProperties({ text: 'Listening...' });
      void listen().then((heard) => {
        el('mic-text').setProperties({ text: 'Ask by voice' });
        if (heard) void this.askAndSay(desk, heard);
      });
    });

    this.cleanupFuncs.push(
      effect(() => {
        const detail = desk.detail.value;
        desk.candidates.value; // the questions name a candidate the engine left out
        const questions = desk.suggestions();
        for (let i = 0; i < QUESTIONS; i++) {
          const q = questions[i];
          el(`q-${i}`).setProperties({ display: q ? 'flex' : 'none' });
          if (q) el(`q-${i}-text`).setProperties({ text: q });
        }
        el('agent-title').setProperties({
          text: detail?.seats[0] ? `Ask about ${detail.seats[0].pairing_id}` : 'Ask about this disruption',
        });
      }),
      effect(() => {
        const a = desk.answer.value;
        el('answer-text').setProperties({
          text: a
            ? clip(a.answer, 260)
            : 'Every figure in an answer comes from the legality engine and is checked before it is spoken.',
          color: a ? '#f1f5f9' : '#8ea3bf',
        });
        el('answer-meta').setProperties({ display: a?.verified ? 'flex' : 'none' });
      }),
    );
  }

  /** The first thing heard in the headset: what landed on the desk and what to do. */
  private brief(desk: Desk): void {
    const detail = desk.detail.peek();
    const seat = detail?.seats[0];
    cue.alert();
    if (!detail || !seat) return;
    const flights = seat.context?.flights ?? [];
    const uncrewed = flights.filter((f) => f.state !== 'crewed').length;
    const who = detail.summary.split(':')[0].replace(/\s*\(C-\d+\)/, '');
    const level = detail.severity?.level ?? 'medium';
    void say(
      desk.backend,
      `${level[0].toUpperCase()}${level.slice(1)} severity. ${who}. ` +
        `${uncrewed} flights and ${seat.impact.passengers ?? 0} passengers on ${seat.pairing_id} need a ${seat.role}. ` +
        'Pinch a crew card and drop it on the table.',
    );
  }

  private async askAndSay(desk: Desk, question: string): Promise<void> {
    cue.select();
    const answer = await desk.ask(question);
    if (answer?.answer) await say(desk.backend, answer.answer);
  }

  private on(element: Element, listener: () => void): void {
    element.addEventListener('click', listener);
    this.cleanupFuncs.push(() => element.removeEventListener('click', listener));
  }

  private desk(): Desk {
    return (this.globals as Record<string, unknown>).desk as Desk;
  }
}

/** One line per rule: the failures first, then each rule's tightest day. */
function summarise(verdicts: Verdict[], blocking: Verdict[]): Verdict[] {
  const byRule = new Map<string, Verdict>();
  for (const v of [...blocking, ...verdicts]) {
    const seen = byRule.get(v.rule_id);
    if (!seen) byRule.set(v.rule_id, v);
    else if (seen.status === 'PASS' && v.status === 'PASS' && (v.headroom ?? 1e9) < (seen.headroom ?? 1e9)) {
      byRule.set(v.rule_id, v);
    }
  }
  return [...byRule.values()].sort((a, b) => Number(a.status === 'PASS') - Number(b.status === 'PASS'));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function month(isoDate: string): string {
  return MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? '';
}

/** UIKit's bundled font has no ellipsis character. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}
