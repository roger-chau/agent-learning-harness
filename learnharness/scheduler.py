"""Spaced review scheduling (a small SM-2 variant).

Each concept carries a review record: ease, interval (days), repetitions, due date.
A review is graded 0-5. Grades below 3 reset the interval; 3+ grow it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

MIN_EASE = 1.3


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_review() -> dict:
    return {"ease": 2.5, "interval": 0.0, "reps": 0, "due": None, "last": None}


def schedule(review: dict, grade: int, at: datetime | None = None) -> dict:
    """Return an updated review record after a graded recall (grade 0-5)."""
    at = at or now()
    grade = max(0, min(5, int(grade)))
    r = dict(review or new_review())

    if grade < 3:
        r["reps"] = 0
        r["interval"] = 0.0 if grade <= 1 else 0.5  # see it again today / tomorrow-ish
    else:
        r["reps"] = r.get("reps", 0) + 1
        if r["reps"] == 1:
            r["interval"] = 1.0
        elif r["reps"] == 2:
            r["interval"] = 3.0
        else:
            r["interval"] = round(r.get("interval", 1.0) * r.get("ease", 2.5), 2)

    ease = r.get("ease", 2.5) + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    r["ease"] = round(max(MIN_EASE, ease), 3)
    # Interval 0 means "later in this session": due in 10 minutes.
    delta = timedelta(days=r["interval"]) if r["interval"] > 0 else timedelta(minutes=10)
    r["due"] = (at + delta).isoformat()
    r["last"] = at.isoformat()
    return r


def is_due(review: dict | None, at: datetime | None = None) -> bool:
    if not review or not review.get("due"):
        return False
    return datetime.fromisoformat(review["due"]) <= (at or now())
