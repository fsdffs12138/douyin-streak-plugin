import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await cp('public', 'dist', {recursive:true});
await build({entryPoints:['src/background.ts','src/options.ts'],bundle:true,outdir:'dist',format:'esm',target:'chrome120'});
await build({entryPoints:['src/content.ts'],bundle:true,outdir:'dist',format:'iife',target:'chrome120',loader:{'.css':'text','.svg':'text'}});
console.log('已生成 dist，可作为解压后的扩展加载。');
