import { NextResponse } from "next/server";
import { getDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { toMspdi, toWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ vid: string }> }) {
  const { vid } = await ctx.params;
  const g = await requirePerm("mtl.export");
  if ("error" in g) return g.error;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const project = db.projects.find((p) => p.id === v.projectId)!;
  const format = new URL(req.url).searchParams.get("format") ?? "xlsx";
  const tracking = db.tracking.filter((t) => t.taskId.startsWith(vid + ":"));
  const base = `MTL_${project.params.anchors.code}_${v.label.replace(/[^\w]+/g, "_")}`;
  if (format === "xml") {
    const xml = toMspdi(project, v, db.config, tracking);
    return new NextResponse(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.xml"` } });
  }
  const buf = toWorkbook(project, v, tracking);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
}
