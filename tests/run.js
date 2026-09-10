import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
const files=readdirSync('tests').filter(n=>n.endsWith('.test.js')).map(n=>join('tests',n));
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
