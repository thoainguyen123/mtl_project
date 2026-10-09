import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { generate } from "@/lib/engine/generate";
import { validateParams } from "@/lib/validate";
import type { ProjectParameters } from "@/lib/types";

/** Sinh lại tiến độ cho bản thảo hiện hành (có thể kèm tham số mới). Chỉ áp dụng cho bản đang soạn thảo. */
async function POST_impl(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const project = db.projects.find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: "Không tìm thấy dự án" }, { status: 404 });
  const g = await requirePerm("mtl.generate", project);
  if ("error" in g) return g.error;
  const v = db.versions.find((x) => x.id === project.currentVersionId)!;
  if (v.status !== "draft") return NextResponse.json({ error: "Chỉ sinh lại được bản đang soạn thảo. Hãy tạo REV mới từ bản đã duyệt." }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { params?: ProjectParameters };
  const params = body.params ?? project.params;
  const errors = validateParams(params, db.projects.filter((p) => p.id !== id).map((p) => p.params.anchors.code));
  if (errors.length) return NextResponse.json({ error: "Dữ liệu chưa hợp lệ", errors }, { status: 422 });
  const out = generate({ params, config: db.config, overrides: db.templateOverrides });
  project.params = params;
  v.tasks = out.tasks;
  v.generation = out.report;
  audit(g.user.name, "mtl.generate", `${params.anchors.code} → ${out.tasks.length} dòng`);
  saveDb();
  return NextResponse.json({ report: out.report });
}

export const POST = drained(POST_impl);
