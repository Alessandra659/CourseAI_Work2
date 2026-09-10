import { AppError } from './csv.js';
const moneyFields = ['presupuesto_inicial','presupuesto_modificado','ejecutado'];
export const pct = (a,b) => b === 0 ? null : Math.round(a / b * 10000) / 100;
const amount = n => n / 100;
export function currentRows(rows, filters = {}) {
  const filtered = rows.filter(r => (!filters.proyecto || r.proyecto === filters.proyecto) && (!filters.fecha_corte || r.fecha_corte <= filters.fecha_corte));
  const cuts = {};
  for (const r of filtered) cuts[r.proyecto] = !cuts[r.proyecto] || r.fecha_corte > cuts[r.proyecto] ? r.fecha_corte : cuts[r.proyecto];
  return filtered.filter(r => r.fecha_corte === cuts[r.proyecto] && (!filters.partida || r.partida === filters.partida));
}
export function metrics(r) {
  const delta = r.presupuesto_modificado-r.presupuesto_inicial;
  return { ...r, ...Object.fromEntries(moneyFields.map(k=>[k,amount(r[k])])), modificacion: amount(delta), modificacion_pct: pct(delta,r.presupuesto_inicial), ejecucion_pct: pct(r.ejecutado,r.presupuesto_modificado), saldo: amount(r.presupuesto_modificado-r.ejecutado), estado: r.ejecutado > r.presupuesto_modificado ? 'Sobre-ejecución' : r.presupuesto_modificado === 0 ? 'Sin presupuesto' : r.ejecutado/r.presupuesto_modificado < 0.8 ? 'Ejecución menor al 80%' : 'Entre 80% y 100%' };
}
export function summary(rows, filters = {}) {
  const latest = currentRows(rows,filters);
  const groups = new Map();
  for (const r of latest) {
    if (!groups.has(r.proyecto)) groups.set(r.proyecto,{proyecto:r.proyecto,fecha_corte:r.fecha_corte,presupuesto_inicial:0,presupuesto_modificado:0,ejecutado:0,exceso:0,modificacion_absoluta:0});
    const g = groups.get(r.proyecto);
    for (const k of moneyFields) g[k] += r[k];
    g.exceso += Math.max(0,r.ejecutado-r.presupuesto_modificado);
    g.modificacion_absoluta += Math.abs(r.presupuesto_modificado-r.presupuesto_inicial);
  }
  const projects = [...groups.values()].map(g => ({ ...metrics(g), exceso:amount(g.exceso), modificacion_absoluta:amount(g.modificacion_absoluta), riesgo: Math.round(Math.min(100, 60 * Math.min(1,g.presupuesto_modificado ? g.exceso/g.presupuesto_modificado : g.exceso>0 ? 1:0) + 40 * Math.min(1,g.presupuesto_inicial ? g.modificacion_absoluta/g.presupuesto_inicial : g.modificacion_absoluta>0 ? 1:0))) })).sort((a,b)=>b.riesgo-a.riesgo || a.proyecto.localeCompare(b.proyecto));
  const total = Object.fromEntries(moneyFields.map(k=>[k,latest.reduce((s,r)=>s+r[k],0)]));
  return { totals:metrics(total), projects, lines:latest.map(metrics), cuts:[...new Set(latest.map(r=>r.fecha_corte))].sort(), count:rows.length };
}
export function analysis(rows, args={}) {
  const {kind='modificaciones',proyecto,partida,fecha_corte,offset=0} = args;
  const filters = {proyecto,partida,fecha_corte};
  let data;
  if(kind==='evolucion') {
    if(!proyecto || !partida) throw new AppError('Para evolución indica un proyecto y una partida exactos.');
    data = rows.filter(r=>r.proyecto===proyecto && r.partida===partida && (!fecha_corte || r.fecha_corte<=fecha_corte)).sort((a,b)=>a.fecha_corte.localeCompare(b.fecha_corte)).map(metrics);
  } else if(kind==='riesgo' || kind==='proyectos') data=summary(rows,filters).projects;
  else {
    data=currentRows(rows,filters).map(metrics);
    if(kind==='modificaciones') data.sort((a,b)=>Math.abs(b.modificacion)-Math.abs(a.modificacion));
    else if(kind==='ejecucion') data.sort((a,b)=>(b.ejecucion_pct??-1)-(a.ejecucion_pct??-1));
    else if(kind!=='comparacion') throw new AppError('Tipo de análisis desconocido. Usa kind: comparacion, modificaciones, ejecucion, evolucion, proyectos o riesgo.');
  }
  const page=Number.isInteger(offset)&&offset>=0?offset:0;
  return {kind, filters, total:data.length, offset:page, data:data.slice(page,page+100), truncated:data.length>page+100};
}
export function makeChart(rows,args,revision) {
  const result=analysis(rows,args);
  if(!result.data.length) throw new AppError('No hay datos para ese gráfico y esos filtros.');
  const titles={comparacion:'Presupuesto por partida',modificaciones:'Mayores modificaciones',ejecucion:'Ejecución por partida',evolucion:'Evolución del presupuesto',proyectos:'Ejecución por proyecto',riesgo:'Señales de desviación por proyecto'};
  return { id:crypto.randomUUID(), kind:result.kind, title:titles[result.kind], filters:result.filters, revision, created_at:new Date().toISOString(), total:result.total, data:result.data, note:result.kind==='evolucion'?'Valores acumulados en cada corte; no se suman entre fechas.':'Último corte disponible de cada proyecto hasta la fecha seleccionada. No se arrastran partidas ausentes de un corte.' };
}
