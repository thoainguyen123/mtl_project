import { NextResponse } from "next/server";
import { baselineOf, getDb } from "@/lib/store/db";
import { versionMetrics } from "@/lib/metrics";
import { MTL_STATUS_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Dashboard tổng quan: KPI toàn hệ thống + chi tiết MTL hiện hành của dự án được chọn. */
export async function GET(req: Request) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const pid = new URL(req.url).searchParams.get("projectId") ?? db.projects[0]?.id;
  const project = db.projects.find((p) => p.id === pid) ?? db.projects[0];
  const cur = baselineOf(db, project);
  const rows = db.projects.map((p) => {
    const v = baselineOf(db, p);
    const m = versionMetrics(v, db.tracking, today);
    return {
      id: p.id, code: p.params.anchors.code, name: p.params.anchors.name, region: p.params.anchors.region,
      type: p.params.anchors.type, versionId: v.id, version: v.label, status: v.status, statusLabel: MTL_STATUS_LABEL[v.status],
      plan: m.overall.plan, actual: m.overall.actual, late: m.overall.late, total: m.overall.total, conflicts: m.conflicts,
      finish: v.generation?.projectFinish,
    };
  });
  return NextResponse.json({
    today,
    projects: db.projects.map((p) => ({ id: p.id, code: p.params.anchors.code, name: p.params.anchors.name })),
    selected: { id: project.id, versionId: cur.id, version: cur.label, status: cur.status, name: project.params.anchors.name, code: project.params.anchors.code },
    kpi: {
      mtlCount: db.projects.length,
      approved: rows.filter((r) => r.status === "approved").length,
      pending: rows.filter((r) => r.status === "approval_pending").length,
      draft: rows.filter((r) => r.status === "draft").length,
      lateTasks: rows.reduce((s, r) => s + r.late, 0),
    },
    rows,
    metrics: versionMetrics(cur, db.tracking, today),
  });
}
