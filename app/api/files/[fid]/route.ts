import { NextResponse } from "next/server";
import { getDb } from "@/lib/store/db";
import { getBlob } from "@/lib/store/blob";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ fid: string }> }) {
  const { fid } = await ctx.params;
  if (!/^[\w-]+$/.test(fid)) return NextResponse.json({ error: "Mã tệp không hợp lệ" }, { status: 400 });
  const bytes = getBlob(fid);
  if (!bytes) return NextResponse.json({ error: "Không tìm thấy tệp" }, { status: 404 });
  const meta = getDb().tracking.flatMap((t) => t.evidence).find((e) => e.id === fid);
  return new NextResponse(bytes as unknown as BodyInit, { headers: { "Content-Type": meta?.mime ?? "application/octet-stream", "Content-Disposition": `inline; filename="${encodeURIComponent(meta?.name ?? fid)}"` } });
}
