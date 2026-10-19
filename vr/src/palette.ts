// One palette for the map, the cards and the panels.

export const COLOURS = {
  ink: '#e6edf7',
  muted: '#8ea3bf',
  surface: '#0b1426',
  line: '#1e3a5f',
  accent: '#38bdf8',
  ok: '#22c55e',
  warn: '#f59e0b',
  bad: '#ef4444',
  crewed: '#2dd4bf',
} as const;

export const SEVERITY: Record<string, string> = {
  high: COLOURS.bad,
  medium: COLOURS.warn,
  low: COLOURS.ok,
};

/** Each airline's own colour, as in the seed operation. */
export const AIRLINES: Record<string, { name: string; colour: string }> = {
  DX: { name: 'Deccan Express', colour: '#0284c7' },
  KS: { name: 'Konkan Skyways', colour: '#ea580c' },
  NG: { name: 'Nilgiri Connect', colour: '#059669' },
};

export const STRATEGY: Record<string, string> = {
  reserve_callout: 'Reserve callout',
  day_off_callout: 'Day-off callout',
  positioning: 'Positioned in',
  command_upgrade: 'Command upgrade',
  right_seat_captain: 'Captain in right seat',
  operate_short: 'Operate one short',
  cancel: 'Cancel',
};

export function rupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/** Panels use the font UIKit bundles, which has no rupee sign. */
export function inr(amount: number): string {
  return `INR ${Math.round(amount).toLocaleString('en-IN')}`;
}
