import { NextResponse } from "next/server";
import { drained } from "@/lib/drain";
import { getDb, saveDb, audit } from "@/lib/store/db";
import { requirePerm } from "@/lib/auth";
import { ALL_PERMISSIONS, type Permission, type Role, type RoleMatrix } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  return NextResponse.json({ users: db.users, roleMatrix: db.roleMatrix, permissions: ALL_PERMISSIONS, audit: db.auditLog.slice(0, 30) });
}

/** Cập nhật ma trận phân quyền. Admin luôn giữ đủ quyền (không thể tự khóa mình). */
async function PUT_impl(req: Request) {
  const g = await requirePerm("users.manage");
  if ("error" in g) return g.error;
  const { roleMatrix } = (await req.json()) as { roleMatrix: RoleMatrix };
  const valid = new Set<string>(ALL_PERMISSIONS.map((p) => p.key));
  const db = getDb();
  for (const role of Object.keys(db.roleMatrix) as Role[]) {
    const list = (roleMatrix?.[role] ?? db.roleMatrix[role]).filter((p: Permission) => valid.has(p));
    db.roleMatrix[role] = role === "admin" ? ALL_PERMISSIONS.map((p) => p.key) : list;
  }
  audit(g.user.name, "rolematrix.update");
  saveDb();
  return NextResponse.json({ roleMatrix: db.roleMatrix });
}

export const PUT = drained(PUT_impl);
