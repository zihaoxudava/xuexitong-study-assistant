import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname,'..');
let count = 0;
async function walk(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    if(['data','node_modules','.git'].includes(entry.name)) continue;
    const file = path.join(dir,entry.name);
    if(entry.isDirectory()) await walk(file);
    else if(/\.(mjs|js)$/.test(file)) {
      const r = spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
      if(r.status !== 0) throw new Error(r.stderr);
      count++;
    }
  }
}
await walk(root);
const manifest = JSON.parse(await readFile(path.join(root,'extension/manifest.json'),'utf8'));
for(const file of [manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(c => c.js)]) await readFile(path.join(root,'extension',file));
if(manifest.manifest_version !== 3 || manifest.permissions.some(p => ['cookies','debugger','webRequest','webRequestBlocking'].includes(p))) throw new Error('扩展权限不符合预期');
console.log(`${count} 个脚本语法检查通过；扩展入口和权限检查通过。`);
