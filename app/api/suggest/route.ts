import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { getDb } from "@/lib/store/db";
import { suggestAnchors } from "@/lib/engine/generate";
import { validateTech } from "@/lib/validate";
import type { ProjectParameters } from "@/lib/types";

/** Gợi ý mốc Khởi công / Mở bán / Bàn giao / Kết thúc khả thi từ T0 + tham số kỹ thuật (tính xuôi). */
async function POST_impl(req: Request) {
  const params = (await req.json()) as ProjectParameters;
  const errors = validateTech(params);
  if (errors.length || !params.anchors?.t0) {
    return NextResponse.json({ error: "Cần T0 và tham số kỹ thuật hợp lệ", errors }, { status: 422 });
  }
  return NextResponse.json(suggestAnchors(params, getDb().config));
}

export const POST = drained(POST_impl);
