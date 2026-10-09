import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, baselineOf, getDb, saveDb, uid } from "@/lib/store/db";
import { requirePerm, currentUser, inScope } from "@/lib/auth";
import { generate } from "@/lib/engine/generate";
import { validateParams } from "@/lib/validate";
import { versionMetrics } from "@/lib/metrics";
import type { MtlVersion, Project, ProjectParameters } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const user = await currentUser();
  const today = new Date().toISOString().slice(0, 10);
  const list = db.projects.map((p) => {
    const versions = db.versions.filter((v) => v.projectId === p.id).map(({ tasks, ...rest }) => ({ ...rest, taskCount: tasks.length }));
    const cur = db.versions.find((v) => v.id === p.currentVersionId)!;
    const base = baselineOf(db, p);
    const m = versionMetrics(base, db.tracking, today);
    return { ...p, versions, baselineId: base.id, current: { id: cur.id, label: cur.label, status: cur.status, approval: cur.approval, review: cur.review, curConflicts: cur.tasks.filter((t) => t.conflict).length, curUnassigned: cur.tasks.filter((t) => t.kind === "task" && t.status !== "closed" && !t.assigneeTitle).length, start: cur.generation?.projectStart, finish: cur.generation?.projectFinish, actual: m.overall.actual, plan: m.overall.plan, late: m.overall.late, conflicts: m.conflicts }, canEdit: inScope(user, p) };
  });
  return NextResponse.json({ projects: list });
}

async function POST_impl(req: Request) {
  const g = await requirePerm("project.create");
  if ("error" in g) return g.error;
  const db = getDb();
  const params = (await req.json()) as ProjectParameters;
  const errors = validateParams(params, db.projects.map((p) => p.params.anchors.code));
  if (errors.length) return NextResponse.json({ error: "Dữ liệu chưa hợp lệ", errors }, { status: 422 });
  const { tasks, report } = generate({ params, config: db.config, overrides: db.templateOverrides });
  const pid = uid("p");
  const vid = uid("v");
  const v: MtlVersion = { id: vid, projectId: pid, label: "Bản thảo", kind: "draft", rev: 0, status: "draft", createdAt: new Date().toISOString(), createdBy: g.user.name, tasks, generation: report };
  const p: Project = { id: pid, params, createdAt: v.createdAt, createdBy: g.user.name, currentVersionId: vid };
  db.projects.push(p);
  db.versions.push(v);
  if (g.user.role === "project_admin") g.user.projectIds = [...(g.user.projectIds ?? []), pid];
  audit(g.user.name, "project.create", `${params.anchors.code} - ${params.anchors.name}`);
  saveDb();
  return NextResponse.json({ project: p, versionId: vid, report }, { status: 201 });
}

export const POST = drained(POST_impl);
