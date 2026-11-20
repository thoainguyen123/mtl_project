import assert from 'node:assert/strict';
const base=process.env.BASE||'http://localhost:5180';
async function call(body,user='u-admin') {
  const r=await fetch(base+'/api/pyc',{method:body?'POST':'GET',headers:{Cookie:`mtl_uid=${user}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json()};
}
const {data}=await call();
assert.ok(data.projects.length && data.versions.length);
const version=data.versions.find(v=>v.tasks.some(t=>t.start&&t.finish));
const project=data.projects.find(p=>p.id===version.projectId),task=version.tasks.find(t=>t.start&&t.finish);
let p={projectId:project.id,mtlId:version.id,number:`PYC-TEST-${Date.now()}`,type:'Có trong MTL',legalEntity:'Demo',phase:'A',location:'Demo',requester:'Test',department:'PMD',requestedDate:'2026-11-20',subject:'Kiểm tra tích hợp PYC',items:[{id:'item-1',taskId:task.id,product:'SP',description:task.name,specification:'Test',quantity:1.5,unit:'Gói',start:task.start,finish:task.finish}]};
async function mutate(action,extra={},expected=200){const r=await call({...p,action,...extra});assert.equal(r.status,expected,JSON.stringify(r.data));if(r.data.pyc)p=r.data.pyc;return r;}
await mutate('save',{},201);
assert.equal((await call({...p,id:undefined,action:'save'})).status,400,'duplicate number');
assert.equal((await call({...p,revision:0,action:'save'})).status,409,'stale revision');
assert.equal((await call({...p,action:'save'},'u-view')).status,403,'viewer cannot write');
assert.equal((await call(undefined,'u-view')).data.pycs.length,0,'scope filters viewer');
await mutate('gtps',{gtps:{explanation:'Giải trình thử',vendor:'Demo'}});
await mutate('save',{subject:'PYC thay đổi'});
await mutate('advance',{note:'OK',evidence:'https://example.com/evidence'},400);
await mutate('gtps',{gtps:{explanation:'Đồng bộ lại',vendor:'Demo'}});
await mutate('advance',{note:'OK',evidence:'javascript:alert(1)'},400);
for(let i=0;i<6;i++)await mutate('advance',{note:`Xác nhận ${i+1}`,evidence:`https://example.com/evidence/${i+1}`});
assert.equal(p.status,'ready');
await mutate('save',{},400);
const approval={reference:'EA-TEST',date:'2026-11-20',url:'https://example.com/eapproval'};
await mutate('submit',{approval});
await mutate('approve',{approval});
assert.equal(p.status,'approved');
await mutate('return',{note:'Test'},400);
assert.equal((await call()).data.pycs.find(x=>x.id===p.id).status,'approved');
console.log('PASS: create, duplicate, conflict, scope, GTPS sync, evidence, 6 steps, submit/approve and lock');
