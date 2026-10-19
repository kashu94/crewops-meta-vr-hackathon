# CrewOps VR

A hands-first crew control workspace for Meta Quest, built for the Productivity track of the
Meta VR Start Developer Competition 2026.

A captain calls in sick at 01:30. Today a crew controller digs through rosters, duty-hour
sheets and certification records on flat screens to find a legal replacement. In CrewOps VR
the disruption lands on the controller's real desk, in passthrough, as a 3D network map. The
flights it puts at risk light up. The controller picks up a reserve pilot's card, holds it
over the open seat, and sees straight away whether that pilot is legal and what it costs.
Then they submit the plan for a second person to approve.

> The model selects, sequences and narrates. It never calculates.

Every crew id, duty hour and rupee shown in the headset comes from a deterministic legality
engine, never from a model's own arithmetic. A verifier checks the agent's wording against
the tool results before anything is spoken.

## The experience

| In the headset | How it works |
|---|---|
| Tabletop network map | A route map anchored to your real desk (passthrough). Flights are arcs between stations; disrupted ones glow by severity |
| Blast radius | A sick call or delay ripples across the downstream flights it puts at risk |
| Pinch-and-hold crew cards | Hold a reserve's card over an open seat: the engine checks legality live (green or red, with duty-limit margins) |
| Palm-up voice | Turn a palm up to ask the CrewOps Agent; the answer is spoken and the cited crew cards come out of the map |
| Four-eyes approval | The controller submits; a different approver confirms before the roster changes |
| Pinned ops board | Severity tiles pinned to your wall with a spatial anchor |

Everything is usable with hands alone, seated. One session handles one disruption, from
alert to committed plan, in about ten minutes.

The headset client (`vr/`, on the Immersive Web SDK) is in progress. The services it runs
on, and the web console that gives the approver and the rest of the team their own view, are
in this repository.

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
  Meta Quest (WebXR, IWSDK)        Web console (Next.js)        Any MCP host
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
web/                    Web console and app server (Next.js)
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

## License

[MIT](LICENSE)
