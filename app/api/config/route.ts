import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { getDb, saveDb, audit } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import type { DurationConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ config: getDb().config });
}

async function PUT_impl(req: Request) {
  const g = await requirePerm("settings.manage");
  if ("error" in g) return g.error;
  const body = (await req.json()) as Partial<DurationConfig>;
  const db = getDb();
  const next = { ...db.config, ...body };
  const num = (v: number, a: number, b: number) => Number.isFinite(v) && v >= a && v <= b;
  if (
    !num(next.daysPerFloor, 1, 30) || !num(next.towerStaggerDays, 0, 180) || !num(next.phaseStaggerDays, 0, 365) ||
    !num(next.gfaReference, 1000, 1e7) || !num(next.gfaMin, 0.1, 1) || !num(next.gfaMax, 1, 5) || !num(next.basementBaseCount, 1, 4)
  ) {
    return NextResponse.json({ error: "Giá trị cấu hình ngoài giới hạn cho phép" }, { status: 422 });
  }
  if (![5, 6].includes(next.workWeek)) return NextResponse.json({ error: "Tuần làm việc là 5 hoặc 6 ngày" }, { status: 422 });
  if (!Array.isArray(next.holidays) || next.holidays.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h))) {
    return NextResponse.json({ error: "Ngày lễ phải dạng yyyy-mm-dd" }, { status: 422 });
  }
  db.config = next;
  audit(g.user.name, "config.update", JSON.stringify(body).slice(0, 200));
  saveDb();
  return NextResponse.json({ config: db.config });
}

export const PUT = drained(PUT_impl);
