#!/usr/bin/env node
// Bundle the actual host MentionPicker into the isolated, offline plugin UI.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--host')) throw new Error('Usage: node tools/build-ui.mjs [--host <host repository>]');
const hostRoot = resolve(args[1] || resolve(pluginRoot, '../../AI-Canvas-tauri'));
const requireHost = createRequire(resolve(hostRoot, 'package.json'));
const importHost = (name) => import(pathToFileURL(requireHost.resolve(name)).href);
const utf8 = async (path) => new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
const [{ build }, postcssModule, tailwindModule, react, server, icons, configModule] = await Promise.all([
  importHost('esbuild'), importHost('postcss'), importHost('tailwindcss'), importHost('react'),
  importHost('react-dom/server'), importHost('lucide-react'), import(pathToFileURL(resolve(hostRoot, 'tailwind.config.js')).href),
]);
const pickerPath = resolve(hostRoot, 'src/components/shared/MentionPicker.tsx');
const selectPath = resolve(hostRoot, 'src/components/shared/Select.tsx');
const timelinePath = resolve(hostRoot, 'src/components/shared/Timeline.tsx');
const referenceChipPath = resolve(hostRoot, 'src/components/shared/referenceChipDom.ts');
const uiKitPath = resolve(hostRoot, 'src/styles/ui-kit.css');
const basePath = resolve(hostRoot, 'src/styles/base.css');
const pickerCssPath = resolve(hostRoot, 'src/styles/mention-picker.css');
const [source, pickerSource, baseCss, pickerCss, uiKitCss, selectSource, timelineSource, manifestSource, referenceChipSource, referenceEditorSource] = await Promise.all([
  utf8(resolve(pluginRoot, 'src/ui.js')), utf8(pickerPath), utf8(basePath), utf8(pickerCssPath), utf8(uiKitPath), utf8(selectPath), utf8(timelinePath), utf8(resolve(pluginRoot, 'manifest.json')),
  utf8(referenceChipPath), utf8(resolve(pluginRoot, 'src/referenceEditor.js')),
]);
const cssConfig = { ...configModule.default, content: [{ raw: pickerSource, extension: 'tsx' }, { raw: selectSource, extension: 'tsx' }, { raw: timelineSource, extension: 'tsx' }, { raw: source, extension: 'js' }, { raw: referenceChipSource, extension: 'ts' }, { raw: referenceEditorSource, extension: 'js' }] };
const postcss = postcssModule.default;
// Share design tokens, not the host window's fixed layout and scrolling policy.
// Inspect top-level AST nodes only: descendant selectors and application rules stay in the host.
const parsedBaseCss = postcss.parse(baseCss, { from: basePath });
const sharedBaseCss = parsedBaseCss.clone({ nodes: [] });
const themeSelectors = new Set([':root', "[data-theme='light']", '[data-theme="light"]']);
const includedThemes = new Set();
for (const node of parsedBaseCss.nodes) {
  if (node.type === 'atrule' && node.name === 'tailwind' && ['base', 'components', 'utilities'].includes(node.params.trim())) {
    sharedBaseCss.append(node.clone());
  } else if (node.type === 'rule' && themeSelectors.has(node.selector.trim())) {
    const themeRule = node.clone({ nodes: [] });
    for (const declaration of node.nodes) {
      if (declaration.type === 'decl' && (declaration.prop.startsWith('--') || declaration.prop === 'color-scheme')) {
        themeRule.append(declaration.clone());
      }
    }
    if (themeRule.nodes.length) {
      sharedBaseCss.append(themeRule);
      includedThemes.add(node.selector.trim() === ':root' ? 'dark' : 'light');
    }
  }
}
if (!includedThemes.has('dark') || !includedThemes.has('light')) throw new Error('Host base CSS must provide both shared theme token rules');
const compiledCss = await postcss([tailwindModule.default(cssConfig)]).process(sharedBaseCss, { from: basePath });

// Iconify string icons must be registered locally; its API is unavailable under plugin CSP.
const iconNames = {
  'mdi:vector-square': 'SquareDashed', 'lucide:layers': 'Layers', 'lucide:library': 'Library',
  'lucide:images': 'Images', 'lucide:film': 'Film', 'lucide:image': 'Image',
  'lucide:file-text': 'FileText', 'lucide:music': 'Music', 'lucide:user': 'User',
  'lucide:landmark': 'Landmark', 'lucide:box': 'Box', 'lucide:play': 'Play', 'lucide:pause': 'Pause',
};
const localIcons = Object.fromEntries(Object.entries(iconNames).map(([name, exportName]) => {
  if (!icons[exportName]) throw new Error(`Missing existing lucide icon: ${exportName}`);
  const svg = server.renderToStaticMarkup(react.createElement(icons[exportName]));
  const body = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
  return [name, { width: 24, height: 24, body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>` }];
}));
const virtualModules = {
  '@host/base.css': compiledCss.css,
  '@host/ui-kit.css': uiKitCss,
  '@host/mention-picker.css': pickerCss,
  '@host/plugin-ui-icons': localIcons,
};
const result = await build({
  stdin: { contents: source, resolveDir: resolve(pluginRoot, 'src'), sourcefile: 'video-replica-ui.js', loader: 'js' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', minify: true, jsx: 'automatic',
  sourcemap: false, legalComments: 'inline', nodePaths: [resolve(hostRoot, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'shared-host-picker', setup(builder) {
    builder.onResolve({ filter: /^@host\/MentionPicker$/ }, () => ({ path: pickerPath }));
    builder.onResolve({ filter: /^@host\/Select$/ }, () => ({ path: selectPath }));
    builder.onResolve({ filter: /^@host\/Timeline$/ }, () => ({ path: timelinePath }));
    builder.onResolve({ filter: /^@host\/referenceChipDom$/ }, () => ({ path: referenceChipPath }));
    builder.onResolve({ filter: /^@host\// }, ({ path }) => {
      if (!Object.hasOwn(virtualModules, path)) throw new Error(`Unknown shared import: ${path}`);
      return { path, namespace: 'shared-host' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'shared-host' }, ({ path }) => ({ contents: `export default ${JSON.stringify(virtualModules[path])};`, loader: 'js' }));
  } }],
});
if (result.outputFiles.length !== 1) throw new Error('UI must be a single JavaScript artifact');
const licenseFiles = [
  ['AI Canvas shared UI (Source-Available; retains host license)', resolve(hostRoot, 'LICENSE')],
  ['React', resolve(hostRoot, 'node_modules/react/LICENSE')],
  ['React DOM', resolve(hostRoot, 'node_modules/react-dom/LICENSE')],
  ['Iconify React', resolve(hostRoot, 'node_modules/@iconify/react/license.txt')],
  ['Lucide React', resolve(hostRoot, 'node_modules/lucide-react/LICENSE')],
];
const licenses = await Promise.all(licenseFiles.map(async ([name, path]) => `/*! ${name}\n${(await utf8(path)).replace(/\*\//g, '* /')}\n*/\n`));
const bundled = Buffer.concat([Buffer.from(licenses.join(''), 'utf8'), Buffer.from(result.outputFiles[0].contents)]);
// 安装摘要绑定实际字节，统一上游许可证的换行后再计算摘要。
const output = new TextDecoder('utf-8', { fatal: true }).decode(bundled).replace(/\r\n?/g, '\n');
const bytes = Buffer.from(output, 'utf8');
if (bytes.length > 2 * 1024 * 1024) throw new Error('UI exceeds the host 2 MiB limit');
new Script(output);
if (/sourceMappingURL|D:\\www|D:\/www/.test(output)) throw new Error('UI must not expose build paths or source maps');
const manifest = JSON.parse(manifestSource);
manifest.ui.integrity = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
await writeFile(resolve(pluginRoot, 'ui.js'), bytes);
await writeFile(resolve(pluginRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Built actual MentionPicker: ${bytes.length} bytes; ${manifest.ui.integrity}`);
