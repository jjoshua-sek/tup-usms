"""Train, evaluate and package the STARS risk model.

    python train.py

Reads data/synthetic_students.csv (generate_synthetic.py) and writes:

    output/model.json                  coefficients, thresholds and metrics
    output/report.md                   the evaluation, for the thesis
    output/figures/*.png               ROC, precision-recall, calibration,
                                       weights, confusion matrix
    output/normalization_cases.json    rows the parity test scores in both
                                       languages
    ../supabase/migrations/00053_...   the model as a database row, inactive

Method
  - Inputs are normalized by features.normalize(), the port of the app's
    normalizeFeatures(), so the weights mean the same thing in the app.
  - 75% of students train the model, 25% are held back and used once, for
    the final figures. Nothing about the model is chosen by looking at them.
  - Logistic regression with L2 regularization and weights kept at zero or
    above (NonNegativeLogisticRegression below says why); its strength is
    picked by 5-fold cross-validation on the training students (ROC AUC).
    The report also shows the unconstrained weights.
  - The tier cut points are picked from out-of-fold predictions on the
    training students, so they are not tuned on the students they are
    reported on:
        moderate  the highest cut that still flags 80% of at-risk students
        high      the lowest cut where 60% of those flagged are at risk
        critical  the lowest cut where 80% of those flagged are at risk
  - v1.0-baseline is scored on the same held-out students for comparison.
"""

import json
import warnings
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.calibration import calibration_curve
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_val_score, train_test_split

from features import FEATURE_KEYS, TRAINED_KEYS, normalize

# scikit-learn 1.6 passes an option SciPy 1.18 no longer knows; harmless.
warnings.filterwarnings("ignore", message="Unknown solver options: iprint")

HERE = Path(__file__).parent
DATA = HERE / "data" / "synthetic_students.csv"
OUT = HERE / "output"
FIGURES = OUT / "figures"
MIGRATION = HERE.parent / "supabase" / "migrations" / "00053_risk_model_v2_synthetic.sql"

SEED = 20242
VERSION = "v2.0-synthetic"

# v1.0-baseline as seeded by migration 00011.
BASELINE = {
    "coefficients": {
        "gwa_risk": 2.80, "gwa_delta": 1.90, "failure_ratio": 2.40, "attendance_deficit": 2.10,
        "violation_severity": 1.60, "open_cases": 0.70, "financial_stress": 0.90, "probationary": 1.40,
    },
    "intercept": -3.20,
    "thresholds": {"moderate": 0.35, "high": 0.60, "critical": 0.80},
}

LABELS = {
    "gwa_risk": "Academic standing (GWA)",
    "gwa_delta": "Grade trend",
    "failure_ratio": "Failed units",
    "violation_severity": "Disciplinary history",
    "open_cases": "Open cases",
    "financial_stress": "Financial indicators",
    "probationary": "Scholastic status",
}

# Inputs are squeezed into 0–1 in different ways (one recent minor violation
# is only 0.09), so raw weights are not comparable. These are realistic
# changes, in normalized units, for reading the weights.
TYPICAL_CHANGES = {
    "gwa_risk": ("GWA 2.00 → 3.00", 1.0 / 4.0),
    "failure_ratio": ("Failing 1 of 8 subjects", 1 / 8),
    "violation_severity": ("One major violation this month", 3 / (3 + 10)),
    "open_cases": ("One open case", 1 / (1 + 3)),
    "probationary": ("On warning or probation", 1.0),
    "financial_stress": ("Financial strain indicator", 1.0),
    "gwa_delta": ("GWA 0.50 worse than last term", 0.5 / 2.0),
}


def typical_effects(coefs):
    return [
        {"key": k, "change": change, "input_change": round(step, 4), "odds_multiplier": round(float(np.exp(coefs[k] * step)), 2)}
        for k, (change, step) in TYPICAL_CHANGES.items()
    ]


MAROON = "#7A1E2C"
GREY = "#8C8C8C"


class NonNegativeLogisticRegression(ClassifierMixin, BaseEstimator):
    """Logistic regression whose weights may not go below zero.

    Every input is defined so that a higher value means more risk, and the
    app shows a negative contribution to staff as a protective factor. Inputs
    that overlap (an open case is always a recent violation; failed units are
    inside the GWA) can trade weight in an unconstrained fit and come out
    negative, which would tell an officer that a pending case or a falling
    GWA lowers risk. Constraining the signs is the usual remedy in scorecards.

    Same objective as scikit-learn's L2 LogisticRegression: log-loss summed
    over students plus ||w||² / (2C), intercept unpenalized.
    """

    def __init__(self, C=1.0):
        self.C = C

    def fit(self, X, y):
        X, y = np.asarray(X, dtype=float), np.asarray(y, dtype=float)
        n_features = X.shape[1]

        def loss(params):
            w, b = params[:-1], params[-1]
            z = X @ w + b
            # log(1 + e^z) - y·z, written to stay finite for large |z|
            value = np.sum(np.logaddexp(0, z) - y * z) + w @ w / (2 * self.C)
            residual = 1 / (1 + np.exp(-z)) - y
            grad = np.append(X.T @ residual + w / self.C, residual.sum())
            return value, grad

        start = np.zeros(n_features + 1)
        bounds = [(0, None)] * n_features + [(None, None)]
        result = minimize(loss, start, jac=True, method="L-BFGS-B", bounds=bounds)
        if not result.success:
            raise RuntimeError(f"fit did not converge: {result.message}")
        self.coef_ = result.x[:-1].reshape(1, -1)
        self.intercept_ = result.x[-1:]
        self.classes_ = np.array([0, 1])
        return self

    def decision_function(self, X):
        return np.asarray(X, dtype=float) @ self.coef_[0] + self.intercept_[0]

    def predict_proba(self, X):
        p = 1 / (1 + np.exp(-self.decision_function(X)))
        return np.column_stack([1 - p, p])

    def predict(self, X):
        return (self.decision_function(X) >= 0).astype(int)


def records(df):
    """pandas rows → plain dicts with None for blanks, as the view returns them."""
    clean = df.astype(object).where(df.notna(), None)
    return clean.to_dict("records")


def feature_matrix(df):
    rows = [normalize(r) for r in records(df)]
    return pd.DataFrame(rows)[FEATURE_KEYS]


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def baseline_scores(X):
    c = BASELINE["coefficients"]
    return sigmoid(BASELINE["intercept"] + sum(c[k] * X[k] for k in FEATURE_KEYS))


def pick_thresholds(y, p):
    """Tier cut points from out-of-fold predictions (see the module docstring)."""
    precision, recall, cuts = precision_recall_curve(y, p)
    precision, recall = precision[:-1], recall[:-1]  # align with cuts

    moderate = cuts[recall >= 0.80].max()
    high_ok = cuts[(precision >= 0.60) & (cuts > moderate)]
    high = high_ok.min() if len(high_ok) else np.quantile(p, 0.90)
    critical_ok = cuts[(precision >= 0.80) & (cuts > high)]
    critical = critical_ok.min() if len(critical_ok) else np.quantile(p, 0.97)

    # NUMERIC(4,3) in the database, strictly increasing.
    moderate, high, critical = (float(np.floor(v * 1000) / 1000) for v in (moderate, high, critical))
    assert moderate < high < critical, (moderate, high, critical)
    return {"moderate": moderate, "high": high, "critical": critical}


def at_cut(y, p, cut):
    flagged = (p >= cut).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, flagged, labels=[0, 1]).ravel()
    return {
        "threshold": round(float(cut), 3),
        "accuracy": round(accuracy_score(y, flagged), 4),
        "precision": round(precision_score(y, flagged, zero_division=0), 4),
        "recall": round(recall_score(y, flagged), 4),
        "f1": round(f1_score(y, flagged), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def tier_table(y, p, t):
    tiers = np.select([p >= t["critical"], p >= t["high"], p >= t["moderate"]], ["critical", "high", "moderate"], "low")
    rows = []
    for tier in ["critical", "high", "moderate", "low"]:
        mask = tiers == tier
        rows.append({
            "tier": tier,
            "students": int(mask.sum()),
            "share": round(float(mask.mean()), 4),
            "at_risk_rate": round(float(y[mask].mean()), 4) if mask.any() else None,
        })
    return rows


def ranking(y, p):
    return {
        "auc_roc": round(roc_auc_score(y, p), 4),
        "pr_auc": round(average_precision_score(y, p), 4),
        "brier": round(brier_score_loss(y, p), 4),
    }


# ---------------------------------------------------------------- figures

def save(fig, name):
    fig.tight_layout()
    fig.savefig(FIGURES / name, dpi=160)
    plt.close(fig)


def figures(y, p_new, p_old, coefs, matrix, thresholds):
    FIGURES.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(5, 4.4))
    for p, label, color in [(p_new, VERSION, MAROON), (p_old, "v1.0-baseline", GREY)]:
        fpr, tpr, _ = roc_curve(y, p)
        ax.plot(fpr, tpr, color=color, lw=2, label=f"{label} (AUC {roc_auc_score(y, p):.3f})")
    ax.plot([0, 1], [0, 1], ls=":", color="#BBBBBB", label="Chance")
    ax.set(xlabel="False positive rate", ylabel="True positive rate (recall)", title="ROC curve, held-out students")
    ax.legend(loc="lower right", fontsize=8)
    save(fig, "roc.png")

    fig, ax = plt.subplots(figsize=(5, 4.4))
    for p, label, color in [(p_new, VERSION, MAROON), (p_old, "v1.0-baseline", GREY)]:
        precision, recall, _ = precision_recall_curve(y, p)
        ax.plot(recall, precision, color=color, lw=2, label=f"{label} (AP {average_precision_score(y, p):.3f})")
    ax.axhline(y.mean(), ls=":", color="#BBBBBB", label=f"Base rate ({y.mean():.0%})")
    ax.set(xlabel="Recall", ylabel="Precision", title="Precision–recall, held-out students", ylim=(0, 1.02))
    ax.legend(loc="upper right", fontsize=8)
    save(fig, "precision_recall.png")

    fig, ax = plt.subplots(figsize=(5, 4.4))
    for p, label, color in [(p_new, VERSION, MAROON), (p_old, "v1.0-baseline", GREY)]:
        observed, predicted = calibration_curve(y, p, n_bins=10, strategy="quantile")
        ax.plot(predicted, observed, marker="o", ms=4, color=color, lw=1.6, label=label)
    ax.plot([0, 1], [0, 1], ls=":", color="#BBBBBB", label="Perfectly calibrated")
    ax.set(xlabel="Predicted risk", ylabel="Observed share at risk", title="Calibration (10 equal-size groups)")
    ax.legend(loc="upper left", fontsize=8)
    save(fig, "calibration.png")

    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    effects = typical_effects(coefs)
    effects.sort(key=lambda e: e["odds_multiplier"])
    ax.barh([e["change"] for e in effects], [e["odds_multiplier"] for e in effects], left=0, color=MAROON)
    ax.axvline(1, color="#444444", lw=0.8)
    for i, e in enumerate(effects):
        ax.text(e["odds_multiplier"] + 0.05, i, f"×{e['odds_multiplier']:.2f}", va="center", fontsize=8)
    ax.set(xlabel="Odds of being at risk are multiplied by", title=f"{VERSION}: effect of a typical change", xlim=(0, max(e["odds_multiplier"] for e in effects) * 1.18))
    save(fig, "effects.png")

    fig, ax = plt.subplots(figsize=(4.2, 3.8))
    cells = np.array([[matrix["tn"], matrix["fp"]], [matrix["fn"], matrix["tp"]]])
    ax.imshow(cells, cmap="Reds")
    for (i, j), value in np.ndenumerate(cells):
        ax.text(j, i, str(value), ha="center", va="center", fontsize=13, color="white" if value > cells.max() / 2 else "black")
    ax.set_xticks([0, 1], ["Not flagged", "Flagged"])
    ax.set_yticks([0, 1], ["Not at risk", "At risk"])
    ax.set(title=f"Flagged = moderate or above (≥ {thresholds['moderate']:.3f})")
    save(fig, "confusion_matrix.png")


# ---------------------------------------------------------------- outputs

def parity_cases(df, X, coefficients, intercept):
    """Rows covering every branch of normalize(), with their scores, for normalize-parity.test.ts."""
    picks = pd.concat([
        df[df.current_gwa.isna()].head(3),
        df[df.previous_gwa.isna()].head(3),
        df[df.major_violation_count > 0].head(4),
        df[df.open_case_count > 0].head(3),
        df[df.scholastic_status != "Regular"].head(4),
        df[df.financial_support.isin(["Working Student", "Self-supporting"])].head(3),
        df[df.is_listahan].head(2),
        df.sample(18, random_state=SEED),
    ]).drop_duplicates("student_number")
    cases = []
    for raw, (_, normalized) in zip(records(picks), X.loc[picks.index].iterrows()):
        inputs = {k: raw[k] for k in [
            "student_number", "scholastic_status", "current_gwa", "current_units_enrolled", "current_units_failed",
            "current_attendance_rate", "previous_gwa", "gwa_delta", "failure_ratio", "minor_violation_count",
            "major_violation_count", "open_case_count", "days_since_last_violation", "is_listahan", "is_pwd",
            "is_indigenous", "financial_support",
        ]}
        logit = intercept + sum(coefficients[k] * normalized[k] for k in FEATURE_KEYS)
        cases.append({
            "inputs": inputs,
            "normalized": {k: float(normalized[k]) for k in FEATURE_KEYS},
            "risk_score": float(sigmoid(logit)),
        })
    return cases


def sql_string(value):
    return "'" + value.replace("'", "''") + "'"


def write_migration(model):
    body = f"""-- ============================================================
-- 00053 — Risk model {VERSION}, trained on synthetic data (inactive)
-- ============================================================
-- Generated by ml/train.py on {model['training_date']}; do not edit by hand,
-- rerun the script. The evaluation is ml/output/report.md.
--
-- Logistic regression, weights kept at zero or above, trained on
-- {model['trained_on_records']} synthetic past students shaped like STARS records
-- (ml/generate_synthetic.py), not on TUP data: the
-- figures show the training and evaluation work, not how the model will do
-- on real students. It is added switched OFF. An administrator compares it
-- with the active model on the At-Risk page and switches it on there, which
-- calls activate_risk_model() below.
-- ============================================================

INSERT INTO public.risk_model_versions (
  version_label, algorithm, coefficients, intercept,
  threshold_moderate, threshold_high, threshold_critical,
  feature_scaling, training_notes, trained_on_records, training_date,
  performance_metrics, is_active
) VALUES (
  {sql_string(VERSION)},
  'logistic_regression',
  {sql_string(json.dumps(model['coefficients']))}::jsonb,
  {model['intercept']:.6f},
  {model['thresholds']['moderate']:.3f}, {model['thresholds']['high']:.3f}, {model['thresholds']['critical']:.3f},
  {sql_string(json.dumps(model['feature_scaling']))}::jsonb,
  {sql_string(model['training_notes'])},
  {model['trained_on_records']},
  DATE {sql_string(model['training_date'])},
  {sql_string(json.dumps(model['performance_metrics']))}::jsonb,
  FALSE
)
ON CONFLICT (version_label) DO NOTHING;

-- Switches the active model inside one transaction, so no one ever sees
-- none or two. Off first, then on: idx_model_single_active is checked row
-- by row, so a single UPDATE that flips both can fail depending on the
-- order it reaches the rows.
CREATE OR REPLACE FUNCTION public.activate_risk_model(p_version_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.risk_model_versions WHERE id = p_version_id) THEN
    RAISE EXCEPTION 'No risk model with id %', p_version_id;
  END IF;
  UPDATE public.risk_model_versions SET is_active = FALSE WHERE is_active AND id <> p_version_id;
  UPDATE public.risk_model_versions SET is_active = TRUE WHERE id = p_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_risk_model(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_risk_model(UUID) TO service_role;
"""
    MIGRATION.write_text(body, encoding="utf-8", newline="\n")


def pct(value):
    return f"{value * 100:.1f}%"


def write_report(model, test, baseline_test, tiers, y_test, cv):
    m = model["performance_metrics"]
    t = model["thresholds"]
    free = m["unconstrained"]["coefficients"]
    weights = "\n".join(
        f"| {LABELS[k]} | `{k}` | {model['coefficients'][k]:+.3f} | {free[k]:+.3f} | {BASELINE['coefficients'][k]:+.2f} |"
        for k in sorted(TRAINED_KEYS, key=lambda k: -abs(model["coefficients"][k]))
    )
    effect_rows = "\n".join(
        f"| {e['change']} | ×{e['odds_multiplier']:.2f} |"
        for e in sorted(typical_effects(model["coefficients"]), key=lambda e: -e["odds_multiplier"])
    )
    tier_rows = "\n".join(
        f"| {r['tier'].capitalize()} | {r['students']} | {pct(r['share'])} | {pct(r['at_risk_rate']) if r['at_risk_rate'] is not None else '—'} |"
        for r in tiers
    )
    cm, cmb = test["confusion_matrix"], baseline_test["confusion_matrix"]
    text = f"""# STARS risk model {VERSION}: training and evaluation

Generated by `ml/train.py` on {model['training_date']}. Rerun it to reproduce every number here.

> **Synthetic data.** The model was trained and tested on {m['dataset']['students']} synthetic past students
> made by `ml/generate_synthetic.py`, shaped like STARS records (TUPM-YY-NNNN numbers, programs,
> colleges, rating slips, disciplinary counts). These figures show that the training and evaluation
> pipeline works and how the model behaves; they do **not** say how it will do on real TUP students.
> Retraining on historical OSA records, with the same scripts, is what would.

## Data

| | |
|---|---|
| Students | {m['dataset']['students']} ({m['dataset']['train']} to train, {m['dataset']['test']} held out) |
| At risk in {m['dataset']['outcome_term']} | {pct(m['dataset']['prevalence'])} |
| Inputs taken from | {m['dataset']['previous_term']} and {m['dataset']['current_term']} |
| Missing latest rating slip (imputed, as the app does) | {pct(m['dataset']['missing_current_gwa'])} |
| First-years with no earlier term (grade trend imputed) | {pct(m['dataset']['missing_previous_gwa'])} |

"At risk" means that in the outcome term the student failed a quarter or more of their units,
fell to warning, probation or dismissal, or did not enrol again.

Attendance is not an input: the OSA has no attendance data, so the app always fills it with a
neutral value, and a weight for a constant would mean nothing. It ships with weight 0.

## Method

- Inputs are normalized by `ml/features.py`, a line-for-line port of `normalizeFeatures()` in
  `src/lib/risk/score.ts`; `normalize-parity.test.ts` checks the two agree on {m['parity_cases']} students.
- Logistic regression with L2 regularization, fitted with every weight kept at zero or above, and
  evaluated with scikit-learn {m['sklearn_version']}. Each input is defined so that a higher value means more risk,
  and the app shows a negative contribution to staff as a protective factor. Unconstrained, inputs that
  overlap (an open case is always a recent violation; failed units are inside the GWA) can trade
  weight and come out negative, which would tell an officer that a pending case lowers risk.
  Constraining the signs is the usual remedy in scorecards; the unconstrained weights are shown
  below for comparison (held-out AUC {m['unconstrained']['auc_roc']:.3f} unconstrained, {m['auc_roc']:.3f} constrained).
- Regularization strength chosen by 5-fold cross-validation on the training students: C = {m['regularization_C']:.4g}.
- Cross-validated ROC AUC on the training students: **{cv['mean']:.3f} ± {cv['sd']:.3f}**.
- Tier cut points chosen from out-of-fold predictions on the training students, never the held-out ones:
  moderate flags 80% of at-risk students; high and critical are the first cuts where 60% and 80% of
  those flagged are at risk.
- The held-out students were scored once, after everything above was fixed.

## Results on the {m['dataset']['test']} held-out students

| Measure | {VERSION} | v1.0-baseline |
|---|---|---|
| ROC AUC (ranking) | **{m['auc_roc']:.3f}** | {m['baseline']['auc_roc']:.3f} |
| Average precision (PR AUC) | **{m['pr_auc']:.3f}** | {m['baseline']['pr_auc']:.3f} |
| Brier score (lower is better) | **{m['brier']:.3f}** | {m['baseline']['brier']:.3f} |
| Flag cut point (moderate) | {t['moderate']:.3f} | {BASELINE['thresholds']['moderate']:.2f} |
| Accuracy at that cut | {test['accuracy']:.3f} | {baseline_test['accuracy']:.3f} |
| Precision (flagged who were at risk) | {test['precision']:.3f} | {baseline_test['precision']:.3f} |
| Recall (at-risk students flagged) | {test['recall']:.3f} | {baseline_test['recall']:.3f} |
| F1 | {test['f1']:.3f} | {baseline_test['f1']:.3f} |

Confusion matrix, flagged = moderate or above:

| | Not flagged | Flagged |
|---|---|---|
| Not at risk | {cm['tn']} | {cm['fp']} |
| At risk | {cm['fn']} | {cm['tp']} |

(v1.0-baseline at its own cut: TN {cmb['tn']}, FP {cmb['fp']}, FN {cmb['fn']}, TP {cmb['tp']}.)

### Tiers

Cut points: moderate {t['moderate']:.3f}, high {t['high']:.3f}, critical {t['critical']:.3f}.

| Tier | Students | Share | Actually at risk |
|---|---|---|---|
{tier_rows}

## Weights

Each weight is the change in log-odds when its input goes from 0 to 1 (inputs are normalized to 0–1).
Intercept {model['intercept']:+.3f} (v1.0-baseline {BASELINE['intercept']:+.2f}).

| Input | Key | {VERSION} | Unconstrained fit | v1.0-baseline |
|---|---|---|---|---|
{weights}
| Attendance | `attendance_deficit` | 0 (no data) | not trained | +2.10 |

A weight of exactly 0 means the constraint held it there: on this data that input added nothing the
others did not already carry.

The inputs are squeezed into 0–1 in different ways (one recent minor violation is only 0.09), so the
raw weights are not comparable with each other. Read them through a realistic change instead:

| Change | Odds of being at risk multiplied by |
|---|---|
{effect_rows}

## Figures

![ROC](figures/roc.png) ![Precision-recall](figures/precision_recall.png)
![Calibration](figures/calibration.png) ![Effect of a typical change](figures/effects.png)
![Confusion matrix](figures/confusion_matrix.png)

## Limits

- Synthetic data: the relationships were written into the generator, so the model is learning
  assumptions, not TUP's reality. Its figures are not evidence of real-world accuracy.
- Logistic regression assumes each input adds to the log-odds on its own. The generator includes a
  threshold effect (risk rises faster past a 2.75 GWA) that a linear model can only approximate.
- The model is added switched off. Switching it on changes every score on the At-Risk page.
"""
    (OUT / "report.md").write_text(text, encoding="utf-8")


def main():
    import sklearn

    df = pd.read_csv(DATA)
    X_all = feature_matrix(df)
    y_all = df.at_risk_next_term.to_numpy()

    train_idx, test_idx = train_test_split(df.index, test_size=0.25, stratify=y_all, random_state=SEED)
    X_train, X_test = X_all.loc[train_idx, TRAINED_KEYS], X_all.loc[test_idx, TRAINED_KEYS]
    y_train, y_test = y_all[train_idx], y_all[test_idx]

    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    search = {
        c: cross_val_score(NonNegativeLogisticRegression(C=c), X_train, y_train, cv=folds, scoring="roc_auc", error_score="raise").mean()
        for c in np.logspace(-3, 2, 16)
    }
    best_c = float(max(search, key=search.get))

    model = NonNegativeLogisticRegression(C=best_c)
    cv_auc = cross_val_score(model, X_train, y_train, cv=folds, scoring="roc_auc", error_score="raise")
    out_of_fold = cross_val_predict(model, X_train, y_train, cv=folds, method="predict_proba")[:, 1]
    thresholds = pick_thresholds(y_train, out_of_fold)
    model.fit(X_train, y_train)
    # For the report: what the same fit gives without the sign constraint.
    free = LogisticRegression(C=best_c, max_iter=5000).fit(X_train, y_train)
    unconstrained = {k: round(float(w), 4) for k, w in zip(TRAINED_KEYS, free.coef_[0])}
    unconstrained_auc = round(roc_auc_score(y_test, free.predict_proba(X_test)[:, 1]), 4)

    coefficients = {k: round(float(w), 4) for k, w in zip(TRAINED_KEYS, model.coef_[0])}
    coefficients["attendance_deficit"] = 0.0
    coefficients = {k: coefficients[k] for k in FEATURE_KEYS}
    intercept = round(float(model.intercept_[0]), 4)

    # Score the held-out students exactly as the app will: all eight inputs.
    p_test = sigmoid(intercept + sum(coefficients[k] * X_all.loc[test_idx, k] for k in FEATURE_KEYS)).to_numpy()
    p_base = baseline_scores(X_all.loc[test_idx]).to_numpy()

    test = at_cut(y_test, p_test, thresholds["moderate"])
    baseline_test = at_cut(y_test, p_base, BASELINE["thresholds"]["moderate"])
    tiers = tier_table(y_test, p_test, thresholds)
    cases = parity_cases(df, X_all, coefficients, intercept)

    performance = {
        "status": "trained_synthetic",
        "note": "Trained and evaluated on synthetic students shaped like STARS records, not TUP data. Shows the pipeline works; not evidence of real-world accuracy.",
        **ranking(y_test, p_test),
        **{k: test[k] for k in ["accuracy", "precision", "recall", "f1", "confusion_matrix"]},
        "threshold_basis": "moderate: highest cut with recall >= 0.80; high/critical: lowest cuts with precision >= 0.60/0.80; from out-of-fold training predictions",
        "cv_auc_mean": round(float(cv_auc.mean()), 4),
        "cv_auc_sd": round(float(cv_auc.std()), 4),
        "regularization_C": round(best_c, 6),
        "sign_constraint": "weights >= 0: every input is defined so a higher value means more risk",
        "unconstrained": {"coefficients": unconstrained, "auc_roc": unconstrained_auc},
        "tiers": tiers,
        "baseline": {**ranking(y_test, p_base), **{k: baseline_test[k] for k in ["accuracy", "precision", "recall", "f1"]}},
        "dataset": {
            "source": "ml/generate_synthetic.py",
            "students": int(len(df)),
            "train": int(len(train_idx)),
            "test": int(len(test_idx)),
            "prevalence": round(float(y_all.mean()), 4),
            "previous_term": "2nd Sem 2023-2024",
            "current_term": "1st Sem 2024-2025",
            "outcome_term": "2nd Sem 2024-2025",
            "missing_current_gwa": round(float(df.current_gwa.isna().mean()), 4),
            "missing_previous_gwa": round(float(df.previous_gwa.isna().mean()), 4),
        },
        "parity_cases": len(cases),
        "sklearn_version": sklearn.__version__,
    }

    record = {
        "version_label": VERSION,
        "algorithm": "logistic_regression",
        "coefficients": coefficients,
        "intercept": intercept,
        "thresholds": thresholds,
        "feature_scaling": {
            "gwa_risk": {"method": "minmax", "min": 1.0, "max": 5.0, "invert": False},
            "gwa_delta": {"method": "clamp", "min": -1.0, "max": 1.0},
            "failure_ratio": {"method": "identity", "min": 0, "max": 1},
            "attendance_deficit": {"method": "identity", "min": 0, "max": 1, "note": "not trained: no attendance data"},
            "violation_severity": {"method": "saturating", "scale": 10.0},
            "open_cases": {"method": "saturating", "scale": 3.0},
        },
        "training_notes": (
            f"Logistic regression (L2, C={best_c:.4g}, weights >= 0; evaluated with scikit-learn {sklearn.__version__}) trained on {len(train_idx)} synthetic "
            f"past students shaped like STARS records (ml/generate_synthetic.py) and tested on {len(test_idx)} held out. "
            "NOT trained on TUP data: the metrics show the pipeline works, not real-world accuracy. Attendance has weight 0 "
            "because the OSA has no attendance data. Retrain on historical OSA outcome data with ml/train.py before relying on it."
        ),
        "trained_on_records": int(len(train_idx)),
        "training_date": date.today().isoformat(),
        "performance_metrics": performance,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "model.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    (OUT / "normalization_cases.json").write_text(json.dumps(cases, indent=2), encoding="utf-8")
    figures(y_test, p_test, p_base, {k: coefficients[k] for k in TRAINED_KEYS}, test["confusion_matrix"], thresholds)
    write_report(record, test, baseline_test, tiers, y_test, {"mean": cv_auc.mean(), "sd": cv_auc.std()})
    write_migration(record)

    print(f"{VERSION}: test AUC {performance['auc_roc']} (baseline {performance['baseline']['auc_roc']}), "
          f"CV AUC {performance['cv_auc_mean']} ± {performance['cv_auc_sd']}, thresholds {thresholds}")
    print(f"at moderate: precision {test['precision']} recall {test['recall']} f1 {test['f1']}")
    print("weights", coefficients, "intercept", intercept)


if __name__ == "__main__":
    main()
