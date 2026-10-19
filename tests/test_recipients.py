"""Who a disruption waits on, and the spoken alert they get."""

from crewops.notify.recipients import current, recipients


def stream_record(before, after, desk):
    analysis = {"M": {"desk": {"S": desk}}} if desk else None
    new = {
        "entity": {"S": "disruption"},
        "status": {"S": after},
        "disruption_id": {"S": "r-sick1042"},
        "report": {"M": {"type": {"S": "crew_unavailable"}}},
        **({"analysis": analysis} if analysis else {}),
    }
    return {
        "eventName": "MODIFY",
        "dynamodb": {"NewImage": new, "OldImage": {"status": {"S": before}}, "SequenceNumber": "1"},
    }


def person(username, role, desk, notifications=True):
    return {"username": username, "roles": [role], "desk": desk, "notifications": notifications}


PEOPLE = [
    person("rohit.malhotra", "controller", "desk-2"),
    person("ananya.iyer", "controller", "desk-1"),
    person("meera.bhatt", "approver", None),
    person("karan.mehta", "approver", None, notifications=False),
]


def who(record):
    return sorted(p["username"] for p in recipients(record, PEOPLE))


def test_only_the_desk_or_the_approvers_hear_about_a_disruption():
    assert who(stream_record("REPORTED", "OPTIONS_READY", "desk-2")) == ["rohit.malhotra"]
    assert who(stream_record("SUBMITTED", "OPTIONS_READY", "desk-2")) == ["rohit.malhotra"]
    assert who(stream_record("OPTIONS_READY", "SUBMITTED", "desk-2")) == ["meera.bhatt"]
    assert who(stream_record("SUBMITTED", "COMMITTED", "desk-2")) == []
    assert who(stream_record("REPORTED", "OPTIONS_READY", None)) == []


def test_roles_and_desk_come_from_the_current_profile_and_leavers_are_dropped():
    profiles = {"rohit.malhotra": {"roles": ["controller"], "desk": "desk-1"}}
    found = current(PEOPLE[:2], profiles.get)
    assert found == [PEOPLE[0] | {"desk": "desk-1"}]
