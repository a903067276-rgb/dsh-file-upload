# 安装指南（dsh-file-upload）

## 安装（推荐：官方 bundle 一行安装）

本仓库是官方 **bundle 插件**格式（根 `package.json` 的 `dsh.bundle` + `dsh.client`），
经官方 profile 管理：

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-upload#main"
```

装完**重启 `dsh web`**（bundle 层在启动时合成）。更新时
`dsh plugin --profile web update dsh-file-upload`（或换 git 源 ref），重启生效。

> **需要 pnpm**：`dsh plugin` 是 pnpm 转发器，PATH 里没有 pnpm 会直接失败。
> 未安装可用 `npm i -g pnpm`（或 corepack 启用）；pnpm 主版本需与 profile
> 现有 store 一致（本机为 v11，装 pnpm@10 会报 `ERR_PNPM_UNEXPECTED_STORE`）。

## 安装（兜底：手动挂载，macOS 实测路径）

> 手动方式**无需** `dsh plugin add`，与 bundle 安装**二选一**，不要同时用。

### 安装步骤

1. **把仓库放到本地**，例如 `~/Documents/DSH/plugin-dev/dsh-file-upload`（克隆或直接拷贝均可）。

2. **让 web profile 能按包名解析到它**（host 的 apply 与 client 半的发现机制都按
   包名解析，必须可 `require.resolve('dsh-file-upload/package.json')`）：

   ```bash
   ln -s ~/Documents/DSH/plugin-dev/dsh-file-upload ~/.dsh/profiles/web/node_modules/dsh-file-upload
   ```

3. **在 `~/.dsh/cordis.patch.yml` 追加单 entry**（示例见
   [`examples/cordis.patch.example.yml`](../examples/cordis.patch.example.yml)）：

   ```yaml
   - insert:
       - id: file-upload
         name: 'dsh-file-upload'
   ```

   > 本插件**单 entry 包名挂载即可**（host apply 与 clientModules 都走包加载）——
   > 双 entry 会让本插件 apply 两次，导致 `/api/file-upload/save` 路由重复注册崩溃。

4. **重启 `dsh web`**。宿主组合（patch 层）变化必须重启才生效，热更新无效。

## 验证是否装好

- 浏览器刷新后，输入框工具行出现「📎 上传」按钮（与默认「+」命令按钮并列）；
- `curl -X POST http://127.0.0.1:3080/api/file-upload/save -H 'content-type: application/json' -d '{}'`
  返回 `{"ok":false,"error":"参数不完整"}`（路由存在）；
- 点按钮选一张图 → 项目 `uploads/` 出现 `时间戳-原名` 文件，输入框出现
  `[上传文件] <绝对路径>`；
- 直接把文件拖进窗口 → 同样保存 + 路径进输入框，不弹"不支持图片"。

## 卸载

- bundle 安装：`dsh plugin --profile web remove dsh-file-upload`，重启 `dsh web`。
- 手动挂载：删除 `~/.dsh/cordis.patch.yml` 里的 entry、删除软链
  `~/.dsh/profiles/web/node_modules/dsh-file-upload`，重启 `dsh web`。
- 从手动挂载**迁移**到 bundle 安装：先卸载手动方式（上一条），再执行 bundle 安装命令，
  重启。两种方式不要同时存在。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 开发环境，全功能实测（中文/空格文件名、拖拽、视觉识别链路） |
| Linux | ⚠️ 未实测；架构上预期可用（host 为纯 Node 实现，无系统命令依赖） |
| Windows | ⚠️ 未实测；架构上预期可用（纯 Node 实现，文件名净化兼容 Windows 非法字符，路径跟随平台分隔符） |

欢迎在 Windows / Linux 上验证后提交 issue 或 PR 补充实测结果。

## 已知注意事项（全部实测）

1. **单 entry 包名挂载**：host 的 apply 与 clientModules 都按包名解析，双 entry 会
   重复注册路由崩溃。
2. **文件路径挂载的插件必须 `export const inject = [...]` 声明依赖**，否则
   `ctx.get()` 拿到的服务全是 `undefined`。
3. **旧副本遮蔽**：`~/.dsh/profiles/web/node_modules` 里如果残留旧拷贝（而非软链），
   会遮蔽源码改动。插件更新后请检查此处，确保指向源码的软链。
4. **client 改动刷新页面即可**（bundle 动态读文件）；host 改动必须重启 `dsh web`
   （浏览器自动重连无需手动刷新）。
5. **消息里的裸绝对路径**：dsh-file-mentions 的"裸路径点击"功能曾与 React 冲突导致
   含路径的消息发送后对话框崩溃（2026-08-17 已在其仓库修复：跳过对话消息区）。
   如使用旧版 file-mentions，请升级到最新 main。
