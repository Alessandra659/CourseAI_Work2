import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {postgres,asUser,userA,userB} from './postgres.js';
import handler from '../api/index.js';
process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';process.env.APP_URL='https://example.ngrok-free.dev';
test('API verifies bearer sessions, forwards owner JWTs and stores chat+charts atomically',async()=>{
 const db=await postgres(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url);
  if(u.startsWith(process.env.SUPABASE_URL)){
   const token=opts.headers.Authorization;const owner=token==='Bearer user-a'?userA:token==='Bearer user-b'?userB:null;
   assert.equal(opts.headers.apikey,'sb_publishable_test');
   if(u.endsWith('/auth/v1/user'))return Response.json(owner?{id:owner,email:'test@example.com'}:{error:'bad token'},{status:owner?200:401});
   if(!owner)return Response.json({error:'unauthorized'},{status:401});
   const name=u.split('/').at(-1),args=JSON.parse(opts.body),entries=Object.entries(args);
   assert.ok(['budget_snapshot','budget_import','budget_save_chart','budget_delete_chart','budget_save_turn'].includes(name));
   const values=entries.map(([,v])=>typeof v==='object'?JSON.stringify(v):v);
   const sql=`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) result`;
   const result=await asUser(db,owner,tx=>tx.query(sql,values));return Response.json(result.rows[0].result);
  }
  if(u==='https://ollama.com/api/chat'){
   calls++;return Response.json({message:calls===1?{role:'assistant',content:'',tool_calls:[{function:{name:'crear_grafico',arguments:{kind:'proyectos'}}}]}:{role:'assistant',content:'Análisis de tus proyectos.'}});
  }
  return original(url,opts);
 };
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/index`;
 const request=async(action,method='GET',body,token='user-a')=>{const r=await original(base+'?action='+action,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await request('state','GET',undefined,'')).status,401);
  assert.equal((await request('state','GET',undefined,'forged')).status,401);
  const conf=await request('config','GET',undefined,'');assert.equal(conf.data.callbackUrl,'https://example.ngrok-free.dev/auth/callback');
  const csv=readFileSync(new URL('../public/ejemplo-presupuesto.csv',import.meta.url),'utf8');
  assert.equal((await request('import','POST',{csv,name:'A.csv',user_id:userB})).data.inserted,18);
  assert.equal((await request('state')).data.count,18);
  assert.equal((await request('state','GET',undefined,'user-b')).data.count,0);
  assert.equal((await request('import','POST',{csv:'invalid',name:'bad'})).status,400);
  process.env.OLLAMA_API_KEY='test-only';
  assert.equal((await request('chat','POST',{question:'Analiza mis proyectos',user_id:userB})).status,200);
  const own=(await request('state')).data,other=(await request('state','GET',undefined,'user-b')).data;
  assert.equal(own.messages.length,2);assert.equal(own.charts.length,1);assert.equal(other.messages.length,0);assert.equal(other.charts.length,0);
  await request('chart&id='+own.charts[0].id,'DELETE',undefined,'user-b');assert.equal((await request('state')).data.charts.length,1);
 }finally{globalThis.fetch=original;delete process.env.OLLAMA_API_KEY;server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
});
