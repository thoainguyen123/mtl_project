import { NextResponse } from "next/server";
import { CORE_PROJECTS, INVESTORS, REGIONS } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** MOCK tích hợp "Danh mục Dự án lõi" của Tập đoàn: trả về danh sách để điền sẵn Form bước 1. */
export async function GET() {
  await new Promise((r) => setTimeout(r, 250)); // mô phỏng độ trễ gọi hệ thống ngoài
  return NextResponse.json({ source: "MOCK - Danh mục Dự án lõi", projects: CORE_PROJECTS, investors: INVESTORS, regions: REGIONS });
}
