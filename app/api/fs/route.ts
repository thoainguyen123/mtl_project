import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, baselineOf, getDb, saveDb, uid } from "@/lib/store/db";
import { currentUser, inScope, requirePerm } from "@/lib/auth";
import { COST_GROUPS, computeFs, defaultRates, scaleOf } from "@/lib/fs";
import type { FsVersion } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Danh sách dự án + phiên bản FS; ?projectId= kèm số liệu tính toán của từng phiên bản */
export async function GET(req: Request) {
  const db = getDb();
  const user = await currentUser();
  const pid = new URL(req.url).searchParams.get("projectId");
  const projects = db.projects.map((p) => {
    const vs = db.fsVersions.filter((f) => f.projectId === p.id).sort((a, b) => b.ver - a.ver);
    const base = baselineOf(db, p);
    const latest = vs[0];
    const total = latest ? computeFs(scaleOf(p).value, latest.rates, p.params.anchors).total : 0;
    return { id: p.id, params: p.params, canEdit: inScope(user, p), mtlLabel: base.label, mtlStatus: base.status, latest: latest ? { id: latest.id, label: latest.label, status: latest.status, sentFpaAt: latest.sentFpaAt, total } : null, count: vs.length };
  });
  let versions: (FsVersion & { calc: ReturnType<typeof computeFs>; mtlLabel: string })[] = [];
  let scale: { value: number; note: string } | null = null;
  if (pid) {
    const p = db.projects.find((x) => x.id === pid);
    if (p) {
      scale = scaleOf(p);
      versions = db.fsVersions.filter((f) => f.projectId === pid).sort((a, b) => b.ver - a.ver)
        .map((f) => ({ ...f, calc: computeFs(scale!.value, f.rates, p.params.anchors), mtlLabel: db.versions.find((v) => v.id === f.mtlVersionId)?.label ?? "—" }));
    }
  }
  return NextResponse.json({ projects, versions, scale, groups: COST_GROUPS.map(({ key, label, unit }) => ({ key, label, unit })) });
}

/** Tạo phiên bản FS mới: lần đầu dùng suất mặc định, các lần sau sao chép từ bản trước. Chỉ 1 bản nháp tại một thời điểm. */
async function POST_impl(req: Request) {
  const db = getDb();
  const { projectId } = (await req.json()) as { projectId: string };
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return NextResponse.json({ error: "Không tìm thấy dự án" }, { status: 404 });
  const g = await requirePerm("fs.edit", project);
  if ("error" in g) return g.error;
  const vs = db.fsVersions.filter((f) => f.projectId === projectId);
  if (vs.some((f) => f.status === "draft")) return NextResponse.json({ error: "Đã có bản nháp — hoàn tất hoặc chốt bản nháp trước" }, { status: 409 });
  const prev = vs.sort((a, b) => b.ver - a.ver)[0];
  const ver = (prev?.ver ?? 0) + 1;
  const mtl = baselineOf(db, project);
  const f: FsVersion = {
    id: uid("fs"), projectId, ver, label: `FS-Ver2.${ver}`, status: "draft", mtlVersionId: mtl.id,
    rates: { ...(prev?.rates ?? defaultRates()) }, createdAt: new Date().toISOString(), createdBy: g.user.name,
  };
  db.fsVersions.push(f);
  audit(g.user.name, "fs.create", `${project.params.anchors.code} ${f.label} (căn cứ MTL ${mtl.label})`);
  saveDb();
  return NextResponse.json({ version: f }, { status: 201 });
}

export const POST = drained(POST_impl);
