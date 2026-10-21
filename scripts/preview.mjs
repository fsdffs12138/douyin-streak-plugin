import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist');
const server=http.createServer(async(req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(path==='/'?'/options.html':path));
  if(!file.startsWith(root+ '\\')&&!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  try{
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(file)]||'application/octet-stream'});
    res.end(data);
  }catch{res.writeHead(404).end();}
});
server.listen(4318,'127.0.0.1',()=>console.log('扩展界面预览：http://127.0.0.1:4318（不具备发送能力）'));
