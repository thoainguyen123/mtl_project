import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { reschedule } from "@/lib/engine/generate";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/types";

/** Sửa 1 công việc trong bản thảo: trạng thái (Đóng/Đang thực hiện/Hoàn thành), chức danh, thời lượng, tên. */
async function PATCH_impl(req: Request, ctx: { params: Promise<{ vid: string; tid: string }> }) {
  const { vid, tid } = await ctx.params;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const project = db.projects.find((p) => p.id === v.projectId)!;
  const g = await requirePerm("mtl.edit_task", project);
  if ("error" in g) return g.error;
  if (v.status !== "draft") return NextResponse.json({ error: "Bản đã trình/đã duyệt bị khóa. Hãy tạo REV mới để chỉnh sửa." }, { status: 409 });
  const t = v.tasks.find((x) => decodeURIComponent(tid) === x.id);
  if (!t) return NextResponse.json({ error: "Không tìm thấy công việc" }, { status: 404 });
  const body = (await req.json()) as { status?: TaskStatus; assigneeTitle?: string; durationDays?: number; name?: string };
  let needSchedule = false;
  if (body.status && body.status in TASK_STATUS_LABEL) {
    if (t.kind === "summary" || t.kind === "milestone") return NextResponse.json({ error: "Chỉ đổi trạng thái cho công việc lá" }, { status: 422 });
    needSchedule = (body.status === "closed") !== (t.status === "closed");
    t.status = body.status;
  }
  if (body.assigneeTitle !== undefined) t.assigneeTitle = body.assigneeTitle || undefined;
  if (body.name !== undefined && body.name.trim()) t.name = body.name.trim().slice(0, 300);
  if (body.durationDays !== undefined) {
    const d = Math.round(Number(body.durationDays));
    if (!Number.isFinite(d) || d < 1 || d > 5000) return NextResponse.json({ error: "Thời lượng từ 1 đến 5000 ngày làm việc" }, { status: 422 });
    t.durationDays = d;
    t.durationNote = `Chỉnh tay: ${d} ngày (định mức gốc ${t.baseDays ?? "?"})`;
    needSchedule = true;
  }
  let warnings: string[] = [];
  if (needSchedule) warnings = reschedule(v.tasks, project.params.anchors, db.config).warnings;
  audit(g.user.name, "task.edit", `${project.params.anchors.code} ${t.wbs}`);
  saveDb();
  return NextResponse.json({ task: t, tasks: needSchedule ? v.tasks : undefined, warnings });
}

export const PATCH = drained(PATCH_impl);
