// Backfill ubo_records rows from the legacy beneficial_owners_enc JSON blob
// on merchant_applications. Idempotent — skips any application that already
// has UBO rows, and blanks the legacy blob only AFTER successfully inserting
// the new rows.
//
// Run once, after the SQL migration has landed AND after code that reads
// UboRecord is deployed. Safe to re-run: idempotency check prevents duplicate
// UBO insertion.
//
//   npx tsx scripts/backfill-ubos.ts
//   npx tsx scripts/backfill-ubos.ts --dry-run
//
// Requires KYB_ENCRYPTION_KEY + DATABASE_URL env vars to be set — same as
// the runtime. Reads via a raw SELECT (Prisma no longer surfaces the column
// after the schema rename) and blanks the column via a raw UPDATE.

import { PrismaClient } from "@prisma/client";
import { kybDecryptJson, kybEncrypt } from "../src/lib/kyb-crypto";

interface LegacyOwner {
  name?: string;
  dob?: string | null;
  idNumber?: string | null;
  address?: string | null;
  ownershipPct?: number | null;
}

interface Row {
  id: string;
  beneficial_owners_enc: string | null;
  existing_ubo_count: bigint;
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const prisma = new PrismaClient();
  try {
    // Pull every application row with a non-null legacy blob AND that
    // doesn't already have UBO rows. We do this via raw SQL because the
    // beneficial_owners_enc column is intentionally not part of the Prisma
    // model any more.
    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        a.id::text AS id,
        a.beneficial_owners_enc,
        (SELECT COUNT(*) FROM ubo_records u WHERE u.application_id = a.id) AS existing_ubo_count
      FROM merchant_applications a
      WHERE a.beneficial_owners_enc IS NOT NULL
    `);

    let inserted = 0;
    let skippedAlreadyMigrated = 0;
    let skippedEmpty = 0;
    let skippedDecryptError = 0;
    let blanked = 0;

    for (const r of rows) {
      if (Number(r.existing_ubo_count) > 0) {
        skippedAlreadyMigrated++;
        // Still safe to blank the legacy blob — the child rows already
        // exist, so nothing depends on it.
        if (!DRY_RUN) {
          await prisma.$executeRawUnsafe(
            `UPDATE merchant_applications SET beneficial_owners_enc = NULL WHERE id = $1::uuid`,
            r.id
          );
          blanked++;
        }
        continue;
      }

      let owners: LegacyOwner[] | null = null;
      try {
        owners = kybDecryptJson<LegacyOwner[]>(r.beneficial_owners_enc);
      } catch (err) {
        console.error(
          `[BACKFILL] Decrypt failed for application ${r.id}:`,
          (err as Error).message
        );
        skippedDecryptError++;
        continue;
      }

      if (!Array.isArray(owners) || owners.length === 0) {
        skippedEmpty++;
        if (!DRY_RUN) {
          await prisma.$executeRawUnsafe(
            `UPDATE merchant_applications SET beneficial_owners_enc = NULL WHERE id = $1::uuid`,
            r.id
          );
          blanked++;
        }
        continue;
      }

      // Build create rows. The legacy shape is looser than the new schema,
      // so we fill in placeholders for anything missing — the admin UI can
      // flag incomplete UBOs later. dateOfBirth defaults to 1900-01-01,
      // nationality to "XXX" (invalid ISO — sticks out in a UI review).
      const uboCreates = owners.map((o) => {
        const rawDob = typeof o.dob === "string" && o.dob ? o.dob : null;
        const dob = rawDob ? new Date(rawDob) : new Date("1900-01-01");
        const idEnc = kybEncrypt(o.idNumber || "placeholder") || "";
        return {
          fullName: (o.name || "Unknown").slice(0, 150),
          dateOfBirth: dob,
          nationality: "XXX",
          residentialAddress: o.address ? { line1: String(o.address) } : {},
          ownershipPct:
            typeof o.ownershipPct === "number" && Number.isFinite(o.ownershipPct)
              ? o.ownershipPct
              : 0,
          idType: "PASSPORT" as const,
          idNumberEnc: idEnc,
        };
      });

      if (DRY_RUN) {
        inserted += uboCreates.length;
        console.log(
          `[BACKFILL] (dry) would insert ${uboCreates.length} UBO row(s) for application ${r.id}`
        );
        continue;
      }

      await prisma.$transaction(async (tx) => {
        for (const u of uboCreates) {
          await tx.uboRecord.create({
            data: { ...u, applicationId: r.id },
          });
        }
        // Blank the legacy blob so residual PII doesn't linger. Column
        // itself stays (see migration) for one release cycle in case we
        // need to rollback.
        await tx.$executeRawUnsafe(
          `UPDATE merchant_applications SET beneficial_owners_enc = NULL WHERE id = $1::uuid`,
          r.id
        );
      });
      inserted += uboCreates.length;
      blanked++;
      console.log(
        `[BACKFILL] Inserted ${uboCreates.length} UBO row(s) for application ${r.id}`
      );
    }

    console.log("\n=== Backfill summary ===");
    console.log(`  Applications scanned:      ${rows.length}`);
    console.log(`  UBO rows inserted:         ${inserted}`);
    console.log(`  Applications blanked:      ${blanked}`);
    console.log(`  Skipped (already migrated): ${skippedAlreadyMigrated}`);
    console.log(`  Skipped (blob empty):      ${skippedEmpty}`);
    console.log(`  Skipped (decrypt error):   ${skippedDecryptError}`);
    console.log(DRY_RUN ? "\n(dry-run — no writes were made)" : "\nDone.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
