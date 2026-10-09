import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { ensureTracking } from "@/lib/store/tracking";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ vid: string; tid: string }> }) {
  const { vid, tid } = await ctx.params;
  const db = getDb();
  const t = db.tracking.find((x) => x.taskId === `${vid}:${decodeURIComponent(tid)}`);
  return NextResponse.json({ tracking: t ?? { taskId: `${vid}:${tid}`, percent: 0, evidence: [], comments: [] } });
}

/** Cập nhật % hoàn thành. Hoàn thành 100% bắt buộc có ít nhất 1 minh chứng (BRD 3.4). */
async function POST_impl(req: Request, ctx: { params: Promise<{ vid: string; tid: string }> }) {
  const { vid, tid } = await ctx.params;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const project = db.projects.find((p) => p.id === v.projectId)!;
  const g = await requirePerm("tracking.update", project);
  if ("error" in g) return g.error;
  if (v.status !== "approved") return NextResponse.json({ error: "Chỉ tracking trên MTL đã được phê duyệt" }, { status: 409 });
  const id = decodeURIComponent(tid);
  const task = v.tasks.find((x) => x.id === id);
  if (!task || task.kind !== "task") return NextResponse.json({ error: "Không tìm thấy công việc" }, { status: 404 });
  if (task.status === "closed") return NextResponse.json({ error: "Công việc đang ở trạng thái Đóng" }, { status: 409 });
  const body = (await req.json()) as { percent?: number; issue?: string; quality?: number | null };
  const tr = ensureTracking(`${vid}:${id}`);
  if (body.percent !== undefined) {
    const p = Math.round(Number(body.percent));
    if (!Number.isFinite(p) || p < 0 || p > 100) return NextResponse.json({ error: "% hoàn thành từ 0 đến 100" }, { status: 422 });
    if (p === 100 && tr.percent < 100 && tr.evidence.length === 0) {
      return NextResponse.json({ error: "Cần đính kèm ít nhất 1 minh chứng (hình ảnh/tệp) trước khi xác nhận hoàn thành 100%" }, { status: 422 });
    }
    tr.percent = p;
    task.status = p >= 100 ? "done" : "in_progress";
    tr.doneAt = p >= 100 ? (tr.doneAt ?? new Date().toISOString().slice(0, 10)) : undefined;
  }
  if (body.quality !== undefined) {
    if (body.quality === null) tr.quality = undefined;
    else if (Number.isInteger(body.quality) && body.quality >= 1 && body.quality <= 5) tr.quality = body.quality;
    else return NextResponse.json({ error: "Chất lượng từ 1 đến 5" }, { status: 422 });
  }
  if (body.issue !== undefined) tr.issue = body.issue.trim().slice(0, 500) || undefined;
  tr.updatedAt = new Date().toISOString();
  tr.updatedBy = g.user.name;
  audit(g.user.name, "tracking.update", `${project.params.anchors.code} ${task.wbs} → ${tr.percent}%`);
  saveDb();
  return NextResponse.json({ tracking: tr, status: task.status });
}

export const POST = drained(POST_impl);
