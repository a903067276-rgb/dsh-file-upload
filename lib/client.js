window.__ModuleLoader__.load({
  id: "dsh-file-upload",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    /**
     * dsh-file-upload — Client 半（fork 0.1.7-fork.1，引用胶囊化）
     *
     * 1. 输入框工具行左侧加「上传」按钮（与默认 "+" 命令按钮图标区分）。
     * 2. 点击弹系统文件选择器（可多选）；页面任意位置拖入文件也接管（捕获
     *    阶段监听，先于官方 InputBar 的 document 冒泡监听，防双处理）。
     * 3. 分流：
     *    - 图片（PNG/JPEG/WebP/GIF）且「允许官方附件」开 + 模型支持 + 不超宿主上限
     *      → host 留档附件库 images/<日期>/ + 官方草稿附件条（发送后自动
     *      file_id、同图复用）——不写路径文本。
     *    - 图片但模型不支持/超上限/开关关/官方通道异常 → 留档附件库 images/ + 路径胶囊。
     *    - 其他文件/文件夹 → 附件库 + 路径**引用胶囊**（核心官方通道
     *      input.insertReference + 自有 @ 源 codec，见 REFERENCE_SOURCE）；
     *      发给模型的文本与原版逐行等价（serialize = "\n" + prefix + " " + path）。
     * 4. 设置卡片：附件目录路径 + 允许官方附件开关 + 留档开关 + 上限状态。
     *    插件不处理图像字节（压缩是主程序的事）。
     *
     * fork 纪律（docs/plan-20260905-fileupload-chip.md §3.3）：往草稿写内容
     * 一律 insertReference/insertText，任何降级不得回 setDraft——setDraft 会
     * 整文档重建、抹掉草稿内全部已有引用胶囊（含其他插件插入的）。
     */
    // inputTriggers：自有 @ 源注册的宿主面——ctx.get 拿不到它（实测 0.1.2-rc.1：
    // sessions/conversation 可注入式现取，inputTriggers 必须 inject 声明才可读，
    // 核心 reference 插件同款），故列入 inject。属 client bundle 字段，非依赖清单。
    const inject = ["slots", "inputTriggers"];

    // ── 公共日志通道接入（观测册 §八；内联 shim = @kkabuka/dsh-log-shim B1 兜底形态）──
    // 来源：plugins/dsh-log-shim/lib/index.js（协议 1.0.0，本包无构建链故内联；
    // 换通道实现只动本段，业务打点桩 log.* 不动）。scope=file-upload，默认 off 静默，
    // 验收看 ?dshLog=file-upload=info；词典/预期行/回归路径 = observability/README.md。
    const LOG_SCOPE = "file-upload";
    const LOG_EVENTS = ["source-registered", "put-paths", "chip-insert", "chip-fallback", "chip-error", "paste-insert", "contract", "状态"];
    const PROTOCOL_VERSION = "1.0.0";
    const LOG_RANK = { off: 0, debug: 1, info: 2, warn: 3, error: 4 };
    const LOG_PROBES = [0, 50, 200, 500, 1000, 2000];
    function logEnv() { return typeof window !== "undefined" ? window : globalThis; }
    function logStorage() { try { return logEnv().localStorage ?? null; } catch { return null; } }
    function logResolveLevel(scope) {
      try {
        const loc = logEnv().location;
        if (loc && loc.search) {
          const raw = new URLSearchParams(loc.search).get("dshLog");
          if (raw) {
            if (raw === "off") return "off";
            for (const pair of raw.split(",")) {
              const eq = pair.indexOf("=");
              if (eq > 0 && pair.slice(0, eq) === scope) {
                const l = pair.slice(eq + 1);
                if (LOG_RANK[l] !== undefined) return l;
              }
            }
          }
        }
      } catch { /* 无 location 环境忽略 */ }
      try {
        const v = logStorage() ? logStorage().getItem(`dshLog:${scope}`) : null;
        if (v && LOG_RANK[v] !== undefined) return v;
      } catch { /* storage 不可用 */ }
      return "off";
    }
    function logNow() { try { return new Date().toLocaleTimeString("en-GB"); } catch { return ""; } }
    function logUsableHost(host, minHostVersion) {
      if (!host || host.__dshLogBrand !== "dsh-log-hub") return false;
      const need = String(minHostVersion ?? "0.0.0").split(".").map(Number);
      const have = String(host.version ?? "0.0.0").split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if ((have[i] ?? 0) > (need[i] ?? 0)) return true;
        if ((have[i] ?? 0) < (need[i] ?? 0)) return false;
      }
      return true;
    }
    function logAttach(scope, events, options) {
      const opts = options || {};
      const probes = opts.probeSchedule || LOG_PROBES;
      const context = opts.context;
      let mode = "queued"; // queued | live | fallback
      let hub = null;
      let delegate = null;
      const queue = [];
      const levelListeners = [];
      const lastSeen = new Map();
      const throttleAt = new Map();
      function whitelistWarn(message) {
        try { (logEnv().console ?? console).warn(`[dsh-log-shim] ${message}`); } catch { /* 忽略 */ }
      }
      function fallbackEmit(rank, evt, detail) {
        const scopeLevel = logResolveLevel(scope);
        if (scopeLevel === "off" || rank < LOG_RANK[scopeLevel]) return;
        const text = typeof detail === "function" ? detail() : detail;
        try {
          const method = rank >= LOG_RANK.error ? "error" : rank >= LOG_RANK.warn ? "warn" : "log";
          (logEnv().console ?? console)[method](`[dsh-${scope}] ${logNow()} ${evt} :: ${text}`);
        } catch { /* 忽略 */ }
      }
      function emit(rank, evt, detail) {
        try {
          if (mode === "live") {
            if (rank === LOG_RANK.debug) delegate.debug(evt, detail);
            else if (rank === LOG_RANK.warn) delegate.warn(evt, detail);
            else if (rank === LOG_RANK.error) delegate.error(evt, detail);
            else delegate.info(evt, detail);
          } else if (mode === "fallback") {
            fallbackEmit(rank, evt, detail);
          } else {
            queue.push({ rank, evt, detail });
          }
        } catch { /* 观测绝不让业务崩 */ }
      }
      function flush() {
        for (const item of queue) {
          try {
            if (item.rank === LOG_RANK.debug) delegate.debug(item.evt, item.detail);
            else if (item.rank === LOG_RANK.warn) delegate.warn(item.evt, item.detail);
            else if (item.rank === LOG_RANK.error) delegate.error(item.evt, item.detail);
            else delegate.info(item.evt, item.detail);
          } catch { /* 单条失败忽略 */ }
        }
        queue.length = 0;
      }
      function goLive(h) {
        mode = "live";
        hub = h;
        try {
          delegate = h.register(scope, { events, context });
          flush();
          for (const l of levelListeners) {
            try { hub.onLevel(scope, l.level, l.fn); } catch { /* 忽略 */ }
          }
          levelListeners.length = 0;
        } catch (error) {
          whitelistWarn(`register 失败，降级直打：${(error && error.message) || error}`);
          mode = "fallback";
          hub = null;
          delegate = null;
        }
      }
      function probe(attempt) {
        if (mode !== "queued") return;
        const candidate = logEnv().__dshLog;
        if (logUsableHost(candidate, opts.minHostVersion)) { goLive(candidate); return; }
        if (candidate && candidate.__dshLogBrand === "dsh-log-hub") {
          whitelistWarn(`宿主版本 ${candidate.version} 低于所需 ${opts.minHostVersion}，scope=${scope} 降级直打`);
          mode = "fallback";
          return;
        }
        if (attempt < probes.length - 1) {
          const delay = probes[attempt + 1] - probes[attempt];
          setTimeout(() => probe(attempt + 1), Math.max(0, delay));
        } else {
          mode = "fallback";
          queue.length = 0; // 降级即丢队（规范 §8.3.2：不补冲刷）
        }
      }
      probe(0);
      try {
        logEnv().addEventListener?.("__dshLogReady", () => { if (mode === "queued") probe(0); });
      } catch { /* 非 DOM 环境忽略 */ }
      return {
        debug(evt, detail) { emit(LOG_RANK.debug, evt, detail); },
        info(evt, detail) { emit(LOG_RANK.info, evt, detail); },
        warn(evt, detail) { emit(LOG_RANK.warn, evt, detail); },
        error(evt, detail) { emit(LOG_RANK.error, evt, detail); },
        change(evt, lazySnapshot) {
          try {
            if (mode === "fallback" && LOG_RANK.info < LOG_RANK[logResolveLevel(scope)]) return;
            const snapshot = typeof lazySnapshot === "function" ? lazySnapshot() : lazySnapshot;
            if (lastSeen.get(evt) === snapshot) return;
            lastSeen.set(evt, snapshot);
            emit(LOG_RANK.info, evt, snapshot);
          } catch { /* 忽略 */ }
        },
        throttled(key, ms, lazyDetail) {
          try {
            if (mode === "fallback" && LOG_RANK.info < LOG_RANK[logResolveLevel(scope)]) return;
            const epoch = Date.now();
            if (epoch - (throttleAt.get(key) ?? -Infinity) < ms) return;
            throttleAt.set(key, epoch);
            emit(LOG_RANK.info, key, lazyDetail);
          } catch { /* 忽略 */ }
        },
        onLevel(level, fn) {
          try {
            if (LOG_RANK[level] === undefined) throw new Error(`非法级别：${level}`);
            if (mode === "live") { hub.onLevel(scope, level, fn); return; }
            if (levelListeners.length < 50) levelListeners.push({ level, fn });
            if (mode === "fallback" && LOG_RANK[logResolveLevel(scope)] >= LOG_RANK[level]) fn();
          } catch { /* 忽略 */ }
        },
        __state() { return { mode, version: PROTOCOL_VERSION }; },
      };
    }
    /** 当前会话 id（打点 context 段用；putPaths/pasteInsertText 入口时刷新） */
    let logSess = "";
    const log = logAttach(LOG_SCOPE, LOG_EVENTS, {
      context: () => (typeof logSess === "string" && logSess !== "" ? { sess: logSess } : undefined),
      minHostVersion: "1.0.0",
    });


    /** 前端单文件上限（= DeepSeek file_id 硬限 64 MiB；host 端同值） */
    const MAX_FILE_BYTES = 64 * 1024 * 1024;

    /** 官方图片 MIME 白名单（与主程序/官方文档一致） */
    const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

    /** 官方附件服务（createDraftImages 为官方未公开实例方法） */
    let officialConversation = null;
    /** apply 时保存的 client ctx，供懒获取 conversation（0.1.2 起注册晚于插件 apply） */
    let clientCtx = null;

    // ── 官方设置卡片壳（2026-09-02，视觉对齐 dsh 0.1.2 host PluginCard；key 须与宿主命名空间一致）──
    const CARD_CSS = ".dsh-settings-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s}.dsh-settings-card:hover{border-color:var(--dsw-alias-label-dimmed)}.dsh-settings-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.dsh-settings-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}.dsh-settings-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dsh-settings-headtext{display:flex;flex-direction:column;flex:1;min-width:0;gap:4px}.dsh-settings-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dsh-settings-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dsh-settings-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.dsh-settings-open .dsh-settings-chevron{transform:rotate(180deg)}.dsh-settings-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:10px 0 8px}.dsh-settings-body input,.dsh-settings-body textarea,.dsh-settings-body select{box-sizing:border-box;max-width:100%;min-width:0}";
    let cardCssInjected = false;
    function injectCardCss() {
      if (typeof document === "undefined" || cardCssInjected) return;
      cardCssInjected = true;
      if (document.getElementById("dsh-settings-card-style") !== null) return;
      const tag = document.createElement("style");
      tag.id = "dsh-settings-card-style";
      tag.textContent = CARD_CSS;
      document.head.appendChild(tag);
    }
    function SettingsCardShell(props) {
      const [open, setOpen] = react.useState(false);
      return react.createElement("li", { className: "dsh-settings-card" + (open ? " dsh-settings-open" : "") },
        react.createElement("button", {
          type: "button", className: "dsh-settings-head", "aria-expanded": open,
          onClick: () => setOpen(!open),
          "aria-label": (open ? "折叠" : "展开") + "：" + props.title,
        },
          react.createElement("span", { className: "dsh-settings-headtext" },
            react.createElement("span", { className: "dsh-settings-name" }, props.title),
            react.createElement("span", { className: "dsh-settings-desc" }, props.desc)
          ),
          react.createElement("svg", { className: "dsh-settings-chevron", width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
            react.createElement("path", { d: "M4 6.5 8 10.5 12 6.5" })
          )
        ),
        open ? react.createElement("div", { className: "dsh-settings-body" }, props.children) : null
      );
    }

    // ── 官方 dsw 风格按钮（2026-08-18，对齐 plan-switch 样板）：28px 图标按钮 ──
    if (typeof document !== "undefined" && !document.getElementById("dsh-upload-style")) {
      const tag = document.createElement("style");
      tag.id = "dsh-upload-style";
      tag.textContent = [
        ".dsh-upload-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}",
        ".dsh-upload-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".dsh-upload-btn:disabled{opacity:.5;cursor:default;}",
        ".dsh-upload-btn.is-error{color:var(--dsw-alias-state-error-primary,#d03050);}",
        // 设置卡保存按钮（统一按钮样板：透明底 + l2 边框 + hover 灰底 + 成功变绿）
        ".dsh-fu-save{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:transparent;color:var(--dsw-alias-label-primary,#333);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;}",
        ".dsh-fu-save:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".dsh-fu-save:disabled{opacity:.5;cursor:default;}",
        ".dsh-fu-save.is-saved{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}",
        // 打开文件夹按钮（链接样式：主题色 + hover 下划线）
        ".dsh-fu-open{display:inline-flex;align-items:center;width:max-content;border:none;background:transparent;color:var(--dsw-alias-state-business-primary,#2f6fed);font-size:12px;cursor:pointer;padding:2px 0;}",
        ".dsh-fu-open:hover{text-decoration:underline;}",
      ].join("\n");
      document.head.appendChild(tag);
    }

    // 上传图标（线性风格，对齐官方 Icon 体系）：向上箭头 + 托盘线
    function UploadIcon() {
      return react.createElement("svg", {
        width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
        style: { flex: "none", display: "block" },
      },
        react.createElement("path", { d: "M8 10V3" }),
        react.createElement("path", { d: "M4.5 6L8 2.5L11.5 6" }),
        react.createElement("path", { d: "M3 11.5v1.5h10v-1.5" })
      );
    }

    /**
     * 粘贴模式同步缓存：'off' | 'images' | 'all'。paste 事件回调里不能
     * await fetchConfig（clipboardData 在事件返回后即失效），所以监听器
     * 同步读这个缓存。缓存由三路刷新：fetchConfig 顺带更新（含设置卡
     * 保存成功后的响应）、UploadButton 挂载时初值、window focus 时后台
     * 刷新（覆盖「设置在另一个标签页/窗口改了」的场景）。
     */
    let pasteModeCache = "off"; // 默认 off：不开即保持官方内建粘贴，安防/习惯默认关

    /** 读 host 配置（每次调用现取；失败返回 null，调用方走保守路径） */
    async function fetchConfig(sessionId) {
      try {
        const res = await fetch(
          "/api/file-upload/config?sessionId=" + encodeURIComponent(typeof sessionId === "string" ? sessionId : ""),
          { cache: "no-store" }
        );
        const json = await res.json();
        if (json && json.ok === true) {
          // 顺带刷新粘贴模式缓存（设置保存后不刷新页面即生效的关键：事件
          // 回调里不能 await，读的是这个同步缓存）
          if (json.pasteMode === "off" || json.pasteMode === "images" || json.pasteMode === "all") {
            pasteModeCache = json.pasteMode;
          }
          return json;
        }
        return null;
      } catch (error) {
        return null;
      }
    }

    /** 单个文件：readAsDataURL 取 base64 → host 保存（mode=image/file）→ 返回结果 */
    function saveOne(file, mode, sessionId) {
      return new Promise((resolve) => {
        if (file.size > MAX_FILE_BYTES) {
          resolve({ ok: false, error: `「${file.name}」超过 64MB，已跳过` });
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => resolve({ ok: false, error: `「${file.name}」读取失败` });
        reader.onload = () => {
          const dataUrl = String(reader.result || "");
          const comma = dataUrl.indexOf(",");
          const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
          fetch("/api/file-upload/save", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, name: file.name, base64, mode }),
          })
            .then((res) => res.json())
            .then((json) => {
              if (json && json.ok === true) resolve({ ok: true, path: json.path });
              else resolve({ ok: false, error: (json && json.error) || "保存失败" });
            })
            .catch(() => resolve({ ok: false, error: `「${file.name}」上传失败` }));
        };
        reader.readAsDataURL(file);
      });
    }

    /**
     * 递归读取一个目录项（文件或文件夹，webkitGetAsEntry 产物），
     * 返回 { rel, base64 }[] 形式的相对路径 + 内容列表（不含目录本身）。
     * 只读文件（跳过空目录）；任何一步失败都整组 reject，由调用方降级。
     */
    async function readEntryTree(entry) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        const base64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onerror = () => rej(new Error("读取失败"));
          r.onload = () => {
            const dataUrl = String(r.result || "");
            const comma = dataUrl.indexOf(",");
            res(comma >= 0 ? dataUrl.slice(comma + 1) : "");
          };
          r.readAsDataURL(file);
        });
        return [{ rel: entry.name, base64 }];
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const readAll = () => new Promise((res, rej) => {
          const all = [];
          const step = () => reader.readEntries((items) => {
            if (items.length === 0) { res(all); return; }
            all.push(...items);
            step();
          }, rej);
          step();
        });
        const children = await readAll();
        const out = [];
        for (const child of children) {
          const sub = await readEntryTree(child);
          for (const item of sub) out.push({ rel: entry.name + "/" + item.rel, base64: item.base64 });
        }
        return out;
      }
      return [];
    }

    /** 文件夹整体上传：entries 列表 → host 重建目录树 → 返回 { ok, path } */
    function saveFolder(folderName, entries, sessionId) {
      return new Promise((resolve) => {
        fetch("/api/file-upload/save-folder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, folderName, entries }),
        })
          .then((res) => res.json())
          .then((json) => {
            if (json && json.ok === true) resolve({ ok: true, path: json.path });
            else resolve({ ok: false, error: (json && json.error) || "文件夹上传失败" });
          })
          .catch(() => resolve({ ok: false, error: `「${folderName}」上传失败` }));
      });
    }

    /**
     * 尝试把图片加入官方草稿附件条。返回成功数；失败返回 0（调用方降级）。
     * createDraftImages / releaseDraftImages 是官方 InputBar 同款内部方法，
     * rc 版本可能变动——全部 try/catch + 存在性检查，降级不崩。
     */
    function tryOfficial(files, inputActions) {
      // 0.1.2 修复：conversation 服务可能注册晚于本插件 apply（模块化架构启动
      // 时序变化），apply 时缓存会永远拿到 null——用前现取，命中后缓存。
      if (clientCtx !== null && officialConversation === null) {
        try {
          officialConversation = clientCtx.get("conversation") ?? null;
        } catch (error) {
          /* 服务未注册等，保持 null，本次尝试失败 */
        }
      }
      if (
        officialConversation === null ||
        typeof officialConversation.createDraftImages !== "function" ||
        typeof officialConversation.releaseDraftImages !== "function" ||
        inputActions === undefined ||
        typeof inputActions.addImages !== "function"
      ) {
        return 0;
      }
      try {
        const images = officialConversation.createDraftImages(files);
        if (images.length === 0) return 0;
        if (inputActions.addImages(images.map((image) => image.id))) return images.length;
        officialConversation.releaseDraftImages(images);
        return 0;
      } catch (error) {
        // UnsupportedImageMediaTypeError 等：不泄漏，返回失败
        return 0;
      }
    }

    // ── 引用胶囊通道（fork 核心；机制依据 = docs/plan-20260905-fileupload-chip.md §1/§3）──

    /** 自有 @ 触发源名：只为胶囊挂 codec（空候选不进菜单），与核心 reference/cordis/skill、side-chat 源不重名 */
    const REF_SOURCE_NAME = "dsh-file-upload";
    /** 注册闸门：源未注册成功就绝不能插胶囊（否则提交时按 source 找不到 codec → 发送被阻塞） */
    let refSourceRegistered = false;

    /** ref = {p: 绝对路径, x: 插入时前缀} 的 JSON——codec 在提交时刻才被调用，前缀必须随 ref 携带 */
    function encodeRef(path, prefix) {
      return JSON.stringify({ p: path, x: prefix });
    }
    function decodeRef(ref) {
      try {
        const o = JSON.parse(ref);
        if (o && typeof o.p === "string") return { p: o.p, x: typeof o.x === "string" ? o.x : "" };
      } catch { /* 旧格式/外部构造：按裸路径处理 */ }
      return { p: String(ref), x: "" };
    }

    /** 胶囊 label：带一层父目录（宿主 title=label 写死，裸 basename 无法区分同名文件）；目录补尾斜杠 */
    function chipLabel(path, isDir) {
      const norm = String(path).replace(/[\\/]+$/, "");
      const parts = norm.split(/[\\/]/).filter((s) => s !== "");
      const name = parts.pop() || norm;
      const parent = parts.pop() || "";
      const label = parent !== "" ? `${parent}/${name}` : name;
      return isDir ? `${label}/` : label;
    }

    /**
     * 自有 @ 源：空候选 + 自带 codec。核心 reference 源的 ref 语义是工作区
     * 相对路径且 codec 为 identity（@token 原样进模型），而本插件文件在工作区
     * 外（~/Documents/DSH/Attachments），必须自持语义：serialize 输出
     * "\n" + prefix + " " + path（模型侧逐行，等价原版每行一条）；
     * clipboardText 为 "prefix + path" 单行（复制/草稿持久化干净）。
     */
    const referenceSource = {
      trigger: "@",
      name: REF_SOURCE_NAME,
      order: 1000,
      showGroupTitle: false, // 空候选源防在 @ 菜单渲染空组标题行
      candidates: async () => [],
      onPick: () => undefined,
      codec: {
        clipboardText: (ref) => {
          const { p, x } = decodeRef(ref);
          return x !== "" ? `${x} ${p}` : p;
        },
        serialize: async (ref) => {
          const { p, x } = decodeRef(ref);
          return x !== "" ? `\n${x} ${p}` : `\n${p}`;
        },
      },
    };

    /**
     * 解析当前会话的输入面（SessionInputShell）：sessions.scope → conversation.input.for。
     * 全程 ctx.get 注入式读 + 存在性检查（不加 dsh.client.inject，避免 bundle 层变更）。
     * 不可用 = null，调用方降级，绝不抛。
     */
    function resolveSessionInput(sessionId) {
      try {
        if (clientCtx === null) return null;
        const sessions = clientCtx.get("sessions");
        const conversation = clientCtx.get("conversation");
        const actx = sessions && typeof sessions.scope === "function" ? sessions.scope(sessionId) : undefined;
        if (actx === undefined || !conversation || !conversation.input || typeof conversation.input.for !== "function") {
          return null;
        }
        const input = conversation.input.for(actx);
        return input && typeof input.insertReference === "function" ? input : null;
      } catch {
        return null;
      }
    }

    /** 读输入面快照的 draftRev（CAS 用）；不可用返回 null */
    function currentRev(input) {
      try {
        const snap = input.state && typeof input.state.getSnapshot === "function" ? input.state.getSnapshot() : null;
        return snap && typeof snap.draftRev === "number" ? snap.draftRev : null;
      } catch {
        return null;
      }
    }

    /**
     * 降级写路径文本：insertText 于光标处（detect 坐标，保留已有胶囊）。
     * 返回是否写入成功；false = 连文本都没写进草稿（调用方给 notice）。
     * 铁律：不得回 setDraft（抹掉草稿内全部已有胶囊）。
     */
    function fallbackInsertText(input, path, prefix, reason) {
      let done = false;
      if (input !== null && typeof input.insertText === "function") {
        const rev = currentRev(input);
        const span = typeof input.caretSpan === "function" ? input.caretSpan() : null;
        if (rev !== null && span) {
          const text = (prefix !== "" ? `${prefix} ${path}` : path);
          try {
            // 容错：契约声明返回 boolean，但旧宿主可能返回 void——只把显式 false 当失败
            done = input.insertText(` ${text}`, { start: span.start, end: span.end, draftRev: rev }) !== false;
          } catch (error) {
            log.error("chip-error", () => String((error && error.message) || error).slice(0, 90));
          }
        }
      }
      log.warn("chip-fallback", () => `via=${done ? "insertText" : "notice"} reason=${reason} label=${chipLabel(path, false)}`);
      return done;
    }

    /**
     * 把已落盘路径写进草稿：每项一颗引用胶囊（insertReference 于光标处）。
     * 逐项现取 draftRev（上一次插入会推进 rev，CAS 一票否决）；插入后光标
     * 落在胶囊之后（宿主保证），下一颗 caretSpan() 自然衔接。
     * @param {string} sessionId
     * @param {{path: string, dir: boolean}[]} items
     * @param {string} prefix
     * @param {(text: string) => void} noticeFn 最终降级的可见提示
     */
    function putPaths(sessionId, items, prefix, noticeFn) {
      logSess = typeof sessionId === "string" ? sessionId : "";
      const files = items.filter((it) => !it.dir).length;
      const dirs = items.length - files;
      log.info("put-paths", () => `files=${files} dirs=${dirs}`);
      const input = resolveSessionInput(sessionId);
      // R1 闸门：源未注册（inputTriggers 缺位等）→ 胶囊提交时无 codec 会阻塞
      // 发送，此时直接走 insertText/notice，绝不插胶囊。
      const chipAllowed = refSourceRegistered && input !== null;
      for (const item of items) {
        const label = chipLabel(item.path, item.dir);
        if (!chipAllowed) {
          const wrote = fallbackInsertText(input, item.path, prefix, refSourceRegistered ? "no-input" : "source-unregistered");
          if (!wrote) noticeFn(`路径：${prefix !== "" ? `${prefix} ${item.path}` : item.path}`);
          continue;
        }
        const rev = currentRev(input);
        const span = typeof input.caretSpan === "function" ? input.caretSpan() : null;
        let ok = false;
        if (rev !== null && span && typeof span.start === "number" && typeof span.end === "number") {
          try {
            ok = input.insertReference({
              source: REF_SOURCE_NAME,
              ref: encodeRef(item.path, prefix),
              label,
              appearance: item.dir ? "folder" : "file",
              clipboardText: prefix !== "" ? `${prefix} ${item.path}` : item.path,
            }, { start: span.start, end: span.end, draftRev: rev });
          } catch (error) {
            log.error("chip-error", () => String((error && error.message) || error).slice(0, 90));
            ok = false;
          }
        }
        if (ok) {
          log.info("chip-insert", () => `ok=1 label=${label} dir=${item.dir ? 1 : 0} via=chip`);
        } else {
          const wrote = fallbackInsertText(input, item.path, prefix, "ref-refused");
          if (!wrote) noticeFn(`路径：${prefix !== "" ? `${prefix} ${item.path}` : item.path}`);
        }
      }
      // 状态哨兵（变化才打）：接入态 + 本源胶囊计数——胶囊被意外抹掉时计数下降即现形
      log.change("状态", () => {
        let chips = 0;
        try {
          const snap = input !== null && input.state && typeof input.state.getSnapshot === "function"
            ? input.state.getSnapshot()
            : null;
          if (snap && Array.isArray(snap.occurrences)) {
            chips = snap.occurrences.filter((occ) => occ && occ.source === REF_SOURCE_NAME).length;
          }
        } catch { /* 忽略 */ }
        return `mode=${log.__state().mode} chips=${chips}`;
      });
    }

    /**
     * 粘贴文本透传（pasteMode 接管时剪贴板附带文本的补写）：insertText 于
     * 光标处，保留草稿内已有胶囊。原版此处是 setDraft 全量替换（抹胶囊），
     * fork 改走官方通道；旧宿主无 insertText 时文本丢弃（rc.1 已有该面）。
     */
    function pasteInsertText(sessionId, text) {
      logSess = typeof sessionId === "string" ? sessionId : "";
      const input = resolveSessionInput(sessionId);
      let ok = false;
      if (input !== null && typeof input.insertText === "function") {
        const rev = currentRev(input);
        const span = typeof input.caretSpan === "function" ? input.caretSpan() : null;
        if (rev !== null && span) {
          try {
            ok = input.insertText(text, { start: span.start, end: span.end, draftRev: rev });
          } catch (error) {
            log.error("chip-error", () => String((error && error.message) || error).slice(0, 90));
          }
        }
      }
      log.info("paste-insert", () => `len=${text.length} ok=${ok ? 1 : 0}`);
      return ok;
    }

    /**
     * 错误边界：occupant 渲染崩溃时只降级按钮区域并显示错误原因，
     * 不让异常扩散把整个输入框（对话框）卸载掉。
     */
    class UploadBoundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        console.error("[dsh-file-upload] occupant crashed:", error);
      }
      render() {
        if (this.state.error !== null) {
          // 降级提示：警告三角 SVG（2026-08-21，界面图标不用 emoji）
          return react.createElement(
            "span",
            {
              title: String(this.state.error),
              style: { display: "inline-flex", alignItems: "center", gap: "3px", color: "var(--dsw-alias-state-error-primary, #d03050)", fontSize: "12px", cursor: "help" },
            },
            react.createElement("svg", {
              width: 12, height: 12, viewBox: "0 0 16 16", fill: "none",
              stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
              style: { flex: "none", display: "block" },
            },
              react.createElement("path", { d: "M8 2.5L14.5 13.5h-13z" }),
              react.createElement("path", { d: "M8 6.5v3.5" }),
              react.createElement("circle", { cx: 8, cy: 11.7, r: 0.9, fill: "currentColor", stroke: "none" })
            ),
            "上传组件异常"
          );
        }
        return this.props.children;
      }
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      // 官方对话服务（root 级，提供 createDraftImages 等草稿附件方法）。
      // 0.1.2 起该服务可能晚于插件注册，这里只做首次尝试；tryOfficial 每次
      // 调用前仍会现取刷新，apply 时没注册也能在后续补齐。
      clientCtx = ctx;
      injectCardCss();
      try {
        officialConversation = ctx.get("conversation") ?? null;
      } catch (error) {
        officialConversation = null;
      }

      // 自有 @ 源注册（引用胶囊归属）：ctx.effect 挂管，scope 销毁自动反注册。
      // inputTriggers 缺位 = 宿主契约面不满足，胶囊不可用（打 contract 告警，
      // 拖入时降级 notice/insertText，功能不崩）。
      try {
        const triggers = ctx.get("inputTriggers");
        if (triggers && typeof triggers.registerSource === "function") {
          ctx.effect(() => triggers.registerSource(referenceSource), "file-upload: @ reference source");
          refSourceRegistered = true;
          log.info("source-registered", () => `name=${REF_SOURCE_NAME}`);
        } else {
          log.warn("contract", () => "face=inputTriggers missing");
        }
      } catch (error) {
        log.warn("contract", () => `face=inputTriggers error=${String((error && error.message) || error).slice(0, 60)}`);
      }

      slots.inject("conversation.input.left", () => slots.register(
        { name: "conversation.input.left", id: "dsh-file-upload" },
        (props) => react.createElement(UploadBoundary, null,
          react.createElement(UploadButton, props)
        )
      ));

      // 设置卡片：双入口（分区 + 插件卡片），共用 SettingsCard
      slots.inject("settings.section", () => slots.register(
        { name: "settings.section", id: "dsh-file-upload-settings", order: 40, label: "文件上传" },
        () => react.createElement(SettingsCard)
      ));
      slots.inject("settings.plugin.item", () => slots.register(
        { name: "settings.plugin.item", key: "file-upload", id: "file-upload" },
        () => react.createElement(SettingsCardShell, { title: "文件上传", desc: "上传文件到附件库：目录 / 路径前缀 / 粘贴接管 / 留档开关" },
          react.createElement(SettingsCard, { inCard: true }))
      ));
    }

    // ── 设置卡片：附件目录 + 图片走官方附件 + 留档开关 + 粘贴档位 + 上限状态 ──
    function SettingsCard(props) {
      const [dir, setDir] = react.useState("");
      const [prefix, setPrefix] = react.useState("[上传文件]");
      const [allowPublic, setAllowPublic] = react.useState(false);
      const [pasteMode, setPasteMode] = react.useState("off"); // off | images | all
      const [wantOfficial, setWantOfficial] = react.useState(true);
      const [wantKeep, setWantKeep] = react.useState(true);
      const [maxBytes, setMaxBytes] = react.useState(null); // null = 未知
      const [saving, setSaving] = react.useState(false);
      const [msg, setMsg] = react.useState(null); // { kind, text }
      const [saved, setSaved] = react.useState(false);
      const savedTimer = react.useRef(null);
      react.useEffect(() => () => {
        if (savedTimer.current !== null) clearTimeout(savedTimer.current);
      }, []);
      react.useEffect(() => {
        let alive = true;
        fetch("/api/file-upload/config", { cache: "no-store" })
          .then((r) => r.json())
          .then((d) => {
            if (!alive || d === null || d.ok !== true) return;
            setDir(d.attachmentDir || "");
            setPrefix(typeof d.prefix === "string" ? d.prefix : "[上传文件]");
            setAllowPublic(d.allowPublic === true);
            setPasteMode(d.pasteMode === "off" || d.pasteMode === "images" || d.pasteMode === "all" ? d.pasteMode : "off");
            setWantOfficial(d.imageViaOfficial !== false);
            setWantKeep(d.keepImageArchive !== false);
            setMaxBytes(typeof d.maxImageBytes === "number" ? d.maxImageBytes : null);
          })
          .catch(() => {});
        return () => { alive = false; };
      }, []);
      function save() {
        setSaving(true);
        setMsg(null);
        fetch("/api/file-upload/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ attachmentDir: dir.trim(), imageViaOfficial: wantOfficial, keepImageArchive: wantKeep, prefix, allowPublic, pasteMode }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok === true) {
              if (typeof d.attachmentDir === "string") setDir(d.attachmentDir);
              // 保存成功即更新粘贴模式缓存：设置面板改档位后无需刷新页面，
              // 常驻 paste 监听器下一次事件就走新档（「已保存，立即生效」
              // 对本项同样成立）
              if (d.pasteMode === "off" || d.pasteMode === "images" || d.pasteMode === "all") {
                pasteModeCache = d.pasteMode;
              }
              setMsg({ kind: "ok", text: "已保存，立即生效" });
              setSaved(true);
              if (savedTimer.current !== null) clearTimeout(savedTimer.current);
              savedTimer.current = setTimeout(() => { setSaved(false); savedTimer.current = null; }, 2000);
            } else {
              setMsg({ kind: "err", text: "保存失败：" + ((d && d.error) || "未知错误") });
            }
          })
          .catch(() => setMsg({ kind: "err", text: "保存失败：网络错误" }))
          .finally(() => setSaving(false));
      }
      function openDir() {
        fetch("/api/file-upload/open-dir", { method: "POST" })
          .then((r) => r.json())
          .then((d) => {
            if (d === null || d.ok !== true) {
              setMsg({ kind: "err", text: "打开失败：" + ((d && d.error) || "未知错误") });
            }
          })
          .catch(() => setMsg({ kind: "err", text: "打开失败：网络错误" }));
      }
      const limitText = maxBytes === null
        ? "未知"
        : maxBytes >= 64 * 1024 * 1024
          ? "64 MiB ✅（大图可拖入）"
          : `${Math.round(maxBytes / 1024 / 1024)} MiB（如需大图见 README 配置说明，改后需重启）`;
      return react.createElement("div", { style: { padding: "8px 0", fontSize: 13 } },
        // 分区内容统一头部标题（2026-08-21，标题 = 分区名，样式对齐 memory/backup 的 h3）；卡片壳内不重复标题
        props && props.inCard ? null : react.createElement("h3", { style: { margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "文件上传"),
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginBottom: 8, lineHeight: "18px" } },
          "所有上传统一进附件库：图片存 images/ 子目录并尽量走官方附件（自动复用 file_id）；其他文件存 files/ 子目录；各自按天分文件夹，路径文本进草稿。"),

        react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
          react.createElement("label", { htmlFor: "fu-dir", style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
            "附件目录（支持 ~ 前缀；留空恢复默认）"),
          react.createElement("input", {
            id: "fu-dir",
            type: "text",
            value: dir,
            onChange: (e) => setDir(e.target.value),
            spellCheck: false,
            placeholder: "~/Documents/DSH/Attachments",
            style: {
              width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12,
              fontFamily: "monospace", color: "var(--dsw-alias-label-secondary, #666)",
              background: "transparent",
              border: "1px solid var(--dsw-alias-border-l1, #e5e5e5)",
              borderRadius: 6,
            },
          }),
          react.createElement("button", {
            type: "button",
            onClick: openDir,
            className: "dsh-fu-open",
            title: "在文件管理器中打开附件库根目录",
          }, "打开文件夹 →"),
          react.createElement("label", { htmlFor: "fu-prefix", style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
            "路径前缀（插入输入框时加在路径前；留空 = 无前缀）"),
          react.createElement("input", {
            id: "fu-prefix",
            type: "text",
            value: prefix,
            onChange: (e) => setPrefix(e.target.value),
            spellCheck: false,
            placeholder: "[上传文件]",
            style: {
              width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12,
              color: "var(--dsw-alias-label-secondary, #666)",
              background: "transparent",
              border: "1px solid var(--dsw-alias-border-l1, #e5e5e5)",
              borderRadius: 6,
            },
          }),
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } },
            react.createElement("label", { htmlFor: "fu-official", style: { color: "var(--dsw-alias-label-primary)", flex: "auto", cursor: "pointer" } },
              "图片走官方附件（发送后自动 file_id 复用）"),
            react.createElement("input", {
              id: "fu-official",
              type: "checkbox",
              checked: wantOfficial,
              onChange: (e) => setWantOfficial(e.target.checked),
              style: { width: 16, height: 16, accentColor: "var(--dsw-alias-state-business-primary)", cursor: "pointer" },
            }),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, flex: "none" } },
              wantOfficial ? "开" : "关")
          ),
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } },
            react.createElement("label", { htmlFor: "fu-keep", style: { color: "var(--dsw-alias-label-primary)", flex: "auto", cursor: "pointer" } },
              "留档图片到附件目录（方便本地找图；关 = 只走官方附件更省空间）"),
            react.createElement("input", {
              id: "fu-keep",
              type: "checkbox",
              checked: wantKeep,
              onChange: (e) => setWantKeep(e.target.checked),
              style: { width: 16, height: 16, accentColor: "var(--dsw-alias-state-business-primary)", cursor: "pointer" },
            }),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, flex: "none" } },
              wantKeep ? "开" : "关")
          ),
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } },
            react.createElement("label", { htmlFor: "fu-public", style: { color: "var(--dsw-alias-label-primary)", flex: "auto", cursor: "pointer" } },
              "允许公网上传（关 = 仅本机 localhost；开 = 放行任意来源，供公网/内网穿透域名访问）"),
            react.createElement("input", {
              id: "fu-public",
              type: "checkbox",
              checked: allowPublic,
              onChange: (e) => setAllowPublic(e.target.checked),
              style: { width: 16, height: 16, accentColor: "var(--dsw-alias-state-business-primary)", cursor: "pointer" },
            }),
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, flex: "none" } },
              allowPublic ? "开" : "关")
          ),
          // 监听剪贴板（粘贴接管三档）：off = 官方内建粘贴；images = 无识图模型
          // 也能贴图（降级路径文本）；all = 任何文件都接管。原生下拉对齐本卡
          // 其它控件的官方 token 风格（l1 边框 + 6px 圆角）。
          react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } },
            react.createElement("label", { htmlFor: "fu-paste", style: { color: "var(--dsw-alias-label-primary)", flex: "auto", cursor: "pointer" } },
              "监听剪贴板（关 = 官方粘贴；图片 = 无识图模型也能贴图；全部文件 = 任何文件都接管）"),
            react.createElement("select", {
              id: "fu-paste",
              value: pasteMode,
              onChange: (e) => setPasteMode(e.target.value),
              style: {
                flex: "none", boxSizing: "border-box", padding: "4px 8px", fontSize: 12,
                color: "var(--dsw-alias-label-primary, #1f2328)",
                background: "var(--dsw-alias-bg-layer-2, transparent)",
                border: "1px solid var(--dsw-alias-border-l1, #e5e5e5)",
                borderRadius: 6, cursor: "pointer",
              },
            },
              react.createElement("option", { value: "off" }, "关"),
              react.createElement("option", { value: "images" }, "只监听图片"),
              react.createElement("option", { value: "all" }, "全部文件")
            )
          ),
          react.createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: "18px" } },
            "图片来源上限：" + limitText)
        ),

        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 } },
          react.createElement("button", {
            type: "button",
            onClick: save,
            disabled: saving,
            className: "dsh-fu-save" + (saved ? " is-saved" : ""),
          }, saving ? "保存中…" : (saved ? "✓ 已保存" : "保存")),
          msg !== null && react.createElement("span", {
            style: { fontSize: 12, color: msg.kind === "ok" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" },
          }, msg.text))
      );
    }

    /** 上传按钮本体（被错误边界包裹，崩溃不扩散） */
    function UploadButton(props) {
      const { sessionId, inputActions } = props;
      const [busy, setBusy] = react.useState(false);
      // 反馈分流（2026-08-21 修复：成功/失败共用 notice 导致成功也标红）：
      // notice = title 提示（成功/失败都显示）；error = 只控制按钮红色错误态
      const [notice, setNotice] = react.useState(null);
      const [error, setError] = react.useState(null);
      const inputRef = react.useRef(null);
      const noticeTimer = react.useRef(null);
      const busyRef = react.useRef(false);
      // 草稿读取说明：fork 起草稿写入全走官方通道（insertReference/insertText
      // 于光标处），组件内不再缓存/全量替换草稿（原 draftRef + setDraft 方案
      // 已随引用胶囊化移除——setDraft 会抹掉草稿内全部已有胶囊）。如需读草稿
      // 快照，用 owner prop `input`（InputState 同步快照）；不要用 useInput()
      // ——它是真 React hook，无会话时 undefined，条件调用违反 hook 规则
      // 会导致组件崩溃（实测按钮消失）。

      function showNotice(text) {
        setNotice(text);
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 6000);
      }

      const handleFiles = react.useCallback((fileList) => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        if (busyRef.current) {
          showNotice("正在上传，请稍候…");
          return;
        }
        busyRef.current = true;
        setBusy(true);
        setNotice(null);
        (async () => {
          const cfg = await fetchConfig(sessionId);
          // 开关层：配置不可用 = 未知 → 保守走原逻辑（mode=file）
          const viaOfficialSwitch = cfg !== null ? cfg.imageViaOfficial !== false : false;
          // 官方可用：开关开 + 模型支持图片（查不到 = 保守）
          const officialOn = viaOfficialSwitch && cfg !== null && cfg.sessionImageSupported === true;
          const hostLimit = cfg !== null && typeof cfg.maxImageBytes === "number"
            ? cfg.maxImageBytes
            : 20 * 1024 * 1024;
          const keepArchive = cfg !== null ? cfg.keepImageArchive !== false : true;
          // 路径文本前缀（可在设置里改；留空 = 无前缀；配置不可用时退默认）
          const prefix = cfg !== null && typeof cfg.prefix === "string" ? cfg.prefix : "[上传文件]";

          const paths = [];       // 需写入草稿的路径文本
          let officialCount = 0;  // 进入官方附件条的图片数
          const errors = [];
          for (const file of files) {
            if (!IMAGE_MIME.has(file.type)) {
              // 其他文件（含非白名单图片格式）：附件库 files/ + 路径文本
              const r = await saveOne(file, "file", sessionId);
              if (r.ok) paths.push(r.path);
              else errors.push(r.error);
              continue;
            }
            if (file.size > MAX_FILE_BYTES) {
              errors.push(`「${file.name}」超过 64MB（DeepSeek 官方上限），已跳过`);
              continue;
            }
            if (officialOn && file.size <= hostLimit) {
              // 图片 → 官方附件（+ 可选留档）
              if (keepArchive) {
                const r = await saveOne(file, "image", sessionId);
                if (!r.ok) errors.push(r.error);
              }
              const n = tryOfficial([file], inputActions);
              if (n > 0) {
                officialCount += n;
              } else {
                // 官方通道失败 → 降级：留档（关了留档也强制留，不丢）+ 路径文本
                const r = await saveOne(file, "image", sessionId);
                if (r.ok) {
                  paths.push(r.path);
                  errors.push("官方附件不可用，已降级为路径引用");
                } else {
                  errors.push(r.error);
                }
              }
              continue;
            }
            // 图片（模型不支持 / 超宿主上限 ≤64 MiB / 开关关）→ 附件库 images/ +
            // 路径文本（开关不影响存哪，只影响发送形式）
            const r = await saveOne(file, "image", sessionId);
            if (r.ok) paths.push(r.path);
            else errors.push(r.error);
          }

          if (paths.length > 0) {
            // fork：路径 → 引用胶囊（insertReference），不再 setDraft 纯文本
            putPaths(sessionId, paths.map((p) => ({ path: p, dir: false })), prefix, showNotice);
          }
          const parts = [];
          if (officialCount > 0) parts.push(`已添加 ${officialCount} 张图片到附件（发送后自动复用 file_id）`);
          if (paths.length > 0) parts.push(`已添加 ${paths.length} 个文件到输入框`);
          if (errors.length > 0) parts.push(errors.join("；"));
          if (parts.length > 0) showNotice(parts.join("；"));
          // 只有失败才标红（成功信息只进 title，不触发错误态）
          setError(errors.length > 0 ? errors.join("；") : null);
        })().finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
      }, [sessionId, inputActions]);

      // 拖拽文件夹：递归读目录树 → host save-folder 重建 → 只把文件夹根路径
      // 一行（带配置前缀）进草稿，不展开内部文件。
      const handleFolders = react.useCallback((dirEntries) => {
        if (dirEntries.length === 0) return;
        if (busyRef.current) {
          showNotice("正在上传，请稍候…");
          return;
        }
        busyRef.current = true;
        setBusy(true);
        setNotice(null);
        (async () => {
          const cfg = await fetchConfig(sessionId);
          const prefix = cfg !== null && typeof cfg.prefix === "string" ? cfg.prefix : "[上传文件]";
          const paths = [];
          const errors = [];
          for (const entry of dirEntries) {
            try {
              const entries = await readEntryTree(entry);
              if (entries.length === 0) {
                errors.push(`「${entry.name}」是空文件夹，已跳过`);
                continue;
              }
              const r = await saveFolder(entry.name, entries, sessionId);
              if (r.ok) paths.push(r.path);
              else errors.push(r.error);
            } catch (cause) {
              errors.push(`「${entry.name}」读取失败`);
            }
          }
          if (paths.length > 0) {
            // fork：文件夹根路径 → 引用胶囊（appearance folder），不再 setDraft 纯文本
            putPaths(sessionId, paths.map((p) => ({ path: p, dir: true })), prefix, showNotice);
          }
          const parts = [];
          if (paths.length > 0) parts.push(`已添加 ${paths.length} 个文件夹到输入框`);
          if (errors.length > 0) parts.push(errors.join("；"));
          if (parts.length > 0) showNotice(parts.join("；"));
          setError(errors.length > 0 ? errors.join("；") : null);
        })().finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
      }, [sessionId, inputActions]);

      // 页面级拖拽接管：捕获阶段先于官方冒泡监听执行，preventDefault +
      // stopPropagation 后官方 InputBar 不再处理（防双处理）。dragenter 也要
      // 拦——否则官方"毛玻璃拖放遮罩"会显示，且因 drop 被我们接管而永不复位。
      react.useEffect(() => {
        const hasFiles = (e) =>
          e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
        const onDragEnter = (e) => {
          if (hasFiles(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        const onDragOver = (e) => {
          if (hasFiles(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        const onDrop = (e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          const items = e.dataTransfer && e.dataTransfer.items ? Array.from(e.dataTransfer.items) : [];
          // 目录分支：items 里有 webkitGetAsEntry 返回目录 → 走文件夹递归上传
          const dirEntries = [];
          for (const item of items) {
            const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
            if (entry && entry.isDirectory) dirEntries.push(entry);
          }
          if (dirEntries.length > 0) {
            handleFolders(dirEntries);
            return;
          }
          // 文件分支（含混合里的普通文件走不到这；纯文件才进）
          const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
          if (files.length > 0) handleFiles(files);
        };
        document.addEventListener("dragenter", onDragEnter, true);
        document.addEventListener("dragover", onDragOver, true);
        document.addEventListener("drop", onDrop, true);
        return () => {
          document.removeEventListener("dragenter", onDragEnter, true);
          document.removeEventListener("dragover", onDragOver, true);
          document.removeEventListener("drop", onDrop, true);
        };
      }, [handleFiles, handleFolders]);

      // 粘贴接管（捕获阶段先于官方 textarea 的 React onPaste）：剪贴板带文件
      // （截图 / 复制的图片）时走本插件分流——模型支持识图 → 官方附件条；
      // 不支持 → host 落盘附件库 images/ + 路径文本进草稿（官方内建粘贴在
      // 模型不支持时发送端会直接报 MODEL_DOES_NOT_SUPPORT_IMAGES，等于贴不了）。
      // 纯文本粘贴不拦截，官方照常处理。
      // pasteMode 三档（设置面板可配）：off=不接管（官方内建粘贴）；
      // images=只接管图片；all=接管全部文件。
      // 监听器常驻注册一次（回调里同步读 pasteModeCache，改设置无需刷新页面）；
      // off 档不摘监听，回调首行判缓存直接放行，这样设置来回切换永远即时生效。
      react.useEffect(() => {
        const onPaste = (e) => {
          if (pasteModeCache === "off") return; // 关档：放行官方
          if (e.clipboardData === null || e.clipboardData === undefined) return;
          const items = Array.from(e.clipboardData.items || []);
          const fileItems = items.filter(
            (item) => item.kind === "file" && item.type !== "" && item.type !== "text/plain"
          );
          const files = fileItems
            .map((item) => item.getAsFile())
            .filter((file) => file !== null);
          if (files.length === 0) return; // 纯文本/无文件：放行官方
          let targets;
          if (pasteModeCache === "images") {
            // 只接管图片；非图片文件粘贴交回官方，保持官方既有行为
            targets = files.filter((file) => IMAGE_MIME.has(file.type));
          } else {
            // all：全部文件接管
            targets = files;
          }
          if (targets.length === 0) return;
          e.preventDefault();
          e.stopPropagation();
          // 文本透传（2026-08-25 修，对照官方 onPaste）：剪贴板同时带文本时
          // 官方是「文件进附件条 + 文本插入草稿」两样都收；本插件拦截整事件后
          // 只上传文件，文本会丢——这里补上。fork 改走 insertText 于光标处
          // （原 setDraft 全量替换会抹掉草稿内全部已有引用胶囊）；旧宿主无
          // insertText 时文本丢弃（rc.1 已有该面，见 plan 册 §3.3）。
          const text = e.clipboardData.getData("text/plain");
          if (text !== "") {
            pasteInsertText(sessionId, text);
          }
          handleFiles(targets);
        };
        document.addEventListener("paste", onPaste, true);
        // 挂载即拉一次配置初始化缓存（fetchConfig 顺带更新 pasteModeCache）
        fetchConfig(sessionId);
        // 窗口重新聚焦时后台刷新缓存：覆盖「设置在别的标签页/窗口改了」的场景
        const onFocus = () => { fetchConfig(sessionId); };
        window.addEventListener("focus", onFocus);
        return () => {
          document.removeEventListener("paste", onPaste, true);
          window.removeEventListener("focus", onFocus);
        };
      }, [handleFiles, sessionId]);

      react.useEffect(() => () => {
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
      }, []);

      return react.createElement(
        "button",
        {
          type: "button",
          className: "dsh-upload-btn" + (error !== null ? " is-error" : ""),
          onClick: () => { if (inputRef.current !== null) inputRef.current.click(); },
          disabled: busy,
          title: notice !== null ? notice : "上传文件到当前项目（也可直接把文件拖进窗口）",
          "aria-label": "上传文件",
        },
        UploadIcon(),
        react.createElement("input", {
          ref: inputRef,
          type: "file",
          multiple: true,
          style: { display: "none" },
          onChange: (e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          },
        })
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
