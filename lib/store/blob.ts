// Lưu tệp minh chứng DEMO: ghi ra .data/uploads khi chạy trên máy; nếu môi trường không có ổ đĩa ghi được
// (Cloudflare Workers) thì giữ trong bộ nhớ của tiến trình — mất khi Worker khởi động lại.
import fs from "node:fs";
import path from "node:path";
import { ON_WORKERS, uploadsDir } from "@/lib/store/db";

const mem = new Map<string, Uint8Array>();

export function putBlob(id: string, safeName: string, bytes: Uint8Array) {
  mem.set(id, bytes);
  if (ON_WORKERS) return;
  try {
    fs.mkdirSync(uploadsDir(), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir(), `${id}__${safeName}`), bytes);
  } catch { /* không có ổ đĩa: chỉ dùng bộ nhớ */ }
}

export function getBlob(id: string): Uint8Array | null {
  const hit = mem.get(id);
  if (hit || ON_WORKERS) return hit ?? null;
  try {
    const dir = uploadsDir();
    const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(id + "__")) : undefined;
    return name ? new Uint8Array(fs.readFileSync(path.join(dir, name))) : null;
  } catch { return null; }
}
