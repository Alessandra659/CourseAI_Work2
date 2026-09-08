import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
const root=resolve('data','tests');
mkdirSync(root,{recursive:true});
const temp=mkdtempSync(join(root,'pulso-test-'));
try {
  const files=readdirSync('tests').filter(n=>n.endsWith('.test.js')).map(n=>join('tests',n));
  const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',env:{...process.env,PULSO_TEST_DATABASE_URL:`file:${join(temp,'test.db').replaceAll('\\','/')}`}});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
} finally {
  // Native SQLite handles on Windows are released when the test process exits.
  if(!resolve(temp).startsWith(root+sep))throw new Error('Unsafe test cleanup path');
  for(const name of readdirSync(temp))unlinkSync(join(temp,name));
  rmdirSync(temp);
}
