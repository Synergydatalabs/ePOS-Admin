// ============================================================================
// KYB summary PDF — a single, printable one-file digest of an application
// suitable for emailing to a processor's onboarding team. The document is
// intentionally text-heavy (no external fonts, no images, no logos) so
// pdfkit can render it in-process on any Node runtime without needing to
// bundle a font subset or a headless browser.
//
// The output is *not* a substitute for the raw KYB documents — those are
// still shipped in the accompanying ZIP. This PDF is a human-readable
// index for the processor's underwriter so they can skim before they open
// the individual files.
//
// Layout:
//   ── Header (brand, application id, submitted date, current status)
//   ── Business information block
//   ── Volume + processor preference
//   ── Signer / consent
//   ── Sensitive KYB (tax id + bank info — DECRYPTED, since this PDF is
//                     already the sensitive material we're handing over)
//   ── UBO cards, one per person (decrypted ID number included)
//   ── Timeline footer with recent state changes
// ============================================================================

import PDFDocument from "pdfkit";
import type { MerchantApplication, UboRecord, ApplicationEvent } from "@prisma/client";
import { kybDecrypt } from "@/lib/kyb-crypto";

export interface KybSummaryInput {
  application: MerchantApplication & {
    tenant?: { name: string; slug: string } | null;
  };
  ubos: UboRecord[];
  events?: ApplicationEvent[];
}

// Small helpers for a consistent typographic scale. pdfkit measures in
// points (72 per inch) — the numbers below give roughly:
//   h1 = 18pt (page title), h2 = 13pt (section), body = 10pt, tiny = 8pt.
const H1 = 18;
const H2 = 13;
const BODY = 10;
const TINY = 8;

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMoneyCents(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  return `${currency} ${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Concatenate the pdfkit document into a Buffer. pdfkit doesn't expose a
// "finalize into Buffer" call directly, so we listen on the stream events.
async function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * Build the PDF summary buffer. Never throws for a decrypt failure — a
 * partially-decrypted field is rendered as "(decrypt failed)" so the
 * underwriter can still see everything else and flag the issue back to us.
 */
export async function buildKybSummaryPdf(input: KybSummaryInput): Promise<Buffer> {
  const { application, ubos, events } = input;
  const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true });

  // ---------------- Header ----------------
  doc.font("Helvetica-Bold").fontSize(H1).fillColor("#111827").text("Oreugo — KYB Summary");
  doc
    .moveDown(0.2)
    .font("Helvetica").fontSize(TINY).fillColor("#6b7280")
    .text(
      `Application ID: ${application.id}    ·    Status: ${application.status}    ·    Submitted: ${fmtDateTime(application.submittedAt)}`
    );
  if (application.tenant) {
    doc.text(`Tenant: ${application.tenant.name} (${application.tenant.slug})`);
  }
  doc.moveDown(0.7);
  drawDivider(doc);

  // ---------------- Business info ----------------
  sectionHeading(doc, "Business Information");
  const addr = (application.businessAddress as Record<string, string> | null) || {};
  labeledRow(doc, "Legal name", application.legalName);
  if (application.dbaName) labeledRow(doc, "DBA", application.dbaName);
  if (application.businessTypeName) labeledRow(doc, "Entity type", application.businessTypeName);
  if (application.incorporationDate) labeledRow(doc, "Incorporated", fmtDate(application.incorporationDate));
  if (application.incorporationRegion) labeledRow(doc, "Region", application.incorporationRegion);
  if (application.mccCode) labeledRow(doc, "MCC", application.mccCode);
  if (application.websiteUrl) labeledRow(doc, "Website", application.websiteUrl);
  const addressLine = [
    addr.line1,
    addr.line2,
    [addr.city, addr.region || addr.province, addr.postalCode].filter(Boolean).join(", "),
    addr.country,
  ]
    .filter(Boolean)
    .join(" · ");
  if (addressLine) labeledRow(doc, "Address", addressLine);

  // ---------------- Financials ----------------
  sectionHeading(doc, "Volume & Processor Preference");
  labeledRow(
    doc,
    "Projected monthly volume",
    fmtMoneyCents(application.projectedMonthlyVolumeCents, application.currency)
  );
  labeledRow(doc, "Average ticket", fmtMoneyCents(application.averageTicketCents, application.currency));
  labeledRow(doc, "Preferred processor", application.targetProcessor || "None specified");

  // ---------------- Signer ----------------
  sectionHeading(doc, "Signer");
  if (application.signerName) labeledRow(doc, "Name", application.signerName);
  if (application.signerTitle) labeledRow(doc, "Title", application.signerTitle);
  if (application.signerEmail) labeledRow(doc, "Email", application.signerEmail);
  if (application.signerConsentedAt) labeledRow(doc, "Consented", fmtDateTime(application.signerConsentedAt));

  // ---------------- Sensitive KYB — decrypted for the processor ----------------
  sectionHeading(doc, "KYB Sensitive Fields (decrypted)");
  let taxIdPlain: string | null = null;
  let bankPlain: string | null = null;
  try {
    taxIdPlain = kybDecrypt(application.taxIdEnc);
  } catch {
    taxIdPlain = "(decrypt failed)";
  }
  try {
    bankPlain = kybDecrypt(application.bankInfoEnc);
  } catch {
    bankPlain = "(decrypt failed)";
  }
  labeledRow(doc, "Tax ID", taxIdPlain || "—");
  if (bankPlain) {
    try {
      const bank = JSON.parse(bankPlain) as {
        accountHolderName?: string;
        bankName?: string;
        routingNumber?: string;
        accountNumber?: string;
      };
      if (bank.accountHolderName) labeledRow(doc, "Account holder", bank.accountHolderName);
      if (bank.bankName) labeledRow(doc, "Bank", bank.bankName);
      if (bank.routingNumber) labeledRow(doc, "Routing #", bank.routingNumber);
      if (bank.accountNumber) labeledRow(doc, "Account #", bank.accountNumber);
    } catch {
      labeledRow(doc, "Bank info", bankPlain);
    }
  }

  // ---------------- UBOs ----------------
  sectionHeading(doc, `Ultimate Beneficial Owners (${ubos.length})`);
  if (ubos.length === 0) {
    doc.font("Helvetica").fontSize(BODY).fillColor("#6b7280").text("No UBOs on file.");
  } else {
    ubos.forEach((u, i) => uboCard(doc, u, i + 1));
  }

  // ---------------- Timeline footer ----------------
  if (events && events.length > 0) {
    sectionHeading(doc, "Recent Timeline");
    const recent = events.slice(0, 8);
    doc.font("Helvetica").fontSize(TINY).fillColor("#374151");
    recent.forEach((ev) => {
      const line = `${fmtDateTime(ev.at)}  ·  ${ev.actorType}${ev.actorId ? ` (${ev.actorId})` : ""}  ·  ${
        ev.fromStatus ? `${ev.fromStatus} → ` : ""
      }${ev.toStatus}${ev.note ? `  — ${ev.note}` : ""}`;
      doc.text(line, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
    });
  }

  // Page numbers in the footer.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(TINY).fillColor("#9ca3af").text(
      `Page ${i + 1} of ${range.count}   ·   Generated ${new Date().toISOString()}`,
      doc.page.margins.left,
      doc.page.height - 34,
      { align: "center", width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
    );
  }

  return toBuffer(doc);
}

// ---------------- Layout helpers ----------------

function drawDivider(doc: PDFKit.PDFDocument) {
  doc
    .save()
    .strokeColor("#e5e7eb")
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke()
    .restore();
  doc.moveDown(0.5);
}

function sectionHeading(doc: PDFKit.PDFDocument, label: string) {
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(H2).fillColor("#111827").text(label);
  doc.moveDown(0.2);
  drawDivider(doc);
}

function labeledRow(doc: PDFKit.PDFDocument, label: string, value: string) {
  const startY = doc.y;
  const labelWidth = 150;
  doc
    .font("Helvetica").fontSize(BODY).fillColor("#6b7280")
    .text(label, doc.page.margins.left, startY, { width: labelWidth, continued: false });
  doc
    .font("Helvetica-Bold").fontSize(BODY).fillColor("#111827")
    .text(value, doc.page.margins.left + labelWidth + 8, startY, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right - labelWidth - 8,
    });
  doc.moveDown(0.15);
}

function uboCard(doc: PDFKit.PDFDocument, u: UboRecord, idx: number) {
  // If a card would spill onto the next page mid-render, force a break.
  if (doc.y > doc.page.height - 180) doc.addPage();

  doc.moveDown(0.4);
  const cardTop = doc.y;
  const cardLeft = doc.page.margins.left;
  const cardWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // Card outline
  doc.save().roundedRect(cardLeft, cardTop, cardWidth, 100, 6).strokeColor("#e5e7eb").lineWidth(0.5).stroke().restore();

  doc
    .font("Helvetica-Bold").fontSize(BODY + 1).fillColor("#111827")
    .text(`${idx}. ${u.fullName}`, cardLeft + 10, cardTop + 8);

  const chips: string[] = [];
  if (u.isDirector) chips.push("Director");
  if (u.isSignatory) chips.push("Signatory");
  if (u.isPep) chips.push("PEP");
  doc
    .font("Helvetica").fontSize(TINY).fillColor("#6b7280")
    .text(
      `${Number(u.ownershipPct).toFixed(2)}%  ·  ${u.nationality}  ·  DOB ${fmtDate(u.dateOfBirth)}${
        chips.length ? "  ·  " + chips.join(", ") : ""
      }`,
      cardLeft + 10,
      cardTop + 24
    );

  let idPlain = "(decrypt failed)";
  try {
    idPlain = kybDecrypt(u.idNumberEnc) || "—";
  } catch {
    /* left as "(decrypt failed)" */
  }
  const addr = (u.residentialAddress as Record<string, string> | null) || {};
  const addrText = [
    addr.line1,
    [addr.city, addr.province || addr.region, addr.postalCode].filter(Boolean).join(", "),
    addr.country,
  ]
    .filter(Boolean)
    .join(" · ");

  doc
    .font("Helvetica").fontSize(TINY).fillColor("#374151")
    .text(
      `ID: ${u.idType}  ${idPlain}${u.idIssuingCountry ? `  · issued ${u.idIssuingCountry}` : ""}${
        u.idExpiry ? `  · exp ${fmtDate(u.idExpiry)}` : ""
      }`,
      cardLeft + 10,
      cardTop + 42
    );

  if (addrText) {
    doc.text(`Address: ${addrText}`, cardLeft + 10, cardTop + 58, { width: cardWidth - 20 });
  }
  if (u.sourceOfFunds) {
    doc.text(`Source of funds: ${u.sourceOfFunds}`, cardLeft + 10, cardTop + 76, { width: cardWidth - 20 });
  }

  // Move y past the card so the next thing lands below.
  doc.y = cardTop + 110;
}
