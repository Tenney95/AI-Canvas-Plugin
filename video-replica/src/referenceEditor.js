import { buildReferenceChipEl } from '@host/referenceChipDom';

const TOKEN = /@\{plugin-ref-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([^{}\r\n]{1,200})\}/gi;
const ZWSP = '\u200b';

export function referenceSegments(value) {
  const parts = []; let end = 0;
  for (const match of String(value).matchAll(TOKEN)) {
    if (match.index > end) parts.push({ text: value.slice(end, match.index), start: end, end: match.index });
    parts.push({ token: match[0], label: match[1], start: match.index, end: match.index + match[0].length });
    end = match.index + match[0].length;
  }
  if (end < value.length) parts.push({ text: value.slice(end), start: end, end: value.length });
  return parts;
}

export function atomicReferenceRange(value, start, end) {
  for (const part of referenceSegments(value)) {
    if (!part.token) continue;
    if (start === end && start > part.start && start < part.end) return { start: part.end, end: part.end };
    if (start > part.start && start < part.end) start = part.start;
    if (end > part.start && end < part.end) end = part.end;
  }
  return { start, end };
}

export function serializeReferenceEditor(root) {
  let text = '';
  const walk = (node) => {
    if (node.nodeType === 3) { text += (node.textContent || '').split(ZWSP).join(''); return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.dataset?.referenceToken) { text += node.dataset.referenceToken; return; }
    if (node.tagName === 'BR') { text += '\n'; return; }
    if (['DIV', 'P'].includes(node.tagName) && text && !text.endsWith('\n')) text += '\n';
    for (const child of node.childNodes || []) walk(child);
  };
  for (const node of root.childNodes) walk(node);
  return text;
}

/** 为现有 textarea 接口提供轻量适配；序列化值始终是宿主签发的原 token。 */
export function createReferenceEditor(doc, options) {
  const input = doc.createElement('div');
  input.className = 'ui-textarea ui-reference-editor';
  input.setAttribute('role', 'textbox'); input.setAttribute('aria-multiline', 'true');
  input.setAttribute('aria-label', options.label); input.dataset.placeholder = options.placeholder || '';
  let disabled = Boolean(options.disabled), composing = false, preview = null, currentValue = '';
  let saved = { start: 0, end: 0 }, beforeEdit = null; const listeners = [], undo = [], redo = [];
  const listen = (target, name, fn, capture = false) => {
    target.addEventListener(name, fn, capture); listeners.push(() => target.removeEventListener(name, fn, capture));
  };
  const clean = (text) => String(text).replace(/\r\n?/g, '\n').split(ZWSP).join('');
  const value = () => serializeReferenceEditor(input);
  const length = (node) => node.nodeType === 3 ? clean(node.textContent || '').length
    : node.dataset?.referenceToken ? node.dataset.referenceToken.length
      : node.tagName === 'BR' ? 1 : serializeReferenceEditor(node).length;
  function offsetAt(target, offset) {
    let before = 0, found = false;
    const walk = (node) => {
      if (found) return;
      if (node === target) {
        before += node.nodeType === 3 ? clean((node.textContent || '').slice(0, offset)).length
          : node.dataset?.referenceToken ? (offset ? length(node) : 0)
            : [...node.childNodes].slice(0, offset).reduce((sum, child) => sum + length(child), 0);
        found = true; return;
      }
      if (node.dataset?.referenceToken && node.contains(target)) { before += offset ? length(node) : 0; found = true; return; }
      if (node.nodeType === 3 || node.dataset?.referenceToken || node.tagName === 'BR') before += length(node);
      else for (const child of node.childNodes || []) walk(child);
    };
    walk(input); return before;
  }
  function selection() {
    const selected = doc.getSelection();
    if (selected?.rangeCount) {
      const range = selected.getRangeAt(0);
      if (input.contains(range.startContainer) && input.contains(range.endContainer)) {
        saved = atomicReferenceRange(value(), offsetAt(range.startContainer, range.startOffset), offsetAt(range.endContainer, range.endOffset));
      }
    }
    return saved;
  }
  function pointAt(offset) {
    let before = 0;
    for (let i = 0; i < input.childNodes.length; i++) {
      const node = input.childNodes[i], size = length(node);
      if (offset <= before + size) {
        if (node.nodeType !== 3) return [input, i + (offset > before ? 1 : 0)];
        let raw = 0, count = 0;
        while (raw < node.textContent.length && count < offset - before) { if (node.textContent[raw] !== ZWSP) count++; raw++; }
        return [node, raw];
      }
      before += size;
    }
    return [input, input.childNodes.length];
  }
  function setSelection(start, end = start) {
    const text = value();
    saved = atomicReferenceRange(text, Math.max(0, Math.min(text.length, start)), Math.max(start, Math.min(text.length, end)));
    const selected = doc.getSelection(); if (!selected) return;
    const range = doc.createRange(); const a = pointAt(saved.start), b = pointAt(saved.end);
    range.setStart(...a); range.setEnd(...b); selected.removeAllRanges(); selected.addRange(range);
  }
  function paint(text, range = saved) {
    hidePreview(); input.replaceChildren(); const indices = { image: new Map(), video: new Map(), audio: new Map() };
    for (const part of referenceSegments(text)) {
      if (!part.token) { input.appendChild(doc.createTextNode(part.text)); continue; }
      const reference = options.resolveReference(part.token);
      const kind = reference?.kind || 'image';
      const media = ['character', 'scene', 'prop'].includes(kind) ? 'image' : kind;
      let mediaIndex;
      if (indices[media]) {
        const indexed = indices[media]; if (!indexed.has(part.token)) indexed.set(part.token, indexed.size + 1);
        mediaIndex = `(${{ image: '图', video: '视频', audio: '音频' }[media]}${indexed.get(part.token)})`;
      }
      const chip = buildReferenceChipEl(doc, { label: reference?.label || part.label, kind: media,
        badge: reference?.badge?.startsWith('#') ? reference.badge : undefined, mediaIndex,
        thumbnailUrl: reference?.thumbnailDataUrl, thumbnailCrop: reference?.thumbnailCrop,
        iconText: { character: '人', scene: '场', prop: '物', text: 'T', audio: '♪', video: 'V', image: 'I' }[kind] || '@' });
      chip.dataset.referenceToken = part.token;
      if (input.childNodes.length === 0) input.appendChild(doc.createTextNode(ZWSP));
      input.appendChild(chip); input.appendChild(doc.createTextNode(ZWSP));
    }
    currentValue = text; input.dataset.empty = String(!text); saved = range;
    if (doc.activeElement === input) setSelection(range.start, range.end);
  }
  function remember() {
    undo.push(beforeEdit || { value: currentValue, ...saved }); if (undo.length > 64) undo.shift(); redo.length = 0;
  }
  function apply(text, range, emit = false) {
    text = clean(text);
    if (text.length > options.maxLength) { input.setAttribute('aria-invalid', 'true'); options.onLimit?.(); beforeEdit = null; paint(currentValue); return false; }
    input.removeAttribute('aria-invalid');
    if (text !== currentValue) remember(); beforeEdit = null; paint(text, range);
    if (emit) input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    return true;
  }
  function replaceSelection(text) {
    const range = selection(), old = value();
    const next = old.slice(0, range.start) + text + old.slice(range.end), caret = range.start + clean(text).length;
    apply(next, { start: caret, end: caret }, true);
  }
  function history(backward) {
    const from = backward ? undo : redo, to = backward ? redo : undo;
    const previous = from.pop(); if (!previous) return;
    to.push({ value: currentValue, ...selection() }); paint(previous.value, { start: previous.start, end: previous.end });
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  }
  function hidePreview() { preview?.remove(); preview = null; }
  function showPreview(event) {
    const chip = event.target.closest?.('[data-reference-token]'); if (!chip || !input.contains(chip) || event.buttons) return;
    hidePreview(); const reference = options.resolveReference(chip.dataset.referenceToken);
    const part = referenceSegments(chip.dataset.referenceToken)[0]; if (!part) return;
    preview = doc.createElement('div'); preview.className = 'ui-reference-preview'; preview.setAttribute('role', 'tooltip');
    if (reference?.thumbnailDataUrl) {
      const image = doc.createElement('img'); image.className = 'ui-reference-preview__image'; image.src = reference.thumbnailDataUrl; image.alt = reference.label;
      preview.appendChild(image);
    }
    const title = doc.createElement('p'); title.className = 'ui-reference-preview__label'; title.textContent = reference?.label || part.label;
    const meta = doc.createElement('span'); meta.className = 'ui-reference-preview__meta';
    meta.textContent = [reference?.badge, reference && (options.kindLabel?.(reference.kind) || reference.kind)].filter(Boolean).join(' · ');
    preview.appendChild(title); preview.appendChild(meta); doc.body.appendChild(preview);
    const rect = chip.getBoundingClientRect(), bounds = preview.getBoundingClientRect();
    preview.style.left = `${Math.max(12, Math.min(rect.left, doc.defaultView.innerWidth - bounds.width - 12))}px`;
    preview.style.top = `${Math.max(12, rect.bottom + bounds.height + 12 <= doc.defaultView.innerHeight ? rect.bottom + 8 : rect.top - bounds.height - 8)}px`;
  }
  Object.defineProperties(input, {
    value: { get: value, set: (text) => { apply(text, saved); } },
    selectionStart: { get: () => selection().start }, selectionEnd: { get: () => selection().end },
    disabled: { get: () => disabled, set: (next) => { disabled = Boolean(next); input.contentEditable = String(!disabled); input.setAttribute('aria-disabled', String(disabled)); } },
  });
  input.setSelectionRange = setSelection;
  input.disabled = disabled; paint(clean(options.value || ''), { start: 0, end: 0 });
  listen(doc, 'selectionchange', selection);
  listen(input, 'compositionstart', () => { beforeEdit = { value: currentValue, ...selection() }; composing = true; hidePreview(); });
  listen(input, 'compositionend', () => { composing = false; const range = selection(); apply(value(), range, true); });
  listen(input, 'input', (event) => { if (!composing && !event.isComposing) { const range = selection(); apply(value(), range); } });
  listen(input, 'beforeinput', (event) => {
    if (disabled || composing || event.isComposing) return;
    beforeEdit = { value: currentValue, ...selection() };
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); history(event.inputType === 'historyUndo'); return; }
    if (['insertParagraph', 'insertLineBreak'].includes(event.inputType)) { event.preventDefault(); replaceSelection('\n'); return; }
    if (!['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) return;
    const range = selection();
    if (range.start !== range.end) { event.preventDefault(); replaceSelection(''); return; }
    const part = referenceSegments(value()).find((item) => item.token && (event.inputType === 'deleteContentBackward' ? item.end === range.start : item.start === range.start));
    if (part) { event.preventDefault(); saved = { start: part.start, end: part.end }; setSelection(saved.start, saved.end); replaceSelection(''); }
  });
  listen(input, 'keydown', (event) => {
    if (disabled || composing || event.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') { event.preventDefault(); history(!event.shiftKey); }
  });
  listen(input, 'paste', (event) => { if (disabled || composing) return; event.preventDefault(); replaceSelection(clean(event.clipboardData?.getData('text/plain') || '')); });
  for (const name of ['copy', 'cut']) listen(input, name, (event) => {
    const range = selection(); if (range.start === range.end || !event.clipboardData) return;
    event.preventDefault(); event.clipboardData.setData('text/plain', value().slice(range.start, range.end));
    if (name === 'cut' && !disabled && !composing) replaceSelection('');
  });
  listen(input, 'drop', (event) => event.preventDefault());
  listen(input, 'mouseover', showPreview); listen(input, 'mouseleave', hidePreview); listen(input, 'blur', hidePreview);
  listen(doc, 'scroll', hidePreview, true); listen(doc.defaultView, 'resize', hidePreview);
  return { input, refreshReferences() { paint(value(), selection()); }, dispose() { hidePreview(); for (const stop of listeners) stop(); } };
}
