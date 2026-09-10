begin;
alter table public.budget_rows
  add column if not exists fecha_inicio_proyecto date,
  add column if not exists fecha_fin_proyecto date;
alter table public.budget_rows drop constraint if exists budget_rows_project_dates_check;
alter table public.budget_rows add constraint budget_rows_project_dates_check
  check (fecha_inicio_proyecto is null or fecha_fin_proyecto is null or fecha_fin_proyecto > fecha_inicio_proyecto);

create or replace function public.budget_import(p_rows jsonb,p_name text,p_content text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare n integer; additions integer; total integer; owner uuid:=auth.uid();
begin
  if owner is null then raise exception 'Sesión requerida.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Filas inválidas.'; end if;
  n:=jsonb_array_length(p_rows);
  if n<1 or n>5000 or octet_length(p_content)>2000000 then raise exception 'Límite de importación excedido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
  select count(*) into total from public.budget_rows where user_id=owner;
  select count(*) into additions from jsonb_to_recordset(p_rows) as r(proyecto text,partida text,fecha_corte date,fecha_inicio_proyecto date,fecha_fin_proyecto date)
    where not exists(select 1 from public.budget_rows b where b.user_id=owner and b.proyecto=r.proyecto and b.partida=r.partida and b.fecha_corte=r.fecha_corte);
  if total+additions>20000 then raise exception 'Tu cuenta admite hasta 20.000 registros.'; end if;
  insert into public.budget_rows(user_id,proyecto,partida,fecha_corte,fecha_inicio_proyecto,fecha_fin_proyecto,presupuesto_inicial,presupuesto_modificado,ejecutado)
    select owner,r.proyecto,r.partida,r.fecha_corte,r.fecha_inicio_proyecto,r.fecha_fin_proyecto,r.presupuesto_inicial,r.presupuesto_modificado,r.ejecutado
    from jsonb_to_recordset(p_rows) as r(proyecto text,partida text,fecha_corte date,fecha_inicio_proyecto date,fecha_fin_proyecto date,presupuesto_inicial bigint,presupuesto_modificado bigint,ejecutado bigint)
    on conflict(user_id,proyecto,partida,fecha_corte) do update set fecha_inicio_proyecto=excluded.fecha_inicio_proyecto,fecha_fin_proyecto=excluded.fecha_fin_proyecto,presupuesto_inicial=excluded.presupuesto_inicial,presupuesto_modificado=excluded.presupuesto_modificado,ejecutado=excluded.ejecutado;
  insert into public.budget_imports(user_id,name,rows,content) values(owner,p_name,n,p_content);
  insert into public.budget_settings(user_id,revision) values(owner,1) on conflict(user_id) do update set revision=public.budget_settings.revision+1;
  return jsonb_build_object('inserted',additions,'updated',n-additions);
end;
$$;
revoke all on function public.budget_import(jsonb,text,text) from public,anon;
grant execute on function public.budget_import(jsonb,text,text) to authenticated;
commit;
