import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb, uid } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { ensureTracking } from "@/lib/store/tracking";

async function POST_impl(req: Request, ctx: { params: Promise<{ vid: string; tid: string }> }) {
  const { vid, tid } = await ctx.params;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const g = await requirePerm("tracking.comment");
  if ("error" in g) return g.error;
  const { text } = (await req.json()) as { text: string };
  const clean = (text ?? "").trim();
  if (!clean) return NextResponse.json({ error: "Nội dung trao đổi không được để trống" }, { status: 422 });
  const tr = ensureTracking(`${vid}:${decodeURIComponent(tid)}`);
  const c = { id: uid("c"), at: new Date().toISOString(), by: g.user.name, role: g.user.role, text: clean.slice(0, 2000) };
  tr.comments.push(c);
  audit(g.user.name, "tracking.comment", decodeURIComponent(tid));
  saveDb();
  return NextResponse.json({ comment: c });
}

export const POST = drained(POST_impl);
