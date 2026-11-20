export const PYC_TYPES = ['Có trong MTL', 'Phát sinh mới', 'Giao thêm khối lượng', 'Thay thế nhà thầu/nhà cung cấp'] as const;
export const PYC_STEPS = ['PBCM · Chuẩn bị hồ sơ', 'QSBS · Lập BOQ', 'SPB · Cơ sở đơn giá', 'QSBS · Lập dự toán', 'FPA · Kiểm soát ngân sách', 'PBCM · Hoàn chỉnh PYC', 'E-Approval · Ghi nhận thủ công'] as const;
export const PYC_STATUS = { draft:'Bản nháp', coordinating:'Đang phối hợp', returned:'Cần bổ sung', ready:'Sẵn sàng trình', submitted:'Đã trình (khai báo)', approved:'Đã duyệt (khai báo)', cancelled:'Đã hủy' } as const;
export interface PycItem { id:string; taskId:string; product:string; description:string; specification:string; quantity:number; unit:string; start:string; finish:string }
export interface PycGtps { id:string; pycId:string; si:string; contract:string; vendor:string; explanation:string; opinions:string; sourceRevision:number }
export interface Pyc {
  id:string; number:string; projectId:string; mtlId:string; type:typeof PYC_TYPES[number];
  legalEntity:string; phase:string; location:string; requester:string; department:string; requestedDate:string; subject:string;
  items:PycItem[]; gtps?:PycGtps; revision:number; status:keyof typeof PYC_STATUS;
  steps:{note:string; evidence:string; by:string; at:string}[];
  approval?:{reference:string; url:string; date:string};
  history:{at:string; by:string; action:string}[];
}
export function validatePyc(p:Pyc, full=false):string[] {
  const errors:string[]=[];
  if (!PYC_TYPES.includes(p.type)) errors.push('Loại PYC không hợp lệ.');
  if (!p.number.trim() || !p.subject.trim()) errors.push('Nhập số PYC và nội dung yêu cầu.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.requestedDate) || Number.isNaN(Date.parse(p.requestedDate)) || new Date(p.requestedDate).toISOString().slice(0,10)!==p.requestedDate) errors.push('Ngày yêu cầu không hợp lệ.');
  if (full && (!p.legalEntity.trim() || !p.requester.trim() || !p.department.trim())) errors.push('Bổ sung pháp nhân, người yêu cầu và đơn vị.');
  if (!p.items.length || p.items.length>100) errors.push('PYC cần từ 1 đến 100 dòng HH-DV.');
  if (new Set(p.items.map(i=>i.id)).size!==p.items.length) errors.push('Mã dòng chi tiết bị trùng.');
  for (const [index,item] of p.items.entries()) {
    if (!item.description.trim() || !item.unit.trim() || !Number.isFinite(item.quantity) || item.quantity<=0) errors.push(`Dòng ${index+1}: nhập nội dung, đơn vị và số lượng lớn hơn 0.`);
    if (p.type===PYC_TYPES[0] && !item.taskId) errors.push(`Dòng ${index+1}: chọn công việc MTL.`);
    if (full && (!item.start || !item.finish)) errors.push(`Dòng ${index+1}: bổ sung tiến độ.`);
    if (item.start && item.finish && item.start>item.finish) errors.push(`Dòng ${index+1}: ngày kết thúc phải từ ngày bắt đầu.`);
    for(const date of [item.start,item.finish]) if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) errors.push(`Dòng ${index+1}: ngày không hợp lệ.`);
  }
  if(full && p.gtps && !p.gtps.explanation.trim()) errors.push('GTPS chưa có nội dung giải trình.');
  if(full && p.gtps && p.gtps.sourceRevision!==p.revision) errors.push('GTPS cần xác nhận lại sau khi PYC thay đổi.');
  return errors;
}
export function safeHttps(value:string):boolean { try {return new URL(value).protocol==='https:';}catch{return false;} }
export function canEditPyc(p:Pyc) {return p.status==='draft'||p.status==='returned';}
export function advancePyc(p:Pyc, note:string, evidence:string, by:string, at:string):Pyc {
  if(!['draft','returned','coordinating'].includes(p.status)) throw Error('Không thể chuyển bước ở trạng thái này.');
  const errors=validatePyc(p,true); if(errors.length) throw Error(errors[0]);
  if(!note.trim()||!safeHttps(evidence)) throw Error('Nhập kết quả và link HTTPS tới chứng cứ/email xác nhận.');
  if(p.steps.length>=6) throw Error('Đã hoàn tất phối hợp.');
  const steps=[...p.steps,{note,evidence,by,at}];
  return {...p,steps,status:steps.length===6?'ready':'coordinating'};
}
