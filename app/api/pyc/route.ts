import { NextResponse } from 'next/server';
import { currentUser, inScope, can } from '@/lib/auth';
import { audit, getDb, saveDb, ON_WORKERS } from '@/lib/store/db';
import { drained } from '@/lib/drain';
import { advancePyc, canEditPyc, safeHttps, validatePyc, type Pyc, type PycItem } from '@/lib/pyc';
export const dynamic='force-dynamic';

export async function GET() {
  const db=getDb(), user=await currentUser();
  const projects=db.projects.filter(p=>inScope(user,p));
  const ids=new Set(projects.map(p=>p.id));
  return NextResponse.json({projects:projects.map(p=>({id:p.id,name:p.params.anchors.name,code:p.params.anchors.code,legalEntity:p.params.anchors.investor,location:p.info?.address||''})),
    versions:db.versions.filter(v=>ids.has(v.projectId)).map(v=>({id:v.id,projectId:v.projectId,label:v.label,tasks:v.tasks.filter(t=>t.kind!=='summary').map(t=>({id:t.id,name:t.name,wbs:t.wbs,start:t.start,finish:t.finish}))})),
    pycs:(db.pycs??[]).filter(p=>ids.has(p.projectId)),canEdit:can(user,'project.edit'),canRecordApproval:can(user,'mtl.approve'),storage:ON_WORKERS?'Dữ liệu demo có thể mất khi Worker khởi động lại.':'Dữ liệu demo lưu cùng dự án.'});
}
const str=(v:unknown,max=4000)=>typeof v==='string'?v.trim().slice(0,max):'';
async function write(req:Request) {
 try {
  const body=await req.json(); const db=getDb(), user=await currentUser();
  db.pycs??=[];
  const old=db.pycs.find(p=>p.id===body.id);
  const project=db.projects.find(p=>p.id===(old?.projectId??body.projectId));
  if(!project) return NextResponse.json({error:'Không tìm thấy dự án.'},{status:404});
  if(!inScope(user,project)||!can(user,'project.edit')) return NextResponse.json({error:'Không đủ quyền hoặc dự án ngoài phạm vi.'},{status:403});
  if(body.id && !old) return NextResponse.json({error:'Không tìm thấy PYC.'},{status:404});
  if(old && body.revision!==old.revision) return NextResponse.json({error:'Phiếu đã thay đổi. Tải lại trước khi lưu.'},{status:409});
  const at=new Date().toISOString(); let p:Pyc; let action='';
  if(body.action==='save') {
    if(old&&!canEditPyc(old)) throw Error('Phiếu đang xử lý hoặc đã khóa. Trả bổ sung trước khi sửa.');
    const mtlId=str(body.mtlId,150);
    const version=db.versions.find(v=>v.id===mtlId&&v.projectId===project.id);
    if(!version) throw Error('Chọn MTL thuộc đúng dự án.');
    if(!Array.isArray(body.items)||body.items.length>100) throw Error('Danh sách HH-DV không hợp lệ.');
    const items:PycItem[]=body.items.map((i:Record<string,unknown>)=>({id:str(i.id,150)||crypto.randomUUID(),taskId:str(i.taskId,150),product:str(i.product),description:str(i.description),specification:str(i.specification),quantity:Number(i.quantity),unit:str(i.unit,100),start:str(i.start,10),finish:str(i.finish,10)}));
    if(items.some(i=>i.taskId&&!version.tasks.some(t=>t.id===i.taskId&&t.kind!=='summary'))) throw Error('Công việc không thuộc MTL đã chọn.');
    p={id:old?.id??crypto.randomUUID(),number:str(body.number,100),projectId:project.id,mtlId,type:body.type,legalEntity:str(body.legalEntity),phase:str(body.phase),location:str(body.location),requester:str(body.requester),department:str(body.department),requestedDate:str(body.requestedDate,10),subject:str(body.subject),items,revision:(old?.revision??0)+1,status:'draft',steps:[],history:old?.history??[],gtps:old?.gtps};
    const errors=validatePyc(p);if(errors.length) throw Error(errors[0]);
    if(db.pycs.some(x=>x.id!==p.id&&x.number.toLowerCase()===p.number.toLowerCase())) throw Error('Số PYC đã tồn tại.');
    if(!project.params.anchors.investor.trim()&&!p.legalEntity) throw Error('Dự án thiếu pháp nhân; cần bổ sung thông tin.');
    action=old?'Cập nhật PYC; đặt lại kết quả phối hợp':'Tạo PYC';
  } else {
    if(!old) throw Error('Lưu PYC trước.');
    p=structuredClone(old);
    if(body.action==='gtps') {
      if(!canEditPyc(p)) throw Error('Chỉ cập nhật GTPS khi phiếu được chỉnh sửa.');
      const d=body.gtps??{};
      if(!str(d.explanation)) throw Error('Nhập nội dung giải trình.');
      p.gtps={id:p.gtps?.id??crypto.randomUUID(),pycId:p.id,si:str(d.si),contract:str(d.contract),vendor:str(d.vendor),explanation:str(d.explanation),opinions:str(d.opinions),sourceRevision:p.revision+1};
      action='Lưu GTPS, xác nhận dữ liệu chung từ PYC';
    } else if(body.action==='advance') {
      p=advancePyc(p,str(body.note),str(body.evidence),user.name,at);action=`Ghi nhận bước ${p.steps.length} (khai báo demo)`;
    } else if(body.action==='return') {
      if(['approved','cancelled','draft'].includes(p.status)) throw Error('Không thể trả bổ sung ở trạng thái này.');
      if(!str(body.note)) throw Error('Nhập lý do bổ sung.');p.status='returned';p.steps=[];p.approval=undefined;action=`Yêu cầu bổ sung: ${str(body.note)}`;
    } else if(body.action==='submit'||body.action==='approve') {
      const approval=body.approval??{};
      if(body.action==='submit'&&p.status!=='ready') throw Error('Cần hoàn tất 6 bước phối hợp.');
      if(body.action==='approve'&&(p.status!=='submitted'||!can(user,'mtl.approve'))) return NextResponse.json({error:'Cần phiếu đã trình và quyền ghi nhận phê duyệt.'},{status:403});
      const date=str(approval.date);
      if(!str(approval.reference)||!safeHttps(str(approval.url))||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) throw Error('Nhập mã hồ sơ, ngày hợp lệ và link HTTPS E-Approval.');
      p.approval={reference:str(approval.reference),url:str(approval.url),date:str(approval.date,10)};p.status=body.action==='approve'?'approved':'submitted';action=body.action==='approve'?'Ghi nhận đã duyệt theo khai báo thủ công':'Ghi nhận đã trình theo khai báo thủ công';
    } else if(body.action==='cancel') {
      if(['approved','cancelled'].includes(p.status)) throw Error('Không thể hủy phiếu ở trạng thái này.');
      if(!str(body.note)) throw Error('Nhập lý do hủy.');p.status='cancelled';action=`Hủy: ${str(body.note)}`;
    } else throw Error('Thao tác không hợp lệ.');
    p.revision=old.revision+1;
    // Workflow revisions do not change shared PYC data or invalidate a synchronized GTPS.
    if(p.gtps&&old.gtps?.sourceRevision===old.revision&&body.action!=='gtps') p.gtps.sourceRevision=p.revision;
  }
  p.history=[...p.history,{at,by:user.name,action}];
  const index=db.pycs.findIndex(x=>x.id===p.id);if(index<0)db.pycs.unshift(p);else db.pycs[index]=p;
  audit(user.name,'pyc.'+body.action,`${p.number}: ${action}`);saveDb();
  return NextResponse.json({pyc:p},{status:old?200:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Yêu cầu không hợp lệ.'},{status:400});}
}
export const POST=drained(write);
