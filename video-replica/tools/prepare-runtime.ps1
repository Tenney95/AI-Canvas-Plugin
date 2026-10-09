#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Python = 'python',
    [string[]]$PythonArgs = @(),
    [ValidateSet('Canny', 'Full')][string]$Mode = 'Canny',
    [string]$TorchIndex = 'https://download.pytorch.org/whl/cpu',
    [switch]$DownloadModels
)

$ErrorActionPreference = 'Stop'

function Invoke-PluginPython {
    param([string[]]$Arguments)
    & $Python @PythonArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Python 命令未成功完成；请检查当前解释器、网络和包兼容性。'
    }
}

# 宿主使用其探测到的解释器，不会自动切换到任意 venv。
Invoke-PluginPython -Arguments @('-c', 'import sys; print("Python:", sys.version.split()[0]); assert sys.version_info >= (3,10), "Requires Python >=3.10"')

if ($Mode -eq 'Canny') {
    $requestedModules = 'canny'
} else {
    Write-Host '安装到以上 Python。CUDA 用户请通过 -TorchIndex 指定与显卡驱动兼容的官方 PyTorch wheel 索引。'
    $torchCheck = & $Python @PythonArgs '-c' 'import importlib.util; found=[bool(importlib.util.find_spec(n)) for n in ("torch","torchvision")]; print("ready" if all(found) else ("partial" if any(found) else "missing"))'
    if ($LASTEXITCODE -ne 0) { throw '无法检查现有 PyTorch 环境。' }
    if ($torchCheck.Trim() -eq 'missing') {
        Invoke-PluginPython -Arguments @('-m', 'pip', 'install', 'torch>=2.1', 'torchvision>=0.16', '--index-url', $TorchIndex)
    } elseif ($torchCheck.Trim() -eq 'partial') {
        throw '现有 Torch / TorchVision 不完整，请按当前 CUDA 与 Torch 版本补齐匹配包；脚本不会自动替换已有构建。'
    } else {
        Invoke-PluginPython -Arguments @('-c', 'import torch, torchvision; print("Keep existing Torch:", torch.__version__, "TorchVision:", torchvision.__version__); assert tuple(map(int, torch.__version__.split(chr(43))[0].split(chr(46))[:2])) >= (2,1), "Existing Torch is too old; upgrade manually"')
    }
    # 固定入口版本；缺失依赖单独补齐，避免 ReShot 再安装一份 OpenCV 或替换现有 CUDA Torch。
    Invoke-PluginPython -Arguments @('-m', 'pip', 'install', '--no-deps', 'reshot==0.5.0')
    $requestedModules = 'full'
}

$dependencyCode = @'
import importlib, importlib.util, json, sys
packages = [
    ("numpy", "numpy>=1.24,<3", (1,24)),
    ("cv2", "opencv-python-headless>=4.8,<5", (4,8)),
    ("imageio_ffmpeg", "imageio-ffmpeg>=0.4.7,<0.7", (0,4)),
]
if sys.argv[1] == "full":
    packages += [("einops", "einops>=0.4", (0,4)), ("easydict", "easydict", None),
                 ("tqdm", "tqdm", None), ("huggingface_hub", "huggingface-hub>=0.20", (0,20)),
                 ("onnxruntime", "onnxruntime>=1.16", (1,16)), ("psutil", "psutil>=5.9,<8", (5,9))]
missing = []
for module, package, minimum in packages:
    if importlib.util.find_spec(module) is None:
        missing.append(package)
    elif minimum:
        value = importlib.import_module(module).__version__.split("+")[0].split(".")
        if tuple(map(int,value[:2])) < minimum:
            raise RuntimeError(module + " version is too old; review and upgrade manually")
print(json.dumps(missing))
'@
$missingJson = & $Python @PythonArgs '-c' $dependencyCode $requestedModules
if ($LASTEXITCODE -ne 0) { throw '现有 Python 依赖无法使用；请先修复环境，脚本不会自动覆盖旧版本。' }
$missingPackages = $missingJson | ConvertFrom-Json
foreach ($package in $missingPackages) {
    Invoke-PluginPython -Arguments @('-m', 'pip', 'install', $package)
}

if ($DownloadModels) {
    if ($Mode -ne 'Full') {
        throw '-DownloadModels 仅用于 -Mode Full；线稿不需要模型。'
    }
    # 只有用户显式执行本开关时下载；插件运行阶段强制 HF_HUB_OFFLINE。
    $downloadCode = @'
import hashlib, os, sys, tempfile, time, urllib.parse, urllib.request
from pathlib import Path
os.environ.pop("HF_HUB_OFFLINE", None)
from huggingface_hub import hf_hub_download
from huggingface_hub.constants import HF_HUB_CACHE

# 固定 revision / 大小来自官方 HF blobs API；SHA 还与 ReShot 固定提交的
# scripts/mirror_weights_to_modelscope.py 逐项一致。仅 Apache-2.0 的 Small / DWPose。
weights = [
    ("depth-anything/Video-Depth-Anything-Small", "256875362cff76724b920335dfb4b29dd611f66e",
     "video_depth_anything_vits.pth", 116440756,
     "13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609"),
    ("yzd-v/DWPose", "1a7144101628d69ee7a3768d1ee3a094070dc388", "yolox_l.onnx", 216746733,
     "7860ae79de6c89a3c1eb72ae9a2756c0ccfbe04b7791bb5880afabd97855a411"),
    ("yzd-v/DWPose", "1a7144101628d69ee7a3768d1ee3a094070dc388", "dw-ll_ucoco_384.onnx", 134399116,
     "724f4ff2439ed61afb86fb8a1951ec39c6220682803b4a8bd4f598cd913b1843"),
]
cache = Path(HF_HUB_CACHE).resolve()
cache.mkdir(parents=True, exist_ok=True)

def inside_cache(path):
    if not path.resolve().is_relative_to(cache):
        raise RuntimeError("Cache path escaped the selected Hugging Face cache")
    return path

def verified(path, size, digest):
    if not path.is_file() or path.stat().st_size != size:
        return False
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest() == digest

def allowed_url(url):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    return parsed.scheme == "https" and (host == "huggingface.co" or host.endswith(".hf.co"))

class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise RuntimeError("Unexpected model download redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def prepare(repo, revision, filename, size, digest):
    folder = inside_cache(cache / ("models--" + repo.replace("/", "--")))
    destination = inside_cache(folder / "snapshots" / revision / filename)
    if destination.exists() and not verified(destination, size, digest):
        raise RuntimeError("Existing cache has an unexpected checksum; no overwrite was attempted")
    if not verified(destination, size, digest):
        # 标准 HF 下载器先尝试；若 HEAD 元数据被代理剥离，则使用官方固定 revision GET。
        # local_dir 也指向暂存区：标准下载器成功时同样不得提前把未校验字节写入 snapshot。
        with tempfile.TemporaryDirectory(prefix="video-replica-stage-", dir=cache) as staging:
            try:
                candidate = Path(hf_hub_download(repo, filename, revision=revision, local_dir=staging))
                standard_ok = verified(candidate, size, digest)
            except Exception:
                standard_ok = False
            if standard_ok:
                inside_cache(destination.parent).mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    if not verified(destination, size, digest):
                        raise RuntimeError("Concurrent model cache changed; no overwrite was attempted")
                else:
                    os.replace(candidate, destination)
        if not verified(destination, size, digest):
            print("Official GET fallback:", repo, filename, flush=True)
            url = "https://huggingface.co/" + repo + "/resolve/" + revision + "/" + filename
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(prefix="video-replica-", suffix=".download", dir=cache, delete=False) as output:
                    temporary = Path(output.name)
                    opener = urllib.request.build_opener(OfficialRedirect())
                    request = urllib.request.Request(url, headers={"User-Agent": "AI-Canvas-Video-Replica/0.1"})
                    with opener.open(request, timeout=60) as response:
                        if response.status != 200 or not allowed_url(response.geturl()):
                            raise RuntimeError("Unexpected model download response")
                        length = response.headers.get("Content-Length")
                        if length is not None and int(length) != size:
                            raise RuntimeError("Model download size mismatch")
                        received, last_progress, started = 0, -1, time.monotonic()
                        while True:
                            if time.monotonic() - started > 600:
                                raise TimeoutError("Model download exceeded ten minutes")
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            received += len(chunk)
                            if received > size:
                                raise RuntimeError("Model download exceeded expected size")
                            output.write(chunk)
                            progress = received * 10 // size
                            if progress != last_progress:
                                last_progress = progress
                                print("Downloading:", filename, "%d%%" % (progress * 10), flush=True)
                if not verified(temporary, size, digest):
                    raise RuntimeError("Model download size or SHA-256 mismatch")
                inside_cache(destination.parent).mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    if not verified(destination, size, digest):
                        raise RuntimeError("Concurrent model cache changed; no overwrite was attempted")
                else:
                    os.replace(temporary, destination)
                    temporary = None
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
    if not verified(destination, size, digest):
        raise RuntimeError("Snapshot validation failed")
    # ReShot 默认请求 main。仅在该文件已通过固定 SHA 后更新本地 main ref，不改变端点设置。
    refs = inside_cache(folder / "refs")
    refs.mkdir(parents=True, exist_ok=True)
    reference = inside_cache(refs / "main")
    with tempfile.NamedTemporaryFile(prefix="video-replica-ref-", dir=refs, delete=False) as stream:
        reference_temp = Path(stream.name)
        stream.write(revision.encode("utf-8"))
    try:
        os.replace(reference_temp, reference)
    finally:
        reference_temp.unlink(missing_ok=True)

for repo, revision, filename, size, digest in weights:
    try:
        prepare(repo, revision, filename, size, digest)
    except Exception as error:
        print("Model preparation failed:", type(error).__name__, "Check the endpoint, network and cache.", file=sys.stderr)
        raise SystemExit(1)
    print("Prepared, size + SHA-256 verified:", repo, filename, flush=True)
'@
    Invoke-PluginPython -Arguments @('-c', $downloadCode)
}

Invoke-PluginPython -Arguments @('-c', 'import cv2, numpy; print("OpenCV:", cv2.__version__, "NumPy:", numpy.__version__)')
if ($Mode -eq 'Full') {
    Invoke-PluginPython -Arguments @('-c', 'import reshot, torch, onnxruntime; from huggingface_hub import hf_hub_download; print("ReShot:", reshot.__version__, "CUDA:", torch.cuda.is_available()); print("ONNX:", onnxruntime.__version__)')
}
Write-Host '环境准备完成。请重启 AI Canvas，确认插件设置页的 Python 版本与这里一致。'
