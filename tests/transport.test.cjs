const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const base = 'http://127.0.0.1:5174';
let server, token;
before(async()=>{
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174'],{cwd:root,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Test server did not start')),15000);
    server.stdout.on('data',data=>{if(String(data).includes('127.0.0.1:5174')){clearTimeout(timer);resolve();}});
    server.on('error',reject);server.on('exit',code=>{if(code)reject(new Error(`Test server exited ${code}`));});
  });
  token=(await (await fetch(base+'/api/session')).json()).token;
});
after(()=>server?.kill('SIGTERM'));
async function rpc(args){const res=await fetch(base+'/api/pdf',{method:'POST',headers:{'Content-Type':'application/json','X-NavPDF-Token':token},body:JSON.stringify(args)});const data=await res.json();assert.equal(res.status,200,data.error);return data.result;}
test('serves the real editor and local engine',async()=>{assert.match(await (await fetch(base)).text(),/NavPDF/);const info=await rpc({op:'info'});assert.equal(info.count,3);const rendered=await rpc({op:'render',page:0,scale:.2});assert.match(rendered.image,/^data:image\/png;base64,/);});
test('rejects unauthenticated and cross-origin mutations',async()=>{const denied=await fetch(base+'/api/pdf',{method:'POST',body:JSON.stringify({op:'deletePage',page:0})});assert.equal(denied.status,403);const foreign=await fetch(base+'/api/pdf',{method:'POST',headers:{Origin:'https://outside.example','X-NavPDF-Token':token},body:JSON.stringify({op:'deletePage',page:0})});assert.equal(foreign.status,403);assert.equal((await rpc({op:'info'})).count,3);});
test('exports and reopens edited content through the transport',async()=>{await rpc({op:'text',page:0,rect:[50,675,350,710],text:'TRANSPORT ROUND TRIP',size:14});const output=await rpc({op:'export',password:'integration-test'});assert.ok(output.data.length>100);await rpc({op:'open',data:output.data,name:'round-trip.pdf',password:'integration-test'});assert.equal((await rpc({op:'search',query:'TRANSPORT ROUND TRIP'})).length,1);});
test('failed commands preserve the document and return a useful error',async()=>{const res=await fetch(base+'/api/pdf',{method:'POST',headers:{'X-NavPDF-Token':token},body:JSON.stringify({op:'reorder',order:[0]})});assert.equal(res.status,400);assert.match((await res.json()).error,/every page/);assert.equal((await rpc({op:'info'})).count,3);});
test('mutations are serialized with a reversible history',async()=>{await rpc({op:'addPage',after:0});assert.equal((await rpc({op:'info'})).count,4);await rpc({op:'undo'});assert.equal((await rpc({op:'info'})).count,3);await rpc({op:'redo'});assert.equal((await rpc({op:'info'})).count,4);});
