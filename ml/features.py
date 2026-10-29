"""The risk model's inputs, normalized exactly as the app does it.

A line-for-line port of normalizeFeatures() in src/lib/risk/score.ts. A model
trained on differently scaled inputs than the app scores with is silently
wrong, so src/lib/risk/normalize-parity.test.ts runs both on the same rows
(ml/output/normalization_cases.json) and fails if they disagree.
"""

import math

# Same order as RISK_FEATURE_KEYS in src/lib/risk/types.ts.
FEATURE_KEYS = [
    "gwa_risk",
    "gwa_delta",
    "failure_ratio",
    "attendance_deficit",
    "violation_severity",
    "open_cases",
    "financial_stress",
    "probationary",
]

# The OSA has no attendance data (checklist E2), so the app always imputes
# attendance_deficit. A weight learned for a constant would be meaningless:
# the model is trained without it and ships a weight of 0.
TRAINED_KEYS = [key for key in FEATURE_KEYS if key != "attendance_deficit"]

# NEUTRAL in score.ts: a median student, used when a value is missing.
NEUTRAL = {
    "gwa_risk": 0.44,
    "gwa_delta": 0.5,
    "failure_ratio": 0.1,
    "attendance_deficit": 0.15,
    "violation_severity": 0.0,
    "open_cases": 0.0,
    "financial_stress": 0.0,
    "probationary": 0.0,
}


def _missing(value):
    return value is None or (isinstance(value, float) and math.isnan(value))


def _count(value):
    """`value ?? 0` in score.ts; pandas reads a missing count as NaN, which is truthy."""
    return 0 if _missing(value) else value


def _clamp(value, low, high):
    return min(high, max(low, value))


def _saturate(value, scale):
    return 0.0 if value <= 0 else value / (value + scale)


def normalize(raw):
    """One student's raw inputs (the student_risk_features columns) → {feature: 0–1}."""
    out = {}

    gwa = raw.get("current_gwa")
    out["gwa_risk"] = NEUTRAL["gwa_risk"] if _missing(gwa) else _clamp((gwa - 1.0) / 4.0, 0, 1)

    delta = raw.get("gwa_delta")
    out["gwa_delta"] = NEUTRAL["gwa_delta"] if _missing(delta) else _clamp((delta + 1.0) / 2.0, 0, 1)

    ratio = raw.get("failure_ratio")
    out["failure_ratio"] = NEUTRAL["failure_ratio"] if _missing(ratio) else _clamp(ratio, 0, 1)

    attendance = raw.get("current_attendance_rate")
    out["attendance_deficit"] = (
        NEUTRAL["attendance_deficit"] if _missing(attendance) else _clamp(1 - attendance, 0, 1)
    )

    minor = _count(raw.get("minor_violation_count"))
    major = _count(raw.get("major_violation_count"))
    severity = minor * 1 + major * 3
    recency = 1.0
    days = raw.get("days_since_last_violation")
    if not _missing(days) and severity > 0:
        recency = max(0.2, math.exp(-days / 365))
    out["violation_severity"] = _saturate(severity * recency, 10)

    out["open_cases"] = _saturate(_count(raw.get("open_case_count")), 3)

    support = raw.get("financial_support")
    listahan = raw.get("is_listahan")
    stressed = (not _missing(listahan) and bool(listahan)) or support in ("Self-supporting", "Working Student")
    out["financial_stress"] = 1.0 if stressed else 0.0

    status = raw.get("scholastic_status")
    status = "" if _missing(status) else str(status).lower()
    out["probationary"] = 1.0 if ("probation" in status or "warning" in status) else 0.0

    return out
