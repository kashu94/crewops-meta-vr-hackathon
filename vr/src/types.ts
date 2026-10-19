// The shapes the CrewOps MCP server returns, as far as the headset reads them. The web
// console's lib/types.ts has the full versions.

export type Me = {
  user_id: string;
  roles: string[];
  crew_id: string | null;
  desk: string | null;
};

export type Severity = { level: 'high' | 'medium' | 'low'; reasons: string[] };

export type FeedItem = {
  disruption_id: string;
  status: string;
  report_type: string | null;
  summary: string;
  severity?: Severity | null;
  desks?: string[];
  airlines?: string[];
  handling?: string | null;
};

export type Option = {
  rank: number;
  action: string;
  strategy: string;
  crew_id: string | null;
  name: string;
  crew_rank: string | null;
  cost_inr: number;
  delay_hours: number;
};

export type Excluded = {
  crew_id: string;
  name: string;
  stage: string;
  rule_ids: string[];
  reasons: string[];
};

export type SeatFlight = {
  flight_id: string;
  flight_no: string;
  date: string;
  from: string;
  to: string;
  dep_utc: string;
  arr_utc: string;
  seats: number;
  booked?: number | null;
  state: 'uncrewed' | 'at_risk' | 'crewed';
};

export type Seat = {
  pairing_id: string;
  role: string;
  crew_out: string | null;
  status: string;
  note: string;
  options: Option[];
  impact: { passengers?: number; uncovered_flights?: string[]; at_risk_flights?: string[] };
  context?: {
    aircraft?: string;
    aircraft_type?: string | null;
    base?: string | null;
    dates?: string[];
    requirement?: string;
    flights?: SeatFlight[];
  };
  live?: { options?: (Option & { base?: string | null })[]; excluded?: Excluded[] } | null;
};

export type Detail = {
  disruption_id: string;
  status: string;
  summary: string;
  severity?: Severity | null;
  airlines?: { code: string; name: string; color: string }[];
  details: Record<string, unknown>;
  seats: Seat[];
  plans?: Plan[];
};

export type Plan = {
  plan_id: string;
  status: string;
  submitted_by?: string;
  total_cost_inr?: number;
  picks?: { pairing_id: string; role: string; crew_id: string | null; name: string; strategy?: string }[];
};

export type Verdict = {
  rule_id: string;
  status: string;
  detail: string;
  used?: number | null;
  limit?: number | null;
  headroom: number | null;
  date: string | null;
};

export type Legality = {
  crew_id: string;
  name: string;
  rank: string;
  pairing_id: string;
  legal: boolean;
  blocking: Verdict[];
  verdicts: Verdict[];
};

export type Answer = {
  question?: string;
  answer: string;
  verified: boolean;
  source: string;
};

export type Submitted = { status: string; plan_id?: string; reasons?: string[] };
