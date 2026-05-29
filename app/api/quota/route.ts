import { NextResponse } from "next/server";
import { getQuotaWindowDetails } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getQuotaWindowDetails();
  return NextResponse.json(result);
}
