# dsh-file-upload ⬆️

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**统一上传按钮 + 拖拽文件直进对话** —— DeepSeek Harness（dsh）web 插件。

*非官方项目：社区成员独立开发维护，非 DeepSeek 官方产品。*

## 截图

![dsh-file-upload 效果](assets/screenshot.png)

输入框工具行里的上传图标按钮（官方 dsw 风格，跟随深浅色主题）；选中文件后路径（截图中已模糊处理）自动进入输入框，可直接发送。

## 功能

| 操作 | 效果 |
|---|---|
| 点上传图标 | 系统文件选择器（可多选）→ 保存 → 路径进输入框 |
| 把文件拖进窗口 | 图片/任意文件都接管（不再弹"不支持"）→ 保存 → 路径进输入框 |
| 发送消息 | 模型/视觉插件按绝对路径读取文件 |
| 切换会话 | 按钮跟随当前会话，文件落在该会话项目的 `uploads/` |

- 文件上限：单文件 25MB（前端）/ 30MB（后端）
- 文件名保留中文/空格，自动加时间戳前缀防重名
- 上传中按钮变灰，失败有中文提示

## 安装

官方 bundle 一行安装：

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-upload#main"
```

装完重启 `dsh web`（bundle 层在启动时合成）。需要 pnpm（`dsh plugin` 是 pnpm 转发器）。

手动兜底：详见 [docs/install.md](docs/install.md) —— 软链到
`~/.dsh/profiles/web/node_modules/` + `~/.dsh/cordis.patch.yml` 单 entry
（本插件单 entry 即可，双 entry 会重复注册路由崩溃），重启生效。

## 用法

1. 点上传图标选文件（可多选），或把文件拖进窗口任意位置。
2. 文件保存到当前项目 `uploads/` 目录，输入框出现 `[上传文件] <绝对路径>` 行
   （如 `[上传文件] /项目/uploads/xxx.png`），已有草稿内容保留。
3. 按发送——模型或任何外挂视觉工具按路径读取文件。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 全功能实测（开发环境） |
| Linux | ✅ 架构上可用（纯 Node 实现），未实测 |
| Windows | ⚠️ 架构上可用（纯 Node 实现；文件名净化已兼容 Windows 非法字符，路径跟随平台分隔符），未实测 |

## 环境要求

- DSH web（`dsh web` 运行）
- 无需额外 shell/命令：host 半为纯 Node 实现（`node:fs`），全平台无系统命令依赖

## 工作原理

- **Host**（`lib/index.js`）：一条路由 `POST /api/file-upload/save` —— 接收
  base64 文件内容，校验会话与大小，用**纯 Node**（`node:fs`，跨平台无系统命令
  依赖）落盘到 `<会话项目>/uploads/`，路径由 `node:path` 生成、跟随平台分隔符，
  返回绝对路径。
- **Client**（`lib/client.js`）：`conversation.input.left` 插槽注册上传图标
  按钮（与默认「+」命令按钮区分）；document **捕获阶段**监听拖拽，先于官方
  InputBar 的冒泡监听执行，`preventDefault + stopPropagation` 接管文件拖放；
  `FileReader` 读 base64 上传，完成后路径文本插入输入框草稿（保留已有内容）。
- **错误边界**：渲染崩溃只降级为"⚠ 上传组件异常"小字，不会让整个输入框消失。

## 注意事项

- `uploads/` 目录只增不减，**不会自动清理**（不擅自删用户文件），需要时手动删除。
- 修改插件后重启 `dsh web` 生效（client 改动刷新页面即可，host 改动需重启）。

## 为什么需要它

DSH 原生"拖图片"会被拦截（当前模型不支持图片时提示"当前模型不支持图片，请切换支持图片的模型"）。本插件把文件先落到磁盘、再把**路径文本**放进对话，绕开模型图片校验——这是纯文本消息，任何模型/视觉插件都通用。

**不绑定任何视觉插件**：消息里只有本地绝对路径（纯文本），主模型或任何外挂视觉工具（如 dsh-vision 的 `view_image`、其他支持读本地路径的模型）都能按路径识别；因为从不提交图片块，绕开了 DSH 原生"当前模型不支持图片"的拦截。

## 许可证

[MIT](LICENSE)
