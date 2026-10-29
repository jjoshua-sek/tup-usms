/**
 * Model versions as the At-Risk page lists them. Pure, so the wording and
 * the permission are tested without a database.
 */

/** Matches "admin manages models" (migration 00013). */
export function canChooseRiskModel(role: string | null | undefined): boolean {
  return role === "osa_head" || role === "admin";
}

export interface RiskModelVersionRow {
  id: string;
  version_label: string;
  is_active: boolean;
  trained_on_records: number | null;
  training_date: string | null;
  performance_metrics: Record<string, unknown> | null;
}

export interface RiskModelVersionSummary {
  id: string;
  label: string;
  active: boolean;
  /** Where the weights came from, in words staff understand. */
  source: string;
  /** The same, to finish "the model in use takes its weights from …". */
  sourceInSentence: string;
  trainedOn: number | null;
  trainedAt: string | null;
  /** Held-out figures; null for a version never evaluated. */
  auc: number | null;
  precision: number | null;
  recall: number | null;
  /** Shown beside the figures so no one reads them as more than they are. */
  caveat: string | null;
}

const SOURCES: Record<string, { source: string; sourceInSentence: string; caveat: string | null }> = {
  untrained_baseline: {
    source: "Published research (not trained)",
    sourceInSentence: "published retention research, not from TUP outcome data",
    caveat: "Never evaluated against outcomes.",
  },
  trained_synthetic: {
    source: "Synthetic students shaped like STARS records",
    sourceInSentence: "synthetic students shaped like STARS records, not from TUP outcome data",
    caveat: "Figures come from synthetic data, not TUP students.",
  },
  trained_institutional: {
    source: "Historical OSA records",
    sourceInSentence: "the OSA's own past records",
    caveat: null,
  },
};

function figure(metrics: Record<string, unknown> | null, key: string): number | null {
  const value = metrics?.[key];
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export function summarizeModelVersion(row: RiskModelVersionRow): RiskModelVersionSummary {
  const status = typeof row.performance_metrics?.status === "string" ? row.performance_metrics.status : "";
  const known = SOURCES[status] ?? { source: "Not recorded", sourceInSentence: "a source not recorded", caveat: null };
  return {
    id: row.id,
    label: row.version_label,
    active: row.is_active,
    source: known.source,
    sourceInSentence: known.sourceInSentence,
    trainedOn: row.trained_on_records && row.trained_on_records > 0 ? row.trained_on_records : null,
    trainedAt: row.training_date,
    auc: figure(row.performance_metrics, "auc_roc"),
    precision: figure(row.performance_metrics, "precision"),
    recall: figure(row.performance_metrics, "recall"),
    caveat: known.caveat,
  };
}
