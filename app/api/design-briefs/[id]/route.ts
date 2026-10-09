import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import type { DesignBrief } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Sửa nội dung nhiệm vụ (chỉ khi còn "Đang soạn") hoặc thực hiện action: issue | confirm | reopen */
async function PATCH_impl(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const b = db.designBriefs.find((x) => x.id === id);
  if (!b) return NextResponse.json({ error: "Không tìm thấy nhiệm vụ" }, { status: 404 });
  const project = db.projects.find((p) => p.id === b.projectId)!;
  const g = await requirePerm("design.edit", project);
  if ("error" in g) return g.error;
  const body = (await req.json()) as Partial<Pick<DesignBrief, "scope" | "spec" | "requirements" | "consultant" | "inputs">> & { action?: "issue" | "confirm" | "reopen" };
  const now = new Date().toISOString();
  const log = (action: string) => b.history.unshift({ at: now, by: g.user.name, action });

  if (body.action === "issue") {
    if (b.status !== "draft") return NextResponse.json({ error: "Chỉ ban hành nhiệm vụ đang soạn" }, { status: 409 });
    if (!b.scope.trim() || !b.spec.trim()) return NextResponse.json({ error: "Cần nhập phạm vi và tiêu chuẩn bàn giao trước khi ban hành" }, { status: 422 });
    if (!b.consultant.trim()) return NextResponse.json({ error: "Cần chọn đơn vị tư vấn thiết kế trước khi ban hành" }, { status: 422 });
    b.status = "issued"; b.issuedAt = now; log("Ban hành cho DMD");
  } else if (body.action === "confirm") {
    if (b.status !== "issued") return NextResponse.json({ error: "Chỉ xác nhận nhiệm vụ đã ban hành" }, { status: 409 });
    b.status = "confirmed"; b.confirmedAt = now; log("DMD xác nhận");
  } else if (body.action === "reopen") {
    if (b.status === "draft") return NextResponse.json({ error: "Nhiệm vụ đang ở trạng thái soạn" }, { status: 409 });
    b.status = "draft"; b.issuedAt = undefined; b.confirmedAt = undefined; log("Mở lại để chỉnh sửa");
  } else {
    if (b.status !== "draft") return NextResponse.json({ error: "Nhiệm vụ đã ban hành — mở lại để chỉnh sửa" }, { status: 409 });
    for (const k of ["scope", "spec", "requirements", "consultant"] as const) if (typeof body[k] === "string") b[k] = body[k]!;
    if (Array.isArray(body.inputs)) b.inputs = body.inputs.map(String).filter(Boolean);
    log("Cập nhật nội dung");
  }
  b.updatedAt = now; b.updatedBy = g.user.name;
  audit(g.user.name, "design.update", `${project.params.anchors.code} ${b.branch}${body.action ? ` · ${body.action}` : ""}`);
  saveDb();
  return NextResponse.json({ brief: b });
}

export const PATCH = drained(PATCH_impl);
