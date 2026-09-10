import Papa from 'papaparse';
export const columns = ['partida', 'presupuesto_inicial', 'presupuesto_modificado', 'ejecutado', 'fecha_corte', 'proyecto', 'fecha_inicio_proyecto', 'fecha_fin_proyecto'];
export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function parseCSV(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 2_000_000) throw new AppError('El CSV debe pesar como máximo 2 MB.');
  const parsed = Papa.parse(csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim().toLowerCase() });
  if (parsed.errors.length) throw new AppError(`CSV inválido: ${parsed.errors[0].message}`);
  if (columns.some(c => !parsed.meta.fields?.includes(c)) || parsed.meta.fields.length !== columns.length) throw new AppError(`Usa exactamente estas columnas: ${columns.join(', ')}.`);
  if (!parsed.data.length || parsed.data.length > 5000) throw new AppError('Cada archivo debe tener entre 1 y 5.000 filas.');
  const seen = new Set();
  return parsed.data.map((row, i) => {
    const fail = msg => { throw new AppError(`Fila ${i + 2}: ${msg}`); };
    const out = {};
    for (const c of ['partida', 'proyecto']) {
      out[c] = String(row[c] ?? '').trim().normalize('NFC');
      if (!out[c] || out[c].length > 160 || /[\x00-\x1F]/.test(out[c])) fail(`${c} debe contener entre 1 y 160 caracteres sin saltos de línea.`);
    }
    for (const c of ['presupuesto_inicial', 'presupuesto_modificado', 'ejecutado']) {
      const v = String(row[c] ?? '').trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(v) || Number(v) > 1e9) fail(`${c}: usa un importe entre 0 y 1.000.000.000, sin separador de miles y con hasta 2 decimales (ej. 1250.50).`);
      out[c] = Math.round(Number(v) * 100);
    }
    const date = String(row.fecha_corte ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0,4)) < 1900 || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('fecha_corte debe ser una fecha real con formato AAAA-MM-DD.');
    out.fecha_corte = date;
    for (const c of ['fecha_inicio_proyecto', 'fecha_fin_proyecto']) {
      const value = String(row[c] ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`${c} debe ser una fecha real con formato AAAA-MM-DD.`);
      out[c] = value;
    }
    if (out.fecha_fin_proyecto <= out.fecha_inicio_proyecto) fail('fecha_fin_proyecto debe ser posterior a fecha_inicio_proyecto.');
    const key = JSON.stringify([out.proyecto, out.partida, date]);
    if (seen.has(key)) fail('partida, proyecto y fecha de corte duplicados dentro del archivo.');
    seen.add(key);
    return out;
  });
}
