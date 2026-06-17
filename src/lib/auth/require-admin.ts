/**
 * Admin guard. Admin routes/handlers must call this. Non-admins are redirected
 * away; they must never see admin surfaces.
 */

import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { requireUser } from "./require-user";

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/app");
  return user;
}

export function assertAdmin(user: User): void {
  if (user.role !== "ADMIN") {
    throw new Error("Forbidden: admin only");
  }
}
