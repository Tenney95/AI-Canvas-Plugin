import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';

const source = await readFile(new URL('../src/referenceEditor.js', import.meta.url), 'utf8');
const token = '@{plugin-ref-11111111-1111-4111-8111-111111111111:角色参考}';
class EventStub {
  constructor(type, data = {}) { this.type = type; Object.assign(this, data); }
  preventDefault() { this.defaultPrevented = true; }
}
class NodeStub {
  constructor(doc, tag = '', text = '') {
    this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.nodeType = tag ? 1 : 3;
    this.textContent = text; this.childNodes = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = new Map(); this.className = '';
  }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatchEvent(event) { event.target ||= this; for (const fn of this.listeners.get(event.type) || []) fn(event); return !event.defaultPrevented; }
  dispatch(name, data = {}) { const event = new EventStub(name, data); this.dispatchEvent(event); return event; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
  replaceChildren() { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; }
  contains(node) { return this === node || this.childNodes.some((child) => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this); this.parentNode = null; }
  closest() { return this.dataset.referenceToken ? this : this.parentNode?.closest(); }
  getBoundingClientRect() { return { left: 20, top: 20, bottom: 42, width: 260, height: 180 }; }
}
function setup(value = '', overrides = {}) {
  const doc = new NodeStub(null, 'document'); doc.ownerDocument = doc;
  const selection = { rangeCount: 0, range: null, getRangeAt() { return this.range; }, removeAllRanges() { this.rangeCount = 0; }, addRange(range) { this.range = range; this.rangeCount = 1; } };
  doc.createElement = (tag) => new NodeStub(doc, tag); doc.createTextNode = (text) => new NodeStub(doc, '', text);
  doc.createRange = () => ({ setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }, setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; } });
  doc.getSelection = () => selection; doc.body = doc.createElement('body');
  doc.defaultView = new NodeStub(doc, 'window'); doc.defaultView.Event = EventStub; doc.defaultView.innerWidth = 1024; doc.defaultView.innerHeight = 768;
  const context = createContext({ buildReferenceChipEl(document, options) {
    const chip = document.createElement('span'); chip.className = 'ui-reference-chip';
    chip.textContent = options.badge || options.label; chip.presentation = options; return chip;
  } });
  new Script(source.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\nglobalThis.editorApi = {createReferenceEditor, referenceSegments, atomicReferenceRange, serializeReferenceEditor};').runInContext(context);
  const editor = context.editorApi.createReferenceEditor(doc, { label: '角色', value, maxLength: 2000,
    resolveReference: (candidate) => candidate === token ? { label: '角色参考', kind: 'image', badge: '#39', thumbnailDataUrl: 'data:image/jpeg;base64,AA==' } : undefined, ...overrides });
  doc.body.appendChild(editor.input); editor.input.focus();
  return { ...editor, doc, api: context.editorApi };
}

test('capsules hide the opaque handle visually and serialize the exact original token', () => {
  const editor = setup(`主角 ${token} 继续动作`);
  const chip = editor.input.childNodes.find((node) => node.dataset.referenceToken);
  assert.equal(chip.textContent, '#39'); assert.equal(chip.presentation.mediaIndex, '(图1)');
  assert.equal(editor.input.value, `主角 ${token} 继续动作`); editor.dispose();
});
test('duplicate references reuse their image index, and metadata repaint preserves value and selection', () => {
  const editor = setup(`${token} ${token}`); editor.input.setSelectionRange(0, token.length);
  editor.refreshReferences();
  assert.deepEqual(editor.input.childNodes.filter((node) => node.dataset.referenceToken).map((node) => node.presentation.mediaIndex), ['(图1)', '(图1)']);
  assert.equal(editor.input.selectionEnd, token.length); assert.equal(editor.input.value, `${token} ${token}`); editor.dispose();
});
test('Backspace and Delete remove the entire token and leave neighboring text intact', () => {
  for (const inputType of ['deleteContentBackward', 'deleteContentForward']) {
    const editor = setup(`前${token}后`); editor.input.setSelectionRange(inputType.endsWith('Backward') ? token.length + 1 : 1);
    assert.equal(editor.input.dispatch('beforeinput', { inputType }).defaultPrevented, true);
    assert.equal(editor.input.value, '前后'); assert.equal(editor.input.selectionStart, 1); editor.dispose();
  }
});
test('copy/cut serialize tokens as plain text and undo restores a complete capsule', () => {
  const editor = setup(`${token}尾`); editor.input.setSelectionRange(0, token.length);
  let copied = ''; const clipboardData = { setData(type, text) { assert.equal(type, 'text/plain'); copied = text; } };
  editor.input.dispatch('cut', { clipboardData }); assert.equal(copied, token); assert.equal(editor.input.value, '尾');
  editor.input.dispatch('keydown', { key: 'z', ctrlKey: true }); assert.equal(editor.input.value, `${token}尾`); editor.dispose();
});
test('paste accepts only plain text and rejects excessive serialized length without losing the draft', () => {
  let limits = 0; const editor = setup('原文', { maxLength: 3, onLimit() { limits++; } }); editor.input.setSelectionRange(2);
  const event = editor.input.dispatch('paste', { clipboardData: { getData(type) { assert.equal(type, 'text/plain'); return '<script>'; } } });
  assert.equal(event.defaultPrevented, true); assert.equal(editor.input.value, '原文'); assert.equal(limits, 1); editor.dispose();
});
test('composition commits once and cleanup removes preview and global subscriptions', () => {
  const editor = setup(token); editor.input.setSelectionRange(token.length);
  editor.input.dispatch('compositionstart'); editor.input.childNodes.at(-1).textContent += '女侠';
  editor.input.dispatch('input', { isComposing: true }); editor.input.dispatch('compositionend');
  assert.equal(editor.input.value, `${token}女侠`);
  const chip = editor.input.childNodes.find((node) => node.dataset.referenceToken);
  editor.input.dispatch('mouseover', { target: chip }); assert.equal(editor.doc.body.childNodes.length, 2);
  editor.dispose(); assert.equal(editor.doc.body.childNodes.length, 1);
  assert.ok([...editor.doc.listeners.values(), ...editor.doc.defaultView.listeners.values(), ...editor.input.listeners.values()].every((listeners) => listeners.size === 0));
});
test('selecting part of a serialized handle expands to atomic token boundaries', () => {
  const editor = setup(''); const selected = editor.api.atomicReferenceRange(`前${token}后`, 5, token.length - 1);
  assert.equal(selected.start, 1); assert.equal(selected.end, token.length + 1); editor.dispose();
});
