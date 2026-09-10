import test from 'node:test';
import assert from 'node:assert/strict';
import {postgres,asUser,userA,userB} from './postgres.js';
const row={proyecto:'Proyecto compartido de nombre',partida:'Partida',fecha_corte:'2026-06-30',presupuesto_inicial:10000,presupuesto_modificado:12000,ejecutado:13000};
test('PostgreSQL RLS isolates every table and RPC between two authenticated users',async()=>{
 const db=await postgres();
 try{
  const chart={id:'cccccccc-cccc-4ccc-cccc-cccccccccccc',created_at:new Date().toISOString(),title:'Privado A',data:[row]};
  await asUser(db,userA,async tx=>{
   await tx.query('select public.budget_import($1,$2,$3)',[JSON.stringify([row]),'privado.csv','contenido privado']);
   await tx.query('select public.budget_save_turn($1,$2,$3)',['pregunta privada','respuesta privada',JSON.stringify([chart])]);
   const snapshot=(await tx.query('select public.budget_snapshot() s')).rows[0].s;
   assert.equal(snapshot.rows.length,1);assert.equal(snapshot.imports.length,1);assert.equal(snapshot.messages.length,2);assert.equal(snapshot.charts.length,1);assert.equal(snapshot.revision,1);
  });
  await asUser(db,userB,async tx=>{
   const state=(await tx.query('select public.budget_snapshot() s')).rows[0].s;
   assert.deepEqual(state,{rows:[],revision:0,imports:[],messages:[],charts:[]});
   for(const table of ['budget_rows','budget_imports','budget_messages','budget_charts','budget_settings'])assert.equal((await tx.query(`select * from public.${table}`)).rows.length,0);
   await tx.query('select public.budget_delete_chart($1)',[chart.id]);
   assert.equal((await tx.query('update public.budget_rows set ejecutado=1 where user_id=$1 returning *',[userA])).rows.length,0);
   assert.equal((await tx.query('delete from public.budget_messages where user_id=$1 returning *',[userA])).rows.length,0);
   await tx.query('select public.budget_import($1,$2,$3)',[JSON.stringify([{...row,ejecutado:500}]),'B.csv','B privado']);
   assert.equal((await tx.query('select public.budget_snapshot() s')).rows[0].s.rows[0].ejecutado,500);
  });
  await assert.rejects(()=>asUser(db,userB,tx=>tx.query('insert into public.budget_messages(user_id,role,content) values($1,$2,$3)',[userA,'user','ataque'])),/row-level security/);
  await assert.rejects(()=>asUser(db,userA,tx=>tx.query('update public.budget_rows set user_id=$1',[userB])),/row-level security/);
  await assert.rejects(()=>asUser(db,userB,tx=>tx.query('select public.budget_save_turn($1,$2,$3)',['no guardar','rollback',JSON.stringify([chart])])),/duplicate key/);
  await asUser(db,userB,async tx=>assert.equal((await tx.query('select * from public.budget_messages')).rows.length,0));
  await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.budget_snapshot()');}),/permission denied/);
  await asUser(db,userA,async tx=>{
   const s=(await tx.query('select public.budget_snapshot() s')).rows[0].s;
   assert.equal(s.rows[0].ejecutado,13000);assert.equal(s.charts.length,1);
   assert.equal((await tx.query('select content from public.budget_imports')).rows[0].content,'contenido privado');
   const updated=(await tx.query('select public.budget_import($1,$2,$3) r',[JSON.stringify([row]),'again.csv','same'])).rows[0].r;
   assert.deepEqual(updated,{inserted:0,updated:1});
  });
 }finally{await db.close();}
});
