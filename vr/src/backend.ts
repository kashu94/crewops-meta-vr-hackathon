import type { Answer, Detail, FeedItem, Legality, Me, Submitted } from './types.js';

// Where the headset's data comes from.
//
// live:   the web app's own routes (/api/tools/<name>, /api/speak) on the same origin, as
//         the person signed in to the console. Every role rule is the MCP server's.
// sample: files under /vr/sample/, written by scripts/vr_sample.py from the real engine,
//         for trying the workspace without an account: a controller's desk, or with
//         `as=approver` an approver's. Nothing is ever sent from it.

export type Mode = 'live' | 'sample';

export class SignInNeeded extends Error {}

const BASE = import.meta.env.BASE_URL;

export class Backend {
  private cache = new Map<string, Promise<unknown>>();

  constructor(
    readonly mode: Mode,
    /** Which sample desk: '' for the controller's, 'approver/' for the approver's. */
    private readonly sampleSet = '',
  ) {}

  /** `?sample` or `?live` choose; otherwise the built app is live and the dev server, which
   * usually runs without the web app behind it, uses the sample. */
  static fromLocation(): Backend {
    const params = new URLSearchParams(window.location.search);
    const set = params.get('as') === 'approver' ? 'approver/' : '';
    if (params.has('sample')) return new Backend('sample', set);
    if (params.has('live')) return new Backend('live');
    return import.meta.env.DEV ? new Backend('sample', set) : new Backend('live');
  }

  whoami(): Promise<Me> {
    return this.mode === 'sample' ? this.file<Me>('whoami') : this.tool<Me>('whoami');
  }

  async feed(): Promise<FeedItem[]> {
    if (this.mode === 'sample') return this.file<FeedItem[]>('disruptions');
    return this.tool<FeedItem[]>('disruptions', { limit: 40 });
  }

  async detail(disruptionId: string): Promise<Detail> {
    if (this.mode === 'sample') {
      const all = await this.file<Record<string, Detail>>('details');
      const found = all[disruptionId];
      if (!found) throw new Error(`No sample for ${disruptionId}.`);
      return found;
    }
    return this.tool<Detail>('show_disruption', { disruption_id: disruptionId });
  }

  /** The engine's verdict on one crew member for one pairing, every rule with its margin. */
  async legality(crewId: string, pairingId: string): Promise<Legality | null> {
    const key = `${crewId}/${pairingId}`;
    let pending = this.cache.get(`legality:${key}`) as Promise<Legality | null> | undefined;
    if (!pending) {
      pending = this.loadLegality(crewId, pairingId, key);
      this.cache.set(`legality:${key}`, pending);
      pending.catch(() => this.cache.delete(`legality:${key}`));
    }
    return pending;
  }

  async submit(disruptionId: string, choices: Record<string, string>): Promise<Submitted> {
    if (this.mode === 'sample') return { status: 'SAMPLE' };
    const args: Record<string, unknown> = { disruption_id: disruptionId };
    if (Object.keys(choices).length) args.choices = choices;
    return this.tool<Submitted>('submit_plan', args);
  }

  /** Approver: approve a plan someone else submitted. The server re-checks legality and
   * commits the roster in one step. */
  async approve(disruptionId: string, planId: string): Promise<Submitted> {
    if (this.mode === 'sample') return { status: 'SAMPLE' };
    return this.tool<Submitted>('approve_plan', { disruption_id: disruptionId, plan_id: planId });
  }

  async sendBack(disruptionId: string, planId: string, reason: string): Promise<Submitted> {
    if (this.mode === 'sample') return { status: 'SAMPLE' };
    return this.tool<Submitted>('reject_plan', { disruption_id: disruptionId, plan_id: planId, reason });
  }

  async ask(disruptionId: string, question: string): Promise<Answer> {
    if (this.mode === 'sample') {
      const all = await this.file<Record<string, Answer[]>>('answers');
      const found = (all[disruptionId] ?? []).find((a) => a.question === question);
      if (!found) {
        return {
          answer: 'In the sample operation only the suggested questions have answers.',
          verified: false,
          source: 'sample',
        };
      }
      return found;
    }
    return this.tool<Answer>('ask', { question, conversation_id: `vr-${disruptionId}` });
  }

  /** Spoken audio for a reply: Polly through the web app when live. */
  async speech(text: string): Promise<Blob | null> {
    if (this.mode === 'sample') return null;
    const response = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return response.ok ? response.blob() : null;
  }

  private async loadLegality(crewId: string, pairingId: string, key: string) {
    if (this.mode === 'sample') {
      const all = await this.file<Record<string, { ok: boolean; result?: Legality }>>('legality');
      return all[key]?.result ?? null;
    }
    const out = await this.tool<{ ok: boolean; result?: Legality; error?: string }>('crew_tool', {
      name: 'check_legality',
      arguments: { crew_id: crewId, pairing_id: pairingId },
    });
    if (!out.ok) throw new Error(out.error ?? 'The legality check failed.');
    return out.result ?? null;
  }

  private file<T>(name: string): Promise<T> {
    let pending = this.cache.get(`file:${name}`) as Promise<T> | undefined;
    if (!pending) {
      pending = fetch(`${BASE}sample/${this.sampleSet}${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`The sample operation is missing ${name}.json.`);
        return r.json() as Promise<T>;
      });
      this.cache.set(`file:${name}`, pending);
    }
    return pending;
  }

  private async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/tools/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch {
      throw new Error('CrewOps is unreachable right now.');
    }
    const data = (await response.json().catch(() => ({}))) as { result?: T; error?: string };
    if (response.status === 401) throw new SignInNeeded(data.error ?? 'Sign in first.');
    if (!response.ok) throw new Error(data.error ?? 'Something went wrong.');
    return data.result as T;
  }
}

/** The console's sign-in page, coming back here afterwards. */
export function signInUrl(): string {
  return `/login?next=${encodeURIComponent(`${BASE}`)}`;
}
