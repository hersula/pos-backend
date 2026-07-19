import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@pos.com";
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD || "ChangeMe123!";

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Super admin dengan email ${email} sudah ada, skip seeding.`);
    return;
  }

  const hashed = await bcrypt.hash(password, 10);

  await prisma.adminUser.create({
    data: {
      name: "Super Admin",
      email,
      password: hashed,
      role: "SUPER_ADMIN",
    },
  });

  console.log("=================================");
  console.log("Super admin berhasil dibuat:");
  console.log("Email   :", email);
  console.log("Password:", password);
  console.log("=================================");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
