// Seeds the first SUPER_ADMIN. Idempotent — upsert by email — so re-running
// this after a schema wipe is safe. Prints the resolved creds on success.
//
// Run:  npm run seed
// Env:  DATABASE_URL must be reachable from wherever you run this.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const EMAIL = "admin@zashx.com";
const PASSWORD = "AdminDemo123!";

async function main() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    const user = await prisma.adminUser.upsert({
      where: { email: EMAIL },
      update: {
        // Reset password on re-seed so a lost dev password isn't a lockout.
        passwordHash,
        isActive: true,
        role: "SUPER_ADMIN",
      },
      create: {
        email: EMAIL,
        firstName: "Platform",
        lastName: "Admin",
        passwordHash,
        role: "SUPER_ADMIN",
        isActive: true,
      },
      select: { id: true, email: true, role: true },
    });

    console.log("Admin user ready:");
    console.log(`  id:       ${user.id}`);
    console.log(`  email:    ${user.email}`);
    console.log(`  role:     ${user.role}`);
    console.log(`  password: ${PASSWORD}`);
    console.log("");
    console.log("Change this password after the first login.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
