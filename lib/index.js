/**
 * dsh-file-upload — Host 半
 *
 * 提供：
 * 1. POST /api/file-upload/save：接收浏览器 base64 文件，按 mode 落盘——
 *    mode=image → 附件目录 images/（设置 attachmentDir，默认 ~/Documents/DSH/Attachments）；
 *    其余 → 附件目录 files/。两类各自按天分文件夹。返回绝对路径。
 * 2. GET/POST /api/file-upload/config：读写设置（附件目录 / 图片走官方附件 /
 *    留档图片开关）+ 返回宿主上限（attachments.imageLimits）与当前会话模型
 *    是否支持图片（llm.resolveModel inputModalities，与主程序同源）。
 *
 * 客户端把路径文本插入输入框；图片由客户端分流：走官方草稿附件条（自动
 * file_id）或仅路径文本——本文件不处理图像字节（压缩是主程序的事）。
 *
 * 纯 Node 实现（node:fs），跨平台：macOS / Linux / Windows 均可用。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve, isAbsolute } from 'node:path'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-file-upload'
export const inject = ['webServer', 'sessions']

const NS = settingsNamespace('file-upload')

/** 附件目录默认值（用户可在设置里改；英文路径保证跨平台兼容） */
export const DEFAULT_ATTACHMENT_DIR = join(homedir(), 'Documents', 'DSH', 'Attachments')

/** 原始文件内容上限（= DeepSeek file_id 单图硬限 64 MiB；前端同值） */
const MAX_RAW_BYTES = 64 * 1024 * 1024
/** base64 编码后上限（≈ 原始 × 4/3），由此推导避免两端数值漂移 */
const MAX_BASE64_BYTES = Math.ceil((MAX_RAW_BYTES * 4) / 3)
/** 请求体上限（base64 上限 + sessionId/name/mode 字段开销） */
const MAX_BODY_BYTES = MAX_BASE64_BYTES + 256 * 1024
/** 并发上传上限：防恶意/异常场景 N 个大请求打爆内存 */
const MAX_CONCURRENT = 3

/** 设置 schema（rc7+ 契约；键全部可选，运行时取默认） */
const SettingsSchema = z.object({
  attachmentDir: z.string().required(false),
  imageViaOfficial: z.boolean().required(false),
  keepImageArchive: z.boolean().required(false),
})

/** 展开 ~ 前缀 */
function expandHome(p) {
  if (typeof p !== 'string' || p === '') return p
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/** 读取设置（settings 不可用时全默认） */
function readSettings(ctx) {
  const settings = ctx.get('settings')
  const raw = settings !== undefined ? settings.get(NS) : undefined
  const v = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    attachmentDir: typeof v.attachmentDir === 'string' && v.attachmentDir.trim() !== ''
      ? v.attachmentDir.trim()
      : DEFAULT_ATTACHMENT_DIR,
    imageViaOfficial: v.imageViaOfficial !== false,
    keepImageArchive: v.keepImageArchive !== false,
  }
}

/** 解析附件目录：~ 展开 + 必须是绝对路径（相对路径拒绝） */
function resolveAttachmentDir(value) {
  const expanded = expandHome(value)
  if (!isAbsolute(expanded)) return null
  return expanded
}

// 同源校验（P1 修复，照 perm-guard 先例）：Origin 存在时必须为本机页面，
// 缺失时（curl 等）校验 Host 头是本机——防跨站页面 CSRF 式写入。
function isSameOrigin(req) {
  const origin = req.headers.origin || ''
  if (origin !== '') return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
  const host = req.headers.host || ''
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
}

function readBody(req, res, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let total = 0
    let aborted = false
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        aborted = true
        // 先回 413 再销毁连接（销毁后响应未必送达，但语义正确；客户端有兜底）
        try {
          res.writeHead(413, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: '请求体过大' }))
        } catch (e) { /* 连接已异常 */ }
        req.destroy()
        reject(new Error(`request body too large (>${maxBytes} bytes)`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * 文件名净化：去掉路径成分与跨平台危险字符，保留中文/字母数字/._- 空格。
 * 兼容 Windows：排除 \ / : * ? " < > | 与尾部 . 空格；
 * 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）由时间戳前缀天然规避。
 */
function sanitizeName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const cleaned = base
    .replace(/[^\w\u4e00-\u9fa5.\- ]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file'
  return cleaned.slice(0, 120)
}

/** 按天分文件夹名称（本地时区 YYYY-MM-DD） */
function dayFolder() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 当前会话模型是否支持图片（与主程序模型路由同源；查不到 = false 保守） */
async function sessionImageSupported(apiProxy, llm, sessionId) {
  if (apiProxy === undefined || llm === undefined || typeof sessionId !== 'string') return false
  try {
    const res = await apiProxy.sessions.models({ payload: { sessionId } })
    const current = res && res.result && res.result.ok ? res.result.value.current : undefined
    if (!current || typeof current.provider !== 'string' || typeof current.model !== 'string') return false
    const registration = llm.adapters.get(current.provider)
    if (registration === undefined || registration.adapter === undefined) return false
    const resolve = registration.adapter.resolveModel
    if (typeof resolve !== 'function') return false
    const meta = await resolve.call(registration.adapter, current.provider, current.model)
    return Array.isArray(meta?.inputModalities) && meta.inputModalities.includes('image')
  } catch (error) {
    return false
  }
}

export function apply(ctx) {
  const webServer = ctx.webServer
  const sessions = ctx.sessions
  if (webServer === undefined || sessions === undefined) return

  let inFlight = 0

  // 设置注册（settings 可用时；不可用时读默认值 = 现状安全行为）
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(NS, SettingsSchema)
  })

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-upload/save',
    handler: async (req, res) => {
      if (!isSameOrigin(req)) {
        return writeJson(res, 403, { ok: false, error: 'forbidden: cross-origin request' })
      }
      if (inFlight >= MAX_CONCURRENT) {
        return writeJson(res, 429, { ok: false, error: '上传太频繁，请稍候再试' })
      }
      inFlight += 1
      try {
        const body = await readBody(req, res, MAX_BODY_BYTES)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const name = typeof body.name === 'string' ? body.name : ''
        const base64 = typeof body.base64 === 'string' ? body.base64 : ''
        const mode = body.mode === 'image' ? 'image' : 'file'
        if (sessionId === '' || name === '') {
          return writeJson(res, 400, { ok: false, error: '参数不完整' })
        }
        if (base64 === '') {
          return writeJson(res, 400, { ok: false, error: '文件内容为空，无法上传' })
        }
        if (base64.length > MAX_BASE64_BYTES) {
          return writeJson(res, 400, { ok: false, error: '文件过大（超过 64MB）' })
        }
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
          return writeJson(res, 400, { ok: false, error: '文件内容无效' })
        }

        const session = sessions.get(sessionId)
        if (session === undefined) {
          return writeJson(res, 400, { ok: false, error: '会话不存在，请刷新后重试' })
        }
        // 统一附件库：图片 → Attachments/images/<日期>/；其他文件 → Attachments/files/<日期>/
        const resolved = resolveAttachmentDir(readSettings(ctx).attachmentDir)
        if (resolved === null) {
          return writeJson(res, 400, { ok: false, error: '附件目录配置无效（需要绝对路径），请在设置里修改' })
        }
        const dir = join(resolved, mode === 'image' ? 'images' : 'files', dayFolder())

        // 纯 Node 落盘：mkdir -p + 解码写文件（跨平台，无 shell/命令依赖）；
        // 随机串前缀防同毫秒同名并发覆盖
        const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeName(name)}`
        await mkdir(dir, { recursive: true })
        const bytes = Buffer.from(base64, 'base64')
        await writeFile(join(dir, fileName), bytes)

        return writeJson(res, 200, {
          ok: true,
          path: join(dir, fileName),
          name: fileName,
        })
      } catch (error) {
        // 细节只进日志，响应脱敏（不泄漏服务端路径等细节）
        console.error('[dsh-file-upload] save failed:', error)
        return writeJson(res, 500, {
          ok: false,
          error: '保存失败：磁盘写入错误',
        })
      } finally {
        inFlight -= 1
      }
    },
  }), 'dsh-file-upload.route.save')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-upload/config',
    handler: async (req, res) => {
      if (!isSameOrigin(req)) {
        return writeJson(res, 403, { ok: false, error: 'forbidden: cross-origin request' })
      }
      try {
        const settingsCtx = ctx.get('settings')
        if (settingsCtx === undefined) {
          return writeJson(res, 500, { ok: false, error: 'settings 服务不可用' })
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const current = readSettings(ctx)
          const attachments = ctx.get('attachments')
          const limits = attachments !== undefined ? attachments.imageLimits : undefined
          // handler 的 req 是原生 IncomingMessage（无 req.query），从 url 解析
          let sessionId = ''
          try {
            const u = new URL(req.url, 'http://localhost')
            sessionId = u.searchParams.get('sessionId') ?? ''
          } catch (e) { /* 忽略，sessionId 为空 */ }
          const supported = sessionId !== ''
            ? await sessionImageSupported(ctx.get('apiProxy'), ctx.get('llm'), sessionId)
            : undefined
          return writeJson(res, 200, {
            ok: true,
            attachmentDir: current.attachmentDir,
            imageViaOfficial: current.imageViaOfficial,
            keepImageArchive: current.keepImageArchive,
            // 官方字段名是 maxImageBytes → maxMessageImageBytes（rc.7+ 一致）；上限恒读不到时兜底 MAX_RAW_BYTES
            maxImageBytes: limits !== undefined && typeof limits.maxMessageImageBytes === 'number' ? limits.maxMessageImageBytes : MAX_RAW_BYTES,
            ...(supported !== undefined ? { sessionImageSupported: supported } : {}),
          })
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          const body = await readBody(req, res, 64 * 1024)
          const next = {}
          if (typeof body.attachmentDir === 'string') {
            const trimmed = body.attachmentDir.trim()
            if (trimmed === '') {
              next.attachmentDir = DEFAULT_ATTACHMENT_DIR
            } else {
              const resolved = resolveAttachmentDir(trimmed)
              if (resolved === null) {
                return writeJson(res, 400, { ok: false, error: '附件目录需要绝对路径（支持 ~ 前缀）' })
              }
              next.attachmentDir = trimmed
            }
          }
          if (typeof body.imageViaOfficial === 'boolean') next.imageViaOfficial = body.imageViaOfficial
          if (typeof body.keepImageArchive === 'boolean') next.keepImageArchive = body.keepImageArchive
          if (Object.keys(next).length === 0) {
            return writeJson(res, 400, { ok: false, error: '没有可保存的设置项' })
          }
          await settingsCtx.update(NS, next)
          return writeJson(res, 200, { ok: true, ...readSettings(ctx) })
        }
        return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      } catch (error) {
        console.error('[dsh-file-upload] config failed:', error)
        return writeJson(res, 500, { ok: false, error: '保存失败：设置服务错误' })
      }
    },
  }), 'dsh-file-upload.route.config')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-upload/open-dir',
    handler: async (req, res) => {
      if (!isSameOrigin(req)) {
        return writeJson(res, 403, { ok: false, error: 'forbidden: cross-origin request' })
      }
      if (req.method !== 'POST') {
        return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      }
      try {
        // 只打开"当前配置的附件目录"（服务端解析，不接受客户端任意路径）
        const resolved = resolveAttachmentDir(readSettings(ctx).attachmentDir)
        if (resolved === null) {
          return writeJson(res, 400, { ok: false, error: '附件目录配置无效（需要绝对路径），请在设置里修改' })
        }
        await mkdir(resolved, { recursive: true })
        const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        await new Promise((resolveExec, rejectExec) => {
          execFile(cmd, [resolved], (error) => (error ? rejectExec(error) : resolveExec()))
        })
        return writeJson(res, 200, { ok: true })
      } catch (error) {
        console.error('[dsh-file-upload] open-dir failed:', error)
        return writeJson(res, 500, { ok: false, error: '打开目录失败（无对应文件管理器命令？）' })
      }
    },
  }), 'dsh-file-upload.route.open-dir')
}
