const { Plugin } = require("obsidian");

function selectLineByLineNumber(editor, line) {
    const text = editor.getLine(line);
    editor.setSelection(
        { line: line, ch: 0 },
        { line: line, ch: text.length }
    );
}

function selectLinesByIndex(editor, fromLine, toLine) {
    const start = Math.min(fromLine, toLine);
    const end = Math.max(fromLine, toLine);
    const startText = editor.getLine(start);
    const endText = editor.getLine(end);
    editor.setSelection(
        { line: start, ch: 0 },
        { line: end, ch: endText.length }
    );
}

function getAllMarkdownViews(app) {
    return app.workspace.getLeavesOfType("markdown")
        .map(leaf => leaf.view)
        .filter(view => view && view.editor);
}

class cdrxGutterPlugin extends Plugin {
    disposers = [];

    onload() {
        this.app.workspace.onLayoutReady(() => this.attachAll());
        this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.attachAll()));
        this.registerEvent(this.app.workspace.on("editor-change", () => this.attachAll()));
    }

    onunload() {
        this.detachAll();
    }

    attachAll() {
        this.detachAll();
        for (const view of getAllMarkdownViews(this.app)) {
            this.attachToView(view);
        }
    }

    detachAll() {
        for (const fn of this.disposers) try { fn(); } catch {}
        this.disposers = [];
    }

    attachToView(view) {
        const editor = view.editor;
        const cmView = editor.cm; // CodeMirror EditorView
        const cmEditorEl = view.containerEl.querySelector(".cm-editor");
        if (!cmEditorEl || !cmView) return;

        const cmScroller = cmEditorEl.querySelector('.cm-scroller');
        if (!cmScroller) return;

        let startLine = null;
        let isDragging = false;

        const onMouseDown = (ev) => {
            if (ev.button !== 0) return; // Only left-click
            const cmContent = cmView.contentDOM;
            const cmContentRect = cmContent.getBoundingClientRect();
            if (ev.clientX >= cmContentRect.left) return; // Not in gutter area
            const target = ev.target;
            if (target.closest('.cm-foldGutter, .cm-foldPlaceholder, .cm-foldMarker')) return;

            const pos = cmView.posAtCoords({ x: ev.clientX, y: ev.clientY });
            if (pos == null) return;
            const lineObj = cmView.state.doc.lineAt(pos);
            startLine = lineObj.number - 1; // 0-based
            selectLineByLineNumber(editor, startLine);
            editor.focus();

            isDragging = false;

            const onMouseMove = (moveEv) => {
                if (!isDragging) {
                    isDragging = true;
                }
                let currentLine = startLine;
                const movePos = cmView.posAtCoords({ x: moveEv.clientX, y: moveEv.clientY });
                if (movePos != null) {
                    const lineObj = cmView.state.doc.lineAt(movePos);
                    currentLine = lineObj.number - 1;
                } else {
                    const editorRect = cmEditorEl.getBoundingClientRect();
                    if (moveEv.clientY < editorRect.top) {
                        currentLine = 0;
                    } else if (moveEv.clientY > editorRect.bottom) {
                        currentLine = cmView.state.doc.lines - 1;
                    }
                }
                selectLinesByIndex(editor, startLine, currentLine);
            };

            const onMouseUp = (upEv) => {
                isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                upEv.preventDefault();
                upEv.stopPropagation();
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            // Prevent click event from clearing the selection
            const onClick = (clickEv) => {
                clickEv.preventDefault();
                clickEv.stopPropagation();
                document.removeEventListener('click', onClick, true);
            };
            document.addEventListener('click', onClick, true);

            ev.preventDefault();
            ev.stopPropagation();
        };

        cmScroller.addEventListener('mousedown', onMouseDown, true);

        this.disposers.push(() => {
            cmScroller.removeEventListener('mousedown', onMouseDown, true);
        });
    }
}

module.exports = cdrxGutterPlugin;