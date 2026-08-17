/**
 * dsh-file-upload — Host 半
 *
 * 提供 POST /api/file-upload/save：接收浏览器传来的 base64 文件内容，
 * 解码保存到当前会话项目目录 uploads/，返回绝对路径。
 *
 * 客户端把路径文本插入输入框，模型或外挂视觉工具（dsh-vision 的
 * view_image 等）按绝对路径读取文件——不绑定任何具体视觉插件。
 *
 * 纯 Node 实现，macOS 实测（base64 -d 为 macOS/Linux 自带命令）。
 */
export const name = 'dsh-file-upload'
export const inject = ['webServer', 'sessions', 'shell', 'sandboxPolicy']

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

/** 文件名净化：去掉路径成分与 shell 危险字符，保留中文/字母数字/._- 空格 */
function sanitizeName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const cleaned = base
    .replace(/[^\w\u4e00-\u9fa5.\- ]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file'
  return cleaned.slice(0, 120)
}

/** shell 单引号转义（单引号内唯一需要转义的是单引号本身） */
function sq(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

export function apply(ctx) {
  const webServer = ctx.webServer
  const sessions = ctx.sessions
  const shell = ctx.shell
  const sandboxPolicy = ctx.sandboxPolicy
  if (webServer === undefined || sessions === undefined || shell === undefined) return

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

        // 显式绑定会话的沙箱策略（workspace-write 下允许写会话 cwd 内）
        const policy = sandboxPolicy.resolve({ session })
        const fileName = `${Date.now()}-${sanitizeName(name)}`

        // 1. 建目录
        const mk = await shell.run(shell.resolve({
          command: 'mkdir -p uploads',
          workdir: cwd,
          sandboxPolicy: policy,
        }))
        if (mk.exitCode !== 0) {
          console.error(`[dsh-file-upload] mkdir failed (${mk.exitCode})`, mk.stderr)
          return writeJson(res, 500, { ok: false, error: '创建 uploads 目录失败' })
        }

        // 2. base64 解码写文件（stdin 输入，绕开命令行长度限制）
        const dec = await shell.run(shell.resolve({
          command: `base64 -d > ${sq(fileName)}`,
          workdir: `${cwd}/uploads`,
          stdin: base64,
          sandboxPolicy: policy,
        }))
        if (dec.exitCode !== 0) {
          console.error(`[dsh-file-upload] decode failed (${dec.exitCode})`, dec.stderr)
          return writeJson(res, 500, { ok: false, error: '文件保存失败，请重试' })
        }

        return writeJson(res, 200, {
          ok: true,
          path: `${cwd}/uploads/${fileName}`,
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
