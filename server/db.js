import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './csv.js';
let ready;
export async function database() {
  if (!ready) ready = init().catch(e => { ready = undefined; throw e; });
  return ready;
}
async function init() {
  const url = process.env.DATABASE_URL || 'file:./data/presupuesto.db';
  if (process.env.VERCEL && !/^(libsql|https):\/\//.test(url)) throw new AppError('Configura DATABASE_URL con una base libSQL remota para conservar los datos en Vercel.', 503);
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice(5)), { recursive: true });
  const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  await db.batch([
    `CREATE TABLE IF NOT EXISTS partidas (proyecto TEXT NOT NULL, partida TEXT NOT NULL, fecha_corte TEXT NOT NULL, presupuesto_inicial INTEGER NOT NULL, presupuesto_modificado INTEGER NOT NULL, ejecutado INTEGER NOT NULL, PRIMARY KEY(proyecto,partida,fecha_corte))`,
    `CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, name TEXT NOT NULL, rows INTEGER NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS charts (id TEXT PRIMARY KEY, spec TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `INSERT OR IGNORE INTO settings VALUES ('revision','0')`
  ], 'write');
  return db;
}
export async function snapshot() {
  const db = await database();
  const r = await db.batch(['SELECT * FROM partidas ORDER BY proyecto,fecha_corte,partida', "SELECT value FROM settings WHERE key='revision'"], 'read');
  return { rows: r[0].rows.map(r => ({ ...r })), revision: Number(r[1].rows[0].value) };
}
export async function importRows(rows, name, content) {
  const db = await database();
  const tx = await db.transaction('write');
  try {
    const count = await tx.execute('SELECT COUNT(*) AS n FROM partidas');
    const existing = await tx.execute('SELECT proyecto,partida,fecha_corte FROM partidas');
    const keys = new Set(existing.rows.map(r => JSON.stringify([r.proyecto,r.partida,r.fecha_corte])));
    const newCount = rows.filter(r => !keys.has(JSON.stringify([r.proyecto,r.partida,r.fecha_corte]))).length;
    if (Number(count.rows[0].n) + newCount > 20000) throw new AppError('Este espacio admite hasta 20.000 registros.');
    const statements=rows.map(r=>({ sql: `INSERT INTO partidas VALUES (?,?,?,?,?,?) ON CONFLICT(proyecto,partida,fecha_corte) DO UPDATE SET presupuesto_inicial=excluded.presupuesto_inicial,presupuesto_modificado=excluded.presupuesto_modificado,ejecutado=excluded.ejecutado`, args: [r.proyecto,r.partida,r.fecha_corte,r.presupuesto_inicial,r.presupuesto_modificado,r.ejecutado] }));
    // Keep one atomic transaction while avoiding one network round trip per row.
    for(let i=0;i<statements.length;i+=250)await tx.batch(statements.slice(i,i+250));
    await tx.execute({ sql: 'INSERT INTO imports VALUES (?,?,?,?,?)', args: [crypto.randomUUID(),name,rows.length,content,new Date().toISOString()] });
    await tx.execute("UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE key='revision'");
    await tx.commit();
    return { inserted: newCount, updated: rows.length-newCount };
  } catch(e) { await tx.rollback(); throw e; } finally { tx.close(); }
}
