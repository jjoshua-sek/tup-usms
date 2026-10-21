import "server-only";

import { getDocumentProxy, getMeta } from "unpdf";

import { countPdfRevisions, isPdfBytes, type PdfFacts } from "./integrity";

/** What a PDF says about where it came from; null for a photo or an unreadable file. */
export async function readPdfFacts(bytes: Uint8Array): Promise<PdfFacts | null> {
  if (!isPdfBytes(bytes)) return null;
  try {
    // pdf.js takes ownership of the buffer it is given; hand it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { info } = await getMeta(pdf);
    const field = (name: string) => {
      const value = (info as Record<string, unknown>)[name];
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
    };
    return { creator: field("Creator"), producer: field("Producer"), revisions: countPdfRevisions(bytes) };
  } catch (error) {
    console.error("[pdf-facts] could not read PDF metadata", error);
    return { creator: null, producer: null, revisions: countPdfRevisions(bytes) };
  }
}
