"""
AI Paper Reader v3 - PDF-Linked Projects + Per-Window Model Selection
"""

import json
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse, FileResponse
from pydantic import BaseModel
from openai import OpenAI
import PyPDF2

# ─── Config ────────────────────────────────────────────────
DATA_DIR = Path("data")
UPLOAD_DIR = Path("uploads")
PROJECTS_DIR = DATA_DIR / "projects"
for d in [DATA_DIR, UPLOAD_DIR, PROJECTS_DIR]:
    d.mkdir(exist_ok=True)

SETTINGS_FILE = DATA_DIR / "settings.json"
PROJECTS_INDEX = DATA_DIR / "projects_index.json"
WORD_CARDS_FILE = DATA_DIR / "word_cards.json"

app = FastAPI(title="AI Paper Reader", version="3.0.0")
app.mount("/static", StaticFiles(directory="static"), name="static")


# ─── Models ────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    project_id: Optional[str] = None


class ExplainWordRequest(BaseModel):
    word: str
    context_sentence: str
    pdf_context: Optional[str] = None
    conversation_context: Optional[str] = None
    project_id: Optional[str] = None


class SettingsUpdate(BaseModel):
    api_key: Optional[str] = None
    main_model: Optional[str] = "deepseek-chat"
    explainer_model: Optional[str] = "deepseek-chat"
    layout: Optional[str] = "horizontal"
    sync_mode: Optional[str] = "latest_only"
    active_project_id: Optional[str] = None


# ─── Helpers ───────────────────────────────────────────────
def load_json(fp: Path, default=None):
    if default is None: default = {}
    if fp.exists():
        with open(fp) as f:
            return json.load(f)
    return default


def save_json(fp: Path, data):
    fp.parent.mkdir(parents=True, exist_ok=True)
    with open(fp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_settings():
    return load_json(SETTINGS_FILE, {
        "api_key": "", "main_model": "deepseek-chat",
        "explainer_model": "deepseek-chat", "layout": "horizontal",
        "sync_mode": "latest_only", "active_project_id": ""
    })


def get_client(model: str = "deepseek-chat"):
    settings = get_settings()
    api_key = settings.get("api_key", "")
    if not api_key:
        raise HTTPException(400, "API key not set.")
    return OpenAI(api_key=api_key, base_url="https://api.deepseek.com"), model


def extract_pdf_text(filepath: Path) -> str:
    parts = []
    with open(filepath, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        for i, page in enumerate(reader.pages):
            t = page.extract_text()
            if t:
                parts.append(f"[Page {i+1}]\n{t}")
    full = "\n\n".join(parts)
    return full[:50000] + ("\n\n[Truncated...]" if len(full) > 50000 else "")


def get_projects_index():
    return load_json(PROJECTS_INDEX, {"projects": []})


def save_projects_index(idx):
    save_json(PROJECTS_INDEX, idx)


def get_project_dir(pid: str) -> Path:
    return PROJECTS_DIR / pid


def load_project(pid: str):
    d = get_project_dir(pid)
    if not d.exists():
        return None
    return {
        "id": pid,
        "name": load_json(d / "meta.json", {}).get("name", "Unknown"),
        "pdf_filename": load_json(d / "meta.json", {}).get("pdf_filename", ""),
        "main": load_json(d / "main.json", []),
        "explainer": load_json(d / "explainer.json", []),
        "created_at": load_json(d / "meta.json", {}).get("created_at", ""),
        "pdf_context": load_json(d / "meta.json", {}).get("pdf_context", ""),
    }


def save_project(pid: str, data: dict):
    d = get_project_dir(pid)
    d.mkdir(parents=True, exist_ok=True)
    save_json(d / "meta.json", {
        "name": data.get("name", ""),
        "pdf_filename": data.get("pdf_filename", ""),
        "created_at": data.get("created_at", ""),
        "pdf_context": data.get("pdf_context", ""),
    })
    save_json(d / "main.json", data.get("main", []))
    save_json(d / "explainer.json", data.get("explainer", []))


def get_active_project():
    settings = get_settings()
    aid = settings.get("active_project_id", "")
    if aid:
        p = load_project(aid)
        if p:
            return p
    return None


# ─── Migrate old data ──────────────────────────────────────
def migrate_v2():
    old_conv = DATA_DIR / "conversations"
    if old_conv.exists() and not (PROJECTS_DIR / "_migrated").exists():
        idx_file = old_conv / "index.json"
        if idx_file.exists():
            old_idx = load_json(idx_file, {"conversations": [], "active_id": ""})
            for c in old_idx.get("conversations", []):
                cf = old_conv / f"{c['id']}.json"
                if cf.exists():
                    oc = load_json(cf, {})
                    pid = c["id"]
                    pd = get_project_dir(pid)
                    pd.mkdir(parents=True, exist_ok=True)
                    save_json(pd / "meta.json", {
                        "name": c.get("name", "Migrated"),
                        "pdf_filename": "",
                        "created_at": c.get("created_at", datetime.now().isoformat()),
                        "pdf_context": "",
                    })
                    save_json(pd / "main.json", oc.get("main", []))
                    save_json(pd / "explainer.json", oc.get("explainer", []))
            # Add to projects index
            idx = get_projects_index()
            existing_ids = {p["id"] for p in idx["projects"]}
            for c in old_idx.get("conversations", []):
                if c["id"] not in existing_ids:
                    idx["projects"].append({
                        "id": c["id"],
                        "name": c.get("name", "Migrated"),
                        "pdf_filename": "",
                        "created_at": c.get("created_at", datetime.now().isoformat())
                    })
            idx["active_project_id"] = old_idx.get("active_id", "")
            save_projects_index(idx)
            settings = get_settings()
            settings["active_project_id"] = old_idx.get("active_id", "")
            save_json(SETTINGS_FILE, settings)
        (PROJECTS_DIR / "_migrated").touch()


migrate_v2()


# ═══════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")


@app.get("/api/status")
async def status():
    s = get_settings()
    return {
        "running": True,
        "api_key_set": bool(s.get("api_key")),
        "main_model": s.get("main_model", "deepseek-chat"),
        "explainer_model": s.get("explainer_model", "deepseek-chat"),
        "layout": s.get("layout", "horizontal"),
        "sync_mode": s.get("sync_mode", "latest_only"),
        "active_project_id": s.get("active_project_id", ""),
    }


@app.get("/api/settings")
async def get_settings_route():
    return get_settings()


@app.post("/api/settings")
async def update_settings(u: SettingsUpdate):
    s = get_settings()
    if u.api_key is not None: s["api_key"] = u.api_key
    if u.main_model is not None: s["main_model"] = u.main_model
    if u.explainer_model is not None: s["explainer_model"] = u.explainer_model
    if u.layout is not None: s["layout"] = u.layout
    if u.sync_mode is not None: s["sync_mode"] = u.sync_mode
    if u.active_project_id is not None: s["active_project_id"] = u.active_project_id
    save_json(SETTINGS_FILE, s)
    return {"status": "ok", "api_key_set": bool(s.get("api_key"))}


# ─── PDF Upload ───────────────────────────────────────────
@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF files supported.")

    # Save file
    safe_name = file.filename.replace("/", "_").replace("\\", "_")
    filepath = UPLOAD_DIR / safe_name
    with open(filepath, "wb") as f:
        f.write(await file.read())

    # Extract text
    try:
        pdf_text = extract_pdf_text(filepath)
    except Exception as e:
        raise HTTPException(500, f"PDF extraction failed: {e}")

    # Create project
    pid = uuid.uuid4().hex[:12]
    now = datetime.now().isoformat()
    name = file.filename.replace(".pdf", "")[:60]

    data = {
        "name": name,
        "pdf_filename": safe_name,
        "created_at": now,
        "pdf_context": pdf_text,
        "main": [],
        "explainer": [],
    }
    save_project(pid, data)

    # Add to index
    idx = get_projects_index()
    idx["projects"].append({
        "id": pid, "name": name,
        "pdf_filename": safe_name, "created_at": now,
    })
    idx["active_project_id"] = pid
    save_projects_index(idx)

    # Set active
    s = get_settings()
    s["active_project_id"] = pid
    save_json(SETTINGS_FILE, s)

    return {
        "status": "ok",
        "project": {"id": pid, "name": name, "pdf_filename": safe_name},
        "page_count": len(pdf_text.split("[Page ")) - 1,
        "preview": pdf_text[:2000] + ("..." if len(pdf_text) > 2000 else ""),
    }


@app.get("/api/pdf-file/{filename}")
async def serve_pdf(filename: str):
    """Serve the actual PDF file for PDF.js rendering."""
    fp = UPLOAD_DIR / filename
    if not fp.exists():
        raise HTTPException(404, "PDF not found")
    return FileResponse(fp, media_type="application/pdf")


@app.get("/api/pdf-context/{project_id}")
async def get_pdf_context(project_id: str):
    p = load_project(project_id)
    if not p:
        return {"text": "", "exists": False}
    return {"text": p.get("pdf_context", ""), "exists": True}


# ─── Projects ─────────────────────────────────────────────
@app.get("/api/projects")
async def list_projects():
    idx = get_projects_index()
    return {
        "projects": idx.get("projects", []),
        "active_id": get_settings().get("active_project_id", ""),
    }


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    p = load_project(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@app.post("/api/projects/{project_id}/activate")
async def activate_project(project_id: str):
    p = load_project(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    s = get_settings()
    s["active_project_id"] = project_id
    save_json(SETTINGS_FILE, s)
    idx = get_projects_index()
    idx["active_project_id"] = project_id
    save_projects_index(idx)
    return {"status": "ok"}


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    idx = get_projects_index()
    idx["projects"] = [p for p in idx.get("projects", []) if p["id"] != project_id]
    if idx.get("active_project_id") == project_id:
        idx["active_project_id"] = idx["projects"][0]["id"] if idx["projects"] else ""
    save_projects_index(idx)

    s = get_settings()
    if s.get("active_project_id") == project_id:
        s["active_project_id"] = idx.get("active_project_id", "")
    save_json(SETTINGS_FILE, s)

    # Delete project dir
    import shutil
    pd = get_project_dir(project_id)
    if pd.exists():
        shutil.rmtree(pd)

    return {"status": "ok"}


# ─── Streaming Chat ───────────────────────────────────────
@app.post("/api/chat/main/stream")
async def chat_main_stream(req: ChatRequest):
    s = get_settings()
    model = s.get("main_model", "deepseek-chat")
    client, _ = get_client(model)
    sync_mode = s.get("sync_mode", "latest_only")

    pid = req.project_id or s.get("active_project_id", "")
    project = load_project(pid) if pid else None
    pdf_text = project.get("pdf_context", "") if project else ""

    system = """You are a knowledgeable AI research assistant. Discuss the document thoroughly.
Answer questions, provide analysis, cite sections. Be natural and engaging.
If no document is loaded, have a normal helpful conversation."""

    messages = [{"role": "system", "content": system}]
    if pdf_text:
        messages.append({"role": "system", "content": f"Document:\n\n{pdf_text[:30000]}"})

    # Two-way sync
    if sync_mode == "two_way" and project:
        eh = project.get("explainer", [])
        if eh:
            ctx = "\n".join([f"[{t['role']}]: {t['content'][:500]}" for t in eh[-8:]])
            messages.append({"role": "system", "content": f"Explainer discussion:\n{ctx}"})

    # History
    for turn in (project.get("main", []) if project else [])[-12:]:
        messages.append({"role": turn["role"], "content": turn["content"]})

    messages.append({"role": "user", "content": req.message})

    try:
        stream = client.chat.completions.create(
            model=model, messages=messages, stream=True,
            temperature=0.7, max_tokens=2000
        )

        def gen():
            full = ""
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    t = chunk.choices[0].delta.content
                    full += t
                    yield f"data: {json.dumps({'token': t})}\n\n"
            if project:
                project["main"].append({"role": "user", "content": req.message})
                project["main"].append({"role": "assistant", "content": full})
                save_project(pid, project)
            yield f"data: {json.dumps({'done': True})}\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")
    except Exception as e:
        def err_gen():
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")


@app.post("/api/chat/explainer/stream")
async def chat_explainer_stream(req: ChatRequest):
    s = get_settings()
    model = s.get("explainer_model", "deepseek-chat")
    client, _ = get_client(model)
    sync_mode = s.get("sync_mode", "latest_only")

    pid = req.project_id or s.get("active_project_id", "")
    project = load_project(pid) if pid else None
    pdf_text = project.get("pdf_context", "") if project else ""

    system = """You are a concise explainer. Keep responses SHORT — 2-4 sentences max unless told to say more.
Rules:
- Define terms in one sentence
- Give ONE example, not multiple
"""
    messages = [{"role": "system", "content": system}]
    if pdf_text:
        messages.append({"role": "system", "content": f"Document context:\n{pdf_text[:20000]}"})

    # Sync
    mh = project.get("main", []) if project else []
    if sync_mode == "latest_only":
        last = ""
        for turn in reversed(mh):
            if turn["role"] == "assistant":
                last = turn["content"]
                break
        if last:
            messages.append({"role": "system", "content": f"Main AI just said:\n{last[:3000]}"})
    elif sync_mode in ("full_history", "two_way"):
        if mh:
            ctx = "\n\n".join([f"[{t['role']}]: {t['content'][:800]}" for t in mh[-10:]])
            messages.append({"role": "system", "content": f"Full Main AI conversation:\n{ctx}"})

    # History
    for turn in (project.get("explainer", []) if project else [])[-8:]:
        messages.append({"role": turn["role"], "content": turn["content"]})

    messages.append({"role": "user", "content": req.message})

    try:
        stream = client.chat.completions.create(
            model=model, messages=messages, stream=True,
            temperature=0.7, max_tokens=1500
        )

        def gen():
            full = ""
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    t = chunk.choices[0].delta.content
                    full += t
                    yield f"data: {json.dumps({'token': t})}\n\n"
            if project:
                project["explainer"].append({"role": "user", "content": req.message})
                project["explainer"].append({"role": "assistant", "content": full})
                save_project(pid, project)
            yield f"data: {json.dumps({'done': True})}\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")
    except Exception as e:
        def err_gen():
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")


# ─── Word Cards ────────────────────────────────────────────
@app.post("/api/explain-word")
async def explain_word(req: ExplainWordRequest):
    s = get_settings()
    model = s.get("explainer_model", "deepseek-chat")
    client, _ = get_client(model)

    prompt = f"""Explain this word in context.

WORD: "{req.word}"
CONTEXT: "{req.context_sentence}"
{f"DOCUMENT: {req.pdf_context[:3000]}" if req.pdf_context else ""}
{f"CONVERSATION: {req.conversation_context[:2000]}" if req.conversation_context else ""}

Provide: 1) Definition as used here 2) Why it matters 3) Example 4) Related terms
Under 200 words. Plain language."""

    try:
        resp = client.chat.completions.create(
            model=model, messages=[{"role": "user", "content": prompt}],
            temperature=0.5, max_tokens=500
        )
        explanation = resp.choices[0].message.content
        cards = load_json(WORD_CARDS_FILE, [])
        card = {
            "id": len(cards) + 1,
            "word": req.word,
            "context_sentence": req.context_sentence,
            "explanation": explanation,
            "timestamp": datetime.now().isoformat(),
            "pdf_source": req.pdf_context[:200] if req.pdf_context else "",
            "conversation_context": req.conversation_context[:200] if req.conversation_context else "",
        }
        cards.append(card)
        save_json(WORD_CARDS_FILE, cards)
        return {"explanation": explanation, "word_card": card}
    except Exception as e:
        raise HTTPException(500, f"API error: {e}")


@app.get("/api/word-cards")
async def get_word_cards():
    return load_json(WORD_CARDS_FILE, [])


@app.delete("/api/word-cards/{card_id}")
async def delete_word_card(card_id: int):
    cards = load_json(WORD_CARDS_FILE, [])
    cards = [c for c in cards if c["id"] != card_id]
    save_json(WORD_CARDS_FILE, cards)
    return {"status": "ok"}
# Add this before the Startup section:
@app.get("/api/pdf-file/{filename}")
async def serve_pdf(filename: str):
    """Serve the actual PDF file for PDF.js rendering."""
    fp = UPLOAD_DIR / filename

# ─── Startup ───────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn, webbrowser
    webbrowser.open("http://localhost:8000/static/index.html")
    uvicorn.run(app, host="127.0.0.1", port=8000)
