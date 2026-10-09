import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Thẩm định MTL bản thảo trước khi trình duyệt (GIẢ ĐỊNH demo): đạt / yêu cầu chỉnh sửa, kèm ý kiến. */
async function POST_impl(req: Request, ctx: { params: Promise<{ vid: string }> }) {
  const { vid } = await ctx.params;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const project = db.projects.find((p) => p.id === v.projectId)!;
  const g = await requirePerm("mtl.approve", project);
  if ("error" in g) return g.error;
  if (v.status !== "draft") return NextResponse.json({ error: "Chỉ thẩm định bản đang soạn thảo" }, { status: 409 });
  const { result, note } = (await req.json()) as { result: "passed" | "changes"; note?: string };
  if (result !== "passed" && result !== "changes") return NextResponse.json({ error: "Kết quả thẩm định không hợp lệ" }, { status: 422 });
  if (result === "changes" && !note?.trim()) return NextResponse.json({ error: "Cần ghi ý kiến khi yêu cầu chỉnh sửa" }, { status: 422 });
  if (result === "passed") {
    const conflicts = v.tasks.filter((t) => t.conflict).length;
    if (conflicts) return NextResponse.json({ error: `Còn ${conflicts} xung đột mốc — chưa thể thẩm định đạt` }, { status: 422 });
  }
  v.review = { result, by: g.user.name, at: new Date().toISOString(), note: note?.trim() };
  audit(g.user.name, "mtl.review", `${project.params.anchors.code} ${v.label}: ${result}`);
  saveDb();
  return NextResponse.json({ review: v.review });
}

export const POST = drained(POST_impl);
