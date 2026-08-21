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
     *    - 图片（PNG/JPEG/WebP/GIF）且「走官方附件」开 + 模型支持 + 不超宿主上限
     *      → host 留档附件目录（按天分文件夹）+ 官方草稿附件条（发送后自动
     *      file_id、同图复用）——不写路径文本。
     *    - 图片但模型不支持/超上限/官方通道异常 → 留档附件目录 + 路径文本。
     *    - 其他文件 → 项目 uploads/ + `[上传文件] 路径`（原逻辑，一字不改）。
     * 4. 设置卡片：附件目录路径 + 图片走官方附件开关 + 留档开关 + 上限状态。
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
        // 设置卡保存按钮（统一按钮样板：透明底 + l2 边框 + hover 灰底 + 成功变绿）
        ".dsh-fu-save{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:transparent;color:var(--dsw-alias-label-primary,#333);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;}",
        ".dsh-fu-save:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".dsh-fu-save:disabled{opacity:.5;cursor:default;}",
        ".dsh-fu-save.is-saved{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}",
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
        { name: "settings.plugin.item", key: "file-upload" },
        () => react.createElement(SettingsCard)
      ));
    }

    // ── 设置卡片：附件目录 + 图片走官方附件 + 留档开关 + 上限状态 ──
    function SettingsCard() {
      const [dir, setDir] = react.useState("");
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
          body: JSON.stringify({ attachmentDir: dir.trim(), imageViaOfficial: wantOfficial, keepImageArchive: wantKeep }),
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
      const limitText = maxBytes === null
        ? "未知"
        : maxBytes >= 64 * 1024 * 1024
          ? "64 MiB ✅（大图可拖入）"
          : `${Math.round(maxBytes / 1024 / 1024)} MiB（如需大图见 README 配置说明，改后需重启）`;
      return react.createElement("div", { style: { padding: "8px 0", fontSize: 13 } },
        react.createElement("h3", { style: { margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "文件上传"),
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginBottom: 8, lineHeight: "18px" } },
          "图片留档到附件目录（按天分文件夹）并走官方附件（自动复用 file_id）；其他文件存项目 uploads/ 并写入路径文本。"),

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

          const paths = [];       // 需写入草稿的路径文本
          let officialCount = 0;  // 进入官方附件条的图片数
          const errors = [];
          for (const file of files) {
            if (!IMAGE_MIME.has(file.type)) {
              // 其他文件（含非白名单图片格式）：原逻辑（项目 uploads/ + 路径文本）
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
            // 模型不支持 / 超宿主上限（≤64 MiB）→ 留档附件目录 + 路径文本；
            // 开关关 → 老逻辑（项目 uploads/ + 路径文本）
            const mode = viaOfficialSwitch ? "image" : "file";
            const r = await saveOne(file, mode, sessionId);
            if (r.ok) paths.push(r.path);
            else errors.push(r.error);
          }

          if (paths.length > 0) {
            const lines = paths.map((p) => `[上传文件] ${p}`);
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
      }, [handleFiles]);

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
