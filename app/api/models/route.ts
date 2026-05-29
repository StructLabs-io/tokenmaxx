import { NextRequest, NextResponse } from "next/server";
import { getModelBreakdown } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const daysParam = searchParams.get("days");
  const days = daysParam != null ? parseInt(daysParam, 10) : 30;

  const models = await getModelBreakdown(isNaN(days) ? 30 : days);

  return NextResponse.json({
    models,
    days: isNaN(days) ? 30 : days,
  });
}
