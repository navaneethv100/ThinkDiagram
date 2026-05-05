"""
Stage 2: Parallel diagram image generation using Nano Banana 2
         (gemini-3.1-flash-image-preview via Vertex AI).

- Reads NanoBanana_Prompt and Diagram_Name from DiagramsMakingSheet.csv
- Runs 5 questions in parallel using ThreadPoolExecutor
- Saves images as FinalDiagrams/{Year}_{SL_NO}_{Diagram_Name}.png
- Marks completed rows in CSV so reruns skip already-generated images
- Logs every step to logs/stage2_YYYYMMDD_HHMMSS.log and console

Usage:
  python3 stage2.py --batch 1          # generate SL 1-5
  python3 stage2.py --batch 2          # generate SL 6-10
  python3 stage2.py --batch all        # run all batches sequentially
  python3 stage2.py --list             # list all batches with SL numbers and filenames
  python3 stage2.py --retry-failed     # retry rows where image file is missing
"""

import argparse
import csv
import io
import json
import logging
import sys
import threading
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

warnings.filterwarnings("ignore")

from PIL import Image

from google import genai
from google.genai import types
from google.oauth2 import service_account

# ── Config ────────────────────────────────────────────────────────────────────
CREDENTIALS_PATH  = "credentials/google_credentials.json"
NB2_MODEL         = "publishers/google/models/gemini-3.1-flash-image-preview"
LOCATION          = "global"   # gemini-3.1-flash-image-preview requires global endpoint

CSV_FILE          = "DiagramsMakingSheet.csv"
STEP2_PROMPT_FILE = "stage2_nanoBanana_image_generator.txt"
OUTPUT_DIR        = Path("FinalDiagrams")
LOG_DIR           = Path("logs")

CASE_STUDY_CUTOFF = 74
BATCH_SIZE        = 3
MAX_WORKERS       = 3


# ── Logging ───────────────────────────────────────────────────────────────────
def setup_logging() -> logging.Logger:
    LOG_DIR.mkdir(exist_ok=True)
    log_file = LOG_DIR / f"stage2_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    fmt = logging.Formatter(
        "%(asctime)s  %(levelname)-8s  [%(threadName)-10s]  %(message)s",
        datefmt="%H:%M:%S",
    )
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(fmt)
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger = logging.getLogger("stage2")
    logger.setLevel(logging.DEBUG)
    logger.addHandler(fh)
    logger.addHandler(ch)
    logger.info(f"Log file      : {log_file}")
    logger.info(f"Model         : Nano Banana 2 ({NB2_MODEL})")
    logger.info(f"Output folder : {OUTPUT_DIR.resolve()}")
    return logger


# ── Vertex AI client ──────────────────────────────────────────────────────────
def setup_client(log: logging.Logger) -> genai.Client:
    log.info("Step: Setting up Vertex AI client (Nano Banana 2)")
    creds = service_account.Credentials.from_service_account_file(
        CREDENTIALS_PATH,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    project_id = json.load(open(CREDENTIALS_PATH))["project_id"]
    client = genai.Client(
        vertexai=True, project=project_id,
        location=LOCATION, credentials=creds,
    )
    log.info(f"Step: Connected — project={project_id}  location={LOCATION}")
    return client


# ── CSV helpers (thread-safe) ─────────────────────────────────────────────────
_csv_lock = threading.Lock()

def read_csv():
    with open(CSV_FILE, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)

def mark_done(sl_no: str, fieldnames: list, rows: list, log: logging.Logger):
    with _csv_lock:
        for r in rows:
            if r["SL_NO"].strip() == sl_no:
                r["Image_Generated"] = "yes"
                break
        with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        log.debug(f"SL {sl_no} | CSV marked as done")


# ── Filename builder ──────────────────────────────────────────────────────────
def build_filename(row: dict) -> Path:
    year  = row["Year"].strip()
    sl_no = row["SL_NO"].strip()
    dname = row.get("Diagram_Name", "").strip() or f"SL{sl_no}"
    return OUTPUT_DIR / f"{year}_{sl_no}_{dname}.png"


# ── 4:3 post-processor ───────────────────────────────────────────────────────
TARGET_W, TARGET_H = 1024, 768  # exactly 4:3

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


# ── Nano Banana 2 API call ────────────────────────────────────────────────────
def call_nano_banana(client: genai.Client, system_prompt: str, diagram_prompt: str,
                     output_path: Path, log: logging.Logger, sl_no: str) -> None:

    full_prompt = (
        f"{system_prompt}\n\n"
        f"ASPECT RATIO: Generate the image in exactly 4:3 aspect ratio (landscape, width:height = 4:3).\n\n"
        f"{diagram_prompt}"
    )

    log.info(f"SL {sl_no} | Step A: Sending request to Nano Banana 2")
    log.debug(f"SL {sl_no} | Prompt preview: {diagram_prompt[:80]}...")

    response = client.models.generate_content(
        model=NB2_MODEL,
        contents=full_prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            temperature=1.0,
        ),
    )

    log.info(f"SL {sl_no} | Step A: Response received from Nano Banana 2")

    # Extract image bytes from response parts
    img_bytes = None
    candidates = response.candidates or []
    if candidates and candidates[0].content and candidates[0].content.parts:
        for part in candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                img_bytes = part.inline_data.data
                break

    if not img_bytes:
        raise RuntimeError("Nano Banana 2 returned no image — model may have declined the prompt, retrying will resolve this")

    log.info(f"SL {sl_no} | Step B: Converting to 4:3 and saving → {output_path.name} ({len(img_bytes):,} bytes)")
    img_bytes = convert_to_4x3(img_bytes)
    output_path.write_bytes(img_bytes)
    log.info(f"SL {sl_no} | Step B: Image saved ✓")


# ── Per-diagram worker ────────────────────────────────────────────────────────
def process_diagram(row: dict, client: genai.Client, system_prompt: str,
                    fieldnames: list, rows: list, log: logging.Logger) -> dict:
    sl_no       = row["SL_NO"].strip()
    question    = row["Questions"].strip()
    nb_prompt   = row.get("NanoBanana_Prompt", "").strip()
    output_path = build_filename(row)

    result = {"sl_no": sl_no, "status": "ok", "error": None, "file": output_path.name}

    log.info(f"SL {sl_no} | START — {question[:65]}...")
    log.info(f"SL {sl_no} | Output file: {output_path.name}")

    if output_path.exists():
        log.info(f"SL {sl_no} | SKIP — image already exists")
        result["status"] = "skipped"
        return result

    if not nb_prompt:
        log.error(f"SL {sl_no} | SKIP — NanoBanana_Prompt is empty (run stage1.py first)")
        result["status"] = "error"
        result["error"] = "empty prompt"
        return result

    try:
        call_nano_banana(client, system_prompt, nb_prompt, output_path, log, sl_no)

        log.info(f"SL {sl_no} | Step C: Updating CSV")
        mark_done(sl_no, fieldnames, rows, log)
        log.info(f"SL {sl_no} | DONE ✓")

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        log.error(f"SL {sl_no} | FAILED — {e}")

    return result


# ── Batch runner ──────────────────────────────────────────────────────────────
def run_batch(batch_rows: list, client: genai.Client, system_prompt: str,
              fieldnames: list, rows: list, log: logging.Logger,
              batch_num: int, total_batches: int):

    sl_list = [r["SL_NO"].strip() for r in batch_rows]
    log.info("═" * 65)
    log.info(f"BATCH {batch_num}/{total_batches} — SL {sl_list} — {MAX_WORKERS} parallel workers")
    log.info("═" * 65)

    t_start = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS,
                            thread_name_prefix=f"NB{batch_num}") as executor:
        futures = {
            executor.submit(
                process_diagram, row, client, system_prompt, fieldnames, rows, log
            ): row["SL_NO"].strip()
            for row in batch_rows
        }
        results = [f.result() for f in as_completed(futures)]

    elapsed = time.time() - t_start
    ok      = sum(1 for r in results if r["status"] == "ok")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    errors  = [r for r in results if r["status"] == "error"]

    log.info("─" * 65)
    log.info(f"BATCH {batch_num} complete in {elapsed:.1f}s — "
             f"Generated: {ok} | Skipped: {skipped} | Errors: {len(errors)}")
    for r in results:
        if r["status"] == "ok":
            log.info(f"  ✓ SL {r['sl_no']} → {r['file']}")
        elif r["status"] == "skipped":
            log.info(f"  - SL {r['sl_no']} → skipped (exists)")
        else:
            log.error(f"  ✗ SL {r['sl_no']} → {r['error']}")

    return results


# ── Batch builder ─────────────────────────────────────────────────────────────
def build_batches(rows: list) -> list:
    target = [r for r in rows if int(r["SL_NO"].strip()) < CASE_STUDY_CUTOFF]
    return [target[i:i + BATCH_SIZE] for i in range(0, len(target), BATCH_SIZE)]


# ── CLI ───────────────────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(description="Stage 2: Nano Banana 2 diagram generation")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--batch", metavar="N|all",
                       help="Run batch N (1-indexed) or 'all' batches in sequence")
    group.add_argument("--list", action="store_true",
                       help="List all batches with SL numbers and output filenames")
    group.add_argument("--retry-failed", action="store_true",
                       help="Retry rows where image file is missing")
    return parser.parse_args()


def main():
    args = parse_args()
    log  = setup_logging()

    OUTPUT_DIR.mkdir(exist_ok=True)

    log.info("Step: Loading ImageGeneratorUsingNanoBanana system prompt")
    system_prompt = Path(STEP2_PROMPT_FILE).read_text().strip()
    log.info(f"Step: System prompt loaded ({len(system_prompt)} chars)")

    log.info("Step: Reading DiagramsMakingSheet.csv")
    fieldnames, rows = read_csv()

    if "Image_Generated" not in fieldnames:
        fieldnames = list(fieldnames) + ["Image_Generated"]
        for row in rows:
            row.setdefault("Image_Generated", "")

    batches = build_batches(rows)
    total   = len(batches)

    # ── --list ─────────────────────────────────────────────────────────────
    if args.list:
        log.info(f"Total: {total} batches × {BATCH_SIZE} diagrams  ({BATCH_SIZE * (total-1) + len(batches[-1])} questions)")
        for i, batch in enumerate(batches, 1):
            log.info(f"  Batch {i:>2}:")
            for r in batch:
                fname = build_filename(r).name
                exists = "✓" if build_filename(r).exists() else " "
                log.info(f"    [{exists}] SL {r['SL_NO']:>2} → {fname}")
        return

    # ── Connect to Vertex AI ───────────────────────────────────────────────
    client = setup_client(log)

    # ── --retry-failed ─────────────────────────────────────────────────────
    if args.retry_failed:
        failed_rows = [
            r for r in rows
            if int(r["SL_NO"].strip()) < CASE_STUDY_CUTOFF
            and not build_filename(r).exists()
            and r.get("NanoBanana_Prompt", "").strip()
        ]
        if not failed_rows:
            log.info("No failed rows — all images already exist.")
            return
        log.info(f"Retrying {len(failed_rows)} missing: SL {[r['SL_NO'].strip() for r in failed_rows]}")
        retry_batches = [failed_rows[i:i + BATCH_SIZE] for i in range(0, len(failed_rows), BATCH_SIZE)]
        for i, batch in enumerate(retry_batches, 1):
            run_batch(batch, client, system_prompt, fieldnames, rows, log, i, len(retry_batches))
        return

    # ── --batch N or all ───────────────────────────────────────────────────
    if args.batch.lower() == "all":
        log.info(f"Running all {total} batches sequentially")
        for i, batch in enumerate(batches, 1):
            run_batch(batch, client, system_prompt, fieldnames, rows, log, i, total)
    else:
        try:
            n = int(args.batch)
        except ValueError:
            log.error(f"Invalid batch number: {args.batch!r}. Use an integer or 'all'.")
            sys.exit(1)
        if n < 1 or n > total:
            log.error(f"Batch {n} out of range — valid range is 1 to {total}")
            sys.exit(1)
        run_batch(batches[n - 1], client, system_prompt, fieldnames, rows, log, n, total)

    # ── Final summary ──────────────────────────────────────────────────────
    generated = [r for r in rows
                 if int(r["SL_NO"].strip()) < CASE_STUDY_CUTOFF
                 and build_filename(r).exists()]
    log.info("═" * 65)
    log.info(f"Images on disk : {len(generated)}/73")
    log.info(f"Output folder  : {OUTPUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
