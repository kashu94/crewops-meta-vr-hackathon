import { createSystem } from '@iwsdk/core';

// Development only (`?stats`): what each frame costs, against the Quest browser's budget of
// about 13.7 ms a frame at 72 fps. Draw calls are the main CPU cost on Quest, so they are
// counted along with triangles, textures and the time the ECS update takes (every system:
// input, grab, UI and ours). Desktop timings don't predict Quest timings; the counts do.
// Logged to the console once a second and kept in `window.crewopsStats`.

export type FrameStats = {
  fps: number;
  /** Mean and worst ECS update time over the last second, in ms. */
  updateMs: number;
  updateWorstMs: number;
  /** Per rendered frame; in a headset both eyes are drawn in one frame. */
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
};

let started = 0;
let frames = 0;
let total = 0;
let worst = 0;
let windowStart = 0;

export function statsEnabled(): boolean {
  return new URLSearchParams(window.location.search).has('stats');
}

/** Runs first: marks the start of the frame's ECS update. */
export class StatsStartSystem extends createSystem({}) {
  update(): void {
    started = performance.now();
  }
}

/** Runs last: closes the measurement and reports once a second. */
export class StatsEndSystem extends createSystem({}) {
  update(): void {
    const now = performance.now();
    const spent = now - started;
    frames++;
    total += spent;
    worst = Math.max(worst, spent);
    if (!windowStart) windowStart = now;
    if (now - windowStart < 1000) return;
    // The renderer's counters are reset at each render; read last frame's.
    const info = this.renderer.info;
    const stats: FrameStats = {
      fps: Math.round((frames * 1000) / (now - windowStart)),
      updateMs: round(total / frames),
      updateWorstMs: round(worst),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    };
    (window as unknown as { crewopsStats: FrameStats }).crewopsStats = stats;
    console.info(`[crewops-stats] ${JSON.stringify(stats)}`);
    frames = 0;
    total = 0;
    worst = 0;
    windowStart = now;
  }
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}
