import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantUserFromRequest, AuthError } from "@/lib/auth";
import { getTenantSubscription, checkFreeTransactionLimit } from "@/lib/subscription";

export async function GET(req: NextRequest) {
  try {
    const user = getTenantUserFromRequest(req);

    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { planType: true } });
    if (!tenant) return NextResponse.json({ message: "Tenant tidak ditemukan" }, { status: 404 });

    if (tenant.planType === "FREE") {
      const limit = await checkFreeTransactionLimit(user.tenantId);
      return NextResponse.json({
        data: {
          planType: "FREE",
          dailyTransactionUsed: limit.used,
          dailyTransactionLimit: limit.limit,
          dailyTransactionRemaining: Math.max(0, limit.limit - limit.used),
        },
      });
    }

    const subscription = await getTenantSubscription(user.tenantId);
    if (!subscription) {
      return NextResponse.json({ data: { planType: "SUBSCRIBE", subscription: null } });
    }

    const now = new Date();
    const endDate = new Date(subscription.endDate);
    const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const isExpired = now > endDate;

    return NextResponse.json({
      data: {
        planType: "SUBSCRIBE",
        subscription: {
          id: subscription.id,
          planName: subscription.planName,
          status: isExpired && subscription.status !== "PENDING_PAYMENT" ? "EXPIRED" : subscription.status,
          paymentStatus: subscription.paymentStatus,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          daysRemaining,
          isExpired,
        },
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: err.message }, { status: err.status });
    console.error("get tenant subscription error:", err);
    return NextResponse.json({ message: "Terjadi kesalahan pada server" }, { status: 500 });
  }
}
