// Lịch làm việc: tính toán ngày theo ngày làm việc (trừ CN [+ T7] + ngày lễ).
// Ngày luôn ở dạng ISO "yyyy-mm-dd", tính bằng UTC để không lệch múi giờ.
// Cài đặt O(1): dựng sẵn bảng chỉ số ngày làm việc cho 2000-2080 nên tính toán
// hàng nghìn công việc chỉ mất vài mili-giây.

export type Iso = string;

const DAY = 86400000;

export function toDate(iso: Iso): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function toIso(d: Date): Iso {
  return d.toISOString().slice(0, 10);
}
export function addCalendarDays(iso: Iso, n: number): Iso {
  return toIso(new Date(toDate(iso).getTime() + n * DAY));
}
export function diffCalendarDays(a: Iso, b: Iso): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}
export function cmp(a: Iso, b: Iso): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function maxIso(...xs: Iso[]): Iso {
  return xs.reduce((a, b) => (a >= b ? a : b));
}
export function minIso(...xs: Iso[]): Iso {
  return xs.reduce((a, b) => (a <= b ? a : b));
}

export interface CalendarCfg {
  workWeek: 5 | 6; // 5 = T2-T6, 6 = T2-T7
  holidays: Iso[];
}

const EPOCH = Date.UTC(2000, 0, 1);
const SPAN = 365 * 81; // 2000..2080

interface Tables {
  work: Uint8Array;
  ord: Int32Array; // số ngày làm việc <= ngày d (đếm từ 1)
  days: Int32Array; // danh sách chỉ số ngày làm việc
}
const cache = new Map<string, Tables>();

function tables(cfg: CalendarCfg): Tables {
  const key = `${cfg.workWeek}|${[...cfg.holidays].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const hol = new Set(cfg.holidays);
  const work = new Uint8Array(SPAN);
  const ord = new Int32Array(SPAN);
  const list: number[] = [];
  let c = 0;
  for (let i = 0; i < SPAN; i++) {
    const dt = new Date(EPOCH + i * DAY);
    const wd = dt.getUTCDay();
    const isW = !(wd === 0 || (wd === 6 && cfg.workWeek === 5) || hol.has(dt.toISOString().slice(0, 10)));
    work[i] = isW ? 1 : 0;
    if (isW) {
      list.push(i);
      c++;
    }
    ord[i] = c;
  }
  const t = { work, ord, days: Int32Array.from(list) };
  cache.set(key, t);
  return t;
}

const num = (iso: Iso) => Math.round((toDate(iso).getTime() - EPOCH) / DAY);
const iso = (n: number): Iso => toIso(new Date(EPOCH + n * DAY));

export class WorkCalendar {
  private t: Tables;
  constructor(cfg: CalendarCfg) {
    this.t = tables(cfg);
  }
  private clampN(n: number) {
    return Math.min(SPAN - 1, Math.max(0, n));
  }
  isWork(d: Iso): boolean {
    return this.t.work[this.clampN(num(d))] === 1;
  }
  /** Ngày làm việc đầu tiên >= d */
  nextWork(d: Iso): Iso {
    const n = this.clampN(num(d));
    if (this.t.work[n]) return iso(n);
    return iso(this.t.days[Math.min(this.t.ord[n], this.t.days.length - 1)]);
  }
  /** Ngày làm việc gần nhất <= d */
  prevWork(d: Iso): Iso {
    const n = this.clampN(num(d));
    if (this.t.work[n]) return iso(n);
    return iso(this.t.days[Math.max(0, this.t.ord[n] - 1)]);
  }
  /** Dịch n ngày làm việc (n có thể âm) kể từ một ngày làm việc */
  shift(d: Iso, n: number): Iso {
    const nn = num(this.nextWork(d));
    const idx = this.t.ord[this.clampN(nn)] - 1;
    const tgt = Math.min(this.t.days.length - 1, Math.max(0, idx + n));
    return iso(this.t.days[tgt]);
  }
  /** Ngày kết thúc của công việc bắt đầu tại start, kéo dài dur ngày làm việc (dur 0/1 = trong ngày) */
  finishOf(start: Iso, dur: number): Iso {
    const s = this.nextWork(start);
    return dur <= 1 ? s : this.shift(s, dur - 1);
  }
  /** Ngày bắt đầu của công việc kết thúc tại finish, kéo dài dur ngày làm việc */
  startOf(finish: Iso, dur: number): Iso {
    const f = this.prevWork(finish);
    return dur <= 1 ? f : this.shift(f, -(dur - 1));
  }
  /** Số ngày làm việc giữa a và b (a <= b), tính cả hai đầu */
  count(a: Iso, b: Iso): number {
    if (cmp(a, b) > 0) return 0;
    const na = this.clampN(num(a));
    const nb = this.clampN(num(b));
    return this.t.ord[nb] - (na > 0 ? this.t.ord[na - 1] : 0);
  }
  /** Số ngày làm việc cần dịch từ a để tới b (có dấu) */
  signedDiff(a: Iso, b: Iso): number {
    if (cmp(a, b) === 0) return 0;
    return cmp(a, b) < 0 ? this.count(a, b) - 1 : -(this.count(b, a) - 1);
  }
}

/** Ngày lễ VN mặc định dùng cho demo (cần HR xác nhận lịch chính thức) */
export const DEFAULT_HOLIDAYS: Iso[] = [
  "2026-09-02", "2027-01-01",
  "2027-02-05", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12",
  "2027-04-16", "2027-04-30", "2027-05-03", "2027-09-02",
];
