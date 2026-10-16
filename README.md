# ThinkDiagram

AI-powered UPSC diagram generation tool. Takes UPSC exam questions, runs them through a two-stage AI pipeline, and produces clean educational diagrams.

---

## What it does

- **Dashboard** — Review all 73 UPSC diagrams. Edit prompts, regenerate via Gemini, remake images.
- **Quick Generate** — Describe any topic and get a diagram in seconds.
- **Bucket** — Save your favourite diagrams and download them as a ZIP.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend & Server | Next.js 16 (App Router), TypeScript, Tailwind CSS |
| AI — Stage 1 | Google AI Studio Gemini Pro — turns a UPSC question into a structured image prompt |
| AI — Stage 2 | Google AI Studio Gemini Flash Image — generates the actual diagram PNG |
| Python Bridge | Thin Python scripts called via `child_process` from Next.js API routes |
| Image Processing | Pillow — pads every output to a 1024×768 (4:3) canvas |
| Data | CSV file + local filesystem (no database) |

---

## Project Structure

```
ThinkDiagram/
├── ThinkDiagramDashboard/        # Next.js app
│   ├── app/
│   │   ├── page.tsx              # Dashboard
│   │   ├── generate/page.tsx     # Quick Generate
│   │   ├── bucket/page.tsx       # Bucket
│   │   └── api/                  # 19 API routes
│   ├── components/               # React components
│   ├── lib/                      # Data layer (CSV, bucket, types, paths)
│   └── scripts/
│       ├── stage1_bridge.py      # Gemini Pro prompt generator
│       └── stage2_bridge.py      # Gemini Flash image generator
├── DiagramsMakingSheet.csv       # 73 UPSC questions + prompts
├── FinalDiagrams/                # Generated diagram PNGs
├── QuickGenerated/               # Quick Generate output PNGs
├── bin/                          # Recycled images (moved here before remake)
├── stage1_gemini_prompt_generator.txt   # Stage 1 system prompt
├── stage2_nanoBanana_image_generator.txt # Stage 2 system prompt
└── requirements.txt              # Python dependencies
```

---

## Setup

### 1. Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Google AI Studio API key

Create `ThinkDiagramDashboard/.env.local`:
```
GOOGLE_API_KEY=your_google_ai_studio_api_key
```

### 3. Install and run

```bash
cd ThinkDiagramDashboard
npm install
npm run dev
```

Open **http://localhost:3000**

---

## How the AI pipeline works

```
UPSC Question
      │
      ▼
 Stage 1 — Gemini Pro
 (stage1_gemini_prompt_generator.txt)
 Identifies the best diagram type and writes
 a detailed NanoBanana image prompt
      │
      ▼
 Stage 2 — Gemini Flash Image Preview
 (stage2_nanoBanana_image_generator.txt)
 Generates the actual PNG diagram
      │
      ▼
 Pillow pads to 1024×768 (4:3)
      │
      ▼
 Saved to FinalDiagrams/
```

---

## Bin / Recycling

When you remake an image, the old version is **never deleted** — it is moved to `bin/` with a timestamp suffix (e.g. `2024_1_Diagram_Name_20260505_143022.png`) so you can always recover a previous version.

---

## API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/diagrams` | List all 73 diagrams |
| GET | `/api/images/[filename]` | Serve a FinalDiagrams image |
| GET | `/api/quick-images/[filename]` | Serve a QuickGenerated image |
| GET/POST | `/api/system-prompt?stage=1\|2` | Read/edit stage prompts |
| POST | `/api/regen-prompt/[sl_no]` | Run Stage 1 for a diagram |
| POST | `/api/save-prompt/[sl_no]` | Save prompt to CSV |
| POST | `/api/remake/[sl_no]` | Regenerate image (background job) |
| GET | `/api/status/[sl_no]` | Poll remake job status |
| POST | `/api/quick-generate` | Stage 1 + Stage 2 for custom description |
| GET | `/api/quick-status/[job_id]` | Poll quick generate status |
| POST | `/api/quick-regen` | Stage 2 only with given prompt |
| GET | `/api/bucket` | List saved bucket items |
| POST | `/api/bucket/add` | Add item to bucket |
| DELETE | `/api/bucket/remove/[id]` | Remove item from bucket |
| GET | `/api/bucket/count` | Get bucket count |
| GET | `/api/bucket/download-all` | Download all bucket items as ZIP |
