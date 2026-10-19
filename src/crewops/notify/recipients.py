"""Who a disruption is waiting on, and what to tell them.

Shared by every alert that goes to a person rather than a channel (desktop alerts, and the
spoken alert in the headset):

* analysed (REPORTED -> OPTIONS_READY) or sent back (SUBMITTED -> OPTIONS_READY) goes to the
  controller of the assigned desk
* plan submitted (OPTIONS_READY -> SUBMITTED) goes to every approver

Planned leave is never urgent, so it reaches nobody this way.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from crewops.notify.changes import change_of


def desk_of(record: dict[str, Any]) -> str | None:
    from boto3.dynamodb.types import TypeDeserializer

    image = (record.get("dynamodb") or {}).get("NewImage") or {}
    analysis = image.get("analysis")
    if not analysis:
        return None
    value = TypeDeserializer().deserialize(analysis)
    return value.get("desk") if isinstance(value, dict) else None


def recipients(record: dict[str, Any], people: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The people (each with ``username``, ``roles``, ``desk`` and ``notifications``) this
    stream record should reach."""
    change = change_of(record)
    if change is None or change.report_type == "planned_leave":
        return []  # leave is re-crewed weeks ahead, nothing urgent
    allowed = [p for p in people if p.get("notifications") and p.get("username")]
    if change.after == "SUBMITTED":
        return [p for p in allowed if "approver" in (p.get("roles") or [])]
    if change.after == "OPTIONS_READY" and change.before in ("REPORTED", "SUBMITTED"):
        desk = desk_of(record)
        return [
            p
            for p in allowed
            if desk and "controller" in (p.get("roles") or []) and p.get("desk") == desk
        ]
    return []


def rated(record: dict[str, Any]) -> str | None:
    """Severity level (high/medium/low), or None if the record has no usable analysis."""
    from boto3.dynamodb.types import TypeDeserializer

    from crewops.analysis.severity import severity

    image = (record.get("dynamodb") or {}).get("NewImage") or {}
    try:
        analysis = TypeDeserializer().deserialize(image["analysis"])
        report = TypeDeserializer().deserialize(image["report"])
        today = datetime.now(UTC).date()
        return severity(analysis, str(report.get("reported_utc") or ""), today)["level"]
    except Exception:
        return None


def announcement(record: dict[str, Any]) -> str | None:
    """Spoken alert text. High/medium severity is said up front."""
    from boto3.dynamodb.types import TypeDeserializer

    from crewops.alerts import spoken
    from crewops.analysis.severity import spoken_level
    from crewops.domain import Report
    from crewops.tools.port import describe_report

    change = change_of(record)
    if change is None:
        return None
    image = (record.get("dynamodb") or {}).get("NewImage") or {}
    try:
        report = TypeDeserializer().deserialize(image["report"])
        what = describe_report(Report.from_dict(report))
    except Exception:
        what = f"{change.report_type.replace('_', ' ')}, {change.disruption_id}"
    if change.after == "SUBMITTED":
        text = f"CrewOps: a plan for {what} is waiting for your approval."
    elif change.before == "SUBMITTED":
        text = f"CrewOps: the plan for {what} was sent back to your desk."
    else:
        text = f"CrewOps: new on your desk. {what}. Open CrewOps to plan the cover."
    level = rated(record)
    if level in ("high", "medium") and change.after == "OPTIONS_READY":
        text = text.replace("CrewOps:", f"CrewOps, {spoken_level(level).lower()}:", 1)
    return spoken(text)


def current(people: list[dict[str, Any]], profile: Any) -> list[dict[str, Any]]:
    """Refresh roles and desk from the profile, since a stored subscription only has what
    they were when it was made. People who left the team are dropped."""
    out = []
    for person in people:
        found = profile(person.get("username") or "")
        if not found:
            continue
        out.append(person | {"roles": list(found.get("roles") or []), "desk": found.get("desk")})
    return out
