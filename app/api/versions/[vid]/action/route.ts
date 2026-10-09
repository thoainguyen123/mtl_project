import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb, uid } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import type { MtlVersion } from "@/lib/types";

/**
 * Vòng đời MTL (BRD 2.1 bước 5-6) + tích hợp E-Approval MÔ PHỎNG:
 *   submit  : PMD bấm "Trình E-Approval" -> sinh mã tờ trình điện tử, khóa bản
 *   approve : mô phỏng callback phê duyệt BOD từ E-Approval -> Baseline / REV n
 *   reject  : E-Approval trả về -> quay lại soạn thảo
 *   cancel  : hủy
 *   new_rev : tạo REV mới từ bản đã duyệt (sao chép cấu trúc + % tiến độ)
 */
async function POST_impl(req: Request, ctx: { params: Promise<{ vid: string }> }) {
  const { vid } = await ctx.params;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const project = db.projects.find((p) => p.id === v.projectId)!;
  const { action, force, note } = (await req.json()) as { action: string; force?: boolean; note?: string };
  const now = new Date().toISOString();

  if (action === "submit") {
    const g = await requirePerm("mtl.submit_approval", project);
    if ("error" in g) return g.error;
    if (v.status !== "draft") return NextResponse.json({ error: "Chỉ trình được bản đang soạn thảo" }, { status: 409 });
    const conflicts = v.tasks.filter((t) => t.conflict).length;
    if (conflicts && !force) return NextResponse.json({ error: `Còn ${conflicts} công việc/mốc vi phạm ràng buộc. Hãy xử lý hoặc xác nhận trình kèm cảnh báo.`, conflicts, needForce: true }, { status: 422 });
    v.status = "approval_pending";
    v.approval = { submittedAt: now, ticket: `EA-2026-${1000 + db.versions.filter((x) => x.approval).length + 1}` };
    audit(g.user.name, "mtl.submit", `${v.approval.ticket} - ${project.params.anchors.code}`);
  } else if (action === "approve") {
    const g = await requirePerm("mtl.approve", project);
    if ("error" in g) return g.error;
    if (v.status !== "approval_pending") return NextResponse.json({ error: "Chỉ phê duyệt bản đang trình E-Approval" }, { status: 409 });
    const hadBaseline = db.versions.some((x) => x.projectId === v.projectId && x.status === "approved");
    const maxRev = Math.max(0, ...db.versions.filter((x) => x.projectId === v.projectId).map((x) => x.rev));
    v.status = "approved";
    if (!hadBaseline) { v.kind = "baseline"; v.rev = 0; v.label = "Baseline v1.0"; }
    else { v.kind = "rev"; v.rev = Math.max(v.rev, maxRev); v.label = `REV ${String(v.rev).padStart(2, "0")}`; }
    v.approval = { ...(v.approval ?? { submittedAt: now, ticket: "EA-2026-0000" }), approvedAt: now, approver: g.user.name };
    project.currentVersionId = v.id;
    audit(g.user.name, "mtl.approve", `${v.label} - ${project.params.anchors.code}`);
  } else if (action === "reject") {
    const g = await requirePerm("mtl.approve", project);
    if ("error" in g) return g.error;
    if (v.status !== "approval_pending") return NextResponse.json({ error: "Chỉ trả về bản đang trình" }, { status: 409 });
    v.status = "draft";
    v.note = note ?? "E-Approval trả về";
    audit(g.user.name, "mtl.reject", project.params.anchors.code);
  } else if (action === "cancel") {
    const g = await requirePerm("mtl.approve", project);
    if ("error" in g) return g.error;
    if (v.status === "approved") return NextResponse.json({ error: "Không hủy được bản đã duyệt (hãy tạo REV mới)" }, { status: 409 });
    v.status = "cancelled";
    audit(g.user.name, "mtl.cancel", project.params.anchors.code);
  } else if (action === "new_rev") {
    const g = await requirePerm("mtl.generate", project);
    if ("error" in g) return g.error;
    if (v.status !== "approved") return NextResponse.json({ error: "REV mới chỉ tạo từ bản đã duyệt" }, { status: 409 });
    if (db.versions.some((x) => x.projectId === v.projectId && x.status === "draft")) return NextResponse.json({ error: "Dự án đã có bản thảo đang soạn" }, { status: 409 });
    const rev = Math.max(0, ...db.versions.filter((x) => x.projectId === v.projectId).map((x) => x.rev)) + 1;
    const nv: MtlVersion = {
      ...structuredClone(v), id: uid("v"), kind: "rev", rev, label: `REV ${String(rev).padStart(2, "0")} (bản thảo)`,
      status: "draft", createdAt: now, createdBy: g.user.name, approval: undefined, note: note ?? `Tạo từ ${v.label}`,
    };
    for (const t of db.tracking.filter((x) => x.taskId.startsWith(v.id + ":"))) {
      db.tracking.push({ ...structuredClone(t), taskId: `${nv.id}:${t.taskId.slice(v.id.length + 1)}` });
    }
    db.versions.push(nv);
    project.currentVersionId = nv.id;
    audit(g.user.name, "mtl.new_rev", `${nv.label} - ${project.params.anchors.code}`);
    saveDb();
    return NextResponse.json({ versionId: nv.id });
  } else {
    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  }
  saveDb();
  return NextResponse.json({ ok: true, status: v.status, approval: v.approval, label: v.label });
}

export const POST = drained(POST_impl);
