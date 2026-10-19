"""Write the headset's sample operation: what the real engine says about three sick calls.

    uv run python scripts/vr_sample.py            # writes vr/public/sample/

The headset can run on these files with ``?sample=1`` (a controller's desk) or
``?sample=1&as=approver`` (an approver's, with one plan submitted for approval), so it can be
tried (and judged) without signing in to a deployed stack.

Nothing here is written by hand: the seed week is loaded into an in-memory DynamoDB (moto),
the reports are analysed by the same runner the stream Lambda uses, and every file is what
the caller-scoped API returns to a controller on desk-2 or to an approver. Legality checks and
the answers to the suggested questions are precomputed, because in sample mode there is no
server to ask.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "vr" / "public" / "sample"
AT = datetime(2026, 10, 12, 18, 0, tzinfo=UTC)
"""The seed's own moment, so the sample is the same every time it is made."""

SICK_CALLS = (
    ("r-sample-1042", "C-1042", "2026-10-13", "2026-10-14"),  # KS captain, two-day trip
    ("r-sample-2295", "C-2295", "2026-10-13", None),  # DX first officer
    ("r-sample-1600", "C-1600", "2026-10-13", None),  # NG captain
)
DESK = "desk-2"
CANDIDATES_PER_SEAT = 6


def _fake_aws() -> None:
    """In-memory AWS only: never a real profile or account."""
    for key in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE"):
        os.environ.pop(key, None)
    os.environ.update(
        AWS_ACCESS_KEY_ID="testing",
        AWS_SECRET_ACCESS_KEY="testing",
        AWS_SESSION_TOKEN="testing",
        AWS_DEFAULT_REGION="ap-southeast-2",
    )


def _table(settings: Any) -> Any:
    import boto3

    from crewops.store import schema
    from crewops.store.ops_store import table_for

    def key(name: str, kind: str) -> dict[str, str]:
        return {"AttributeName": name, "KeyType": kind}

    def gsi(name: str, pk: str, sk: str) -> dict[str, Any]:
        return {
            "IndexName": name,
            "KeySchema": [key(pk, "HASH"), key(sk, "RANGE")],
            "Projection": {"ProjectionType": "ALL"},
        }

    attrs = [schema.PK, schema.SK, schema.GSI1_PK, schema.GSI1_SK, schema.GSI2_PK, schema.GSI2_SK]
    boto3.client("dynamodb", region_name=settings.aws_region).create_table(
        TableName=settings.table_name,
        BillingMode="PAY_PER_REQUEST",
        KeySchema=[key(schema.PK, "HASH"), key(schema.SK, "RANGE")],
        AttributeDefinitions=[{"AttributeName": a, "AttributeType": "S"} for a in attrs],
        GlobalSecondaryIndexes=[
            gsi(schema.GSI1, schema.GSI1_PK, schema.GSI1_SK),
            gsi(schema.GSI2, schema.GSI2_PK, schema.GSI2_SK),
        ],
    )
    return table_for(settings, boto3.Session(region_name=settings.aws_region))


def _report(report_id: str, crew_id: str, from_date: str, to_date: str | None) -> dict:
    details = {"crew_id": crew_id, "from_date": from_date, "reason": "sick"}
    if to_date:
        details["to_date"] = to_date
    return {
        "report_id": report_id,
        "type": "crew_unavailable",
        "reported_by": {"user_id": "u-sample", "roles": ["reporter"], "crew_id": None},
        "reported_utc": "2026-10-12T17:30:00Z",
        "details": details,
    }


def _put_on_desk(table: Any, disruption_id: str) -> None:
    table.update_item(
        Key={"pk": f"DISRUPTION#{disruption_id}", "sk": "META"},
        UpdateExpression="SET #a.#d = :desk",
        ExpressionAttributeNames={"#a": "analysis", "#d": "desk"},
        ExpressionAttributeValues={":desk": DESK},
    )


def _candidates(detail: dict[str, Any]) -> list[tuple[str, str]]:
    """(crew id, pairing id) for every crew card the headset may show."""
    out: list[tuple[str, str]] = []
    for seat in detail.get("seats") or []:
        live = seat.get("live") or {}
        options = live.get("options") or seat.get("options") or []
        picked = [o["crew_id"] for o in options if o.get("crew_id")][:CANDIDATES_PER_SEAT]
        picked += [e["crew_id"] for e in (live.get("excluded") or [])[:2]]
        out += [(crew_id, seat["pairing_id"]) for crew_id in picked]
    return list(dict.fromkeys(out))


def _questions(detail: dict[str, Any]) -> list[str]:
    """The three questions the headset offers for a disruption: who covers, why a
    candidate is out, and a duty-hours check on the recommended cover."""
    seat = (detail.get("seats") or [{}])[0]
    out = seat.get("crew_out") or (detail.get("details") or {}).get("crew_id")
    live = seat.get("live") or {}
    best = next((o["crew_id"] for o in seat.get("options") or [] if o.get("crew_id")), None)
    excluded = next((e["crew_id"] for e in live.get("excluded") or []), None)
    questions = [f"{out} is sick for {seat.get('pairing_id')}. Who covers?"]
    if excluded:
        questions.append(f"Is {excluded} legal for {seat.get('pairing_id')}?")
    if best:
        questions.append(f"How many duty hours does {best} have?")
    return questions


def main() -> int:
    _fake_aws()
    from moto import mock_aws

    from crewops.agent.pipeline import Pipeline
    from crewops.agent.service import example_questions
    from crewops.analysis.runner import Operation, analyse_by_id
    from crewops.config import Settings
    from crewops.domain import Report, Role
    from crewops.engine import build_world
    from crewops.ingestion.seed import load_seed
    from crewops.mcp.api import CrewOpsApi
    from crewops.store.ops_store import OpsStore
    from crewops.store.reports import store_report
    from crewops.tools import Caller, CrewOpsTools

    settings = Settings.from_env({"CREWOPS_STAGE": "sample", "AWS_REGION": "ap-southeast-2"})
    controller = Caller("rohit.malhotra", frozenset({Role.CONTROLLER}), desk=DESK)
    approver = Caller("meera.bhatt", frozenset({Role.APPROVER}))

    with mock_aws():
        table = _table(settings)
        seed = load_seed()
        OpsStore(table).put_seed(seed)
        for report_id, crew_id, from_date, to_date in SICK_CALLS:
            report = Report.from_dict(_report(report_id, crew_id, from_date, to_date))
            store_report(table, report, AT)
            outcome = analyse_by_id(table, report_id, Operation.load(table)).outcome
            if outcome != "stored":
                print(f"{report_id}: analysis {outcome}", file=sys.stderr)
                return 1
            _put_on_desk(table, report_id)

        class Offline:
            def __init__(self) -> None:
                self.pipeline = Pipeline.offline(
                    CrewOpsTools(build_world(seed), seed), example_questions()
                )

            def ask(self, question: str, caller: Caller, previous: Any = None) -> Any:
                return self.pipeline.answer(question, caller, previous), {"calls": 0}

        api = CrewOpsApi(table, Offline, lambda report: None)
        feed = api.disruptions(controller)
        details = {d["disruption_id"]: api.show(controller, d["disruption_id"]) for d in feed}
        legality = {
            f"{crew_id}/{pairing_id}": api.run_tool(
                controller, "check_legality", {"crew_id": crew_id, "pairing_id": pairing_id}
            )
            for detail in details.values()
            for crew_id, pairing_id in _candidates(detail)
        }
        answers = {
            disruption_id: [{"question": q} | api.ask(controller, q) for q in _questions(detail)]
            for disruption_id, detail in details.items()
        }

        # The approver's desk: the controller submits the recommendation for the first sick
        # call, and the approver sees it waiting, with the engine's verdict on the cover.
        submitted = api.submit(controller, SICK_CALLS[0][0], {}, "Reserve is closest.")
        approver_feed = api.disruptions(approver)
        approver_details = {
            d["disruption_id"]: api.show(approver, d["disruption_id"])
            for d in approver_feed
            if d["status"] == "SUBMITTED"
        }
        approver_legality = {
            f"{pick['crew_id']}/{pick['pairing_id']}": api.run_tool(
                approver,
                "check_legality",
                {"crew_id": pick["crew_id"], "pairing_id": pick["pairing_id"]},
            )
            for detail in approver_details.values()
            for plan in detail["plans"]
            if plan["status"] == "SUBMITTED"
            for pick in plan["picks"]
            if pick.get("crew_id")
        }
        approver_answers = {
            disruption_id: [{"question": q} | api.ask(approver, q) for q in _questions(detail)]
            for disruption_id, detail in approver_details.items()
        }
        files = {
            "approver/whoami.json": api.whoami(approver),
            "approver/disruptions.json": approver_feed,
            "approver/details.json": approver_details,
            "approver/legality.json": approver_legality,
            "approver/answers.json": approver_answers,
            "answers.json": answers,
            "whoami.json": api.whoami(controller),
            "disruptions.json": feed,
            "details.json": details,
            "legality.json": legality,
            "board.json": api.ops_board(controller),
        }

    for name, data in files.items():
        path = OUT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=1, default=str) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(files)} files to {OUT.relative_to(ROOT)}: {len(feed)} disruptions, "
        f"{len(legality)} legality checks, plan {submitted.get('plan_id')} for the approver."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
