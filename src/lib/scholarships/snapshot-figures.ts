/**
 * Reading a student's academic figures across terms. Pure, so it can be
 * tested; build-profile.ts uses it.
 */

export type SnapshotFigures = {
  gwa: number | null;
  units_enrolled: number | null;
  units_failed: number | null;
  scholastic_status: string | null;
};

/**
 * Rows newest first; each figure from the newest row that has it. GWA and
 * units failed travel together (both come from the same rating slip), so a
 * term's failures are never paired with another term's GWA.
 */
export function latestOfEach(rows: SnapshotFigures[]): SnapshotFigures | undefined {
  if (rows.length === 0) return undefined;
  const graded = rows.find((row) => row.gwa != null);
  return {
    gwa: graded?.gwa ?? null,
    units_failed: graded ? graded.units_failed : (rows.find((row) => row.units_failed != null)?.units_failed ?? null),
    units_enrolled: rows.find((row) => row.units_enrolled != null)?.units_enrolled ?? null,
    scholastic_status: rows.find((row) => row.scholastic_status != null)?.scholastic_status ?? null,
  };
}
