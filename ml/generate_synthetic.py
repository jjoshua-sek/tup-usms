"""Synthetic past students for training the risk model.

The OSA has no historical outcome data STARS may use yet, so this script makes
a labelled stand-in shaped like STARS records: TUPM-YY-NNNN numbers that agree
with the year level, a program and college, the profile fields the model reads,
two terms of grades as rating slips give them, and disciplinary counts. No
names, no real person, and nothing here is ever imported into STARS.

The cohort is a past one so its outcome is known, as real historical records
would be:

    previous term  2nd Sem 2023-2024
    current term   1st Sem 2024-2025   (what the model sees)
    outcome term   2nd Sem 2024-2025   (what it predicts)

How the data is made. Each student gets hidden traits the model never sees:
academic ability, and whether a personal or family setback hits during the
current or the outcome term. Grades, failed units, scholastic status and
discipline are drawn from those traits with noise, and so is the outcome. The
model only sees the noisy records, never the traits, so it can't simply read
the answer back: how well it does measures how well the records predict, which
is the question real data would answer. The directions of the effects follow
the same retention-literature priors as the v1.0 baseline (weaker grades,
failed units, a decline, financial strain, probation and discipline raise
risk); their sizes are assumptions, written out below.

    python generate_synthetic.py            → data/synthetic_students.csv
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20241
N_STUDENTS = 4000

PREVIOUS_TERM = "2nd Sem 2023-2024"
CURRENT_TERM = "1st Sem 2024-2025"
OUTCOME_TERM = "2nd Sem 2024-2025"
SCHOOL_YEAR_START = 2024  # first-years of 2024-2025 are TUPM-24-NNNN

# An illustrative program mix (college code → programs). The model never reads
# the program; it is here so the records look like STARS records.
PROGRAMS = {
    "COS": ["BSIT", "BSCS", "BSIS", "BSES"],
    "COE": ["BSCE", "BSEE", "BSECE", "BSME"],
    "CIT": ["BET-ET", "BET-MT", "BET-CT"],
    "CAFA": ["BSA", "BFA"],
    "CIE": ["BTVTED"],
}
COLLEGE_SHARE = {"COS": 0.30, "COE": 0.30, "CIT": 0.18, "CAFA": 0.10, "CIE": 0.12}
YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"]
YEAR_SHARE = [0.30, 0.26, 0.23, 0.21]

# students.financial_support, as the profile form offers it.
SUPPORT = ["Parent/Guardian", "Scholarship", "Working Student", "Self-supporting", "Other"]
SUPPORT_SHARE = [0.70, 0.10, 0.09, 0.07, 0.04]

UNITS_PER_SUBJECT = 3


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def student_numbers(entry_years, rng):
    """TUPM-YY-NNNN, unique within each entry year."""
    numbers = []
    used = {}
    for year in entry_years:
        taken = used.setdefault(year, set())
        while True:
            seq = int(rng.integers(1, 10000))
            if seq not in taken:
                taken.add(seq)
                break
        numbers.append(f"TUPM-{year % 100:02d}-{seq:04d}")
    return numbers


def term(ability, strain, setback, rng, n):
    """One term's rating slip: (GWA, units enrolled, units failed)."""
    subjects = rng.choice([7, 8], size=n, p=[0.45, 0.55])
    # GWA of the subjects passed, on the 1.00 (best) to 3.00 (lowest pass) scale.
    passed_gwa = np.clip(2.15 - 0.42 * ability + 0.12 * strain + 0.35 * setback + rng.normal(0, 0.22, n), 1.0, 3.0)
    p_fail = sigmoid(-3.4 - 1.25 * ability + 0.35 * strain + 1.3 * setback + rng.normal(0, 0.3, n))
    failed = rng.binomial(subjects, p_fail)
    # A failed subject is a 5.00 and counts in the GWA.
    gwa = (passed_gwa * (subjects - failed) + 5.0 * failed) / subjects
    return np.round(gwa, 2), subjects * UNITS_PER_SUBJECT, failed * UNITS_PER_SUBJECT


def generate(n=N_STUDENTS, seed=SEED):
    rng = np.random.default_rng(seed)

    # ---- who they are --------------------------------------------------------
    college = rng.choice(list(COLLEGE_SHARE), size=n, p=list(COLLEGE_SHARE.values()))
    program = np.array([rng.choice(PROGRAMS[c]) for c in college])
    year_index = rng.choice(len(YEAR_LEVELS), size=n, p=YEAR_SHARE)
    # Irregular students entered a year or two before their year level says.
    delay = np.where(year_index == 0, 0, rng.choice([0, 1, 2], size=n, p=[0.90, 0.08, 0.02]))
    entry_year = SCHOOL_YEAR_START - year_index - delay

    support = rng.choice(SUPPORT, size=n, p=SUPPORT_SHARE)
    listahan = rng.random(n) < 0.14
    pwd = rng.random(n) < 0.02
    indigenous = rng.random(n) < 0.03
    strain = (listahan | np.isin(support, ["Working Student", "Self-supporting"])).astype(float)

    # ---- hidden traits (never written to the file) ------------------------------
    ability = rng.normal(0, 1, n) - 0.15 * delay
    setback_previous = (rng.random(n) < 0.08).astype(float)
    setback_current = (rng.random(n) < 0.10).astype(float)
    # A setback often carries on; a few new ones start in the outcome term.
    setback_outcome = np.where(setback_current == 1, rng.random(n) < 0.6, rng.random(n) < 0.05).astype(float)

    # ---- rating slips ------------------------------------------------------------
    prev_gwa, prev_units, prev_failed = term(ability, strain, setback_previous, rng, n)
    cur_gwa, cur_units, cur_failed = term(ability, strain, setback_current, rng, n)

    cur_gwa_true, prev_gwa_true = cur_gwa, prev_gwa
    first_year = year_index == 0
    prev_gwa = np.where(first_year, np.nan, prev_gwa)  # no earlier term at TUP

    # Scholastic status at the start of the current term, from the previous term.
    prev_ratio = np.where(first_year, 0, prev_failed / prev_units)
    status = np.where(prev_ratio >= 0.5, "Probationary", np.where(prev_ratio >= 0.25, "Warning", "Regular"))

    # About 8% never uploaded their latest rating slip: the app imputes those.
    no_slip = rng.random(n) < 0.08
    cur_gwa = np.where(no_slip, np.nan, cur_gwa)
    cur_units_shown = np.where(no_slip, np.nan, cur_units)
    cur_failed_shown = np.where(no_slip, np.nan, cur_failed)

    # ---- discipline ---------------------------------------------------------------
    struggling = np.maximum(0, -ability)
    minor = rng.poisson(0.12 + 0.15 * struggling + 0.25 * setback_current)
    major = rng.poisson(0.02 + 0.03 * struggling + 0.06 * setback_current)
    any_violation = (minor + major) > 0
    days_since = np.where(any_violation, rng.integers(5, 700, n), np.nan)
    recent = any_violation & (days_since <= 120)
    open_cases = np.where(recent, rng.binomial(minor + major, 0.6), 0)

    # ---- the outcome in 2nd Sem 2024-2025 -----------------------------------------
    # At risk = failed a quarter or more of their units, fell to warning,
    # probation or dismissal, or did not enrol again. Besides the hidden
    # traits, the records themselves carry risk, as the retention literature
    # finds: failing units now makes probation next term more likely, a
    # falling GWA marks a student on the way down, and a pending case weighs
    # on the student. (Built from the true values; the file shows the slip
    # as uploaded, or nothing.)
    true_ratio = cur_failed / cur_units
    trend_decline = np.where(first_year, 0, np.maximum(0, cur_gwa_true - prev_gwa_true))
    # Recent discipline says more than old discipline; it fades over about a
    # year, never below a fifth, as the app's disciplinary input assumes.
    fade = np.where(any_violation, np.maximum(0.2, np.exp(-np.nan_to_num(days_since) / 365)), 0)
    z = (
        -2.6
        - 1.00 * ability
        + 0.45 * strain
        + 1.20 * setback_outcome
        + 1.60 * true_ratio
        + 0.90 * trend_decline
        + fade * (1.10 * (major > 0) + 0.50 * np.minimum(minor, 3))
        + 0.45 * (open_cases > 0)
        + 0.60 * (status != "Regular")
        + 0.50 * np.maximum(0, cur_gwa_true - 2.75)  # a threshold, not a line
        + rng.normal(0, 0.5, n)
    )
    at_risk = rng.random(n) < sigmoid(z)
    detail = np.where(
        at_risk,
        rng.choice(["Failed 25% or more of units", "Fell to warning or probation", "Did not enrol"], size=n, p=[0.55, 0.30, 0.15]),
        "Continued in good standing",
    )

    df = pd.DataFrame({
        "student_number": student_numbers(entry_year, rng),
        "program": program,
        "college": college,
        "year_level": np.array(YEAR_LEVELS)[year_index],
        "scholastic_status": status,
        "financial_support": support,
        "is_listahan": listahan,
        "is_pwd": pwd,
        "is_indigenous": indigenous,
        "previous_term": np.where(first_year, "", PREVIOUS_TERM),
        "previous_gwa": prev_gwa,
        "current_term": CURRENT_TERM,
        "current_gwa": cur_gwa,
        "current_units_enrolled": cur_units_shown,
        "current_units_failed": cur_failed_shown,
        "current_attendance_rate": np.nan,  # the OSA has no attendance data
        "minor_violation_count": minor,
        "major_violation_count": major,
        "open_case_count": open_cases,
        "days_since_last_violation": days_since,
        "outcome_term": OUTCOME_TERM,
        "at_risk_next_term": at_risk.astype(int),
        "outcome_detail": detail,
    })
    # The same derived columns the student_risk_features view computes.
    df.insert(df.columns.get_loc("current_attendance_rate"), "gwa_delta", (df.current_gwa - df.previous_gwa).round(2))
    df.insert(df.columns.get_loc("gwa_delta"), "failure_ratio", (df.current_units_failed / df.current_units_enrolled).round(4))
    return df.sort_values("student_number").reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default=str(Path(__file__).parent / "data" / "synthetic_students.csv"))
    args = parser.parse_args()

    df = generate()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"wrote {args.out}: {len(df)} students, {df.at_risk_next_term.mean():.1%} at risk")


if __name__ == "__main__":
    main()
