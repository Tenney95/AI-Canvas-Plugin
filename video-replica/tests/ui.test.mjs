import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';

const source = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
const sample = 'data:image/jpeg;base64,AA==';
const shot = (key, inPoint, outPoint) => ({ key, inPoint, outPoint, description: '', prompt: '' });
const clone = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));

class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {};
    this.attributes = {}; this.listeners = new Map(); this.textContent = ''; this.className = '';
    this.scrollTop = 0;
    this.classList = { toggle: (name, enabled) => { const classes = new Set(this.className.split(' ')); if (enabled) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); } };
  }
  append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
  replaceChildren(...items) { for (const item of this.children) item.parentElement = null; this.children = []; this.scrollTop = 0; this.append(...items); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((item) => item !== this); this.parentElement = null; }
  contains(item) { return item === this || this.children.some((child) => child.contains(item)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatch(name, values = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...values }; for (const fn of this.listeners.get(name) || []) fn(event); return event; }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  querySelector(selector) { return find(this, (item) => selector === '[data-summary]' && Object.hasOwn(item.dataset, 'summary')
    || selector === '[data-quick-summary]' && Object.hasOwn(item.dataset, 'quickSummary')
    || selector === `[data-field="${item.dataset.field}"]`
    || selector === '[data-budget-warning]' && Object.hasOwn(item.dataset, 'budgetWarning')
    || selector === `[data-action="${item.dataset.action}"]`); }
}
function find(root, predicate) {
  for (const node of root.children) { if (predicate(node)) return node; const match = find(node, predicate); if (match) return match; }
  return undefined;
}
function texts(root) { return [root.textContent, ...root.children.map(texts)].flat(Infinity).join(' '); }
// Only the shared React renderer is mocked. Selection/effects/paging/leases remain real source logic.
function mockMentionRenderer(container, onCommit) {
  const doc = container.ownerDocument;
  const renderer = { updates: 0, disposals: 0, props: null,
    update(options) {
      this.updates++; this.props = options; container.replaceChildren();
      const tabs = doc.createElement('div');
      for (const tab of options.tabs) {
        const button = doc.createElement('button'); button.textContent = tab.label; button.dataset.source = tab.id;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(options.activeTab === tab.id));
        button.addEventListener('mousedown', (event) => { event.preventDefault(); options.onTabChange(tab.id); }); tabs.append(button);
      }
      const list = doc.createElement('div'); list.id = options.listId; list.setAttribute('role', 'listbox');
      if (!options.items.length) list.textContent = options.emptyText;
      for (const item of options.items) {
        const button = doc.createElement('button'); button.id = item.domId; button.dataset.mentionId = item.key;
        button.textContent = item.label; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(options.activeKey === item.key));
        button.addEventListener('mousedown', (event) => { event.preventDefault(); item.onSelect(); });
        button.addEventListener('mouseenter', () => options.onItemHover(item.key));
        if (item.thumbnailUrl) { const image = doc.createElement('img'); image.src = item.thumbnailUrl; button.append(image); }
        list.append(button);
      }
      container.append(tabs, list); onCommit();
    },
    dispose() { this.disposals++; container.replaceChildren(); },
  };
  doc.renderers.push(renderer); return renderer;
}
function runtime() {
  const events = new Map(); const revoked = []; const blobs = [];
  const timers = new Map(); let nextTimer = 0;
  const doc = { renderers: [], createElement: (tag) => new Element(tag, doc) };
  const window = {
    __AI_CANVAS_PLUGIN_HOST__: { exports: {} },
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); },
  };
  const context = createContext({ window, Blob, Uint8Array, atob,
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id), URL: {
    createObjectURL: (blob) => { blobs.push(blob); return 'blob:test-preview'; }, revokeObjectURL: (url) => revoked.push(url),
  } });
  // Test-only injection: production bundle exports only its mount function.
  const executable = source.replace(/^import .*;\r?\n/gm, '').replace(/\/\* shared-renderer:start \*\/[\s\S]*?\/\* shared-renderer:end \*\//, `const sharedBaseCss = ''; const sharedPickerCss = ''; const createMentionRenderer = ${mockMentionRenderer.toString()};`);
  new Script(executable.replace('const bridge = window.__AI_CANVAS_PLUGIN_HOST__;',
    'globalThis.helpers = { validateShots, planSamples, parseModelResponse, nodeCount, buildPrompt, generationParameters, mentionRange, mentionItems, segmentLimit, planSegments }; const bridge = window.__AI_CANVAS_PLUGIN_HOST__;')).runInContext(context);
  return { helpers: context.helpers, root: new Element('root', doc), mount: window.__AI_CANVAS_PLUGIN_HOST__.exports.VideoReplica, events, revoked, blobs, renderers: doc.renderers, timers,
    fireTimer() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); } };
}
function props(overrides = {}) {
  return {
    locale: 'zh-CN', theme: 'dark', busy: false, node: { id: 'video-node', data: {} }, parameters: { uiMode: 'advanced' },
    models: [{ id: 'vision', name: 'Vision', category: 'text', provider: 'test', inputModalities: ['text', 'image'] },
      { id: 'general/video-model', name: 'Relay video', category: 'video', provider: 'relay' },
      { id: 'comfyui/video-workflow', name: 'Comfy video workflow', category: 'video', provider: 'comfyui' }],
    resources: { self: [{ resourceId: 'video-resource', origin: 'node-self', source: { nodeId: 'video-node' }, mediaType: 'video/mp4', displayName: 'reference.mp4', size: 1 }] },
    async runEffect(effect) {
      if (effect.type === 'video.extractFrames' && effect.mode === 'preview') return { ok: true, value: {
        video: { duration: 12, width: 1920, height: 1080 }, frames: [{ key: 'preview1', actualTime: 1, previewDataUrl: sample }],
      } };
      if (effect.type === 'video.detectShots') return { ok: true, value: { shots: [{ inPoint: 0, outPoint: 3 }, { inPoint: 3, outPoint: 6 }] } };
      if (effect.type === 'video.extractFrames') return { ok: true, value: {
        frames: effect.samples.map((item) => ({ ...item, requestedTime: item.time, actualTime: item.time, resourceId: `resource-${item.key}`, previewDataUrl: sample })),
        contactSheetResourceId: 'contact-sheet',
      } };
      if (effect.type === 'model.generate') {
        const records = JSON.parse(effect.prompt.split('\n').find((line) => line.startsWith('Shots and user edits: ')).slice(22));
        return { ok: true, value: { text: JSON.stringify({ shots: records.map((record) => ({ ...record, description: 'model description', prompt: 'model prompt', camera: 'pan' })) }) } };
      }
      if (effect.type === 'resource.readRange') return { ok: true, value: { offset: 0, bytes: 1, base64: 'AA==' } };
      throw new Error('unexpected effect');
    },
    async submit() {}, async close() {}, async setParameters() {}, async toast() {}, ...overrides,
  };
}
async function click(root, action) {
  const node = find(root, (item) => item.dataset.action === action);
  assert.ok(node, `button ${action} exists`); assert.equal(Boolean(node.disabled), false, `${action} enabled`);
  node.dispatch('click'); await flush();
}
function edit(root, name, value) {
  const node = find(root, (item) => item.dataset.field === name); assert.ok(node); node.value = value; node.dispatch('input');
}
function select(root, name, value) {
  const node = find(root, (item) => item.dataset.field === name); assert.ok(node); node.value = value; node.dispatch('change');
}
const reference = (i = 1, label = `角色${i}`) => ({ id: `ref-${i}`, label, kind: 'character', token: `@{plugin-ref-00000000-0000-4000-8000-${String(i).padStart(12, '0')}:${label}}` });
const mentionResponse = (items = [reference()], extra = {}) => ({ ok: true, value: { items, hasMore: false, nextOffset: null, ...extra } });
function typeAt(node, value) { node.value = value; node.setSelectionRange(value.length, value.length); node.dispatch('input'); }

test('boundaries reject overlap, out-of-video, >15-second or >6-shot input', () => {
  const { helpers } = runtime();
  assert.deepEqual(clone(helpers.validateShots([shot('b', 3, 6), shot('a', 0, 3)], 10)).map((item) => item.key), ['a', 'b']);
  for (const shots of [[shot('a', 0, 16)], [shot('a', 0, 4), shot('b', 3, 6)], [shot('a', -1, 2)], [shot('a', 9, 11)],
    [shot('a', 0, 1), shot('a', 1, 2)], Array.from({ length: 7 }, (_, i) => shot(`s${i}`, i, i + 1))]) assert.throws(() => helpers.validateShots(shots, 10), /bounds/);
});
test('samples use 1–3 frames per shot and remain ordered, unique and inside intervals', () => {
  const { helpers } = runtime(); const shots = [shot('a', 0, .08), shot('b', .08, .3), shot('c', .3, 3)];
  const samples = clone(helpers.planSamples(shots)); assert.equal(samples.length, 6);
  assert.ok(samples.every((item, i) => i === 0 || item.time > samples[i - 1].time));
  assert.ok(samples.every((item) => { const own = shots.find((record) => item.key.startsWith(`${record.key}_f`)); return item.time > own.inPoint && item.time < own.outPoint; }));
});
test('structured model response rejects wrong keys/times, missing shots and oversize fields', () => {
  const { helpers } = runtime(); const shots = [shot('a', 1, 3)]; const valid = { ...shots[0], description: '<img onerror=alert(1)>', prompt: 'close-up', camera: 'pan' };
  assert.equal(helpers.parseModelResponse(`\`\`\`json\n${JSON.stringify({ shots: [valid] })}\n\`\`\``, shots)[0].description, valid.description);
  for (const value of [{ shots: [] }, { shots: [{ ...valid, key: 'b' }] }, { shots: [{ ...valid, inPoint: 2 }] },
    { shots: [{ ...valid, prompt: '' }] }, { shots: [{ ...valid, description: 'x'.repeat(4001) }] }]) assert.throws(() => helpers.parseModelResponse(JSON.stringify(value), shots), /responseError/);
});
test('analysis prompt includes chronological actual times and explicit JSON schema', () => {
  const { helpers } = runtime(); const prompt = helpers.buildPrompt([shot('a', 0, 3)], [{ key: 'a_f1', requestedTime: .5, actualTime: .48 }], { character: 'new actor' }, 'zh-CN');
  assert.match(prompt, /"actualTime":0.48/); assert.match(prompt, /Example schema/); assert.match(prompt, /Simplified Chinese/); assert.match(prompt, /unknown without audio/);
});
test('node budget counts reference images and every per-shot control', () => {
  const { helpers } = runtime(); const shots = Array.from({ length: 6 }, (_, i) => ({ ...shot(`s${i}`, i, i + 1), frameResourceId: `f${i}` }));
  assert.equal(helpers.nodeCount(shots, ['depth', 'pose', 'canny']), 26); assert.equal(helpers.nodeCount(shots, ['depth']), 14);
  assert.equal(helpers.nodeCount(shots, ['depth', 'pose'], 'model'), 26); assert.equal(helpers.nodeCount(shots, ['depth'], 'comfyui'), 20);
});
test('generation configuration accepts only configured video identities for the chosen backend', () => {
  const { helpers } = runtime(); const models = props().models; const options = { aspectRatio: '16:9', resolution: '720p', generateAudio: false };
  assert.deepEqual(clone(helpers.generationParameters('materials', '', models, options)), { backend: 'materials' });
  assert.deepEqual(clone(helpers.generationParameters('model', 'general/video-model', models, options)), {
    backend: 'model', modelId: 'general/video-model', parameters: { aspectRatio: '16:9', resolution: '720p', generateAudio: false },
  });
  for (const [backend, id] of [['model', 'vision'], ['model', 'unknown'], ['model', 'comfyui/video-workflow'], ['comfyui', 'general/video-model'], ['unknown', 'general/video-model']])
    assert.throws(() => helpers.generationParameters(backend, id, models, options), /generationRequired/);
  assert.throws(() => helpers.generationParameters('model', 'general/video-model', models, { ...options, resolution: 'invalid' }), /generationInvalid/);
});
test('missing local resource fails before any effect and unsupported locale falls back explicitly', () => {
  const ui = runtime(); let effects = 0; const cleanup = ui.mount(ui.root, props({ locale: 'ja-JP', resources: { self: [] }, runEffect: async () => { effects++; } }));
  assert.match(texts(ui.root), /Download and import/); assert.match(texts(ui.root), /uses English/); assert.equal(effects, 0); cleanup();
  assert.ok([...ui.events.values()].every((listeners) => listeners.size === 0));
});
test('detect → analyze → submit preserves human text and sends matching frame handles', async () => {
  const ui = runtime(); let submitted; const options = props({ submit: async (value) => { submitted = value; } });
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect');
  edit(ui.root, 'description', '<script>human edit</script>'); edit(ui.root, 'prompt', 'human generation prompt');
  const model = find(ui.root, (item) => item.dataset.field === 'model'); model.value = 'vision'; model.dispatch('change');
  await click(ui.root, 'analyze'); assert.doesNotMatch(texts(ui.root), /操作失败/);
  await click(ui.root, 'submit'); assert.equal(submitted.operation, 'replicate'); assert.deepEqual(clone(submitted.controls), ['depth']);
  assert.deepEqual(clone(submitted.generation), { backend: 'materials' });
  assert.equal(submitted.shots[0].description, '<script>human edit</script>'); assert.equal(submitted.shots[0].prompt, 'human generation prompt');
  assert.equal(submitted.shots[1].prompt, 'model prompt'); assert.equal(submitted.shots[0].frameKey, `image_${submitted.shots[0].key}`);
  assert.match(submitted.shots[0].frameResourceId, /^resource-/); cleanup();
});
test('both effect ok:false and Promise rejection render a recoverable error', async () => {
  for (const runEffect of [async () => ({ ok: false, error: 'decoder failed' }), async () => { throw new Error('session expired'); }]) {
    const ui = runtime(); const cleanup = ui.mount(ui.root, props({ runEffect })); await flush();
    assert.match(texts(ui.root), /操作失败/); assert.equal(find(ui.root, (item) => item.dataset.action === 'detect').disabled, false); cleanup();
  }
});
test('local keyframes and manual prompts submit without a model call', async () => {
  const ui = runtime(); const effects = []; let submitted;
  const options = props(); const run = options.runEffect;
  options.runEffect = async (value) => { effects.push(value.type); return run(value); };
  options.submit = async (value) => { submitted = value; };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect'); await click(ui.root, 'extract');
  const promptFields = [];
  function collect(node) { for (const child of node.children) { if (child.dataset.field === 'prompt') promptFields.push(child); collect(child); } }
  collect(ui.root); for (const field of promptFields) { field.value = 'manual prompt'; field.dispatch('input'); }
  await click(ui.root, 'submit'); assert.ok(submitted.shots.every((record) => record.frameResourceId)); assert.ok(!effects.includes('model.generate')); cleanup();
});

test('keyframe feedback beside actions explains missing shots and restores button focus', async () => {
  const ui = runtime(); const effects = []; const options = props(); const run = options.runEffect;
  options.runEffect = async (request) => { effects.push(request); return run(request); };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'extract');
  const feedback = find(ui.root, (item) => Object.hasOwn(item.dataset, 'feedback'));
  assert.match(feedback.textContent, /请先点击“检测镜头”或“添加镜头”/); assert.equal(feedback.attributes.role, 'alert');
  assert.equal(feedback.attributes['aria-live'], 'assertive'); assert.equal(feedback.hidden, false);
  const button = find(ui.root, (item) => item.dataset.action === 'extract');
  assert.equal(ui.root.ownerDocument.activeElement, button); assert.equal(button.focusOptions.preventScroll, true);
  assert.equal(effects.length, 1); await click(ui.root, 'detect');
  for (const key of ['shot1', 'shot2']) { const checkbox = find(find(ui.root, (item) => item.dataset.shot === key), (item) => item.type === 'checkbox'); checkbox.checked = false; checkbox.dispatch('change'); }
  await click(ui.root, 'extract'); assert.match(find(ui.root, (item) => Object.hasOwn(item.dataset, 'feedback')).textContent, /勾选至少一个镜头/); cleanup();
});

test('local keyframe feedback shows progress and completion without model calls', async () => {
  const ui = runtime(); let complete; const options = props(); const run = options.runEffect;
  options.runEffect = (request) => request.type === 'video.extractFrames' && request.mode === 'analysis'
    ? new Promise((resolve) => { complete = () => resolve(run(request)); }) : run(request);
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect');
  await click(ui.root, 'extract'); assert.match(find(ui.root, (item) => Object.hasOwn(item.dataset, 'feedback')).textContent, /本地提取逐镜关键帧/);
  assert.equal(find(ui.root, (item) => item.dataset.action === 'extract').disabled, true); complete(); await flush(); await flush();
  const feedback = find(ui.root, (item) => Object.hasOwn(item.dataset, 'feedback')); assert.match(feedback.textContent, /关键帧已提取/); assert.equal(feedback.attributes.role, 'status'); cleanup();
});

test('mention range and candidate validation reject canonical paths and invalid pages', () => {
  const { helpers } = runtime();
  assert.deepEqual(clone(helpers.mentionRange('替换成 @小红', 7, 7)), { start: 4, end: 7, query: '小红' });
  for (const value of ['user@example', '@{node:label}', '@asset{path}', '@foo\nbar']) assert.equal(helpers.mentionRange(value, value.length, value.length), null);
  assert.equal(helpers.mentionItems(mentionResponse().value, 0)[0].token, reference().token);
  for (const value of [{ items: [{ ...reference(), token: '@asset{D%3A%2Fprivate.png}' }], hasMore: false },
    { items: [reference(), reference()], hasMore: false }, { items: [], hasMore: true, nextOffset: 0 }]) assert.throws(() => helpers.mentionItems(value, 0), /mentionInvalid/);
});

test('typing @ opens host-backed tabs and keyboard insertion preserves surrounding text', async () => {
  const ui = runtime(); const requests = []; const options = props(); const run = options.runEffect;
  options.runEffect = async (request) => { if (request.type !== 'prompt.mentions') return run(request); requests.push(request); return mentionResponse([reference(1), reference(2, '<b>场景</b>')]); };
  const cleanup = ui.mount(ui.root, options); await flush();
  const input = find(ui.root, (item) => item.dataset.field === 'character'); typeAt(input, '穿红衣 @'); await flush();
  assert.deepEqual(clone(requests), [{ type: 'prompt.mentions', source: 'nodes', query: '', offset: 0, preview: true }]);
  const picker = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentions')); assert.ok(picker); assert.match(texts(picker), /连线节点.*角色库.*资源库图片/);
  assert.match(texts(picker), /<b>场景<\/b>/); assert.equal(input.dispatch('keydown', { key: 'ArrowDown' }).defaultPrevented, true);
  assert.equal(input.dispatch('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(input.value, `穿红衣 ${reference(2, '<b>场景</b>').token} `); assert.equal(input.selectionStart, input.value.length);
  assert.equal(find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentions')), undefined); assert.equal(ui.root.ownerDocument.activeElement, input);
  assert.equal(input.attributes['aria-expanded'], 'false'); cleanup();
});

test('reference button replaces the saved selection, source/search/page requests use only safe fields', async () => {
  const ui = runtime(); const requests = []; const options = props(); const run = options.runEffect;
  options.runEffect = async (request) => {
    if (request.type !== 'prompt.mentions') return run(request); requests.push(request);
    return request.offset ? mentionResponse([reference(2), reference(3)]) : mentionResponse([reference(1), reference(2)], { hasMore: true, nextOffset: 20 });
  };
  const cleanup = ui.mount(ui.root, options); await flush(); const input = find(ui.root, (item) => item.dataset.field === 'scene');
  input.value = '原有房间文字'; input.setSelectionRange(2, 4); input.dispatch('input');
  find(ui.root, (item) => item.dataset.mentionOpen === 'scene').dispatch('click'); await flush();
  find(ui.root, (item) => item.dataset.source === 'characters').dispatch('mousedown'); await flush();
  const search = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch')); search.value = '夜景'; search.dispatch('input'); await flush();
  find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionMore')).dispatch('click'); await flush();
  assert.deepEqual(clone(requests.at(-1)), { type: 'prompt.mentions', source: 'characters', query: '夜景', offset: 20, preview: true });
  const picker = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentions')); const list = find(picker, (item) => item.attributes.role === 'listbox'); assert.equal(list.children.length, 3);
  find(picker, (item) => item.dataset.mentionId === 'ref-3').dispatch('mousedown'); assert.equal(input.value, `原有${reference(3).token} 文字`); cleanup();
});

test('mentions in replacement requirements and shot prompts remain opaque through analysis/submission', async () => {
  const ui = runtime(); let submitted; const requests = []; const options = props({ submit: async (value) => { submitted = value; } }); const run = options.runEffect;
  options.runEffect = async (request) => { requests.push(request); return request.type === 'prompt.mentions' ? mentionResponse() : run(request); };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect');
  for (const field of ['character', 'scene', 'prompt']) {
    const input = find(ui.root, (item) => item.dataset.field === field); typeAt(input, '@'); await flush(); input.dispatch('keydown', { key: 'Enter' });
  }
  select(ui.root, 'model', 'vision'); await click(ui.root, 'analyze'); await click(ui.root, 'submit');
  assert.equal(submitted.character, `${reference().token} `); assert.equal(submitted.scene, `${reference().token} `); assert.equal(submitted.shots[0].prompt, `${reference().token} `);
  assert.ok(requests.find((request) => request.type === 'model.generate').prompt.includes(reference().token));
  assert.doesNotMatch(JSON.stringify(submitted), /@asset|https?:|filePath|apiKey|D:\\/); cleanup();
});

test('IME input does not query until committed and Escape preserves text', async () => {
  const ui = runtime(); let calls = 0; const options = props(); const run = options.runEffect;
  options.runEffect = async (request) => { if (request.type !== 'prompt.mentions') return run(request); calls++; return mentionResponse(); };
  const cleanup = ui.mount(ui.root, options); await flush(); const input = find(ui.root, (item) => item.dataset.field === 'character');
  input.dispatch('compositionstart'); input.value = '@新'; input.setSelectionRange(2, 2); input.dispatch('input', { isComposing: true }); await flush(); assert.equal(calls, 0);
  input.dispatch('compositionend'); await flush(); assert.equal(calls, 1); input.dispatch('keydown', { key: 'Enter', isComposing: true }); assert.equal(input.value, '@新');
  const search = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch')); search.dispatch('compositionstart'); search.value = '夜景'; search.dispatch('input', { isComposing: true }); await flush(); assert.equal(calls, 1);
  search.dispatch('compositionend'); search.dispatch('input'); await flush(); assert.equal(calls, 2);
  input.dispatch('keydown', { key: 'Escape' }); assert.equal(input.value, '@新'); assert.equal(find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentions')), undefined); cleanup();
});

test('mention queries serialize latest search and ignore stale responses and post-close results', async () => {
  const ui = runtime(); const requests = []; const pending = []; const options = props(); const run = options.runEffect;
  options.runEffect = (request) => request.type !== 'prompt.mentions' ? run(request) : new Promise((resolve) => { requests.push(request); pending.push(resolve); });
  const cleanup = ui.mount(ui.root, options); await flush(); const input = find(ui.root, (item) => item.dataset.field === 'character');
  typeAt(input, '@'); typeAt(input, '@旧'); typeAt(input, '@最新'); assert.equal(requests.length, 1);
  pending.shift()(mentionResponse([reference(1, '过期候选')])); await flush(); assert.equal(requests.length, 2); assert.equal(requests[1].query, '最新'); assert.doesNotMatch(texts(ui.root), /过期候选/);
  pending.shift()(mentionResponse([reference(2, '当前候选')])); await flush(); assert.match(texts(ui.root), /当前候选/);
  const search = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch')); search.value = '关闭后'; search.dispatch('input'); cleanup(); pending.shift()(mentionResponse()); await flush();
  assert.equal(ui.root.children.length, 0); assert.ok([...ui.events.values()].every((listeners) => listeners.size === 0));
});

test('reference query failure and malformed tokens show nearby feedback without changing text', async () => {
  for (const response of [async () => ({ ok: false, error: 'unsupported effect' }), async () => { throw new Error('session expired'); },
    async () => mentionResponse([{ ...reference(), token: '@asset{private-path}' }])]) {
    const ui = runtime(); const options = props(); const run = options.runEffect;
    options.runEffect = (request) => request.type === 'prompt.mentions' ? response() : run(request);
    const cleanup = ui.mount(ui.root, options); await flush(); const input = find(ui.root, (item) => item.dataset.field === 'character'); typeAt(input, '原文 @'); await flush();
    const picker = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentions')); assert.match(texts(picker), /引用查询失败|无效引用/); assert.equal(input.value, '原文 @'); cleanup();
  }
});
test('reanalysis refreshes generated prompts but preserves manual edits and stops at four calls', async () => {
  const ui = runtime(); let calls = 0;
  const options = props(); const run = options.runEffect;
  options.runEffect = async (request) => {
    const reply = await run(request);
    if (request.type === 'model.generate') { const result = JSON.parse(reply.value.text); calls++; for (const record of result.shots) record.prompt = `generated ${calls}`; reply.value.text = JSON.stringify(result); }
    return reply;
  };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect'); edit(ui.root, 'prompt', 'human prompt');
  const model = find(ui.root, (item) => item.dataset.field === 'model'); model.value = 'vision'; model.dispatch('change');
  await click(ui.root, 'analyze'); await click(ui.root, 'analyze');
  const cards = find(ui.root, (item) => item.dataset.shot === 'shot2');
  assert.equal(find(cards, (item) => item.dataset.field === 'prompt').value, 'generated 2');
  assert.equal(find(ui.root, (item) => item.dataset.field === 'prompt').value, 'human prompt');
  await click(ui.root, 'analyze'); await click(ui.root, 'analyze'); await click(ui.root, 'analyze');
  assert.equal(calls, 4); assert.match(texts(ui.root), /额度已用完/); cleanup();
});
test('video-model submission uses safe catalog id and counts background generation nodes', async () => {
  const ui = runtime(); let submitted; const options = props({ submit: async (value) => { submitted = value; } });
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect'); await click(ui.root, 'extract');
  select(ui.root, 'generation-backend', 'model');
  const choices = find(ui.root, (item) => item.dataset.field === 'generation-model');
  assert.deepEqual(choices.children.map((item) => item.value), ['', 'general/video-model']);
  select(ui.root, 'generation-model', 'general/video-model'); select(ui.root, 'generation-ratio', '9:16'); select(ui.root, 'generation-resolution', '720p');
  const promptFields = [];
  function collect(node) { for (const child of node.children) { if (child.dataset.field === 'prompt') promptFields.push(child); collect(child); } }
  collect(ui.root); for (const field of promptFields) { field.value = 'manual video prompt'; field.dispatch('input'); }
  assert.match(texts(ui.root), /8\/25/); assert.match(texts(ui.root), /后台串行生成/);
  await click(ui.root, 'submit'); assert.deepEqual(clone(submitted.generation), {
    backend: 'model', modelId: 'general/video-model', parameters: { aspectRatio: '9:16', resolution: '720p', generateAudio: false },
  }); cleanup();
});
test('ComfyUI mode lists only configured video workflows and never serializes service addresses', async () => {
  const ui = runtime(); let submitted; const cleanup = ui.mount(ui.root, props({ submit: async (value) => { submitted = value; } }));
  await flush(); await click(ui.root, 'detect'); select(ui.root, 'generation-backend', 'comfyui');
  const choices = find(ui.root, (item) => item.dataset.field === 'generation-model'); assert.deepEqual(choices.children.map((item) => item.value), ['', 'comfyui/video-workflow']);
  await click(ui.root, 'submit'); assert.equal(submitted, undefined); assert.match(texts(ui.root), /填写生成提示词/);
  select(ui.root, 'generation-model', 'comfyui/video-workflow');
  const cards = []; function collect(node) { for (const child of node.children) { if (child.dataset.field === 'prompt') cards.push(child); collect(child); } }
  collect(ui.root); for (const field of cards) { field.value = 'workflow prompt'; field.dispatch('input'); }
  await click(ui.root, 'submit'); assert.equal(submitted.generation.backend, 'comfyui'); assert.equal(submitted.generation.modelId, 'comfyui/video-workflow');
  assert.doesNotMatch(JSON.stringify(submitted), /https?:|apiKey|baseUrl|workflowId|filePath/); cleanup();
});
test('generation exceeding 25 nodes rejects submission without dropping selected shots', async () => {
  const ui = runtime(); let submitted = 0; const options = props({ submit: async () => { submitted++; } }); const run = options.runEffect;
  options.runEffect = async (request) => request.type === 'video.detectShots' ? { ok: true, value: {
    shots: Array.from({ length: 6 }, (_, i) => ({ inPoint: i * 2, outPoint: (i + 1) * 2 })),
  } } : run(request);
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect'); await click(ui.root, 'extract');
  const pose = find(ui.root, (item) => item.dataset.control === 'pose'); pose.checked = true; pose.dispatch('change');
  select(ui.root, 'generation-backend', 'model'); select(ui.root, 'generation-model', 'general/video-model');
  assert.match(texts(ui.root), /26\/25/); assert.equal(find(ui.root, (item) => Object.hasOwn(item.dataset, 'budgetWarning')).hidden, false);
  await click(ui.root, 'submit'); assert.equal(submitted, 0); assert.match(texts(ui.root), /不会自动丢弃选中镜头/);
  assert.match(texts(ui.root), /选中 6\/6/); cleanup();
});
test('cleanup blocks a late async result and removes theme/locale listeners', async () => {
  const ui = runtime(); let resolve;
  const cleanup = ui.mount(ui.root, props({ runEffect: () => new Promise((complete) => { resolve = complete; }) }));
  cleanup(); resolve({ ok: true, value: { video: { duration: 3 }, frames: [] } }); await flush();
  assert.equal(ui.root.children.length, 0); assert.ok([...ui.events.values()].every((listeners) => listeners.size === 0));
});
test('locale/theme refresh preserves edits and translates status', async () => {
  const ui = runtime(); const options = props(); const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'detect');
  edit(ui.root, 'description', '人工描述'); options.locale = 'en-US'; options.theme = 'light';
  for (const callback of ui.events.get('ai-canvas-locale-change')) callback();
  assert.match(texts(ui.root), /Shots detected/); assert.match(texts(ui.root), /Reference video → replica assets/);
  assert.equal(find(ui.root, (item) => item.dataset.field === 'description').value, '人工描述');
  assert.equal(find(ui.root, (item) => item.className.startsWith('vr vr-stack')).dataset.theme, 'light'); cleanup();
});
test('playback reads only bounded host ranges and revokes its object URL', async () => {
  const ui = runtime(); const cleanup = ui.mount(ui.root, props()); await flush(); await click(ui.root, 'play');
  assert.ok(find(ui.root, (item) => item.tagName === 'video')); cleanup(); assert.deepEqual(ui.revoked, ['blob:test-preview']);
});
test('playback above the host string limit reads safe consecutive ranges and preserves every byte', async () => {
  const ui = runtime(); const options = props(); const regularEffect = options.runEffect; const requests = [];
  const bytes = Buffer.alloc(400123); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  options.resources.self[0].size = bytes.length;
  options.runEffect = async (effect) => {
    if (effect.type !== 'resource.readRange') return regularEffect(effect);
    requests.push(effect);
    const base64 = bytes.subarray(effect.offset, effect.offset + effect.length).toString('base64');
    assert.ok(base64.length <= 256000, 'actual host string limit');
    return { ok: true, value: { offset: effect.offset, bytes: effect.length, base64 } };
  };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'play');
  assert.deepEqual(requests.map(({ offset, length }) => ({ offset, length })), [
    { offset: 0, length: 184320 }, { offset: 184320, length: 184320 }, { offset: 368640, length: 31483 },
  ]);
  assert.ok(Buffer.from(await ui.blobs[0].arrayBuffer()).equals(bytes));
  assert.match(texts(ui.root), /播放预览已就绪/); cleanup();
});
test('maximum playback size remains within the host range count and byte budgets', async () => {
  const ui = runtime(); const options = props(); const regularEffect = options.runEffect;
  options.resources.self[0].size = 16 * 1024 * 1024; let reads = 0; let total = 0;
  options.runEffect = async (effect) => {
    if (effect.type !== 'resource.readRange') return regularEffect(effect);
    reads++; total += effect.length;
    const base64 = Buffer.alloc(effect.length).toString('base64'); assert.ok(base64.length <= 256000);
    return { ok: true, value: { offset: effect.offset, bytes: effect.length, base64 } };
  };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'play');
  assert.equal(reads, 92); assert.ok(reads <= 96); assert.equal(total, 16 * 1024 * 1024);
  assert.equal(ui.blobs[0].size, total); cleanup();
});
test('range failure is reported as a read failure without creating a partial playback blob', async () => {
  const ui = runtime(); const options = props(); const regularEffect = options.runEffect;
  options.resources.self[0].size = 400123;
  options.runEffect = async (effect) => {
    if (effect.type !== 'resource.readRange') return regularEffect(effect);
    if (effect.offset) return { ok: false, error: 'lease revoked' };
    return { ok: true, value: { offset: 0, bytes: effect.length, base64: Buffer.alloc(effect.length).toString('base64') } };
  };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'play');
  assert.match(texts(ui.root), /播放预览读取失败/); assert.doesNotMatch(texts(ui.root), /lease revoked/);
  assert.equal(ui.blobs.length, 0); assert.ok(find(ui.root, (item) => item.tagName === 'img')); cleanup();
});
test('late playback ranges cannot create blobs or update a closed view', async () => {
  const ui = runtime(); const options = props(); const regularEffect = options.runEffect; let resolveRead;
  options.runEffect = (effect) => effect.type === 'resource.readRange'
    ? new Promise((resolve) => { resolveRead = resolve; }) : regularEffect(effect);
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'play');
  assert.match(texts(ui.root), /正在加载播放预览/); cleanup();
  resolveRead({ ok: true, value: { offset: 0, bytes: 1, base64: 'AA==' } }); await flush();
  assert.equal(ui.blobs.length, 0); assert.equal(ui.root.children.length, 0);
});
test('the view owns its scroll viewport and preserves scroll when actions or theme changes rebuild content', async () => {
  const ui = runtime(); const cleanup = ui.mount(ui.root, props()); await flush();
  assert.match(ui.root.className, /vr-viewport/); ui.root.scrollTop = 560;
  await click(ui.root, 'detect'); assert.equal(ui.root.scrollTop, 560);
  for (const callback of ui.events.get('ai-canvas-theme-change')) callback();
  assert.equal(ui.root.scrollTop, 560); cleanup(); assert.doesNotMatch(ui.root.className, /vr-viewport/);
});
test('browser codec failure revokes playback and keeps thumbnail preview', async () => {
  const ui = runtime(); const cleanup = ui.mount(ui.root, props()); await flush(); await click(ui.root, 'play');
  find(ui.root, (item) => item.tagName === 'video').dispatch('error');
  assert.match(texts(ui.root), /播放预览不可用/); assert.ok(find(ui.root, (item) => item.tagName === 'img'));
  assert.equal(find(ui.root, (item) => item.tagName === 'video'), undefined); assert.deepEqual(ui.revoked, ['blob:test-preview']); cleanup();
});
test('business source avoids HTML injection, direct network, environment and host DOM APIs', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|cssText|!important|\bfetch\s*\(|XMLHttpRequest|window\.parent|document\.body|process\.env|#[0-9a-f]{3,8}\b/i);
});

test('shared renderer receives bounded preview metadata and is disposed on close and rerender', async () => {
  const ui = runtime(); const options = props(); const run = options.runEffect; const requests = [];
  const ref = { ...reference(), thumbnailDataUrl: sample, thumbnailCrop: { x: .1, y: .2, width: .5, height: .6 }, badge: '全局' };
  options.runEffect = (request) => { if (request.type !== 'prompt.mentions') return run(request); requests.push(request); return Promise.resolve(mentionResponse([ref])); };
  const cleanup = ui.mount(ui.root, options); await flush(); let input = find(ui.root, (item) => item.dataset.field === 'character');
  typeAt(input, '@'); await flush(); const first = ui.renderers.at(-1);
  assert.equal(requests[0].preview, true); assert.equal(first.props.items[0].thumbnailUrl, sample);
  assert.deepEqual(clone(first.props.items[0].thumbnailCrop), ref.thumbnailCrop); assert.equal(first.props.items[0].badge, '全局');
  assert.equal(first.props.items[0].icon, 'lucide:user'); assert.equal(first.props.items[0].audioPreviewUrl, undefined);
  input.dispatch('keydown', { key: 'ArrowDown' }); assert.ok(first.updates >= 3);
  input.dispatch('keydown', { key: 'Escape' }); assert.equal(first.disposals, 1);
  typeAt(input, '@'); await flush(); const second = ui.renderers.at(-1);
  options.theme = 'light'; for (const callback of ui.events.get('ai-canvas-theme-change')) callback(); assert.equal(second.disposals, 1);
  input = find(ui.root, (item) => item.dataset.field === 'character'); typeAt(input, '@'); await flush(); const third = ui.renderers.at(-1);
  cleanup(); assert.equal(third.disposals, 1); assert.equal(ui.root.children.length, 0);
});

test('preview metadata rejects raw URLs, oversized pixels, invalid crops and unsafe badges', () => {
  const { helpers } = runtime();
  for (const extra of [{ thumbnailDataUrl: 'https://example.test/image.jpg' }, { thumbnailDataUrl: 'data:image/png;base64,AA==' },
    { thumbnailDataUrl: `data:image/jpeg;base64,${'A'.repeat(10924)}` }, { thumbnailCrop: { x: .8, y: 0, width: .3, height: 1 } },
    { thumbnailCrop: { x: 0, y: 0, width: 0, height: 1 } }, { badge: 'bad\nlabel' }])
    assert.throws(() => helpers.mentionItems({ items: [{ ...reference(), ...extra }], hasMore: false }, 0), /mentionInvalid/);
  const safe = helpers.mentionItems({ items: [{ ...reference(), thumbnailDataUrl: sample, thumbnailUrl: 'file:///private/path', apiKey: 'ignored' }], hasMore: false }, 0)[0];
  assert.equal(safe.thumbnailDataUrl, sample); assert.equal(safe.thumbnailUrl, undefined); assert.equal(safe.apiKey, undefined);
});

const jobSnapshot = (extra = {}) => ({ jobId: 'job-one', status: 'preparing', stage: '提取控制素材', totalSegments: 2, completedSegments: 0, progress: .1, updatedAt: 1, ...extra });
function quickProps(effect, extra = {}) {
  const base = props();
  return props({ parameters: {}, models: [base.models[0], { ...base.models[1], videoCapability: { minDuration: 5, maxDuration: 30, maxVideoReferences: 1 } }, base.models[2]],
    async runEffect(request) {
      if (request.type === 'video.extractFrames' && request.mode === 'preview') return { ok: true, value: { video: { duration: 60, width: 1280, height: 720 }, frames: [] } };
      return effect ? effect(request) : base.runEffect(request);
    }, ...extra });
}
test('full-film segment planning respects model maximums and optional user cuts without gaps', () => {
  const { helpers } = runtime();
  assert.equal(helpers.planSegments(60, [], 30).length, 2); assert.equal(helpers.planSegments(60, [], 15).length, 4);
  const segments = clone(helpers.planSegments(60, [55, 20], 30));
  assert.deepEqual(segments, [{ inPoint: 0, outPoint: 20 }, { inPoint: 20, outPoint: 50 }, { inPoint: 50, outPoint: 55 }, { inPoint: 55, outPoint: 60 }]);
  for (const cuts of [[0], [60], [20, 20], [NaN], ['15']]) assert.throws(() => helpers.planSegments(60, cuts, 30), /invalidCuts/);
  assert.throws(() => helpers.planSegments(301, [], 30), /invalidCuts/);
  assert.equal(helpers.segmentLimit({ videoCapability: { maxDuration: 30, inputConstraints: { referenceVideo: { durationSeconds: { max: 15 } } } } }), 30);
  assert.equal(helpers.segmentLimit({ videoCapability: { durations: [5, 10] } }), 10);
});
test('default one-click mode starts the full film without shot detection or manual extraction', async () => {
  const ui = runtime(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(clone(request)); return { ok: true, value: jobSnapshot() }; })); await flush();
  assert.equal(find(ui.root, (node) => node.dataset.action === 'detect'), undefined);
  assert.match(texts(ui.root), /预计生成 2 段/);
  edit(ui.root, 'character', reference().token); edit(ui.root, 'scene', '新场景'); await click(ui.root, 'quick-start');
  assert.equal(requests.length, 1); assert.equal(requests[0].type, 'video.replicaJob.start');
  assert.equal(requests[0].modelId, 'general/video-model'); assert.equal(requests[0].maxSegmentSeconds, 30);
  assert.equal(requests[0].audioMode, 'original'); assert.equal(requests[0].transcribe, true); assert.equal(requests[0].character, reference().token);
  assert.equal(requests[0].operation, undefined); assert.deepEqual(requests[0].cuts, []); assert.deepEqual(requests[0].controls, ['depth']);
  assert.equal(ui.timers.size, 1); assert.equal([...ui.timers.values()][0].delay, 2000);
  assert.equal(find(ui.root, (node) => node.dataset.field === 'character').disabled, true);
  assert.equal(find(ui.root, (node) => node.dataset.action === 'close').disabled, false);
  cleanup(); assert.equal(ui.timers.size, 0); assert.equal(requests.some((request) => request.type === 'video.replicaJob.cancel'), false);
});
test('manual cut points can be added, removed and reset while overlong intervals remain split', async () => {
  const ui = runtime(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(clone(request)); return { ok: true, value: jobSnapshot({ totalSegments: 3 }) }; })); await flush();
  edit(ui.root, 'cut-time', 20); await click(ui.root, 'add-cut'); assert.match(texts(ui.root), /预计生成 3 段/);
  await click(ui.root, 'remove-cut-20'); assert.match(texts(ui.root), /预计生成 2 段/);
  edit(ui.root, 'cut-time', 20); await click(ui.root, 'add-cut');
  edit(ui.root, 'cut-time', 20); await click(ui.root, 'add-cut'); assert.match(texts(ui.root), /不能重复/);
  await click(ui.root, 'quick-start'); assert.deepEqual(requests[0].cuts, [20]); cleanup();
});
test('first speech model download requires an explicit second click and sends only that authorization', async () => {
  const ui = runtime(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(clone(request)); return { ok: true, value: requests.length === 1 ? { speechModelsRequired: true } : jobSnapshot() }; })); await flush();
  await click(ui.root, 'quick-start'); assert.equal(requests.length, 1); assert.equal(requests[0].downloadSpeech, undefined); assert.equal(ui.timers.size, 0);
  assert.match(texts(ui.root), /首次使用需下载/); await click(ui.root, 'download-speech'); assert.equal(requests[1].downloadSpeech, true); cleanup();
});
test('job status polling backs off, stops on uncertain submission and never submits automatically again', async () => {
  const ui = runtime(); const requests = []; let statusCalls = 0;
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(clone(request));
    return { ok: true, value: request.type.endsWith('.start') ? jobSnapshot() : jobSnapshot({ updatedAt: ++statusCalls + 1, status: statusCalls === 4 ? 'unknown' : 'generating' }) };
  })); await flush(); await click(ui.root, 'quick-start');
  for (let index = 0; index < 3; index++) { assert.equal([...ui.timers.values()][0].delay, 2000); ui.fireTimer(); await flush(); }
  assert.equal([...ui.timers.values()][0].delay, 5000); ui.fireTimer(); await flush(); assert.equal(ui.timers.size, 0);
  assert.match(texts(ui.root), /避免重复付费/); assert.equal(find(ui.root, (node) => node.dataset.action === 'quick-start').disabled, true);
  assert.equal(requests.filter((request) => request.type.endsWith('.start')).length, 1); cleanup();
});
test('cancel is a host job action and late polling cannot reopen a closed panel', async () => {
  const ui = runtime(); let resolvePoll; const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(request.type);
    if (request.type.endsWith('.status')) return new Promise((resolve) => { resolvePoll = resolve; });
    return { ok: true, value: jobSnapshot({ status: request.type.endsWith('.cancel') ? 'cancelled' : 'preparing', updatedAt: request.type.endsWith('.cancel') ? 5 : 1 }) };
  })); await flush(); await click(ui.root, 'quick-start'); ui.fireTimer(); await flush(); await click(ui.root, 'cancel-job');
  assert.match(texts(ui.root), /任务已停止/); cleanup(); resolvePoll({ ok: true, value: jobSnapshot({ status: 'generating', updatedAt: 2 }) }); await flush();
  assert.equal(ui.root.children.length, 0); assert.equal(ui.timers.size, 0); assert.deepEqual(requests, ['video.replicaJob.start', 'video.replicaJob.status', 'video.replicaJob.cancel']);
});
test('reference-incompatible models are skipped for default depth and unknown workflow duration is editable', async () => {
  const ui = runtime(); const base = quickProps(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(request); return { ok: true, value: jobSnapshot() }; },
    { models: [base.models[0], { ...base.models[1], id: 'unsupported', videoCapability: { maxDuration: 30, maxVideoReferences: 0 } }, base.models[2]] })); await flush();
  assert.equal(find(ui.root, (node) => node.dataset.field === 'quick-model').value, 'comfyui/video-workflow'); assert.match(texts(ui.root), /未声明时长/);
  edit(ui.root, 'segment-seconds', 15); select(ui.root, 'audio-mode', 'mute'); await click(ui.root, 'quick-start');
  assert.equal(requests[0].modelId, 'comfyui/video-workflow'); assert.equal(requests[0].audioMode, 'mute'); assert.equal(requests[0].maxSegmentSeconds, 15); cleanup();
});
test('quick mode offers submission-guarded channels while advanced mode keeps other configured models', async () => {
  const ui = runtime(); const base = quickProps();
  const cleanup = ui.mount(ui.root, quickProps(undefined, { models: [
    { ...base.models[1], id: 'apimart/other-video', name: 'Other video', provider: 'apimart' }, ...base.models,
  ] })); await flush();
  const quick = find(ui.root, (node) => node.dataset.field === 'quick-model');
  assert.equal(quick.value, 'general/video-model');
  assert.equal(quick.children.some((node) => node.value === 'apimart/other-video'), false);
  await click(ui.root, 'toggle-advanced'); select(ui.root, 'generation-backend', 'model');
  const advanced = find(ui.root, (node) => node.dataset.field === 'generation-model');
  assert.equal(advanced.children.some((node) => node.value === 'apimart/other-video'), true);
  cleanup();
});
test('reopening a host task restores observation and does not resubmit uncertain generation', async () => {
  const ui = runtime(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(request.type); return { ok: true, value: jobSnapshot({ status: 'unknown', updatedAt: 5 }) }; },
    { parameters: { replicaJob: jobSnapshot({ status: 'unknown', updatedAt: 4 }) } })); await flush();
  assert.deepEqual(requests, ['video.replicaJob.status']); assert.equal(ui.timers.size, 0);
  assert.equal(find(ui.root, (node) => node.dataset.action === 'quick-start'), undefined);
  await click(ui.root, 'refresh-job'); assert.deepEqual(requests, ['video.replicaJob.status', 'video.replicaJob.status']); cleanup();
});
test('observation without source grants shows progress and only queries or cancels the bound task', async () => {
  const ui = runtime(); const requests = [];
  const cleanup = ui.mount(ui.root, props({ parameters: { replicaJob: jobSnapshot() }, resources: { self: [] },
    async runEffect(request) { requests.push(request.type); return { ok: true, value: jobSnapshot({ status: request.type.endsWith('.cancel') ? 'cancelled' : 'preparing', updatedAt: 5 }) }; }
  })); await flush();
  assert.match(texts(ui.root), /复刻进度|提取控制素材/); assert.doesNotMatch(texts(ui.root), /当前节点没有可授权/);
  assert.deepEqual(requests, ['video.replicaJob.status']); assert.equal(find(ui.root, (node) => node.dataset.action === 'play'), undefined);
  await click(ui.root, 'cancel-job'); assert.match(texts(ui.root), /任务已停止/);
  assert.deepEqual(requests, ['video.replicaJob.status', 'video.replicaJob.cancel']); cleanup();
});
test('editable source imports the actual shared picker and generated artifact stays within host limits', async () => {
  assert.match(source, /import MentionPicker from '@host\/MentionPicker'/);
  assert.match(source, /import sharedPickerCss from '@host\/mention-picker\.css'/);
  const artifact = await readFile(new URL('../ui.js', import.meta.url)); assert.ok(artifact.length <= 2 * 1024 * 1024);
  new Script(new TextDecoder('utf-8', { fatal: true }).decode(artifact));
});
