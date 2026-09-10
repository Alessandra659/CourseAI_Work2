import React,{useEffect,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
let connection;
export function authConnection() {
  if(!connection)connection=(async()=>{
    const response=await fetch('/api/index?action=config');const config=await response.json();
    if(!response.ok)throw new Error(config.error||'No se pudo cargar Supabase.');
    const client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return {client,config};
  })().catch(e=>{connection=undefined;throw e;});
  return connection;
}
export async function authHeaders() {
  const {client}=await authConnection();const {data,error}=await client.auth.getSession();
  if(error||!data.session){const e=new Error('Inicia sesión para acceder a tus datos.');e.status=401;throw e;}
  return {Authorization:`Bearer ${data.session.access_token}`};
}
export async function signOut(){const {client}=await authConnection();const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;}
const friendlyError=e=>e.message==='Invalid login credentials'?'Correo o contraseña incorrectos.':e.message==='User already registered'?'Este correo ya tiene una cuenta. Inicia sesión.':e.message;
export function AuthGate({children}) {
  const [session,setSession]=useState(null),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[register,setRegister]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true,subscription;
    const changed=s=>{if(!active)return;setSession(s);setReady(true);setPassword('');if(s&&location.pathname==='/auth/callback')history.replaceState(null,'','/');};
    authConnection().then(async({client})=>{
      if(!active)return;
      subscription=client.auth.onAuthStateChange((_event,s)=>changed(s)).data.subscription;
      const {data,error}=await client.auth.getSession();if(error)throw error;changed(data.session);
    }).catch(e=>{if(active){setError(friendlyError(e));setReady(true);}});
    return()=>{active=false;subscription?.unsubscribe();};
  },[]);
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');
    try {
      const {client,config}=await authConnection();
      const result=register?await client.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:config.callbackUrl}}):await client.auth.signInWithPassword({email:email.trim(),password});
      if(result.error)throw result.error;
      if(!result.data.session)throw new Error('El proyecto todavía exige confirmación de correo. Debe desactivarse Confirm email en Supabase Auth.');
      setSession(result.data.session);setPassword('');
    }catch(e){setError(friendlyError(e));}finally{setBusy(false);}
  }
  if(!ready)return <main className="login"><p role="status">Conectando con tu cuenta…</p></main>;
  if(session)return children(session.user);
  return <main className="login"><div className="login-card"><div className="brand">pulso<span className="brand-dot">.</span></div><h1>{register?'Crea tu espacio personal':'Tu espacio de presupuesto'}</h1><p>Tus CSV, conversaciones y gráficos son privados y sólo están disponibles en tu cuenta.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Contraseña<input type="password" autoComplete={register?'new-password':'current-password'} minLength={register?8:undefined} required value={password} onChange={e=>setPassword(e.target.value)}/></label>{register&&<p className="auth-hint">Usa al menos 8 caracteres. Accederás sin confirmar el correo.</p>}<button className="button primary" disabled={busy}>{busy?'Conectando…':register?'Crear cuenta':'Entrar'}</button></form><button className="button secondary" disabled={busy} onClick={()=>{setRegister(!register);setError('');}}>{register?'Ya tengo una cuenta':'Crear una cuenta'}</button>{error&&<p className="error" role="alert">{error}</p>}</div></main>;
}
