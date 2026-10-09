// Kiểm thử end-to-end qua API (cần server đang chạy: npm run dev). Chạy: node scripts/e2e.mjs
const BASE = process.env.BASE ?? "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c, m, extra = "") => { if (c) { pass++; console.log("  ✔", m); } else { fail++; console.log("  ✖", m, extra); } };

const call = async (path, { user = "u-admin", method = "GET", json, body, raw } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { Cookie: `mtl_uid=${user}`, ...(json ? { "Content-Type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : body });
  if (raw) return res;
  const t = await res.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: res.status, d };
};

await call("/api/reset", { method: "POST" });

const params = {
  anchors: { name: "Dự án E2E", code: "E2E", investor: "Công ty A", type: "high_rise", region: "TP.HCM", t0: "2026-11-02", startConstruction: "2028-06-01", openSale: "2030-06-01", handover: "2032-12-31", closeOut: "2033-12-31" },
  high: { towers: 3, basements: 2, floors: 28, gfa: 90000, pool: true, landHa: 1.4 },
  hangMuc: ["htkt", "coc", "tien_ich", "canh_quan"],
};

console.log("\n[1] Form khởi tạo: validate + tạo");
let r = await call("/api/projects", { method: "POST", json: { ...params, anchors: { ...params.anchors, code: "", name: "", handover: "2020-01-01" }, high: { ...params.high, towers: 11, floors: 3 } } });
ok(r.s === 422 && r.d.errors.length >= 5, "dữ liệu sai bị chặn 422 với danh sách lỗi theo trường", JSON.stringify(r.d).slice(0, 200));
ok(r.d.errors?.some((e) => e.field === "towers") && r.d.errors?.some((e) => e.field === "floors"), "báo đúng lỗi số tháp (1-10) và số tầng (5-50)");
r = await call("/api/projects", { method: "POST", json: { ...params, anchors: { ...params.anchors, code: "AQC" } } });
ok(r.s === 422 && r.d.errors.some((e) => /đã tồn tại/.test(e.message)), "mã dự án trùng bị chặn");
r = await call("/api/projects", { method: "POST", user: "u-view", json: params });
ok(r.s === 403, "vai trò View không được tạo MTL (403)");
r = await call("/api/projects", { method: "POST", json: params });
ok(r.s === 201 && r.d.report.included > 300, `tạo thành công, sinh ${r.d.report?.included} dòng`);
const pid = r.d.project.id, vid = r.d.versionId;
ok(r.d.report.duplications.some((x) => /3 tháp/.test(x.rule)), "báo cáo ghi nhận nhân bản 3 tháp");

console.log("\n[2] Workspace: sửa công việc + tính lại lịch");
r = await call(`/api/versions/${vid}`);
const v = r.d.version;
ok(r.d.perms.edit === true, "Admin có quyền sửa bản thảo");
const than = v.tasks.find((t) => t.templateCode === "13.8.1.2" && t.copyLabel === "Tháp A");
ok(than.durationDays === 28 * 6, `thân Tháp A = 28 tầng × 6 ngày = ${than.durationDays}`);
const finish0 = v.generation.projectFinish;
r = await call(`/api/versions/${vid}/tasks/${encodeURIComponent(than.id)}`, { method: "PATCH", json: { durationDays: than.durationDays + 60 } });
ok(r.s === 200 && r.d.tasks, "sửa thời lượng +60 ngày → trả về lịch đã tính lại");
const than2 = r.d.tasks.find((t) => t.id === than.id);
ok(than2.finish > than.finish, `ngày kết thúc dời: ${than.finish} → ${than2.finish}`);
r = await call(`/api/versions/${vid}/tasks/${encodeURIComponent(than.id)}`, { method: "PATCH", json: { durationDays: 0 } });
ok(r.s === 422, "thời lượng không hợp lệ bị chặn");
const leaf = v.tasks.find((t) => t.kind === "task" && t.ban === "MAR");
r = await call(`/api/versions/${vid}/tasks/${encodeURIComponent(leaf.id)}`, { method: "PATCH", json: { status: "closed", assigneeTitle: "Chuyên viên MAR (Marketing)" } });
ok(r.s === 200 && r.d.task.status === "closed" && r.d.task.assigneeTitle.startsWith("Chuyên viên MAR"), "bật/tắt trạng thái Đóng + gán chức danh");
r = await call(`/api/versions/${vid}/tasks/${encodeURIComponent(leaf.id)}`, { method: "PATCH", user: "u-view", json: { status: "done" } });
ok(r.s === 403, "View không sửa được công việc (403)");
r = await call(`/api/versions/${vid}/tasks/${encodeURIComponent(leaf.id)}`, { method: "PATCH", user: "u-pm", json: { status: "done" } });
ok(r.s === 403, "Quản trị dự án ngoài phạm vi bị chặn (403)");

console.log("\n[3] Trình E-Approval + phê duyệt");
r = await call(`/api/versions/${vid}/action`, { method: "POST", user: "u-view", json: { action: "submit" } });
ok(r.s === 403, "View không được trình");
r = await call(`/api/versions/${vid}/action`, { method: "POST", json: { action: "approve" } });
ok(r.s === 409, "chưa trình thì không phê duyệt được");
r = await call(`/api/versions/${vid}/action`, { method: "POST", json: { action: "submit", force: true } });
ok(r.s === 200 && r.d.approval.ticket.startsWith("EA-"), `trình thành công, mã ${r.d.approval?.ticket}`);
r = await call(`/api/versions/${vid}/tasks/${encodeURIComponent(leaf.id)}`, { method: "PATCH", json: { status: "in_progress" } });
ok(r.s === 409, "đã trình thì bản thảo bị khóa (409)");
r = await call(`/api/versions/${vid}/action`, { method: "POST", user: "u-pm", json: { action: "approve" } });
ok(r.s === 403, "Quản trị dự án không có quyền phê duyệt");
r = await call(`/api/versions/${vid}/action`, { method: "POST", json: { action: "approve" } });
ok(r.s === 200 && r.d.status === "approved" && r.d.label === "Baseline v1.0", "BOD phê duyệt → Baseline v1.0");

console.log("\n[4] Tracking: % + minh chứng + comment");
const t1 = v.tasks.find((t) => t.kind === "task" && t.status !== "closed" && t.ban === "PCD");
const tk = `/api/tracking/${vid}/${encodeURIComponent(t1.id)}`;
r = await call(tk, { method: "POST", json: { percent: 40, issue: "Chờ vật tư" } });
ok(r.s === 200 && r.d.tracking.percent === 40, "cập nhật 40% kèm vướng mắc");
r = await call(tk, { method: "POST", json: { percent: 100 } });
ok(r.s === 422 && /minh chứng/.test(r.d.error), "100% mà chưa có minh chứng bị chặn");
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
let fd = new FormData(); fd.append("file", new File([png], "hien-truong.png", { type: "image/png" }));
r = await call(`${tk}/evidence`, { method: "POST", body: fd });
ok(r.s === 201 && r.d.evidence.url.startsWith("/api/files/"), "upload minh chứng ảnh");
const fres = await call(r.d.evidence.url, { raw: true });
ok(fres.status === 200 && fres.headers.get("content-type") === "image/png", "tải lại được minh chứng");
fd = new FormData(); fd.append("file", new File(["MZ"], "virus.exe", { type: "application/x-msdownload" }));
r = await call(`${tk}/evidence`, { method: "POST", body: fd });
ok(r.s === 415, "định dạng không cho phép bị chặn (415)");
r = await call(tk, { method: "POST", json: { percent: 100, quality: 4 } });
ok(r.s === 200 && r.d.status === "done" && r.d.tracking.quality === 4 && r.d.tracking.doneAt, "có minh chứng → hoàn thành 100%, ghi ngày xong + chất lượng");
r = await call(`${tk}/comments`, { method: "POST", user: "u-view", json: { text: "Đã kiểm tra hiện trường, đạt." } });
ok(r.s === 200 && r.d.comment.role === "viewer", "View vẫn bình luận được");
r = await call(`${tk}/comments`, { method: "POST", json: { text: "   " } });
ok(r.s === 422, "bình luận rỗng bị chặn");
r = await call(tk, { method: "POST", user: "u-view", json: { percent: 10 } });
ok(r.s === 403, "View không cập nhật % được");

console.log("\n[5] REV mới + xuất file");
r = await call(`/api/versions/${vid}/action`, { method: "POST", json: { action: "new_rev" } });
ok(r.s === 200 && r.d.versionId, "tạo REV 01 từ bản đã duyệt");
const rv = await call(`/api/versions/${r.d.versionId}`);
ok(rv.d.version.status === "draft" && rv.d.version.label.startsWith("REV 01"), "REV mới ở trạng thái bản thảo");
ok(rv.d.tracking.some((x) => x.percent === 100), "% tiến độ được kế thừa sang REV");
const xml = await call(`/api/versions/${vid}/export?format=xml`, { raw: true });
const xmlText = await xml.text();
ok(xml.status === 200 && xmlText.includes("<Project xmlns=") && xmlText.includes("<PredecessorLink>"), "xuất MS Project XML (có liên kết tiền nhiệm)");
(await import("node:fs")).writeFileSync(".data/e2e.xml", xmlText);
const xl = await call(`/api/versions/${vid}/export?format=xlsx`, { raw: true });
const buf = Buffer.from(await xl.arrayBuffer());
ok(xl.status === 200 && buf.slice(0, 2).toString() === "PK", `xuất Excel hợp lệ (${Math.round(buf.length / 1024)} KB)`);
(await import("node:fs")).writeFileSync(".data/e2e.xlsx", buf);
r = await call(`/api/versions/${vid}/export?format=xml`, { user: "u-view", raw: true });
ok(r.status === 200, "View được xuất dữ liệu (theo ma trận quyền)");

console.log("\n[6] Template / định mức / cấu hình / phân quyền");
r = await call("/api/template", { method: "PATCH", user: "u-pm", json: { code: "13.8.1.1", baseHigh: 400 } });
ok(r.s === 403, "Quản trị dự án không sửa được template");
r = await call("/api/template", { method: "PATCH", json: { code: "13.8.1.1", baseHigh: 9999 } });
ok(r.s === 422, "định mức ngoài giới hạn bị chặn");
r = await call("/api/config", { method: "PUT", json: { daysPerFloor: 8 } });
ok(r.s === 200 && r.d.config.daysPerFloor === 8, "đổi định mức ngày/sàn = 8");
const pid2 = (await call("/api/projects", { method: "POST", json: { ...params, anchors: { ...params.anchors, code: "E2F" } } })).d;
const thanNew = (await call(`/api/versions/${pid2.versionId}`)).d.version.tasks.find((t) => t.templateCode === "13.8.1.2");
ok(thanNew.durationDays === 28 * 8, `MTL mới dùng định mức mới: 28 × 8 = ${thanNew.durationDays}`);
r = await call("/api/config", { method: "PUT", json: { daysPerFloor: 6, workWeek: 7 } });
ok(r.s === 422, "tuần làm việc không hợp lệ bị chặn");
await call("/api/config", { method: "PUT", json: { daysPerFloor: 6 } });
r = await call("/api/users", { method: "PUT", user: "u-region", json: { roleMatrix: {} } });
ok(r.s === 403, "Quản trị vùng không sửa được ma trận quyền");
const lst = await call("/api/projects", { user: "u-region" });
ok(lst.d.projects.find((p) => p.params.anchors.code === "AQC").canEdit === false, "Quản trị vùng TP.HCM không sửa dự án vùng Đồng Nai");


console.log("\n[7] Thông tin dự án / Nhiệm vụ thiết kế / FS thực thi");
const lp = (await call("/api/projects")).d.projects;
const gmh = lp.find((p) => p.params.anchors.code === "GMH");
r = await call(`/api/projects/${gmh.id}`, { method: "PATCH", user: "u-view", json: { info: { pm: "x" } } });
ok(r.s === 403, "Viewer không sửa được thông tin dự án");
r = await call(`/api/projects/${gmh.id}`, { method: "PATCH", user: "u-pm", json: { info: { pm: "Trần Thị Lan", address: "Q.Bình Thạnh" } } });
ok(r.s === 200 && r.d.project.info.pm === "Trần Thị Lan", "PM sửa hồ sơ bổ sung dự án trong phạm vi");
r = await call(`/api/projects/${gmh.id}`, { method: "PATCH", json: { anchors: { handover: "2020-01-01" } } });
ok(r.s === 422, "mốc Bàn giao sai thứ tự bị chặn");
const nwp = lp.find((p) => p.params.anchors.code === "NWP");
r = await call(`/api/projects/${nwp.id}`, { method: "PATCH", user: "u-pm", json: { info: { pm: "x" } } });
ok(r.s === 403, "PM không sửa dự án ngoài phạm vi");
r = await call(`/api/projects/${gmh.id}`, { method: "PATCH", json: { anchors: { code: "ZZZ", type: "low_rise" } } });
ok(r.s === 200 && r.d.project.params.anchors.code === "GMH" && r.d.project.params.anchors.type === "high_rise", "mã & loại hình không đổi được");

r = await call("/api/design-briefs", { method: "POST", user: "u-view", json: { projectId: gmh.id } });
ok(r.s === 403, "Viewer không khởi tạo nhiệm vụ thiết kế");
r = await call("/api/design-briefs", { method: "POST", user: "u-pm", json: { projectId: gmh.id } });
ok(r.s === 201 && r.d.briefs.length === 6, `cao tầng sinh ${r.d.briefs?.length} nhiệm vụ (kiến trúc, cơ điện, kết cấu, cảnh quan, nội thất, khác)`);
r = await call("/api/design-briefs", { method: "POST", user: "u-pm", json: { projectId: gmh.id } });
ok(r.s === 409, "không khởi tạo trùng");
const bid = (await call(`/api/design-briefs?projectId=${gmh.id}`)).d.briefs.find((b) => b.branch === "12.3").id;
r = await call(`/api/design-briefs/${bid}`, { method: "PATCH", user: "u-pm", json: { action: "issue" } });
ok(r.s === 422, "chưa chọn tư vấn thì không ban hành được");
r = await call(`/api/design-briefs/${bid}`, { method: "PATCH", user: "u-pm", json: { consultant: "Công ty TV Kiến trúc A" } });
r = await call(`/api/design-briefs/${bid}`, { method: "PATCH", user: "u-pm", json: { action: "issue" } });
ok(r.s === 200 && r.d.brief.status === "issued", "ban hành nhiệm vụ cho DMD");
r = await call(`/api/design-briefs/${bid}`, { method: "PATCH", user: "u-pm", json: { scope: "sửa" } });
ok(r.s === 409, "đã ban hành thì không sửa nội dung");
r = await call(`/api/design-briefs/${bid}`, { method: "PATCH", user: "u-pm", json: { action: "confirm" } });
ok(r.s === 200 && r.d.brief.status === "confirmed", "DMD xác nhận");

r = await call("/api/fs", { method: "POST", user: "u-view", json: { projectId: gmh.id } });
ok(r.s === 403, "Viewer không lập FS");
r = await call("/api/fs", { method: "POST", user: "u-pm", json: { projectId: gmh.id } });
ok(r.s === 201 && r.d.version.label === "FS-Ver2.1", "lập FS-Ver2.1");
const fid = r.d.version.id;
r = await call("/api/fs", { method: "POST", user: "u-pm", json: { projectId: gmh.id } });
ok(r.s === 409, "chỉ 1 bản nháp tại một thời điểm");
r = await call(`/api/fs/${fid}`, { method: "PATCH", user: "u-pm", json: { rates: { build: -5 } } });
ok(r.s === 422, "suất đầu tư âm bị chặn");
const before = (await call(`/api/fs?projectId=${gmh.id}`)).d.versions[0].calc.total;
r = await call(`/api/fs/${fid}`, { method: "PATCH", user: "u-pm", json: { rates: { build: 12 } } });
const after = (await call(`/api/fs?projectId=${gmh.id}`)).d.versions[0].calc.total;
ok(r.s === 200 && after > before, `đổi suất xây lắp làm tổng tăng: ${before} -> ${after} triệu đồng`);
const calc = (await call(`/api/fs?projectId=${gmh.id}`)).d.versions[0].calc;
ok(Math.abs(calc.monthTotals.reduce((a, b) => a + b, 0) - calc.total) <= calc.lines.length * 60, "tổng phân bổ theo tháng khớp tổng mức đầu tư");
r = await call(`/api/fs/${fid}`, { method: "PATCH", user: "u-pm", json: { action: "approve" } });
ok(r.s === 403, "PM không có quyền chốt FS");
r = await call(`/api/fs/${fid}`, { method: "PATCH", json: { action: "send_fpa" } });
ok(r.s === 409, "chưa chốt thì không chuyển FPA");
r = await call(`/api/fs/${fid}`, { method: "PATCH", json: { action: "approve" } });
ok(r.s === 200 && r.d.version.status === "approved", "Admin chốt FS");
r = await call(`/api/fs/${fid}`, { method: "PATCH", json: { action: "send_fpa" } });
ok(r.s === 200 && r.d.version.sentFpaAt, "chuyển FPA (Capex)");
r = await call(`/api/fs/${fid}`, { method: "PATCH", user: "u-pm", json: { rates: { build: 9 } } });
ok(r.s === 409, "FS đã chốt không sửa được");
r = await call("/api/fs", { method: "POST", user: "u-pm", json: { projectId: gmh.id } });
ok(r.s === 201 && r.d.version.label === "FS-Ver2.2" && r.d.version.rates.build === 12, "FS-Ver2.2 kế thừa suất từ bản trước");



console.log("\n[8] Thẩm định");
const lp2 = (await call("/api/projects")).d.projects.find((p) => p.params.anchors.code === "GMH");
r = await call(`/api/versions/${lp2.current.id}/review`, { method: "POST", user: "u-pm", json: { result: "passed" } });
ok(r.s === 403, "PM không có quyền thẩm định");
r = await call(`/api/versions/${lp2.current.id}/review`, { method: "POST", json: { result: "changes" } });
ok(r.s === 422, "yêu cầu chỉnh sửa phải có ý kiến");
r = await call(`/api/versions/${lp2.current.id}/review`, { method: "POST", json: { result: "changes", note: "Rà lại mốc mở bán" } });
ok(r.s === 200 && r.d.review.result === "changes", "yêu cầu chỉnh sửa kèm ý kiến");
r = await call(`/api/versions/${lp2.current.id}/review`, { method: "POST", json: { result: "passed" } });
ok(r.s === 200 || r.s === 422, "thẩm định đạt (hoặc bị chặn nếu còn xung đột)");


console.log(`\nKẾT QUẢ: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
