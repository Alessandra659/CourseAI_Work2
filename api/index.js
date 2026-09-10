import { publicConfig,userContext,snapshot,importRows } from '../server/db.js';
import { AppError,parseCSV } from '../server/csv.js';
import { summary,makeChart } from '../server/analysis.js';
import { runAgent } from '../server/agent.js';
export const config={maxDuration:300};
async function readBody(req) {
  if(req.body!==undefined){const text=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(text)>2200000)throw new AppError('Archivo demasiado grande.',413);try{return JSON.parse(text);}catch{throw new AppError('JSON inválido.');}}
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>2200000)throw new AppError('Archivo demasiado grande.',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('JSON inválido.');}
}
function filtersOf(value={}) {
  if(!value||typeof value!=='object')throw new AppError('Filtros inválidos.');
  return Object.fromEntries(['proyecto','partida','fecha_corte'].filter(k=>value[k]).map(k=>{if(typeof value[k]!=='string'||value[k].length>160)throw new AppError('Filtros inválidos.');return [k,value[k]];}));
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try {
    const url=new URL(req.url,'http://localhost'),action=url.searchParams.get('action')||'state';
    if(!['GET','POST','DELETE'].includes(req.method))throw new AppError('Método no permitido.',405);
    if(action==='config'&&req.method==='GET')return send(200,publicConfig());
    const ctx=await userContext(req);
    if(action==='session'&&req.method==='GET')return send(200,{authenticated:true,user:{id:ctx.user.id,email:ctx.user.email}});
    if(action==='state'&&req.method==='GET') {
      const data=await snapshot(ctx);const {rows,revision}=data;
      return send(200,{...summary(rows,filtersOf(Object.fromEntries(url.searchParams))),revision,projectsList:[...new Set(rows.map(r=>r.proyecto))],dates:[...new Set(rows.map(r=>r.fecha_corte))].sort().reverse(),imports:data.imports,messages:data.messages,charts:data.charts,aiConfigured:!!process.env.OLLAMA_API_KEY,protected:true,user:{id:ctx.user.id,email:ctx.user.email}});
    }
    if(action==='import'&&req.method==='POST') {
      const {csv,name}=await readBody(req);const rows=parseCSV(csv);
      return send(200,{ok:true,rows:rows.length,...await importRows(ctx,rows,String(name||'presupuesto.csv').slice(0,180),csv)});
    }
    if(action==='chart'&&req.method==='POST') {
      const body=await readBody(req);const {rows,revision}=await snapshot(ctx);
      const chart=makeChart(rows,{...filtersOf(body.filters),kind:body.kind},revision);
      await ctx.rpc('budget_save_chart',{p_chart:chart});return send(200,{chart});
    }
    if(action==='chart'&&req.method==='DELETE') {
      const id=url.searchParams.get('id');if(!/^[0-9a-f-]{36}$/i.test(id||''))throw new AppError('Identificador inválido.');
      await ctx.rpc('budget_delete_chart',{p_id:id});return send(200,{ok:true});
    }
    if(action==='chat'&&req.method==='POST') {
      const body=await readBody(req);if(typeof body.question!=='string'||!body.question.trim()||body.question.length>3000)throw new AppError('Escribe una pregunta de hasta 3.000 caracteres.');
      const {rows,revision,messages}=await snapshot(ctx);
      const result=await runAgent({question:body.question,history:messages.slice(-12),rows,revision,filters:filtersOf(body.filters)});
      await ctx.rpc('budget_save_turn',{p_question:body.question,p_answer:result.answer,p_charts:result.charts});return send(200,result);
    }
    throw new AppError('Ruta no encontrada.',404);
  }catch(e){if(!e.status)console.error('Request failed:',e.name);send(e.status||500,{error:e.status?e.message:'No se pudo completar la operación.'});}
}
