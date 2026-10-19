import { signal } from '@iwsdk/core';
import { Backend, SignInNeeded, signInUrl } from './backend.js';
import type { Answer, Detail, FeedItem, Legality, Me, Plan, Seat } from './types.js';

// The controller's desk: what is waiting, the disruption being worked, the seat being
// covered, and the cover chosen for it. Systems render these signals; only this module
// talks to the backend.

export type Candidate = {
  crew_id: string;
  name: string;
  rank: string | null;
  /** Offered by the engine (ranked by cost), or a colleague it left out. */
  offered: boolean;
  strategy: string | null;
  cost_inr: number | null;
  base: string | null;
  why_out: string | null;
};

export type Check =
  | { state: 'checking'; crew_id: string }
  | { state: 'done'; crew_id: string; result: Legality }
  | { state: 'failed'; crew_id: string; message: string };

const OPEN = new Set(['OPTIONS_READY', 'SUBMITTED', 'REPORTED', 'ESCALATED']);
const LEVEL = { high: 0, medium: 1, low: 2 } as const;
const CARDS_OFFERED = 5;
const CARDS_LEFT_OUT = 2;

export class Desk {
  readonly me = signal<Me | null>(null);
  readonly feed = signal<FeedItem[]>([]);
  readonly selected = signal<string | null>(null);
  readonly detail = signal<Detail | null>(null);
  readonly candidates = signal<Candidate[]>([]);
  /** The crew card being held over the seat, and the engine's verdict on it. */
  readonly check = signal<Check | null>(null);
  /** Whether a card is being held over the table right now. */
  readonly offering = signal(false);
  /** Cover the controller placed in the seat (null: the engine's recommendation). */
  readonly chosen = signal<Candidate | null>(null);
  readonly answer = signal<Answer | null>(null);
  readonly status = signal('Loading your desk...');
  /** Bumped each time a plan goes out, for the effects that mark it. */
  readonly sent = signal(0);
  /** Verdicts already given this session, by crew id, so a checked card keeps its stamp. */
  readonly verdicts = signal<Record<string, Legality>>({});
  readonly busy = signal(false);

  private conversation = 0;

  constructor(readonly backend: Backend) {}

  get seat(): Seat | null {
    return this.detail.peek()?.seats[0] ?? null;
  }

  /** An approver (and not also a controller) works the four-eyes queue instead. */
  get approving(): boolean {
    const roles = this.me.peek()?.roles ?? [];
    return roles.includes('approver') && !roles.includes('controller');
  }

  /** The plan waiting for this approver on the disruption being worked. */
  get plan(): Plan | null {
    return this.detail.peek()?.plans?.find((p) => p.status === 'SUBMITTED') ?? null;
  }

  async start(): Promise<void> {
    try {
      this.me.value = await this.backend.whoami();
      await this.refresh();
      const first = this.feed.peek()[0];
      if (first) await this.select(first.disruption_id);
      else this.status.value = this.approving ? 'No plans are waiting for your approval.' : 'Nothing is waiting on your desk.';
    } catch (err) {
      this.fail(err);
    }
  }

  /** Disruptions on this controller's desk that still need cover, most severe first. */
  async refresh(): Promise<void> {
    const desk = this.me.peek()?.desk;
    const all = await this.backend.feed();
    this.feed.value = this.approving
      ? all.filter((d) => d.status === 'SUBMITTED').sort((a, b) => level(a) - level(b))
      : all
          .filter((d) => OPEN.has(d.status) && d.handling !== 'recorded')
          .filter((d) => !desk || !d.desks?.length || d.desks.includes(desk))
          .sort((a, b) => level(a) - level(b));
  }

  async select(disruptionId: string): Promise<void> {
    if (this.selected.peek() === disruptionId && this.detail.peek()) return;
    this.selected.value = disruptionId;
    this.verdicts.value = {};
    this.chosen.value = null;
    this.check.value = null;
    this.answer.value = null;
    this.status.value = 'Opening the disruption...';
    try {
      const detail = await this.backend.detail(disruptionId);
      if (this.selected.peek() !== disruptionId) return;
      this.detail.value = detail;
      if (this.approving) {
        this.reviewPlan();
        return;
      }
      this.candidates.value = candidatesFor(detail.seats[0]);
      this.status.value = detail.seats.length
        ? 'Pinch a crew card and drop it on the table.'
        : 'No seat to cover on this one.';
    } catch (err) {
      this.fail(err);
    }
  }

  /** Approver: the proposed cover goes straight into the seat, and the engine checks it
   * again so the approver sees every rule before deciding. */
  private reviewPlan(): void {
    const plan = this.plan;
    const pick = plan?.picks?.find((p) => p.crew_id);
    if (!plan || !pick?.crew_id) {
      this.candidates.value = [];
      this.status.value = 'No plan is waiting on this disruption.';
      return;
    }
    const candidate: Candidate = {
      crew_id: pick.crew_id,
      name: pick.name,
      rank: pick.role,
      offered: true,
      strategy: pick.strategy ?? null,
      cost_inr: plan.total_cost_inr ?? null,
      base: null,
      why_out: null,
    };
    this.candidates.value = [candidate];
    this.chosen.value = candidate;
    this.status.value = `${plan.submitted_by ?? 'A controller'} proposes ${pick.name}. Check the rules, then decide.`;
    void this.hover(candidate);
  }

  async approve(): Promise<void> {
    const detail = this.detail.peek();
    const plan = this.plan;
    if (!detail || !plan || this.busy.peek()) return;
    this.busy.value = true;
    this.status.value = 'Approving: the engine checks every rule again...';
    try {
      const out = await this.backend.approve(detail.disruption_id, plan.plan_id);
      if (out.status === 'SAMPLE') {
        this.status.value =
          'Sample operation: nothing was changed. Live, approval re-checks legality and commits the roster in one step.';
      } else if (out.status === 'COMMITTED') {
        this.status.value = 'Approved. The roster is changed and the crew member is told.';
      } else {
        this.status.value = `Plan ${out.status.toLowerCase()}: ${(out.reasons ?? []).join(' ')}`;
      }
      this.sent.value++;
      if (out.status !== 'SAMPLE') await this.refresh();
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.value = false;
    }
  }

  async sendBack(): Promise<void> {
    const detail = this.detail.peek();
    const plan = this.plan;
    if (!detail || !plan || this.busy.peek()) return;
    this.busy.value = true;
    try {
      const out = await this.backend.sendBack(
        detail.disruption_id,
        plan.plan_id,
        'Sent back from the headset for another look.',
      );
      this.status.value =
        out.status === 'SAMPLE'
          ? 'Sample operation: nothing was sent. Live, the plan goes back to its controller.'
          : 'Sent back to the controller.';
      if (out.status !== 'SAMPLE') await this.refresh();
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.value = false;
    }
  }

  /** A card is over the seat: ask the engine whether that person is legal for it. */
  async hover(candidate: Candidate): Promise<void> {
    const seat = this.seat;
    if (!seat) return;
    const current = this.check.peek();
    if (current && current.crew_id === candidate.crew_id && current.state !== 'failed') return;
    this.check.value = { state: 'checking', crew_id: candidate.crew_id };
    try {
      const result = await this.backend.legality(candidate.crew_id, seat.pairing_id);
      if (this.check.peek()?.crew_id !== candidate.crew_id) return;
      this.check.value = result
        ? { state: 'done', crew_id: candidate.crew_id, result }
        : { state: 'failed', crew_id: candidate.crew_id, message: 'No verdict for this card.' };
      if (result) this.verdicts.value = { ...this.verdicts.peek(), [candidate.crew_id]: result };
    } catch (err) {
      this.check.value = {
        state: 'failed',
        crew_id: candidate.crew_id,
        message: err instanceof Error ? err.message : 'The legality check failed.',
      };
    }
  }

  /** The card was let go over the seat. Only a legal crew member stays in it. */
  place(candidate: Candidate): boolean {
    const check = this.check.peek();
    if (check?.state !== 'done' || check.crew_id !== candidate.crew_id) return false;
    if (!check.result.legal) {
      const rule = check.result.blocking[0];
      this.status.value = `${candidate.name} can't take this seat: ${rule?.rule_id ?? 'a rule'} fails.`;
      return false;
    }
    this.chosen.value = candidate;
    this.status.value = `${candidate.name} is in the seat. Submit when you're ready.`;
    return true;
  }

  clearChoice(): void {
    this.chosen.value = null;
    this.check.value = null;
    this.status.value = 'Back to the recommendation. Drop a card on the table to change it.';
  }

  async submit(): Promise<void> {
    const detail = this.detail.peek();
    const seat = this.seat;
    if (!detail || !seat || this.busy.peek()) return;
    const chosen = this.chosen.peek();
    const choices: Record<string, string> = chosen
      ? { [`${seat.pairing_id}/${seat.role}`]: chosen.crew_id }
      : {};
    this.busy.value = true;
    this.status.value = 'Submitting the plan...';
    try {
      const out = await this.backend.submit(detail.disruption_id, choices);
      if (out.status === 'SAMPLE') {
        this.status.value =
          'Sample operation: nothing was sent. Live, this plan now waits for a different approver.';
        this.sent.value++;
      } else {
        if (out.plan_id) this.sent.value++;
        this.status.value = out.plan_id
          ? `Plan ${out.plan_id} submitted. A different approver must approve it.`
          : `Plan ${out.status.toLowerCase()}: ${(out.reasons ?? []).join(' ')}`;
        await this.refresh();
      }
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.value = false;
    }
  }

  async ask(question: string): Promise<Answer | null> {
    const detail = this.detail.peek();
    if (!detail) return null;
    const asked = ++this.conversation;
    this.answer.value = { question, answer: 'Checking with the engine...', verified: false, source: '' };
    try {
      const out = await this.backend.ask(detail.disruption_id, question);
      if (asked !== this.conversation) return null;
      this.answer.value = { ...out, question };
      return out;
    } catch (err) {
      this.answer.value = {
        question,
        answer: err instanceof Error ? err.message : 'No answer right now.',
        verified: false,
        source: 'error',
      };
      return null;
    }
  }

  /** The three questions offered for the disruption being worked. */
  suggestions(): string[] {
    const seat = this.seat;
    if (!seat) return [];
    const out = [`${seat.crew_out} is sick for ${seat.pairing_id}. Who covers?`];
    const leftOut = this.candidates.peek().find((c) => !c.offered);
    if (leftOut) out.push(`Is ${leftOut.crew_id} legal for ${seat.pairing_id}?`);
    const best = seat.options.find((o) => o.crew_id)?.crew_id;
    if (best) out.push(`How many duty hours does ${best} have?`);
    return out;
  }

  private fail(err: unknown): void {
    if (err instanceof SignInNeeded) {
      if (window.location.port === '8081') {
        this.status.value = 'Sign in on the console at http://localhost:3000, then reload.';
      } else {
        window.location.assign(signInUrl());
      }
      return;
    }
    this.status.value = err instanceof Error ? err.message : 'Something went wrong.';
  }
}

function level(item: FeedItem): number {
  return LEVEL[item.severity?.level ?? 'low'] ?? 3;
}

/** Cards for a seat: the cheapest legal cover first, then a couple the engine left out, so
 * the controller can see why. */
export function candidatesFor(seat: Seat | undefined): Candidate[] {
  if (!seat) return [];
  const live = seat.live ?? {};
  const options = live.options?.length ? live.options : seat.options;
  const offered: Candidate[] = options
    .filter((o) => o.crew_id)
    .slice(0, CARDS_OFFERED)
    .map((o) => ({
      crew_id: o.crew_id as string,
      name: o.name,
      rank: o.crew_rank,
      offered: true,
      strategy: o.strategy,
      cost_inr: o.cost_inr,
      base: 'base' in o ? ((o as { base?: string | null }).base ?? null) : null,
      why_out: null,
    }));
  const leftOut: Candidate[] = (live.excluded ?? []).slice(0, CARDS_LEFT_OUT).map((e) => ({
    crew_id: e.crew_id,
    name: e.name,
    rank: seat.role,
    offered: false,
    strategy: null,
    cost_inr: null,
    base: null,
    why_out: e.reasons[0] ?? null,
  }));
  return [...offered, ...leftOut];
}
