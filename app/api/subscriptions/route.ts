import { NextResponse } from "next/server";
import { getSubscriptionsSummary } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getSubscriptionsSummary();
  return NextResponse.json(result);
}
