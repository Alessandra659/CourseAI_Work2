import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
export const userA='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
export const userB='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
export async function postgres(){
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${userA}'),('${userB}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(await readFile(new URL('../supabase/migrations/202609080001_user_isolation.sql',import.meta.url),'utf8'));
  return db;
}
export const asUser=(db,user,fn)=>db.transaction(async tx=>{
  await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return fn(tx);
});
