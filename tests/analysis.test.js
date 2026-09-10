import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../server/csv.js';
import { currentRows, summary, analysis, makeChart, pct, healthMetrics, HEALTHY_BAND_POINTS } from '../server/analysis.js';
import { runAgent, providerModel, normalizeToolArgs } from '../server/agent.js';
const csv=readFileSync(new URL('../public/ejemplo-presupuesto.csv',import.meta.url),'utf8');
const rows=parseCSV(csv);
test('CSV amounts use integer cents and quoted names remain intact',()=>{
  assert.equal(rows.length,18);assert.equal(rows[0].presupuesto_inicial,6000000);
  const data=parseCSV('partida,presupuesto_inicial,presupuesto_modificado,ejecutado,fecha_corte,proyecto,fecha_inicio_proyecto,fecha_fin_proyecto\n"Alimentos, frescos",10.25,12.10,1.01,2026-06-30,Proyecto,2026-01-01,2026-12-31');
  assert.equal(data[0].ejecutado,101);assert.equal(data[0].partida,'Alimentos, frescos');
});
test('CSV rejects impossible dates, duplicate keys, blank, negative, thousands and extra precision',()=>{
  for(const modified of [csv.replace('2026-03-31','2026-02-30'),csv.replace('60000','-10'),csv.replace('60000',''),csv.replace('60000','10.001'),csv.replace('60000','1e4'),csv+'Alimentación,1,1,1,2026-03-31,Nutrición infantil\n'])assert.throws(()=>parseCSV(modified));
});
test('latest cuts are never summed across dates, and cutoff applies',()=>{
  assert.equal(currentRows(rows).length,9);
  assert.equal(summary(rows).totals.presupuesto_inicial,380000);
  assert.equal(summary(rows).totals.presupuesto_modificado,429000);
  assert.equal(summary(rows).totals.ejecutado,328000);
  assert.equal(summary(rows,{fecha_corte:'2026-03-31'}).totals.ejecutado,96500);
  assert.equal(currentRows(rows,{fecha_corte:'2025-01-01'}).length,0);
});
test('missing items are not silently carried from older snapshots',()=>{
  const latest=rows.filter(r=>!(r.proyecto==='Nutrición infantil'&&r.partida==='Material educativo'&&r.fecha_corte==='2026-06-30'));
  assert.equal(currentRows(latest,{proyecto:'Nutrición infantil'}).length,2);
});
test('modification ordering and evolution respect project identity',()=>{
  assert.equal(analysis(rows,{kind:'modificaciones'}).data[0].partida,'Infraestructura');
  const e=analysis(rows,{kind:'evolucion',proyecto:'Nutrición infantil',partida:'Alimentación'});
  assert.deepEqual(e.data.map(r=>r.presupuesto_modificado),[62000,72000]);
  assert.throws(()=>analysis(rows,{kind:'evolucion'}));
});
test('zero denominators are null and item overruns cannot cancel out',()=>{
  assert.equal(pct(10,0),null);
  const project=summary(rows).projects.find(p=>p.proyecto==='Agua para todos');
  assert.equal(project.exceso,6000);assert.ok(project.ejecucion_pct<100);assert.ok(project.riesgo>0);
  const r=[{proyecto:'A',partida:'X',fecha_corte:'2026-01-01',presupuesto_inicial:0,presupuesto_modificado:0,ejecutado:100}];
  assert.equal(summary(r).projects[0].riesgo,60);
});
test('healthy range and projection use the project timeline',()=>{
  const base={proyecto:'A',partida:'X',fecha_corte:'2026-06-30',fecha_inicio_proyecto:'2026-01-01',fecha_fin_proyecto:'2026-12-31',presupuesto_inicial:10000,presupuesto_modificado:10000};
  const sub=healthMetrics({...base,ejecutado:3000});
  const over=healthMetrics({...base,ejecutado:7000});
  const healthy=healthMetrics({...base,ejecutado:5000});
  assert.equal(HEALTHY_BAND_POINTS,15);
  assert.equal(sub.salud,'riesgo de sub-ejecución');
  assert.equal(over.salud,'riesgo de sobre-ejecución');
  assert.equal(healthy.salud,'saludable');
  assert.ok(healthy.proyeccion_ejecucion_pct>99 && healthy.proyeccion_ejecucion_pct<102);
  assert.equal(healthy.proyeccion_estado,'superaría el presupuesto');
  assert.ok(healthy.proyeccion_variacion>0);
});
test('health and projection analysis kinds expose calculated fields',()=>{
  const result=analysis(rows,{kind:'salud'});
  assert.equal(result.data.length,9);
  assert.ok('salud' in result.data[0] && 'brecha_tiempo_ejecucion_pp' in result.data[0]);
  const projection=analysis(rows,{kind:'proyeccion'});
  assert.equal(projection.data.length,3);
  assert.ok('proyeccion_ejecutado' in projection.data[0]);
});
test('charts retain snapshot, filter and revision provenance',()=>{
  const chart=makeChart(rows,{kind:'comparacion',proyecto:'Agua para todos'},3);
  assert.equal(chart.revision,3);assert.equal(chart.data.length,3);
  assert.equal(chart.filters.proyecto,'Agua para todos');
  assert.throws(()=>makeChart(rows,{kind:'comparacion',proyecto:'No existe'},1));
});
test('cloud routing uses the official direct API alias',()=>assert.equal(providerModel('gpt-oss:120b-cloud'),'gpt-oss:120b'));
test('real provider singular aliases resolve and blank tool fields preserve active filters',()=>{
  assert.deepEqual(normalizeToolArgs({kind:'modificacion',proyecto:'',fecha_corte:''},{proyecto:'A',fecha_corte:'2026-03-31'}),{kind:'modificaciones',proyecto:'A',fecha_corte:'2026-03-31'});
  assert.equal(normalizeToolArgs({kind:'mod'}).kind,'modificaciones');
});
test('agent tool cycle generates charts from trusted calculations',async()=>{
  process.env.OLLAMA_API_KEY='test-only';let calls=0;
  const fetcher=async(url,options)=>{
    assert.equal(url,'https://ollama.com/api/chat');const body=JSON.parse(options.body);
    assert.equal(body.model,'gpt-oss:120b');calls++;
    if(calls===1)return {ok:true,json:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:{name:'crear_grafico',arguments:{kind:'modificaciones'}}}]}})};
    assert.equal(body.messages.at(-1).role,'tool');
    const result=JSON.parse(body.messages.at(-1).content);assert.equal(result.chart.data[0].modificacion,30000);
    return {ok:true,json:async()=>({message:{role:'assistant',content:'Infraestructura aumentó en 30.000.'}})};
  };
  const result=await runAgent({question:'Compara modificaciones',history:[],rows,revision:1,fetcher});
  assert.equal(result.charts.length,1);assert.match(result.answer,/30.000/);delete process.env.OLLAMA_API_KEY;
});
test('agent explicitly reports missing credentials and provider errors',async()=>{
  delete process.env.OLLAMA_API_KEY;
  await assert.rejects(()=>runAgent({question:'hola',history:[],rows,revision:1}),/OLLAMA_API_KEY/);
  process.env.OLLAMA_API_KEY='test-only';
  await assert.rejects(()=>runAgent({question:'hola',history:[],rows,revision:1,fetcher:async()=>({ok:false,status:401})}),/API key/);
  delete process.env.OLLAMA_API_KEY;
});
