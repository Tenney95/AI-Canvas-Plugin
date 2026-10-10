# AI-Canvas-Plugin

[AI Canvas](https://github.com/Tenney95/AI-Canvas-tauri) 的插件集合。仓库支持多个插件，每个插件放在独立目录中，包含安装清单、源码、使用说明和许可声明，可以分别安装、更新和准备依赖。

## 插件目录

| 插件 | 目录 | 功能 | 使用说明 |
| --- | --- | --- | --- |
| 视频复刻 | [video-replica](./video-replica/) | 自动分段或手动打点，提取音频与对白，制作深度、骨架或线稿控制视频，通过应用已配置的模型或 ComfyUI 逐段生成并合成 | [安装与操作](./video-replica/使用说明.md) |

视频复刻支持替换角色和场景的 `@` 引用，共用应用的引用选择器、下拉菜单与时间轴。重新生成的画面由模型决定，不保证逐帧一致。

## 安装

1. 克隆或下载本仓库，保留每个插件目录内的文件结构。
2. 在 AI Canvas 的插件设置中导入插件目录中的 `manifest.json`。视频复刻的入口是 `video-replica/manifest.json`。
3. 按宿主提示完成启用确认，并根据插件使用说明准备所需环境。

安装包已包含构建后的 `ui.js`，使用插件无需先构建前端。视频复刻需要支持清单中 `requiredCapabilities` 的 AI Canvas 版本；其最低版本声明为 `0.10.2`，实际所需能力以宿主安装检查为准。

视频复刻使用可信 Python，以当前用户权限运行。深度和骨架需要另外准备 ReShot、Python 依赖与模型权重；这些文件不随仓库分发。视频模型调用可能产生费用。详见插件的[使用说明](./video-replica/使用说明.md)。

## 开发与验证

新增插件在仓库根目录下建立同级目录，并使用独立的插件 ID 和版本号。根目录维护插件索引，插件之间不嵌套，也不共用安装清单。当前目录结构如下：

```text
AI-Canvas-Plugin/
├── README.md
├── LICENSE
└── video-replica/
    ├── manifest.json
    ├── main.py
    ├── src/ui.js
    ├── ui.js
    ├── tools/
    ├── tests/
    ├── LICENSE
    ├── NOTICE.md
    └── 使用说明.md
```

宿主提供[插件 SDK](https://github.com/Tenney95/AI-Canvas-tauri/tree/master/sdk)和[插件开发规范](https://github.com/Tenney95/AI-Canvas-tauri/blob/master/doc/插件开发规范.md)。视频复刻的构建直接复用宿主共享组件与 UI Kit，需要对应的宿主源码及其 npm 依赖。请将两份仓库放在同级目录，或通过 `--host` 指定宿主目录。

在本仓库根目录运行：

```powershell
node video-replica/tools/build-ui.mjs --host ../AI-Canvas-tauri
node --test video-replica/tests/ui.test.mjs
python -B -m unittest discover -s video-replica/tests -v
node video-replica/tools/check-plugin.mjs --host ../AI-Canvas-tauri
```

构建会更新 `ui.js` 和清单中的 SHA-256 摘要。运行 Python 测试前需准备对应测试依赖。自动化测试不代表付费模型、真实 ComfyUI 工作流或桌面原生窗口已完成验收。

## 许可与来源

仓库自身代码采用 [Apache License 2.0](./LICENSE)，插件目录中的许可和来源声明随插件保留。视频复刻的上游参考及依赖见 [NOTICE.md](./video-replica/NOTICE.md)。

打包 UI 包含 AI Canvas 的共享组件与样式，沿用宿主的 Source-Available 许可证；React、React DOM、Iconify 和 Lucide 分别保留原许可证。Apache-2.0 不对这些组件、模型权重或第三方依赖重新许可，不能据此认定所有打包内容都可自由商业再分发。
