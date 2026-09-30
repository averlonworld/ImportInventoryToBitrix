import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { env } from '../src/config/env';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = env.ADMIN_EMAIL;
  const adminPassword = env.ADMIN_PASSWORD;

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existingUser) {
    console.log('Admin user already exists:', adminEmail);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('Created admin user:', user.email);
  console.log('Role:', user.role);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
