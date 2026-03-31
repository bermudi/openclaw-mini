import { NextResponse } from "next/server";
import { withInit } from "@/lib/api/init-guard";

export async function GET() {
  return withInit(async () => {
    return NextResponse.json({ message: "Hello, world!" });
  });
}