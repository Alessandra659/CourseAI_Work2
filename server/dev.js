import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'vite';
import handler from '../api/index.js';
const production=process.argv.includes('--production');
const vite=production?null:await createServer({server:{middlewareMode:true},appType:'spa'});
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.csv':'text/csv','.png':'image/png'};
const root=resolve('dist');
const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')) return handler(req,res);
  if(vite)return vite.middlewares(req,res);
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const path=resolve(root,'.'+(pathname==='/'||pathname==='/auth/callback'?'/index.html':pathname));
    if(!path.startsWith(root+sep)){res.writeHead(403);return res.end();}
    const data=await readFile(path);res.setHeader('Content-Type',types[path.slice(path.lastIndexOf('.'))]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404);res.end('No encontrado');}
});
server.requestTimeout=300000;
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`Pulso disponible en http://localhost:${process.env.PORT||3000}`));
