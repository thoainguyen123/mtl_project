import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb } from "@/lib/store/db";
import { currentUser, inScope, requirePerm } from "@/lib/auth";
import { DISCIPLINES, defaultBriefs } from "@/lib/design";

export const dynamic = "force-dynamic";

/** Danh sách dự án kèm số nhiệm vụ theo trạng thái; ?projectId= trả chi tiết các nhiệm vụ */
export async function GET(req: Request) {
  const db = getDb();
  const user = await currentUser();
  const pid = new URL(req.url).searchParams.get("projectId");
  const sum = (id: string) => {
    const b = db.designBriefs.filter((x) => x.projectId === id);
    return { total: b.length, draft: b.filter((x) => x.status === "draft").length, issued: b.filter((x) => x.status === "issued").length, confirmed: b.filter((x) => x.status === "confirmed").length };
  };
  const projects = db.projects.map((p) => ({ id: p.id, params: p.params, canEdit: inScope(user, p), counts: sum(p.id) }));
  const briefs = pid ? db.designBriefs.filter((b) => b.projectId === pid) : [];
  return NextResponse.json({ projects, briefs, disciplines: DISCIPLINES.map(({ branch, name }) => ({ branch, name })) });
}

/** Khởi tạo bộ nhiệm vụ thiết kế cho dự án từ tham số dự án */
async function POST_impl(req: Request) {
  const db = getDb();
  const { projectId } = (await req.json()) as { projectId: string };
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return NextResponse.json({ error: "Không tìm thấy dự án" }, { status: 404 });
  const g = await requirePerm("design.edit", project);
  if ("error" in g) return g.error;
  if (db.designBriefs.some((b) => b.projectId === projectId)) return NextResponse.json({ error: "Dự án đã có bộ nhiệm vụ thiết kế" }, { status: 409 });
  const briefs = defaultBriefs(project, g.user.name);
  db.designBriefs.push(...briefs);
  audit(g.user.name, "design.init", `${project.params.anchors.code}: ${briefs.length} nhiệm vụ`);
  saveDb();
  return NextResponse.json({ briefs }, { status: 201 });
}

export const POST = drained(POST_impl);
