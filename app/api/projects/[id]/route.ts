import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { validateAnchors } from "@/lib/validate";
import type { AnchorParams, ProjectInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const project = db.projects.find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: "Không tìm thấy dự án" }, { status: 404 });
  const versions = db.versions.filter((v) => v.projectId === id).map(({ tasks, ...rest }) => ({ ...rest, taskCount: tasks.length }));
  return NextResponse.json({ project, versions });
}

/** Thông tin dự án: sửa tên, chủ đầu tư, 5 mốc thời gian neo và hồ sơ bổ sung.
 *  Mã dự án, loại hình, vùng KHÔNG đổi (ảnh hưởng template, phân quyền). Đổi mốc neo -> MTL cần tạo REV mới. */
async function PATCH_impl(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const project = db.projects.find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: "Không tìm thấy dự án" }, { status: 404 });
  const g = await requirePerm("project.edit", project);
  if ("error" in g) return g.error;
  const body = (await req.json()) as { anchors?: Partial<AnchorParams>; info?: ProjectInfo };
  const next: AnchorParams = { ...project.params.anchors };
  const editable: (keyof AnchorParams)[] = ["name", "investor", "t0", "startConstruction", "openSale", "handover", "closeOut"];
  for (const k of editable) if (body.anchors && k in body.anchors) (next as unknown as Record<string, string>)[k] = String(body.anchors[k] ?? "").trim();
  const errors = validateAnchors(next, []);
  if (errors.length) return NextResponse.json({ error: "Dữ liệu chưa hợp lệ", errors }, { status: 422 });
  const milestoneChanged = (["t0", "startConstruction", "openSale", "handover", "closeOut"] as const).some((k) => next[k] !== project.params.anchors[k]);
  project.params.anchors = next;
  if (body.info) project.info = { ...project.info, ...body.info };
  audit(g.user.name, "project.update", `${next.code}${milestoneChanged ? " (đổi mốc neo)" : ""}`);
  saveDb();
  return NextResponse.json({ project, milestoneChanged });
}

export const PATCH = drained(PATCH_impl);
