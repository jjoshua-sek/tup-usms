# Training the risk model

The At-Risk page scores students with a logistic regression whose weights live in
`risk_model_versions`. The app only runs the model (`src/lib/risk/score.ts`); this folder
is where a version is trained, evaluated and turned into a migration.

| File | What it does |
|---|---|
| `generate_synthetic.py` | Makes `data/synthetic_students.csv`: 4,000 past students shaped like STARS records (TUPM-YY-NNNN numbers, program, college, year level, rating slips, discipline) with a known outcome. No names, no real person. |
| `features.py` | The app's `normalizeFeatures()`, ported line for line, so the weights mean the same thing in both. |
| `train.py` | Trains, evaluates on held-out students, and writes `output/` and `supabase/migrations/00053_risk_model_v2_synthetic.sql`. |
| `output/report.md` | The evaluation, with figures in `output/figures/`. |
| `output/normalization_cases.json` | Students that `src/lib/risk/normalize-parity.test.ts` normalizes and scores again in TypeScript; the test fails if the two languages disagree. |

## Run it

From `tup-usms/ml`, once:

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

Then (on macOS or Linux, `.venv/bin/python`):

```bash
.venv/Scripts/python.exe generate_synthetic.py
.venv/Scripts/python.exe train.py
cd .. && npx vitest run src/lib/risk
```

Both scripts use fixed seeds, so the same files come out every time.

## The data is synthetic

The OSA has no historical outcome records STARS may use yet. The synthetic students let the
training, evaluation and loading be built and checked end to end, but their outcomes follow
rules written into `generate_synthetic.py`. The model's figures therefore show that the
pipeline works; they are not evidence of how it will do on real TUP students.

To train on real records, give `train.py` a CSV with the same columns (the
`student_risk_features` view's, plus `at_risk_next_term`), change `VERSION` (say
`v3.0-osa-2025`), set `performance_metrics.status` to `trained_institutional`, and give the
migration the next free number.

## Using a new version

Run the generated migration in the Supabase SQL Editor (and `node lan/stars.mjs migrate` for
the offline copy). The version arrives switched off. The OSA head or the administrator compares
it with the one in use under **At-Risk Students → Model versions** and presses **Use this model**.
