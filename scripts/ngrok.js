import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) { console.error(message); process.exit(1); }
const executable=resolve('.tools/ngrok/ngrok.exe');
if(!existsSync(executable))fail('Falta ngrok en .tools/ngrok/ngrok.exe. Instálalo desde https://ngrok.com/download/windows.');
if(!process.env.NGROK_AUTHTOKEN?.trim())fail('Agrega NGROK_AUTHTOKEN en .env. Obtén tu token en https://dashboard.ngrok.com/get-started/your-authtoken. No lo compartas en el chat.');
let authConfig;
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)fail('PORT debe ser un puerto válido.');
try {
  const base=`http://127.0.0.1:${port}`;
  const response=await fetch(`${base}/api/index?action=config`,{signal:AbortSignal.timeout(5000)});
  authConfig=await response.json();
  if(!response.ok||!authConfig.callbackUrl)fail('Configura Supabase y APP_URL antes de iniciar ngrok.');
  const protectedResponse=await fetch(`${base}/api/index?action=state`,{signal:AbortSignal.timeout(5000)});
  if(protectedResponse.status!==401)fail('La API debe rechazar solicitudes sin sesión de Supabase.');
  const page=await fetch(base,{signal:AbortSignal.timeout(5000)});
  if(!page.ok)fail('La plataforma no responde correctamente. Ejecuta npm run build y npm start.');
  if((await page.text()).includes('/@vite/client'))fail('Usa npm start para compartir la compilación de producción, después de npm run build. Detén npm run dev primero.');
}catch{fail(`No se encontró la plataforma en el puerto ${port}. Ejecuta npm run build y npm start en otra terminal.`);}
mkdirSync('.ngrok',{recursive:true});
const config=resolve('.ngrok/ngrok.yml');
if(!existsSync(config))writeFileSync(config,'version: "3"\nagent:\n  web_addr: 127.0.0.1:4040\n');
// The token is inherited through the environment, never printed or passed as a CLI argument.
const env={...process.env};
for(const key of Object.keys(env))if(/^(SUPABASE_|OLLAMA_|DATABASE_|APP_PASSWORD)/.test(key))delete env[key];
console.log(`Abriendo ngrok hacia el puerto ${port}. Accede con tu cuenta de Supabase. Ctrl+C cierra el túnel.`);
const child=spawn(executable,['http',`http://127.0.0.1:${port}`,'--url',authConfig.siteUrl,'--config',config,'--inspect=false'],{env,stdio:'inherit',windowsHide:true});
child.on('error',()=>fail('No se pudo iniciar ngrok. Verifica la instalación.'));
child.on('exit',code=>{process.exitCode=code??0;});
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
