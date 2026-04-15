import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Faculty Evaluation",
};

const LIKERT_SCALE = [
  { value: 5, label: "Strongly Agree" },
  { value: 4, label: "Agree" },
  { value: 3, label: "Neutral" },
  { value: 2, label: "Disagree" },
  { value: 1, label: "Strongly Disagree" },
] as const;

export default function EvaluationPage() {
  return (
    <div>
      <PageHeader
        title="Faculty Evaluation"
        description="Evaluate your instructors for the current semester. This is required before viewing grades."
      />

      {/* Evaluation Form Placeholder */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Select Instructor</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Choose an instructor from your enrolled subjects to begin the
            evaluation.
          </p>
          {/* TODO: Instructor selector dropdown from enrolled subjects */}
        </CardContent>
      </Card>

      {/* Likert Scale Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Evaluation Criteria</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Rate each criterion using the following scale:
          </p>
          <div className="flex flex-wrap gap-3">
            {LIKERT_SCALE.map(({ value, label }) => (
              <div
                key={value}
                className="rounded-md border px-3 py-1 text-xs text-muted-foreground"
              >
                {value} &mdash; {label}
              </div>
            ))}
          </div>
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              Evaluation questions and Likert scale radio buttons will be
              rendered here for each criterion.
            </p>
          </div>
          {/* TODO: Implement Likert scale form with evaluation questions */}
        </CardContent>
      </Card>
    </div>
  );
}
