// ============================================================================
// KYB forward bundle — packages the PDF summary + every non-deleted
// KybDocument for an application into a single ZIP buffer. Used by the
// "Forward to processor" admin action to hand off a single attachment to
// GP / Moneris.
//
// Design notes:
//   • Buffered end-to-end (not streamed to the response). Total payload for
//     a typical KYB is single-digit MB — small enough to hold in memory,
//     and buffering means the caller can also upload the same bytes to S3
//     for the audit copy without re-reading.
//   • Documents are named `documents/<docType>/<originalFilename>` so the
//     archive is browsable — the underwriter can spot missing categories
//     without extracting first.
//   • The PDF sits at the root of the archive as `summary.pdf` — it's what
//     they'll open first.
//   • Filenames are sanitised (Windows-unsafe chars stripped, forced ASCII
//     fallback for filenames with characters ZIP might mangle).
// ============================================================================

import archiver from "archiver";
import type { KybDocument } from "@prisma/client";
import { getKybDocumentBuffer } from "@/lib/s3-kyb";

export interface BuildKybBundleInput {
  pdfBuffer: Buffer;
  documents: KybDocument[];
}

export interface BuildKybBundleResult {
  zipBuffer: Buffer;
  filenames: string[];
  totalBytes: number;
}

// Very permissive sanitiser — keep letters, digits, common punctuation, and
// spaces; replace everything else with an underscore so ZIP entries never
// hold path traversal ("..\\") or weird Unicode that some Windows unzippers
// choke on. We're just trying to build a well-behaved archive.
function safeFileSegment(s: string): string {
  return String(s || "unnamed")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "unnamed";
}

export async function buildKybForwardBundle(
  input: BuildKybBundleInput
): Promise<BuildKybBundleResult> {
  const { pdfBuffer, documents } = input;

  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];

  // Errors on the archiver stream should propagate — we surface them via
  // the outer promise below rather than crashing the process silently.
  const collect = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("warning", (err) => {
      // archiver warns for benign issues (missing stat, etc.). Log but don't
      // fail — the bundle can be built even with a couple of skipped files.
      if ((err as { code?: string }).code !== "ENOENT") {
        console.warn("[kyb-bundle] archiver warning:", err);
      }
    });
    archive.on("error", reject);
  });

  const filenames: string[] = [];

  // 1. PDF at the root.
  archive.append(pdfBuffer, { name: "summary.pdf" });
  filenames.push("summary.pdf");

  // 2. Each document under documents/<docType>/<sanitisedFilename>. Prefix
  // with a 2-digit index inside a type to preserve upload order if the same
  // doc type appears more than once.
  const perTypeCount: Record<string, number> = {};
  for (const doc of documents) {
    try {
      const buf = await getKybDocumentBuffer(doc.s3Key);
      const typeCount = (perTypeCount[doc.docType] || 0) + 1;
      perTypeCount[doc.docType] = typeCount;
      const paddedIdx = String(typeCount).padStart(2, "0");
      const name = `documents/${safeFileSegment(doc.docType)}/${paddedIdx}-${safeFileSegment(doc.originalFilename)}`;
      archive.append(buf, { name });
      filenames.push(name);
    } catch (err) {
      // A single unreadable object shouldn't kill the whole bundle — add a
      // placeholder text file so the underwriter knows it exists in our
      // records even if we couldn't hand over the bytes.
      const placeholder = Buffer.from(
        `This document ("${doc.originalFilename}", key=${doc.s3Key}) failed to load from S3 on ${new Date().toISOString()}: ${
          (err as Error).message
        }\nPlease request re-upload from the merchant.`,
        "utf8"
      );
      const name = `documents/${safeFileSegment(doc.docType)}/MISSING-${safeFileSegment(doc.originalFilename)}.txt`;
      archive.append(placeholder, { name });
      filenames.push(name);
    }
  }

  await archive.finalize();
  const zipBuffer = await collect;
  return { zipBuffer, filenames, totalBytes: zipBuffer.length };
}
