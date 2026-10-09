"""离线合同与真实短片测试：不下载模型、不调用付费 API。"""

import contextlib
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("video_replica", ROOT / "main.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


def invocation(controls=None, shots=None):
    return {"parameters": {"operation": "replicate", "videoResourceId": "video-resource",
        "shots": shots or [{"key": "shot-1", "inPoint": 0, "outPoint": 1,
                            "description": "人物走过画面", "prompt": "跟随人物，保持运镜。"}],
        "controls": [] if controls is None else controls,
        "character": "机器人", "scene": "街道", "style": "动画"}}


class ContractTests(unittest.TestCase):
    def test_registers_exact_tool(self):
        definitions = []
        namespace = {"define_plugin": definitions.append}
        exec(compile((ROOT / "main.py").read_text(encoding="utf-8"), "plugin", "exec"), namespace)
        self.assertEqual(len(definitions), 1)
        self.assertEqual(set(definitions[0]["tools"]), {"replicate"})

    def test_prompt_only_and_reference_frame_binding(self):
        value = invocation()
        value["parameters"]["shots"][0]["frameResourceId"] = "frame-resource"
        result = plugin.replicate(value)
        self.assertEqual(result["artifacts"], [])
        self.assertEqual(len(result["data"]["nodes"]), 3)
        shotlist, markdown, frame = result["data"]["nodes"]
        row = shotlist["data"]["shotlistRows"][0]
        self.assertEqual(shotlist["nodeType"], "ai-shotlist")
        self.assertEqual(row["frameKey"], frame["key"])
        self.assertEqual(frame["resourceId"], "frame-resource")
        self.assertIn("角色：机器人", row["note"])
        self.assertIn("跟随人物", markdown["data"]["output"])
        self.assertEqual(len({n["key"] for n in result["data"]["nodes"]}), 3)

    def test_prompt_text_cannot_become_markdown_image(self):
        value = invocation()
        value["parameters"]["shots"][0]["prompt"] = '![外部图](https://example.com/x.png) <img src="x">'
        markdown = plugin.replicate(value)["data"]["nodes"][1]["data"]["output"]
        self.assertNotIn("![", markdown)
        self.assertNotIn("<img", markdown)

    def test_markdown_preserves_only_strict_host_opaque_tokens(self):
        token = "@{plugin-ref-12345678-1234-4234-8234-123456789abc:女演员}"
        text = token + " ![额外图片](https://example.com/x) @asset{unknown}"
        markdown = plugin._markdown_text(text)
        self.assertIn(token, markdown)
        self.assertNotIn("![", markdown)
        self.assertIn("@asset\\{unknown\\}", markdown)
        for invalid in ("@{plugin-ref-not-a-uuid:角色}",
                        "@{plugin-ref-12345678-1234-4234-8234-123456789abc:角色:额外字段}"):
            self.assertNotIn(invalid, plugin._markdown_text(invalid))

    def test_global_and_per_shot_mentions_are_preserved_in_material_and_generation_prompts(self):
        role = "@{plugin-ref-12345678-1234-4234-8234-123456789abc:女演员}"
        scene = "@{plugin-ref-22345678-1234-4234-8234-123456789abc:街道场景}"
        first = "@{plugin-ref-32345678-1234-4234-8234-123456789abc:镜头一素材}"
        second = "@{plugin-ref-42345678-1234-4234-8234-123456789abc:镜头二素材}"
        shots = [{"key": "first", "inPoint": 0, "outPoint": 1, "prompt": "跟随走路 " + first},
                 {"key": "second", "inPoint": 1, "outPoint": 2, "prompt": "保持特写 " + second}]
        for backend in ("materials", "model"):
            value = invocation(["canny"], shots)
            value["parameters"].update({"character": role + "，红色风衣", "scene": scene})
            value["parameters"]["generation"] = {"backend": backend}
            if backend == "model":
                value["models"] = [{"id": "selected-video", "provider": "volcengine", "category": "video"}]
                value["parameters"]["generation"]["modelId"] = "selected-video"
            with self.subTest(backend=backend), \
                    patch.object(plugin.importlib.util, "find_spec", return_value=object()), \
                    patch.object(plugin, "_native_paths", return_value=(Path("native-source"), Path("native-output"))), \
                    patch.object(plugin, "_ffmpeg_binary", return_value="ffmpeg"), \
                    patch.object(plugin, "_run_worker"):
                result = plugin.replicate(value)
            nodes = result["data"]["nodes"]
            rows = next(n["data"]["shotlistRows"] for n in nodes if n["nodeType"] == "ai-shotlist")
            markdown = next(n["data"]["output"] for n in nodes if n["nodeType"] == "ai-markdown")
            for token in (role, scene, first, second):
                self.assertIn(token, markdown)
            for key, current, other, row in (("first", first, second, rows[0]), ("second", second, first, rows[1])):
                control = next(n for n in nodes if n["key"] == "control_" + key + "_canny")
                for prompt in (row["note"], control["data"]["prompt"]):
                    self.assertIn(role, prompt)
                    self.assertIn(scene, prompt)
                    self.assertIn(current, prompt)
                    self.assertNotIn(other, prompt)
                if backend == "model":
                    generated = next(n for n in nodes if n["key"] == "generated_" + key)
                    self.assertEqual(generated["data"]["prompt"], control["data"]["prompt"])
            self.assertNotIn("native-source", json.dumps(result, ensure_ascii=False))

    def test_rejects_bad_ranges_controls_and_node_overflow(self):
        mutations = [
            {"inPoint": -1}, {"inPoint": True}, {"outPoint": float("nan")},
            {"outPoint": float("inf")}, {"outPoint": 16}, {"outPoint": 0},
            {"key": "../bad"},
        ]
        for mutation in mutations:
            value = invocation()
            value["parameters"]["shots"][0].update(mutation)
            with self.subTest(mutation=mutation), self.assertRaises(plugin.ReplicaError):
                plugin.replicate(value)
        for controls in (["depth", "depth"], ["other"], "canny", [None]):
            with self.subTest(controls=controls), self.assertRaises(plugin.ReplicaError):
                plugin.replicate(invocation(controls))
        shots = [{"key": "s%d" % i, "inPoint": i, "outPoint": i + 1,
                  "frameResourceId": "frame%d" % i} for i in range(6)]
        with self.assertRaisesRegex(plugin.ReplicaError, "25"):
            plugin.replicate(invocation(["depth", "pose", "canny"], shots))

    def test_rejects_duplicate_and_overlapping_shots(self):
        for second in ({"key": "shot-1", "inPoint": 1, "outPoint": 2},
                       {"key": "shot-2", "inPoint": 0.5, "outPoint": 2}):
            value = invocation()
            value["parameters"]["shots"].append(second)
            with self.assertRaises(plugin.ReplicaError):
                plugin.replicate(value)

    def test_native_paths_are_required_and_errors_are_sanitised(self):
        with self.assertRaisesRegex(plugin.ReplicaError, "授权"):
            plugin._native_paths({}, "resource")
        with self.assertRaises(plugin.ReplicaError) as error:
            plugin._native_paths({"nativeMedia": {"inputFiles": {"resource": "D:/private/key"},
                                                  "outputDir": "D:/private/output"}}, "resource")
        self.assertNotIn("private", str(error.exception))

    def test_worker_forces_offline_and_clears_fake_backend(self):
        result = subprocess.CompletedProcess([], 0, '{"ok":true}')
        with patch.dict(os.environ, {"RESHOT_FAKE_BACKEND": "1"}), \
                patch.object(plugin.subprocess, "run", return_value=result) as run:
            plugin._run_worker({"seconds": 1}, 1)
        env = run.call_args.kwargs["env"]
        self.assertEqual(env["HF_HUB_OFFLINE"], "1")
        self.assertEqual(env["TRANSFORMERS_OFFLINE"], "1")
        self.assertNotIn("RESHOT_FAKE_BACKEND", env)
        self.assertEqual(run.call_args.kwargs["timeout"], 1)

    def test_timeout_and_upstream_failures_do_not_leak_paths(self):
        with patch.object(plugin.subprocess, "run", side_effect=subprocess.TimeoutExpired("python", 1)):
            with self.assertRaisesRegex(plugin.ReplicaError, "时间"):
                plugin._run_worker({}, 1)
        bad = subprocess.CompletedProcess([], 0, '{"ok":false,"code":"D:/private/path"}')
        with patch.object(plugin.subprocess, "run", return_value=bad):
            with self.assertRaises(plugin.ReplicaError) as error:
                plugin._run_worker({}, 1)
        self.assertNotIn("private", str(error.exception))

    def test_malformed_worker_status_fails_closed(self):
        for text in ("[]", "null", "unstructured progress", '{"ok":false}'):
            with self.subTest(text=text):
                result = subprocess.CompletedProcess([], 0, text)
                with patch.object(plugin.subprocess, "run", return_value=result):
                    with self.assertRaises(plugin.ReplicaError):
                        plugin._run_worker({}, 1)


class GenerationTests(unittest.TestCase):
    def value(self, backend="model", provider="volcengine"):
        value = invocation()
        value["models"] = [{"id": "selected-video", "provider": provider, "category": "video"}]
        value["parameters"]["generation"] = {"backend": backend, "modelId": "selected-video",
                                               "parameters": {"duration": 10, "aspectRatio": "16:9"}}
        return value

    def test_model_generation_is_delegated_and_uses_exact_shot_duration(self):
        value = self.value()
        value["parameters"]["shots"][0].update({"inPoint": 0.125, "outPoint": 1.875,
                                                "frameResourceId": "frame-resource"})
        result = plugin.replicate(value)
        generated = next(n for n in result["data"]["nodes"] if n["nodeType"] == "ai-video")
        self.assertEqual(generated["generation"], {"modelId": "selected-video",
                                                  "parameters": {"duration": 1.75, "aspectRatio": "16:9"}})
        self.assertIn({"sourceKey": "image_shot-1", "targetKey": generated["key"]}, result["data"]["edges"])
        self.assertNotIn({"sourceKey": "shotlist", "targetKey": generated["key"]}, result["data"]["edges"])
        self.assertEqual(result["artifacts"], [])

    def test_comfy_provider_is_matched_and_materials_creates_no_generation(self):
        result = plugin.replicate(self.value("comfyui", "comfyui"))
        self.assertEqual(sum(n["nodeType"] == "ai-video" for n in result["data"]["nodes"]), 1)
        material = plugin.replicate(self.value("materials"))
        self.assertFalse(any(n["nodeType"] == "ai-video" for n in material["data"]["nodes"]))

    def test_model_must_be_in_video_catalog_and_match_selected_backend(self):
        for backend, provider in (("model", "comfyui"), ("comfyui", "volcengine")):
            with self.subTest(backend=backend), self.assertRaises(plugin.ReplicaError):
                plugin.replicate(self.value(backend, provider))
        for mutation in ({"id": "unknown"}, {"category": "image"}):
            value = self.value()
            value["models"][0].update(mutation)
            with self.assertRaises(plugin.ReplicaError):
                plugin.replicate(value)

    def test_rejects_paths_workflows_and_unsafe_parameter_values(self):
        invalid = [{"url": "https://example.com/video"}, {"provider": "comfyui"},
                   {"workflow": {"node": "custom"}}, {"videoFps": True}, {"generateAudio": 1},
                   {"videoFrames": 0}, {"duration": float("nan")}, {"duration": 10 ** 500},
                   {"resolution": "../../file"}, {"aspectRatio": "https://example.com"}]
        for parameters in invalid:
            value = self.value()
            value["parameters"]["generation"]["parameters"] = parameters
            with self.subTest(parameters=parameters), self.assertRaises(plugin.ReplicaError):
                plugin.replicate(value)
        value = self.value()
        value["parameters"]["generation"]["workflow"] = "external"
        with self.assertRaises(plugin.ReplicaError):
            plugin.replicate(value)

    def test_generation_nodes_are_included_in_budget_before_media_work(self):
        value = self.value()
        value["parameters"]["controls"] = ["depth", "pose"]
        value["parameters"]["shots"] = [{"key": "s%d" % i, "inPoint": i, "outPoint": i + 1,
                                          "frameResourceId": "f%d" % i} for i in range(6)]
        with patch.object(plugin, "_run_worker") as worker:
            with self.assertRaisesRegex(plugin.ReplicaError, "25"):
                plugin.replicate(value)
        worker.assert_not_called()

    def test_parameter_values_match_host_generation_contract(self):
        value = self.value()
        value["parameters"]["generation"]["parameters"] = {"duration": 60, "aspectRatio": "adaptive",
            "resolution": "4k", "videoResolution": 4096, "videoFps": 120, "videoFrames": 4096,
            "generateAudio": True}
        result = plugin.replicate(value)
        parameters = next(n["generation"]["parameters"] for n in result["data"]["nodes"] if n["nodeType"] == "ai-video")
        self.assertEqual(parameters["duration"], 1)
        self.assertEqual(parameters["aspectRatio"], "adaptive")
        for key, item in (("duration", 61), ("aspectRatio", "auto"), ("resolution", "2160p"),
                          ("videoResolution", 255), ("videoResolution", 4097), ("videoFrames", 4097)):
            invalid = self.value()
            invalid["parameters"]["generation"]["parameters"] = {key: item}
            with self.subTest(key=key, value=item), self.assertRaises(plugin.ReplicaError):
                plugin.replicate(invalid)


class DownloadSetupTests(unittest.TestCase):
    """权重准备脚本下载器：网络以固定字节替换，验证损坏文件不能入缓存。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="replica_cache_test_")
        self.cache = Path(self.temp.name)
        script = (ROOT / "tools/prepare-runtime.ps1").read_text(encoding="utf-8")
        download = re.search(r"\$downloadCode = @'\n([\s\S]*?)\n'@", script).group(1)
        helpers = download.split("\nfor repo, revision, filename, size, digest in weights:")[0]
        fake_hf = types.ModuleType("huggingface_hub")
        fake_hf.hf_hub_download = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("missing HEAD metadata"))
        fake_constants = types.ModuleType("huggingface_hub.constants")
        fake_constants.HF_HUB_CACHE = str(self.cache)
        self.namespace = {}
        with patch.dict(sys.modules, {"huggingface_hub": fake_hf, "huggingface_hub.constants": fake_constants}):
            exec(compile(helpers, "model-download-helpers", "exec"), self.namespace)

    def tearDown(self):
        self.temp.cleanup()

    def response(self, data, declared_size=None):
        class Response(io.BytesIO):
            status = 200
            headers = {"Content-Length": str(len(data) if declared_size is None else declared_size)}
            def geturl(self):
                return "https://us.aws.cdn.hf.co/test"
        return Response(data)

    def prepare(self, data, size, digest):
        opener = types.SimpleNamespace(open=lambda *args, **kwargs: self.response(data, size))
        with patch.object(self.namespace["urllib"].request, "build_opener", return_value=opener), \
                contextlib.redirect_stdout(io.StringIO()):
            self.namespace["prepare"]("owner/model", "a" * 40, "weights.bin", size, digest)

    def test_verified_bytes_and_ref_are_written_only_after_validation(self):
        data = b"approved model bytes"
        self.prepare(data, len(data), hashlib.sha256(data).hexdigest())
        folder = self.cache / "models--owner--model"
        self.assertEqual((folder / "snapshots" / ("a" * 40) / "weights.bin").read_bytes(), data)
        self.assertEqual((folder / "refs/main").read_text(encoding="utf-8"), "a" * 40)
        self.assertEqual(len(list(self.cache.glob("*.download"))), 0)

    def test_wrong_checksum_or_oversize_never_creates_snapshot_or_ref(self):
        for data, size in ((b"bad model bytes", 15), (b"x" * 20, 15)):
            with self.subTest(size=size), self.assertRaises(RuntimeError):
                self.prepare(data, size, hashlib.sha256(b"approved bytes").hexdigest())
            self.assertFalse((self.cache / "models--owner--model" / "refs/main").exists())
            self.assertEqual(len(list(self.cache.glob("*.download"))), 0)

    def test_standard_downloader_is_staged_before_snapshot_and_ref(self):
        data = b"approved model bytes"
        folder = self.cache / "models--owner--model"
        def staged_download(repo, filename, **kwargs):
            self.assertFalse((folder / "refs/main").exists())
            self.assertFalse((folder / "snapshots" / ("a" * 40) / filename).exists())
            candidate = Path(kwargs["local_dir"]) / filename
            candidate.write_bytes(data)
            return str(candidate)
        self.namespace["hf_hub_download"] = staged_download
        self.namespace["prepare"]("owner/model", "a" * 40, "weights.bin", len(data), hashlib.sha256(data).hexdigest())
        self.assertEqual((folder / "snapshots" / ("a" * 40) / "weights.bin").read_bytes(), data)
        self.assertFalse(list(self.cache.glob("video-replica-stage-*")))

    def test_bad_existing_cache_is_not_overwritten(self):
        destination = self.cache / "models--owner--model/snapshots" / ("a" * 40) / "weights.bin"
        destination.parent.mkdir(parents=True)
        destination.write_bytes(b"existing data")
        with self.assertRaisesRegex(RuntimeError, "no overwrite"):
            self.prepare(b"replacement", 11, hashlib.sha256(b"replacement").hexdigest())
        self.assertEqual(destination.read_bytes(), b"existing data")

    def test_download_rejects_nonofficial_and_insecure_redirects(self):
        allowed = self.namespace["allowed_url"]
        self.assertTrue(allowed("https://huggingface.co/model"))
        self.assertTrue(allowed("https://us.aws.cdn.hf.co/file"))
        for url in ("http://huggingface.co/file", "https://huggingface.co.evil/file", "https://example.com/file"):
            self.assertFalse(allowed(url))
        with self.assertRaises(RuntimeError):
            self.namespace["inside_cache"](self.cache.parent / "outside-model-cache")


@unittest.skipUnless(importlib.util.find_spec("cv2") and importlib.util.find_spec("numpy")
                     and shutil.which("ffmpeg"), "真实短片测试需要本机 OpenCV、NumPy 与 FFmpeg")
class MediaTests(unittest.TestCase):
    def setUp(self):
        import cv2
        import numpy as np
        self.temp = tempfile.TemporaryDirectory(prefix="video_replica_test_")
        self.folder = Path(self.temp.name)
        self.source = self.folder / "reference.mp4"
        writer = cv2.VideoWriter(str(self.source), cv2.VideoWriter_fourcc(*"mp4v"), 24, (160, 96))
        self.assertTrue(writer.isOpened())
        for index in range(48):
            frame = np.zeros((96, 160, 3), dtype=np.uint8)
            cv2.rectangle(frame, (10 + index, 20), (45 + index, 70), (255, 255, 255), 2)
            writer.write(frame)
        writer.release()
        self.output = self.folder / "output"
        self.output.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def test_real_canny_is_video_with_edges_and_no_path_in_return(self):
        import cv2
        value = invocation(["canny"])
        value["nativeMedia"] = {"inputFiles": {"video-resource": str(self.source)},
                                "outputDir": str(self.output)}
        result = plugin.replicate(value)
        self.assertEqual(len(result["artifacts"]), 1)
        artifact = result["artifacts"][0]
        self.assertEqual(Path(artifact["fileName"]).name, artifact["fileName"])
        cap = cv2.VideoCapture(str(self.output / artifact["fileName"]))
        try:
            ok, frame = cap.read()
            self.assertTrue(ok)
            self.assertGreater(float(frame.mean()), 0)
            self.assertGreater(float(frame.max()), 100)
            self.assertAlmostEqual(cap.get(cv2.CAP_PROP_FRAME_COUNT) / cap.get(cv2.CAP_PROP_FPS), 1, delta=0.1)
        finally:
            cap.release()
        serialized = json.dumps(result, ensure_ascii=False)
        self.assertNotIn(str(self.folder), serialized)
        self.assertEqual(len(list(self.output.iterdir())), 1)
        control = next(n for n in result["data"]["nodes"] if n["nodeType"] == "source-video")
        self.assertEqual(control["artifactKey"], artifact["key"])

    def test_real_canny_accepts_unicode_source_name(self):
        renamed = self.folder / "参考视频.mp4"
        self.source.rename(renamed)
        self.source = renamed
        value = invocation(["canny"])
        value["nativeMedia"] = {"inputFiles": {"video-resource": str(self.source)},
                                "outputDir": str(self.output)}
        self.assertEqual(len(plugin.replicate(value)["artifacts"]), 1)

    def test_model_calls_reuse_reshot_api_with_fake_package(self):
        # 真正运行 worker 与 FFmpeg，但模型以本地测试替身替换，不声称通过真实推理。
        fake = self.folder / "fake_packages" / "reshot"
        fake.mkdir(parents=True)
        (fake / "__init__.py").write_text('''
import shutil
class RunConfig:
    def __init__(self, **kwargs):
        assert kwargs["model"] == "small" and kwargs["quality"] == "fast"
        assert kwargs["metrics"] is None and kwargs["force"] is False
        self.__dict__.update(kwargs)
def run_many(configs):
    for cfg in configs: shutil.copyfile(cfg.input, cfg.output)
    return [object() for cfg in configs]
''', encoding="utf-8")
        shots = [{"key": "a", "inPoint": 0, "outPoint": 1},
                 {"key": "b", "inPoint": 1, "outPoint": 2}]
        artifacts = [{"key": "control_"+s["key"]+"_"+c, "shotKey": s["key"], "control": c,
                      "fileName": s["key"]+"_"+c+".mp4"} for s in shots for c in ("depth", "pose")]
        with patch.dict(os.environ, {"PYTHONPATH": str(fake.parent)}):
            plugin._run_worker({"source": str(self.source), "output": str(self.output),
                "ffmpeg": plugin._ffmpeg_binary(), "seconds": 15, "shots": shots,
                "controls": ["depth", "pose"], "artifacts": artifacts}, 15)
        self.assertEqual(len(list(self.output.iterdir())), 4)

    def test_outside_video_range_fails_without_canvas_result(self):
        value = invocation(["canny"])
        value["parameters"]["shots"][0]["outPoint"] = 3
        value["nativeMedia"] = {"inputFiles": {"video-resource": str(self.source)},
                                "outputDir": str(self.output)}
        with self.assertRaisesRegex(plugin.ReplicaError, "超出"):
            plugin.replicate(value)


if __name__ == "__main__":
    unittest.main()
