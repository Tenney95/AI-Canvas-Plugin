/* Editable source; tools/build-ui.mjs bundles the host's actual shared picker. */
import { createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { addIcon } from '@iconify/react';
import MentionPicker from '@host/MentionPicker';
import Select from '@host/Select';
import ModelPicker from '@host/ModelPicker';
import Timeline from '@host/Timeline';
import sharedUiKitCss from '@host/ui-kit.css';
import sharedPickerCss from '@host/mention-picker.css';
import sharedBaseCss from '@host/base.css';
import sharedIcons from '@host/plugin-ui-icons';
import { createReferenceEditor } from './referenceEditor.js';

/* shared-renderer:start */
for (const [name, data] of Object.entries(sharedIcons)) addIcon(name, data);
function SharedMentionView({ pickerProps, onCommit }) {
  useLayoutEffect(onCommit);
  return createElement(MentionPicker, pickerProps);
}
function createMentionRenderer(container, onCommit) {
  const reactRoot = createRoot(container);
  let disposed = false;
  return {
    update(pickerProps) {
      if (!disposed) reactRoot.render(createElement(SharedMentionView, { pickerProps, onCommit }));
    },
    dispose() {
      if (disposed) return;
      disposed = true; reactRoot.unmount();
    },
  };
}
function createSelectRenderer(container, selectProps) {
  const reactRoot = createRoot(container);
  let disposed = false;
  const onChange = (value) => {
    if (disposed) return;
    selectProps.onChange(value);
    if (!disposed) reactRoot.render(createElement(Select, { ...selectProps, value, onChange }));
  };
  reactRoot.render(createElement(Select, { ...selectProps, onChange }));
  return { dispose() { if (!disposed) { disposed = true; reactRoot.unmount(); } } };
}
function createModelPickerRenderer(container, pickerProps) {
  const reactRoot = createRoot(container);
  let disposed = false;
  const onChange = (value) => {
    if (disposed) return;
    pickerProps.onChange(value);
    if (!disposed) reactRoot.render(createElement(ModelPicker, { ...pickerProps, value, onChange }));
  };
  reactRoot.render(createElement(ModelPicker, { ...pickerProps, onChange }));
  return { dispose() { if (!disposed) { disposed = true; reactRoot.unmount(); } } };
}
function createTimelineRenderer(container) {
  const reactRoot = createRoot(container); let disposed = false;
  return {
    update(options) { if (!disposed) reactRoot.render(createElement(Timeline, options)); },
    dispose() { if (!disposed) { disposed = true; reactRoot.unmount(); } },
  };
}
/* shared-renderer:end */

/* Self-contained UI. All media and model operations use the host props bridge. */
(function () {
  'use strict';
  const LIMITS = { previewBytes: 16 * 1024 * 1024, previewChunkBytes: 180 * 1024 };
  const STRINGS = {
    'zh-CN': {
      resourceMissing: '当前节点没有可授权的本地视频。请先下载视频并导入当前项目，再打开插件。',
      localeFallback: '当前语言暂无完整翻译，界面使用 English。', loading: '读取视频元数据与缩略图…',
      source: '参考视频', thumbnails: '视频缩略图',
      playLoading: '正在加载播放预览…', playReady: '播放预览已就绪。',
      playPreview: '播放', pausePreview: '暂停',
      videoPlayback: '视频预览', silentPlayback: '视频预览 · 无音频',
      generationRequired: '请选择当前应用可用的视频模型 / ComfyUI 视频工作流。',
      help: '使用说明', segmentHint: '与模型或工作流时长一致', feeNotice: '模型分析与视频生成可能产生费用。',
      playReadError: '播放预览读取失败；请重新打开面板后再试，抽帧预览仍可使用。',
      playError: '播放预览不可用；抽帧预览仍可使用。', settings: '复刻要求', character: '替换角色', characterHint: '留空保留原角色；例如：穿红色风衣的短发女性',
      scene: '替换场景', sceneHint: '留空保留原场景', style: '视觉风格', styleHint: '例如：写实电影、低饱和、逆光',
      controls: '控制视频', depth: '深度 · 构图/空间', pose: '骨架 · 人物动作', canny: '线稿 · 边缘轮廓',
      model: '视觉分析模型', generationModel: '视频模型 / 工作流', chooseVideo: '请选择视频模型', noVideo: '没有可用的视频模型，请在应用厂商配置中添加视频模型。', comfyHint: 'ComfyUI 工作流需配置视频输出与参考图/视频输入映射；控制视频的用途取决于工作流。',
      aspectRatio: '视频比例', resolution: '视频分辨率', modelDefault: '沿用模型默认', close: '关闭', stale: '界面已关闭，迟到结果已丢弃。', error: '操作失败', frame: '参考帧', optional: '可选',
      previewError: '视频预览失败，请检查本地视频编码或重新导入。',
      mention: '插入 @ 引用', mentionHint: '输入 @ 或点击引用；选择连线节点、角色库或资源库中的素材。',
      mentionNodes: '连线节点', mentionCharacters: '角色库', mentionAssets: '资源库图片', mentionSearch: '搜索引用',
      mentionLoading: '查询可引用素材…', mentionEmpty: '没有匹配的可引用素材。', mentionMore: '加载更多',
      mentionError: '引用查询失败，请检查宿主是否支持引用能力后重试。', mentionInvalid: '宿主返回了无效引用，未插入。',
      mentionTextLimit: '插入后文字超过长度限制，请先缩短内容。',
    },
    'en-US': {
      resourceMissing: 'This node has no authorized local video. Download and import the video into the current project first.',
      localeFallback: 'This language is not fully translated; the interface uses English.', loading: 'Reading metadata and thumbnails…',
      source: 'Reference video', thumbnails: 'Video thumbnails',
      playLoading: 'Loading playback preview…', playReady: 'Playback preview is ready.',
      playPreview: 'Play', pausePreview: 'Pause',
      videoPlayback: 'Video preview', silentPlayback: 'Video preview · no audio',
      generationRequired: 'Choose an available video model or ComfyUI workflow.',
      help: 'Instructions', segmentHint: 'Match the model or workflow duration', feeNotice: 'Model analysis and video generation may incur charges.',
      playReadError: 'Playback preview could not be read. Reopen the panel to retry; extracted frame previews remain available.',
      playError: 'Playback unavailable; extracted frame previews remain available.', settings: 'Replica requirements', character: 'Replace character', characterHint: 'Leave empty to keep the original character',
      scene: 'Replace scene', sceneHint: 'Leave empty to keep the original scene', style: 'Visual style', styleHint: 'For example: cinematic, desaturated, backlit',
      controls: 'Control videos', depth: 'Depth · space/composition', pose: 'Pose · character motion', canny: 'Canny · edge contours',
      model: 'Visual analysis model', generationModel: 'Video model / workflow', chooseVideo: 'Choose a video model', noVideo: 'No video models available. Add one in the app provider settings.', comfyHint: 'Configure workflow video output and reference image/video input mappings in ComfyUI settings. Control-video use depends on the workflow.',
      aspectRatio: 'Video aspect ratio', resolution: 'Video resolution', modelDefault: 'Model default', close: 'Close', stale: 'UI closed; late results discarded.', error: 'Operation failed', frame: 'Reference frame', optional: 'Optional',
      previewError: 'Video preview failed. Check the local codec or import again.',
      mention: 'Insert @ reference', mentionHint: 'Type @ or choose a reference from connected nodes, characters or assets.',
      mentionNodes: 'Connected nodes', mentionCharacters: 'Characters', mentionAssets: 'Asset images', mentionSearch: 'Search references',
      mentionLoading: 'Loading available references…', mentionEmpty: 'No matching references available.', mentionMore: 'Load more',
      mentionError: 'Reference query failed. Check host reference support and try again.', mentionInvalid: 'Host returned an invalid reference; nothing was inserted.',
      mentionTextLimit: 'The reference exceeds the text limit. Shorten the text first.',
    },
  };
  Object.assign(STRINGS['zh-CN'], {
    quickTitle: '一键复刻完整视频', quickHint: '自动准备控制视频、识别对白、逐段生成并合成。也可以打点指定切分位置。',
    quickReady: '参考视频已就绪。选择模型后可直接复刻完整视频。', quickStart: '一键复刻',
    quickControlHint: '深度/骨架需要预备本机 ReShot 与权重。宿主检查所选模型的参考视频能力，再生成素材与视频。',
    zoomIn: '放大', zoomOut: '缩小', fitTimeline: '适应', cutMarker: '手动切点', timeline: '生成段时间轴', cutTime: '打点位置（秒）',
    addCut: '添加切点', addPlaybackCut: '在当前播放位置打点', removeCut: '删除切点', clearCuts: '恢复自动分段',
    cutsHint: '首尾自动保留；手动区间超过模型上限时会继续拆分，完整覆盖原片。',
    segmentSeconds: '每段最长（秒）', durationUnknown: '此模型/工作流未声明时长能力，请确认下面的段长符合其设置。',
    incompatibleVideo: '所选模型不支持参考视频，无法使用控制视频，请更换模型。',
    replicaUnavailable: '此通道暂不支持一键全片复刻，请选择其他视频模型或工作流。',
    workflowGroup: '工作流', workflowGroupHint: 'ComfyUI、RunningHub 与工作流 API',
    quickAudio: '成片音频', originalAudio: '保留原片对白、音乐与环境音', modelAudio: '使用模型生成音频', muteAudio: '静音',
    audioHint: '保留原声会覆盖生成片段的音轨；替换角色不会自动克隆或改变声音。',
    transcribe: '提取原声并转写对白', transcribeHint: '使用应用本地语音识别。转写文本用于提示词和对白文档；无需先手工操作。',
    estimated: '预计生成', segments: '段', feeHint: '每段会调用视频模型，视觉分析也可能产生费用。',
    startingJob: '正在检查素材、模型与完整分段…', speechRequired: '本地语音模型尚未就绪。首次使用需下载语音模型，再继续复刻。',
    downloadSpeech: '下载语音模型并继续', jobProgress: '复刻进度', cancelJob: '停止任务', jobContinues: '关闭面板后任务由宿主继续；可在画布查看生成片段和成片。',
    invalidCuts: '切点须为原片内部的有效秒数，不能重复。完整视频最多 300 秒、64 个生成段。', jobInvalid: '宿主返回了无效任务状态，请检查应用版本。',
    refreshJob: '查询任务状态',
    unknownJob: '提交状态不确定，请核对已有片段与厂商任务，避免重复付费。',
    succeededJob: '完整复刻已完成，成片已写回画布。', failedJob: '任务未完成，已生成片段保留在画布。',
    cancelledJob: '任务已停止，已生成片段保留在画布。', pausedJob: '任务已暂停，请在宿主检查已有片段。',
    cutPlaybackMissing: '请先加载播放预览，或使用时间轴/秒数输入打点。',
  });
  Object.assign(STRINGS['en-US'], {
    quickTitle: 'Replicate the complete video', quickHint: 'Prepare controls, transcribe dialogue, generate segments and compose automatically. Optional cuts control segment boundaries.',
    quickReady: 'Reference ready. Choose a model and replicate the complete video.', quickStart: 'Replicate video',
    quickControlHint: 'Depth/pose require prepared local ReShot weights. The host checks model reference-video capabilities before preparing materials and generating videos.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fitTimeline: 'Fit', cutMarker: 'Manual cut', timeline: 'Generation timeline', cutTime: 'Cut position (seconds)',
    addCut: 'Add cut', addPlaybackCut: 'Cut at playback position', removeCut: 'Remove cut', clearCuts: 'Reset automatic segments',
    cutsHint: 'Start and end are kept automatically. Intervals above the model limit are split further; the entire source is covered.',
    segmentSeconds: 'Maximum segment (seconds)', durationUnknown: 'This model/workflow has no declared duration capability. Confirm the segment length matches its settings.',
    incompatibleVideo: 'This model cannot accept reference video. Choose a model that supports control videos.',
    replicaUnavailable: 'This channel does not support complete replication yet. Choose another video model or workflow.',
    workflowGroup: 'Workflows', workflowGroupHint: 'ComfyUI, RunningHub and workflow APIs',
    quickAudio: 'Final audio', originalAudio: 'Keep original dialogue, music and ambience', modelAudio: 'Use generated audio', muteAudio: 'Mute',
    audioHint: 'Original audio replaces generated audio. Replacing a character does not clone or change the voice.',
    transcribe: 'Extract audio and transcribe dialogue', transcribeHint: 'Uses the app’s local speech recognizer. Text is used for prompts and a dialogue document.',
    estimated: 'Estimated generation', segments: 'segments', feeHint: 'Each segment calls the video model. Visual analysis may incur additional fees.',
    startingJob: 'Checking materials, model and complete segmentation…', speechRequired: 'Local speech models are not ready. Download them once to continue replication.',
    downloadSpeech: 'Download speech models and continue', jobProgress: 'Replication progress', cancelJob: 'Stop task', jobContinues: 'The host continues the task after closing this panel. Generated segments and final output appear on the canvas.',
    invalidCuts: 'Cuts must be unique times inside the source. The complete video limit is 300 seconds and 64 segments.', jobInvalid: 'The host returned an invalid task state. Check the app version.',
    refreshJob: 'Refresh task status',
    unknownJob: 'Submission status is unknown. Check existing segments and provider tasks before making another paid request.',
    succeededJob: 'Complete replica saved to the canvas.', failedJob: 'Task incomplete. Generated segments remain on the canvas.',
    cancelledJob: 'Task stopped. Generated segments remain on the canvas.', pausedJob: 'Task paused. Check existing segments in the host.',
    cutPlaybackMissing: 'Load playback first, or add cuts with the timeline/time input.',
  });
  const CSS = `
    .vr-viewport { width: 100%; height: 100vh; height: 100dvh; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
    .vr { --ui-control-h: 28px; --ui-radius: 8px; --ui-radius-md: 7px; --ui-pad: 12px; --ui-pad-sm: 8px;
      color-scheme: dark; box-sizing: border-box; width: 100%; min-width: 0; min-height: 100%; margin: 0; align-content: start;
      padding: var(--ui-pad); color: var(--theme-text); background: var(--theme-bg); font: 12px/1.6 system-ui, sans-serif; }
    .vr[data-theme='light'] { color-scheme: light; }
    .vr *, .vr *::before, .vr *::after { box-sizing: border-box; }
    .vr .ui-card { min-width: 0; border: 1px solid var(--theme-border); border-radius: var(--ui-radius); background: var(--theme-card); }
    .vr .ui-card__header, .vr .ui-card__body, .vr .ui-card__footer { padding: var(--ui-pad); }
    .vr .ui-card__header { border-bottom: 1px solid var(--theme-border); }
    .vr .ui-card__title { margin: 0; font-size: 14px; font-weight: 600; }
    .vr .ui-card__desc, .vr .ui-text-muted { color: var(--theme-text-muted); overflow-wrap: anywhere; }
    .vr .ui-btn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--ui-control-h); padding: 0 8px;
      border: 1px solid var(--theme-border); border-radius: var(--ui-radius-md); background: var(--theme-surface); color: var(--theme-text);
      font: inherit; cursor: pointer; white-space: nowrap; }
    .vr .ui-btn:hover:not(:disabled) { background: var(--theme-hover); }
    .vr .ui-btn--primary { background: var(--brand); color: var(--brand-contrast); }
    .vr .ui-btn--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--brand) 90%, var(--theme-text)); }
    .vr .ui-btn:disabled { opacity: .5; cursor: default; }
    .vr .ui-btn:focus-visible, .vr .ui-input:focus-visible, .vr .ui-textarea:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .vr .ui-input, .vr .ui-textarea { width: 100%; min-width: 0; min-height: var(--ui-control-h); padding: 4px 8px;
      border: 1px solid var(--theme-border); border-radius: var(--ui-radius-md); background: var(--theme-input-bg); color: var(--theme-text); font: inherit; }
    .vr .ui-textarea { min-height: 56px; resize: vertical; }
    .vr .ui-field { display: grid; gap: 4px; min-width: 0; }
    .vr .ui-field__label { color: var(--theme-text-secondary); }
    .vr .vr-field-inline { display: flex; flex-direction: row; align-items: center; gap: 8px; }
    .vr .vr-field-inline > .ui-field__label { flex: 0 0 auto; max-width: 45%; overflow-wrap: anywhere; }
    .vr .vr-field-inline > .ui-input, .vr .vr-field-inline > [data-select-field] { flex: 1 1 0; width: auto; min-width: 0; }
    .vr .vr-field-inline > input[type='number'] { max-width: 128px; font-variant-numeric: tabular-nums; }
    .vr .ui-alert { padding: var(--ui-pad-sm); border: 1px solid var(--theme-border); border-radius: var(--ui-radius); background: var(--theme-surface); overflow-wrap: anywhere; }
    .vr .ui-alert.is-error { border-color: var(--theme-text-secondary); font-weight: 600; }
    .vr.vr-stack, .vr .vr-stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .vr .ui-card__body.vr-stack { gap: 8px; }
    .vr .vr-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .vr .vr-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(240px, .8fr); gap: 12px; }
    .vr .vr-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
    .vr .vr-parameter-pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 8px; }
    .vr .vr-help { margin-left: auto; min-width: 0; color: var(--theme-text-muted); }
    .vr .vr-help > summary { width: fit-content; cursor: pointer; }
    .vr .vr-help > summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .vr .vr-help[open] { flex-basis: 100%; margin-left: 0; }
    .vr .vr-media { display: block; width: 100%; max-height: 240px; object-fit: contain; background: var(--theme-bg); border-radius: var(--ui-radius); }
    .vr .vr-footer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end; }
    .vr .vr-summary { margin-right: auto; color: var(--theme-text-secondary); }

    .vr .vr-progress { width: 100%; accent-color: var(--brand); }
    .vr .ui-field:has(textarea), .vr .ui-field:has(.ui-reference-editor) { position: relative; }
    .vr .vr-mentions { position: absolute; left: 0; width: min(336px, 100%); z-index: 40;
      padding: 0; max-height: calc(100vh - 24px); }
    .vr .vr-mentions.is-resizing { transition: top var(--transition-smooth); }
    @media (prefers-reduced-motion: reduce) { .vr .vr-mentions.is-resizing { transition: none; } }
    .vr [hidden] { display: none; }
    .vr h1 { margin: 0; font-size: 14px; line-height: 1.6; } .vr p { margin: 0; }
    .vr label:has(input[type='checkbox']) { display: inline-flex; gap: 6px; align-items: center; }
    .vr input[type='checkbox'] { accent-color: var(--brand); }
    @media (max-width: 720px) { .vr .vr-grid { grid-template-columns: minmax(0, 1fr); } }
  `;

  function supportsQuickVideo(model) {
    if (typeof model?.videoReplicaSupport?.supported === 'boolean') return model.videoReplicaSupport.supported;
    // Older hosts have no support hint; preserve their existing execution scope.
    return /^(general|comfyui|volcengine)\//.test(model?.id || '');
  }
  function segmentLimit(model, fallback = 15) {
    const capability = model?.videoCapability;
    const candidates = [capability?.maxDuration,
      Array.isArray(capability?.durations) ? Math.max(...capability.durations) : undefined];
    const known = candidates.filter((value) => Number.isFinite(value) && value > 0);
    return Math.min(30, ...(known.length ? known : [fallback]));
  }
  function planSegments(duration, cuts, maximum) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 300 || !Number.isFinite(maximum) || maximum <= 0 || maximum > 30
      || !Array.isArray(cuts) || cuts.length > 63 || cuts.some((cut) => !Number.isFinite(cut) || cut <= 0 || cut >= duration)) throw new Error('invalidCuts');
    const sorted = [...cuts].sort((a, b) => a - b);
    if (sorted.some((cut, index) => index && cut - sorted[index - 1] < .001)) throw new Error('invalidCuts');
    const points = [0, ...sorted, duration], result = [];
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1], end = points[index];
      const count = Math.ceil((end - start - 1e-9) / maximum);
      for (let part = 0; part < count; part++) result.push({ inPoint: start + part * maximum, outPoint: Math.min(end, start + (part + 1) * maximum) });
    }
    if (result.length > 64) throw new Error('invalidCuts');
    return result;
  }

  function mentionRange(value, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > value.length) return null;
    const match = value.slice(0, start).match(/(?:^|\s)@([^@{}\r\n]{0,80})$/);
    return match ? { start: start - match[1].length - 1, end, query: match[1] } : null;
  }
  function mentionItems(value, offset) {
    if (!value || !Array.isArray(value.items) || value.items.length > 50 || typeof value.hasMore !== 'boolean'
      || (value.hasMore && (!Number.isSafeInteger(value.nextOffset) || value.nextOffset <= offset || value.nextOffset > 10000))) throw new Error('mentionInvalid');
    const ids = new Set();
    return value.items.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 160 || ids.has(item.id)
        || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 200
        || !['text', 'image', 'video', 'audio', 'character', 'scene', 'prop'].includes(item.kind)
        || typeof item.token !== 'string' || !/^@\{plugin-ref-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[^{}\r\n]{1,200}\}$/i.test(item.token)) throw new Error('mentionInvalid');
      const normalized = { id: item.id, label: item.label, kind: item.kind, token: item.token };
      // Preview grants contain bounded re-encoded pixels, never an asset URL or path.
      if (item.thumbnailDataUrl !== undefined) {
        if (typeof item.thumbnailDataUrl !== 'string' || item.thumbnailDataUrl.length > 8192 || item.thumbnailDataUrl.length <= 23
          || !/^data:image\/jpeg;base64,(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(item.thumbnailDataUrl)
          || (item.thumbnailDataUrl.length - 23) / 4 * 3 - (item.thumbnailDataUrl.endsWith('==') ? 2 : item.thumbnailDataUrl.endsWith('=') ? 1 : 0) > 8192) throw new Error('mentionInvalid');
        normalized.thumbnailDataUrl = item.thumbnailDataUrl;
      }
      if (item.thumbnailCrop !== undefined) {
        const crop = item.thumbnailCrop;
        if (!crop || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(crop[key]))
          || crop.x < 0 || crop.y < 0 || crop.width < .001 || crop.height < .001
          || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) throw new Error('mentionInvalid');
        normalized.thumbnailCrop = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
      }
      if (item.badge !== undefined) {
        if (typeof item.badge !== 'string' || item.badge.length > 60 || [...item.badge].some((character) => character.charCodeAt(0) < 32)) throw new Error('mentionInvalid');
        normalized.badge = item.badge;
      }
      ids.add(item.id); return normalized;
    });
  }

  const bridge = window.__AI_CANVAS_PLUGIN_HOST__;
  bridge.exports.VideoReplica = function mount(root, props) {
    const doc = root.ownerDocument;
    root.classList.toggle('vr-viewport', true);
    const state = { disposed: false, sequence: 0, busy: false, thumbnails: [], duration: 0,
      width: 0, height: 0, controls: new Set(['depth']), character: '', scene: '', style: '',
      model: '', status: '', error: false, mediaLoading: '', playback: '', playbackAttempted: false, playing: false, playbackAudio: true,
      aspectRatio: '', resolution: '',
      quickModel: '', cuts: [], cutTime: 0, maxSegmentSeconds: 15,
      audioMode: 'original', transcribe: true, job: null, jobRequest: false, speechRequired: false, playbackTime: 0, helpOpen: false };
    const video = (props.resources?.self || []).find((resource) => resource.origin === 'node-self'
      && resource.source?.nodeId === props.node.id && typeof resource.mediaType === 'string' && resource.mediaType.startsWith('video/'));
    const models = (props.models || []).filter((model) => model.category === 'text' && (!model.inputModalities || model.inputModalities.includes('image')));
    const videoModels = (props.models || []).filter((model) => model.category === 'video');
    state.quickModel = videoModels.find((model) => supportsQuickVideo(model) && model.videoCapability?.maxVideoReferences !== 0)?.id || '';
    state.model = models[0]?.id || '';
    const objectUrls = new Set();
    let playbackElement = null;
    let playbackToggle = null;
    let timelineFrame = null;
    let jobTimer = null; let pollAttempts = 0; let pollFailures = 0; let pollInFlight = false;
    let domListeners = [];
    let selectRenderers = [];
    let timelineRenderer = null; let timelineUpdate = null;
    let timelineView = { pixelsPerSecond: null, scrollLeft: 0 };
    let cutIds = new Map(); let nextCutId = 0;
    let activeMention = null; let mentionCounter = 0; let mentionSource = 'nodes'; let mentionInFlight = false; let queuedMention = null;
    const referenceMetadata = new Map(); let referenceEditors = [];
    const t = (key) => (STRINGS[props.locale] || STRINGS['en-US'])[key] || key;
    const jobTerminal = () => Boolean(state.job && ['succeeded', 'failed', 'cancelled', 'paused', 'unknown'].includes(state.job.status));
    const jobActive = () => Boolean(state.job && !jobTerminal());
    const locked = () => state.busy || state.jobRequest || Boolean(state.job);
    const alive = (sequence) => { if (state.disposed || sequence !== state.sequence) throw new Error('stale'); };
    function element(tag, className, content) {
      const node = doc.createElement(tag); if (className) node.className = className;
      if (content !== undefined) node.textContent = String(content); return node;
    }
    function listen(node, name, fn) {
      node.addEventListener(name, fn); domListeners.push(() => node.removeEventListener(name, fn));
    }
    function field(label, value, change, type, placeholder, identifier) {
      const wrap = element(type === 'textarea' ? 'div' : 'label', `ui-field${type === 'textarea' ? '' : ' vr-field-inline'}`);
      const caption = type === 'textarea' ? element('div', 'vr-row justify-between') : wrap;
      caption.append(element('span', 'ui-field__label', label)); if (caption !== wrap) wrap.append(caption);
      const references = type === 'textarea' && ['character', 'scene'].includes(identifier);
      let input, feedback;
      if (references) {
        feedback = element('span', 'ui-text-muted'); feedback.hidden = true; feedback.setAttribute('role', 'status');
        const editor = createReferenceEditor(doc, { label, value: String(value), disabled: locked(), placeholder,
          maxLength: 2000, resolveReference: (token) => referenceMetadata.get(token),
          kindLabel: (kind) => props.locale === 'zh-CN'
            ? ({ image: '图像素材', video: '视频素材', text: '文本内容', character: '角色素材', scene: '场景素材', prop: '道具素材' })[kind]
            : ({ image: 'Image', video: 'Video', text: 'Text', character: 'Character', scene: 'Scene', prop: 'Prop' })[kind],
          onLimit: () => { feedback.textContent = t('mentionTextLimit'); feedback.hidden = false; } });
        referenceEditors.push(editor); input = editor.input;
      } else input = element(type === 'textarea' ? 'textarea' : 'input', type === 'textarea' ? 'ui-textarea' : 'ui-input');
      input.setAttribute('aria-label', label);
      if (type && type !== 'textarea') input.type = type;
      input.value = String(value); input.disabled = locked(); if (placeholder) input.placeholder = placeholder;
      if (identifier) input.dataset.field = identifier;
      if (type === 'number') { input.step = '0.001'; input.min = '0'; input.max = String(state.duration); }
      if (identifier === 'segment-seconds') { input.min = '.001'; input.max = '30'; }
      listen(input, 'input', () => {
        if (feedback && input.getAttribute('aria-invalid') !== 'true') feedback.hidden = true;
        change(type === 'number' ? Number(input.value) : input.value); updateSummary();
      });
      wrap.append(input);
      if (references) { wrap.append(feedback); attachMentions(input, wrap, change, identifier === 'prompt' ? 8000 : 2000, caption); }
      return wrap;
    }
    function closeMentions(restore) {
      queuedMention = null; const current = activeMention; activeMention = null;
      if (!current) return;
      current.sequence++; for (const dispose of current.listeners) dispose(); current.renderer.dispose();
      current.panel.remove(); current.input.setAttribute('aria-expanded', 'false'); current.input.removeAttribute('aria-activedescendant'); current.input.removeAttribute('aria-controls');
      if (restore && !state.disposed) current.input.focus({ preventScroll: true });
    }
    function mentionListen(current, node, name, fn, capture = false) {
      node.addEventListener(name, fn, capture); current.listeners.push(() => node.removeEventListener(name, fn, capture));
    }
    function placeMentions(current) {
      if (state.disposed || activeMention !== current || !current.input.getBoundingClientRect) return;
      const input = current.input.getBoundingClientRect(); const wrap = current.wrap.getBoundingClientRect();
      const panel = current.panel.getBoundingClientRect(); const viewport = window.innerHeight;
      const height = current.targetHeight ?? panel.height;
      const above = viewport - input.bottom < height + 8 && input.top > viewport - input.bottom;
      const desiredTop = above ? input.top - height - 4 : input.bottom + 4;
      const top = Math.max(12, Math.min(desiredTop, viewport - height - 12));
      const left = Math.max(12, Math.min(input.left, window.innerWidth - panel.width - 12));
      current.panel.style.top = `${top - wrap.top}px`;
      current.panel.style.left = `${left - wrap.left}px`;
      current.panel.classList.toggle('is-above', above);
    }
    function renderSharedPicker(current) {
      current.renderer.update({
        tabs: [['nodes', 'mentionNodes', 'lucide:layers'], ['characters', 'mentionCharacters', 'lucide:library'], ['assets', 'mentionAssets', 'lucide:images']]
          .map(([id, key, icon]) => ({ id, label: t(key), icon })),
        activeTab: current.source,
        onTabChange: (source) => {
          if (activeMention !== current || current.source === source) return;
          mentionSource = current.source = source; queryMentions(current, false);
        },
        search: {
          expanded: current.searchExpanded, value: current.query, label: t('mentionSearch'), placeholder: t('mentionSearch'),
          listId: current.listId, activeDescendant: current.items[current.active] ? `${current.listId}-${current.active}` : undefined,
          onExpandedChange: (expanded) => {
            if (activeMention !== current || current.searchExpanded === expanded) return;
            current.searchExpanded = expanded;
            if (!expanded) {
              current.composing = false;
              const changed = current.query !== current.inlineQuery || current.requestedQuery !== current.inlineQuery;
              current.query = current.inlineQuery;
              if (changed) { queryMentions(current, false); return; }
            }
            highlightMentions(current);
          },
          onChange: (value) => {
            if (activeMention !== current || !current.searchExpanded) return;
            const query = value.slice(0, 80);
            if (current.query === query) return;
            current.query = query; renderSharedPicker(current);
            // 先合并同一事件中的清空/收起，避免关闭搜索再发起一次无用查询。
            void Promise.resolve().then(() => {
              if (activeMention === current && current.searchExpanded && !current.composing && current.query === query) queryMentions(current, false);
            });
          },
          onKeyDown: (event) => mentionKeydown(current, event),
          onCollapse: () => { if (activeMention === current) current.input.focus({ preventScroll: true }); },
        },
        onHeightChange: (height, animated) => {
          if (activeMention !== current) return;
          current.targetHeight = height; current.panel.classList.toggle('is-resizing', animated); placeMentions(current);
        },
        items: current.items.map((item, index) => ({
          key: item.id, label: item.label, domId: `${current.listId}-${index}`,
          thumbnailUrl: item.thumbnailDataUrl, thumbnailCrop: item.thumbnailCrop, badge: item.badge,
          icon: ({ video: 'lucide:film', image: 'lucide:image', text: 'lucide:file-text', character: 'lucide:user', scene: 'lucide:landmark', prop: 'lucide:box' })[item.kind] || 'mdi:vector-square',
          onSelect: () => insertMention(current, item),
        })),
        activeKey: current.items[current.active]?.id,
        onItemHover: (id) => { const index = current.items.findIndex((item) => item.id === id); if (index >= 0) { current.active = index; highlightMentions(current); } },
        listId: current.listId, ariaLabel: t('mention'), emptyText: current.loading ? t('mentionLoading') : t('mentionEmpty'),
        footer: current.error || current.hasMore ? createElement('div', { className: 'ui-stack ui-stack--tight' },
          current.error ? createElement('span', { role: 'alert', className: 'ui-hint' }, current.error) : null,
          current.hasMore ? createElement('button', { type: 'button', className: 'ui-btn ui-btn--ghost ui-btn--sm',
            disabled: current.loading, 'data-mention-more': '', onMouseDown: (event) => event.preventDefault(),
            onClick: () => { if (!current.loading && current.hasMore) queryMentions(current, true); } }, t('mentionMore')) : null) : undefined,
      });
    }
    function highlightMentions(current) {
      if (current.items[current.active]) current.input.setAttribute('aria-activedescendant', `${current.listId}-${current.active}`);
      else current.input.removeAttribute('aria-activedescendant');
      renderSharedPicker(current);
    }
    function paintMentions(current) {
      if (state.disposed || activeMention !== current) return;
      current.panel.setAttribute('aria-busy', String(current.loading));
      highlightMentions(current);
    }
    function insertMention(current, item) {
      if (state.disposed || activeMention !== current || current.input.value !== current.expectedValue) { closeMentions(false); return; }
      const value = current.input.value.slice(0, current.start) + item.token + ' ' + current.input.value.slice(current.end);
      if (value.length > current.limit) { current.error = t('mentionTextLimit'); paintMentions(current); return; }
      referenceMetadata.set(item.token, item);
      current.input.value = value; current.change(value); updateSummary();
      const caret = current.start + item.token.length + 1; closeMentions(true); current.input.setSelectionRange(caret, caret);
    }
    async function drainMentionQueries() {
      if (mentionInFlight || !queuedMention || state.disposed) return;
      const task = queuedMention; queuedMention = null; const current = task.current;
      if (activeMention !== current || task.sequence !== current.sequence) return;
      mentionInFlight = true;
      try {
        const result = await props.runEffect({ type: 'prompt.mentions', source: task.source, query: task.query, offset: task.offset, preview: true });
        if (state.disposed || activeMention !== current || task.sequence !== current.sequence || task.query !== current.query) return;
        if (!result?.ok) throw new Error(result?.error || 'mentionError');
        const items = mentionItems(result.value, task.offset);
        const merged = task.offset ? [...current.items, ...items] : items;
        current.items = [...new Map(merged.map((item) => [item.id, item])).values()];
        current.hasMore = result.value.hasMore; current.nextOffset = result.value.nextOffset; current.loading = false; current.error = '';
        current.active = Math.min(current.active, Math.max(0, current.items.length - 1)); paintMentions(current);
      } catch (error) {
        if (!state.disposed && activeMention === current && task.sequence === current.sequence && task.query === current.query) {
          const message = error instanceof Error ? error.message : String(error);
          current.error = `${t(message === 'mentionInvalid' ? 'mentionInvalid' : 'mentionError')}${message !== 'mentionInvalid' && message !== 'mentionError' ? ` ${message.slice(0, 200)}` : ''}`;
          current.loading = false; paintMentions(current);
        }
      } finally { mentionInFlight = false; if (queuedMention && !state.disposed) void drainMentionQueries(); }
    }
    function queryMentions(current, append) {
      if (activeMention !== current || state.disposed) return;
      current.requestedQuery = current.query;
      current.sequence++; current.loading = true; current.error = '';
      if (!append) { current.items = []; current.active = 0; current.hasMore = false; }
      queuedMention = { current, sequence: current.sequence, source: current.source, query: current.query, offset: append ? current.nextOffset : 0 };
      paintMentions(current); void drainMentionQueries();
    }
    function mentionKeydown(current, event) {
      if (activeMention !== current || current.composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); closeMentions(true); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); if (!current.items.length) return;
        current.active = (current.active + (event.key === 'ArrowDown' ? 1 : -1) + current.items.length) % current.items.length; highlightMentions(current);
      } else if (event.key === 'Enter') {
        event.preventDefault(); if (!current.loading && current.items[current.active]) insertMention(current, current.items[current.active]);
      }
    }
    function openMentions(input, wrap, change, limit, range) {
      closeMentions(false);
      const panel = element('div', 'vr-mentions'); panel.dataset.mentions = ''; panel.setAttribute('aria-label', t('mention'));
      const current = { input, wrap, panel, change, limit, ...range, expectedValue: input.value, source: mentionSource, items: [], active: 0,
        query: range.query || '', inlineQuery: range.query || '', searchExpanded: false,
        sequence: 0, hasMore: false, loading: false, error: '', listeners: [], listId: `vr-mentions-${++mentionCounter}` };
      activeMention = current;
      current.picker = element('div'); current.picker.dataset.sharedMentionPicker = '';
      current.renderer = createMentionRenderer(current.picker, () => placeMentions(current));
      mentionListen(current, panel, 'compositionstart', () => { if (current.searchExpanded) current.composing = true; });
      mentionListen(current, panel, 'compositionend', (event) => {
        if (!current.searchExpanded || typeof event.target.value !== 'string') return;
        current.composing = false; current.query = event.target.value.slice(0, 80); queryMentions(current, false);
      });
      input.setAttribute('aria-controls', current.listId); input.setAttribute('aria-expanded', 'true');
      mentionListen(current, window, 'resize', () => placeMentions(current));
      mentionListen(current, window, 'scroll', () => placeMentions(current), true);
      panel.append(current.picker); wrap.append(panel);
      queryMentions(current, false);
    }
    function attachMentions(input, wrap, change, limit, caption) {
      let composing = false;
      const sync = () => {
        if (composing || locked() || state.disposed) return;
        const range = mentionRange(input.value, input.selectionStart, input.selectionEnd);
        if (!range) { if (activeMention?.input === input) closeMentions(false); return; }
        if (activeMention?.input !== input) { openMentions(input, wrap, change, limit, range); return; }
        const current = activeMention; current.start = range.start; current.end = range.end; current.expectedValue = input.value;
        current.inlineQuery = range.query;
        if (!current.searchExpanded && current.query !== range.query) { current.query = range.query; queryMentions(current, false); }
      };
      listen(input, 'compositionstart', () => { composing = true; if (activeMention?.input === input) closeMentions(false); });
      listen(input, 'compositionend', () => { composing = false; sync(); });
      listen(input, 'input', (event) => { if (!event.isComposing) sync(); }); listen(input, 'click', sync);
      listen(input, 'keydown', (event) => { if (activeMention?.input === input && !composing) mentionKeydown(activeMention, event); });
      listen(wrap, 'focusout', (event) => { if (activeMention?.input === input && !wrap.contains(event.relatedTarget)) closeMentions(false); });
      const open = element('button', 'ui-btn', '@'); open.type = 'button'; open.title = t('mentionHint'); open.setAttribute('aria-label', `${t('mention')} · ${t('mentionHint')}`); open.dataset.mentionOpen = input.dataset.field;
      open.disabled = locked(); listen(open, 'mousedown', (event) => event.preventDefault());
      listen(open, 'click', () => { if (locked() || state.disposed) return; const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start;
        input.focus({ preventScroll: true }); openMentions(input, wrap, change, limit, mentionRange(input.value, start, end) || { start, end, query: '' }); });
      caption.append(open);
    }
    function selectField(label, value, options, change, identifier) {
      const wrap = element('div', 'ui-field vr-field-inline'); wrap.append(element('span', 'ui-field__label', label));
      const control = element('div'); control.dataset.selectField = identifier;
      selectRenderers.push(createSelectRenderer(control, {
        value, options, onChange: change, disabled: locked(), name: identifier,
        'aria-label': label, fixedMenu: true,
      }));
      wrap.append(control); return wrap;
    }
    function modelField(label, value, choices, change, identifier, placeholder) {
      const groups = new Map();
      for (const model of choices) {
        const summary = model.provider === 'comfyui' && (!model.group || model.group.id === 'comfyui')
          ? { id: '__workflows', name: t('workflowGroup'), description: t('workflowGroupHint'), badgeText: 'WF', tone: 'brand' }
          : model.group;
        const provider = typeof model.provider === 'string' && model.provider.trim() ? model.provider : 'other';
        const groupId = typeof summary?.id === 'string' && summary.id ? summary.id : `provider:${provider}`;
        if (!groups.has(groupId)) {
          groups.set(groupId, {
            id: groupId,
            label: typeof summary?.name === 'string' && summary.name ? summary.name : provider,
            description: typeof summary?.description === 'string' ? summary.description : undefined,
            badgeText: typeof summary?.badgeText === 'string' ? summary.badgeText : undefined,
            tone: ['brand', 'success', 'info', 'danger', 'warning'].includes(summary?.tone) ? summary.tone : undefined,
            items: [],
          });
        }
        const unavailable = identifier === 'quick-model' && !supportsQuickVideo(model);
        const reason = unavailable
          ? (typeof model.videoReplicaSupport?.reason === 'string' && model.videoReplicaSupport.reason.trim() ? model.videoReplicaSupport.reason : t('replicaUnavailable'))
          : undefined;
        const description = [typeof model.description === 'string' ? model.description : undefined, reason,
          model.category === 'video' && model.videoCapability?.maxVideoReferences === 0 ? t('incompatibleVideo') : undefined]
          .filter(Boolean).join(' · ');
        groups.get(groupId).items.push({ value: model.id, label: model.name, disabled: unavailable,
          description: description || undefined, title: description ? `${model.name}\n${description}` : model.name });
      }
      const wrap = element('div', 'ui-field vr-field-inline'); wrap.append(element('span', 'ui-field__label', label));
      const control = element('div'); control.dataset.selectField = identifier;
      selectRenderers.push(createModelPickerRenderer(control, {
        groups: [...groups.values()], value, onChange: (next) => {
          if (identifier === 'quick-model' && !supportsQuickVideo(choices.find((model) => model.id === next))) return;
          change(next);
        }, disabled: locked(), name: identifier,
        'aria-label': label, placeholder, ...(identifier === 'model' ? { clearLabel: placeholder } : {}), emptyText: placeholder,
      }));
      wrap.append(control); return wrap;
    }
    function image(frame) {
      if (!frame || typeof frame.previewDataUrl !== 'string' || frame.previewDataUrl.length > 240000
        || !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(frame.previewDataUrl)) return element('span', 'ui-text-muted', t('frame'));
      const img = element('img', 'vr-media'); img.dataset.timelinePreview = ''; img.src = frame.previewDataUrl; img.alt = `${t('frame')} ${(frame.actualTime || 0).toFixed(3)}s`; return img;
    }
    function updateSummary() {
      timelineUpdate?.();
      const quickSummary = root.querySelector('[data-quick-summary]');
      if (quickSummary) {
        if (state.job) quickSummary.textContent = `${t('jobProgress')}: ${state.job.completedSegments}/${state.job.totalSegments} ${t('segments')}`;
        else try { const planned = planSegments(state.duration, state.cuts, segmentLimit(videoModels.find((model) => model.id === state.quickModel), state.maxSegmentSeconds));
          quickSummary.textContent = `${t('estimated')} ${planned.length} ${t('segments')} · ${t(`${state.audioMode}Audio`)}. ${t('feeHint')}`;
        } catch { quickSummary.textContent = t('invalidCuts'); }
      }
    }
    async function effect(request, sequence) {
      const result = await props.runEffect(request); alive(sequence);
      if (!result?.ok) throw new Error(result?.error || t('error')); return result.value;
    }
    async function perform(fn, identifier) {
      if (state.disposed || state.busy || props.busy) return;
      const sequence = ++state.sequence; state.busy = true; state.error = false; render();
      try { await fn(sequence); alive(sequence); }
      catch (error) {
        if (state.disposed || sequence !== state.sequence) return;
        const key = error instanceof Error ? error.message : String(error);
        state.status = STRINGS['en-US'][key] ? t(key) : `${t('error')}: ${key.slice(0, 400)}`; state.error = true;
      } finally { if (!state.disposed && sequence === state.sequence) {
        state.busy = false; state.mediaLoading = ''; render();
        if (identifier) root.querySelector(`[data-action="${identifier}"]`)?.focus({ preventScroll: true });
      } }
    }
    async function initialize(sequence) {
      state.mediaLoading = 'loading'; state.status = t('loading'); render();
      const value = await effect({ type: 'video.extractFrames', resourceId: video.resourceId, mode: 'preview', count: 12 }, sequence);
      if (!value?.video || !Number.isFinite(value.video.duration) || value.video.duration <= 0) throw new Error('previewError');
      state.duration = value.video.duration; state.width = value.video.width; state.height = value.video.height;
      state.thumbnails = (value.frames || []).filter((frame) => !frame.error);
      if (state.job) applyJob(state.job);
      else state.status = t('quickReady');
    }
    async function playback(sequence) {
      state.playbackAttempted = true;
      state.mediaLoading = 'playLoading'; state.status = t('playLoading'); render();
      const chunks = [];
      try {
        let resource = video;
        if (!Number.isSafeInteger(video.size) || video.size <= 0 || video.size > LIMITS.previewBytes) {
          const prepared = await effect({ type: 'video.preparePlayback', resourceId: video.resourceId }, sequence);
          resource = prepared?.resource;
          if (!resource || typeof resource.resourceId !== 'string' || resource.mediaType !== 'video/mp4'
            || !Number.isSafeInteger(resource.size) || resource.size <= 0) throw new Error('playError');
          state.playbackAudio = prepared.hasAudio !== false;
        }
        // Each base64 part fits the string limit. Preview pages batch eight parts to fit the native transport budget.
        const pageSize = LIMITS.previewChunkBytes * (resource === video ? 1 : 8);
        for (let offset = 0; offset < resource.size; offset += pageSize) {
          const length = Math.min(pageSize, resource.size - offset);
          const value = await effect({ type: resource === video ? 'resource.readRange' : 'video.readPlayback', resourceId: resource.resourceId, offset, length }, sequence);
          if (value?.offset !== offset || value.bytes !== length) throw new Error('playError');
          const parts = resource === video ? [value.base64] : value.base64Chunks;
          if (!Array.isArray(parts) || !parts.length || parts.length > 8) throw new Error('playError');
          let bytes = 0;
          for (const part of parts) {
            if (typeof part !== 'string' || part.length > 256000) throw new Error('playError');
            const raw = atob(part); bytes += raw.length;
            if (bytes > length) throw new Error('playError');
            chunks.push(Uint8Array.from(raw, (character) => character.charCodeAt(0)));
          }
          if (bytes !== length) throw new Error('playError');
        }
        alive(sequence); const url = URL.createObjectURL(new Blob(chunks, { type: resource.mediaType })); objectUrls.add(url); state.playback = url;
        state.playing = true;
        state.status = t('playReady');
      } catch { alive(sequence); state.playing = false; state.status = t('playReadError'); state.error = true; }
      finally { chunks.length = 0; }
    }
    function updatePlaybackControl() {
      if (!playbackToggle) return;
      const label = t(state.mediaLoading === 'playLoading' ? 'playLoading' : state.playing ? 'pausePreview' : 'playPreview');
      if (state.mediaLoading === 'playLoading') {
        const spinner = element('span', 'ui-spinner'); spinner.setAttribute('aria-hidden', 'true'); playbackToggle.replaceChildren(spinner);
      } else {
        const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [name, value] of Object.entries({ width: '20', height: '20', viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(name, value);
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', state.playing ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M6 3l14 9-14 9z'); icon.append(path);
        playbackToggle.replaceChildren(icon);
      }
      playbackToggle.title = label;
      playbackToggle.setAttribute('aria-label', label);
      playbackToggle.setAttribute('aria-pressed', String(state.playing));
    }
    function stopTimelineClock() {
      if (timelineFrame !== null) cancelAnimationFrame(timelineFrame);
      timelineFrame = null;
    }
    function schedulePlayerClock(player) {
      if (timelineFrame !== null || state.disposed || player !== playbackElement || !state.playing) return;
      timelineFrame = requestAnimationFrame(() => {
        timelineFrame = null;
        if (state.disposed || player !== playbackElement || !state.playing || player.paused || player.ended) return;
        if (Number.isFinite(player.currentTime)) updateTimelineTime(player.currentTime);
        schedulePlayerClock(player);
      });
    }
    async function playPlayer(player) {
      if (state.disposed || player !== playbackElement) return;
      try {
        if (player.ended) player.currentTime = 0;
        await player.play();
      } catch {
        // Asynchronous loading can lose the browser's user activation; the next click retries play, not file reads.
        if (!state.disposed && player === playbackElement) { state.playing = false; updatePlaybackControl(); }
      }
    }
    async function togglePlayback() {
      if (state.disposed || locked() || props.busy || state.duration <= 0) return;
      if (!state.playing && state.cutTime >= state.duration) updateTimelineTime(0, true);
      if (!state.playback && !state.playbackAttempted) { await perform(playback, 'play'); return; }
      if (!state.playback) {
        state.status = t('playReadError'); state.error = true; render(); return;
      }
      const player = playbackElement;
      if (!player) return;
      if (player.paused === false && !player.ended) player.pause();
      else await playPlayer(player);
    }
    function readJob(value) {
      if (!value || typeof value.jobId !== 'string' || !value.jobId || value.jobId.length > 128
        || !['queued', 'preparing', 'generating', 'composing', 'succeeded', 'failed', 'cancelled', 'paused', 'unknown'].includes(value.status)
        || !Number.isInteger(value.totalSegments) || value.totalSegments < 1 || value.totalSegments > 64
        || !Number.isInteger(value.completedSegments) || value.completedSegments < 0 || value.completedSegments > value.totalSegments
        || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100
        || (value.stage !== undefined && (typeof value.stage !== 'string' || value.stage.length > 200))) throw new Error('jobInvalid');
      return { ...value, error: typeof value.error === 'string' ? value.error.slice(0, 400) : '',
        warnings: Array.isArray(value.warnings) ? value.warnings.filter((item) => typeof item === 'string').slice(0, 6).map((item) => item.slice(0, 300)) : [] };
    }
    function applyJob(value) {
      const job = readJob(value);
      if (state.job && state.job.jobId !== job.jobId) throw new Error('jobInvalid');
      if (Number.isFinite(state.job?.updatedAt) && Number.isFinite(job.updatedAt) && job.updatedAt < state.job.updatedAt) return;
      if (jobTerminal() && !['succeeded', 'failed', 'cancelled', 'paused', 'unknown'].includes(job.status)) return;
      state.job = job; state.error = ['failed', 'unknown'].includes(job.status);
      const terminalKeys = { succeeded: 'succeededJob', failed: 'failedJob', cancelled: 'cancelledJob', paused: 'pausedJob', unknown: 'unknownJob' };
      state.status = terminalKeys[job.status] ? `${t(terminalKeys[job.status])}${job.error ? ` ${job.error}` : ''}` : `${t('jobProgress')}: ${job.stage || job.status}`;
      if (jobTerminal() && jobTimer !== null) { clearTimeout(jobTimer); jobTimer = null; }
    }
    function schedulePoll() {
      if (state.disposed || !jobActive() || jobTimer !== null) return;
      jobTimer = setTimeout(() => { jobTimer = null; void pollJob(); }, pollAttempts++ < 3 ? 2000 : 5000);
    }
    async function pollJob() {
      if (state.disposed || !state.job || pollInFlight) return;
      pollInFlight = true;
      const id = state.job.jobId;
      try {
        const result = await props.runEffect({ type: 'video.replicaJob.status', jobId: id });
        if (state.disposed || state.job?.jobId !== id) return;
        if (!result?.ok) throw new Error(result?.error || t('jobInvalid'));
        applyJob(result.value); pollFailures = 0; render();
      } catch (error) {
        if (state.disposed || state.job?.jobId !== id) return;
        pollFailures++; state.error = true; state.status = `${t('error')}: ${String(error.message || error).slice(0, 400)}`; render();
      } finally { pollInFlight = false; }
      if (pollFailures < 3) schedulePoll();
    }
    async function startJob(downloadSpeech = false) {
      if (state.disposed || locked() || props.busy || state.job) return;
      const model = videoModels.find((item) => item.id === state.quickModel);
      if (!model) { state.status = t('generationRequired'); state.error = true; render(); return; }
      if (!supportsQuickVideo(model)) { state.status = t('replicaUnavailable'); state.error = true; render(); return; }
      if (state.controls.size && model.videoCapability?.maxVideoReferences === 0) {
        state.status = t('incompatibleVideo'); state.error = true; render(); return;
      }
      try { planSegments(state.duration, state.cuts, segmentLimit(model, state.maxSegmentSeconds)); }
      catch { state.status = t('invalidCuts'); state.error = true; render(); return; }
      state.jobRequest = true; state.error = false; state.speechRequired = false; state.status = t('startingJob'); render();
      try {
        const result = await props.runEffect({ type: 'video.replicaJob.start', resourceId: video.resourceId, modelId: model.id,
          ...(state.model ? { analysisModelId: state.model } : {}), character: state.character, scene: state.scene, style: state.style,
          controls: [...state.controls], cuts: [...state.cuts], maxSegmentSeconds: segmentLimit(model, state.maxSegmentSeconds),
          ...(state.resolution ? { resolution: state.resolution } : {}), ...(state.aspectRatio ? { aspectRatio: state.aspectRatio } : {}),
          audioMode: state.audioMode, transcribe: state.transcribe, ...(downloadSpeech ? { downloadSpeech: true } : {}) });
        if (state.disposed) return;
        if (!result?.ok) throw new Error(result?.error || t('error'));
        if (result.value?.speechModelsRequired === true) { state.speechRequired = true; state.status = t('speechRequired'); }
        else { applyJob(result.value); schedulePoll(); }
      } catch (error) {
        if (state.disposed) return;
        state.error = true; state.status = `${t('error')}: ${String(error.message || error).slice(0, 400)}`;
      } finally { if (!state.disposed) { state.jobRequest = false; render(); } }
    }
    async function cancelJob() {
      if (state.disposed || !jobActive() || state.jobRequest) return;
      state.jobRequest = true; render();
      try {
        const result = await props.runEffect({ type: 'video.replicaJob.cancel', jobId: state.job.jobId });
        if (state.disposed) return;
        if (!result?.ok) throw new Error(result?.error || t('error'));
        applyJob(result.value);
      } catch (error) { if (!state.disposed) { state.status = `${t('error')}: ${String(error.message || error).slice(0, 400)}`; state.error = true; } }
      finally { if (!state.disposed) { state.jobRequest = false; render(); schedulePoll(); } }
    }
    function action(label, identifier, handler, disabled = false, primary = false) {
      const node = element('button', `ui-btn${primary ? ' ui-btn--primary' : ''}`, label); node.type = 'button'; node.dataset.action = identifier;
      node.disabled = disabled; listen(node, 'click', () => { if (!node.disabled) void handler(); }); return node;
    }
    function updateTimelineTime(value, seekPlayer = false) {
      state.cutTime = Math.max(0, Math.min(state.duration, Number(value) || 0));
      state.playbackTime = state.cutTime;
      if (playbackElement && seekPlayer) playbackElement.currentTime = state.cutTime;
      if (!playbackElement) {
        const frame = state.thumbnails.reduce((nearest, candidate) => !nearest || Math.abs(candidate.actualTime - state.cutTime) < Math.abs(nearest.actualTime - state.cutTime) ? candidate : nearest, null);
        const previewImage = root.querySelector('[data-timeline-preview]');
        if (frame && previewImage) {
          if (previewImage.src !== frame.previewDataUrl) previewImage.src = frame.previewDataUrl;
          previewImage.alt = `${t('frame')} ${frame.actualTime.toFixed(3)}s`;
        }
      }
      timelineUpdate?.();
    }
    function seekTimeline(value) {
      if (state.disposed || locked()) return;
      updateTimelineTime(value, true);
    }
    function renderTimeline() {
      const section = element('div', 'vr-stack min-w-0');
      const holder = element('div', 'min-w-0'); holder.dataset.timeline = '';
      const feedback = element('p', 'ui-text-muted'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
      feedback.hidden = true;
      section.append(holder, feedback, element('p', 'ui-text-muted', t('cutsHint')));
      timelineRenderer = createTimelineRenderer(holder);
      const editCuts = (cuts, moving) => {
        if (state.disposed || locked()) return false;
        try {
          const rounded = cuts.map((time) => Math.round(time * 1000) / 1000);
          planSegments(state.duration, rounded, segmentLimit(videoModels.find((model) => model.id === state.quickModel), state.maxSegmentSeconds));
          cutIds = new Map(rounded.map((time) => [time, moving && time === Math.round(moving.time * 1000) / 1000 ? moving.id : cutIds.get(time) || `cut-${++nextCutId}`]));
          state.cuts = rounded.sort((a, b) => a - b); feedback.textContent = ''; feedback.hidden = true; state.error = false;
        } catch { feedback.textContent = t('invalidCuts'); feedback.hidden = false; return false; }
        timelineUpdate(); updateSummary(); return true;
      };
      timelineUpdate = () => {
        let segments = [];
        try { segments = planSegments(state.duration, state.cuts, segmentLimit(videoModels.find((model) => model.id === state.quickModel), state.maxSegmentSeconds)).map((segment, index) => ({
          id: String(index), start: segment.inPoint, end: segment.outPoint, label: `${index + 1}: ${segment.inPoint.toFixed(3)}–${segment.outPoint.toFixed(3)}s`,
        })); } catch { feedback.textContent = t('invalidCuts'); }
        feedback.hidden = !feedback.textContent;
        timelineRenderer?.update({ duration: state.duration, playhead: state.cutTime,
          thumbnails: state.thumbnails.map((frame) => frame.previewDataUrl), timestamps: state.thumbnails.map((frame) => frame.actualTime),
          markers: state.cuts.map((time) => ({ id: cutIds.get(time), time })), segments, disabled: locked() || Boolean(props.busy),
          viewState: timelineView, onViewChange: (view) => { timelineView = view; }, onSeek: seekTimeline,
          labels: { title: t('timeline'), playhead: t('cutTime'), track: video.displayName, segments: t('segments'), addMarker: t('addCut'),
            removeMarker: t('removeCut'), resetMarkers: t('clearCuts'), zoomIn: t('zoomIn'), zoomOut: t('zoomOut'), fit: t('fitTimeline'), position: t('cutTime'), marker: t('cutMarker') },
          onAddMarker: (time) => editCuts([...state.cuts, time]),
          onMoveMarker: (id, time) => { if (state.cuts.some((cut) => cutIds.get(cut) === id)) editCuts(state.cuts.map((cut) => cutIds.get(cut) === id ? time : cut), { id, time }); },
          onRemoveMarker: (id) => editCuts(state.cuts.filter((cut) => cutIds.get(cut) !== id)), onResetMarkers: () => editCuts([]),
        });
      };
      timelineUpdate(); return section;
    }
    function renderJobProgress() {
      const row = element('div', 'vr-row');
      const progress = element('progress', 'vr-progress min-w-0 flex-1 basis-32'); progress.max = 1; progress.value = state.job.progress > 1 ? state.job.progress / 100 : state.job.progress;
      progress.setAttribute('aria-label', t('jobProgress'));
      row.append(progress, element('span', 'ui-text-muted tabular-nums', `${state.job.completedSegments}/${state.job.totalSegments} · ${Math.round(progress.value * 100)}%`),
        element('span', 'ui-text-muted', t('jobContinues'))); return row;
    }
    function render() {
      if (state.disposed) return;
      stopTimelineClock();
      if (locked() || props.busy) state.playing = false;
      const scrollTop = root.scrollTop || 0;
      closeMentions(false);
      for (const editor of referenceEditors) editor.dispose(); referenceEditors = [];
      for (const renderer of selectRenderers) renderer.dispose(); selectRenderers = [];
      timelineRenderer?.dispose(); timelineRenderer = null; timelineUpdate = null;
      for (const dispose of domListeners) dispose(); domListeners = [];
      playbackToggle = null;
      stopPlaybackElement();
      if (root.ownerDocument.documentElement) root.ownerDocument.documentElement.dataset.theme = props.theme;
      root.replaceChildren(); const container = element('div', 'vr vr-stack'); container.dataset.theme = props.theme;
      const style = element('style'); style.textContent = sharedBaseCss + sharedUiKitCss + sharedPickerCss + CSS; container.append(style);
      const heading = element('header', 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1');
      heading.append(element('h1', 'shrink-0', t('quickTitle')),
        element('p', 'min-w-0 flex-1 basis-64 ui-text-muted', t('quickHint')));
      if (state.status) {
        const status = element('p', state.error ? 'basis-full ui-alert is-error' : 'min-w-0 text-xs ui-text-muted', state.status);
        status.setAttribute('role', state.error ? 'alert' : 'status'); status.setAttribute('aria-live', state.error ? 'assertive' : 'polite');
        status.setAttribute('aria-atomic', 'true');
        heading.append(status);
      }
      container.append(heading);
      if (!STRINGS[props.locale]) container.append(element('p', 'ui-alert', t('localeFallback')));
      if (state.job && (!video || props.parameters?.replicaJob)) {
        container.append(renderJobProgress());
        for (const warning of state.job.warnings) container.append(element('p', 'ui-alert', warning));
        const footer = element('div', 'vr-footer'); footer.append(action(t('close'), 'close', () => props.close(), false),
          action(t('refreshJob'), 'refresh-job', () => { if (jobTimer !== null) { clearTimeout(jobTimer); jobTimer = null; } void pollJob(); }, state.jobRequest));
        if (jobActive()) footer.append(action(t('cancelJob'), 'cancel-job', cancelJob, state.jobRequest));
        container.append(footer); root.append(container); root.scrollTop = scrollTop; return;
      }
      if (!video) { container.append(element('p', 'ui-alert is-error', t('resourceMissing'))); root.append(container); return; }
      container.setAttribute('aria-busy', String(state.busy || state.jobRequest));
      const grid = element('div', 'vr-grid'); const source = element('section', 'ui-card');
      const sourceHeader = element('div', 'ui-card__header flex-wrap');
      const sourceName = element('p', 'ui-card__desc min-w-0 flex-1 truncate', video.displayName); sourceName.title = video.displayName;
      sourceHeader.append(element('h2', 'ui-card__title shrink-0', t('source')), sourceName);
      if (state.duration > 0) sourceHeader.append(element('span', 'ui-text-muted shrink-0 tabular-nums', `${state.duration.toFixed(3)}s · ${state.width}×${state.height}`));
      source.append(sourceHeader);
      const sourceBody = element('div', 'ui-card__body vr-stack');
      const preview = element('div', 'relative flex min-h-[160px] items-center justify-center overflow-hidden rounded-lg bg-canvas-bg');
      const loadingPreview = (key) => {
        const loading = element('div', 'absolute inset-0 flex items-center justify-center gap-2 bg-canvas-bg text-canvas-text-secondary');
        loading.dataset.mediaLoading = ''; loading.setAttribute('role', 'status'); loading.setAttribute('aria-live', 'polite');
        const spinner = element('span', 'ui-spinner'); spinner.setAttribute('aria-hidden', 'true');
        loading.append(spinner, element('span', '', t(key))); preview.setAttribute('aria-busy', 'true'); return loading;
      };
      if (state.playback) {
        const player = element('video', 'vr-media'); player.controls = true; player.preload = 'auto'; player.playsInline = true; player.src = state.playback;
        playbackElement = player;
        const loading = loadingPreview('playLoading');
        listen(player, 'loadeddata', () => {
          if (state.disposed) return; loading.remove(); preview.setAttribute('aria-busy', 'false');
          if (state.playing) void playPlayer(player);
        });
        for (const event of ['play', 'pause', 'ended']) listen(player, event, () => {
          if (state.disposed || player !== playbackElement) return;
          state.playing = event === 'play'; updatePlaybackControl();
          if (state.playing) schedulePlayerClock(player); else stopTimelineClock();
        });
        listen(player, 'loadedmetadata', () => { if (state.playbackTime > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(state.playbackTime, player.duration); });
        listen(player, 'timeupdate', () => { if (!state.disposed && Number.isFinite(player.currentTime)) updateTimelineTime(player.currentTime); });
        listen(player, 'error', () => {
          if (state.disposed) return;
          URL.revokeObjectURL(state.playback); objectUrls.delete(state.playback); state.playback = '';
          state.playing = false;
          state.status = t('playError'); state.error = true; render();
        }); preview.append(player, loading);
      } else {
        if (state.thumbnails.length) preview.append(image(state.thumbnails.reduce((nearest, candidate) => Math.abs(candidate.actualTime - state.cutTime) < Math.abs(nearest.actualTime - state.cutTime) ? candidate : nearest)));
        if (state.mediaLoading) preview.append(loadingPreview(state.mediaLoading));
      }
      if (state.mediaLoading || state.playback || state.thumbnails.length) sourceBody.append(preview);
      const playbackBar = element('div', 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2');
      playbackToggle = action('', 'play', togglePlayback, locked() || Boolean(props.busy) || !state.duration);
      playbackToggle.className = 'ui-icon-btn ui-icon-btn--ghost ui-timeline__tool'; updatePlaybackControl();
      const previewMode = t(state.mediaLoading === 'playLoading' ? 'playLoading' : !state.playbackAudio ? 'silentPlayback' : 'videoPlayback');
      const playbackHint = element('span', 'min-w-0 truncate ui-text-muted text-xs', previewMode); playbackHint.title = previewMode;
      playbackBar.append(playbackHint, playbackToggle);
      sourceBody.append(playbackBar);
      sourceBody.append(renderTimeline());
      source.append(sourceBody); grid.append(source);
      const settings = element('section', 'ui-card'); const settingsHeader = element('div', 'ui-card__header flex-wrap'); settingsHeader.append(element('h2', 'ui-card__title', t('settings'))); settings.append(settingsHeader);
      const settingsBody = element('div', 'ui-card__body vr-stack');
      const helpTexts = new Set([t('quickControlHint')]);
      for (const key of ['character', 'scene', 'style']) settingsBody.append(field(t(key), state[key], (value) => { state[key] = value.slice(0, 2000); }, 'textarea', t(`${key}Hint`), key));
      const controls = element('div', 'vr-row'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', t('controls'));
      controls.append(element('span', 'ui-field__label', t('controls')));
      for (const key of ['depth', 'pose', 'canny']) { const label = element('label'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = state.controls.has(key); checkbox.disabled = locked(); checkbox.dataset.control = key;
        listen(checkbox, 'change', () => { if (checkbox.checked) state.controls.add(key); else state.controls.delete(key); updateSummary(); }); label.append(checkbox, element('span', '', t(key))); controls.append(label); }
      settingsBody.append(controls);
      settingsBody.append(modelField(t('generationModel'), state.quickModel, videoModels,
        (value) => { state.quickModel = value; render(); }, 'quick-model', t('chooseVideo')));
      if (!videoModels.some(supportsQuickVideo)) settingsBody.append(element('p', 'ui-alert', t('noVideo')));
      const chosen = videoModels.find((model) => model.id === state.quickModel);
      if (!chosen?.videoCapability?.maxDuration && !chosen?.videoCapability?.durations?.length) {
        const durationRow = element('div', 'vr-row');
        const durationField = field(t('segmentSeconds'), state.maxSegmentSeconds, (value) => { state.maxSegmentSeconds = value; }, 'number', '', 'segment-seconds');
        const hint = element('span', 'ui-text-muted text-xs', t('segmentHint')); hint.title = t('durationUnknown');
        durationRow.append(durationField, hint); settingsBody.append(durationRow); helpTexts.add(t('durationUnknown'));
      }
      settingsBody.append(modelField(t('model'), state.model, models,
        (value) => { state.model = value; }, 'model', t('optional')));
      settingsBody.append(selectField(t('quickAudio'), state.audioMode,
        ['original', 'model', 'mute'].map((value) => ({ value, label: t(`${value}Audio`) })),
        (value) => { state.audioMode = value; updateSummary(); }, 'audio-mode'));
      helpTexts.add(t('audioHint'));
      const audio = element('label'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = state.transcribe; checkbox.disabled = locked(); checkbox.dataset.field = 'transcribe';
      listen(checkbox, 'change', () => { state.transcribe = checkbox.checked; }); audio.append(checkbox, element('span', '', t('transcribe')));
      settingsBody.append(audio); helpTexts.add(t('transcribeHint'));
      const params = element('div', 'vr-parameter-pair'); params.append(selectField(t('aspectRatio'), state.aspectRatio,
        [{ value: '', label: t('modelDefault') }, ...['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', 'adaptive'].map((value) => ({ value, label: value }))],
        (value) => { state.aspectRatio = value; }, 'generation-ratio'), selectField(t('resolution'), state.resolution,
        [{ value: '', label: t('modelDefault') }, ...['480p', '720p', '1080p'].map((value) => ({ value, label: value }))],
        (value) => { state.resolution = value; }, 'generation-resolution')); settingsBody.append(params);
      if (chosen?.provider === 'comfyui') helpTexts.add(t('comfyHint'));
      const help = element('details', 'vr-help'); help.open = state.helpOpen;
      listen(help, 'toggle', () => { state.helpOpen = help.open; }); help.append(element('summary', '', t('help')));
      const helpBody = element('div', 'grid gap-1 pt-2');
      for (const text of helpTexts) helpBody.append(element('p', '', text));
      help.append(helpBody); settingsHeader.append(help);
      settings.append(settingsBody); grid.append(settings); container.append(grid);
      const summary = element('span', 'vr-summary min-w-0 flex-1 basis-64'); summary.dataset.quickSummary = '';
      if (state.job) {
        container.append(renderJobProgress());
        for (const warning of state.job.warnings) container.append(element('p', 'ui-alert', warning));
      }
      const footer = element('div', 'vr-footer');
      footer.append(summary, action(t('close'), 'close', () => props.close(), false));
      if (state.job) footer.append(action(t('refreshJob'), 'refresh-job', () => { if (jobTimer !== null) { clearTimeout(jobTimer); jobTimer = null; } void pollJob(); }, state.jobRequest));
      if (jobActive()) footer.append(action(t('cancelJob'), 'cancel-job', cancelJob, state.jobRequest));
      else footer.append(action(t(state.speechRequired ? 'downloadSpeech' : 'quickStart'), state.speechRequired ? 'download-speech' : 'quick-start',
        () => startJob(state.speechRequired), locked() || Boolean(props.busy) || !state.duration || Boolean(state.job), true));
      container.append(footer);
      root.append(container); root.scrollTop = scrollTop; updateSummary();
    }
    function stopPlaybackElement() {
      if (!playbackElement) return;
      if (Number.isFinite(playbackElement.currentTime)) state.playbackTime = playbackElement.currentTime;
      playbackElement.pause?.(); playbackElement.removeAttribute('src'); playbackElement.load?.(); playbackElement = null;
    }
    function refresh() {
      const statusKey = Object.keys(STRINGS['en-US']).find((key) => Object.values(STRINGS).some((dictionary) => dictionary[key] === state.status));
      if (statusKey) state.status = t(statusKey);
      render();
    }
    window.addEventListener('ai-canvas-theme-change', refresh); window.addEventListener('ai-canvas-locale-change', refresh);
    if (props.parameters?.replicaJob) {
      try { applyJob(props.parameters.replicaJob);
        if (videoModels.some((model) => model.id === state.job.modelId)) state.quickModel = state.job.modelId;
      }
      catch { state.status = t('jobInvalid'); state.error = true; }
    }
    render(); if (video && !state.job && !props.parameters?.replicaJob) void perform(initialize);
    if (state.job) void pollJob();
    return function cleanup() {
      state.disposed = true; state.sequence++;
      stopTimelineClock();
      if (jobTimer !== null) { clearTimeout(jobTimer); jobTimer = null; }
      closeMentions(false);
      window.removeEventListener('ai-canvas-theme-change', refresh); window.removeEventListener('ai-canvas-locale-change', refresh);
      for (const editor of referenceEditors) editor.dispose(); referenceEditors = []; referenceMetadata.clear();
      for (const renderer of selectRenderers) renderer.dispose(); selectRenderers = [];
      timelineRenderer?.dispose(); timelineRenderer = null; timelineUpdate = null;
      for (const dispose of domListeners) dispose(); domListeners = [];
      stopPlaybackElement();
      playbackToggle = null;
      for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); root.replaceChildren();
      root.classList.toggle('vr-viewport', false);
    };
  };
})();
