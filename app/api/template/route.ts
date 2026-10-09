import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { getDb, saveDb, audit } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { TEMPLATE } from "@/lib/engine/template";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  return NextResponse.json({
    count: TEMPLATE.length,
    overrides: db.templateOverrides,
    tasks: TEMPLATE.map((t) => ({
      code: t.code, wbs: t.wbs, name: t.name, level: t.level, parent: t.parent, ban: t.ban, kind: t.kind,
      pred: t.pred, applies: t.applies, baseLow: t.base?.low, baseHigh: t.base?.high, demo: !!t.demoSupplement, hangmuc: t.hangmuc,
    })),
  });
}

/** Chỉnh định mức (base duration) cho 1 mã WBS chuẩn — áp dụng cho các MTL sinh MỚI. */
async function PATCH_impl(req: Request) {
  const g = await requirePerm("template.manage");
  if ("error" in g) return g.error;
  const { code, baseHigh, baseLow } = (await req.json()) as { code: string; baseHigh?: number | null; baseLow?: number | null };
  if (!TEMPLATE.some((t) => t.code === code)) return NextResponse.json({ error: "Mã WBS không tồn tại" }, { status: 404 });
  const ok = (v: unknown) => v === null || v === undefined || (typeof v === "number" && v >= 1 && v <= 5000);
  if (!ok(baseHigh) || !ok(baseLow)) return NextResponse.json({ error: "Định mức từ 1 đến 5000 ngày" }, { status: 422 });
  const db = getDb();
  const cur = { ...(db.templateOverrides[code] ?? {}) } as { baseHigh?: number; baseLow?: number };
  if (baseHigh !== undefined) {
    if (baseHigh === null) delete cur.baseHigh;
    else cur.baseHigh = baseHigh;
  }
  if (baseLow !== undefined) {
    if (baseLow === null) delete cur.baseLow;
    else cur.baseLow = baseLow;
  }
  if (Object.keys(cur).length) db.templateOverrides[code] = cur;
  else delete db.templateOverrides[code];
  audit(g.user.name, "template.override", code);
  saveDb();
  return NextResponse.json({ overrides: db.templateOverrides });
}

export const PATCH = drained(PATCH_impl);
