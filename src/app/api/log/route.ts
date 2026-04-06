import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { event, data } = await req.json();
  console.log(`${event}: ${JSON.stringify(data)}`);
  return NextResponse.json({ ok: true });
}
