import { NextResponse } from "next/server";
import { getDb } from "@/lib/store/db";
import { currentUser, inScope, can } from "@/lib/auth";
import { versionMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ vid: string }> }) {
  const { vid } = await ctx.params;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const project = db.projects.find((p) => p.id === v.projectId)!;
  const user = await currentUser();
  const today = new Date().toISOString().slice(0, 10);
  const tracking = db.tracking.filter((t) => t.taskId.startsWith(vid + ":"));
  const siblings = db.versions.filter((x) => x.projectId === v.projectId).map(({ tasks, ...r }) => ({ ...r, taskCount: tasks.length }));
  return NextResponse.json({
    version: v, project, siblings, tracking, today,
    metrics: versionMetrics(v, db.tracking, today),
    config: db.config,
    perms: {
      inScope: inScope(user, project),
      edit: can(user, "mtl.edit_task") && inScope(user, project) && v.status === "draft",
      generate: can(user, "mtl.generate") && inScope(user, project) && v.status === "draft",
      newRev: can(user, "mtl.generate") && inScope(user, project) && v.status === "approved",
      submit: can(user, "mtl.submit_approval") && inScope(user, project),
      approve: can(user, "mtl.approve") && inScope(user, project),
      export: can(user, "mtl.export"),
      track: can(user, "tracking.update") && inScope(user, project),
      comment: can(user, "tracking.comment"),
    },
  });
}
