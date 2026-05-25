/* ═══════════════════════════════════════════════════════
   AI Paper Reader v3.6
   Fixed: text selection accuracy, pinch zoom, scroll preservation
   ═══════════════════════════════════════════════════════ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

marked.setOptions({ breaks: true, gfm: true });

const state = {
    layout: 'horizontal',
    wordCards: [],
    activeWord: null,
    isResizing: false,
    streaming: { main: false, explainer: false },
    projects: [],
    activeProjectId: '',
    activeProject: null,
    pdfMode: 'pdf',
    pdfDoc: null,
    pdfPages: [],
    pdfScale: 1.5,
    dictionaryOn: true,
    panelStates: { 'panel-pdf': true, 'panel-main': true, 'panel-explainer': true },
    // Scroll preservation
    pdfScrollTop: 0,
    pdfScrollLeft: 0,
    // Pinch debounce
    pinchTimer: null,
    isPinching: false,
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
    await loadSettings();
    await loadProjects();
    await loadWordCards();
    setupEventListeners();
    setupDividers();
    setupDragDrop();
    setupContextMenu();
    setupTextSelectionHandling();
}
document.addEventListener('DOMContentLoaded', init);

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const d = await res.json();
        if (d.layout) { state.layout = d.layout; updateLayoutUI(); }
        if (d.main_model) $('#main-model-select').value = d.main_model;
        if (d.explainer_model) $('#explainer-model-select').value = d.explainer_model;
        if (d.sync_mode) $('#sync-mode-select').value = d.sync_mode;
        updateModelBadges();
    } catch(e) { console.error('Settings:', e); }
}

async function saveSettings() {
    const s = $('#settings-status');
    s.textContent = '⏳ Saving...'; s.className = '';
    try {
        const res = await fetch('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: $('#api-key-input').value.trim() || undefined,
                main_model: $('#main-model-select').value,
                explainer_model: $('#explainer-model-select').value,
                sync_mode: $('#sync-mode-select').value,
                layout: state.layout,
            }),
        });
        const d = await res.json();
        s.textContent = d.api_key_set ? '✅ Saved!' : '⚠️ Saved (no API key)';
        s.className = d.api_key_set ? 'success' : 'error';
        updateModelBadges();
        setTimeout(() => { s.textContent = ''; s.className = ''; }, 3000);
    } catch(e) { s.textContent = '❌ Failed'; s.className = 'error'; }
}

function updateModelBadges() {
    const mm = $('#main-model-select').value;
    const em = $('#explainer-model-select').value;
    const mb = $('#main-model-badge');
    const eb = $('#explainer-model-badge');
    mb.textContent = mm === 'deepseek-reasoner' ? 'R1' : 'V3';
    eb.textContent = em === 'deepseek-reasoner' ? 'R1' : 'V3';
    mb.style.background = mm === 'deepseek-reasoner' ? 'var(--accent-mauve)' : 'var(--accent-blue)';
    eb.style.background = em === 'deepseek-reasoner' ? 'var(--accent-mauve)' : 'var(--accent-green)';
}

function updateLayoutUI() {
    $('#main-container').className = `layout-${state.layout}`;
    $$('.divider').forEach(d => {
        d.className = state.layout === 'horizontal' ? 'divider divider-vertical' : 'divider divider-horizontal';
    });
    $('#btn-layout').textContent = state.layout === 'horizontal' ? '↕️' : '↔️';
}

// ═══════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════
async function loadProjects() {
    try {
        const res = await fetch('/api/projects');
        const d = await res.json();
        state.projects = d.projects || [];
        state.activeProjectId = d.active_id || '';
        renderProjectSelector();
        if (state.activeProjectId) await loadActiveProject();
    } catch(e) { console.error('Projects:', e); }
}

function renderProjectSelector() {
    const sel = $('#project-select');
    sel.innerHTML = state.projects.map(p =>
        `<option value="${p.id}" ${p.id === state.activeProjectId ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');
    if (state.projects.length === 0) {
        sel.innerHTML = '<option value="">No PDF loaded</option>';
    }
}

async function switchProject(pid) {
    if (!pid || pid === state.activeProjectId) return;
    try {
        await fetch(`/api/projects/${pid}/activate`, { method: 'POST' });
        state.activeProjectId = pid;
        renderProjectSelector();
        await loadActiveProject();
    } catch(e) { showToast('Failed to switch', 'error'); }
}

async function deleteProject() {
    if (state.projects.length <= 1) { showToast("Can't delete last project", 'error'); return; }
    const name = state.projects.find(p => p.id === state.activeProjectId)?.name || 'this';
    if (!confirm(`Delete "${name}"? This removes the PDF and all chat history.`)) return;
    try {
        await fetch(`/api/projects/${state.activeProjectId}`, { method: 'DELETE' });
        state.projects = state.projects.filter(p => p.id !== state.activeProjectId);
        state.activeProjectId = state.projects[0]?.id || '';
        if (state.activeProjectId) await fetch(`/api/projects/${state.activeProjectId}/activate`, { method: 'POST' });
        renderProjectSelector();
        await loadActiveProject();
        showToast('Deleted', 'success');
    } catch(e) { showToast('Failed', 'error'); }
}

async function loadActiveProject() {
    if (!state.activeProjectId) { clearAll(); return; }
    try {
        const res = await fetch(`/api/projects/${state.activeProjectId}`);
        state.activeProject = await res.json();
        renderChatHistory();
        renderPDFContent();
        updatePDFTitle();
    } catch(e) { console.error('Load project:', e); }
}

function updatePDFTitle() {
    if (state.activeProject) {
        $('#pdf-title').textContent = state.activeProject.pdf_filename || state.activeProject.name || 'Document';
    }
}

function clearAll() {
    $('#messages-main').innerHTML = '<div class="empty-state"><p>🤖 Main AI</p><p class="sub">Upload a PDF to start</p></div>';
    $('#messages-explainer').innerHTML = '<div class="empty-state"><p>🔍 Explainer AI</p><p class="sub">Upload a PDF to start</p></div>';
    $('#pdf-viewer').classList.remove('hidden');
    $('#read-mode').classList.add('hidden');
    $('#pdf-empty').classList.remove('hidden');
    $('#pdf-canvas-container').innerHTML = '';
    $('#read-mode-content').innerHTML = '';
    $('#pdf-title').textContent = 'No document';
    $('#page-indicator').textContent = '';
    $('#zoom-level').textContent = '100%';
    state.pdfDoc = null;
    state.pdfPages = [];
    state.pdfScale = 1.5;
    state.pdfScrollTop = 0;
    state.pdfScrollLeft = 0;
}

// ═══════════════════════════════════════════════════════
// PDF RENDERING (NO CSS TRANSFORM — text layer stays aligned)
// ═══════════════════════════════════════════════════════
function savePDFScroll() {
    const viewer = $('#pdf-viewer');
    if (viewer) {
        state.pdfScrollTop = viewer.scrollTop;
        state.pdfScrollLeft = viewer.scrollLeft;
    }
}

function restorePDFScroll() {
    const viewer = $('#pdf-viewer');
    if (viewer) {
        requestAnimationFrame(() => {
            viewer.scrollTop = state.pdfScrollTop;
            viewer.scrollLeft = state.pdfScrollLeft;
        });
    }
}

function renderPDFContent() {
    if (!state.activeProject || !state.activeProject.pdf_filename) {
        $('#pdf-viewer').classList.add('hidden');
        $('#read-mode').classList.add('hidden');
        $('#pdf-empty').classList.remove('hidden');
        return;
    }
    $('#pdf-empty').classList.add('hidden');
    updatePDFTitle();
    if (state.pdfMode === 'pdf') renderPDFView();
    else renderReadMode();
}

async function renderPDFView() {
    savePDFScroll(); // Remember scroll position

    $('#pdf-viewer').classList.remove('hidden');
    $('#read-mode').classList.add('hidden');
    const container = $('#pdf-canvas-container');
    container.innerHTML = '<div class="empty-state"><p>⏳ Rendering PDF...</p></div>';

    const filename = state.activeProject.pdf_filename;
    const url = `/api/pdf-file/${encodeURIComponent(filename)}`;

    try {
        const loadingTask = pdfjsLib.getDocument(url);
        state.pdfDoc = await loadingTask.promise;
        container.innerHTML = '';
        state.pdfPages = [];

        for (let i = 1; i <= state.pdfDoc.numPages; i++) {
            const page = await state.pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: state.pdfScale });

            const wrapper = document.createElement('div');
            wrapper.className = 'pdf-page-wrapper';
            wrapper.style.width = viewport.width + 'px';
            wrapper.style.height = viewport.height + 'px';
            wrapper.dataset.page = i;

            // Canvas
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = viewport.width + 'px';
            canvas.style.height = viewport.height + 'px';
            wrapper.appendChild(canvas);

            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            // Text layer — rendered at EXACT viewport scale, no CSS transform
            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'pdf-text-layer';
            textLayerDiv.style.width = viewport.width + 'px';
            textLayerDiv.style.height = viewport.height + 'px';
            textLayerDiv.dataset.page = i;
            wrapper.appendChild(textLayerDiv);

            const textContent = await page.getTextContent();
            const textLayer = pdfjsLib.renderTextLayer({
                textContentSource: textContent,
                container: textLayerDiv,
                viewport: viewport,
                textDivs: [],
            });
            await textLayer.promise;

            container.appendChild(wrapper);
            state.pdfPages.push({ page, viewport, wrapper, textLayerDiv, textContent });
        }

        $('#page-indicator').textContent = `1/${state.pdfDoc.numPages}`;
        updateZoomLabel();
        restorePDFScroll(); // Restore scroll position after render
    } catch(e) {
        console.error('PDF render:', e);
        container.innerHTML = `<div class="empty-state"><p>❌ Failed to render PDF</p><p class="sub">${escHtml(e.message)}</p></div>`;
    }
}

async function renderReadMode() {
    $('#pdf-viewer').classList.add('hidden');
    $('#read-mode').classList.remove('hidden');

    try {
        const res = await fetch(`/api/pdf-context/${state.activeProjectId}`);
        const d = await res.json();
        const text = d.exists ? d.text : 'No text available.';
        const lines = text.split('\n');
        let html = '';
        let inPara = false;

        for (const line of lines) {
            if (line.match(/^\[Page \d+\]$/)) {
                if (inPara) { html += '</div>'; inPara = false; }
                html += `<span class="page-marker">${escHtml(line)}</span>`;
                continue;
            }
            if (line.trim() === '') {
                if (inPara) { html += '</div>'; inPara = false; }
                continue;
            }
            if (!inPara) { html += '<div class="pdf-paragraph">'; inPara = true; }
            else { html += ' '; }

            const tokens = tokenize(line);
            html += tokens.map(t => {
                if (t.type === 'word') return `<span class="clickable-word" data-word="${escHtml(t.value)}">${escHtml(t.value)}</span>`;
                return escHtml(t.value);
            }).join('');
        }
        if (inPara) html += '</div>';

        $('#read-mode-content').innerHTML = html;

        $('#read-mode-content').querySelectorAll('.clickable-word').forEach(el => {
            el.addEventListener('contextmenu', (e) => handleReadModeContextMenu(e, el));
        });
    } catch(e) {
        $('#read-mode-content').innerHTML = '<div class="empty-state"><p>❌ Failed to load text</p></div>';
    }
}

// ═══════════════════════════════════════════════════════
// PDF ZOOM — No CSS transform, always re-render at real scale
// ═══════════════════════════════════════════════════════
function zoomIn() {
    state.pdfScale = Math.min(4.0, state.pdfScale + 0.25);
    state.pdfScale = Math.round(state.pdfScale * 100) / 100;
    if (state.pdfDoc && state.pdfMode === 'pdf') renderPDFView();
}

function zoomOut() {
    state.pdfScale = Math.max(0.5, state.pdfScale - 0.25);
    state.pdfScale = Math.round(state.pdfScale * 100) / 100;
    if (state.pdfDoc && state.pdfMode === 'pdf') renderPDFView();
}

function zoomFit() {
    const panel = $('#pdf-content');
    const width = panel.clientWidth - 40;
    if (state.pdfDoc && state.pdfPages.length > 0) {
        state.pdfScale = width / state.pdfPages[0].viewport.width;
        state.pdfScale = Math.round(state.pdfScale * 100) / 100;
    } else {
        state.pdfScale = 1.5;
    }
    if (state.pdfDoc && state.pdfMode === 'pdf') renderPDFView();
}

function updateZoomLabel() {
    $('#zoom-level').textContent = Math.round(state.pdfScale * 100) + '%';
}

function togglePDFMode() {
    state.pdfMode = state.pdfMode === 'pdf' ? 'read' : 'pdf';
    $('#btn-pdf-mode').textContent = state.pdfMode === 'pdf' ? '👁️ Read Mode' : '📄 PDF View';
    renderPDFContent();
}

function toggleDictionary() {
    state.dictionaryOn = !state.dictionaryOn;
    const btn = $('#btn-dictionary');
    if (state.dictionaryOn) {
        btn.textContent = '🃏 Dict ON';
        btn.classList.add('active');
    } else {
        btn.textContent = '🃏 Dict OFF';
        btn.classList.remove('active');
    }
}

// ═══════════════════════════════════════════════════════
// TEXT SELECTION + FLOATING EXPLAIN BUTTON
// ═══════════════════════════════════════════════════════
function setupTextSelectionHandling() {
    const explainBtn = document.createElement('button');
    explainBtn.id = 'selection-explain-btn';
    explainBtn.innerHTML = '💡 Explain';
    document.body.appendChild(explainBtn);

    explainBtn.addEventListener('click', async () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        const word = sel.toString().trim();

        const range = sel.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const parentEl = container.nodeType === 3 ? container.parentElement : container;
        const contextText = parentEl ? parentEl.textContent || '' : '';
        const wordIdx = contextText.indexOf(word);
        const start = Math.max(0, wordIdx - 60);
        const end = Math.min(contextText.length, wordIdx + word.length + 60);
        const contextSentence = contextText.substring(start, end).trim();

        state.activeWord = { word, contextSentence, source: 'pdf' };
        explainBtn.classList.remove('visible');
        await explainSelectedWord();
    });

    document.addEventListener('mouseup', (e) => {
        setTimeout(() => {
            const sel = window.getSelection();
            const selectedText = sel ? sel.toString().trim() : '';

            if (selectedText && state.dictionaryOn) {
                const pdfPanel = $('#pdf-content');
                if (sel.rangeCount === 0) { explainBtn.classList.remove('visible'); return; }
                const range = sel.getRangeAt(0);
                if (pdfPanel.contains(range.commonAncestorContainer)) {
                    const rect = range.getBoundingClientRect();
                    if (rect && rect.width > 0) {
                        explainBtn.style.left = (rect.right + 8) + 'px';
                        explainBtn.style.top = (rect.top - 36) + 'px';
                        const bw = explainBtn.offsetWidth || 120;
                        if (parseFloat(explainBtn.style.left) + bw > window.innerWidth) {
                            explainBtn.style.left = (rect.left - bw - 8) + 'px';
                        }
                        if (parseFloat(explainBtn.style.top) < 50) {
                            explainBtn.style.top = (rect.bottom + 8) + 'px';
                        }
                        explainBtn.classList.add('visible');
                    }
                } else {
                    explainBtn.classList.remove('visible');
                }
            } else {
                explainBtn.classList.remove('visible');
            }
        }, 10);
    });

    document.addEventListener('mousedown', (e) => {
        if (e.target !== explainBtn) {
            explainBtn.classList.remove('visible');
        }
    });
}

// ═══════════════════════════════════════════════════════
// RIGHT-CLICK CONTEXT MENU
// ═══════════════════════════════════════════════════════
function setupContextMenu() {
    document.addEventListener('click', (e) => {
        if (!$('#context-menu').contains(e.target)) {
            $('#context-menu').classList.add('hidden');
        }
    });

    $('#ctx-explain').addEventListener('click', explainSelectedWord);
    $('#ctx-copy').addEventListener('click', () => {
        if (state.activeWord) {
            navigator.clipboard.writeText(state.activeWord.word);
            showToast('📋 Copied!', 'success');
        }
        $('#context-menu').classList.add('hidden');
    });
    $('#ctx-cancel').addEventListener('click', () => {
        $('#context-menu').classList.add('hidden');
    });
    $('#explain-close').addEventListener('click', () => {
        $('#explain-result').classList.add('hidden');
    });
    $('#explain-result').addEventListener('click', function(e) {
        if (e.target === this) this.classList.add('hidden');
    });
}

function handlePDFContextMenu(e, word, textContent, pageNum) {
    if (!state.dictionaryOn) return;
    e.preventDefault();
    e.stopPropagation();

    const sel = window.getSelection();
    const selectedText = sel ? sel.toString().trim() : '';
    let useWord = word;
    let useContext = buildContextSentence(
        textContent.items.filter(it => it.str && it.str.trim()), word
    );

    if (selectedText && selectedText.length > 0) {
        useWord = selectedText;
        useContext = selectedText;
    }

    state.activeWord = { word: useWord, contextSentence: useContext, element: e.target, source: 'pdf' };
    showContextMenu(e, useWord, useContext);
}

function handleReadModeContextMenu(e, el) {
    if (!state.dictionaryOn) return;
    e.preventDefault();
    e.stopPropagation();

    const word = el.dataset.word;
    const contextSentence = extractContextSentence(el);
    state.activeWord = { word, contextSentence, element: el, source: 'read' };
    showContextMenu(e, word, contextSentence);
}

function buildContextSentence(allWords, targetWord) {
    const idx = allWords.findIndex(it => it.str === targetWord);
    if (idx === -1) return targetWord;
    const start = Math.max(0, idx - 5);
    const end = Math.min(allWords.length, idx + 6);
    return allWords.slice(start, end).map(it => it.str).join(' ');
}

function extractContextSentence(el) {
    const paragraph = el.closest('.pdf-paragraph');
    if (!paragraph) return el.dataset.word;
    const fullText = paragraph.textContent;
    const wordText = el.dataset.word;
    const idx = fullText.indexOf(wordText);
    if (idx === -1) return wordText;
    const start = Math.max(0, idx - 80);
    const end = Math.min(fullText.length, idx + wordText.length + 80);
    return fullText.substring(start, end).trim();
}

function showContextMenu(e, word, contextSentence) {
    const menu = $('#context-menu');
    $('#ctx-word').textContent = word;
    $('#ctx-context').textContent = `"...${contextSentence}..."`;

    let left = e.clientX + 5;
    let top = e.clientY + 5;
    if (left + 250 > window.innerWidth) left = e.clientX - 260;
    if (top + 180 > window.innerHeight) top = e.clientY - 190;
    if (left < 5) left = 5;
    if (top < 5) top = 5;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.classList.remove('hidden');
}

async function explainSelectedWord() {
    if (!state.activeWord) return;
    $('#context-menu').classList.add('hidden');
    $('#selection-explain-btn').classList.remove('visible');

    const result = $('#explain-result');
    $('#explain-word').textContent = state.activeWord.word;
    $('#explain-loading').style.display = 'block';
    $('#explain-explanation').textContent = '';
    $('#explain-saved').style.display = 'none';
    result.classList.remove('hidden');

    const convCtx = getConversationContext();
    const pdfCtx = state.activeProject?.pdf_context || '';

    try {
        const res = await fetch('/api/explain-word', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word: state.activeWord.word,
                context_sentence: state.activeWord.contextSentence,
                pdf_context: pdfCtx,
                conversation_context: convCtx,
            }),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.detail); }
        const d = await res.json();
        $('#explain-loading').style.display = 'none';
        $('#explain-explanation').innerHTML = renderMarkdown(d.explanation);
        $('#explain-saved').style.display = 'block';
        await loadWordCards();
    } catch(e) {
        $('#explain-loading').style.display = 'none';
        $('#explain-explanation').textContent = '❌ ' + e.message;
    }
}

function getConversationContext() {
    const m = $('#messages-main').querySelectorAll('.chat-bubble');
    const e = $('#messages-explainer').querySelectorAll('.chat-bubble');
    return [...m, ...e].slice(-4).map(b => b.textContent).join(' | ');
}

// ═══════════════════════════════════════════════════════
// CHAT HISTORY
// ═══════════════════════════════════════════════════════
function renderChatHistory() {
    if (!state.activeProject) return;

    const mainEl = $('#messages-main');
    mainEl.innerHTML = '';
    if (state.activeProject.main && state.activeProject.main.length > 0) {
        state.activeProject.main.forEach(t => {
            addChatBubble(mainEl, t.content, t.role === 'user' ? 'user' : 'ai ai-main');
        });
    } else {
        mainEl.innerHTML = '<div class="empty-state"><p>🤖 Main AI</p><p class="sub">Ask a question about the document</p></div>';
    }
    mainEl.scrollTop = mainEl.scrollHeight;

    const expEl = $('#messages-explainer');
    expEl.innerHTML = '';
    if (state.activeProject.explainer && state.activeProject.explainer.length > 0) {
        state.activeProject.explainer.forEach(t => {
            addChatBubble(expEl, t.content, t.role === 'user' ? 'user' : 'ai ai-explainer');
        });
    } else {
        expEl.innerHTML = '<div class="empty-state"><p>🔍 Explainer AI</p><p class="sub">Your tutor — ask it to explain anything</p></div>';
    }
    expEl.scrollTop = expEl.scrollHeight;
}

// ═══════════════════════════════════════════════════════
// STREAMING CHAT
// ═══════════════════════════════════════════════════════
async function sendToAI(windowType) {
    if (state.streaming.main || state.streaming.explainer) {
        showToast('⏳ AI is still responding...', 'error'); return;
    }
    if (!state.activeProjectId) { showToast('📄 Upload a PDF first', 'error'); return; }

    const inputEl = windowType === 'main' ? $('#input-main') : $('#input-explainer');
    const messagesEl = windowType === 'main' ? $('#messages-main') : $('#messages-explainer');
    const sendBtn = windowType === 'main' ? $('#btn-send-main') : $('#btn-send-explainer');
    const message = inputEl.value.trim();
    if (!message) return;

    const es = messagesEl.querySelector('.empty-state');
    if (es) es.remove();

    addChatBubble(messagesEl, message, 'user');
    inputEl.value = ''; inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    state.streaming[windowType] = true;

    const bubbleClass = windowType === 'main' ? 'ai ai-main' : 'ai ai-explainer';
    const label = windowType === 'main' ? 'Main AI' : 'Explainer AI';
    const streamBubble = document.createElement('div');
    streamBubble.className = `chat-bubble ${bubbleClass}`;
    streamBubble.innerHTML = `<div class="bubble-label">${label}</div><div class="bubble-text markdown-body"><span class="streaming-content"></span><span class="streaming-cursor"></span></div>`;
    messagesEl.appendChild(streamBubble);
    scrollToBottom(messagesEl);

    const contentSpan = streamBubble.querySelector('.streaming-content');
    const cursorSpan = streamBubble.querySelector('.streaming-cursor');
    let fullText = '';

    try {
        const endpoint = windowType === 'main' ? '/api/chat/main/stream' : '/api/chat/explainer/stream';
        const res = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, project_id: state.activeProjectId }),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.detail || `HTTP ${res.status}`); }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('data: ')) {
                    try {
                        const d = JSON.parse(t.slice(6));
                        if (d.token) {
                            fullText += d.token;
                            contentSpan.innerHTML = renderMarkdown(fullText);
                            scrollToBottom(messagesEl);
                        } else if (d.done) {
                            cursorSpan.remove();
                        } else if (d.error) {
                            contentSpan.textContent = '❌ ' + d.error;
                            cursorSpan.remove();
                            streamBubble.classList.add('error');
                        }
                    } catch(pe) {}
                }
            }
        }

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        streamBubble.querySelector('.bubble-text').innerHTML = renderMarkdown(fullText);
        const timeEl = document.createElement('div');
        timeEl.className = 'bubble-time'; timeEl.textContent = time;
        streamBubble.appendChild(timeEl);

        await loadActiveProject();
    } catch(e) {
        streamBubble.querySelector('.bubble-text').textContent = '❌ Error: ' + e.message;
        streamBubble.classList.add('error');
        if (cursorSpan) cursorSpan.remove();
    } finally {
        state.streaming[windowType] = false;
        sendBtn.disabled = false;
        inputEl.focus();
    }
}

function addChatBubble(container, text, type) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${type}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let label = '';
    if (type === 'ai ai-main') label = 'Main AI';
    else if (type === 'ai ai-explainer') label = 'Explainer AI';
    else if (type === 'user') label = 'You';

    const content = (type === 'user')
        ? escHtml(text).replace(/\n/g, '<br>')
        : renderMarkdown(text);

    bubble.innerHTML = `${label ? `<div class="bubble-label">${label}</div>` : ''}<div class="bubble-text markdown-body">${content}</div><div class="bubble-time">${time}</div>`;
    container.appendChild(bubble);
    return bubble;
}

function renderMarkdown(text) {
    if (!text) return '';
    try { return marked.parse(text); } catch(e) { return escHtml(text).replace(/\n/g, '<br>'); }
}

function scrollToBottom(el) { el.scrollTop = el.scrollHeight; }

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function tokenize(text) {
    const tokens = [];
    const regex = /([a-zA-Z0-9\u00C0-\u024F\-']+)|([^a-zA-Z0-9\u00C0-\u024F\-']+)/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
        if (m[1]) tokens.push({ type: 'word', value: m[1] });
        else if (m[2]) tokens.push({ type: 'punct', value: m[2] });
    }
    return tokens;
}

// ═══════════════════════════════════════════════════════
// PDF UPLOAD
// ═══════════════════════════════════════════════════════
async function uploadPDF(file) {
    if (!file) return;
    $('#pdf-empty').classList.add('hidden');
    $('#pdf-canvas-container').innerHTML = '<div class="empty-state"><p>⏳ Processing PDF...</p></div>';
    $('#pdf-viewer').classList.remove('hidden');
    $('#read-mode').classList.add('hidden');

    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await fetch('/api/upload-pdf', { method: 'POST', body: fd });
        if (!res.ok) { const err = await res.json(); throw new Error(err.detail); }
        const d = await res.json();
        await loadProjects();
        showToast(`✅ "${d.project.name}" loaded (${d.page_count} pages)`, 'success');
    } catch(e) {
        showToast(`❌ ${e.message}`, 'error');
        $('#pdf-canvas-container').innerHTML = '';
        $('#pdf-empty').classList.remove('hidden');
    }
}

// ═══════════════════════════════════════════════════════
// WORD CARDS
// ═══════════════════════════════════════════════════════
async function loadWordCards() {
    try {
        const res = await fetch('/api/word-cards');
        state.wordCards = await res.json();
        renderWordCards();
    } catch(e) { console.error('Cards:', e); }
}

function renderWordCards() {
    const list = $('#wordcards-list');
    const count = $('#card-count');
    if (state.wordCards.length === 0) {
        list.innerHTML = '<p class="empty-state sub">Select text → Explain to create cards</p>';
        count.textContent = '0';
        return;
    }
    count.textContent = state.wordCards.length;
    list.innerHTML = state.wordCards.slice().reverse().map(c => `
        <div class="wordcard-item" data-id="${c.id}">
            <button class="wc-delete" onclick="deleteWordCard(${c.id})">🗑️</button>
            <div class="wc-word">${escHtml(c.word)}</div>
            <div class="wc-context">"...${escHtml(c.context_sentence)}..."</div>
            <div class="wc-explanation markdown-body">${renderMarkdown(c.explanation)}</div>
        </div>
    `).join('');
}

async function deleteWordCard(id) {
    try {
        await fetch(`/api/word-cards/${id}`, { method: 'DELETE' });
        await loadWordCards();
    } catch(e) { showToast('Failed', 'error'); }
}

function toggleWordCards() {
    $('#wordcards-panel').classList.toggle('open');
}

// ═══════════════════════════════════════════════════════
// PANELS & DIVIDERS
// ═══════════════════════════════════════════════════════
function togglePanel(pid) {
    const panel = document.getElementById(pid);
    const btn = panel.querySelector('.btn-minimize');
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        btn.textContent = '−';
    } else {
        panel.classList.add('collapsed');
        btn.textContent = '+';
    }
}

function toggleLayout() {
    state.layout = state.layout === 'horizontal' ? 'vertical' : 'horizontal';
    updateLayoutUI();
    fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: state.layout }),
    }).catch(() => {});
}

function setupDividers() {
    $$('.divider').forEach(divider => {
        divider.addEventListener('mousedown', (e) => {
            e.preventDefault();
            state.isResizing = true;
            divider.classList.add('active');

            const isH = state.layout === 'horizontal';
            const [pLeft, pRight] = getAdjacentPanels(divider);

            const rLeft = pLeft.getBoundingClientRect();
            const rRight = pRight.getBoundingClientRect();
            const startSizeLeft = isH ? rLeft.width : rLeft.height;
            const startSizeRight = isH ? rRight.width : rRight.height;
            const totalBoth = startSizeLeft + startSizeRight;
            const startPos = isH ? e.clientX : e.clientY;

            function mv(ev) {
                if (!state.isResizing) return;
                const cur = isH ? ev.clientX : ev.clientY;
                const delta = cur - startPos;
                const newL = Math.max(200, startSizeLeft + delta);
                const newR = Math.max(200, startSizeRight - delta);
                if (newL < 200 || newR < 200) return;

                pLeft.style.flex = `0 1 ${(newL / totalBoth) * 100}%`;
                pRight.style.flex = `0 1 ${(newR / totalBoth) * 100}%`;
            }

            function up() {
                state.isResizing = false;
                divider.classList.remove('active');
                document.removeEventListener('mousemove', mv);
                document.removeEventListener('mouseup', up);
            }

            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });
    });
}

function getAdjacentPanels(divider) {
    const panels = [...$('#main-container').querySelectorAll('.panel')];
    const dividers = [...$('#main-container').querySelectorAll('.divider')];
    const idx = dividers.indexOf(divider);
    return [panels[idx], panels[idx + 1]];
}

function setupDragDrop() {
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.pdf')) uploadPDF(file);
    });
}

// ═══════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════
function setupEventListeners() {
    $('#btn-upload').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', e => { if (e.target.files[0]) uploadPDF(e.target.files[0]); });
    $('#btn-pdf-mode').addEventListener('click', togglePDFMode);
    $('#btn-dictionary').addEventListener('click', toggleDictionary);
    $('#btn-layout').addEventListener('click', toggleLayout);
    $('#btn-wordcards').addEventListener('click', toggleWordCards);
    $('#btn-wordcards-close').addEventListener('click', () => $('#wordcards-panel').classList.remove('open'));
    $('#project-select').addEventListener('change', e => switchProject(e.target.value));
    $('#btn-delete-project').addEventListener('click', deleteProject);

    // Zoom
    $('#btn-zoom-in').addEventListener('click', zoomIn);
    $('#btn-zoom-out').addEventListener('click', zoomOut);
    $('#btn-zoom-fit').addEventListener('click', zoomFit);

    // Settings
    $('#btn-settings').addEventListener('click', () => $('#settings-overlay').classList.remove('hidden'));
    $('#btn-settings-close').addEventListener('click', () => $('#settings-overlay').classList.add('hidden'));
    $('#settings-overlay').addEventListener('click', e => { if (e.target === $('#settings-overlay')) $('#settings-overlay').classList.add('hidden'); });
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#main-model-select').addEventListener('change', updateModelBadges);
    $('#explainer-model-select').addEventListener('change', updateModelBadges);

    // Panel minimize
    $$('.btn-minimize').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); togglePanel(btn.dataset.panel); });
    });
    $$('.panel-header').forEach(h => {
        h.addEventListener('click', e => {
            const panel = h.parentElement;
            if (panel.classList.contains('collapsed') && !e.target.closest('button')) togglePanel(panel.id);
        });
    });

    // Chat Main
    $('#btn-send-main').addEventListener('click', () => sendToAI('main'));
    $('#input-main').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToAI('main'); }
    });
    $('#input-main').addEventListener('input', () => {
        const el = $('#input-main');
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    });

    // Chat Explainer
    $('#btn-send-explainer').addEventListener('click', () => sendToAI('explainer'));
    $('#input-explainer').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToAI('explainer'); }
    });
    $('#input-explainer').addEventListener('input', () => {
        const el = $('#input-explainer');
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    });

    // Keyboard
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            $('#context-menu').classList.add('hidden');
            $('#explain-result').classList.add('hidden');
            $('#settings-overlay').classList.add('hidden');
            $('#selection-explain-btn').classList.remove('visible');
        }
    });

    // ── Trackpad Pinch-to-Zoom ──
    // Deliberate re-render at real scale instead of CSS transform.
    // This keeps text layer coordinates perfectly aligned with the visual canvas.
    let pinchAccumulator = 0;
    document.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const pdfPanel = $('#panel-pdf');
            const rect = pdfPanel.getBoundingClientRect();
            const mouseInPDF = (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            );
            if (!mouseInPDF || !state.pdfDoc || state.pdfMode !== 'pdf') return;

            // Accumulate scale changes during continuous gesture
            pinchAccumulator += -e.deltaY * 0.005;
            const newScale = Math.max(0.5, Math.min(4.0, state.pdfScale * (1 + pinchAccumulator)));
            pinchAccumulator = 0;
            state.pdfScale = Math.round(newScale * 100) / 100;
            updateZoomLabel();

            // Debounce re-render — 200ms after last pinch event
            clearTimeout(state.pinchTimer);
            state.pinchTimer = setTimeout(() => {
                if (state.pdfDoc && state.pdfMode === 'pdf') {
                    renderPDFView();
                }
            }, 200);
        }
    }, { passive: false });

    // Safari gesture events
    let gestureStartScale = 1;
    document.addEventListener('gesturestart', (e) => {
        e.preventDefault();
        gestureStartScale = state.pdfScale;
    });
    document.addEventListener('gesturechange', (e) => {
        e.preventDefault();
        if (state.pdfDoc && state.pdfMode === 'pdf') {
            state.pdfScale = Math.max(0.5, Math.min(4.0, gestureStartScale * e.scale));
            state.pdfScale = Math.round(state.pdfScale * 100) / 100;
            updateZoomLabel();
        }
    });
    document.addEventListener('gestureend', (e) => {
        e.preventDefault();
        if (state.pdfDoc && state.pdfMode === 'pdf') {
            renderPDFView();
        }
    });
}

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}
