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

    /** 官方附件服务（createDraftImages 为官方未公开实例方法） */
    let officialConversation = null;
    /** apply 时保存的 client ctx，供懒获取 conversation（0.1.2 起注册晚于插件 apply） */
    let clientCtx = null;

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
      try {
        officialConversation = ctx.get("conversation") ?? null;
      } catch (error) {
        officialConversation = null;
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
        () => react.createElement(SettingsCard)
      ));
    }

    // ── 设置卡片：附件目录 + 图片走官方附件 + 留档开关 + 粘贴档位 + 上限状态 ──
    function SettingsCard() {
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
        react.createElement("h3", { style: { margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "文件上传"),
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
      // 读当前草稿：用 owner prop `input`（InputState 同步快照，随输入变化
      // 重渲染）。不要用 useInput()——它是真 React hook，无会话时会变
      // undefined，条件调用违反 hook 规则会导致组件崩溃（实测按钮消失）。
      const inputState = props.input;
      const currentDraft =
        inputState !== undefined && inputState !== null && typeof inputState.draft === "string"
          ? inputState.draft
          : "";
      // 草稿最新值 ref（2026-08-25 修复粘贴接管丢文本）：handleFiles/handleFolders
      // 是 async 回调，闭包里的 currentDraft 冻结在创建时；若等待期间有新的
      // 草稿写入（如粘贴拦截时透传的剪贴板文本），按旧闭包 setDraft 会覆盖它。
      // ref 每次渲染更新，回调执行时读到的是执行瞬间的最新草稿。
      const draftRef = react.useRef(currentDraft);
      draftRef.current = currentDraft;

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
            const base = draftRef.current || "";
            const next = base === "" ? lines.join("\n") : base + "\n" + lines.join("\n");
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
            const lines = paths.map((p) => (prefix !== "" ? `${prefix} ${p}` : p));
            const base = draftRef.current || "";
            const next = base === "" ? lines.join("\n") : base + "\n" + lines.join("\n");
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
          // 只上传文件，文本会丢——这里补上。官方插入是光标处，可用 API 只有
          // setDraft 全量替换，按末尾追加（光标在末尾时与官方完全一致；中间
          // 时内容不丢，位置略偏）。draftRef 保证与 handleFiles 的路径文本
          // 合并时读的是最新草稿，互相不覆盖。
          const text = e.clipboardData.getData("text/plain");
          if (text !== "" && inputActions !== undefined) {
            inputActions.setDraft((draftRef.current || "") + text);
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
