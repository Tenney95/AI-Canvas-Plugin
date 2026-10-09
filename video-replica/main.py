"""AI Canvas 视频复刻：宿主拉片数据 + 离线 ReShot 控制视频。

上游来源及许可见 NOTICE.md。只有 Rust 注入的 nativeMedia 可提供本机路径；
返回值只含资源句柄、文件 basename 和文本，不包含原生路径。
"""

import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid


MAX_SHOTS = 6
MAX_NODES = 25
MAX_SHOT_SECONDS = 15.0
MAX_SEGMENT_SECONDS = 30.0
WORK_SECONDS = 110.0
CONTROL_LABELS = {"depth": "深度", "pose": "骨架", "canny": "线稿"}
SAFE_KEY = re.compile(r"^[A-Za-z0-9_-]{1,48}$")
OPAQUE_MENTION = re.compile(
    r"@\{plugin-ref-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[^:{}\r\n]+\}")
GENERATION_FIELDS = {"duration", "aspectRatio", "resolution", "videoResolution",
                     "videoFps", "videoFrames", "generateAudio"}


class ReplicaError(RuntimeError):
    """用户可操作且不带路径的错误。"""


def _text(value, limit=6000):
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise ReplicaError("镜头文本无效或过长，请缩短后重试。")
    return value.replace("\r\n", "\n").replace("\r", "\n").strip()


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ReplicaError("镜头起止时间必须是秒数。")
    try:
        result = float(value)
    except OverflowError:
        raise ReplicaError("镜头起止时间必须是有限的非负秒数。") from None
    if not math.isfinite(result) or result < 0:
        raise ReplicaError("镜头起止时间必须是有限的非负秒数。")
    return result


def _generation(input_value):
    raw = input_value.get("parameters", {}).get("generation")
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) - {"backend", "modelId", "parameters"}:
        raise ReplicaError("视频生成设置包含未支持字段，请重新选择生成方式。")
    backend = raw.get("backend", "materials")
    if backend not in ("materials", "model", "comfyui"):
        raise ReplicaError("视频生成方式无效。")
    parameters = raw.get("parameters", {})
    if not isinstance(parameters, dict) or set(parameters) - GENERATION_FIELDS:
        raise ReplicaError("生成参数仅允许时长、比例、分辨率、帧率、帧数和音频开关。")
    for key, value in parameters.items():
        if key == "generateAudio":
            valid = isinstance(value, bool)
        elif key == "aspectRatio":
            valid = isinstance(value, str) and value in ("1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "adaptive")
        elif key == "resolution":
            valid = isinstance(value, str) and value in ("480p", "720p", "1080p", "4k")
        else:
            try:
                valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
            except OverflowError:
                valid = False
            if valid:
                limits = {"duration": (0, 60), "videoResolution": (256, 4096),
                          "videoFps": (1, 120), "videoFrames": (1, 4096)}
                minimum, maximum = limits[key]
                valid = minimum <= value <= maximum and (key != "duration" or value > 0)
                if key != "duration":
                    valid = valid and int(value) == value
        if not valid:
            raise ReplicaError("视频生成参数格式或范围无效：" + key)
    if backend == "materials":
        return None
    model_id, models = raw.get("modelId"), input_value.get("models", [])
    if not isinstance(model_id, str) or not model_id or not isinstance(models, list):
        raise ReplicaError("请选择宿主提供的视频模型。")
    matches = [m for m in models if isinstance(m, dict) and m.get("id") == model_id
               and m.get("category") == "video" and isinstance(m.get("provider"), str)]
    if len(matches) != 1:
        raise ReplicaError("所选视频模型不可用，请刷新模型目录。")
    is_comfy = matches[0]["provider"] == "comfyui"
    if (backend == "comfyui") != is_comfy:
        raise ReplicaError("生成方式与模型厂商不匹配，请重新选择模型。")
    return {"modelId": model_id, "parameters": dict(parameters)}


def _normalise(parameters):
    if not isinstance(parameters, dict) or parameters.get("operation") not in ("replicate", "replicate-segment"):
        raise ReplicaError("请从视频复刻面板提交已确认的镜头。")
    segmented = parameters["operation"] == "replicate-segment"
    duration_limit = MAX_SEGMENT_SECONDS if segmented else MAX_SHOT_SECONDS
    raw_shots = parameters.get("shots")
    if not isinstance(raw_shots, list) or not 1 <= len(raw_shots) <= MAX_SHOTS:
        raise ReplicaError("每次处理 1–6 个镜头，请分批提交。")
    controls = parameters.get("controls", [])
    if (not isinstance(controls, list) or len(controls) > 3
            or any(not isinstance(c, str) or c not in CONTROL_LABELS for c in controls)
            or len(controls) != len(set(controls))):
        raise ReplicaError("控制类型只能选深度、骨架或线稿，且不能重复。")
    shots, seen, previous_end = [], set(), 0.0
    for raw in raw_shots:
        if not isinstance(raw, dict):
            raise ReplicaError("镜头数据无效，请重新拉片。")
        key = raw.get("key")
        if not isinstance(key, str) or not SAFE_KEY.fullmatch(key) or key in seen:
            raise ReplicaError("镜头标识无效或重复，请重新拉片。")
        seen.add(key)
        start, end = _number(raw.get("inPoint")), _number(raw.get("outPoint"))
        if end <= start or end - start > duration_limit + 1e-6:
            raise ReplicaError("每个%s须大于 0 秒且不超过 %d 秒，请调整切点。" % (
                "生成段" if segmented else "镜头", duration_limit))
        reference_duration = raw.get("referenceDuration", end - start)
        reference_duration = _number(reference_duration)
        if reference_duration < end - start - 1e-6 or reference_duration > duration_limit + 1e-6:
            raise ReplicaError("参考控制视频时长不能短于原片区间或超过本次处理上限。")
        if not segmented and abs(reference_duration - (end - start)) > 1e-6:
            raise ReplicaError("手动镜头模式不支持延长控制视频。")
        if start < previous_end - 1e-6:
            raise ReplicaError("镜头须按时间顺序排列，且不能重叠。")
        previous_end = end
        frame_resource = raw.get("frameResourceId")
        if frame_resource is not None and (
                not isinstance(frame_resource, str) or not 1 <= len(frame_resource) <= 256):
            raise ReplicaError("关键帧资源句柄无效，请重新抽帧。")
        shots.append({"key": key, "inPoint": start, "outPoint": end,
                      "referenceDuration": reference_duration,
                      "description": _text(raw.get("description")),
                      "prompt": _text(raw.get("prompt")),
                      "frameResourceId": frame_resource})
    node_count = 2 + sum(bool(s["frameResourceId"]) for s in shots) + len(shots) * len(controls)
    if node_count > MAX_NODES:
        raise ReplicaError("本批结果超过 25 个节点，请减少镜头或控制类型。")
    return {"shots": shots, "controls": controls,
            "character": _text(parameters.get("character"), 2000),
            "scene": _text(parameters.get("scene"), 2000),
            "style": _text(parameters.get("style"), 2000)}


def _ffmpeg_binary():
    candidate = shutil.which("ffmpeg")
    if candidate:
        return candidate
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise ReplicaError("缺少 FFmpeg，请先运行插件的环境准备脚本。") from None


def _native_paths(input_value, resource_id):
    native = input_value.get("nativeMedia")
    if not isinstance(native, dict) or not isinstance(native.get("inputFiles"), dict):
        raise ReplicaError("宿主未授权本地媒体处理，请更新 AI Canvas 并重新连接视频。")
    raw_source = native["inputFiles"].get(resource_id)
    raw_output = native.get("outputDir")
    if not isinstance(raw_source, str) or not isinstance(raw_output, str):
        raise ReplicaError("参考视频的原生资源授权已失效，请重新提交。")
    try:
        source, output = Path(raw_source), Path(raw_output)
        if not source.is_absolute() or not output.is_absolute():
            raise ValueError()
        source = source.resolve(strict=True)
        output = output.resolve(strict=True)
        if not source.is_file() or not output.is_dir():
            raise ValueError()
    except (OSError, ValueError):
        raise ReplicaError("参考视频或本次输出目录不可用，请重新提交。") from None
    return source, output


# 普通子进程继承原生 Job Object / 进程组；不创建新 session，不启动 daemon。
# 父进程只接收无路径状态 JSON；第三方 stdout/stderr 全部丢弃。
WORKER = r'''
import contextlib, importlib.util, json, math, os, subprocess, sys, time
from pathlib import Path

class Discard:
    def write(self, value): return len(value)
    def flush(self): pass

def main():
    job = json.load(sys.stdin)
    deadline = time.monotonic() + job["seconds"]
    def remaining():
        value = deadline - time.monotonic()
        if value <= 0: raise TimeoutError()
        return value
    def command(args):
        subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=remaining(), check=True,
                       creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
    with contextlib.redirect_stdout(Discard()), contextlib.redirect_stderr(Discard()):
        import cv2
        import numpy as np
        source, output = Path(job["source"]), Path(job["output"])
        cap = cv2.VideoCapture(str(source))
        try:
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            count = float(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if not cap.isOpened() or not math.isfinite(fps) or fps <= 0 or width < 2 or height < 2:
                raise ValueError("invalid_video")
            duration = count / fps
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("invalid_video")
            if any(s["outPoint"] > duration + 1.0 / fps for s in job["shots"]):
                raise ValueError("outside_video")
        finally:
            cap.release()
        ffmpeg, configs, segments = job["ffmpeg"], [], []
        # 禁止在执行阶段联网下载权重。Small 与 DWPose 使用用户预备的 HF 缓存。
        if any(c in ("depth", "pose") for c in job["controls"]):
            from reshot import RunConfig, run_many
        for index, shot in enumerate(job["shots"]):
            remaining()
            segment = output / ("_segment_%02d.mp4" % index)
            segments.append(segment)
            # CPU 编码、24fps、长边最多1280；输入路径不进入返回值。
            factor = min(1.0, 1280.0 / max(width, height))
            scale = "scale=%d:%d" % (max(2, int(width * factor) // 2 * 2),
                                      max(2, int(height * factor) // 2 * 2))
            original_duration = shot["outPoint"] - shot["inPoint"]
            reference_duration = shot.get("referenceDuration", original_duration)
            filters = "fps=24," + scale
            if reference_duration > original_duration + 1e-6:
                # 先截到原片区间，再复制尾帧延长到模型合法时长；不读入下一个生成段。
                filters += ",trim=duration=%s,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=%s" % (
                    original_duration, reference_duration - original_duration)
            command([ffmpeg, "-y", "-loglevel", "error", "-ss", str(shot["inPoint"]),
                     "-i", str(source), "-t", str(reference_duration),
                     "-map", "0:v:0", "-an", "-vf", filters,
                     "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
                     "-pix_fmt", "yuv420p", str(segment)])
            for control in job["controls"]:
                artifact = next(a for a in job["artifacts"]
                                if a["shotKey"] == shot["key"] and a["control"] == control)
                destination = output / artifact["fileName"]
                if control == "canny":
                    cap = cv2.VideoCapture(str(segment))
                    encoder = None
                    try:
                        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                        encoder = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error",
                            "-f", "rawvideo", "-pix_fmt", "gray", "-s", "%dx%d" % (w, h),
                            "-r", "24", "-i", "-", "-an", "-c:v", "libx264",
                            "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p",
                            "-movflags", "+faststart", str(destination)],
                            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
                        frames = 0
                        while True:
                            remaining()
                            ok, frame = cap.read()
                            if not ok: break
                            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                            edges = cv2.Canny(gray, 100, 200)
                            encoder.stdin.write(np.ascontiguousarray(edges).tobytes())
                            frames += 1
                        encoder.stdin.close()
                        encoder.wait(timeout=remaining())
                        if frames == 0 or encoder.returncode != 0: raise RuntimeError("encode_failed")
                    finally:
                        cap.release()
                        if encoder is not None and encoder.poll() is None:
                            encoder.kill()
                            encoder.wait(timeout=2)
                else:
                    configs.append(RunConfig(input=segment, output=destination, control=control,
                        model="small", quality="fast", target="none", fps=24, max_res=1280,
                        pose_face=False, pose_smooth=True, force=False, metrics=None))
        if configs:
            remaining()
            results = run_many(configs)
            if any(isinstance(r, Exception) for r in results):
                raise RuntimeError("reshot_failed")
        for artifact in job["artifacts"]:
            remaining()
            path = output / artifact["fileName"]
            cap = cv2.VideoCapture(str(path))
            try:
                fps = float(cap.get(cv2.CAP_PROP_FPS))
                frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                ok, _frame = cap.read()
                if (not ok or not path.is_file() or path.stat().st_size <= 0
                    or not math.isfinite(fps) or not math.isfinite(frames)
                    or fps <= 0 or frames <= 0 or width < 2 or height < 2):
                    raise RuntimeError("invalid_output")
                shot = next(s for s in job["shots"] if s["key"] == artifact["shotKey"])
                wanted = shot.get("referenceDuration", shot["outPoint"] - shot["inPoint"])
                if abs(frames / fps - wanted) > max(0.15, 2.0 / fps):
                    raise RuntimeError("duration_mismatch")
            finally:
                cap.release()
        for segment in segments:
            segment.unlink(missing_ok=True)
    return {"ok": True, "artifacts": len(job["artifacts"])}

try:
    result = main()
except TimeoutError:
    result = {"ok": False, "code": "timeout"}
except ImportError:
    result = {"ok": False, "code": "dependencies"}
except ValueError as error:
    result = {"ok": False, "code": str(error) if str(error) in ("invalid_video", "outside_video") else "processing"}
except BaseException:
    result = {"ok": False, "code": "processing"}
sys.stdout.write(json.dumps(result, separators=(",", ":")))
'''


def _run_worker(job, seconds):
    environment = dict(os.environ)
    environment.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                        "HF_HUB_DISABLE_TELEMETRY": "1", "PYTHONIOENCODING": "utf-8"})
    environment.pop("RESHOT_FAKE_BACKEND", None)
    try:
        process = subprocess.run([sys.executable, "-c", WORKER],
            input=json.dumps(job, ensure_ascii=False), text=True, encoding="utf-8",
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=environment,
            timeout=seconds, check=False,
            creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
    except subprocess.TimeoutExpired:
        raise ReplicaError("本批处理超过时间限制，请减少镜头或改用线稿。") from None
    except OSError:
        raise ReplicaError("无法启动本机 Python 处理进程，请检查运行环境。") from None
    try:
        status = json.loads(process.stdout)
    except (ValueError, TypeError):
        status = {}
    if not isinstance(status, dict):
        status = {}
    if process.returncode != 0 or status.get("ok") is not True:
        messages = {
            "timeout": "本批处理超过时间限制，请减少镜头或改用线稿。",
            "dependencies": "处理依赖未就绪，请先运行环境准备脚本并重启 AI Canvas。",
            "invalid_video": "无法读取参考视频，请使用可播放的 MP4 文件。",
            "outside_video": "镜头范围超出参考视频，请调整切点。",
        }
        raise ReplicaError(messages.get(status.get("code"),
            "控制视频处理失败。请检查离线权重、显存与磁盘空间，或改用线稿。"))


def _escape_markdown_plain(value):
    # 描述和提示词作为文字展示，避免模型输出生成新的 Markdown 图片引用。
    value = value.replace("\\", "\\\\").replace("<", "&lt;").replace(">", "&gt;")
    for char in "`*_{}[]()#!|":
        value = value.replace(char, "\\" + char)
    return value


def _markdown_text(value):
    # 只保留宿主声明的调用级引用格式，授权与 canonical 改写始终由宿主完成。
    # 普通文本和未知 @ token 仍走原有转义，避免构造新 Markdown 图片。
    chunks, cursor = [], 0
    for match in OPAQUE_MENTION.finditer(value):
        chunks.append(_escape_markdown_plain(value[cursor:match.start()]))
        chunks.append(match.group(0))
        cursor = match.end()
    chunks.append(_escape_markdown_plain(value[cursor:]))
    return "".join(chunks)


def _prompt(shot, options):
    pieces = [shot["prompt"] or shot["description"] or "保留参考镜头的构图、动作和运镜。"]
    for label, key in (("角色", "character"), ("场景", "scene"), ("风格", "style")):
        if options[key]:
            pieces.append(label + "：" + options[key])
    if options["controls"]:
        controls = "、".join(CONTROL_LABELS[c] for c in options["controls"])
        pieces.append("参考控制视频的动作、主体位置、时间顺序和机位；不要保留" + controls + "的可视化外观。")
    return "\n".join(pieces)


def replicate(input_value):
    """先验证整批，再原子返回节点集；任何失败都不返回部分画布结果。"""
    started = time.monotonic()
    if not isinstance(input_value, dict):
        raise ReplicaError("插件输入无效。")
    options = _normalise(input_value.get("parameters"))
    generation = _generation(input_value)
    if input_value["parameters"]["operation"] == "replicate-segment" and generation is not None:
        raise ReplicaError("自动生成段只返回控制素材，视频模型由宿主任务调用。")
    shots, controls = options["shots"], options["controls"]
    node_count = 2 + sum(bool(s["frameResourceId"]) for s in shots) + len(shots) * len(controls)
    if generation is not None and node_count + len(shots) > MAX_NODES:
        raise ReplicaError("包含生成节点后超过 25 个节点，请减少镜头或控制类型。")
    artifacts = []
    if controls:
        if importlib.util.find_spec("cv2") is None or importlib.util.find_spec("numpy") is None:
            raise ReplicaError("缺少 OpenCV 或 NumPy，请先运行环境准备脚本。")
        if any(c in ("depth", "pose") for c in controls) and importlib.util.find_spec("reshot") is None:
            raise ReplicaError("缺少 ReShot 0.5.0，请先运行环境准备脚本；线稿无需 ReShot。")
        resource_id = input_value["parameters"].get("videoResourceId")
        if not isinstance(resource_id, str) or not resource_id:
            raise ReplicaError("请选择参考视频。")
        source, output = _native_paths(input_value, resource_id)
        for index, shot in enumerate(shots):
            for control in controls:
                key = "control_" + shot["key"] + "_" + control
                artifacts.append({"key": key, "shotKey": shot["key"], "control": control,
                                  "fileName": "shot_%02d_%s_%s.mp4" % (index + 1, control, uuid.uuid4().hex),
                                  "mediaType": "video/mp4"})
        remaining = WORK_SECONDS - (time.monotonic() - started)
        if remaining <= 0:
            raise ReplicaError("本批处理超过时间限制，请分批提交。")
        _run_worker({"source": str(source), "output": str(output), "ffmpeg": _ffmpeg_binary(),
                     "seconds": remaining, "shots": shots, "controls": controls,
                     "artifacts": artifacts}, remaining)
    nodes, rows, edges = [], [], []
    sections = ["# 视频复刻方案", "", "按镜头保留构图、动作、机位与时间顺序。生成效果仍需验片。"]
    for index, shot in enumerate(shots):
        number, duration = str(index + 1), round(shot["outPoint"] - shot["inPoint"], 3)
        prompt = _prompt(shot, options)
        row = {"id": shot["key"], "shotNo": number, "duration": duration,
               "content": shot["description"], "note": prompt}
        if shot["frameResourceId"]:
            frame_key = "image_" + shot["key"]
            row["frameKey"] = frame_key
            nodes.append({"key": frame_key, "nodeType": "source-image",
                          "resourceId": shot["frameResourceId"],
                          "data": {"label": "镜头 " + number + " · 参考帧"}})
            edges.append({"sourceKey": frame_key, "targetKey": "shotlist"})
        rows.append(row)
        sections += ["", "## 镜头 " + number + " · %.3fs–%.3fs" % (shot["inPoint"], shot["outPoint"]),
                     "", _markdown_text(shot["description"]), "", _markdown_text(prompt)]
        for artifact in (a for a in artifacts if a["shotKey"] == shot["key"]):
            nodes.append({"key": artifact["key"], "nodeType": "source-video",
                          "artifactKey": artifact["key"],
                          "data": {"label": "镜头 " + number + " · " + CONTROL_LABELS[artifact["control"]],
                                   "prompt": prompt}})
            edges.append({"sourceKey": "shotlist", "targetKey": artifact["key"]})
        if generation is not None:
            generated_key = "generated_" + shot["key"]
            nodes.append({"key": generated_key, "nodeType": "ai-video",
                          "data": {"label": "镜头 " + number + " · 复刻视频", "prompt": prompt},
                          "generation": {"modelId": generation["modelId"],
                                         "parameters": {**generation["parameters"],
                                                        "duration": shot["outPoint"] - shot["inPoint"]}}})
            if shot["frameResourceId"]:
                edges.append({"sourceKey": "image_" + shot["key"], "targetKey": generated_key})
            for artifact in (a for a in artifacts if a["shotKey"] == shot["key"]):
                edges.append({"sourceKey": artifact["key"], "targetKey": generated_key})
    nodes.insert(0, {"key": "shotlist", "nodeType": "ai-shotlist",
                     "data": {"label": "视频复刻 · 分镜表", "shotlistRows": rows}})
    nodes.insert(1, {"key": "prompts", "nodeType": "ai-markdown",
                     "data": {"label": "视频复刻 · 提示词", "output": "\n".join(sections)}})
    edges.append({"sourceKey": "shotlist", "targetKey": "prompts"})
    return {"data": {"nodes": nodes, "edges": edges},
            "artifacts": [{k: a[k] for k in ("key", "fileName", "mediaType")} for a in artifacts],
            "message": "已创建 %d 个镜头方案和 %d 个控制视频%s。" % (
                len(shots), len(artifacts), "，并交给宿主执行视频生成" if generation is not None else "")}


if "define_plugin" in globals():
    define_plugin({"tools": {"replicate": replicate}})
