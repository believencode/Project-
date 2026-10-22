import { NextResponse } from "next/server";
import { health } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Setup check after deploying: database, AI and WhatsApp. */
export async function GET() {
  return NextResponse.json(await health());
}
