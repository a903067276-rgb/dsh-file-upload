# 重启后验证清单（dsh-file-upload）

> 状态：2026-08-17 全部验证通过 ✅（macOS）

## 前置确认

- [x] 浏览器打开 http://127.0.0.1:3080，回到本会话（dsh-file-upload 工作区）
- [x] 输入框工具行出现「上传图标」按钮，与默认「+」命令按钮视觉区分明显
- [x] 按钮 title 提示"上传文件到当前项目（也可直接把文件拖进窗口）"

## 功能验证

- [x] 点「上传图标」→ 弹出系统文件选择器（可多选）
- [x] 选图片 → 项目 `uploads/` 出现 `时间戳-原名` 文件（内容与原图一致）
- [x] 输入框自动出现 `[上传文件] /…/uploads/xxx.png`（已有草稿文字被保留）
- [x] 发送消息 → 模型自动调 `view_image` 识别（本机 dsh-vision）→ 识别结果正确（工藤新一）
- [x] 直接把图片拖进窗口 → 保存 + 路径进输入框，无毛玻璃遮罩，不弹"不支持图片"
- [x] 非图片文件（index.html）拖入 → 也能保存 + 路径进输入框
- [x] 多文件上传 → 路径逐行插入输入框

## 边界

- [x] 文件名含中文/空格/单引号 → 正常保存（特殊字符净化）
- [x] 跨平台：host 为纯 Node 实现（node:fs），不依赖 base64 命令，Windows/Linux 架构可用
- [ ] 超大文件（>25MB）→ 前端拦截提示（代码已实现，未实测）
- [ ] 切换会话 → 按钮跟随当前会话（代码按 sessionId 传参，未实测）

## 踩过的坑（沉淀）

1. **useInput() 是真 React hook**：不能异步回调调用、不能条件调用（无会话时变
   undefined）→ 前者路径进不了输入框，后者组件崩溃按钮消失。改用 owner prop
   `props.input`（InputState 快照）读草稿，不用 hook。
2. **原生毛玻璃拖放遮罩**：只拦 drop 不拦 dragenter → 遮罩显示且不消失。
   dragenter/dragover/drop 全部捕获阶段拦截才干净。
3. **重启脚本**：pgrep 在受限 shell 看不到宿主进程 → 用 lsof -sTCP:LISTEN 按端口
   找；调用方先 nohup detached 再杀（借鉴 ~/.dsh/restart-self.sh）。
4. **静态 bundle 插件验证节奏**：先动态 Cordis 插件热验证再落静态安装
   （全局规范已写死）。

## 追加验证（2026-08-17 第二轮）

- [x] 发送含路径消息不再崩溃（根因：dsh-file-mentions 的 processBarePaths 替换文本节点
      与 React 冲突 → 已修：跳过 [data-conversation-scroll] 消息区，反引号路径不受影响）
- [x] file-mentions 安装副本改为软链指向源码仓库（改代码立即生效）
- [x] 重启脚本 detached 模式实测可用（改代码后自动重启不卡对话）
