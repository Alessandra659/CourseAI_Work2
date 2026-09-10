import { AppError } from './csv.js';
export function publicConfig() {
  const url=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY;
  const siteUrl=process.env.APP_URL?.replace(/\/$/,'');
  if(!url||!publishableKey||!siteUrl)throw new AppError('Falta conectar Supabase: configura SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY y APP_URL en el servidor.',503);
  if(!/^https:\/\//.test(url)||!/^https:\/\//.test(siteUrl))throw new AppError('Supabase y APP_URL deben usar HTTPS; APP_URL debe apuntar al dominio público de la plataforma.',503);
  if(publishableKey.startsWith('sb_secret_'))throw new AppError('Usa la clave publicable de Supabase, nunca una clave secreta.',503);
  if(publishableKey.split('.').length===3){try{if(JSON.parse(Buffer.from(publishableKey.split('.')[1],'base64url')).role!=='anon')throw new Error();}catch{throw new AppError('La clave debe ser publicable o anon, no service_role.',503);}}
  return {url,publishableKey,siteUrl,callbackUrl:`${siteUrl}/auth/callback`};
}
// Every database request uses the caller's verified JWT, never service_role.
export async function userContext(req,fetcher=fetch) {
  const authorization=req.headers.authorization;
  if(typeof authorization!=='string'||!/^Bearer \S+$/.test(authorization))throw new AppError('Inicia sesión para acceder a tus datos.',401);
  const config=publicConfig();
  const headers={apikey:config.publishableKey,Authorization:authorization,'Content-Type':'application/json'};
  let response;
  try{response=await fetcher(`${config.url}/auth/v1/user`,{headers,signal:AbortSignal.timeout(15000)});}catch{throw new AppError('No se pudo verificar la sesión con Supabase.',503);}
  if(response.status===401||response.status===403)throw new AppError('Tu sesión expiró. Inicia sesión nuevamente.',401);
  if(!response.ok)throw new AppError('Supabase Auth no está disponible.',503);
  const user=await response.json();
  if(!user.id)throw new AppError('Sesión inválida.',401);
  return {user,async rpc(name,args={}) {
    let r;
    try{r=await fetcher(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(45000)});}catch{throw new AppError('No se pudo conectar con tu base de datos.',503);}
    const result=await r.json();
    if(!r.ok){
      if(r.status===401)throw new AppError('Tu sesión expiró. Inicia sesión nuevamente.',401);
      if(result.code==='P0001')throw new AppError(result.message);
      throw new AppError('No se pudo guardar o consultar tus datos. Verifica la migración de Supabase.',503);
    }
    return result;
  }};
}
export const snapshot=ctx=>ctx.rpc('budget_snapshot');
export const importRows=(ctx,rows,name,content)=>ctx.rpc('budget_import',{p_rows:rows,p_name:name,p_content:content});
