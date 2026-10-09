// Xác thực DEMO: chọn người dùng qua cookie (không có mật khẩu). Chỉ để minh họa RoleMatrix.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Permission, Project, User } from "@/lib/types";
import { getDb } from "@/lib/store/db";

export async function currentUser(): Promise<User> {
  const db = getDb();
  const id = (await cookies()).get("mtl_uid")?.value;
  return db.users.find((u) => u.id === id) ?? db.users[0];
}

export function can(user: User, perm: Permission): boolean {
  return getDb().roleMatrix[user.role]?.includes(perm) ?? false;
}

/** Quyền theo phạm vi: Admin toàn hệ thống; Quản trị vùng theo vùng; Quản trị dự án theo danh sách gán */
export function inScope(user: User, project: Project): boolean {
  if (user.role === "admin") return true;
  if (user.role === "region_admin") return user.region === project.params.anchors.region;
  if (user.role === "project_admin") return !!user.projectIds?.includes(project.id);
  return false;
}

export function forbidden(perm: Permission | string) {
  return NextResponse.json({ error: `Không đủ quyền: ${perm}` }, { status: 403 });
}

export async function requirePerm(perm: Permission, project?: Project): Promise<{ user: User } | { error: NextResponse }> {
  const user = await currentUser();
  if (!can(user, perm)) return { error: forbidden(perm) };
  if (project && perm !== "tracking.comment" && !inScope(user, project)) {
    return { error: NextResponse.json({ error: "Dự án nằm ngoài phạm vi quản trị của bạn" }, { status: 403 }) };
  }
  return { user };
}
