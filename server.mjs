import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,relative,isAbsolute,sep} from 'node:path';
const root=resolve('dist');const port=Number(process.env.PORT||3000);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json'};
createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
 if(pathname==='/api/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,app:'eletrify',version:'1.0.0'}));return;}
 if(pathname==='/config.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end('window.ELETRIFY_CONFIG='+JSON.stringify({supabaseUrl:process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||'',supabaseKey:process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||''})+';');return;}
 try{let path=resolve(root,'.'+decodeURIComponent(pathname));const relativePath=relative(root,path);if(relativePath==='..'||relativePath.startsWith('..'+sep)||isAbsolute(relativePath)){res.writeHead(403);res.end();return;}try{if(!(await stat(path)).isFile())path=resolve(root,'index.html');}catch{if(extname(pathname)){res.writeHead(404);res.end('Not found');return;}path=resolve(root,'index.html');}
 const body=await readFile(path);res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.setHeader('Cache-Control',extname(path)==='.html'?'no-cache':'public, max-age=3600');res.writeHead(200);res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(500);res.end('Unable to serve Eletrify');}
}).listen(port,'0.0.0.0',()=>console.log('Eletrify running on port '+port));
