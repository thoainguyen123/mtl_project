import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { COST_GROUPS } from "@/lib/fs";

export const dynamic = "force-dynamic";

/** Sửa suất đầu tư (khi còn nháp) hoặc action: approve (chốt) | send_fpa (chuyển FPA) */
async function PATCH_impl(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const f = db.fsVersions.find((x) => x.id === id);
  if (!f) return NextResponse.json({ error: "Không tìm thấy phiên bản FS" }, { status: 404 });
  const project = db.projects.find((p) => p.id === f.projectId)!;
  const body = (await req.json()) as { rates?: Record<string, number>; note?: string; action?: "approve" | "send_fpa" };
  const code = project.params.anchors.code;

  if (body.action) {
    const g = await requirePerm("fs.approve", project);
    if ("error" in g) return g.error;
    if (body.action === "approve") {
      if (f.status !== "draft") return NextResponse.json({ error: "Phiên bản đã chốt" }, { status: 409 });
      f.status = "approved"; f.approvedAt = new Date().toISOString(); f.approvedBy = g.user.name;
      audit(g.user.name, "fs.approve", `${code} ${f.label}`);
    } else {
      if (f.status !== "approved") return NextResponse.json({ error: "Cần chốt FS trước khi chuyển FPA" }, { status: 409 });
      if (f.sentFpaAt) return NextResponse.json({ error: "Đã chuyển FPA" }, { status: 409 });
      f.sentFpaAt = new Date().toISOString();
      audit(g.user.name, "fs.send_fpa", `${code} ${f.label} → FPA (Capex)`);
    }
    saveDb();
    return NextResponse.json({ version: f });
  }

  const g = await requirePerm("fs.edit", project);
  if ("error" in g) return g.error;
  if (f.status !== "draft") return NextResponse.json({ error: "Phiên bản đã chốt — tạo phiên bản mới để chỉnh sửa" }, { status: 409 });
  if (body.rates) {
    for (const grp of COST_GROUPS) {
      const v = body.rates[grp.key];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1000) return NextResponse.json({ error: `Suất đầu tư "${grp.label}" phải từ 0 đến 1.000` }, { status: 422 });
      f.rates[grp.key] = v;
    }
  }
  if (typeof body.note === "string") f.note = body.note.slice(0, 500);
  audit(g.user.name, "fs.update", `${code} ${f.label}`);
  saveDb();
  return NextResponse.json({ version: f });
}

export const PATCH = drained(PATCH_impl);
