import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { getCurrentUser } from "@/lib/auth/require-user";
import { parseAmount } from "@/lib/ledger/money";
import { requestWithdrawal } from "@/lib/solana/withdrawals";
import { writeAuditLog } from "@/lib/auth/audit";
import { tooMany } from "@/lib/security/rate-limit";

const schema = z.object({
  asset: z.enum(["SOL", "USDC", "TOKEN"]),
  amount: z.string(),
  toAddress: z.string().min(32).max(64),
});

export async function POST(req: Request) {
  const limited = tooMany(req, "withdraw", { capacity: 5, refillPerSec: 0.1 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.status === "BLOCKED") {
    return NextResponse.json({ error: "Account blocked" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Reject a malformed destination up front (a bad address would otherwise lock
  // funds, fail on send, then refund — validate before we ever lock).
  try {
    // eslint-disable-next-line no-new
    new PublicKey(parsed.data.toAddress);
  } catch {
    return NextResponse.json(
      { error: "Enter a valid Solana address" },
      { status: 400 },
    );
  }

  try {
    const amount = parseAmount(parsed.data.asset, parsed.data.amount);
    if (amount <= 0n) {
      return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    }
    const result = await requestWithdrawal({
      userId: user.id,
      asset: parsed.data.asset,
      amount,
      toAddress: parsed.data.toAddress,
    });
    await writeAuditLog({
      actorUserId: user.id,
      action: "WITHDRAWAL_REQUESTED",
      targetType: "Withdrawal",
      targetId: result.withdrawalId,
      metadata: { asset: parsed.data.asset, amount: amount.toString() },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Withdrawal failed" },
      { status: 400 },
    );
  }
}
