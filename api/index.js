import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { database, snapshot, importRows } from '../server/db.js';
import { AppError, parseCSV } from '../server/csv.js';
import { summary, makeChart } from '../server/analysis.js';
import { runAgent } from '../server/agent.js';
export const config={maxDuration:300};
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length && timingSafeEqual(x,y);};
const sign=value=>createHmac('sha256',process.env.APP_PASSWORD).update(value).digest('hex');
function authenticated(req) {
  if(!process.env.APP_PASSWORD) return !process.env.VERCEL;
  const token=(req.headers.cookie||'').split('; ').find(s=>s.startsWith('pulso_session='))?.slice(14);
  if(!token) return false;
  const [expiry,signature]=token.split('.');
  return Number(expiry)>Date.now() && equal(signature,sign(expiry));
}
async function readBody(req) {
  if(req.body!==undefined) {
    if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(req.body))>2200000) throw new AppError('Archivo demasiado grande.',413);
    return typeof req.body==='string'?JSON.parse(req.body):req.body;
  }
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>2200000)throw new AppError('Archivo demasiado grande.',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('JSON inválido.');}
}
function filtersOf(value={}) {
  if(!value || typeof value!=='object')throw new AppError('Filtros inválidos.');
  return Object.fromEntries(['proyecto','partida','fecha_corte'].filter(k=>value[k]).map(k=>{
    if(typeof value[k]!=='string'||value[k].length>160)throw new AppError('Filtros inválidos.');return [k,value[k]];
  }));
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try {
    const url=new URL(req.url,'http://localhost');
    const action=url.searchParams.get('action')||'state';
    if(process.env.VERCEL && (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length<16))throw new AppError('Configura APP_PASSWORD con al menos 16 caracteres antes de usar la aplicación en Vercel.',503);
    if(!['GET','POST','DELETE'].includes(req.method))throw new AppError('Método no permitido.',405);
    if(req.method!=='GET' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)throw new AppError('Origen no permitido.',403);
    if(action==='session'&&req.method==='GET')return send(200,{authenticated:authenticated(req)});
    if(action==='login'&&req.method==='POST') {
      const body=await readBody(req);
      if(!process.env.APP_PASSWORD || !equal(body.password,process.env.APP_PASSWORD))throw new AppError('Contraseña incorrecta.',401);
      const expiry=String(Date.now()+8*60*60*1000);
      res.setHeader('Set-Cookie',`pulso_session=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.VERCEL?'; Secure':''}`);
      return send(200,{ok:true});
    }
    if(!authenticated(req))throw new AppError('Ingresa la contraseña del espacio de trabajo.',401);
    if(action==='logout'&&req.method==='POST') {res.setHeader('Set-Cookie','pulso_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
    const db=await database();
    if(action==='state'&&req.method==='GET') {
      const {rows,revision}=await snapshot();
      const filters=filtersOf(Object.fromEntries(url.searchParams));
      const results=await db.batch(['SELECT id,name,rows,created_at FROM imports ORDER BY created_at DESC LIMIT 30','SELECT * FROM (SELECT * FROM messages ORDER BY created_at DESC LIMIT 100) ORDER BY created_at','SELECT * FROM charts ORDER BY created_at DESC LIMIT 100'],'read');
      return send(200,{...summary(rows,filters),revision,projectsList:[...new Set(rows.map(r=>r.proyecto))],dates:[...new Set(rows.map(r=>r.fecha_corte))].sort().reverse(),imports:results[0].rows,messages:results[1].rows,charts:results[2].rows.map(r=>JSON.parse(r.spec)),aiConfigured:!!process.env.OLLAMA_API_KEY,protected:!!process.env.APP_PASSWORD});
    }
    if(action==='import'&&req.method==='POST') {
      const {csv,name}=await readBody(req);
      const rows=parseCSV(csv);
      const result=await importRows(rows,String(name||'presupuesto.csv').slice(0,180),csv);
      return send(200,{ok:true,rows:rows.length,...result});
    }
    if(action==='chart'&&req.method==='POST') {
      const body=await readBody(req);const {rows,revision}=await snapshot();
      const chart=makeChart(rows,{...filtersOf(body.filters),kind:body.kind},revision);
      await db.execute({sql:'INSERT INTO charts VALUES (?,?,?)',args:[chart.id,JSON.stringify(chart),chart.created_at]});
      return send(200,{chart});
    }
    if(action==='chart'&&req.method==='DELETE') {
      await db.execute({sql:'DELETE FROM charts WHERE id=?',args:[url.searchParams.get('id')||'']});return send(200,{ok:true});
    }
    if(action==='chat'&&req.method==='POST') {
      const body=await readBody(req);
      if(typeof body.question!=='string'||!body.question.trim()||body.question.length>3000)throw new AppError('Escribe una pregunta de hasta 3.000 caracteres.');
      const {rows,revision}=await snapshot();
      const history=await db.execute('SELECT * FROM (SELECT * FROM messages ORDER BY created_at DESC LIMIT 12) ORDER BY created_at');
      const result=await runAgent({question:body.question,history:history.rows,rows,revision,filters:filtersOf(body.filters)});
      const now=Date.now();
      // Persist response and its charts atomically, only after a successful provider response.
      await db.batch([
        {sql:'INSERT INTO messages VALUES (?,?,?,?)',args:[randomUUID(),'user',body.question,new Date(now).toISOString()]},
        {sql:'INSERT INTO messages VALUES (?,?,?,?)',args:[randomUUID(),'assistant',result.answer,new Date(now+1).toISOString()]},
        ...result.charts.map(c=>({sql:'INSERT INTO charts VALUES (?,?,?)',args:[c.id,JSON.stringify(c),c.created_at]}))
      ],'write');
      return send(200,result);
    }
    throw new AppError('Ruta no encontrada.',404);
  }catch(e){if(!e.status)console.error('Request failed:',e.name);send(e.status||500,{error:e.status?e.message:'No se pudo completar la operación. Revisa la conexión con la base de datos.'});}
}
