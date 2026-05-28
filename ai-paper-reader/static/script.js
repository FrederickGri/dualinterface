/* ═══════════════════════════════════════════════════════
   AI Paper Reader v5
   Chrome Native PDF + Dictionary via Selection Intercept
   Sidebar: collapsed by default, expands on click
   Chat minimize: PDF fills all space
   ═══════════════════════════════════════════════════════ */

if (typeof marked !== 'undefined') marked.setOptions({ breaks: true, gfm: true });

function safe$(sel) { const el = document.querySelector(sel); if (!el) console.warn('Missing:', sel); return el; }
function safe$$(sel) { return document.querySelectorAll(sel); }

const PROVIDER_PRESETS = {
    siliconflow: {
        label: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        mainModel: 'deepseek-ai/DeepSeek-V4-Pro',
        explainerModel: 'deepseek-ai/DeepSeek-V4-Pro',
        keyHint: 'SiliconFlow is the default. Leave blank to use builtinapikey in app.py when it is set.',
        models: [
            ['deepseek-ai/DeepSeek-V4-Pro', 'DeepSeek V4 Pro'],
            ['deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2'],
            ['deepseek-ai/DeepSeek-R1', 'DeepSeek R1'],
            ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'Qwen3 Coder 480B'],
        ],
    },
    deepseek: {
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        mainModel: 'deepseek-chat',
        explainerModel: 'deepseek-chat',
        keyHint: 'Use your DeepSeek API key.',
        models: [
            ['deepseek-chat', 'DeepSeek Chat'],
            ['deepseek-reasoner', 'DeepSeek Reasoner'],
        ],
    },
    qwen: {
        label: 'Qwen / DashScope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        mainModel: 'qwen-plus',
        explainerModel: 'qwen-turbo',
        keyHint: 'Use your DashScope API key.',
        models: [
            ['qwen-plus', 'Qwen Plus'],
            ['qwen-turbo', 'Qwen Turbo'],
            ['qwen-max', 'Qwen Max'],
        ],
    },
    volcengine: {
        label: 'Volcengine Ark',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        mainModel: '',
        explainerModel: '',
        keyHint: 'Use your Ark API key. Model fields are usually your Ark endpoint IDs.',
        models: [],
    },
    openai: {
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        mainModel: 'gpt-4o-mini',
        explainerModel: 'gpt-4o-mini',
        keyHint: 'Use your OpenAI API key.',
        models: [
            ['gpt-4o-mini', 'GPT-4o mini'],
            ['gpt-4o', 'GPT-4o'],
            ['gpt-4.1-mini', 'GPT-4.1 mini'],
        ],
    },
    custom: {
        label: 'Custom',
        baseUrl: '',
        mainModel: '',
        explainerModel: '',
        keyHint: 'Enter an OpenAI-compatible base URL, API key, and model names.',
        models: [],
    },
};

const state = {
    wordCards: [],
    activeWord: null,
    isResizing: false,
    streaming: { main: false, explainer: false },
    projects: [],
    activeProjectId: '',
    activeProject: null,
    readMode: false,
    chatMinimized: false,
    sidebarExpanded: false,
    selectedText: '',
    selectedContext: '',
    selectedAt: 0,
    abortControllers: { main: null, explainer: null },
};
const hookedPDFDocs = new WeakSet();

// ═══════════ INIT ═══════════
async function init() {
    console.log('🚀 Starting...');
    try {
        await loadSettings();
        await loadProjects();
        await loadWordCards();
        setupEventListeners();
        setupDividers();
        setupDragDrop();
        setupPDFSelectionHook();
        console.log('✅ Ready');
    } catch(e) { console.error('Init:', e); showToast('Error: ' + e.message, 'error'); }
}
document.addEventListener('DOMContentLoaded', init);

// ═══════════════════════════════════════════
// THE GENIUS PART: Dictionary on Chrome PDF
// ═══════════════════════════════════════════
function setupPDFSelectionHook() {
    const iframe = safe$('#pdf-iframe');
    if (!iframe) return;

    iframe.addEventListener('load', () => {
        console.log('📄 PDF loaded, hooking selection...');
        tryHookIframe(iframe, 0);
    });

    // The user might have already loaded a PDF before this init ran
    if (iframe.src && iframe.style.display !== 'none') {
        setTimeout(() => tryHookIframe(iframe, 0), 500);
    }
}

function tryHookIframe(iframe, attempts) {
    if (attempts > 20) { console.log('⚠️ Could not hook PDF iframe after 20 attempts'); return; }

    try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (!doc || !doc.body) {
            setTimeout(() => tryHookIframe(iframe, attempts + 1), 500);
            return;
        }

        if (hookedPDFDocs.has(doc)) return;
        hookedPDFDocs.add(doc);
        console.log('✅ Hooked into PDF iframe!');

        // Listen for mouseup (text selection finished)
        doc.addEventListener('mouseup', (e) => {
            setTimeout(() => {
                const picked = getSelectionFromDocument(doc);
                if (picked) {
                    const cached = rememberPDFSelection(picked.text, picked.contextSentence);
                    const rect = iframe.getBoundingClientRect();
                    showSelectionPopover(cached.text, rect.left + e.clientX, rect.top + e.clientY);
                }
            }, 50);
        });

        // Also listen for copy event (user does Cmd+C)
        doc.addEventListener('copy', (e) => {
            const picked = getSelectionFromDocument(doc);
            if (picked) {
                const cached = rememberPDFSelection(picked.text, picked.contextSentence, true);
                const rect = iframe.getBoundingClientRect();
                showSelectionPopover(cached.text, rect.left + rect.width - 170, rect.top + 16);
                return;
            }
            showClipboardPopoverFromIframe(iframe);
        }, true);

        // Chrome's PDF viewer often keeps focus inside the iframe, so mirror shortcuts here too.
        doc.addEventListener('keydown', (e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const key = e.key.toLowerCase();
            if (key === 'e') {
                e.preventDefault();
                explainPDFSelection({ preferClipboard: true });
            } else if (key === 'c') {
                showClipboardPopoverFromIframe(iframe);
            }
        }, true);

    } catch(e) {
        // Cross-origin or not ready yet
        console.log(`Attempt ${attempts}: ${e.message}`);
        setTimeout(() => tryHookIframe(iframe, attempts + 1), 500);
    }
}

function normalizeSelectionText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function getSelectionFromDocument(doc) {
    if (!doc) return null;
    const sel = doc.getSelection?.();
    const text = normalizeSelectionText(sel ? sel.toString() : '');
    if (!text || text.length > 500) return null;

    let contextSentence = text;
    if (sel?.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const fullText = normalizeSelectionText(container.textContent || '');
        const idx = fullText.indexOf(text);
        if (idx !== -1) {
            const start = Math.max(0, idx - 80);
            const end = Math.min(fullText.length, idx + text.length + 80);
            contextSentence = fullText.substring(start, end).trim();
        }
    }
    return { text, contextSentence };
}

function findPDFContextForText(text) {
    const pdfText = state.activeProject?.pdf_context || '';
    if (!pdfText || !text) return text;

    const exactIdx = pdfText.indexOf(text);
    const lowerIdx = exactIdx === -1 ? pdfText.toLowerCase().indexOf(text.toLowerCase()) : exactIdx;
    const idx = exactIdx !== -1 ? exactIdx : lowerIdx;
    if (idx === -1) return text;

    const start = Math.max(0, idx - 120);
    const end = Math.min(pdfText.length, idx + text.length + 120);
    return normalizeSelectionText(pdfText.substring(start, end));
}

function rememberPDFSelection(text, contextSentence, silent = false) {
    const cleaned = normalizeSelectionText(text);
    if (!cleaned || cleaned.length > 500) return null;

    state.selectedText = cleaned;
    state.selectedContext = normalizeSelectionText(contextSentence) || findPDFContextForText(cleaned);
    state.selectedAt = Date.now();

    if (!silent) {
        showToast(`Selected: "${cleaned.substring(0, 50)}${cleaned.length > 50 ? '...' : ''}"`, 'success');
    }
    return { text: state.selectedText, contextSentence: state.selectedContext };
}

function showSelectionPopover(text, x, y) {
    const pop = safe$('#selection-popover');
    const label = safe$('#selection-popover-text');
    if (!pop || !label || !text) return;

    label.textContent = `"${text.substring(0, 48)}${text.length > 48 ? '...' : ''}"`;
    pop.classList.remove('hidden');

    const margin = 12;
    const popRect = pop.getBoundingClientRect();
    const left = Math.min(Math.max(margin, x + 10), window.innerWidth - popRect.width - margin);
    const top = Math.min(Math.max(margin, y + 10), window.innerHeight - popRect.height - margin);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
}

function hideSelectionPopover() {
    const pop = safe$('#selection-popover');
    if (pop) pop.classList.add('hidden');
}

function maybeShowDocumentSelectionPopover(e) {
    const pop = safe$('#selection-popover');
    if (pop?.contains(e.target)) return;

    const pdfArea = safe$('#pdf-content-area');
    if (!state.readMode || !pdfArea?.contains(e.target)) return;

    setTimeout(() => {
        const picked = getSelectionFromDocument(document);
        if (!picked) return;
        const cached = rememberPDFSelection(picked.text, picked.contextSentence, true);
        if (cached) showSelectionPopover(cached.text, e.clientX, e.clientY);
    }, 0);
}

function cachePDFSelection(silent = true) {
    const iframe = safe$('#pdf-iframe');
    if (iframe) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            const picked = getSelectionFromDocument(doc);
            if (picked) return rememberPDFSelection(picked.text, picked.contextSentence, silent);
        } catch(e) {}
    }

    const picked = getSelectionFromDocument(document);
    if (picked) return rememberPDFSelection(picked.text, picked.contextSentence, silent);

    return null;
}

function getRecentStoredSelection(maxAgeMs = 60000) {
    if (!state.selectedText) return null;
    if (Date.now() - state.selectedAt > maxAgeMs) return null;
    return { text: state.selectedText, contextSentence: state.selectedContext || state.selectedText };
}

async function readClipboardSelection() {
    if (!navigator.clipboard?.readText) return null;
    try {
        const text = normalizeSelectionText(await navigator.clipboard.readText());
        if (!text || text.length > 500) return null;
        return rememberPDFSelection(text, findPDFContextForText(text), true);
    } catch(e) {
        return null;
    }
}

async function getPDFSelection(options = {}) {
    const preferClipboard = !!options.preferClipboard && !state.readMode;
    if (preferClipboard) {
        const copied = await readClipboardSelection();
        if (copied) return copied;
    }

    return cachePDFSelection(true) || getRecentStoredSelection(15000) || await readClipboardSelection() || getRecentStoredSelection();
}

async function explainPDFSelection(options = {}) {
    const picked = await getPDFSelection(options);
    if (!picked?.text) {
        showToast('Copy PDF text first, then press Cmd+E or click Explain. Text Mode also works.', 'error');
        return;
    }

    hideSelectionPopover();
    const contextSentence = picked.contextSentence || picked.text;
    state.activeWord = { word: picked.text, contextSentence };
    await explainWordDirectly(picked.text, contextSentence);
}

function showClipboardPopoverFromIframe(iframe) {
    setTimeout(async () => {
        const copied = await readClipboardSelection();
        if (!copied) return;
        const rect = iframe.getBoundingClientRect();
        showSelectionPopover(copied.text, rect.left + rect.width - 190, rect.top + 14);
    }, 80);
}

// Also hook re-selection when user clicks "Explain" button
function reHookAfterModeChange() {
    const iframe = safe$('#pdf-iframe');
    if (iframe && iframe.style.display !== 'none') {
        setTimeout(() => tryHookIframe(iframe, 0), 300);
    }
}

// ═══════════ SETTINGS ═══════════
function applyProviderPreset(provider, overwriteModels = false) {
    const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
    const baseUrl = safe$('#api-base-url-input');
    const apiLabel = safe$('#api-key-label');
    const apiHint = safe$('#api-key-hint');
    const mainModel = safe$('#main-model-select');
    const explainerModel = safe$('#explainer-model-select');

    if (baseUrl && (overwriteModels || !baseUrl.value.trim())) baseUrl.value = preset.baseUrl;
    if (apiLabel) apiLabel.textContent = `${preset.label} API Key`;
    if (apiHint) apiHint.textContent = preset.keyHint;
    populateModelSelect(mainModel, preset, mainModel?.value || preset.mainModel);
    populateModelSelect(explainerModel, preset, explainerModel?.value || preset.explainerModel);
    if (mainModel && overwriteModels) {
        populateModelSelect(mainModel, preset, preset.mainModel);
        mainModel.dataset.previousValue = preset.mainModel;
    }
    if (explainerModel && overwriteModels) {
        populateModelSelect(explainerModel, preset, preset.explainerModel);
        explainerModel.dataset.previousValue = preset.explainerModel;
    }
    updateModelBadges();
}

function populateModelSelect(select, preset, currentValue) {
    if (!select) return;
    const models = preset.models || [];
    const value = currentValue || preset.mainModel || '';
    let options = models.map(([model, label]) => `<option value="${escHtml(model)}">${escHtml(label)} (${escHtml(model)})</option>`).join('');

    if (value && !models.some(([model]) => model === value)) {
        options += `<option value="${escHtml(value)}">${escHtml(value)}</option>`;
    }
    options += '<option value="__custom__">Custom model...</option>';
    select.innerHTML = options;
    select.value = value || '__custom__';
}

function handleModelSelectChange(select) {
    if (!select || select.value !== '__custom__') {
        updateModelBadges();
        return;
    }

    const custom = prompt('Enter model name / endpoint ID:');
    if (!custom?.trim()) {
        select.value = select.dataset.previousValue || '';
        updateModelBadges();
        return;
    }

    const value = custom.trim();
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.insertBefore(option, select.querySelector('option[value="__custom__"]'));
    select.value = value;
    select.dataset.previousValue = value;
    updateModelBadges();
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const d = await res.json();
        const ps = safe$('#provider-select'), abu = safe$('#api-base-url-input'), aki = safe$('#api-key-input');
        const mms = safe$('#main-model-select'), ems = safe$('#explainer-model-select'), sms = safe$('#sync-mode-select');
        if (ps && d.provider) ps.value = d.provider;
        if (abu && d.api_base_url) abu.value = d.api_base_url;
        if (aki && d.api_key) aki.value = d.api_key;
        if (sms && d.sync_mode) sms.value = d.sync_mode;
        applyProviderPreset(ps?.value || d.provider || 'siliconflow', false);
        if (mms && d.main_model) {
            populateModelSelect(mms, PROVIDER_PRESETS[ps?.value || d.provider || 'siliconflow'] || PROVIDER_PRESETS.custom, d.main_model);
            mms.dataset.previousValue = d.main_model;
        }
        if (ems && d.explainer_model) {
            populateModelSelect(ems, PROVIDER_PRESETS[ps?.value || d.provider || 'siliconflow'] || PROVIDER_PRESETS.custom, d.explainer_model);
            ems.dataset.previousValue = d.explainer_model;
        }
        updateModelBadges();
    } catch(e) { console.error('Settings:', e); }
}

async function saveSettings() {
    const status = safe$('#settings-status'); if (!status) return;
    status.textContent = '⏳ Saving...'; status.className = '';
    try {
        const res = await fetch('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: safe$('#provider-select')?.value || 'siliconflow',
                api_base_url: safe$('#api-base-url-input')?.value.trim() || '',
                api_key: safe$('#api-key-input')?.value.trim() || '',
                main_model: modelSelectValue(safe$('#main-model-select')) || 'deepseek-ai/DeepSeek-V4-Pro',
                explainer_model: modelSelectValue(safe$('#explainer-model-select')) || 'deepseek-ai/DeepSeek-V4-Pro',
                sync_mode: safe$('#sync-mode-select')?.value || 'latest_only',
            }),
        });
        const d = await res.json();
        status.textContent = d.api_key_set ? '✅ Saved!' : '⚠️ Saved (no API key)';
        status.className = d.api_key_set ? 'success' : 'error';
        updateModelBadges();
        setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
    } catch(e) { status.textContent = '❌ Failed'; status.className = 'error'; }
}

function updateModelBadges() {
    const mm = modelSelectValue(safe$('#main-model-select')), em = modelSelectValue(safe$('#explainer-model-select'));
    const mb = safe$('#main-model-badge'), eb = safe$('#explainer-model-badge');
    const mainBadge = modelBadgeText(mm);
    const explainerBadge = modelBadgeText(em);
    if (mb) { mb.textContent = mainBadge.text; mb.style.background = mainBadge.color; }
    if (eb) { eb.textContent = explainerBadge.text; eb.style.background = explainerBadge.color; }
}

function modelSelectValue(select) {
    if (!select || select.value === '__custom__') return '';
    return select.value;
}

function modelBadgeText(model = '') {
    const m = model.toLowerCase();
    if (m.includes('r1') || m.includes('reasoner')) return { text: 'R1', color: 'var(--accent-mauve)' };
    if (m.includes('v3') || m.includes('deepseek-chat')) return { text: 'V3', color: 'var(--accent-blue)' };
    if (m.includes('qwen')) return { text: 'QWEN', color: 'var(--accent-yellow)' };
    if (m.includes('gpt')) return { text: 'GPT', color: 'var(--accent-blue)' };
    if (m.includes('doubao') || m.startsWith('ep-')) return { text: 'ARK', color: 'var(--accent-green)' };
    return { text: 'AI', color: 'var(--accent-blue)' };
}

// ═══════════ SIDEBAR ═══════════
function syncSidebarUI() {
    const sidebar = safe$('#sidebar');
    const toggle = safe$('#sidebar-toggle');
    if (sidebar) sidebar.classList.toggle('expanded', state.sidebarExpanded);
    if (toggle) {
        toggle.textContent = state.sidebarExpanded ? '✕' : '☰';
        toggle.title = state.sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar';
    }
}

function toggleSidebar() {
    state.sidebarExpanded = !state.sidebarExpanded;
    syncSidebarUI();
}
function collapseSidebar() {
    state.sidebarExpanded = false;
    syncSidebarUI();
}

// ═══════════ PROJECTS ═══════════
async function loadProjects() {
    try {
        const res = await fetch('/api/projects');
        const d = await res.json();
        state.projects = d.projects || [];
        state.activeProjectId = d.active_id || '';
        syncSidebarUI();
        renderSidebarProjects();
        if (state.activeProjectId) await loadActiveProject();
        else clearAll();
    } catch(e) { console.error('Projects:', e); }
}

function renderSidebarProjects() {
    const container = safe$('#sidebar-projects'); if (!container) return;
    if (state.projects.length === 0) {
        container.innerHTML = '<p class="sidebar-label">Conversations</p><p class="sidebar-empty-hint">No PDFs yet</p>';
        return;
    }
    container.innerHTML = '<p class="sidebar-label">Conversations</p>' +
        state.projects.map(p => `
            <div class="sidebar-project ${p.id === state.activeProjectId ? 'active' : ''}" data-id="${p.id}">
                <span class="proj-name">${escHtml(p.name)}</span>
                <button class="proj-delete" data-id="${p.id}">🗑️</button>
            </div>
        `).join('');
    container.querySelectorAll('.sidebar-project').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('proj-delete')) return;
            switchProject(el.dataset.id);
            collapseSidebar();
        });
    });
    container.querySelectorAll('.proj-delete').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); deleteProjectById(btn.dataset.id); });
    });
}

async function switchProject(pid) {
    if (!pid || pid === state.activeProjectId) return;
    try {
        await fetch(`/api/projects/${pid}/activate`, { method: 'POST' });
        state.activeProjectId = pid;
        renderSidebarProjects();
        await loadActiveProject();
    } catch(e) { showToast('Failed to switch', 'error'); }
}

async function deleteProjectById(pid) {
    if (state.projects.length <= 1) { showToast("Can't delete last project", 'error'); return; }
    if (!confirm(`Delete "${state.projects.find(p => p.id === pid)?.name || 'this'}"?`)) return;
    try {
        await fetch(`/api/projects/${pid}`, { method: 'DELETE' });
        state.projects = state.projects.filter(p => p.id !== pid);
        if (state.activeProjectId === pid) {
            state.activeProjectId = state.projects[0]?.id || '';
            if (state.activeProjectId) await fetch(`/api/projects/${state.activeProjectId}/activate`, { method: 'POST' });
        }
        renderSidebarProjects();
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
        reHookAfterModeChange();
    } catch(e) { console.error('Load project:', e); }
}

function updatePDFTitle() {
    if (state.activeProject) {
        const el = safe$('#pdf-title');
        if (el) el.textContent = state.activeProject.pdf_filename || state.activeProject.name || 'Document';
    }
}

function clearAll() {
    const mm = safe$('#messages-main'), me = safe$('#messages-explainer');
    if (mm) mm.innerHTML = '<div class="empty-state"><p>🤖 Main AI</p><p class="sub">Ask a question</p></div>';
    if (me) me.innerHTML = '<div class="empty-state"><p>🔍 Explainer AI</p><p class="sub">Explains concepts</p></div>';
    const iframe = safe$('#pdf-iframe'), rm = safe$('#read-mode'), empty = safe$('#pdf-empty');
    if (iframe) {
        iframe.style.display = 'none';
        delete iframe.dataset.filename;
    }
    if (rm) rm.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    const rmc = safe$('#read-mode-content'); if (rmc) rmc.innerHTML = '';
    const pt = safe$('#pdf-title'); if (pt) pt.textContent = 'No document';
    state.activeProject = null;
    state.selectedText = '';
    state.selectedContext = '';
    state.selectedAt = 0;
}

// ═══════════ PDF RENDERING ═══════════
function renderPDFContent() {
    state.selectedText = '';
    state.selectedContext = '';
    state.selectedAt = 0;

    if (!state.activeProject || !state.activeProject.pdf_filename) {
        const iframe = safe$('#pdf-iframe'), rm = safe$('#read-mode'), empty = safe$('#pdf-empty');
        if (iframe) {
            iframe.style.display = 'none';
            delete iframe.dataset.filename;
        }
        if (rm) rm.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        return;
    }
    const empty = safe$('#pdf-empty'); if (empty) empty.classList.add('hidden');
    updatePDFTitle();

    if (state.readMode) {
        const iframe = safe$('#pdf-iframe'); if (iframe) iframe.style.display = 'none';
        renderReadMode();
    } else {
        const rm = safe$('#read-mode'); if (rm) rm.classList.add('hidden');
        const filename = state.activeProject.pdf_filename;
        const iframe = safe$('#pdf-iframe');
        if (iframe) {
            const pdfPath = `/api/pdf-file/${encodeURIComponent(filename)}`;
            const pdfUrl = new URL(pdfPath, window.location.href).href;
            if (iframe.dataset.filename !== filename || iframe.src !== pdfUrl) {
                iframe.dataset.filename = filename;
                iframe.src = pdfPath;
            }
            iframe.style.display = 'block';
        }
    }
}

function toggleReadMode() {
    state.readMode = !state.readMode;
    const btn = safe$('#btn-toggle-readmode');
    if (btn) btn.textContent = state.readMode ? '📄 PDF View' : '📝 Text Mode';
    hideSelectionPopover();
    renderPDFContent();
    if (!state.readMode) reHookAfterModeChange();
}

// ═══════════ READ MODE ═══════════
async function renderReadMode() {
    const rm = safe$('#read-mode'); if (rm) rm.classList.remove('hidden');
    try {
        const res = await fetch(`/api/pdf-context/${state.activeProjectId}`);
        const d = await res.json();
        const text = d.exists ? d.text : 'No text available.';
        const lines = text.split('\n');
        let html = ''; let inPara = false;
        for (const line of lines) {
            if (line.match(/^\[Page \d+\]$/)) {
                if (inPara) { html += '</div>'; inPara = false; }
                html += `<span class="page-marker">${escHtml(line)}</span>`;
                continue;
            }
            if (line.trim() === '') { if (inPara) { html += '</div>'; inPara = false; } continue; }
            if (!inPara) { html += '<div class="pdf-paragraph">'; inPara = true; } else { html += ' '; }
            html += tokenize(line).map(t => t.type === 'word' ? `<span class="clickable-word" data-word="${escHtml(t.value)}">${escHtml(t.value)}</span>` : escHtml(t.value)).join('');
        }
        if (inPara) html += '</div>';
        const rmc = safe$('#read-mode-content');
        if (rmc) {
            rmc.innerHTML = html;
            rmc.querySelectorAll('.clickable-word').forEach(el => {
                el.addEventListener('click', (e) => {
                    const word = el.dataset.word;
                    const ctx = extractContext(el);
                    state.activeWord = { word, contextSentence: ctx };
                    hideSelectionPopover();
                    explainWordDirectly(word, ctx);
                });
            });
        }
    } catch(e) {
        const rmc = safe$('#read-mode-content');
        if (rmc) rmc.innerHTML = '<div class="empty-state"><p>❌ Failed</p></div>';
    }
}

function extractContext(el) {
    const p = el.closest('.pdf-paragraph');
    if (!p) return el.dataset.word;
    const ft = p.textContent;
    const idx = ft.indexOf(el.dataset.word);
    if (idx === -1) return el.dataset.word;
    return ft.substring(Math.max(0, idx - 80), Math.min(ft.length, idx + el.dataset.word.length + 80)).trim();
}

// ═══════════ EXPLAIN ═══════════
async function explainWordDirectly(word, contextSentence) {
    const result = safe$('#explain-result'); if (!result) return;
    const ew = safe$('#explain-word'), el = safe$('#explain-loading'),
          ee = safe$('#explain-explanation'), es = safe$('#explain-saved');
    if (ew) ew.textContent = word;
    if (el) el.style.display = 'block';
    if (ee) ee.textContent = '';
    if (es) es.style.display = 'none';
    result.classList.remove('hidden');

    try {
        const res = await fetch('/api/explain-word', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word, context_sentence: contextSentence,
                pdf_context: state.activeProject?.pdf_context || '',
                conversation_context: getConversationContext(),
            }),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.detail); }
        const d = await res.json();
        if (el) el.style.display = 'none';
        if (ee) ee.innerHTML = renderMarkdown(d.explanation);
        if (es) es.style.display = 'block';
        await loadWordCards();
    } catch(e) { if (el) el.style.display = 'none'; if (ee) ee.textContent = '❌ ' + e.message; }
}

function getConversationContext() {
    const m = safe$('#messages-main'), e = safe$('#messages-explainer');
    return [...(m?.querySelectorAll('.chat-bubble') || []), ...(e?.querySelectorAll('.chat-bubble') || [])]
        .slice(-4).map(b => b.textContent).join(' | ');
}

// ═══════════ CHAT ═══════════
function renderChatHistory() {
    if (!state.activeProject) return;
    [['#messages-main', 'main', '🤖 Main AI'], ['#messages-explainer', 'explainer', '🔍 Explainer AI']].forEach(([sel, key, title]) => {
        const el = safe$(sel); if (!el) return;
        el.innerHTML = '';
        const h = state.activeProject[key];
        const lastAssistantIndex = h?.[h.length - 1]?.role === 'assistant' ? h.length - 1 : -1;
        if (h && h.length > 0) h.forEach((t, i) => addChatBubble(
            el,
            t.content,
            t.role === 'user' ? 'user' : `ai ai-${key}`,
            { windowType: key, messageIndex: i, canRegenerate: i === lastAssistantIndex }
        ));
        else el.innerHTML = `<div class="empty-state"><p>${title}</p><p class="sub">${key === 'main' ? 'Ask a question' : 'Explains concepts'}</p></div>`;
        el.scrollTop = el.scrollHeight;
    });
}

function setSendButtonState(windowType, streaming) {
    const sendBtn = safe$(windowType === 'main' ? '#btn-send-main' : '#btn-send-explainer');
    if (!sendBtn) return;
    sendBtn.disabled = false;
    sendBtn.textContent = streaming ? 'Ⅱ' : '➤';
    sendBtn.title = streaming ? 'Pause response' : 'Send';
}

function handleSendButton(windowType) {
    if (state.streaming[windowType]) {
        pauseAI(windowType);
        return;
    }
    sendToAI(windowType);
}

function pauseAI(windowType) {
    const controller = state.abortControllers[windowType];
    if (controller) {
        controller.abort();
        showToast('Paused response', 'success');
    }
}

async function regenerateAI(windowType) {
    if (state.streaming.main || state.streaming.explainer) { showToast('⏳ Pause the current response first', 'error'); return; }
    const history = state.activeProject?.[windowType] || [];
    const lastAssistantIndex = history?.[history.length - 1]?.role === 'assistant' ? history.length - 1 : -1;
    if (lastAssistantIndex === -1) { showToast('No AI response to regenerate', 'error'); return; }

    state.activeProject[windowType] = history.slice(0, lastAssistantIndex);
    renderChatHistory();
    await sendToAI(windowType, { regenerate: true });
}

async function deleteChatMessage(windowType, messageIndex) {
    if (!state.activeProjectId) return;
    if (state.streaming.main || state.streaming.explainer) { showToast('Pause the current response first', 'error'); return; }
    if (!confirm('Delete this message?')) return;

    try {
        const res = await fetch(`/api/projects/${state.activeProjectId}/chat/${windowType}/${messageIndex}`, { method: 'DELETE' });
        if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.detail || `HTTP ${res.status}`); }
        await loadActiveProject();
        showToast('Message deleted', 'success');
    } catch(e) {
        showToast('Delete failed: ' + e.message, 'error');
    }
}

async function sendToAI(windowType, options = {}) {
    const isRegenerate = !!options.regenerate;
    if (state.streaming.main || state.streaming.explainer) { showToast('⏳ AI still responding...', 'error'); return; }
    if (!state.activeProjectId) { showToast('📄 Upload a PDF first', 'error'); return; }

    const inputEl = safe$(windowType === 'main' ? '#input-main' : '#input-explainer');
    const messagesEl = safe$(windowType === 'main' ? '#messages-main' : '#messages-explainer');
    const sendBtn = safe$(windowType === 'main' ? '#btn-send-main' : '#btn-send-explainer');
    if (!inputEl || !messagesEl || !sendBtn) return;
    const message = isRegenerate
        ? [...(state.activeProject?.[windowType] || [])].reverse().find(t => t.role === 'user')?.content || ''
        : inputEl.value.trim();
    if (!message) return;

    const es = messagesEl.querySelector('.empty-state'); if (es) es.remove();
    if (!isRegenerate) {
        addChatBubble(messagesEl, message, 'user');
        inputEl.value = ''; inputEl.style.height = 'auto';
    }
    state.streaming[windowType] = true;
    const controller = new AbortController();
    state.abortControllers[windowType] = controller;
    setSendButtonState(windowType, true);

    const bubbleClass = windowType === 'main' ? 'ai ai-main' : 'ai ai-explainer';
    const label = windowType === 'main' ? 'Main AI' : 'Explainer AI';
    const sb = document.createElement('div'); sb.className = `chat-bubble ${bubbleClass}`;
    sb.innerHTML = `<div class="bubble-label">${label}</div><div class="bubble-text markdown-body"><span class="streaming-content"></span><span class="streaming-cursor"></span></div>`;
    messagesEl.appendChild(sb); messagesEl.scrollTop = messagesEl.scrollHeight;

    const cs = sb.querySelector('.streaming-content'), cursor = sb.querySelector('.streaming-cursor');
    let full = '';

    try {
        const endpoint = windowType === 'main' ? '/api/chat/main/stream' : '/api/chat/explainer/stream';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ message, project_id: state.activeProjectId, regenerate: isRegenerate }),
        });
        if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(err.detail || `HTTP ${res.status}`); }

        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n'); buf = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const d = JSON.parse(line.slice(6));
                        if (d.token) { full += d.token; if (cs) cs.innerHTML = renderMarkdown(full); messagesEl.scrollTop = messagesEl.scrollHeight; }
                        else if (d.done) { if (cursor) cursor.remove(); }
                        else if (d.error) { if (cs) cs.textContent = '❌ ' + d.error; if (cursor) cursor.remove(); sb.classList.add('error'); }
                    } catch(pe) {}
                }
            }
        }
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const bt = sb.querySelector('.bubble-text'); if (bt) bt.innerHTML = renderMarkdown(full);
        const timeEl = document.createElement('div'); timeEl.className = 'bubble-time'; timeEl.textContent = time;
        sb.appendChild(timeEl);
        await loadActiveProject();
    } catch(e) {
        if (e.name === 'AbortError') {
            if (cursor) cursor.remove();
            const bt = sb.querySelector('.bubble-text');
            if (bt) bt.innerHTML = full ? `${renderMarkdown(full)}<p class="paused-note">Paused</p>` : '<span class="paused-note">Paused before any text arrived.</span>';
            sb.classList.add('paused');
        } else {
            const bt = sb.querySelector('.bubble-text'); if (bt) bt.textContent = '❌ Error: ' + e.message;
            sb.classList.add('error'); if (cursor) cursor.remove();
            if (isRegenerate) await loadActiveProject();
        }
    } finally {
        state.streaming[windowType] = false;
        state.abortControllers[windowType] = null;
        setSendButtonState(windowType, false);
        inputEl.focus();
    }
}

function addChatBubble(container, text, type, options = {}) {
    const bubble = document.createElement('div'); bubble.className = `chat-bubble ${type}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const labels = { 'ai ai-main': 'Main AI', 'ai ai-explainer': 'Explainer AI', 'user': 'You' };
    const content = type === 'user' ? escHtml(text).replace(/\n/g, '<br>') : renderMarkdown(text);
    const canDelete = options.windowType && Number.isInteger(options.messageIndex);
    const canRegenerate = options.canRegenerate && type.startsWith('ai ');
    bubble.innerHTML = `
        ${labels[type] ? `<div class="bubble-label">${labels[type]}</div>` : ''}
        ${canDelete ? `<div class="bubble-actions">
            ${canRegenerate ? '<button class="bubble-action btn-regenerate" title="Regenerate response">↻</button>' : ''}
            <button class="bubble-action btn-delete-message" title="Delete message">×</button>
        </div>` : ''}
        <div class="bubble-text markdown-body">${content}</div>
        <div class="bubble-time">${time}</div>
    `;
    if (canDelete) {
        bubble.querySelector('.btn-delete-message')?.addEventListener('click', () => deleteChatMessage(options.windowType, options.messageIndex));
        bubble.querySelector('.btn-regenerate')?.addEventListener('click', () => regenerateAI(options.windowType));
    }
    container.appendChild(bubble);
    return bubble;
}

function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') try { return marked.parse(text); } catch(e) {}
    return escHtml(text).replace(/\n/g, '<br>');
}

// ═══════════ PDF UPLOAD ═══════════
async function uploadPDF(file) {
    if (!file) return;
    const empty = safe$('#pdf-empty'), iframe = safe$('#pdf-iframe'), rm = safe$('#read-mode');
    if (empty) empty.classList.add('hidden');
    if (iframe) iframe.style.display = 'none';
    if (rm) rm.classList.add('hidden');
    const fd = new FormData(); fd.append('file', file);
    try {
        const res = await fetch('/api/upload-pdf', { method: 'POST', body: fd });
        if (!res.ok) { const err = await res.json(); throw new Error(err.detail); }
        const d = await res.json();
        await loadProjects();
        showToast(`✅ "${d.project.name}" loaded`, 'success');
    } catch(e) { showToast(`❌ ${e.message}`, 'error'); if (empty) empty.classList.remove('hidden'); }
}

// ═══════════ WORD CARDS ═══════════
async function loadWordCards() {
    try { state.wordCards = await (await fetch('/api/word-cards')).json(); renderWordCards(); } catch(e) {}
}

function renderWordCards() {
    const list = safe$('#wordcards-list'), count = safe$('#card-count');
    if (!list) return;
    if (state.wordCards.length === 0) {
        list.innerHTML = '<p class="empty-state sub">Select text in PDF → click 💡 Explain</p>';
        if (count) count.textContent = '0'; return;
    }
    if (count) count.textContent = state.wordCards.length;
    list.innerHTML = state.wordCards.slice().reverse().map(c => `
        <div class="wordcard-item"><button class="wc-delete" data-id="${c.id}">🗑️</button>
        <div class="wc-word">${escHtml(c.word)}</div>
        <div class="wc-context">"...${escHtml(c.context_sentence)}..."</div>
        <div class="wc-explanation markdown-body">${renderMarkdown(c.explanation)}</div></div>
    `).join('');
    list.querySelectorAll('.wc-delete').forEach(btn => btn.addEventListener('click', () => deleteWordCard(parseInt(btn.dataset.id))));
}

async function deleteWordCard(id) { try { await fetch(`/api/word-cards/${id}`, { method: 'DELETE' }); await loadWordCards(); } catch(e) {} }
function toggleWordCards() { const p = safe$('#wordcards-panel'); if (p) p.classList.toggle('hidden'); }

// ═══════════ CHAT MINIMIZE ═══════════
function toggleChatMinimize() {
    state.chatMinimized = !state.chatMinimized;
    const section = safe$('#chat-section'), btn = safe$('#btn-minimize-chat');
    const pdfSection = safe$('#pdf-section'), divider = safe$('#main-divider');
    if (!section || !btn) return;
    if (state.chatMinimized) {
        section.classList.add('collapsed');
        btn.textContent = '▲';
        if (pdfSection) pdfSection.style.flex = '1 1 auto';
        if (divider) divider.style.display = 'none';
    } else {
        section.classList.remove('collapsed');
        btn.textContent = '▼';
        if (pdfSection) pdfSection.style.flex = '0 1 55%';
        if (divider) divider.style.display = '';
        section.style.flex = '0 0 45%';
    }
}

// ═══════════ DIVIDERS ═══════════
function startResizeDrag(e, divider, resizeClass, updateSize) {
    if (e.button !== undefined && e.button !== 0) return;

    e.preventDefault();
    state.isResizing = true;
    divider.classList.add('active');
    document.body.classList.add('resizing', resizeClass);
    try { divider.setPointerCapture?.(e.pointerId); } catch(e) {}

    let rafId = null;
    let latestEvent = e;

    function applyResize() {
        rafId = null;
        updateSize(latestEvent);
    }

    function move(ev) {
        if (!state.isResizing) return;
        latestEvent = ev;
        if (rafId === null) rafId = requestAnimationFrame(applyResize);
    }

    function up(ev) {
        state.isResizing = false;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            updateSize(latestEvent);
        }
        try {
            if (divider.hasPointerCapture?.(ev.pointerId)) divider.releasePointerCapture(ev.pointerId);
        } catch(e) {}
        divider.classList.remove('active');
        document.body.classList.remove('resizing', resizeClass);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
}

function setupDividers() {
    const mainDiv = safe$('#main-divider');
    if (mainDiv) {
        mainDiv.addEventListener('pointerdown', (e) => {
            if (state.chatMinimized) return;
            const pdfS = safe$('#pdf-section'), chatS = safe$('#chat-section');
            const mainArea = safe$('#main-area');
            if (!pdfS || !chatS || !mainArea) return;
            const containerH = mainArea.getBoundingClientRect().height;
            if (containerH <= 0) return;
            const startY = e.clientY;
            const startPdfH = pdfS.getBoundingClientRect().height;
            const minSectionH = Math.min(100, containerH / 2);
            startResizeDrag(e, mainDiv, 'resizing-main', (ev) => {
                const dy = ev.clientY - startY;
                const maxPdfH = containerH - minSectionH;
                const newPdfH = Math.min(Math.max(minSectionH, startPdfH + dy), maxPdfH);
                const newChatH = containerH - newPdfH;
                pdfS.style.flex = `0 1 ${(newPdfH / containerH) * 100}%`;
                chatS.style.flex = `0 0 ${(newChatH / containerH) * 100}%`;
            });
        });
    }

    const chatDiv = safe$('#chat-divider');
    if (chatDiv) {
        chatDiv.addEventListener('pointerdown', (e) => {
            const mainP = safe$('#chat-panel-main'), expP = safe$('#chat-panel-explainer');
            const chatContent = safe$('#chat-section-content');
            if (!mainP || !expP || !chatContent) return;
            const containerW = chatContent.getBoundingClientRect().width;
            if (containerW <= 0) return;
            const startX = e.clientX;
            const startMainW = mainP.getBoundingClientRect().width;
            const minPanelW = Math.min(200, containerW / 2);
            startResizeDrag(e, chatDiv, 'resizing-chat', (ev) => {
                const dx = ev.clientX - startX;
                const maxMainW = containerW - minPanelW;
                const newMainW = Math.min(Math.max(minPanelW, startMainW + dx), maxMainW);
                const newExpW = containerW - newMainW;
                mainP.style.flex = `0 1 ${(newMainW / containerW) * 100}%`;
                expP.style.flex = `0 1 ${(newExpW / containerW) * 100}%`;
            });
        });
    }
}

function setupDragDrop() {
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.pdf')) uploadPDF(f); });
}

// ═══════════ EVENT LISTENERS ═══════════
function setupEventListeners() {
    function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

    on(safe$('#sidebar-toggle'), 'click', toggleSidebar);
    on(safe$('#btn-upload-sidebar'), 'click', () => { const fi = safe$('#file-input'); if (fi) fi.click(); collapseSidebar(); });
    on(safe$('#file-input'), 'change', e => { if (e.target.files[0]) uploadPDF(e.target.files[0]); });
    on(safe$('#btn-toggle-readmode'), 'click', toggleReadMode);
    on(safe$('#btn-explain-selection'), 'pointerdown', e => {
        e.preventDefault();
        cachePDFSelection(true);
    });
    on(safe$('#btn-explain-selection'), 'click', () => explainPDFSelection({ preferClipboard: true }));
    on(safe$('#btn-selection-popover-explain'), 'click', () => explainPDFSelection());
    on(safe$('#btn-wordcards'), 'click', toggleWordCards);
    on(safe$('#btn-wordcards-close'), 'click', () => { const p = safe$('#wordcards-panel'); if (p) p.classList.add('hidden'); });
    on(safe$('#btn-minimize-chat'), 'click', toggleChatMinimize);
    on(safe$('#explain-close'), 'click', () => { const r = safe$('#explain-result'); if (r) r.classList.add('hidden'); });
    on(safe$('#explain-result'), 'click', function(e) { if (e.target === this) this.classList.add('hidden'); });

    on(safe$('#btn-settings-sidebar'), 'click', () => { const o = safe$('#settings-overlay'); if (o) o.classList.remove('hidden'); });
    on(safe$('#btn-settings-close'), 'click', () => { const o = safe$('#settings-overlay'); if (o) o.classList.add('hidden'); });
    let settingsBackdropDown = false;
    on(safe$('#settings-overlay'), 'pointerdown', function(e) { settingsBackdropDown = e.target === this; });
    on(safe$('#settings-overlay'), 'click', function(e) {
        if (settingsBackdropDown && e.target === this && !window.getSelection()?.toString()) this.classList.add('hidden');
        settingsBackdropDown = false;
    });
    on(safe$('#btn-save-settings'), 'click', saveSettings);
    on(safe$('#provider-select'), 'change', e => applyProviderPreset(e.target.value, true));
    on(safe$('#main-model-select'), 'focus', e => { e.target.dataset.previousValue = e.target.value; });
    on(safe$('#main-model-select'), 'change', e => handleModelSelectChange(e.target));
    on(safe$('#explainer-model-select'), 'focus', e => { e.target.dataset.previousValue = e.target.value; });
    on(safe$('#explainer-model-select'), 'change', e => handleModelSelectChange(e.target));

    on(safe$('#btn-send-main'), 'click', () => handleSendButton('main'));
    on(safe$('#input-main'), 'keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToAI('main'); }});
    on(safe$('#input-main'), 'input', () => { const el = safe$('#input-main'); if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }});

    on(safe$('#btn-send-explainer'), 'click', () => handleSendButton('explainer'));
    on(safe$('#input-explainer'), 'keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToAI('explainer'); }});
    on(safe$('#input-explainer'), 'input', () => { const el = safe$('#input-explainer'); if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }});

    on(document, 'mouseup', maybeShowDocumentSelectionPopover);
    on(safe$('#read-mode'), 'scroll', hideSelectionPopover);
    on(document, 'mousedown', e => {
        const pop = safe$('#selection-popover');
        if (pop && !pop.contains(e.target) && e.target !== safe$('#btn-explain-selection')) hideSelectionPopover();
    });
    on(document, 'scroll', hideSelectionPopover);

    // Keyboard shortcuts
    on(document, 'keydown', e => {
        if (e.key === 'Escape') {
            const er = safe$('#explain-result'); if (er) er.classList.add('hidden');
            const so = safe$('#settings-overlay'); if (so) so.classList.add('hidden');
            hideSelectionPopover();
            collapseSidebar();
        }
        // Cmd+E or Ctrl+E = Explain selection
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
            e.preventDefault();
            explainPDFSelection({ preferClipboard: true });
        }
    }, true);
}

// ═══════════ HELPERS ═══════════
function escHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function tokenize(text) {
    const tokens = []; const re = /([a-zA-Z0-9\u00C0-\u024F\-']+)|([^a-zA-Z0-9\u00C0-\u024F\-']+)/g; let m;
    while ((m = re.exec(text)) !== null) tokens.push(m[1] ? { type: 'word', value: m[1] } : { type: 'punct', value: m[2] });
    return tokens;
}
function showToast(msg, type = 'success') {
    const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
