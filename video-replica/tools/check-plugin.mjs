import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let hostRoot = resolve(root, '../../AI-Canvas-tauri');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--refresh') continue;
  if (args[i] === '--host' && args[i + 1] && !args[i + 1].startsWith('--')) {
    hostRoot = resolve(args[++i]); continue;
  }
  throw new Error('用法：node tools/check-plugin.mjs [--host 宿主目录] [--refresh]');
}
const utf8 = new TextDecoder('utf-8', { fatal: true });
const manifestPath = resolve(root, 'manifest.json');
const manifest = JSON.parse(utf8.decode(await readFile(manifestPath)));
const ui = await readFile(resolve(root, manifest.ui.entry));
utf8.decode(ui);
const integrity = `sha256-${createHash('sha256').update(ui).digest('hex')}`;
if (args.includes('--refresh')) {
  manifest.ui.integrity = integrity;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
} else if (manifest.ui.integrity !== integrity) {
  throw new Error('ui.js 摘要不匹配；审核修改后用 --refresh 更新');
}
const { checkPlugin } = await import(pathToFileURL(resolve(hostRoot, 'scripts/plugin-dev.mjs')).href);
await checkPlugin(root);
process.stdout.write(`插件清单、UTF-8、UI 语法和摘要校验通过：${manifest.id}\n`);
