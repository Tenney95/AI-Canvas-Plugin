# 视频复刻插件：上游来源与许可

插件自身按 Apache License 2.0 分发，完整文本见 `LICENSE`。

## ReShot

- 来源：https://github.com/maosika-ai/reshot
- 核查提交：`770d7220fe79fdf0fdaa84bdce047b90363fc1b5`
- 使用版本：PyPI `reshot[ffmpeg,pose]==0.5.0`
- Copyright 2026 Maosika 猫斯卡 (https://www.maosika.com)
- 许可证：Apache License 2.0。
- 复用方式：通过已安装包调用 `RunConfig` / `run_many`；本目录没有复制其模型实现或权重。
- 适配内容：由宿主授予输入/输出路径；先裁剪镜头；固定 Small / fast；禁用运行期模型下载；丢弃路径日志和完整 metrics；控制视频作为原生 artifact 导入。

ReShot 的上游 NOTICE 还列出：

- Video Depth Anything（ByteDance）：Apache License 2.0；ReShot 包内包含其实现。
- DWPose（IDEA-Research）：Apache License 2.0；ReShot 的姿态预后处理与 OpenPose 风格绘制基于其实现。

使用或重新分发 ReShot 包时，必须一并保留该包的 LICENSE、NOTICE 与第三方许可。
本插件第一版仅使用 Video Depth Anything Small 与 DWPose。Small、`yolox_l.onnx` 和
`dw-ll_ucoco_384.onnx` 的许可由 ReShot 上游列为 Apache-2.0；具体权重包仍携带各自许可。
Video Depth Anything Base / Large 为 CC-BY-NC-4.0，本插件不提供这两个选项。

## video-breakdown

- 来源：https://github.com/keng1304/video-breakdown
- 核查提交：`a8188e148ed07381ee91915d78da3462474c016a`
- 参考入口：`src/director/structure/schema.py`、`src/director/prompt/claude_vision.py`、`src/director/prompt/keyframe_selector.py`。
- 参考内容：镜头时长、构图、运镜、光色与提示词的结构；每镜头少量关键帧；视觉分析返回结构化结果。
- 适配内容：宿主承担镜头检测、抽帧和模型调用；人工确认切点；本插件没有复制其 macOS 安装脚本、CoreML/MPS 设备选择或固定 Anthropic 网络调用。
- 根 LICENSE 为 MIT；其 pyproject.toml 的旧元数据仍标注 Proprietary。此处依据核查提交的根 LICENSE 保留完整 MIT 文本。

### video-breakdown MIT License

MIT License

Copyright (c) 2026 tzukaoltd.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
