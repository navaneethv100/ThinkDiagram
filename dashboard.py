"""
UPSC Diagram Tool — three-page Flask app.
  /           → Dashboard  (review & remake all 73 diagrams)
  /generate   → Quick Generate  (describe → Stage 1 → Stage 2 → image)
  /bucket     → Bucket  (saved images, download individual or all as ZIP)

Usage:  python3 dashboard.py
        open  http://localhost:5001
"""

import csv
import io
import json
import re
import threading
import time
import uuid
import warnings
import zipfile
from pathlib import Path

warnings.filterwarnings("ignore")

from flask import Flask, jsonify, request, send_file
from google import genai
from google.genai import types
from google.oauth2 import service_account
from PIL import Image

# ── Config ────────────────────────────────────────────────────────────────────
CREDENTIALS_PATH   = "credentials/google_credentials.json"
NB2_MODEL          = "publishers/google/models/gemini-3.1-flash-image-preview"
GEMINI_MODEL       = "publishers/google/models/gemini-3.1-pro-preview"
LOCATION           = "global"
CSV_FILE           = "DiagramsMakingSheet.csv"
STAGE1_PROMPT_FILE = "stage1_gemini_prompt_generator.txt"
STAGE2_PROMPT_FILE = "stage2_nanoBanana_image_generator.txt"
OUTPUT_DIR         = Path("FinalDiagrams")
QUICK_DIR          = Path("QuickGenerated")
BIN_DIR            = Path("bin")
BUCKET_FILE        = Path("bucket.json")
CASE_STUDY_CUTOFF  = 74
TARGET_W, TARGET_H = 1024, 768

app = Flask(__name__)

# ── Vertex AI client (lazy singleton) ────────────────────────────────────────
_client      = None
_client_lock = threading.Lock()

def get_client():
    global _client
    with _client_lock:
        if _client is None:
            creds = service_account.Credentials.from_service_account_file(
                CREDENTIALS_PATH,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
            pid = json.load(open(CREDENTIALS_PATH))["project_id"]
            _client = genai.Client(
                vertexai=True, project=pid, location=LOCATION, credentials=creds
            )
    return _client

# ── CSV helpers ───────────────────────────────────────────────────────────────
_csv_lock = threading.Lock()

def read_csv():
    with open(CSV_FILE, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return list(r.fieldnames or []), list(r)

def write_csv(fieldnames, rows):
    with _csv_lock:
        with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(rows)

# ── Image helpers ─────────────────────────────────────────────────────────────
def build_filename(row):
    year  = row["Year"].strip()
    sl    = row["SL_NO"].strip()
    dname = row.get("Diagram_Name", "").strip() or f"SL{sl}"
    return OUTPUT_DIR / f"{year}_{sl}_{dname}.png"

def convert_to_4x3(img_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img.thumbnail((TARGET_W, TARGET_H), Image.LANCZOS)
    canvas = Image.new("RGB", (TARGET_W, TARGET_H), (255, 255, 255))
    x = (TARGET_W - img.width) // 2
    y = (TARGET_H - img.height) // 2
    canvas.paste(img, (x, y))
    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

# ── Bucket helpers ────────────────────────────────────────────────────────────
_bucket_lock = threading.Lock()

def read_bucket():
    if not BUCKET_FILE.exists():
        return []
    with open(BUCKET_FILE, encoding="utf-8") as f:
        return json.load(f)

def write_bucket(items):
    with _bucket_lock:
        with open(BUCKET_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=2)

# ── Stage-1 remake job tracker ────────────────────────────────────────────────
_jobs      = {}
_jobs_lock = threading.Lock()

def _set_status(sl_no, status):
    with _jobs_lock:
        _jobs[sl_no] = {"status": status}

def _get_status(sl_no):
    with _jobs_lock:
        return _jobs.get(sl_no, {"status": "idle"})

# ── Stage 1: Gemini → NanoBanana prompt ──────────────────────────────────────
def run_stage1(question: str, extra: str) -> str:
    sys_prompt = Path(STAGE1_PROMPT_FILE).read_text().strip()
    content    = f"Question:\n{question}"
    if extra:
        content += f"\n\nSpecial Instructions from user: {extra}"

    resp = get_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=content,
        config=types.GenerateContentConfig(
            system_instruction=sys_prompt,
            temperature=0.2,
            max_output_tokens=4096,
        ),
    )
    text = "".join(
        p.text for p in resp.candidates[0].content.parts if getattr(p, "text", None)
    )
    m = re.search(r"NanoBanana Input:\s*\n([\s\S]+?)(?:\n\nGoal:|\Z)", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    paras = [p.strip() for p in text.strip().split("\n\n")
             if p.strip() and not p.strip().startswith("Question:") and len(p.strip()) > 40]
    return paras[-1] if paras else text.strip()

# ── Stage 2: image bytes from NanoBanana ─────────────────────────────────────
def run_stage2(nb_prompt: str) -> bytes:
    sys_prompt  = Path(STAGE2_PROMPT_FILE).read_text().strip()
    full_prompt = f"{sys_prompt}\n\n{nb_prompt}"
    resp = get_client().models.generate_content(
        model=NB2_MODEL,
        contents=full_prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            temperature=1.0,
        ),
    )
    img_bytes = None
    for cand in (resp.candidates or []):
        if cand.content and cand.content.parts:
            for part in cand.content.parts:
                if part.inline_data and part.inline_data.data:
                    img_bytes = part.inline_data.data
                    break
        if img_bytes:
            break
    if not img_bytes:
        raise RuntimeError("Model returned no image — try again")
    return convert_to_4x3(img_bytes)

# ── Background: diagram remake ────────────────────────────────────────────────
def _regenerate(sl_no: str, prompt: str, output_path: Path):
    _set_status(sl_no, "generating")
    try:
        img_bytes = run_stage2(prompt)
        if output_path.exists():
            BIN_DIR.mkdir(exist_ok=True)
            ts = time.strftime("%Y%m%d_%H%M%S")
            output_path.rename(BIN_DIR / f"{output_path.stem}_{ts}.png")
        output_path.write_bytes(img_bytes)
        fieldnames, rows = read_csv()
        for r in rows:
            if r["SL_NO"].strip() == sl_no:
                r["NanoBanana_Prompt"] = prompt
                break
        write_csv(fieldnames, rows)
        _set_status(sl_no, "done")
    except Exception as e:
        _set_status(sl_no, f"error:{e}")

# ── Background: quick generate ────────────────────────────────────────────────
_quick_jobs      = {}
_quick_jobs_lock = threading.Lock()

def _qset(job_id, **kw):
    with _quick_jobs_lock:
        _quick_jobs.setdefault(job_id, {}).update(kw)

def _run_quick(job_id: str, description: str, diagram_type: str):
    _qset(job_id, status="stage1", stage1_prompt=None, image_file=None,
          description=description, diagram_type=diagram_type)
    try:
        extra     = f"Diagram type: {diagram_type}" if diagram_type else ""
        nb_prompt = run_stage1(description, extra)
        _qset(job_id, status="stage2", stage1_prompt=nb_prompt)

        QUICK_DIR.mkdir(exist_ok=True)
        ts       = time.strftime("%Y%m%d_%H%M%S")
        filename = f"quick_{ts}_{job_id[:6]}.png"
        (QUICK_DIR / filename).write_bytes(run_stage2(nb_prompt))
        _qset(job_id, status="done", image_file=filename)
    except Exception as e:
        _qset(job_id, status="error", error=str(e))

def _run_quick_stage2_only(job_id: str, nb_prompt: str):
    _qset(job_id, status="stage2", stage1_prompt=nb_prompt, image_file=None)
    try:
        QUICK_DIR.mkdir(exist_ok=True)
        ts       = time.strftime("%Y%m%d_%H%M%S")
        filename = f"quick_{ts}_{job_id[:6]}.png"
        (QUICK_DIR / filename).write_bytes(run_stage2(nb_prompt))
        _qset(job_id, status="done", image_file=filename)
    except Exception as e:
        _qset(job_id, status="error", error=str(e))

# ═══════════════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════════════

# ── Pages ─────────────────────────────────────────────────────────────────────
@app.route("/")
def page_dashboard():
    return DASHBOARD_HTML

@app.route("/generate")
def page_generate():
    return GENERATE_HTML

@app.route("/bucket")
def page_bucket():
    return BUCKET_HTML

# ── Static assets ─────────────────────────────────────────────────────────────
@app.route("/images/<path:filename>")
def serve_image(filename):
    path = OUTPUT_DIR / filename
    return send_file(path, mimetype="image/png") if path.exists() else ("", 404)

@app.route("/quick-images/<path:filename>")
def serve_quick_image(filename):
    path = QUICK_DIR / filename
    return send_file(path, mimetype="image/png") if path.exists() else ("", 404)

# ── Diagrams API ──────────────────────────────────────────────────────────────
@app.route("/api/diagrams")
def api_diagrams():
    _, rows = read_csv()
    out = []
    for r in rows:
        try:
            sl = int(r["SL_NO"].strip())
        except ValueError:
            continue
        if sl >= CASE_STUDY_CUTOFF:
            continue
        path = build_filename(r)
        out.append({
            "sl_no":              r["SL_NO"].strip(),
            "year":               r.get("Year", "").strip(),
            "question":           r.get("Questions", "").strip(),
            "prompt":             r.get("NanoBanana_Prompt", "").strip(),
            "extra_instructions": r.get("Extra_Instructions", "").strip(),
            "diagram_name":       r.get("Diagram_Name", "").strip(),
            "image_file":         path.name if path.exists() else None,
        })
    return jsonify(out)

@app.route("/api/system-prompt", methods=["GET", "POST"])
def system_prompt_route():
    stage = request.args.get("stage", "2")
    path  = Path(STAGE1_PROMPT_FILE if stage == "1" else STAGE2_PROMPT_FILE)
    if request.method == "GET":
        return jsonify({"content": path.read_text()})
    path.write_text((request.get_json() or {}).get("content", ""), encoding="utf-8")
    return jsonify({"ok": True})

@app.route("/api/regen-prompt/<sl_no>", methods=["POST"])
def regen_prompt(sl_no):
    data  = request.get_json() or {}
    extra = data.get("extra_instructions", "").strip()
    fieldnames, rows = read_csv()
    if "Extra_Instructions" not in fieldnames:
        fieldnames = list(fieldnames) + ["Extra_Instructions"]
        for r in rows:
            r.setdefault("Extra_Instructions", "")
    target_row = None
    for r in rows:
        if r["SL_NO"].strip() == sl_no:
            target_row = r
            r["Extra_Instructions"] = extra
            break
    if not target_row:
        return jsonify({"error": "not found"}), 404
    write_csv(fieldnames, rows)
    try:
        return jsonify({"prompt": run_stage1(target_row.get("Questions", ""), extra)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/save-prompt/<sl_no>", methods=["POST"])
def save_prompt(sl_no):
    data   = request.get_json() or {}
    prompt = data.get("prompt", "")
    extra  = data.get("extra_instructions", None)
    fieldnames, rows = read_csv()
    if extra is not None and "Extra_Instructions" not in fieldnames:
        fieldnames = list(fieldnames) + ["Extra_Instructions"]
        for r in rows:
            r.setdefault("Extra_Instructions", "")
    for r in rows:
        if r["SL_NO"].strip() == sl_no:
            r["NanoBanana_Prompt"] = prompt
            if extra is not None:
                r["Extra_Instructions"] = extra
            write_csv(fieldnames, rows)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/remake/<sl_no>", methods=["POST"])
def remake(sl_no):
    if _get_status(sl_no)["status"] == "generating":
        return jsonify({"error": "already generating"}), 409
    prompt = (request.get_json() or {}).get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "prompt required"}), 400
    fieldnames, rows = read_csv()
    target_row = next((r for r in rows if r["SL_NO"].strip() == sl_no), None)
    if not target_row:
        return jsonify({"error": "not found"}), 404
    threading.Thread(
        target=_regenerate, args=(sl_no, prompt, build_filename(target_row)), daemon=True
    ).start()
    return jsonify({"status": "started"})

@app.route("/api/status/<sl_no>")
def job_status(sl_no):
    return jsonify(_get_status(sl_no))

# ── Quick Generate API ────────────────────────────────────────────────────────
@app.route("/api/quick-generate", methods=["POST"])
def quick_generate():
    data         = request.get_json() or {}
    description  = data.get("description", "").strip()
    diagram_type = data.get("diagram_type", "").strip()
    if not description:
        return jsonify({"error": "description is required"}), 400
    job_id = str(uuid.uuid4())
    threading.Thread(
        target=_run_quick, args=(job_id, description, diagram_type), daemon=True
    ).start()
    return jsonify({"job_id": job_id})

@app.route("/api/quick-status/<job_id>")
def quick_status(job_id):
    with _quick_jobs_lock:
        return jsonify(_quick_jobs.get(job_id, {"status": "not_found"}))

@app.route("/api/quick-regen", methods=["POST"])
def quick_regen():
    data      = request.get_json() or {}
    nb_prompt = data.get("nb_prompt", "").strip()
    if not nb_prompt:
        return jsonify({"error": "nb_prompt is required"}), 400
    job_id = str(uuid.uuid4())
    threading.Thread(
        target=_run_quick_stage2_only, args=(job_id, nb_prompt), daemon=True
    ).start()
    return jsonify({"job_id": job_id})

# ── Bucket API ────────────────────────────────────────────────────────────────
@app.route("/api/bucket")
def bucket_list():
    return jsonify(read_bucket())

@app.route("/api/bucket/count")
def bucket_count():
    return jsonify({"count": len(read_bucket())})

@app.route("/api/bucket/add", methods=["POST"])
def bucket_add():
    data = request.get_json() or {}
    item = {
        "id":          str(uuid.uuid4()),
        "filename":    data.get("filename", ""),
        "source":      data.get("source", "quick"),
        "label":       data.get("label", ""),
        "description": data.get("description", ""),
        "added_at":    time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    items = read_bucket()
    items.append(item)
    write_bucket(items)
    return jsonify({"ok": True, "id": item["id"], "count": len(items)})

@app.route("/api/bucket/remove/<item_id>", methods=["DELETE"])
def bucket_remove(item_id):
    items = [i for i in read_bucket() if i["id"] != item_id]
    write_bucket(items)
    return jsonify({"ok": True, "count": len(items)})

@app.route("/api/bucket/download-all")
def bucket_download_all():
    items = read_bucket()
    buf   = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in items:
            src  = QUICK_DIR if item.get("source") == "quick" else OUTPUT_DIR
            path = src / item["filename"]
            if path.exists():
                zf.write(path, item["filename"])
    buf.seek(0)
    return send_file(buf, mimetype="application/zip",
                     as_attachment=True, download_name="bucket_diagrams.zip")

# ═══════════════════════════════════════════════════════════════════════════════
# Shared pieces (nav + CSS injected into every page)
# ═══════════════════════════════════════════════════════════════════════════════
_NAV_CSS = """
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh}
.topnav{background:#0f172a;height:52px;padding:0 24px;display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:300;box-shadow:0 2px 12px rgba(0,0,0,.35)}
.nav-brand{font-size:.9rem;font-weight:800;color:#fff;letter-spacing:-.02em;margin-right:auto;text-decoration:none}
.nav-link{padding:6px 14px;border-radius:6px;font-size:.8rem;font-weight:600;color:#94a3b8;text-decoration:none;display:flex;align-items:center;gap:6px;transition:all .15s;white-space:nowrap}
.nav-link:hover{color:#fff;background:rgba(255,255,255,.08)}
.nav-link.active{color:#fff;background:rgba(255,255,255,.12)}
.nav-badge{background:#7c3aed;color:#fff;border-radius:10px;padding:1px 7px;font-size:.68rem;font-weight:700;min-width:20px;text-align:center}
.nav-badge.zero{background:rgba(255,255,255,.12)}
.lb-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;display:none;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px);cursor:zoom-out}
.lb-backdrop.open{display:flex}
.lb-backdrop img{max-width:min(90vw,1024px);max-height:85vh;object-fit:contain;border-radius:6px;box-shadow:0 24px 80px rgba(0,0,0,.6);cursor:default}
.lb-close{position:fixed;top:18px;right:22px;color:#fff;font-size:1.5rem;cursor:pointer;opacity:.7;background:none;border:none;transition:opacity .15s;z-index:1001}
.lb-close:hover{opacity:1}
.lb-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;z-index:1001}
.lb-label{background:rgba(255,255,255,.12);color:#fff;padding:6px 16px;border-radius:20px;font-size:.78rem;font-weight:500;pointer-events:none;white-space:nowrap}
.lb-action{padding:8px 16px;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer;border:none;display:flex;align-items:center;gap:6px;text-decoration:none;transition:background .15s}
.lb-dl{background:#3b82f6;color:#fff}.lb-dl:hover{background:#2563eb}
.lb-bucket{background:#7c3aed;color:#fff}.lb-bucket:hover{background:#6d28d9}
.lb-bucket.added{background:#22c55e;cursor:default}
.toast{position:fixed;bottom:24px;right:24px;padding:10px 18px;background:#0f172a;color:#f8fafc;border-radius:8px;font-size:.82rem;font-weight:500;opacity:0;transform:translateY(10px);transition:all .25s ease;z-index:9999;pointer-events:none;max-width:340px}
.toast.show{opacity:1;transform:translateY(0)}
.toast.err{background:#dc2626}
"""

def _nav(active):
    return f"""
<nav class="topnav">
  <a class="nav-brand" href="/">&#9889; UPSC Diagrams</a>
  <a class="nav-link {'active' if active=='dashboard' else ''}" href="/">Dashboard</a>
  <a class="nav-link {'active' if active=='generate' else ''}" href="/generate">Quick Generate</a>
  <a class="nav-link {'active' if active=='bucket' else ''}" href="/bucket">
    Bucket <span class="nav-badge zero" id="nav-badge">0</span>
  </a>
</nav>"""

_NAV_JS = """
(async()=>{
  const r=await fetch('/api/bucket/count');
  const {count}=await r.json();
  const el=document.getElementById('nav-badge');
  if(el){el.textContent=count;el.className='nav-badge'+(count===0?' zero':'');}
})();
"""

_LB_HTML = """
<div class="lb-backdrop" id="lb" onclick="lbClose()">
  <button class="lb-close" onclick="lbClose()">&#x2715;</button>
  <img id="lb-img" src="" alt="" onclick="event.stopPropagation()">
  <div class="lb-bar" onclick="event.stopPropagation()">
    <span class="lb-label" id="lb-label"></span>
    <a  class="lb-action lb-dl"     id="lb-dl"     href="#" download>&#x2B73; Download</a>
    <button class="lb-action lb-bucket" id="lb-bucket" onclick="lbAddBucket()">+ Add to Bucket</button>
  </div>
</div>
<div class="toast" id="toast"></div>
"""

_LB_JS = r"""
let _lbMeta={};
function lbOpen(src,label,filename,source){
  _lbMeta={src,label,filename,source};
  document.getElementById('lb-img').src=src;
  document.getElementById('lb-label').textContent=label;
  const dl=document.getElementById('lb-dl');
  dl.href=src; dl.download=filename;
  const bb=document.getElementById('lb-bucket');
  bb.textContent='+ Add to Bucket'; bb.className='lb-action lb-bucket';
  document.getElementById('lb').classList.add('open');
  document.body.style.overflow='hidden';
}
function lbClose(){
  document.getElementById('lb').classList.remove('open');
  document.body.style.overflow='';
}
async function lbAddBucket(){
  const bb=document.getElementById('lb-bucket');
  if(bb.classList.contains('added')) return;
  const res=await fetch('/api/bucket/add',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filename:_lbMeta.filename,source:_lbMeta.source,label:_lbMeta.label})
  });
  const d=await res.json();
  if(res.ok){
    bb.textContent='✓ Added'; bb.className='lb-action lb-bucket added';
    const el=document.getElementById('nav-badge');
    if(el){el.textContent=d.count;el.className='nav-badge';}
    showToast('Added to bucket');
  } else { showToast(d.error||'Failed',true); }
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')lbClose();});
let _tt;
function showToast(msg,err=false){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='toast show'+(err?' err':'');
  clearTimeout(_tt); _tt=setTimeout(()=>el.classList.remove('show'),3000);
}
"""

# ═══════════════════════════════════════════════════════════════════════════════
# Page 1 — Dashboard
# ═══════════════════════════════════════════════════════════════════════════════
DASHBOARD_HTML = (
    "<!DOCTYPE html><html lang='en'><head>"
    "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Dashboard — UPSC Diagrams</title>"
    "<style>" + _NAV_CSS + r"""
.subbar{background:#fff;border-bottom:1px solid #e2e8f0;padding:10px 24px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hstat{padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;background:rgba(255,255,255,.08);color:#64748b;border:1px solid #e2e8f0}
.hstat.green{background:#dcfce7;color:#16a34a;border-color:#bbf7d0}
.hstat.amber{background:#fef9c3;color:#a16207;border-color:#fef08a}
.tabs{display:flex;gap:4px}
.tab{padding:5px 14px;border:1px solid #e2e8f0;border-radius:20px;background:#fff;font-size:.78rem;font-weight:500;color:#64748b;cursor:pointer;transition:all .15s;white-space:nowrap}
.tab:hover{background:#f8fafc}
.tab.active{background:#0f172a;color:#fff;border-color:#0f172a}
.search{flex:1;min-width:180px;max-width:300px;padding:6px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:.82rem}
.search:focus{outline:none;border-color:#3b82f6}
/* sys panel */
.sys-panel{background:#1e293b;border-bottom:1px solid #334155}
.sys-toggle{width:100%;padding:10px 24px;background:none;border:none;color:#94a3b8;font-size:.78rem;font-weight:500;cursor:pointer;text-align:left;display:flex;align-items:center;gap:8px;transition:color .15s}
.sys-toggle:hover{color:#e2e8f0}
.sys-toggle .arr{font-size:.6rem;transition:transform .2s}
.sys-toggle.open .arr{transform:rotate(90deg)}
.sys-body{display:none;padding:0 24px 16px;gap:12px;flex-direction:column}
.sys-body.open{display:flex}
.sys-tabs{display:flex;gap:4px}
.sys-tab{padding:5px 14px;border:1px solid #334155;border-radius:6px;background:transparent;color:#64748b;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .15s}
.sys-tab.active{background:#3b82f6;color:#fff;border-color:#3b82f6}
.sys-pane{display:none;flex-direction:column;gap:8px}
.sys-pane.active{display:flex}
.sys-pane label{font-size:.72rem;color:#64748b;font-weight:500}
.sys-body textarea{width:100%;height:160px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:12px;font-family:monospace;font-size:.78rem;line-height:1.6;resize:vertical}
.sys-body textarea:focus{outline:none;border-color:#3b82f6}
.sys-save{align-self:flex-start;padding:6px 16px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer}
.sys-save:hover{background:#2563eb}
/* grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(370px,1fr));gap:18px;padding:20px 24px;max-width:1700px;margin:0 auto}
/* card */
.card{background:#fff;border-radius:10px;border:1px solid #e2e8f0;overflow:hidden;display:flex;flex-direction:column;transition:box-shadow .2s}
.card:hover{box-shadow:0 6px 20px rgba(0,0,0,.09)}
.card.hidden{display:none}
.img-zone{width:100%;aspect-ratio:4/3;background:#f8fafc;position:relative;overflow:hidden;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:center}
.img-zone img{width:100%;height:100%;object-fit:contain;display:block;cursor:zoom-in}
.no-img{display:flex;flex-direction:column;align-items:center;gap:8px;color:#cbd5e1;font-size:.75rem}
.no-img svg{width:40px;height:40px;stroke:#cbd5e1;fill:none}
.gen-overlay{position:absolute;inset:0;background:rgba(248,250,252,.9);display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;backdrop-filter:blur(2px)}
.gen-overlay.show{display:flex}
.spinner{width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#3b82f6;border-radius:50%;animation:spin .75s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.gen-label{font-size:.78rem;color:#64748b;font-weight:500}
.card-body{padding:14px;display:flex;flex-direction:column;gap:10px;flex:1}
.meta-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.badge{padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:700;letter-spacing:.03em}
.b-sl{background:#0f172a;color:#f8fafc}
.b-year{background:#f1f5f9;color:#475569}
.b-done{background:#dcfce7;color:#15803d;margin-left:auto}
.b-miss{background:#fef2f2;color:#dc2626;margin-left:auto}
.b-gen{background:#eff6ff;color:#1d4ed8;margin-left:auto}
.b-err{background:#fff7ed;color:#c2410c;margin-left:auto}
.diag-name{font-size:.8rem;font-weight:600;color:#334155;line-height:1.35}
.question{font-size:.76rem;color:#64748b;line-height:1.55;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;cursor:pointer}
.question.expanded{-webkit-line-clamp:unset;display:block}
.q-toggle{font-size:.7rem;color:#3b82f6;cursor:pointer;background:none;border:none;padding:0;font-weight:500}
.q-toggle:hover{text-decoration:underline}
.prompt-header{display:flex;align-items:center;justify-content:space-between}
.prompt-label{font-size:.68rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em}
.dot{width:7px;height:7px;background:#f59e0b;border-radius:50%;display:none}
.dot.show{display:block}
.prompt-ta{width:100%;height:110px;font-size:.77rem;font-family:inherit;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;resize:vertical;line-height:1.55;transition:border-color .15s,background .15s}
.prompt-ta:focus{outline:none;border-color:#3b82f6;background:#fff}
.prompt-ta.edited{border-color:#f59e0b;background:#fffbeb}
.err-msg{font-size:.73rem;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:6px 10px;border-radius:6px;display:none;line-height:1.4}
.err-msg.show{display:block}
.actions{display:flex;gap:7px;margin-top:auto}
.btn{display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 12px;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;border:1px solid transparent;transition:all .15s}
.btn-save{background:#f8fafc;border-color:#e2e8f0;color:#475569;flex:1}
.btn-save:hover{background:#f1f5f9;border-color:#cbd5e1}
.btn-remake{background:#3b82f6;color:#fff;flex:2}
.btn-remake:hover:not(:disabled){background:#2563eb}
.btn-remake:disabled{background:#93c5fd;cursor:not-allowed;opacity:.7}
/* stage1 section */
.s1-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.s1-label{font-size:.68rem;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.07em;display:flex;align-items:center;gap:5px}
.s1-label::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#7c3aed}
.extra-ta{width:100%;height:56px;font-size:.76rem;font-family:inherit;color:#334155;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:7px 10px;resize:vertical;line-height:1.5;transition:border-color .15s}
.extra-ta::placeholder{color:#94a3b8;font-style:italic}
.extra-ta:focus{outline:none;border-color:#7c3aed}
.btn-s1{width:100%;padding:7px;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background .15s}
.btn-s1:hover:not(:disabled){background:#6d28d9}
.btn-s1:disabled{background:#a78bfa;cursor:not-allowed}
.s1-spin{width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .75s linear infinite;display:none}
.s1-spin.show{display:block}
hr.div{border:none;border-top:1px dashed #e2e8f0;margin:0}
.empty{text-align:center;padding:60px 24px;color:#94a3b8;grid-column:1/-1}
""" + "</style></head><body>"
    + _nav("dashboard")
    + """
<!-- System prompts panel -->
<div class="sys-panel">
  <button class="sys-toggle" id="sys-btn" onclick="toggleSys()">
    <span class="arr">&#9658;</span> System Prompts — Stage 1 &amp; Stage 2 (click to edit)
  </button>
  <div class="sys-body" id="sys-body">
    <div class="sys-tabs">
      <button class="sys-tab active" onclick="switchTab('1',this)">Stage 1 — Gemini Prompt Generator</button>
      <button class="sys-tab"        onclick="switchTab('2',this)">Stage 2 — Nano Banana System Prompt</button>
    </div>
    <div class="sys-pane active" id="sp1">
      <label>stage1_gemini_prompt_generator.txt</label>
      <textarea id="sta1" spellcheck="false"></textarea>
      <button class="sys-save" onclick="saveSys('1')">Save Stage 1 Prompt</button>
    </div>
    <div class="sys-pane" id="sp2">
      <label>stage2_nanoBanana_image_generator.txt</label>
      <textarea id="sta2" spellcheck="false"></textarea>
      <button class="sys-save" onclick="saveSys('2')">Save Stage 2 Prompt</button>
    </div>
  </div>
</div>

<!-- Filter bar -->
<div class="subbar">
  <div class="tabs">
    <button class="tab active" data-f="all"     onclick="setTab(this)">All</button>
    <button class="tab"        data-f="done"    onclick="setTab(this)">Generated</button>
    <button class="tab"        data-f="missing" onclick="setTab(this)">Missing</button>
  </div>
  <input class="search" id="search" type="text" placeholder="Search SL# or keyword…" oninput="applyFilters()">
</div>

<div class="grid" id="grid"><div class="empty"><p>Loading…</p></div></div>
""" + _LB_HTML + "<script>" + _NAV_JS + _LB_JS + r"""
let diagrams=[], activeTab='all', polls={};

(async()=>{ await Promise.all([loadDiagrams(), loadSys()]); })();

async function loadDiagrams(){
  diagrams=await fetch('/api/diagrams').then(r=>r.json());
  renderGrid(); updateStats();
}
function renderGrid(){
  const g=document.getElementById('grid');
  g.innerHTML='';
  diagrams.forEach(d=>g.appendChild(buildCard(d)));
  applyFilters();
}
function buildCard(d){
  const wrap=document.createElement('div');
  wrap.className='card';
  wrap.dataset.sl=d.sl_no; wrap.dataset.has=d.image_file?'1':'0';
  wrap.dataset.q=d.question.toLowerCase();
  const imgH=d.image_file
    ?`<img src="/images/${d.image_file}?t=${Date.now()}" alt="SL ${d.sl_no}" loading="lazy"
           onclick="lbOpen('/images/${d.image_file}','SL ${d.sl_no} — ${d.diagram_name}','${d.image_file}','diagram')">`
    :`<div class="no-img"><svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>No image</div>`;
  const sb=d.image_file
    ?`<span class="badge b-done" id="badge-${d.sl_no}">✓ Done</span>`
    :`<span class="badge b-miss" id="badge-${d.sl_no}">Missing</span>`;
  wrap.innerHTML=`
    <div class="img-zone" id="iz-${d.sl_no}">${imgH}
      <div class="gen-overlay" id="ov-${d.sl_no}"><div class="spinner"></div><div class="gen-label">Generating…</div></div>
    </div>
    <div class="card-body">
      <div class="meta-row"><span class="badge b-sl">SL ${d.sl_no}</span><span class="badge b-year">${d.year}</span>${sb}</div>
      <div class="diag-name">${d.diagram_name||'—'}</div>
      <div><div class="question" id="q-${d.sl_no}">${d.question}</div>
        <button class="q-toggle" onclick="toggleQ('${d.sl_no}',this)">Show more</button></div>
      <div class="s1-box">
        <span class="s1-label">Stage 1 — Gemini Prompt Generator</span>
        <textarea class="extra-ta" id="ex-${d.sl_no}" spellcheck="false"
          placeholder="Extra instructions (optional) — e.g. make a map, use bar chart, focus on timeline…">${d.extra_instructions}</textarea>
        <button class="btn-s1" id="s1b-${d.sl_no}" onclick="regenPrompt('${d.sl_no}')">
          <span class="s1-spin" id="s1s-${d.sl_no}"></span>
          <span id="s1t-${d.sl_no}">&#8635; Re-generate Stage 2 Prompt via Gemini</span>
        </button>
      </div>
      <hr class="div">
      <div><div class="prompt-header"><span class="prompt-label">Stage 2 — Nano Banana Prompt</span>
        <span class="dot" id="dot-${d.sl_no}"></span></div>
        <textarea class="prompt-ta" id="pt-${d.sl_no}" oninput="markEdited('${d.sl_no}')" spellcheck="false">${d.prompt}</textarea>
      </div>
      <div class="err-msg" id="err-${d.sl_no}"></div>
      <div class="actions">
        <button class="btn btn-save"   onclick="savePrompt('${d.sl_no}')">Save Prompt</button>
        <button class="btn btn-remake" id="btn-${d.sl_no}" onclick="remakeImg('${d.sl_no}')">Remake Image</button>
      </div>
    </div>`;
  return wrap;
}
function updateStats(){
  const t=diagrams.length,done=diagrams.filter(d=>d.image_file).length,miss=t-done;
  document.querySelector('[data-f="all"]').textContent=`All (${t})`;
  document.querySelector('[data-f="done"]').textContent=`Generated (${done})`;
  document.querySelector('[data-f="missing"]').textContent=`Missing (${miss})`;
}
function setTab(btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); activeTab=btn.dataset.f; applyFilters();
}
function applyFilters(){
  const q=document.getElementById('search').value.toLowerCase().trim();
  document.querySelectorAll('.card').forEach(c=>{
    const has=c.dataset.has==='1';
    const ok=(activeTab==='all'?true:activeTab==='done'?has:!has)
             &&(!q||c.dataset.sl.includes(q)||c.dataset.q.includes(q));
    c.classList.toggle('hidden',!ok);
  });
}
function toggleQ(sl,btn){const e=document.getElementById(`q-${sl}`);e.classList.toggle('expanded');btn.textContent=e.classList.contains('expanded')?'Show less':'Show more';}
function markEdited(sl){document.getElementById(`pt-${sl}`).classList.add('edited');document.getElementById(`dot-${sl}`).classList.add('show');}
async function savePrompt(sl){
  const r=await fetch(`/api/save-prompt/${sl}`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({prompt:document.getElementById(`pt-${sl}`).value,extra_instructions:document.getElementById(`ex-${sl}`).value})});
  if(r.ok){document.getElementById(`pt-${sl}`).classList.remove('edited');document.getElementById(`dot-${sl}`).classList.remove('show');showToast('Prompt saved');}
  else showToast('Save failed',true);
}
async function regenPrompt(sl){
  const extra=document.getElementById(`ex-${sl}`).value.trim();
  const btn=document.getElementById(`s1b-${sl}`);
  btn.disabled=true;
  document.getElementById(`s1s-${sl}`).classList.add('show');
  document.getElementById(`s1t-${sl}`).textContent='Generating via Gemini…';
  try{
    const res=await fetch(`/api/regen-prompt/${sl}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({extra_instructions:extra})});
    const d=await res.json();
    if(!res.ok) throw new Error(d.error||'Failed');
    document.getElementById(`pt-${sl}`).value=d.prompt;
    markEdited(sl);
    showToast(`SL ${sl} — prompt refreshed. Review then Remake Image.`);
  }catch(e){showToast(`Stage 1 failed: ${e.message}`,true);}
  finally{btn.disabled=false;document.getElementById(`s1s-${sl}`).classList.remove('show');document.getElementById(`s1t-${sl}`).textContent='↺ Re-generate Stage 2 Prompt via Gemini';}
}
async function remakeImg(sl){
  const prompt=document.getElementById(`pt-${sl}`).value.trim();
  if(!prompt){showToast('Prompt is empty',true);return;}
  const btn=document.getElementById(`btn-${sl}`),ov=document.getElementById(`ov-${sl}`),err=document.getElementById(`err-${sl}`);
  btn.disabled=true; btn.textContent='Generating…'; ov.classList.add('show'); err.classList.remove('show');
  document.getElementById(`pt-${sl}`).classList.remove('edited');document.getElementById(`dot-${sl}`).classList.remove('show');
  setBadge(sl,'gen');
  const res=await fetch(`/api/remake/${sl}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
  if(!res.ok){const d=await res.json();onErr(sl,d.error||'Failed');return;}
  if(polls[sl])clearInterval(polls[sl]);
  polls[sl]=setInterval(async()=>{
    const s=await fetch(`/api/status/${sl}`).then(r=>r.json());
    if(s.status==='done'){clearInterval(polls[sl]);await onDone(sl);}
    else if(s.status.startsWith('error')){clearInterval(polls[sl]);onErr(sl,s.status.replace(/^error:?\s*/i,''));}
  },2000);
}
async function onDone(sl){
  const all=await fetch('/api/diagrams').then(r=>r.json());
  const fresh=all.find(d=>d.sl_no===sl); diagrams=all;
  const zone=document.getElementById(`iz-${sl}`),ov=document.getElementById(`ov-${sl}`);
  if(fresh&&fresh.image_file){
    let img=zone.querySelector('img');
    if(!img){zone.querySelector('.no-img')?.remove();img=document.createElement('img');img.alt=`SL ${sl}`;
      img.style.cursor='zoom-in';
      img.onclick=()=>lbOpen(`/images/${fresh.image_file}`,`SL ${sl} — ${fresh.diagram_name}`,fresh.image_file,'diagram');
      zone.insertBefore(img,ov);}
    img.src=`/images/${fresh.image_file}?t=${Date.now()}`;
    document.querySelector(`.card[data-sl="${sl}"]`).dataset.has='1';
  }
  ov.classList.remove('show'); setBadge(sl,'done');
  document.getElementById(`btn-${sl}`).disabled=false;
  document.getElementById(`btn-${sl}`).textContent='Remake Image';
  updateStats(); showToast(`SL ${sl} generated`);
}
function onErr(sl,msg){
  document.getElementById(`ov-${sl}`).classList.remove('show');
  document.getElementById(`err-${sl}`).textContent=msg;document.getElementById(`err-${sl}`).classList.add('show');
  setBadge(sl,'err');document.getElementById(`btn-${sl}`).disabled=false;document.getElementById(`btn-${sl}`).textContent='Remake Image';
  showToast(`SL ${sl} failed`,true);
}
function setBadge(sl,t){
  const el=document.getElementById(`badge-${sl}`);
  const m={done:['b-done','✓ Done'],miss:['b-miss','Missing'],gen:['b-gen','⏳ Generating'],err:['b-err','✗ Error']};
  const [c,tx]=m[t]||m.miss; el.className=`badge ${c}`; el.textContent=tx;
}
async function loadSys(){
  const[d1,d2]=await Promise.all([fetch('/api/system-prompt?stage=1').then(r=>r.json()),fetch('/api/system-prompt?stage=2').then(r=>r.json())]);
  document.getElementById('sta1').value=d1.content; document.getElementById('sta2').value=d2.content;
}
async function saveSys(s){
  const res=await fetch(`/api/system-prompt?stage=${s}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:document.getElementById(`sta${s}`).value})});
  showToast(res.ok?`Stage ${s} prompt saved`:'Save failed',!res.ok);
}
function switchTab(s,btn){
  document.querySelectorAll('.sys-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.sys-pane').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active'); document.getElementById(`sp${s}`).classList.add('active');
}
function toggleSys(){
  const btn=document.getElementById('sys-btn'),body=document.getElementById('sys-body');
  const o=body.classList.toggle('open'); btn.classList.toggle('open',o);
}
""" + "</script></body></html>")

# ═══════════════════════════════════════════════════════════════════════════════
# Page 2 — Quick Generate
# ═══════════════════════════════════════════════════════════════════════════════
GENERATE_HTML = (
    "<!DOCTYPE html><html lang='en'><head>"
    "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Quick Generate — UPSC Diagrams</title>"
    "<style>" + _NAV_CSS + r"""
.gen-layout{display:grid;grid-template-columns:380px 1fr;gap:0;min-height:calc(100vh - 52px)}
@media(max-width:860px){.gen-layout{grid-template-columns:1fr;grid-template-rows:auto 1fr}}
/* left panel */
.gen-form{background:#fff;border-right:1px solid #e2e8f0;padding:28px 24px;display:flex;flex-direction:column;gap:18px;overflow-y:auto}
.gen-form h2{font-size:1.15rem;font-weight:800;color:#0f172a;margin-bottom:6px}
.gen-form p{font-size:.8rem;color:#64748b;line-height:1.5}
.field label{display:block;font-size:.73rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.field textarea{width:100%;height:100px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:.85rem;font-family:inherit;color:#1e293b;line-height:1.55;resize:vertical;transition:border-color .15s}
.field textarea:focus{outline:none;border-color:#7c3aed}
.field select{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:.85rem;font-family:inherit;color:#1e293b;background:#fff;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
.field select:focus{outline:none;border-color:#7c3aed}
.btn-gen{width:100%;padding:13px;background:#7c3aed;color:#fff;border:none;border-radius:9px;font-size:.95rem;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .15s;letter-spacing:-.01em}
.btn-gen:hover:not(:disabled){background:#6d28d9}
.btn-gen:disabled{background:#a78bfa;cursor:not-allowed}
.btn-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .75s linear infinite;display:none}
@keyframes spin{to{transform:rotate(360deg)}}
.btn-spin.show{display:block}
/* progress inside form */
.progress{display:none;flex-direction:column;gap:8px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px}
.progress.show{display:flex}
.step{display:flex;align-items:center;gap:10px;font-size:.82rem;color:#64748b}
.step-ic{width:24px;height:24px;border-radius:50%;border:2px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:.68rem;font-weight:700;flex-shrink:0;color:#94a3b8;transition:all .2s}
.step.active .step-ic{border-color:#7c3aed;color:#7c3aed;animation:pulse 1.2s ease-in-out infinite}
.step.done .step-ic{background:#22c55e;border-color:#22c55e;color:#fff}
.step.active{color:#334155;font-weight:600}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,.3)}50%{box-shadow:0 0 0 5px rgba(124,58,237,0)}}
.gen-err{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:.8rem;color:#dc2626;display:none;line-height:1.5}
.gen-err.show{display:block}
/* right panel */
.gen-result{background:#f1f5f9;border-top:3px solid #e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;gap:20px}
@media(min-width:861px){.gen-result{border-top:none;border-left:none}}
.result-placeholder{display:flex;flex-direction:column;align-items:center;gap:16px;color:#94a3b8;text-align:center}
.result-placeholder svg{width:80px;height:80px;stroke:#cbd5e1;fill:none}
.result-placeholder p{font-size:.85rem;max-width:280px;line-height:1.6}
.result-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;width:100%;max-width:600px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
.result-card img{width:100%;display:block;cursor:zoom-in}
.result-body{padding:16px;display:flex;flex-direction:column;gap:12px}
.result-prompt{display:flex;flex-direction:column;gap:4px}
.result-prompt strong{font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8}
.result-prompt textarea{width:100%;height:110px;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;font-size:.77rem;font-family:inherit;color:#475569;line-height:1.55;resize:vertical;background:#f8fafc;transition:border-color .15s}
.result-prompt textarea:focus{outline:none;border-color:#7c3aed;background:#fff}
.result-actions{display:flex;gap:8px}
.btn-bucket{flex:1;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:7px;font-size:.82rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background .15s}
.btn-bucket:hover:not(.added){background:#6d28d9}
.btn-bucket.added{background:#22c55e;cursor:default}
.btn-rdl{flex:1;padding:10px;background:#3b82f6;color:#fff;border:none;border-radius:7px;font-size:.82rem;font-weight:700;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px}
.btn-rdl:hover{background:#2563eb}
.btn-new{padding:10px 16px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer}
.btn-new:hover{background:#e2e8f0}
.btn-regen{padding:10px 14px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;transition:background .15s}
.btn-regen:hover:not(:disabled){background:#e2e8f0}
.btn-regen:disabled{opacity:.5;cursor:not-allowed}
.img-wrap{position:relative;overflow:hidden}
.regen-overlay{position:absolute;inset:0;background:rgba(248,250,252,.88);display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;backdrop-filter:blur(3px)}
.regen-overlay.show{display:flex}
.regen-spin{width:34px;height:34px;border:3px solid rgba(124,58,237,.2);border-top-color:#7c3aed;border-radius:50%;animation:spin .75s linear infinite}
.regen-overlay span{font-size:.82rem;color:#7c3aed;font-weight:600}
""" + "</style></head><body>"
    + _nav("generate")
    + """
<div class="gen-layout">

  <!-- Left: form -->
  <div class="gen-form">
    <div>
      <h2>Quick Generate Diagram</h2>
      <p>Describe what you want &mdash; the AI runs Stage 1 (Gemini) to craft the perfect prompt, then Stage 2 (Nano Banana) to generate the image.</p>
    </div>

    <div class="field">
      <label>Describe what you want</label>
      <textarea id="g-desc" placeholder="e.g. The water cycle showing evaporation, condensation and precipitation&#10;e.g. India's demographic dividend and its economic impact&#10;e.g. Compare parliamentary vs presidential systems"></textarea>
    </div>

    <div class="field">
      <label>Diagram Type <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
      <select id="g-type">
        <option value="">Any — let AI decide</option>
        <optgroup label="Maps">
          <option value="India Map">India Map</option>
          <option value="World Map">World Map</option>
        </optgroup>
        <optgroup label="Thematic">
          <option value="Thematic Diagram">Thematic Diagram</option>
        </optgroup>
        <optgroup label="Flow &amp; Process">
          <option value="Flowchart">Flowchart</option>
          <option value="Cycle / Loop Diagram">Cycle / Loop Diagram</option>
          <option value="Timeline / Chronology">Timeline / Chronology</option>
        </optgroup>
        <optgroup label="Hierarchy &amp; Structure">
          <option value="Pyramid / Hierarchy">Pyramid / Hierarchy</option>
          <option value="Hub and Spoke">Hub and Spoke</option>
          <option value="Org Chart / Tree">Org Chart / Tree</option>
        </optgroup>
        <optgroup label="Comparison &amp; Analysis">
          <option value="Venn Diagram">Venn Diagram</option>
          <option value="Comparison Table">Comparison Table</option>
          <option value="Framework / Matrix">Framework / Matrix</option>
        </optgroup>
        <optgroup label="Science &amp; Data">
          <option value="Ray Diagram">Ray Diagram</option>
          <option value="Cross-Section Diagram">Cross-Section Diagram</option>
          <option value="Bar / Data Chart">Bar / Data Chart</option>
          <option value="Funnel Diagram">Funnel Diagram</option>
        </optgroup>
      </select>
    </div>

    <button class="btn-gen" id="g-btn" onclick="generate()">
      <span class="btn-spin" id="g-spin"></span>
      <span id="g-btntxt">&#9889; Generate Diagram</span>
    </button>

    <div class="progress" id="g-progress">
      <div class="step" id="gstep1"><div class="step-ic">1</div><span>Stage 1 — Gemini crafting image prompt…</span></div>
      <div class="step" id="gstep2"><div class="step-ic">2</div><span>Stage 2 — Nano Banana generating image…</span></div>
    </div>

    <div class="gen-err" id="g-err"></div>
  </div>

  <!-- Right: result -->
  <div class="gen-result" id="g-result-panel">
    <div class="result-placeholder" id="g-placeholder">
      <svg viewBox="0 0 24 24" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
      </svg>
      <p>Your generated diagram will appear here. Fill in the form and click Generate.</p>
    </div>
    <div class="result-card" id="g-result-card" style="display:none">
      <div class="img-wrap">
        <img id="g-img" src="" alt="Generated diagram"
             onclick="lbOpen(this.src, 'Quick Generated', _curFile, 'quick')">
        <div class="regen-overlay" id="g-regen-overlay">
          <div class="regen-spin"></div>
          <span>Regenerating image…</span>
        </div>
      </div>
      <div class="result-body">
        <div class="result-prompt">
          <strong>Stage 2 Prompt (from Gemini) — edit &amp; regenerate</strong>
          <textarea id="g-prompt-txt" placeholder="Stage 2 prompt will appear here…"></textarea>
        </div>
        <div class="result-actions">
          <button class="btn-regen" id="g-regen-btn" onclick="regenImage()">&#8635; Regenerate</button>
          <button class="btn-bucket" id="g-bucket-btn" onclick="addToBucket()">&#43; Add to Bucket</button>
          <a class="btn-rdl" id="g-dl" href="#" download>&#x2B73; Download</a>
          <button class="btn-new" onclick="resetForm()">New</button>
        </div>
      </div>
    </div>
  </div>

</div>
""" + _LB_HTML + "<script>" + _NAV_JS + _LB_JS + r"""
let _curFile=null, _curDesc='', _curType='', _curPrompt='';

async function generate(){
  const desc=document.getElementById('g-desc').value.trim();
  const type=document.getElementById('g-type').value;
  if(!desc){document.getElementById('g-desc').focus();return;}
  _curDesc=desc; _curType=type;

  document.getElementById('g-result-card').style.display='none';
  document.getElementById('g-placeholder').style.display='flex';
  document.getElementById('g-err').classList.remove('show');

  const btn=document.getElementById('g-btn');
  btn.disabled=true;
  document.getElementById('g-spin').classList.add('show');
  document.getElementById('g-btntxt').textContent='Generating…';
  document.getElementById('g-progress').classList.add('show');
  document.getElementById('gstep1').className='step active';
  document.getElementById('gstep2').className='step';

  const res=await fetch('/api/quick-generate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({description:desc,diagram_type:type})});
  const {job_id,error}=await res.json();
  if(!res.ok){showErr(error||'Failed to start');return;}

  const iv=setInterval(async()=>{
    const s=await fetch(`/api/quick-status/${job_id}`).then(r=>r.json());
    if(s.status==='stage2'){
      document.getElementById('gstep1').className='step done';
      document.getElementById('gstep1').querySelector('.step-ic').textContent='✓';
      document.getElementById('gstep2').className='step active';
    } else if(s.status==='done'){
      clearInterval(iv);
      document.getElementById('gstep1').className='step done';document.getElementById('gstep1').querySelector('.step-ic').textContent='✓';
      document.getElementById('gstep2').className='step done';document.getElementById('gstep2').querySelector('.step-ic').textContent='✓';
      showResult(s);
    } else if(s.status==='error'){
      clearInterval(iv); showErr(s.error||'Generation failed');
    }
  },2000);
}

function showResult(s){
  _curFile=s.image_file;
  _curPrompt=s.stage1_prompt||'';
  const src=`/quick-images/${s.image_file}?t=${Date.now()}`;
  document.getElementById('g-img').src=src;
  document.getElementById('g-prompt-txt').value=_curPrompt;
  const dl=document.getElementById('g-dl'); dl.href=src; dl.download=s.image_file;
  const bb=document.getElementById('g-bucket-btn'); bb.textContent='+ Add to Bucket'; bb.className='btn-bucket';
  document.getElementById('g-placeholder').style.display='none';
  document.getElementById('g-result-card').style.display='block';
  document.getElementById('g-btn').disabled=false;
  document.getElementById('g-spin').classList.remove('show');
  document.getElementById('g-btntxt').textContent='⚡ Generate Diagram';
  document.getElementById('g-regen-btn').disabled=false;
}

async function regenImage(){
  _curPrompt=document.getElementById('g-prompt-txt').value.trim();
  if(!_curPrompt) return;
  const regenBtn=document.getElementById('g-regen-btn');
  regenBtn.disabled=true;
  document.getElementById('g-regen-overlay').classList.add('show');
  document.getElementById('g-err').classList.remove('show');

  const res=await fetch('/api/quick-regen',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({nb_prompt:_curPrompt})});
  const {job_id,error}=await res.json();
  if(!res.ok){
    document.getElementById('g-regen-overlay').classList.remove('show');
    regenBtn.disabled=false;
    showErr(error||'Failed to start regeneration');
    return;
  }

  const iv=setInterval(async()=>{
    const s=await fetch(`/api/quick-status/${job_id}`).then(r=>r.json());
    if(s.status==='done'){
      clearInterval(iv);
      _curFile=s.image_file;
      const src=`/quick-images/${s.image_file}?t=${Date.now()}`;
      document.getElementById('g-img').src=src;
      const dl=document.getElementById('g-dl'); dl.href=src; dl.download=s.image_file;
      const bb=document.getElementById('g-bucket-btn'); bb.textContent='+ Add to Bucket'; bb.className='btn-bucket';
      document.getElementById('g-regen-overlay').classList.remove('show');
      regenBtn.disabled=false;
    } else if(s.status==='error'){
      clearInterval(iv);
      document.getElementById('g-regen-overlay').classList.remove('show');
      regenBtn.disabled=false;
      showErr(s.error||'Regeneration failed');
    }
  },2000);
}

function showErr(msg){
  document.getElementById('g-err').textContent=msg; document.getElementById('g-err').classList.add('show');
  document.getElementById('g-btn').disabled=false;
  document.getElementById('g-spin').classList.remove('show');
  document.getElementById('g-btntxt').textContent='⚡ Generate Diagram';
}

async function addToBucket(){
  const bb=document.getElementById('g-bucket-btn');
  if(bb.classList.contains('added')) return;
  const label=_curType?`${_curType}: ${_curDesc.slice(0,60)}`:_curDesc.slice(0,70);
  const res=await fetch('/api/bucket/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filename:_curFile,source:'quick',label,description:_curDesc})});
  const d=await res.json();
  if(res.ok){
    bb.textContent='✓ Added to Bucket'; bb.className='btn-bucket added';
    const el=document.getElementById('nav-badge');
    if(el){el.textContent=d.count;el.className='nav-badge';}
    showToast('Added to bucket');
  } else showToast(d.error||'Failed',true);
}

function resetForm(){
  document.getElementById('g-desc').value='';
  document.getElementById('g-type').value='';
  document.getElementById('g-result-card').style.display='none';
  document.getElementById('g-placeholder').style.display='flex';
  document.getElementById('g-err').classList.remove('show');
  document.getElementById('g-progress').classList.remove('show');
  document.getElementById('gstep1').className='step';
  document.getElementById('gstep2').className='step';
  _curFile=null;
  document.getElementById('g-desc').focus();
}
""" + "</script></body></html>")

# ═══════════════════════════════════════════════════════════════════════════════
# Page 3 — Bucket
# ═══════════════════════════════════════════════════════════════════════════════
BUCKET_HTML = (
    "<!DOCTYPE html><html lang='en'><head>"
    "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Bucket — UPSC Diagrams</title>"
    "<style>" + _NAV_CSS + r"""
.bucket-bar{background:#fff;border-bottom:1px solid #e2e8f0;padding:14px 24px;display:flex;align-items:center;gap:12px}
.bucket-bar h2{font-size:1rem;font-weight:800;color:#0f172a;flex:1}
.bucket-bar .count{font-size:.8rem;color:#64748b;font-weight:500}
.btn-dl-all{padding:8px 18px;background:#3b82f6;color:#fff;border:none;border-radius:7px;font-size:.82rem;font-weight:700;cursor:pointer;text-decoration:none;display:flex;align-items:center;gap:6px}
.btn-dl-all:hover{background:#2563eb}
.bucket-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;padding:24px;max-width:1600px;margin:0 auto}
.b-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,.06);transition:box-shadow .2s}
.b-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.1)}
.b-img{width:100%;aspect-ratio:4/3;background:#f8fafc;overflow:hidden;border-bottom:1px solid #f1f5f9}
.b-img img{width:100%;height:100%;object-fit:contain;display:block;cursor:zoom-in}
.b-body{padding:12px;display:flex;flex-direction:column;gap:8px;flex:1}
.b-label{font-size:.82rem;font-weight:600;color:#1e293b;line-height:1.35}
.b-meta{font-size:.72rem;color:#94a3b8}
.b-source{display:inline-block;padding:2px 7px;border-radius:4px;font-size:.68rem;font-weight:700}
.b-source.quick{background:#ede9fe;color:#7c3aed}
.b-source.diagram{background:#dbeafe;color:#1d4ed8}
.b-actions{display:flex;gap:7px;margin-top:auto}
.btn-item-dl{flex:2;padding:8px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:5px}
.btn-item-dl:hover{background:#2563eb}
.btn-remove{flex:1;padding:8px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer}
.btn-remove:hover{background:#fee2e2}
.empty-state{grid-column:1/-1;text-align:center;padding:80px 24px;color:#94a3b8}
.empty-state svg{width:64px;height:64px;stroke:#e2e8f0;fill:none;margin:0 auto 16px}
.empty-state h3{font-size:.95rem;font-weight:600;color:#cbd5e1;margin-bottom:8px}
.empty-state p{font-size:.82rem;line-height:1.6}
.empty-state a{color:#7c3aed;text-decoration:none;font-weight:600}
.empty-state a:hover{text-decoration:underline}
""" + "</style></head><body>"
    + _nav("bucket")
    + """
<div class="bucket-bar">
  <h2>&#128248; Bucket</h2>
  <span class="count" id="bkt-count">0 items</span>
  <a class="btn-dl-all" href="/api/bucket/download-all">&#x2B73; Download All as ZIP</a>
</div>

<div class="bucket-grid" id="bkt-grid">
  <div class="empty-state">
    <p>Loading…</p>
  </div>
</div>
""" + _LB_HTML + "<script>" + _NAV_JS + _LB_JS + r"""
async function loadBucket(){
  const items=await fetch('/api/bucket').then(r=>r.json());
  renderBucket(items);
}

function renderBucket(items){
  const grid=document.getElementById('bkt-grid');
  document.getElementById('bkt-count').textContent=`${items.length} item${items.length!==1?'s':''}`;
  const el=document.getElementById('nav-badge');
  if(el){el.textContent=items.length;el.className='nav-badge'+(items.length===0?' zero':'');}

  if(!items.length){
    grid.innerHTML=`<div class="empty-state">
      <svg viewBox="0 0 24 24" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
      <h3>Your bucket is empty</h3>
      <p>Go to <a href="/generate">Quick Generate</a> or open any diagram image on the <a href="/">Dashboard</a> to add images here.</p>
    </div>`;
    return;
  }
  grid.innerHTML='';
  items.forEach(item=>{
    const src=item.source==='quick'?`/quick-images/${item.filename}`:`/images/${item.filename}`;
    const date=new Date(item.added_at).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const div=document.createElement('div');
    div.className='b-card'; div.dataset.id=item.id;
    div.innerHTML=`
      <div class="b-img"><img src="${src}" alt="${item.label}" loading="lazy"
           onclick="lbOpen('${src}','${item.label.replace(/'/g,"\\'")}','${item.filename}','${item.source}')"></div>
      <div class="b-body">
        <div class="b-label">${item.label||item.filename}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="b-source ${item.source}">${item.source==='quick'?'Quick Gen':'Dashboard'}</span>
          <span class="b-meta">${date}</span>
        </div>
        <div class="b-actions">
          <a class="btn-item-dl" href="${src}" download="${item.filename}">&#x2B73; Download</a>
          <button class="btn-remove" onclick="removeItem('${item.id}',this)">Remove</button>
        </div>
      </div>`;
    grid.appendChild(div);
  });
}

async function removeItem(id, btn){
  btn.textContent='…'; btn.disabled=true;
  const res=await fetch(`/api/bucket/remove/${id}`,{method:'DELETE'});
  if(res.ok){
    const card=document.querySelector(`.b-card[data-id="${id}"]`);
    card.style.opacity='0'; card.style.transform='scale(.95)'; card.style.transition='all .2s';
    setTimeout(()=>{ card.remove(); loadBucket(); },200);
  } else { btn.textContent='Remove'; btn.disabled=false; showToast('Remove failed',true); }
}

loadBucket();
""" + "</script></body></html>")

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    OUTPUT_DIR.mkdir(exist_ok=True)
    QUICK_DIR.mkdir(exist_ok=True)
    BIN_DIR.mkdir(exist_ok=True)
    print("\n  UPSC Diagram Tool")
    print("  ─────────────────────────────────────")
    print("  Dashboard       http://localhost:5001/")
    print("  Quick Generate  http://localhost:5001/generate")
    print("  Bucket          http://localhost:5001/bucket")
    print()
    app.run(debug=False, host="0.0.0.0", port=5001, threaded=True)
