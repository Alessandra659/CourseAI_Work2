// One-off export only. The application never opens SQLite after the migration.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const email=process.argv[2];
if(!email||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Uso: node scripts/export-legacy.js correo-del-propietario');
const source=resolve('data/presupuesto.db');
if(!existsSync(source))throw new Error('No existe data/presupuesto.db. No se creó ni modificó ningún archivo de datos.');
const db=new DatabaseSync(source,{readOnly:true});
const payload={};
try {
  for(const [key,table] of Object.entries({rows:'partidas',imports:'imports',messages:'messages',charts:'charts'}))payload[key]=db.prepare(`select * from ${table}`).all();
  payload.revision=Number(db.prepare("select value from settings where key='revision'").get()?.value||0);
}finally{db.close();}
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const sql=`begin;
do $migration$
declare owner uuid; p jsonb := ${literal(JSON.stringify(payload))}::jsonb;
begin
 select id into owner from auth.users where lower(email)=lower(${literal(email)});
 if owner is null then raise exception 'La cuenta propietaria debe existir en Supabase Auth antes de migrar.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
 if exists(select 1 from public.budget_settings where user_id=owner) or exists(select 1 from public.budget_rows where user_id=owner) or exists(select 1 from public.budget_imports where user_id=owner) or exists(select 1 from public.budget_messages where user_id=owner) or exists(select 1 from public.budget_charts where user_id=owner) then raise exception 'La cuenta destino ya contiene datos. No se sobrescribió nada.'; end if;
 insert into public.budget_rows select owner,r.proyecto,r.partida,r.fecha_corte,r.presupuesto_inicial,r.presupuesto_modificado,r.ejecutado from jsonb_to_recordset(p->'rows') r(proyecto text,partida text,fecha_corte date,presupuesto_inicial bigint,presupuesto_modificado bigint,ejecutado bigint);
 insert into public.budget_imports(id,user_id,name,rows,content,created_at) select r.id,owner,r.name,r.rows,r.content,r.created_at from jsonb_to_recordset(p->'imports') r(id uuid,name text,rows integer,content text,created_at timestamptz);
 insert into public.budget_messages(id,user_id,role,content,created_at) select r.id,owner,r.role,r.content,r.created_at from jsonb_to_recordset(p->'messages') r(id uuid,role text,content text,created_at timestamptz);
 insert into public.budget_charts(id,user_id,spec,created_at) select r.id,owner,r.spec::jsonb,r.created_at from jsonb_to_recordset(p->'charts') r(id uuid,spec text,created_at timestamptz);
 insert into public.budget_settings(user_id,revision) values(owner,(p->>'revision')::bigint);
end $migration$;
commit;
`;
mkdirSync('.tools',{recursive:true});writeFileSync('.tools/supabase-legacy-migration.sql',sql);
console.log(JSON.stringify({file:'.tools/supabase-legacy-migration.sql',rows:payload.rows.length,imports:payload.imports.length,messages:payload.messages.length,charts:payload.charts.length,sourcePreserved:true}));
