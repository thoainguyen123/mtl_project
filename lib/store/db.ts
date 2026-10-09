// Kho dữ liệu DEMO: giữ trong bộ nhớ, ghi ra .data/db.json để không mất khi reload.
// KHÔNG phải thiết kế database chuẩn — bản thật cần PostgreSQL + migration.
import fs from "node:fs";
import path from "node:path";
import type { Db, MtlVersion, Project } from "@/lib/types";
import { buildSeed, ROLE_MATRIX } from "@/lib/seed";

const DIR = (() => { try { return path.join(process.cwd(), ".data"); } catch { return "/tmp/.data"; } })();
const FILE = path.join(DIR, "db.json");
const g = globalThis as unknown as { __mtlDb?: Db };
/** Cloudflare Workers: không có ổ đĩa bền vững — dữ liệu demo chỉ giữ trong bộ nhớ của Worker */
export const ON_WORKERS = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

export function getDb(): Db {
  if (g.__mtlDb) return g.__mtlDb;
  try {
    if (!ON_WORKERS && fs.existsSync(FILE)) {
      g.__mtlDb = migrate(JSON.parse(fs.readFileSync(FILE, "utf8")) as Db);
      return g.__mtlDb;
    }
  } catch {
    /* file hỏng -> seed lại */
  }
  g.__mtlDb = buildSeed();
  saveDb();
  return g.__mtlDb;
}

/** Bổ sung trường/quyền mới cho file dữ liệu tạo bởi phiên bản cũ */
function migrate(db: Db): Db {
  db.designBriefs ??= [];
  db.fsVersions ??= [];
  for (const role of Object.keys(ROLE_MATRIX) as (keyof typeof ROLE_MATRIX)[]) {
    for (const perm of ROLE_MATRIX[role]) {
      const isNew = ["design.edit", "fs.edit", "fs.approve"].includes(perm);
      if (isNew && !db.roleMatrix[role].includes(perm) && !db.roleMatrix.admin.includes(perm)) db.roleMatrix[role].push(perm);
    }
  }
  for (const perm of ["design.edit", "fs.edit", "fs.approve"] as const) if (!db.roleMatrix.admin.includes(perm)) db.roleMatrix.admin.push(perm);
  return db;
}

export function saveDb() {
  if (!g.__mtlDb || ON_WORKERS) return;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(g.__mtlDb));
  } catch { /* Cloudflare Workers không có ổ đĩa: dữ liệu demo chỉ giữ trong bộ nhớ */ }
}

export function resetDb(): Db {
  g.__mtlDb = buildSeed();
  saveDb();
  return g.__mtlDb;
}

export function audit(by: string, action: string, detail?: string) {
  const db = getDb();
  db.auditLog.unshift({ at: new Date().toISOString(), by, action, detail });
  db.auditLog.length = Math.min(db.auditLog.length, 200);
}

export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
export const uploadsDir = () => path.join(DIR, "uploads");

/** Bản dùng để THEO DÕI / báo cáo: phiên bản đã duyệt gần nhất, nếu chưa có thì phiên bản hiện hành */
export function baselineOf(db: Db, p: Project): MtlVersion {
  const approved = db.versions.filter((v) => v.projectId === p.id && v.status === "approved").sort((a, b) => (a.approval?.approvedAt ?? "") < (b.approval?.approvedAt ?? "") ? 1 : -1);
  return approved[0] ?? db.versions.find((v) => v.id === p.currentVersionId)!;
}
