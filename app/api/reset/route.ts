import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { resetDb } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";

/** Demo: đặt lại toàn bộ dữ liệu mẫu (cần quyền Cài đặt hệ thống). */
async function POST_impl() {
  const g = await requirePerm("settings.manage");
  if ("error" in g) return g.error;
  resetDb();
  return NextResponse.json({ ok: true });
}

export const POST = drained(POST_impl);
