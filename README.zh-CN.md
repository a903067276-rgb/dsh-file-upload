# dsh-file-upload ⬆️

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**统一上传按钮 + 拖拽文件直进对话** —— DeepSeek Harness（dsh）web 插件。

*非官方项目：社区成员独立开发维护，非 DeepSeek 官方产品。*

## 截图

![dsh-file-upload 效果](assets/screenshot.png)

输入框工具行里的上传图标按钮（官方 dsw 风格，跟随深浅色主题）；支持的图片进入官方附件条（自动 file_id 复用），其他文件把路径文本插入输入框。

## 功能

| 操作 | 效果 |
|---|---|
| 点上传图标 | 系统文件选择器（可多选）→ 智能分流 → 附件条和/或路径文本 |
| 把文件拖进窗口 | 图片/任意文件都接管（不再弹"不支持"）→ 智能分流 |
| **图片**（PNG/JPEG/WebP/GIF） | ① 留档到**附件目录**（按天分文件夹）② 进**官方草稿附件条** → 发送后自动 DeepSeek Files API `file_id`（同图复用，7 天过期自动重传） |
| **其他文件** | 存项目 `uploads/`，`[上传文件] 路径` 文本进草稿（行为不变） |
| 模型不支持图片 | 图片降级为"留档 + 路径文本"（绝不发送图片块，不报 400） |

- 文件上限：单文件 **64MB**（DeepSeek Files API 硬限；主程序附件库默认 20MB，见 *大图（20~64MB）*）
- 其他文件落项目 `uploads/`；图片默认留档到 `~/Documents/DSH/Attachments/<YYYY-MM-DD>/`（设置里可改）
- 上传中按钮变灰，失败有中文提示

## 设置卡片

- **附件目录**（默认 `~/Documents/DSH/Attachments`，支持 `~` 前缀）—— 只给图片留档用
- **图片走官方附件**（默认开）—— 关 = 图片走老路径文本逻辑
- **留档图片到附件目录**（默认开）—— 关 = 只走官方附件（省磁盘；官方通道不可用时仍强制留档）
- 只读显示：当前图片来源上限（来自宿主配置）

## 大图（20~64MB）

DeepSeek 单图上限 **64 MB**；主程序本地附件库默认 **20 MB**——超过且 ≤64 MB 的图片走"留档 + 路径文本"（模型仍可经 `read_image` 读，上限同源跟随）。

想让大图也走官方附件路径，在 `~/.dsh/profiles/web/cordis.patch.yml` 追加以下配置并重启 `dsh web`：

```yaml
- id: attachment-local
  config:
    maxImageBytes: 67108864   # 20 MiB → 64 MiB（DeepSeek 官方硬限）
```

注意：该行整行替换配置，需要的键都要写明；主程序升级后随版本核对。无论原图多大，模型看到的始终是主程序规范化版本（≤2048px / ≤4 MiB，每张图 ≤384 token）。

## 安装

官方 bundle 一行安装：

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-upload#main"
```

装完重启 `dsh web`（bundle 层在启动时合成）。需要 pnpm（`dsh plugin` 是 pnpm 转发器）。

手动挂载（兜底）：见 [docs/install.md](docs/install.md) —— 软链到 `~/.dsh/profiles/web/node_modules/` + 在 `~/.dsh/cordis.patch.yml` 里加**单条** entry（双条会让插件 apply 两次、路由重复注册崩溃），然后重启。

## 使用

1. 点上传图标选文件（可多选），或把文件拖进窗口任意位置。
2. **图片**（当前模型支持看图时）：留档附件目录 + 进入官方附件条——发送即模型看图（DeepSeek Files API `file_id`，自动复用）。
3. **图片但模型不支持**（或你关了官方路径）：留档后写入 `[上传文件] <绝对路径>` 行——如 `[上传文件] /path/to/uploads/xxx.png`——保留已有草稿。
4. **其他文件**：存当前项目 `uploads/`，路径文本进草稿；发送后模型按路径读取。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 完整测试（开发环境） |
| Linux | ✅ 预期可用（纯 Node 实现），未测 |
| Windows | ⚠️ 预期可用（纯 Node 实现、Windows 安全文件名清洗、平台分隔符路径），未测 |

## 依赖要求

- DSH web >= 0.1.0-rc.7（`dsh web` 运行）
- 无需额外 shell：host 半纯 Node（`node:fs`），任何平台不依赖系统命令。

## 工作原理

- **Host**（`lib/index.js`）：`POST /api/file-upload/save`——校验会话与大小，用**纯 Node** 写 base64 到 `<附件目录>/<YYYY-MM-DD>/`（`mode=image`）或 `<会话 cwd>/uploads/`（`mode=file`）；`GET/POST /api/file-upload/config`——读写设置（官方 settings 服务）+ 暴露宿主图片上限 + 当前会话模型是否收图（`llm.resolveModel` 的 `inputModalities`，与适配器同源）。
- **Client**（`lib/client.js`）：上传图标挂 `conversation.input.left`；捕获阶段接管拖拽；分流规则：支持图片 + 开关开 + 模型收图 + 不超宿主上限 → 留档 + `conversation.createDraftImages` + `inputActions.addImages`（官方 InputBar 同款机制）→ 官方附件条（不写路径文本）；其余降级"留档 + 路径文本"；>64MB 拒绝并提示。
- **错误边界**：渲染崩溃降级为"⚠ 上传组件异常"小图标，不卸载整个输入框。

## 备注

- 附件目录与 `uploads/` 只增不减，**从不自动清理**（我们不删你的文件）——需要时手动清理。
- 改插件后重启 `dsh web` 生效（client 改动刷新页面即生效；host 改动需重启）。

## 为什么有这个插件

DSH 原生在模型不支持图片时会直接拒绝拖入的图片。本插件在模型能看图时把图片走**官方附件路径**（搭 DeepSeek Files API 的 `file_id` 快车），同时留一份**你能自己找到的附件目录**副本，其余情况降级为纯**路径文本**——纯文本消息能过模型的图片检查，任何模型/视觉插件都能用（降级路径上从不提交图片块，绕开 DSH 原生拒绝）。

## License

[MIT](LICENSE)
