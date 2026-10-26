// Disruption drills: a timed training run on the sample operation (never the live roster).
// Each disruption is scored on three things a crew controller is judged on: cover that is
// legal (the engine makes that a given), what it costs against the cheapest legal cover the
// engine found, and how long it took. Crew offered who turn out not to be legal count as
// misses. The best score is kept on this device, so there is a number to beat next time.

export type DrillResult = {
  disruption_id: string;
  pairing_id: string;
  cost_inr: number;
  best_inr: number;
  seconds: number;
  misses: number;
};

export type DrillState = {
  total: number;
  startedMs: number;
  current: { disruption_id: string; startedMs: number; missed: string[] } | null;
  results: DrillResult[];
  finishedMs: number | null;
  /** Set when the run finishes: whether it beat the best kept on this device. */
  newBest?: boolean;
};

/** Points for one disruption, out of 300. */
export const POINTS = { each: 300, perPercentOver: 3, costCap: 150, perMiss: 40, missCap: 120, freeSeconds: 45, timeCap: 100 };

export function pointsFor(r: DrillResult): { total: number; cost: number; misses: number; time: number } {
  const overPercent = r.best_inr > 0 ? Math.max(0, (r.cost_inr / r.best_inr - 1) * 100) : 0;
  const cost = Math.min(POINTS.costCap, Math.round(overPercent * POINTS.perPercentOver));
  const misses = Math.min(POINTS.missCap, r.misses * POINTS.perMiss);
  const time = Math.min(POINTS.timeCap, Math.max(0, Math.round(r.seconds - POINTS.freeSeconds)));
  return { total: Math.max(0, POINTS.each - cost - misses - time), cost, misses, time };
}

/** The run's score out of 100, and its grade. */
export function scoreOf(results: DrillResult[]): { score: number; grade: string } {
  if (!results.length) return { score: 0, grade: '-' };
  const points = results.reduce((sum, r) => sum + pointsFor(r).total, 0);
  const score = Math.round((points / (results.length * POINTS.each)) * 100);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  return { score, grade };
}

const BEST_KEY = 'crewops.drill.best';

export function bestScore(): number | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** Keeps the score if it beats the best so far. Returns whether it did. */
export function saveBest(score: number): boolean {
  const best = bestScore();
  if (best !== null && best >= score) return false;
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // private browsing: the best just isn't remembered
  }
  return true;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
