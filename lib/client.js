window.__ModuleLoader__.load({
  id: "dsh-file-upload",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    /**
     * dsh-file-upload — Client 半
     *
     * 1. 输入框工具行左侧加「上传」按钮（与默认 "+" 命令按钮图标区分）。
     * 2. 点击弹系统文件选择器（可多选）；页面任意位置拖入文件也接管（捕获
     *    阶段监听，先于官方 InputBar 的 document 冒泡监听，防双处理）。
     * 3. 分流：
     *    - 图片（PNG/JPEG/WebP/GIF）且「允许官方附件」开 + 模型支持 + 不超宿主上限
     *      → host 留档附件库 images/<日期>/ + 官方草稿附件条（发送后自动
     *      file_id、同图复用）——不写路径文本。
     *    - 图片但模型不支持/超上限/开关关/官方通道异常 → 留档附件库 images/ + 路径文本。
     *    - 其他文件 → 附件库 files/ + `[上传文件] 路径`。
     * 4. 设置卡片：附件目录路径 + 允许官方附件开关 + 留档开关 + 上限状态。
     *    插件不处理图像字节（压缩是主程序的事）。
     */
    const inject = ["slots"];

    /** 前端单文件上限（= DeepSeek file_id 硬限 64 MiB；host 端同值） */
    const MAX_FILE_BYTES = 64 * 1024 * 1024;

    /** 官方图片 MIME 白名单（与主程序/官方文档一致） */
    const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

    /** 官方附件服务（apply 时获取；createDraftImages 为官方未公开实例方法） */
    let officialConversation = null;

    // ── 官方 dsw 风格按钮（2026-08-18，对齐 plan-switch 样板）：28px 图标按钮 ──
    if (typeof document !== "undefined" && !document.getElementById("dsh-upload-style")) {
      const tag = document.createElement("style");
      tag.id = "dsh-upload-style";
      tag.textContent = [
        ".dsh-upload-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}",
        ".dsh-upload-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".dsh-upload-btn:disabled{opacity:.5;cursor:default;}",
        ".dsh-upload-btn.is-error{color:var(--dsw-alias-state-error-primary,#d03050);}",
        // ── 设置卡样式（对齐宿主 dsw token：分组卡片 + 滑动开关 + 主按钮）──
        ".dsh-fu{padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary,#333);}",
        ".dsh-fu-title{margin:0;font-size:15px;font-weight:600;}",
        ".dsh-fu-intro{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-caption{margin:18px 0 6px;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-group{border:1px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:10px;overflow:hidden;}",
        ".dsh-fu-field{display:flex;flex-direction:column;gap:6px;padding:10px 12px;}",
        ".dsh-fu-field+.dsh-fu-field{border-top:1px solid var(--dsw-alias-border-l1,#e5e5e5);}",
        ".dsh-fu-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666);}",
        ".dsh-fu-input{width:100%;box-sizing:border-box;padding:7px 10px;font-size:12px;color:var(--dsw-alias-label-primary,#333);background:transparent;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);border-radius:8px;outline:none;transition:border-color .15s,box-shadow .15s;}",
        ".dsh-fu-input:hover{border-color:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-input:focus{border-color:var(--dsw-alias-state-business-primary,#2f6fed);box-shadow:0 0 0 3px rgba(47,111,237,.18);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6fed) 18%,transparent);}",
        ".dsh-fu-input::placeholder{color:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-input-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
        ".dsh-fu-dir-row{display:flex;gap:8px;align-items:stretch;}",
        ".dsh-fu-dir-row .dsh-fu-input{flex:1;}",
        // 打开文件夹按钮（图标幽灵按钮，与目录输入框同行）
        ".dsh-fu-open{display:inline-flex;align-items:center;gap:5px;flex:none;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:transparent;color:var(--dsw-alias-label-secondary,#666);border-radius:8px;padding:0 10px;font-size:12px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;}",
        ".dsh-fu-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#333);}",
        // 开关行：标题 + 副描述 + 滑动开关
        ".dsh-fu-row{display:flex;align-items:center;gap:12px;padding:10px 12px;}",
        ".dsh-fu-row+.dsh-fu-row{border-top:1px solid var(--dsw-alias-border-l1,#e5e5e5);}",
        ".dsh-fu-row-text{flex:1;display:flex;flex-direction:column;gap:2px;cursor:pointer;min-width:0;}",
        ".dsh-fu-row-title{font-size:13px;color:var(--dsw-alias-label-primary,#333);}",
        ".dsh-fu-row-desc{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-switch{appearance:none;-webkit-appearance:none;flex:none;width:34px;height:20px;margin:0;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-border-l2,#c7c7cc);position:relative;cursor:pointer;transition:background .18s;outline:none;}",
        ".dsh-fu-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .18s;}",
        ".dsh-fu-switch:checked{background:var(--dsw-alias-state-business-primary,#2f6fed);}",
        ".dsh-fu-switch:checked::after{transform:translateX(14px);}",
        ".dsh-fu-switch:focus-visible{box-shadow:0 0 0 3px rgba(47,111,237,.25);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#2f6fed) 25%,transparent);}",
        // 状态行（上限指示圆点）
        ".dsh-fu-status{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12px;color:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-dot.ok{background:var(--dsw-alias-state-success-primary,#18a058);}",
        // 底部：主操作保存按钮 + 反馈信息
        ".dsh-fu-footer{display:flex;align-items:center;gap:10px;margin-top:16px;}",
        ".dsh-fu-save{display:inline-flex;align-items:center;gap:6px;border:none;background:var(--dsw-alias-state-business-primary,#2f6fed);color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:500;cursor:pointer;transition:filter .15s,background .15s;}",
        ".dsh-fu-save:hover:not(:disabled){filter:brightness(1.08);}",
        ".dsh-fu-save:active:not(:disabled){filter:brightness(.95);}",
        ".dsh-fu-save:disabled{opacity:.55;cursor:default;}",
        ".dsh-fu-save.is-saved{background:var(--dsw-alias-state-success-primary,#18a058);}",
        ".dsh-fu-msg{font-size:12px;}",
        ".dsh-fu-msg.ok{color:var(--dsw-alias-state-success-primary,#18a058);}",
        ".dsh-fu-msg.err{color:var(--dsw-alias-state-error-primary,#d03050);}",
        // ── Plugins 列表小卡片（对齐 Codex Switch：折叠头 + 展开体）──
        ".dsh-fu-card{overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);border-radius:10px;background:var(--dsw-alias-bg-module-platform,transparent);}",
        ".dsh-fu-card-header{box-sizing:border-box;width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;border:0;border-radius:8px;outline:none;padding:13px 14px;background:transparent;color:var(--dsw-alias-label-primary,#333);font:inherit;text-align:left;cursor:pointer;}",
        ".dsh-fu-card-header:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));}",
        ".dsh-fu-card-header:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-state-business-primary,#2f6fed);}",
        ".dsh-fu-card-headtext{display:flex;min-width:0;flex-direction:column;gap:3px;}",
        ".dsh-fu-card-name{font-size:14px;line-height:20px;font-weight:600;}",
        ".dsh-fu-card-desc{font-size:13px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);}",
        ".dsh-fu-card-chevron{flex:0 0 auto;display:inline-flex;color:var(--dsw-alias-label-tertiary,#999);transition:transform 120ms ease;}",
        ".dsh-fu-card-chevron.open{transform:rotate(180deg);}",
        ".dsh-fu-card-body{border-top:1px solid var(--dsw-alias-border-l2,#d0d0d0);padding:16px 14px 18px;}",
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

    /** 文件夹图标（设置卡「打开文件夹」按钮用，线性风格对齐 UploadIcon） */
    function FolderIcon() {
      return react.createElement("svg", {
        width: 13, height: 13, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
        style: { flex: "none", display: "block" },
      },
        react.createElement("path", { d: "M2 4.5v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1z" })
      );
    }

    /** 对勾图标（保存按钮成功态用） */
    function CheckIcon() {
      return react.createElement("svg", {
        width: 12, height: 12, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
        style: { flex: "none", display: "block" },
      },
        react.createElement("path", { d: "M3 8.5L6.5 12L13 4.5" })
      );
    }

    /** 下箭头图标（Plugins 折叠卡片头用） */
    function ChevronDownIcon() {
      return react.createElement("svg", {
        width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
        style: { display: "block" },
      },
        react.createElement("path", { d: "M4 6l4 4 4-4" })
      );
    }

    /** 读 host 配置（每次调用现取；失败返回 null，调用方走保守路径） */
    async function fetchConfig(sessionId) {
      try {
        const res = await fetch(
          "/api/file-upload/config?sessionId=" + encodeURIComponent(typeof sessionId === "string" ? sessionId : ""),
          { cache: "no-store" }
        );
        const json = await res.json();
        return json && json.ok === true ? json : null;
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
      // 官方对话服务（root 级，提供 createDraftImages 等草稿附件方法）
      officialConversation = ctx.get("conversation") ?? null;

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
        () => react.createElement(PluginCard)
      ));
    }

    // ── Plugins 列表小卡片：折叠头（名称 + 一句话简介 + 箭头），展开后内嵌 SettingsCard ──
    function PluginCard() {
      const [open, setOpen] = react.useState(false);
      // 展开过后保持子树挂载：折叠不打断进行中的状态/未保存编辑
      const [everOpened, setEverOpened] = react.useState(false);
      return react.createElement("li", { className: "dsh-fu-card" },
        react.createElement("button", {
          type: "button",
          className: "dsh-fu-card-header",
          "aria-expanded": open,
          "aria-controls": "dsh-fu-plugin-body",
          "aria-label": (open ? "收起" : "展开") + "：文件上传",
          onClick: () => { setEverOpened(true); setOpen((v) => !v); },
        },
          react.createElement("span", { className: "dsh-fu-card-headtext" },
            react.createElement("span", { className: "dsh-fu-card-name" }, "文件上传"),
            react.createElement("span", { className: "dsh-fu-card-desc" }, "把文件存进附件库并将路径插入输入框；图片可走官方附件。")
          ),
          react.createElement("span", {
            "aria-hidden": "true",
            className: "dsh-fu-card-chevron" + (open ? " open" : ""),
          }, react.createElement(ChevronDownIcon))
        ),
        everOpened
          ? react.createElement("div", {
              id: "dsh-fu-plugin-body",
              className: "dsh-fu-card-body",
              hidden: !open,
              "aria-hidden": !open,
            }, react.createElement(SettingsCard, { embedded: true }))
          : null
      );
    }

    // ── 设置卡片：附件目录 + 图片走官方附件 + 留档开关 + 上限状态 ──
    function SettingsCard(props) {
      // embedded = 渲染在 Plugins 折叠卡片体内：标题/简介由卡片头承担，不重复
      const embedded = props !== undefined && props !== null && props.embedded === true;
      const [dir, setDir] = react.useState("");
      const [prefix, setPrefix] = react.useState("[上传文件]");
      const [allowPublic, setAllowPublic] = react.useState(false);
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
          body: JSON.stringify({ attachmentDir: dir.trim(), imageViaOfficial: wantOfficial, keepImageArchive: wantKeep, prefix, allowPublic }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok === true) {
              if (typeof d.attachmentDir === "string") setDir(d.attachmentDir);
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
          ? "64 MiB（大图可拖入）"
          : `${Math.round(maxBytes / 1024 / 1024)} MiB（如需大图见 README 配置说明，改后需重启）`;
      // 开关行：标题 + 副描述 + 滑动开关（input id 与旧版一致，功能不变）
      function toggleRow(id, title, desc, checked, set) {
        return react.createElement("div", { className: "dsh-fu-row" },
          react.createElement("label", { htmlFor: id, className: "dsh-fu-row-text" },
            react.createElement("span", { className: "dsh-fu-row-title" }, title),
            react.createElement("span", { className: "dsh-fu-row-desc" }, desc)
          ),
          react.createElement("input", {
            id,
            type: "checkbox",
            className: "dsh-fu-switch",
            checked,
            onChange: (e) => set(e.target.checked),
          })
        );
      }
      return react.createElement("div", { className: "dsh-fu" },
        embedded ? null : react.createElement("h3", { className: "dsh-fu-title" }, "文件上传"),
        embedded ? null : react.createElement("p", { className: "dsh-fu-intro" },
          "所有上传统一进附件库：图片存 images/ 子目录并尽量走官方附件（自动复用 file_id）；其他文件存 files/ 子目录；各自按天分文件夹，路径文本进草稿。"),

        // ── 存储位置 ──
        react.createElement("div", { className: "dsh-fu-caption" }, "存储位置"),
        react.createElement("div", { className: "dsh-fu-group" },
          react.createElement("div", { className: "dsh-fu-field" },
            react.createElement("label", { htmlFor: "fu-dir", className: "dsh-fu-label" },
              "附件目录（支持 ~ 前缀；留空恢复默认）"),
            react.createElement("div", { className: "dsh-fu-dir-row" },
              react.createElement("input", {
                id: "fu-dir",
                type: "text",
                className: "dsh-fu-input dsh-fu-input-mono",
                value: dir,
                onChange: (e) => setDir(e.target.value),
                spellCheck: false,
                placeholder: "~/Documents/DSH/Attachments",
              }),
              react.createElement("button", {
                type: "button",
                onClick: openDir,
                className: "dsh-fu-open",
                title: "在文件管理器中打开附件库根目录",
              }, react.createElement(FolderIcon), "打开文件夹")
            )
          ),
          react.createElement("div", { className: "dsh-fu-field" },
            react.createElement("label", { htmlFor: "fu-prefix", className: "dsh-fu-label" },
              "路径前缀（插入输入框时加在路径前；留空 = 无前缀）"),
            react.createElement("input", {
              id: "fu-prefix",
              type: "text",
              className: "dsh-fu-input",
              value: prefix,
              onChange: (e) => setPrefix(e.target.value),
              spellCheck: false,
              placeholder: "[上传文件]",
            })
          )
        ),

        // ── 上传行为 ──
        react.createElement("div", { className: "dsh-fu-caption" }, "上传行为"),
        react.createElement("div", { className: "dsh-fu-group" },
          toggleRow("fu-official", "图片走官方附件", "发送后自动 file_id 复用", wantOfficial, setWantOfficial),
          toggleRow("fu-keep", "留档图片到附件目录", "方便本地找图；关闭则只走官方附件，更省空间", wantKeep, setWantKeep),
          toggleRow("fu-public", "允许公网上传", "关闭时仅本机 localhost；开启后放行任意来源，供公网/内网穿透域名访问", allowPublic, setAllowPublic)
        ),

        // ── 状态 ──
        react.createElement("div", { className: "dsh-fu-status" },
          react.createElement("span", {
            className: "dsh-fu-dot" + (maxBytes !== null && maxBytes >= 64 * 1024 * 1024 ? " ok" : ""),
          }),
          react.createElement("span", null, "图片来源上限：" + limitText)
        ),

        react.createElement("div", { className: "dsh-fu-footer" },
          react.createElement("button", {
            type: "button",
            onClick: save,
            disabled: saving,
            className: "dsh-fu-save" + (saved ? " is-saved" : ""),
          }, saved ? react.createElement(CheckIcon) : null, saving ? "保存中…" : (saved ? "已保存" : "保存")),
          msg !== null && react.createElement("span", {
            className: "dsh-fu-msg " + (msg.kind === "ok" ? "ok" : "err"),
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
      // 读当前草稿：用 owner prop `input`（InputState 同步快照，随输入变化
      // 重渲染）。不要用 useInput()——它是真 React hook，无会话时会变
      // undefined，条件调用违反 hook 规则会导致组件崩溃（实测按钮消失）。
      const inputState = props.input;
      const currentDraft =
        inputState !== undefined && inputState !== null && typeof inputState.draft === "string"
          ? inputState.draft
          : "";

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
            const lines = paths.map((p) => (prefix !== "" ? `${prefix} ${p}` : p));
            const next = currentDraft === "" ? lines.join("\n") : currentDraft + "\n" + lines.join("\n");
            if (inputActions !== undefined) {
              inputActions.setDraft(next);
            } else {
              showNotice("路径：" + paths.join(" "));
            }
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
      }, [sessionId, inputActions, currentDraft]);

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
            const lines = paths.map((p) => (prefix !== "" ? `${prefix} ${p}` : p));
            const next = currentDraft === "" ? lines.join("\n") : currentDraft + "\n" + lines.join("\n");
            if (inputActions !== undefined) {
              inputActions.setDraft(next);
            } else {
              showNotice("路径：" + paths.join(" "));
            }
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
      }, [sessionId, inputActions, currentDraft]);

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
