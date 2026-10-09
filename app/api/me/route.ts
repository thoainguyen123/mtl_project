import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { getDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const user = await currentUser();
  return NextResponse.json({ user, permissions: db.roleMatrix[user.role], users: db.users });
}

/** Demo: đổi người dùng đang đăng nhập để thử phân quyền */
async function POST_impl(req: Request) {
  const { userId } = (await req.json()) as { userId: string };
  if (!getDb().users.some((u) => u.id === userId)) return NextResponse.json({ error: "Không có người dùng" }, { status: 404 });
  (await cookies()).set("mtl_uid", userId, { path: "/", httpOnly: false, sameSite: "lax" });
  return NextResponse.json({ ok: true });
}

export const POST = drained(POST_impl);
