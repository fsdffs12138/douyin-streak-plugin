import {build} from 'esbuild';
import http from 'node:http';
const {outputFiles}=await build({entryPoints:['tests/fixtures/floating-qa.ts'],bundle:true,write:false,format:'iife',target:'chrome120',loader:{'.css':'text','.svg':'text'}});
const bundle=outputFiles[0].contents;
http.createServer((req,res)=>{
  if(req.url==='/fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(bundle);return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'none'"}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>续火本地界面验证</title><body><script src="/fixture.js"></script></body></html>');
}).listen(4319,'127.0.0.1',()=>console.log('本地验证：http://127.0.0.1:4319（无发送能力）'));
