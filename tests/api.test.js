import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
if(!process.env.PULSO_TEST_DATABASE_URL)throw new Error('Usa npm test para crear una base de pruebas aislada.');
process.env.DATABASE_URL=process.env.PULSO_TEST_DATABASE_URL;
process.env.APP_PASSWORD='test-password-long-enough';
const {default:handler}=await import('../api/index.js');
const {database}=await import('../server/db.js');
const server=http.createServer(handler);
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/api/index`;
let cookie='';
const request=async(action,method='GET',body)=>{
  const res=await fetch(`${base}?action=${action}`,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {res,data:await res.json()};
};
after(async()=>{
  server.closeAllConnections();await new Promise(r=>server.close(r));(await database()).close();
});
test('protected import, persistence, upsert, failed import atomicity and charts',async()=>{
  assert.equal((await request('state')).res.status,401);
  const login=await request('login','POST',{password:process.env.APP_PASSWORD});
  assert.equal(login.res.status,200);cookie=login.res.headers.get('set-cookie').split(';')[0];
  const csv=readFileSync(new URL('../public/ejemplo-presupuesto.csv',import.meta.url),'utf8');
  const imported=await request('import','POST',{csv,name:'test.csv'});assert.equal(imported.data.inserted,18);
  const repeated=await request('import','POST',{csv,name:'test.csv'});assert.equal(repeated.data.inserted,0);assert.equal(repeated.data.updated,18);
  const invalid=await request('import','POST',{csv:csv.replace('60000','bad'),name:'bad.csv'});assert.equal(invalid.res.status,400);
  const state=await request('state');assert.equal(state.data.count,18);assert.equal(state.data.revision,2);assert.equal(state.data.imports.length,2);
  const c=await request('chart','POST',{kind:'proyectos',filters:{}});assert.equal(c.res.status,200);
  const reader=createClient({url:process.env.DATABASE_URL});
  assert.equal((await reader.execute('SELECT count(*) AS n FROM charts')).rows[0].n,1);
  assert.equal((await reader.execute('SELECT count(*) AS n FROM partidas')).rows[0].n,18);reader.close();
  assert.equal((await request('state')).data.charts[0].data.length,3);
  await request(`chart&id=${c.data.chart.id}`,'DELETE');assert.equal((await request('state')).data.charts.length,0);
  const originalFetch=globalThis.fetch;
  let providerCalls=0;
  process.env.OLLAMA_API_KEY='test-only';
  globalThis.fetch=async(url,options)=>{
    if(url!=='https://ollama.com/api/chat')return originalFetch(url,options);
    providerCalls++;
    return {ok:true,json:async()=>({message:providerCalls===1?{role:'assistant',content:'',tool_calls:[{function:{name:'crear_grafico',arguments:{kind:'proyectos'}}}]}:{role:'assistant',content:'Se guardó el análisis de los proyectos.'}})};
  };
  try {
    const chat=await request('chat','POST',{question:'Compara los proyectos',filters:{}});assert.equal(chat.res.status,200);
    const saved=await request('state');assert.equal(saved.data.messages.length,2);assert.equal(saved.data.charts.length,1);
    assert.equal(saved.data.messages[0].content,'Compara los proyectos');
    assert.equal(saved.data.messages[1].role,'assistant');
  }finally{globalThis.fetch=originalFetch;delete process.env.OLLAMA_API_KEY;}
  await request('logout','POST');
});
