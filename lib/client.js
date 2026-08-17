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
     * 1. 输入框工具行左侧加「📎 上传」按钮（与默认 "+" 命令按钮图标区分）。
     * 2. 点击弹系统文件选择器（可多选）；页面任意位置拖入文件也接管（捕获
     *    阶段监听，先于官方 InputBar 的 document 冒泡监听，绕过其"不支持
     *    图片"拦截）。
     * 3. 文件经 host 路由 /api/file-upload/save 保存到当前项目 uploads/，
     *    返回绝对路径；路径文本 `[上传文件] <绝对路径>` 插入输入框草稿，
     *    由用户自己按发送。
     */
    const inject = ["slots"];

    /** 前端单文件上限（与 host 端 30MB 保持合理差距） */
    const MAX_FILE_BYTES = 25 * 1024 * 1024;

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;

      slots.inject("conversation.input.left", () => slots.register(
        { name: "conversation.input.left", id: "file-upload" },
        (props) => {
          const { sessionId, inputActions } = props;
          const [busy, setBusy] = react.useState(false);
          const [notice, setNotice] = react.useState(null);
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

          // 单个文件：readAsDataURL 取 base64 → host 保存 → 返回结果
          function saveOne(file) {
            return new Promise((resolve) => {
              if (file.size > MAX_FILE_BYTES) {
                resolve({ ok: false, error: `「${file.name}」超过 25MB，已跳过` });
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
                  body: JSON.stringify({ sessionId, name: file.name, base64 }),
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

          const handleFiles = react.useCallback((fileList) => {
            const files = Array.from(fileList || []);
            if (files.length === 0 || busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            setNotice(null);
            Promise.all(files.map(saveOne)).then((results) => {
              busyRef.current = false;
              setBusy(false);
              const paths = results.filter((r) => r.ok).map((r) => r.path);
              const errors = results.filter((r) => !r.ok).map((r) => r.error);
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
              if (paths.length > 0) parts.push(`已添加 ${paths.length} 个文件到输入框`);
              if (errors.length > 0) parts.push(errors.join("；"));
              if (parts.length > 0) showNotice(parts.join("；"));
            });
          }, [sessionId, inputActions, currentDraft]);

          // 页面级拖拽接管：捕获阶段先于官方冒泡监听执行，preventDefault +
          // stopPropagation 后官方 InputBar 不再处理。dragenter 也要拦——
          // 否则官方"毛玻璃拖放遮罩"会显示，且因 drop 被我们接管而永不复位。
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

          const label = busy ? "上传中…" : notice !== null ? notice : "📎 上传";
          return react.createElement(
            "button",
            {
              type: "button",
              onClick: () => { if (inputRef.current !== null) inputRef.current.click(); },
              disabled: busy,
              title: "上传文件到当前项目（也可直接把文件拖进窗口）",
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                border: "none",
                borderRadius: "999px",
                cursor: "pointer",
                padding: "2px 10px",
                fontSize: "13px",
                lineHeight: "20px",
                fontWeight: 500,
                background: "transparent",
                color: notice !== null
                  ? "var(--dsw-alias-state-error-primary, #d03050)"
                  : "var(--dsw-alias-text-secondary, #666)",
                opacity: busy ? 0.6 : 1,
              },
            },
            label,
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
      ));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
