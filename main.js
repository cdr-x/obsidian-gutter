const { Plugin } = require("obsidian");

// === FEATURE TOGGLES (NEW) ===
// If true, selecting a whole line by clicking in the gutter only works if Shift is held
const SELECTION_WITH_SHIFT_ENABLED = true; // Toggle this as desired

// If true, dragging always selects multiple lines; if false, dragging never selects (never expands selection) but only places cursors.
const MULTI_LINE_SELECTION_DRAG_ENABLED = true; // Toggle this as desired

// --- Original utility functions ---
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

/**
 * Given a screen X, determine whether it's in the
 * left gutter, right gutter, or content area.
 * Returns "left-gutter", "right-gutter", or null.
 * The gutterWidth is estimated as 32px for CM6, adjust if needed.
 */
function getGutterArea(cmView, cmEditorEl, evt) {
    const contentDOM = cmView.contentDOM;
    const contentRect = contentDOM.getBoundingClientRect();
    const editorRect = cmEditorEl.getBoundingClientRect();
    const gutterWidth = 32; // px, typical for Obsidian/CodeMirror 6
    if (evt.clientX < contentRect.left && evt.clientX > editorRect.left) {
        return "left-gutter";
    } else if (evt.clientX > contentRect.right && evt.clientX < editorRect.right) {
        return "right-gutter";
    }
    return null;
}

/**
 * Computes line numbers between two indices (inclusive).
 */
function getLineRange(a, b) {
    const range = [];
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    for (let i = start; i <= end; i++) range.push(i);
    return range;
}

// ---- MAIN PLUGIN CLASS ----
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
        let mouseMovedSinceDown = false;

        // -------- MOUSE DOWN HANDLER --------
        const onMouseDown = (ev) => {
            // Only left-click
            if (ev.button !== 0) return;

            const cmContent = cmView.contentDOM;
            const cmContentRect = cmContent.getBoundingClientRect();

            // Ignore if click is inside content area (i.e., not a gutter)
            if (ev.clientX >= cmContentRect.left && ev.clientX <= cmContentRect.right) return;

            // Ignore folding/fold marker
            const target = ev.target;
            if (target.closest('.cm-foldGutter, .cm-foldPlaceholder, .cm-foldMarker')) return;

            const gutterArea = getGutterArea(cmView, cmEditorEl, ev);

            // -- ALT + GUTTER: MULTI-CURSOR ---
            if (ev.altKey && (gutterArea === "left-gutter" || gutterArea === "right-gutter")) {
                const pos = cmView.posAtCoords({ x: ev.clientX, y: ev.clientY });
                if (pos == null) return;
                const lineObj = cmView.state.doc.lineAt(pos);
                startLine = lineObj.number - 1; // 0-based

                let dragEndLine = startLine;

                // Helper: build selection ranges for all lines in selection.
                function setMultipleCursors(start, end) {
                    const lines = getLineRange(start, end);
                    // Prepare range array
                    let ranges = [];

                    for (let line of lines) {
                        let ch = 0;
                        if (gutterArea === "right-gutter") {
                            ch = editor.getLine(line).length;
                        }
                        ranges.push({ anchor: { line, ch }, head: { line, ch } });
                    }

                    if (typeof editor.setSelections === "function") {
                        // CodeMirror 6
                        editor.setSelections(ranges);
                    } else {
                        // CodeMirror 5 fallback
                        editor.setSelections(ranges.map(r => r.anchor));
                    }
                }

                setMultipleCursors(startLine, dragEndLine);
                editor.focus();

                isDragging = false;
                mouseMovedSinceDown = false;

                // drag handler for multi-cursor
                const onMouseMove = (moveEv) => {
                    if (!isDragging) isDragging = true;
                    mouseMovedSinceDown = true;
                    let movePos = cmView.posAtCoords({ x: moveEv.clientX, y: moveEv.clientY });
                    let currentLine = startLine;
                    if (movePos != null) {
                        currentLine = cmView.state.doc.lineAt(movePos).number - 1;
                    } else {
                        const editorRect = cmEditorEl.getBoundingClientRect();
                        if (moveEv.clientY < editorRect.top) {
                            currentLine = 0;
                        } else if (moveEv.clientY > editorRect.bottom) {
                            currentLine = cmView.state.doc.lines - 1;
                        }
                    }
                    setMultipleCursors(startLine, currentLine);
                    dragEndLine = currentLine;
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

                // Prevent accidental text selection on drag
                const onClick = (clickEv) => {
                    clickEv.preventDefault();
                    clickEv.stopPropagation();
                    document.removeEventListener('click', onClick, true);
                };
                document.addEventListener('click', onClick, true);

                ev.preventDefault();
                ev.stopPropagation();
                return;
            }

            // --- MAIN BEHAVIOR CODE ---

            // Determine modifier logic for line selection and for "place-cursor" feature
            // All below blocks rely on below booleans
            const shiftHeld = ev.shiftKey;
            let enableLineSelectionLogic = false;
            let enableCursorPlacementLogic = false;

            if (SELECTION_WITH_SHIFT_ENABLED) {
                // Gutter click can only select whole line(s) if shift is DOWN
                enableLineSelectionLogic = shiftHeld;
                enableCursorPlacementLogic = !shiftHeld; // i.e., user did not hold shift
            } else {
                // Gutter click can only select whole line(s) if shift is UP
                enableLineSelectionLogic = !shiftHeld;
                enableCursorPlacementLogic = shiftHeld; // i.e., user did hold shift
            }

            // ======== LEFT GUTTER BEHAVIOR ========
            if (gutterArea === "left-gutter") {
                const pos = cmView.posAtCoords({ x: ev.clientX, y: ev.clientY });
                if (pos == null) return;
                const lineObj = cmView.state.doc.lineAt(pos);
                startLine = lineObj.number - 1; // 0-based

                mouseMovedSinceDown = false;
                isDragging = false;

                // --- Line selection logic for left gutter (shift must be down/up per setting + multi-line support) ---
                if (enableLineSelectionLogic) {
                    // Select a line or lines (optionally Multi-line-select on drag, depending on toggle)
                    selectLineByLineNumber(editor, startLine);
                    editor.focus();

                    let dragEndLine = startLine;
                    let dragSelectionActive = false;

                    const onMouseMove = (moveEv) => {
                        mouseMovedSinceDown = true;
                        if (!dragSelectionActive) dragSelectionActive = true;

                        if (!MULTI_LINE_SELECTION_DRAG_ENABLED) return; // skip multi-line selection if not enabled

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
                        dragEndLine = currentLine;
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
                    return;
                }

                // --- Single-click logic: place a cursor at the beginning of the line ---
                // *only if selection logic is NOT enabled, cursor placement logic IS enabled, and this is a click, not a drag*
                // (MouseUp handler confirms this)
                if (enableCursorPlacementLogic) {
                    let clickHandled = false;

                    const onMouseUp = (upEv) => {
                        document.removeEventListener('mouseup', onMouseUp);
                        if (mouseMovedSinceDown) return; // Was a drag, not a click

                        // Only place cursor if mouse did not move between down and up, i.e., single click.
                        if (!clickHandled) {
                            // Place the cursor at line start
                            editor.setCursor({ line: startLine, ch: 0 });
                            editor.focus();
                            clickHandled = true;

                            upEv.preventDefault();
                            upEv.stopPropagation();
                        }
                    };

                    document.addEventListener('mouseup', onMouseUp);

                    // Prevent accidental clearing of cursor by mousedown default action
                    const onClick = (clickEv) => {
                        clickEv.preventDefault();
                        clickEv.stopPropagation();
                        document.removeEventListener('click', onClick, true);
                    };
                    document.addEventListener('click', onClick, true);

                    ev.preventDefault();
                    ev.stopPropagation();
                    return;
                }
            }

            // ======== RIGHT GUTTER BEHAVIOR ========
            if (gutterArea === "right-gutter") {
                const pos = cmView.posAtCoords({ x: ev.clientX, y: ev.clientY });
                if (pos == null) return;
                const lineObj = cmView.state.doc.lineAt(pos);
                startLine = lineObj.number - 1; // 0-based

                mouseMovedSinceDown = false;
                isDragging = false;

                // --- Multi-line selection logic for right gutter (shift must be down/up per setting) ---
                if (enableLineSelectionLogic) {
                    // Select a line or lines (optionally Multi-line-select on drag, depending on toggle)
                    // Place cursor at end of line
                    let endCh = editor.getLine(startLine).length;
                    editor.setSelection({ line: startLine, ch: endCh }, { line: startLine, ch: endCh });
                    editor.focus();

                    let dragEndLine = startLine;
                    let dragSelectionActive = false;

                    const onMouseMove = (moveEv) => {
                        mouseMovedSinceDown = true;
                        if (!dragSelectionActive) dragSelectionActive = true;

                        if (!MULTI_LINE_SELECTION_DRAG_ENABLED) return; // skip multi-line selection if not enabled

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
                        // Place selection from startLine to currentLine, both at line ends
                        const startEnd = editor.getLine(startLine).length;
                        const currentEnd = editor.getLine(currentLine).length;
                        editor.setSelection(
                            { line: startLine, ch: startEnd },
                            { line: currentLine, ch: currentEnd }
                        );
                        dragEndLine = currentLine;
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
                    return;
                }

                // --- Single-click logic: place a cursor at the end of the line ---
                // *only if selection logic is NOT enabled, cursor placement logic IS enabled, and this is a click, not a drag*
                if (enableCursorPlacementLogic) {
                    let clickHandled = false;

                    const onMouseUp = (upEv) => {
                        document.removeEventListener('mouseup', onMouseUp);
                        if (mouseMovedSinceDown) return;
                        if (!clickHandled) {
                            // Place the cursor at line end
                            editor.setCursor({ line: startLine, ch: editor.getLine(startLine).length });
                            editor.focus();
                            clickHandled = true;

                            upEv.preventDefault();
                            upEv.stopPropagation();
                        }
                    };

                    document.addEventListener('mouseup', onMouseUp);

                    // Prevent accidental clearing of cursor by mousedown default action
                    const onClick = (clickEv) => {
                        clickEv.preventDefault();
                        clickEv.stopPropagation();
                        document.removeEventListener('click', onClick, true);
                    };
                    document.addEventListener('click', onClick, true);

                    ev.preventDefault();
                    ev.stopPropagation();
                    return;
                }
            }

            // --- Standard right-gutter click (Alt not held, and no other case above triggered) -- just let event pass through as normal

        };

        // We need to listen to mousemove on drag, to distinguish real dragging from just clicking
        cmScroller.addEventListener('mousedown', onMouseDown, true);

        this.disposers.push(() => {
            cmScroller.removeEventListener('mousedown', onMouseDown, true);
        });
    }
}

module.exports = cdrxGutterPlugin;