# CrewOps VR

A hands-first crew control workspace for Meta Quest, built for the Productivity track of the
Meta VR Start Developer Competition 2026.

A captain calls in sick at 01:30. Today a crew controller digs through rosters, duty-hour
sheets and certification records on flat screens to find a legal replacement. In CrewOps VR
the disruption lands on a holotable on the controller's real desk, in passthrough. The trip
that lost its captain grows out of the hub leg by leg, every station it touches lights up,
and an aircraft flies the route. The controller pinches a reserve pilot's card from the
tray and drops it on the table: the engine checks that person against every rule for the
trip, the seat turns green or red, and the reason is right there. Legal cover flies into
the seat, the whole trip turns green, and the plan goes to a second person to approve.

> The model selects, sequences and narrates. It never calculates.

Every crew id, duty hour and rupee in the headset comes from a deterministic legality
engine, never from a model's own arithmetic. A verifier checks the agent's wording against
the tool results before anything is spoken.

## Try it

| Where | What |
|---|---|
| `https://<host>/vr?sample=1` | A controller's desk on a sample operation worked out by the real engine (three sick calls across three airlines). No account; nothing is sent |
| `https://<host>/vr?sample=1&as=approver` | An approver's desk, with one plan waiting for the four-eyes decision |
| `https://<host>/vr` | The live workspace, as the person signed in to the console |

Open the link in the Meta Quest browser and choose **Enter the headset view**. Outside a
headset the same desk runs in the browser, worked with the mouse.

## The experience

| In the headset | How it works |
|---|---|
| Holotable | India's network on a dark glass table anchored in front of the seated controller (passthrough): a dot-matrix landmass, range rings, every station the airlines fly |
| Blast radius | The trip that lost its crew member grows out leg by leg in its severity colour; its stations raise light beams and ripples; an aircraft flies the trip and traffic pulses along the uncrewed legs |
| Crew cards | The engine's cover, cheapest first, plus colleagues it left out, on a curved tray within reach. Pinch one (hand-tracking ray, controller trigger, or mouse) |
| Drop on the table | Bring a card over the table and the engine checks that person against every rule for the trip, live. The seat hologram turns green or red, the card is stamped LEGAL or NOT LEGAL, and the seat panel lists every rule with its margin |
| Duty timeline | The trip's legs day by day in IST, and the checked person's tightest limits as gauges (flight duty period, 7-day duty, 28-day flying) |
| Seat and submit | Let go over the table: legal cover flies into the seat, a shockwave crosses the table and the trip turns green. Submit sends the plan for approval |
| Four eyes | An approver sees the plan waiting, the proposed cover already in the seat and checked again, and approves (commits the roster) or sends it back |
| CrewOps Agent | Suggested questions for the disruption, or voice where the browser can hear; the verified answer is shown and spoken |
| First five minutes | The desk rises into place, an alert chime and a short spoken brief say what happened, and a three-step guide on the desk ticks off as you go |
| Sound | Synthesised cues for pick-up, a legal or failing verdict, cover placed and a plan sent |

Everything is usable with hands alone, seated. One session handles one disruption, from
alert to submitted (or approved) plan, in a few minutes.

## What the backend does

It answers crew-control questions: lookups ("who is on reserve at BLR?"), replacements
("who covers P-2291?"), legality ("is C-2087 legal for P-2291?") and consequences ("both
A320 captains are sick, what's the joint plan?").

It reacts to disruptions without being asked. A sick call or an incident goes onto a queue,
and the disruption analysis works out the blast radius and the legal options, ranked by
cost, before the controller asks. Each change is pushed live to the headset and the console.

Seats are covered the way crew control covers them. Cover only ever comes from the airline
that flies the trip, ranked by what it costs (callout, seniority and travel allowances,
positioning and any delay). When fewer than three of the seat's own rank are legal, the
regulated substitutes follow: a command-qualified first officer for a captain, a captain in
the right seat for a first officer, or one cabin crew short while one per 50 seats remains.
Cancelling is always the last choice, and no two-pilot aircraft is offered with one pilot.

Every crew change has four eyes on it. One person reports, a controller picks a plan, a
different person approves it, and only then is it committed in one transaction. Role checks
live in code, never in a prompt.

## Roles

| Role | Can do |
|---|---|
| Crew | See own schedule, report own unavailability |
| Reporter | Record any disruption: sick crew (one or several), certification expiry, delays, aircraft faults, station and gate closures, gate changes |
| Controller | Review disruptions and options, submit one plan for approval |
| Approver | Approve or reject submitted plans; approval commits them |
| Auditor | Read-only access to every disruption, decision and audit record |
| Admin | Tighten rule thresholds, read the system activity log, manage alert addresses |
| Super admin | Everything an admin does, and relax a rule threshold back towards regulation |
| Speaker | A device, not a person: hears the alert briefs for its desk or the room |

## Architecture

```
  Meta Quest (WebXR, IWSDK, /vr)   Web console (Next.js)        Any MCP host
             \                            |                          /
              ▼                           ▼                         ▼
        ┌──────────────────────────────────────────────────────────────┐
        │ App server: sign-in, tool calls as the signed-in person       │
        └──────────────────────────────┬───────────────────────────────┘
                                       │ MCP (Streamable HTTP)
        ┌──────────────────────────────▼───────────────────────────────┐
        │ CrewOps MCP server on AgentCore Runtime                       │
        │ agent: router → advisor (Bedrock) → verifier → explainer      │
        │ Bedrock Guardrails · AgentCore Memory                         │
        └───────────┬───────────────────────────────┬──────────────────┘
                    ▼                               ▼
        Legality engine (pure Python)        S3 Vectors + Titan V2
                    │
                    ▼
        DynamoDB ──Streams──┬──► disruption analysis (Lambda)
                    ▲       └──► notifier (Lambda) ──► live updates (AppSync Events)
                    │                              └─► email and desktop alerts
        SQS ingestion (live reports) · S3 roster uploads (batch)
```

## AWS services

| Service | Role |
|---|---|
| Amazon Bedrock | Tool-calling models (any Converse model, set in `.env`), Titan V2 embeddings, Guardrails |
| Amazon Bedrock AgentCore | Runtime for the MCP server, Memory, Observability |
| Amazon DynamoDB | Operational data (single table) with Streams |
| Amazon S3 Vectors | Hybrid search over rules, example questions and past scenarios |
| Amazon SQS + AWS Lambda | Real-time disruption ingestion and background analysis |
| Amazon SNS | Optional email alerts, assigned to roles by the admin |
| Amazon EventBridge Scheduler | One-time escalation checks for untouched disruptions |
| AWS Systems Manager Parameter Store | Web push keys |
| AWS AppSync Events | Live updates to the headset and the console |
| Amazon Cognito | Sign-in, with one group per role |
| Amazon Polly | Spoken answers and alerts |
| AWS CDK | Infrastructure as code |

## Repository layout

```
data/seed/              The seed operating week (JSON), carried forward to 31 December on load
data/eval/              Gold questions, paraphrases, reference scenarios and the held-out set
data/team/              The demo team: usernames and roles, nothing private
src/crewops/
  config.py             Runtime settings and resource names
  domain/               Typed records shared by every layer
  ingestion/            Seed loading, roster uploads (S3 + Lambda), live reports (SQS + Lambda)
  engine/               Legality engine: duty math, the seven rules, assessment, cost ranking,
                        blast radius, delay effects, joint plans
  analysis/             Disruption analysis, severity, its stream Lambda and the run command
  search/               Hybrid keyword + semantic search over S3 Vectors
  store/                DynamoDB key layout, item conversion, reads and writes
  tools/                The tools agents call: schemas, role checks, dispatch
  agent/                Question pipeline: router, planner, verifier, templates, model roles
  auth/                 Sign-in: the team, token checks, claims to caller, account sync
  plans/                Plans and approvals, with the four-eyes rules
  mcp/                  The MCP server for AgentCore, its package builder and a client
  notify/               Live events, email alerts, escalation, desktop alerts, who to tell
  alerts.py             Spoken alert briefs for the headset and the desk speaker
vr/                     The headset workspace (Immersive Web SDK, WebXR): see below
scripts/vr_sample.py    Writes the headset's sample operation from the real engine
web/                    Web console and app server (Next.js); serves the headset at /vr
infra/                  AWS CDK app: one stack per part of the system
tests/                  Unit tests
```

## Getting started

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run pytest
uv run ruff check .
```

## Deploying

Infrastructure is defined with the AWS CDK in Python and deployed to `ap-southeast-2`
(Sydney) by default. You need Node.js (22 or later recommended) and an AWS CLI profile for
the target account.

Every resource name starts with `crewopsvr-<stage>-` and every stack with
`CrewOpsVR-<stage>-`, so the project deploys beside anything else in the account without
touching it.

```bash
cp .env.example .env              # then set AWS_PROFILE
aws configure --profile crewops   # once: access keys stay in ~/.aws

scripts/cdk.sh bootstrap          # once per account and region
scripts/cdk.sh diff               # what would change
scripts/cdk.sh deploy --all       # create or update the stacks
scripts/cdk.sh destroy --all      # remove a dev stage completely
```

`scripts/cdk.sh` reads `.env`, refuses to run without a named profile, and prints the
target account before calling the CDK CLI. Settings are read from `.env` and the
environment; a value set in the shell wins over the file. Only `AWS_PROFILE` is required;
see [.env.example](.env.example) for the rest.

### Loading the operation

After the first deploy, load the operation into the table (about 5,000 items):

```bash
uv run python -m crewops.ingestion.load_seed --dry-run   # validate and count, no AWS calls
uv run python -m crewops.ingestion.load_seed             # validate, then write
```

The seed is one hand-built week (12 to 18 October 2026). The loader carries it forward to
31 December, past the judging period: the same flights each week, with the crew rotating
within their airline, rank and base. Every generated week is checked with the legality
engine, so the roster is legal before any disruption.

Then build the search indexes and analyse anything pending:

```bash
uv run python -m crewops.search.index
uv run python -m crewops.analysis.run --pending
```

### The demo team

Sign-in uses a Cognito user pool with one group per role. Nobody signs themselves up, and no
email or phone is stored. The team is defined in `data/team/demo_team.json`.

```bash
uv run python -m crewops.auth.provision            # what would change
uv run python -m crewops.auth.provision --apply    # asks for the accounts' password once
```

### The MCP server

AgentCore runs code packages on Linux ARM64 and does not install dependencies, so the
package is built first, then deployed:

```bash
uv run python -m crewops.mcp.package
scripts/cdk.sh deploy --all
uv run python -m crewops.mcp.client --as rohit.malhotra ask "Who covers C-1042 on 13 Oct?"
```

### The web console

```bash
uv run python -m crewops.web_env     # writes web/.env.local from the stack outputs
cd web && npm install && npm run dev # http://localhost:3000
```

## The headset workspace

`vr/` is an [Immersive Web SDK](https://iwsdk.dev) app: TypeScript, Three.js, an ECS, and
UIKitML spatial panels. It needs Node.js 22.12 or later (or 20.19+).

```bash
cd vr && npm install
npm run dev          # IWSDK dev server with the Meta Quest 3 emulator, at https://localhost:8081
npm run typecheck
npm run build        # builds into web/public/vr, served by the web app at /vr
```

The dev server runs the sample operation unless the page is opened with `?live`; with the
web app running on port 3000 (`npm run dev` in `web/`, signed in there first), `?live`
calls its tool routes through the dev server's proxy. On a Quest on the same network, open
one of the network URLs `npm run dev:status` prints.

| File | What it does |
|---|---|
| `src/desk.ts` | The controller's (or approver's) desk: the queue, the disruption, the seat, the verdict, submit and approve. Only this talks to the backend |
| `src/backend.ts` | Live tool calls through the web app, or the sample files |
| `src/map.ts` | The holotable: landmass, stations, the trip's legs, beacons, the aircraft, shockwaves |
| `src/cards.ts` | Crew cards, the tray, the seat hologram, and the drop-on-the-table check |
| `src/timeline.ts` | The duty timeline and limit gauges |
| `src/panels.ts`, `public/ui/*.uikitml` | The desk, seat and agent panels |
| `src/workspace.ts` | Places the desk in front of the seated user; recenter |
| `src/voice.ts`, `src/sound.ts` | Spoken replies, voice questions and sound cues |

The sample operation in `vr/public/sample/` is generated, never hand-written. After a
change to the engine or the seed:

```bash
uv run python scripts/vr_sample.py
```

## License

[MIT](LICENSE)
