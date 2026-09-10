begin;
create table public.budget_rows (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  proyecto text not null check(length(proyecto) between 1 and 160),
  partida text not null check(length(partida) between 1 and 160),
  fecha_corte date not null,
  presupuesto_inicial bigint not null check(presupuesto_inicial between 0 and 100000000000),
  presupuesto_modificado bigint not null check(presupuesto_modificado between 0 and 100000000000),
  ejecutado bigint not null check(ejecutado between 0 and 100000000000),
  primary key(user_id,proyecto,partida,fecha_corte)
);
create table public.budget_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check(length(name)<=180), rows integer not null check(rows between 1 and 5000),
  content text not null check(octet_length(content)<=2000000),created_at timestamptz not null default now()
);
create table public.budget_messages (
  id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check(role in ('user','assistant')),content text not null,created_at timestamptz not null default now()
);
create table public.budget_charts (
  id uuid primary key,user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spec jsonb not null,created_at timestamptz not null default now()
);
create table public.budget_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision bigint not null default 0 check(revision>=0)
);
create index on public.budget_imports(user_id,created_at desc);
create index on public.budget_messages(user_id,created_at desc);
create index on public.budget_charts(user_id,created_at desc);
do $$ declare t text; begin
  foreach t in array array['budget_rows','budget_imports','budget_messages','budget_charts','budget_settings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy owner_only on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',t);
  end loop;
end $$;
create function public.budget_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-'user_id' order by r.proyecto,r.fecha_corte,r.partida) from public.budget_rows r where user_id=auth.uid()),'[]'::jsonb),
  'revision',coalesce((select revision from public.budget_settings where user_id=auth.uid()),0),
  'imports',coalesce((select jsonb_agg(to_jsonb(i) order by created_at desc) from (select id,name,rows,created_at from public.budget_imports where user_id=auth.uid() order by created_at desc,id desc limit 30)i),'[]'::jsonb),
  'messages',coalesce((select jsonb_agg(to_jsonb(m) order by created_at,id) from (select id,role,content,created_at from public.budget_messages where user_id=auth.uid() order by created_at desc,id desc limit 100)m),'[]'::jsonb),
  'charts',coalesce((select jsonb_agg(c.spec order by c.created_at desc) from (select spec,created_at from public.budget_charts where user_id=auth.uid() order by created_at desc,id desc limit 100)c),'[]'::jsonb)
 );
$$;
create function public.budget_import(p_rows jsonb,p_name text,p_content text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare n integer; additions integer; total integer; owner uuid:=auth.uid();
begin
  if owner is null then raise exception 'Sesión requerida.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Filas inválidas.'; end if;
  n:=jsonb_array_length(p_rows);
  if n<1 or n>5000 or octet_length(p_content)>2000000 then raise exception 'Límite de importación excedido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
  select count(*) into total from public.budget_rows where user_id=owner;
  select count(*) into additions from jsonb_to_recordset(p_rows) as r(proyecto text,partida text,fecha_corte date)
    where not exists(select 1 from public.budget_rows b where b.user_id=owner and b.proyecto=r.proyecto and b.partida=r.partida and b.fecha_corte=r.fecha_corte);
  if total+additions>20000 then raise exception 'Tu cuenta admite hasta 20.000 registros.'; end if;
  insert into public.budget_rows(user_id,proyecto,partida,fecha_corte,presupuesto_inicial,presupuesto_modificado,ejecutado)
    select owner,r.proyecto,r.partida,r.fecha_corte,r.presupuesto_inicial,r.presupuesto_modificado,r.ejecutado
    from jsonb_to_recordset(p_rows) as r(proyecto text,partida text,fecha_corte date,presupuesto_inicial bigint,presupuesto_modificado bigint,ejecutado bigint)
    on conflict(user_id,proyecto,partida,fecha_corte) do update set presupuesto_inicial=excluded.presupuesto_inicial,presupuesto_modificado=excluded.presupuesto_modificado,ejecutado=excluded.ejecutado;
  insert into public.budget_imports(user_id,name,rows,content) values(owner,p_name,n,p_content);
  insert into public.budget_settings(user_id,revision) values(owner,1) on conflict(user_id) do update set revision=public.budget_settings.revision+1;
  return jsonb_build_object('inserted',additions,'updated',n-additions);
end;
$$;
create function public.budget_save_chart(p_chart jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sesión requerida.'; end if;
  insert into public.budget_charts(id,user_id,spec,created_at) values((p_chart->>'id')::uuid,auth.uid(),p_chart,(p_chart->>'created_at')::timestamptz);
end;
$$;
create function public.budget_delete_chart(p_id uuid) returns void language sql security invoker set search_path='' as $$
 delete from public.budget_charts where id=p_id and user_id=auth.uid();
$$;
create function public.budget_save_turn(p_question text,p_answer text,p_charts jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare c jsonb; t timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Sesión requerida.'; end if;
  if length(p_question)>3000 or jsonb_array_length(p_charts)>3 then raise exception 'Respuesta demasiado extensa.'; end if;
  insert into public.budget_messages(user_id,role,content,created_at) values(auth.uid(),'user',p_question,t),(auth.uid(),'assistant',p_answer,t+interval '1 millisecond');
  for c in select value from jsonb_array_elements(p_charts) loop perform public.budget_save_chart(c); end loop;
end;
$$;
revoke all on function public.budget_snapshot(),public.budget_import(jsonb,text,text),public.budget_save_chart(jsonb),public.budget_delete_chart(uuid),public.budget_save_turn(text,text,jsonb) from public,anon;
grant execute on function public.budget_snapshot(),public.budget_import(jsonb,text,text),public.budget_save_chart(jsonb),public.budget_delete_chart(uuid),public.budget_save_turn(text,text,jsonb) to authenticated;
commit;
