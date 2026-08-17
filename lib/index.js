/**
 * dsh-file-upload — Host 半
 *
 * 提供 POST /api/file-upload/save：接收浏览器传来的 base64 文件内容，
 * 解码保存到当前会话项目目录 uploads/，返回绝对路径。
 *
 * 客户端把路径文本插入输入框，模型或外挂视觉工具（dsh-vision 的
 * view_image 等）按绝对路径读取文件——不绑定任何具体视觉插件。
 *
 * 纯 Node 实现（node:fs），跨平台：macOS / Linux / Windows 均可用，
 * 不依赖系统 base64 命令；路径由 node:path join 生成，跟随平台分隔符。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'dsh-file-upload'
export const inject = ['webServer', 'sessions']

/** base64 内容上限（约 30MB 原始数据 → base64 ≈ 40MB） */
const MAX_BASE64_BYTES = 40 * 1024 * 1024
/** 请求体上限（略大于 base64 上限 + 字段开销） */
const MAX_BODY_BYTES = 42 * 1024 * 1024

function readBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let total = 0
    let aborted = false
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        aborted = true
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

export function apply(ctx) {
  const webServer = ctx.webServer
  const sessions = ctx.sessions
  if (webServer === undefined || sessions === undefined) return

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-upload/save',
    handler: async (req, res) => {
      try {
        const body = await readBody(req, MAX_BODY_BYTES)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const name = typeof body.name === 'string' ? body.name : ''
        const base64 = typeof body.base64 === 'string' ? body.base64 : ''
        if (sessionId === '' || name === '' || base64 === '') {
          return writeJson(res, 400, { ok: false, error: '参数不完整' })
        }
        if (base64.length > MAX_BASE64_BYTES) {
          return writeJson(res, 400, { ok: false, error: '文件过大（超过 30MB）' })
        }
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
          return writeJson(res, 400, { ok: false, error: '文件内容无效' })
        }

        const session = sessions.get(sessionId)
        if (session === undefined) {
          return writeJson(res, 400, { ok: false, error: '会话不存在，请刷新后重试' })
        }
        const cwd = session.header?.cwd
        if (typeof cwd !== 'string' || cwd === '') {
          return writeJson(res, 400, { ok: false, error: '当前会话没有工作目录' })
        }

        // 纯 Node 落盘：mkdir -p + 解码写文件（跨平台，无 shell/命令依赖）
        const fileName = `${Date.now()}-${sanitizeName(name)}`
        const dir = join(cwd, 'uploads')
        await mkdir(dir, { recursive: true })
        const bytes = Buffer.from(base64, 'base64')
        await writeFile(join(dir, fileName), bytes)

        return writeJson(res, 200, {
          ok: true,
          path: join(dir, fileName),
          name: fileName,
        })
      } catch (error) {
        console.error('[dsh-file-upload] save failed:', error)
        return writeJson(res, 500, {
          ok: false,
          error: '保存失败：' + (error instanceof Error ? error.message : String(error)),
        })
      }
    },
  }), 'dsh-file-upload.route')
}
