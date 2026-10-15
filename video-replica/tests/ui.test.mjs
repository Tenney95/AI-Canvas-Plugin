import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';

const source = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
const sample = 'data:image/jpeg;base64,AA==';
const clone = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('removed advanced drafts reopen into one-click replication without manual actions', async () => {
  const ui = runtime(); const cleanup = ui.mount(ui.root, props()); await flush();
  for (const action of ['toggle-advanced', 'detect', 'analyze', 'extract', 'submit']) {
    assert.equal(find(ui.root, (node) => node.dataset.action === action), undefined);
  }
  assert.ok(find(ui.root, (node) => node.dataset.action === 'quick-start'));
  assert.ok(find(ui.root, (node) => node.dataset.field === 'cut-time'));
  assert.doesNotMatch(texts(ui.root), /高级：手动镜头|镜头编辑/); cleanup();
});

test('large files prepare one MP4 and native video time drives the timeline', async () => {
  const ui = runtime(); const options = props(); const regular = options.runEffect; const requests = [];
  options.resources.self[0].size = 20 * 1024 * 1024;
  options.runEffect = async (request) => {
    requests.push(clone(request));
    if (request.type === 'video.preparePlayback') return { ok: true, value: {
      resource: { resourceId: 'bounded-preview', mediaType: 'video/mp4', size: 20 * 1024 * 1024 }, hasAudio: false, duration: 12,
    } };
    if (request.type === 'video.readPlayback') {
      const base64Chunks = [];
      for (let start = 0; start < request.length; start += 180 * 1024) base64Chunks.push(Buffer.alloc(Math.min(180 * 1024, request.length - start)).toString('base64'));
      return { ok: true, value: { offset: request.offset, bytes: request.length, base64Chunks } };
    }
    return regular(request);
  };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'play');
  assert.equal(requests.filter((item) => item.type === 'video.preparePlayback').length, 1);
  assert.equal(requests.find((item) => item.type === 'video.readPlayback').resourceId, 'bounded-preview');
  assert.equal(ui.blobs[0].size, 20 * 1024 * 1024);
  assert.ok(requests.filter((item) => item.type === 'video.readPlayback').length < 20);
  const player = find(ui.root, (node) => node.tagName === 'video'); assert.ok(player);
  player.paused = false; player.ended = false; player.currentTime = 3.2; player.dispatch('play');
  ui.fireFrame(9000);
  assert.equal(ui.timelineRenderers.at(-1).options.playhead, 3.2);
  player.currentTime = 3.24; ui.fireFrame(12000);
  assert.equal(ui.timelineRenderers.at(-1).options.playhead, 3.24);
  ui.timelineRenderers.at(-1).options.onSeek(8); assert.equal(player.currentTime, 8);
  player.paused = true; player.dispatch('pause'); assert.equal(ui.frames.size, 0);
  assert.match(texts(ui.root), /视频预览 · 无音频/);
  cleanup(); assert.equal(ui.frames.size, 0); assert.deepEqual(ui.revoked, ['blob:test-preview']);
});

test('failed or late large-file preparation never starts a slideshow or creates a blob', async () => {
  for (const late of [false, true]) {
    const ui = runtime(); const options = props(); const regular = options.runEffect; let resolve;
    options.resources.self[0].size = 20 * 1024 * 1024;
    options.runEffect = (request) => request.type === 'video.preparePlayback'
      ? late ? new Promise((done) => { resolve = done; }) : Promise.resolve({ ok: false, error: 'codec' }) : regular(request);
    const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'play');
    if (late) { cleanup(); resolve({ ok: true, value: { resource: { resourceId: 'preview', size: 1, mediaType: 'video/mp4' } } }); await flush(); }
    else { assert.match(texts(ui.root), /播放预览读取失败/); cleanup(); }
    assert.equal(ui.blobs.length, 0); assert.equal(ui.frames.size, 0);
  }
});

class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {};
    this.attributes = {}; this.listeners = new Map(); this.textContent = ''; this.className = ''; this.style = {};
    this.scrollTop = 0;
    this.classList = { toggle: (name, enabled) => { const classes = new Set(this.className.split(' ')); if (enabled) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); } };
  }
  append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
  replaceChildren(...items) { for (const item of this.children) item.parentElement = null; this.children = []; this.scrollTop = 0; this.append(...items); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((item) => item !== this); this.parentElement = null; }
  contains(item) { return item === this || this.children.some((child) => child.contains(item)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatch(name, values = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...values }; for (const fn of this.listeners.get(name) || []) fn(event); return event; }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  querySelector(selector) { return find(this, (item) => selector === '[data-summary]' && Object.hasOwn(item.dataset, 'summary')
    || selector === '[data-timeline-preview]' && Object.hasOwn(item.dataset, 'timelinePreview')
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
// 共享 React 展示和编辑控件使用夹具；选取、effect、分页与租约保留真实 UI 接入逻辑。
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
      if (options.search) {
        const toggle = doc.createElement('button'); toggle.dataset.mentionSearchToggle = '';
        toggle.addEventListener('click', () => {
          if (options.search.expanded) { options.search.onChange(''); options.search.onExpandedChange(false); options.search.onCollapse?.(); }
          else options.search.onExpandedChange(true);
        }); tabs.append(toggle);
        if (options.search.expanded) {
          const input = doc.createElement('input'); input.dataset.mentionSearch = ''; input.value = options.search.value;
          input.addEventListener('input', () => options.search.onChange(input.value));
          input.addEventListener('compositionstart', () => container.parentElement.dispatch('compositionstart', { target: input }));
          input.addEventListener('compositionend', () => container.parentElement.dispatch('compositionend', { target: input }));
          input.addEventListener('keydown', (event) => {
            if (event.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault(); options.search.onChange(''); options.search.onExpandedChange(false); options.search.onCollapse?.();
            } else options.search.onKeyDown?.(event);
          }); tabs.append(input);
        }
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
      container.append(tabs, list); if (options.footer) container.append(options.footer); onCommit();
    },
    dispose() { this.disposals++; container.replaceChildren(); },
  };
  doc.renderers.push(renderer); return renderer;
}
function createSelectRenderer(container, options) {
  const doc = container.ownerDocument;
  const select = doc.createElement('select'); select.dataset.field = options.name;
  select.value = options.value; select.disabled = options.disabled;
  for (const option of options.options) { const node = doc.createElement('option'); node.value = option.value; node.textContent = option.label; node.disabled = Boolean(option.disabled); select.append(node); }
  select.addEventListener('change', () => { if (!select.disabled) options.onChange(select.value); });
  container.append(select);
  const renderer = { options, disposals: 0, dispose() { this.disposals++; container.replaceChildren(); } };
  doc.selectRenderers.push(renderer); return renderer;
}
function mockModelPickerRenderer(container, options) {
  const groupedOptions = options.groups.flatMap((group) => group.items);
  const renderer = createSelectRenderer(container, {
    ...options,
    options: [...(options.clearLabel ? [{ value: '', label: options.clearLabel }] : []), ...groupedOptions],
    onChange: (value) => {
      const group = options.groups.find((candidate) => candidate.items.some((item) => item.value === value));
      const selected = group?.items.find((item) => item.value === value);
      if (value === '' && options.clearLabel || selected && !selected.disabled && !group.disabled) options.onChange(value);
    },
  });
  renderer.options = options; renderer.kind = 'model';
  container.ownerDocument.modelRenderers.push(renderer); return renderer;
}
function mockTimelineRenderer(container) {
  const doc = container.ownerDocument;
  const renderer = { options: null, disposals: 0, updates: 0,
    update(options) {
      this.options = options; this.updates++; container.replaceChildren();
      const input = doc.createElement('input'); input.dataset.field = 'cut-time'; input.value = options.playhead; input.disabled = options.disabled;
      input.addEventListener('input', () => { if (!input.disabled) options.onSeek(Number(input.value)); }); container.append(input);
      const add = (label, action, fn, disabled = options.disabled) => {
        const button = doc.createElement('button'); button.textContent = label; button.dataset.action = action; button.disabled = disabled;
        button.addEventListener('click', () => { if (!button.disabled) fn(); }); container.append(button);
      };
      add(options.labels.addMarker, 'add-cut', () => options.onAddMarker(options.playhead));
      add(options.labels.resetMarkers, 'clear-cuts', options.onResetMarkers, options.disabled || !options.markers.length);
      for (const marker of options.markers) add(String(marker.time), `remove-cut-${marker.time}`, () => options.onRemoveMarker(marker.id));
      for (const segment of options.segments) { const node = doc.createElement('span'); node.textContent = segment.label; container.append(node); }
    },
    dispose() { this.disposals++; container.replaceChildren(); },
  };
  doc.timelineRenderers.push(renderer); return renderer;
}
// 控件本身的真实 DOM/光标/剪贴板逻辑由 referenceEditor.test.mjs 覆盖。
function mockReferenceEditor(doc, options) {
  const input = doc.createElement('div'); input.className = 'ui-textarea ui-reference-editor';
  input.setAttribute('role', 'textbox'); let value = '';
  const paint = () => {
    input.replaceChildren();
    for (const token of value.match(/@\{plugin-ref-[^{}]+\}/g) || []) {
      const reference = options.resolveReference(token); const chip = doc.createElement('span');
      chip.className = 'ui-reference-chip'; chip.dataset.referenceToken = token;
      chip.textContent = reference?.badge || reference?.label || '引用';
      if (reference?.thumbnailDataUrl) { const image = doc.createElement('img'); image.src = reference.thumbnailDataUrl; chip.append(image); }
      input.append(chip);
    }
  };
  Object.defineProperty(input, 'value', { get: () => value, set: (text) => { value = String(text); paint(); } });
  const editor = { input, disposals: 0, refreshReferences: paint, dispose() { this.disposals++; } };
  doc.referenceEditors.push(editor); input.value = options.value; return editor;
}
function runtime() {
  const events = new Map(); const revoked = []; const blobs = [];
  const timers = new Map(); let nextTimer = 0;
  const frames = new Map(); let nextFrame = 0;
  const doc = { referenceEditors: [], timelineRenderers: [], selectRenderers: [], modelRenderers: [], renderers: [],
    createElement: (tag) => new Element(tag, doc), createElementNS: (_namespace, tag) => new Element(tag, doc) };
  doc.documentElement = new Element('html', doc);
  const window = {
    __AI_CANVAS_PLUGIN_HOST__: { exports: {} },
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); },
  };
  const context = createContext({ window, Blob, Uint8Array, atob, createReferenceEditor: mockReferenceEditor,
    createElement: (tag, properties, ...children) => {
      const node = doc.createElement(tag);
      for (const [name, value] of Object.entries(properties || {})) {
        if (name.startsWith('on')) node.addEventListener(name.slice(2).toLowerCase(), value);
        else if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        else if (name === 'className' || name === 'disabled') node[name] = value;
        else node.setAttribute(name, value);
      }
      for (const child of children.flat().filter((item) => item != null)) {
        if (typeof child === 'object') node.append(child); else node.textContent += String(child);
      }
      return node;
    },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    requestAnimationFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    clearTimeout: (id) => timers.delete(id), URL: {
    createObjectURL: (blob) => { blobs.push(blob); return 'blob:test-preview'; }, revokeObjectURL: (url) => revoked.push(url),
  } });
  // Test-only injection: production bundle exports only its mount function.
  const executable = source.replace(/^import .*;\r?\n/gm, '').replace(/\/\* shared-renderer:start \*\/[\s\S]*?\/\* shared-renderer:end \*\//, `const sharedBaseCss = ''; const sharedUiKitCss = ''; const sharedPickerCss = ''; const createTimelineRenderer = ${mockTimelineRenderer.toString()}; const createSelectRenderer = ${createSelectRenderer.toString()}; const createModelPickerRenderer = ${mockModelPickerRenderer.toString()}; const createMentionRenderer = ${mockMentionRenderer.toString()};`);
  new Script(executable.replace('const bridge = window.__AI_CANVAS_PLUGIN_HOST__;',
    'globalThis.helpers = { mentionRange, mentionItems, segmentLimit, planSegments }; const bridge = window.__AI_CANVAS_PLUGIN_HOST__;')).runInContext(context);
  return { helpers: context.helpers, window, root: new Element('root', doc), mount: window.__AI_CANVAS_PLUGIN_HOST__.exports.VideoReplica, events, revoked, blobs, renderers: doc.renderers, selectRenderers: doc.selectRenderers, modelRenderers: doc.modelRenderers, timelineRenderers: doc.timelineRenderers, timers,
    frames, fireFrame(timestamp) { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(timestamp); },
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

test('missing local resource fails before any effect and unsupported locale falls back explicitly', () => {
  const ui = runtime(); let effects = 0; const cleanup = ui.mount(ui.root, props({ locale: 'ja-JP', resources: { self: [] }, runEffect: async () => { effects++; } }));
  assert.match(texts(ui.root), /Download and import/); assert.match(texts(ui.root), /uses English/); assert.equal(effects, 0); cleanup();
  assert.ok([...ui.events.values()].every((listeners) => listeners.size === 0));
});
test('both effect ok:false and Promise rejection render a recoverable error', async () => {
  for (const runEffect of [async () => ({ ok: false, error: 'decoder failed' }), async () => { throw new Error('session expired'); }]) {
    const ui = runtime(); const cleanup = ui.mount(ui.root, props({ runEffect })); await flush();
    assert.match(texts(ui.root), /操作失败/); assert.equal(find(ui.root, (item) => item.dataset.action === 'close').disabled, false); cleanup();
  }
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
  find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearchToggle')).dispatch('click');
  const search = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch')); search.value = '夜景'; search.dispatch('input'); await flush();
  find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionMore')).dispatch('click'); await flush();
  assert.deepEqual(clone(requests.at(-1)), { type: 'prompt.mentions', source: 'characters', query: '夜景', offset: 20, preview: true });
  const picker = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentions')); const list = find(picker, (item) => item.attributes.role === 'listbox'); assert.equal(list.children.length, 3);
  find(picker, (item) => item.dataset.mentionId === 'ref-3').dispatch('mousedown'); assert.equal(input.value, `原有${reference(3).token} 文字`); cleanup();
});

test('shared expandable search restores inline candidates after one collapse without changing the draft', async () => {
  const ui = runtime(); const requests = []; const options = props(); const run = options.runEffect;
  options.runEffect = (request) => {
    if (request.type !== 'prompt.mentions') return run(request);
    requests.push(request); return Promise.resolve(mentionResponse([reference(1, request.query || '原候选')]));
  };
  const cleanup = ui.mount(ui.root, options); await flush();
  const input = find(ui.root, (item) => item.dataset.field === 'character'); typeAt(input, '角色要求 @'); await flush();
  assert.equal(find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch')), undefined);
  find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearchToggle')).dispatch('click');
  const search = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch'));
  search.value = '夜景'; search.dispatch('input'); await flush();
  assert.equal(requests.at(-1).query, '夜景');
  find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearchToggle')).dispatch('click'); await flush();
  assert.equal(find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch')), undefined);
  assert.equal(requests.at(-1).query, ''); assert.equal(requests.length, 3);
  assert.equal(input.value, '角色要求 @'); assert.equal(ui.root.ownerDocument.activeElement, input);
  assert.match(texts(ui.root), /原候选/); cleanup();
});

test('mention placement uses target height and never scrolls the surrounding page', async () => {
  const ui = runtime(); const options = props(); const run = options.runEffect;
  options.runEffect = (request) => request.type === 'prompt.mentions' ? Promise.resolve(mentionResponse()) : run(request);
  const cleanup = ui.mount(ui.root, options); await flush();
  const input = find(ui.root, (item) => item.dataset.field === 'character'); typeAt(input, '@'); await flush();
  const panel = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentions'));
  input.getBoundingClientRect = () => ({ left: 300, top: 500, bottom: 560 });
  panel.parentElement.getBoundingClientRect = () => ({ left: 288, top: 480 });
  panel.getBoundingClientRect = () => ({ width: 336, height: 400 });
  ui.window.innerHeight = 600; ui.window.innerWidth = 800;
  const renderer = ui.renderers.find((item) => !item.disposals);
  renderer.props.onHeightChange(200, true);
  assert.equal(panel.style.top, '-184px'); assert.equal(panel.style.left, '12px');
  assert.match(panel.className, /is-resizing/);
  renderer.props.onHeightChange(200, false); assert.doesNotMatch(panel.className, /is-resizing/);
  cleanup(); assert.ok([...ui.events.values()].every((listeners) => listeners.size === 0));
});

test('reference capsules show safe thumbnails and badges and retain the serialized draft after theme repaint', async () => {
  const ui = runtime(); const options = props(); const run = options.runEffect;
  options.runEffect = (request) => request.type === 'prompt.mentions'
    ? Promise.resolve(mentionResponse([{ ...reference(), badge: '#39', thumbnailDataUrl: sample }])) : run(request);
  const cleanup = ui.mount(ui.root, options); await flush();
  let input = find(ui.root, (item) => item.dataset.field === 'character'); typeAt(input, '替换为 @'); await flush();
  input.dispatch('keydown', { key: 'Enter' });
  const value = `替换为 ${reference().token} `;
  assert.equal(input.value, value); assert.equal(input.attributes.role, 'textbox');
  const chip = find(input, (item) => item.dataset.referenceToken === reference().token);
  assert.equal(chip.textContent, '#39'); assert.equal(chip.children[0].src, sample);
  options.theme = 'light'; for (const callback of ui.events.get('ai-canvas-theme-change')) callback();
  input = find(ui.root, (item) => item.dataset.field === 'character'); assert.equal(input.value, value);
  assert.equal(find(input, (item) => item.dataset.referenceToken === reference().token).textContent, '#39');
  cleanup(); assert.ok(ui.root.ownerDocument.referenceEditors.every((editor) => editor.disposals === 1));
});

test('IME input does not query until committed and Escape preserves text', async () => {
  const ui = runtime(); let calls = 0; const options = props(); const run = options.runEffect;
  options.runEffect = async (request) => { if (request.type !== 'prompt.mentions') return run(request); calls++; return mentionResponse(); };
  const cleanup = ui.mount(ui.root, options); await flush(); const input = find(ui.root, (item) => item.dataset.field === 'character');
  input.dispatch('compositionstart'); input.value = '@新'; input.setSelectionRange(2, 2); input.dispatch('input', { isComposing: true }); await flush(); assert.equal(calls, 0);
  input.dispatch('compositionend'); await flush(); assert.equal(calls, 1); input.dispatch('keydown', { key: 'Enter', isComposing: true }); assert.equal(input.value, '@新');
  find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearchToggle')).dispatch('click');
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
  find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearchToggle')).dispatch('click');
  const search = find(ui.root, (item) => Object.hasOwn(item.dataset, 'mentionSearch')); search.value = '关闭后'; search.dispatch('input'); await flush(); cleanup(); pending.shift()(mentionResponse()); await flush();
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
test('cleanup blocks a late async result and removes theme/locale listeners', async () => {
  const ui = runtime(); let resolve;
  const cleanup = ui.mount(ui.root, props({ runEffect: () => new Promise((complete) => { resolve = complete; }) }));
  cleanup(); resolve({ ok: true, value: { video: { duration: 3 }, frames: [] } }); await flush();
  assert.equal(ui.root.children.length, 0); assert.ok([...ui.events.values()].every((listeners) => listeners.size === 0));
});
test('playback reads only bounded host ranges and revokes its object URL', async () => {
  const ui = runtime(); const cleanup = ui.mount(ui.root, props()); await flush(); await click(ui.root, 'play');
  assert.ok(find(ui.root, (item) => item.tagName === 'video')); cleanup(); assert.deepEqual(ui.revoked, ['blob:test-preview']);
});
test('play and pause share one control, preserve the player and never reread the preview', async () => {
  const ui = runtime(); const options = props(); const regularEffect = options.runEffect; let reads = 0;
  options.runEffect = (request) => { if (request.type === 'resource.readRange') reads++; return regularEffect(request); };
  const cleanup = ui.mount(ui.root, options); await flush(); await click(ui.root, 'play');
  const player = find(ui.root, (item) => item.tagName === 'video'); player.paused = true;
  player.play = async () => { player.paused = false; player.dispatch('play'); };
  player.pause = () => { player.paused = true; player.dispatch('pause'); };
  player.dispatch('loadeddata'); await flush();
  const control = find(ui.root, (item) => item.dataset.action === 'play');
  assert.equal(control.attributes['aria-label'], '暂停'); assert.equal(control.attributes['aria-pressed'], 'true');
  await click(ui.root, 'play'); assert.equal(player.paused, true); assert.equal(control.attributes['aria-label'], '播放');
  await click(ui.root, 'play'); assert.equal(player.paused, false);
  assert.equal(find(ui.root, (item) => item.tagName === 'video'), player); assert.equal(reads, 1);
  player.ended = true; player.currentTime = 12; player.dispatch('ended');
  await click(ui.root, 'play'); assert.equal(player.currentTime, 0); assert.equal(reads, 1); cleanup();
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

test('timeline moves keep marker identity, reject duplicate/end cuts, and submit complete coverage', async () => {
  const ui = runtime(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(clone(request)); return { ok: true, value: jobSnapshot() }; })); await flush();
  const timeline = ui.timelineRenderers.at(-1);
  timeline.options.onAddMarker(20); timeline.options.onAddMarker(40);
  const firstId = timeline.options.markers[0].id;
  timeline.options.onMoveMarker(firstId, 23.1234);
  assert.deepEqual(clone(timeline.options.markers.map(({ time }) => time)), [23.123, 40]);
  assert.equal(timeline.options.markers[0].id, firstId);
  timeline.options.onMoveMarker(firstId, 40); timeline.options.onMoveMarker(firstId, 0); timeline.options.onAddMarker(60);
  assert.deepEqual(clone(timeline.options.markers.map(({ time }) => time)), [23.123, 40]);
  assert.match(texts(ui.root), /不能重复/);
  timeline.options.onSeek(200); assert.equal(timeline.options.playhead, 60);
  timeline.options.onSeek(-1); assert.equal(timeline.options.playhead, 0);
  await click(ui.root, 'quick-start'); assert.deepEqual(requests[0].cuts, [23.123, 40]);
  assert.equal(ui.timelineRenderers.at(-1).options.disabled, true);
  assert.equal(timeline.disposals, 1); cleanup();
  assert.ok(ui.timelineRenderers.every((item) => item.disposals === 1));
});

test('timeline preserves viewport across theme redraw and follows playback without remounting', async () => {
  const ui = runtime(); const cleanup = ui.mount(ui.root, quickProps()); await flush();
  let timeline = ui.timelineRenderers.at(-1);
  timeline.options.onViewChange({ pixelsPerSecond: 50, scrollLeft: 200 });
  for (const fn of ui.events.get('ai-canvas-theme-change')) fn();
  timeline = ui.timelineRenderers.at(-1);
  assert.deepEqual(clone(timeline.options.viewState), { pixelsPerSecond: 50, scrollLeft: 200 });
  await click(ui.root, 'play'); timeline = ui.timelineRenderers.at(-1);
  const player = find(ui.root, (node) => node.tagName === 'video'); assert.ok(player);
  const previousUpdates = timeline.updates; player.currentTime = 18.5; player.dispatch('timeupdate');
  assert.equal(timeline.options.playhead, 18.5); assert.ok(timeline.updates > previousUpdates); assert.equal(timeline.disposals, 0);
  timeline.options.onSeek(7); assert.equal(player.currentTime, 7);
  cleanup(); player.currentTime = 20; player.dispatch('timeupdate'); assert.equal(timeline.disposals, 1);
});

test('scrubbing uses the nearest extracted frame when playback is unavailable', async () => {
  const ui = runtime(); const base = quickProps(async () => ({ ok: true, value: jobSnapshot() }));
  const cleanup = ui.mount(ui.root, { ...base, async runEffect(effect) {
    if (effect.type === 'video.extractFrames') return { ok: true, value: { video: { duration: 60, width: 1280, height: 720 },
      frames: [{ actualTime: 1, previewDataUrl: sample }, { actualTime: 50, previewDataUrl: 'data:image/jpeg;base64,BB==' }] } };
    return base.runEffect(effect);
  } }); await flush();
  const timeline = ui.timelineRenderers.at(-1); timeline.options.onSeek(48);
  assert.equal(find(ui.root, (node) => Object.hasOwn(node.dataset, 'timelinePreview')).src, 'data:image/jpeg;base64,BB==');
  assert.equal(timeline.options.playhead, 48); cleanup();
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
test('host replica support hints control availability independently of model id and provider labels', async () => {
  const ui = runtime(); const base = quickProps(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => {
    requests.push(request); return { ok: true, value: jobSnapshot() };
  }, { models: [base.models[0],
    { ...base.models[1], videoReplicaSupport: { supported: false, reason: '宿主未接入此复刻通道' } },
    { ...base.models[1], id: 'host/new-video', provider: 'host-channel', videoReplicaSupport: { supported: true } },
  ] })); await flush();
  const picker = ui.modelRenderers.find((renderer) => !renderer.disposals && renderer.options.name === 'quick-model');
  assert.equal(picker.options.groups[0].items[0].disabled, true);
  assert.match(picker.options.groups[0].items[0].description, /宿主未接入此复刻通道/);
  assert.equal(find(ui.root, (node) => node.dataset.field === 'quick-model').value, 'host/new-video');
  assert.ok(ui.modelRenderers.find((renderer) => !renderer.disposals && renderer.options.name === 'model').options.clearLabel);
  await click(ui.root, 'quick-start');
  assert.equal(requests[0].modelId, 'host/new-video'); cleanup();
});

test('a catalog with only unsupported replica channels stays visible and cannot start a task', async () => {
  const ui = runtime(); const base = quickProps(); const requests = [];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => { requests.push(request); }, { models: [base.models[0],
    { ...base.models[1], videoReplicaSupport: { supported: false } },
  ] })); await flush();
  const quick = find(ui.root, (node) => node.dataset.field === 'quick-model');
  assert.equal(quick.value, ''); assert.equal(quick.children.length, 1); assert.equal(quick.children[0].disabled, true);
  await click(ui.root, 'quick-start'); assert.equal(requests.length, 0);
  assert.match(texts(ui.root), /选择|请选择/); cleanup();
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
  assert.match(source, /import ModelPicker from '@host\/ModelPicker'/);
  assert.match(source, /import sharedPickerCss from '@host\/mention-picker\.css'/);
  const artifact = await readFile(new URL('../ui.js', import.meta.url)); assert.ok(artifact.length <= 2 * 1024 * 1024);
  new Script(new TextDecoder('utf-8', { fatal: true }).decode(artifact));
});


test('shared selects retain values across theme changes, disable during initialization and unmount with the view', async () => {
  const ui = runtime(); const options = props({ parameters: { uiMode: 'quick' } }); const cleanup = ui.mount(ui.root, options);
  assert.ok(ui.selectRenderers.some((renderer) => renderer.options.disabled));
  await flush();
  const ready = ui.selectRenderers.filter((renderer) => !renderer.disposals);
  assert.ok(ready.length > 0);
  assert.ok(ready.every((renderer) => (renderer.kind === 'model' || renderer.options.fixedMenu) && !renderer.options.disabled));
  select(ui.root, 'audio-mode', 'mute');
  options.theme = 'light'; for (const callback of ui.events.get('ai-canvas-theme-change')) callback();
  assert.ok(ready.every((renderer) => renderer.disposals === 1));
  assert.equal(find(ui.root, (item) => item.dataset.field === 'audio-mode').value, 'mute');
  assert.equal(ui.root.ownerDocument.documentElement.dataset.theme, 'light');
  cleanup(); assert.ok(ui.selectRenderers.every((renderer) => renderer.disposals === 1));
});

test('model menus keep same-provider connections in separate safe groups and preserve execution ids', async () => {
  const ui = runtime(); const base = quickProps(); const requests = [];
  const models = [
    { ...base.models[0], group: { id: 'vision-connection', name: '视觉中转站', badgeText: '中转', tone: 'info' } },
    { ...base.models[1], group: { id: 'relay-connection', name: '第一中转站', description: '已配置连接', tone: 'brand' } },
    { ...base.models[1], id: 'general/ccc-video', name: 'CCC 视频模型', description: '已配置的视频能力',
      group: { id: 'ccc-connection', name: '第二中转站', badgeText: 'CCC', tone: 'success', apiKey: 'fixture-secret', baseUrl: 'https://fixture.invalid' } },
  ];
  const cleanup = ui.mount(ui.root, quickProps(async (request) => {
    requests.push(request); return { ok: true, value: jobSnapshot() };
  }, { models })); await flush();
  const picker = ui.modelRenderers.find((renderer) => !renderer.disposals && renderer.options.name === 'quick-model');
  assert.deepEqual(clone(picker.options.groups.map((group) => group.label)), ['第一中转站', '第二中转站']);
  assert.deepEqual(clone(picker.options.groups.flatMap((group) => group.items.map((item) => item.value))), ['general/video-model', 'general/ccc-video']);
  assert.equal(picker.options.groups[1].badgeText, 'CCC'); assert.equal(picker.options.groups[1].tone, 'success');
  assert.equal(picker.options.groups.every((group) => group.items.every((item) => item.value !== '')), true);
  assert.doesNotMatch(JSON.stringify(picker.options.groups), /apiKey|baseUrl|fixture-secret|fixture\.invalid/);
  edit(ui.root, 'character', '用户已填写的角色要求'); select(ui.root, 'quick-model', 'general/ccc-video');
  assert.equal(find(ui.root, (item) => item.dataset.field === 'character').value, '用户已填写的角色要求');
  select(ui.root, 'model', ''); await click(ui.root, 'quick-start');
  assert.equal(requests[0].modelId, 'general/ccc-video'); assert.equal(requests[0].analysisModelId, undefined);
  cleanup(); assert.ok(ui.modelRenderers.every((renderer) => renderer.disposals === 1));
});

test('older model catalogs fall back to provider groups and reference warnings stay on model items', async () => {
  const ui = runtime(); const base = quickProps();
  const cleanup = ui.mount(ui.root, quickProps(undefined, { models: [base.models[0],
    { ...base.models[1], videoCapability: { maxDuration: 30, maxVideoReferences: 0 } }, base.models[2],
  ] })); await flush();
  const quick = ui.modelRenderers.find((renderer) => !renderer.disposals && renderer.options.name === 'quick-model');
  assert.deepEqual(clone(quick.options.groups.map((group) => group.label)), ['relay', '工作流']);
  assert.equal(quick.options.groups[1].badgeText, 'WF');
  assert.equal(quick.options.groups[1].items[0].value, 'comfyui/video-workflow');
  const incompatible = quick.options.groups[0].items[0];
  assert.equal(incompatible.label, 'Relay video'); assert.match(incompatible.description, /不支持参考视频/);
  assert.match(incompatible.title, /不支持参考视频/); assert.equal(incompatible.value, 'general/video-model');
  cleanup(); assert.ok(ui.modelRenderers.every((renderer) => renderer.disposals === 1));
});
