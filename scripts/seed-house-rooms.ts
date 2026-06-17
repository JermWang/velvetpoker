/** Seed/refresh the four house cash games. Run: `npm run seed:rooms`. */
import { prisma } from "@/lib/db/prisma";
import { seedHouseRooms } from "@/lib/seed/house-rooms";

seedHouseRooms()
  .then((n) => console.log(`[seed] upserted ${n} house rooms`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
