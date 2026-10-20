import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES } from "@/lib/images/compress";
import { finalColumns, finalPolicies, migrationsInOrder, selectedColumns } from "@/lib/testing/migrations";

import {
  ATTACHMENT_LINK_COLUMNS,
  ATTACHMENT_LIST_COLUMNS,
  CONCERN_ATTACHMENT_BUCKET,
  CONCERN_ATTACHMENT_HINT,
  CONCERN_ATTACHMENT_TYPES,
  MAX_CONCERN_ATTACHMENT_BYTES,
  MAX_CONCERN_FILES,
  attachmentFileProblem,
  attachmentSetProblem,
} from "./attachments";

const MB = 1024 * 1024;
const columns = finalColumns("concern_attachments");

describe("every column the app reads or writes on concern_attachments exists", () => {
  it.each([
    ["concern pages", ATTACHMENT_LIST_COLUMNS],
    ["signed-link route", ATTACHMENT_LINK_COLUMNS],
    // attachConcernFiles inserts these.
    ["attach action", "concern_id, uploaded_by, file_path, file_name, mime_type, file_size"],
  ])("%s", (_name, select) => {
    const missing = selectedColumns(select).filter((column) => !columns.has(column));
    expect(missing, "used but not in the schema").toEqual([]);
  });

  it("keeps storage paths off the concern pages", () => {
    expect(selectedColumns(ATTACHMENT_LIST_COLUMNS)).not.toContain("file_path");
  });
});

describe("who can see and add concern attachments, as the migrations allow it", () => {
  const policies = [...finalPolicies("concern_attachments").values()];

  it("shows an attachment to whoever can see its concern", () => {
    const read = policies.find((policy) => policy.command === "SELECT");
    // Delegating to concerns' own RLS is the point: no second copy of the rules.
    expect(read?.using).toMatch(/FROM public\.concerns c WHERE c\.id = concern_id/);
  });

  it("lets nobody change or remove an attachment once it is on a concern", () => {
    expect(policies.map((policy) => policy.command).sort()).toEqual(["INSERT", "SELECT"]);
  });

  it("lets staff open the files, and students only their own folder", () => {
    const read = finalPolicies("storage.objects").get("own or staff reads concern files");
    expect(read?.using).toMatch(/bucket_id = 'concern-attachments'/);
    expect(read?.using).toMatch(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
    expect(read?.using).toMatch(/public\.is_staff\(\)/);
  });
});

describe("the SQL limits match the ones the form and action apply", () => {
  const sql = migrationsInOrder().join("\n");

  it("caps the bucket at the per-file upload limit and allows the same types", () => {
    const bucket = sql.match(
      new RegExp(`'${CONCERN_ATTACHMENT_BUCKET}',\\s*'${CONCERN_ATTACHMENT_BUCKET}',\\s*FALSE,\\s*(\\d+),\\s*ARRAY\\[([^\\]]*)\\]`),
    );
    expect(Number(bucket?.[1])).toBe(MAX_UPLOAD_BYTES);
    expect([...(bucket?.[2].matchAll(/'([^']+)'/g) ?? [])].map((m) => m[1]).sort()).toEqual(
      [...CONCERN_ATTACHMENT_TYPES].sort(),
    );
  });

  it("checks the same types and size on each row", () => {
    const table = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.concern_attachments"));
    const types = table.match(/mime_type IN \(([^)]*)\)/)?.[1] ?? "";
    expect([...types.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual([...CONCERN_ATTACHMENT_TYPES].sort());
    expect(Number(table.match(/file_size <= (\d+)/)?.[1])).toBe(MAX_UPLOAD_BYTES);
  });
});

describe("attachmentFileProblem", () => {
  it("accepts a shrunk photo and a PDF", () => {
    expect(attachmentFileProblem({ name: "cor.jpg", size: 1.4 * MB, type: "image/jpeg" })).toBeNull();
    expect(attachmentFileProblem({ name: "memo.pdf", size: 4.9 * MB, type: "application/pdf" })).toBeNull();
  });

  it("refuses anything over the 5 MB upload limit, saying how big it is", () => {
    expect(attachmentFileProblem({ name: "scan.pdf", size: 7.2 * MB, type: "application/pdf" })).toBe(
      "scan.pdf is 7.2 MB; each file can be at most 5 MB.",
    );
  });

  it("refuses types the bucket would refuse, and empty files", () => {
    expect(attachmentFileProblem({ name: "notes.docx", size: 1000, type: "application/msword" })).toMatch(/not a PDF/);
    expect(attachmentFileProblem({ name: "photo.webp", size: 1000, type: "image/webp" })).toMatch(/not a PDF/);
    expect(attachmentFileProblem({ name: "blank.pdf", size: 0, type: "application/pdf" })).toMatch(/empty/);
  });
});

describe("attachmentSetProblem", () => {
  const file = (size: number) => ({ name: "f.jpg", size, type: "image/jpeg" });

  it("allows up to the file count and total", () => {
    expect(attachmentSetProblem(Array.from({ length: MAX_CONCERN_FILES }, () => file(2 * MB)))).toBeNull();
  });

  it("refuses one file too many", () => {
    expect(attachmentSetProblem(Array.from({ length: MAX_CONCERN_FILES + 1 }, () => file(1000)))).toMatch(
      /at most 5 files/,
    );
  });

  it("refuses a set over the per-concern total", () => {
    expect(attachmentSetProblem([file(4.5 * MB), file(4.5 * MB), file(1.5 * MB)])).toBe(
      "These files come to 10.5 MB; the limit is 10 MB per concern.",
    );
    expect(MAX_CONCERN_ATTACHMENT_BYTES).toBe(10 * MB);
  });
});

it("tells students the limits the checks enforce", () => {
  expect(CONCERN_ATTACHMENT_HINT).toBe("PDF, JPG, PNG · up to 5 files, 5 MB each, 10 MB total");
});
