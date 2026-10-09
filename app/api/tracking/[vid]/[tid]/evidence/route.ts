import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { audit, getDb, saveDb, uid } from "@/lib/store/db";
import { putBlob } from "@/lib/store/blob";
import { requirePerm } from "@/lib/auth";
import { ensureTracking } from "@/lib/store/tracking";

const MAX = 8 * 1024 * 1024;
const OK = /^(image\/(png|jpe?g|gif|webp)|application\/(pdf|vnd\.openxmlformats-officedocument\..+|msword|vnd\.ms-excel)|text\/plain)$/;

/** Upload minh chứng (hình ảnh / PDF / Office). Demo: lưu vào .data/uploads, tối đa 8MB. */
async function POST_impl(req: Request, ctx: { params: Promise<{ vid: string; tid: string }> }) {
  const { vid, tid } = await ctx.params;
  const db = getDb();
  const v = db.versions.find((x) => x.id === vid);
  if (!v) return NextResponse.json({ error: "Không tìm thấy phiên bản" }, { status: 404 });
  const project = db.projects.find((p) => p.id === v.projectId)!;
  const g = await requirePerm("tracking.update", project);
  if ("error" in g) return g.error;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Chưa chọn tệp" }, { status: 422 });
  if (file.size > MAX) return NextResponse.json({ error: "Tệp vượt quá 8MB" }, { status: 413 });
  if (!OK.test(file.type)) return NextResponse.json({ error: `Định dạng không được hỗ trợ (${file.type || "không rõ"})` }, { status: 415 });
  const id = uid("f");
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  putBlob(id, safe, new Uint8Array(await file.arrayBuffer()));
  const tr = ensureTracking(`${vid}:${decodeURIComponent(tid)}`);
  const ev = { id, name: file.name, mime: file.type, size: file.size, url: `/api/files/${id}`, at: new Date().toISOString(), by: g.user.name };
  tr.evidence.push(ev);
  audit(g.user.name, "tracking.evidence", `${decodeURIComponent(tid)} ${file.name}`);
  saveDb();
  return NextResponse.json({ evidence: ev }, { status: 201 });
}

export const POST = drained(POST_impl);
