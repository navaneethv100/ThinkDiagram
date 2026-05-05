"""
Stage 1: Generate NanoBanana prompts for all questions via gemini-3.1-pro-preview.
Results are written back into DiagramsMakingSheet.csv under 'NanoBanana_Prompt'.
Already-filled rows are skipped unless --rerun-bad is passed.
Logs are written to logs/stage1.log and streamed to console.
"""

import csv
import json
import logging
import os
import re
import sys
import time
import warnings
from datetime import datetime
from pathlib import Path

warnings.filterwarnings("ignore")

from google import genai
from google.genai import types
from google.oauth2 import service_account

# ── Config ────────────────────────────────────────────────────────────────────
CREDENTIALS_PATH = "credentials/google_credentials.json"
GEMINI_MODEL     = "publishers/google/models/gemini-3.1-pro-preview"
CSV_FILE         = "DiagramsMakingSheet.csv"
STEP1_PROMPT_FILE = "stage1_gemini_prompt_generator.txt"
INTERMEDIATE_DIR = Path("DiagramsGenerated/intermediate")
LOG_DIR          = Path("logs")
DELAY_SECONDS    = 3
MAX_OUTPUT_TOKENS = 4096   # raised from 1024 to prevent mid-response truncation
CASE_STUDY_CUTOFF = 74     # SL 74-79 are case studies — no diagrams needed

# SL numbers whose prompts were wrong/truncated in the first run
BAD_SL_NOS = {
    3, 4, 5, 9, 11, 13, 14, 18, 20, 22, 23, 27, 28, 29, 31, 32,
    33, 34, 36, 38, 42, 43, 45, 46, 47, 48, 53, 54, 56, 57, 58,
    60, 61, 63, 65, 66, 67, 68, 69, 71, 72, 73,
}


# ── Logging setup ─────────────────────────────────────────────────────────────
def setup_logging() -> logging.Logger:
    LOG_DIR.mkdir(exist_ok=True)
    log_file = LOG_DIR / f"stage1_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

    fmt = logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s",
                            datefmt="%H:%M:%S")

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(fmt)

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)

    logger = logging.getLogger("stage1")
    logger.setLevel(logging.DEBUG)
    logger.addHandler(fh)
    logger.addHandler(ch)

    logger.info(f"Log file: {log_file}")
    return logger


# ── Gemini client ─────────────────────────────────────────────────────────────
def setup_client(log: logging.Logger) -> genai.Client:
    log.info("Step: Setting up Gemini client")
    creds = service_account.Credentials.from_service_account_file(
        CREDENTIALS_PATH,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    project_id = json.load(open(CREDENTIALS_PATH))["project_id"]
    client = genai.Client(
        vertexai=True, project=project_id, location="global", credentials=creds
    )
    log.info(f"Step: Connected to Vertex AI — project={project_id}  model={GEMINI_MODEL}")
    return client


# ── Gemini call ───────────────────────────────────────────────────────────────
def call_gemini(client: genai.Client, system_prompt: str, question: str,
                log: logging.Logger) -> str:
    log.debug("Step: Sending request to Gemini")
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=f"Question:\n{question}",
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.2,
            max_output_tokens=MAX_OUTPUT_TOKENS,
        ),
    )
    text = "".join(p.text for p in response.candidates[0].content.parts if p.text)
    log.debug(f"Step: Gemini response received ({len(text)} chars)")
    return text


# ── Extraction ────────────────────────────────────────────────────────────────
def extract_nanobanana_input(gemini_response: str, sl_no: str,
                             log: logging.Logger) -> str:
    log.debug("Step: Extracting NanoBanana Input from response")

    # Primary: look for the labelled section
    match = re.search(
        r"NanoBanana Input:\s*\n([\s\S]+?)(?:\n\nGoal:|\Z)",
        gemini_response,
        re.IGNORECASE,
    )
    if match:
        result = match.group(1).strip()
        log.debug(f"Step: NanoBanana Input extracted via regex ({len(result)} chars)")
        return result

    # Fallback: last substantial paragraph (skip anything starting with "Question:")
    paragraphs = [
        p.strip() for p in gemini_response.strip().split("\n\n")
        if p.strip() and not p.strip().startswith("Question:")
        and not p.strip().startswith("Final Output")
        and not p.strip().startswith("Goal:")
        and len(p.strip()) > 40
    ]
    if paragraphs:
        result = paragraphs[-1]
        log.warning(
            f"SL {sl_no}: NanoBanana Input section not found — "
            f"used last paragraph as fallback ({len(result)} chars)"
        )
        return result

    log.error(f"SL {sl_no}: Could not extract any usable prompt from Gemini response")
    return ""


# ── Quality check ─────────────────────────────────────────────────────────────
def is_good_prompt(prompt: str) -> bool:
    if not prompt or len(prompt) < 40:
        return False
    if prompt.startswith("Question:") or prompt.startswith("Final Output"):
        return False
    if re.match(r"^Core Concept\s*[:$]", prompt):
        return False
    # Ends mid-sentence (no terminal punctuation and last word not a label)
    last_char = prompt.rstrip()[-1]
    if last_char not in '.)"\']-' and len(prompt) < 200:
        return False
    return True


# ── CSV helpers ───────────────────────────────────────────────────────────────
def read_csv():
    with open(CSV_FILE, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def write_csv(fieldnames, rows, log: logging.Logger):
    with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    log.debug("Step: CSV written to disk")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    log = setup_logging()
    rerun_bad = "--rerun-bad" in sys.argv

    INTERMEDIATE_DIR.mkdir(parents=True, exist_ok=True)

    # Load system prompt
    log.info("Step: Loading ImagePromptGenerator system prompt")
    system_prompt = Path(STEP1_PROMPT_FILE).read_text().strip()
    log.info(f"Step: System prompt loaded ({len(system_prompt)} chars)")

    # Connect to Gemini
    client = setup_client(log)

    # Read CSV
    log.info("Step: Reading DiagramsMakingSheet.csv")
    fieldnames, rows = read_csv()
    if "NanoBanana_Prompt" not in fieldnames:
        fieldnames = list(fieldnames) + ["NanoBanana_Prompt"]
        for row in rows:
            row.setdefault("NanoBanana_Prompt", "")

    # Filter to only question rows (SL 1–73)
    target_rows = [r for r in rows if int(r["SL_NO"].strip()) < CASE_STUDY_CUTOFF]

    # Decide which rows to process
    to_process = []
    for r in target_rows:
        sl = int(r["SL_NO"].strip())
        existing = r.get("NanoBanana_Prompt", "").strip()
        if rerun_bad and sl in BAD_SL_NOS:
            to_process.append(r)
        elif not existing:
            to_process.append(r)

    already_done = len(target_rows) - len(to_process)
    log.info(
        f"Step: {len(target_rows)} questions in scope | "
        f"{already_done} already done | {len(to_process)} to process"
    )

    if not to_process:
        log.info("Nothing to do — all prompts are filled. Use --rerun-bad to regenerate bad ones.")
        return

    errors = 0
    for idx, row in enumerate(to_process, 1):
        sl_no  = row["SL_NO"].strip()
        year   = row["Year"].strip()
        question = row["Questions"].strip()

        log.info(f"── [{idx}/{len(to_process)}] SL {sl_no} ──────────────────────────")
        log.info(f"Question: {question[:90]}{'...' if len(question)>90 else ''}")

        try:
            # Step A: Call Gemini
            log.info(f"SL {sl_no} | Step A: Calling {GEMINI_MODEL}")
            gemini_response = call_gemini(client, system_prompt, question, log)

            # Save full response
            intermediate_path = INTERMEDIATE_DIR / f"{sl_no}_{year}_gemini.txt"
            intermediate_path.write_text(gemini_response, encoding="utf-8")
            log.info(f"SL {sl_no} | Step A: Gemini response saved → {intermediate_path.name}")

            # Step B: Extract NanoBanana Input
            log.info(f"SL {sl_no} | Step B: Extracting NanoBanana Input")
            nanobanana_input = extract_nanobanana_input(gemini_response, sl_no, log)

            if not is_good_prompt(nanobanana_input):
                log.warning(
                    f"SL {sl_no} | Step B: Extracted prompt failed quality check — "
                    f"preview: {repr(nanobanana_input[:80])}"
                )
            else:
                log.info(f"SL {sl_no} | Step B: Prompt OK — {nanobanana_input[:80]}...")

            # Step C: Write to CSV
            log.info(f"SL {sl_no} | Step C: Writing prompt to CSV")

            # Update the matching row in the full rows list
            for r in rows:
                if r["SL_NO"].strip() == sl_no:
                    r["NanoBanana_Prompt"] = nanobanana_input
                    break
            write_csv(fieldnames, rows, log)
            log.info(f"SL {sl_no} | Step C: CSV updated ✓")

        except Exception as e:
            errors += 1
            log.error(f"SL {sl_no} | FAILED: {e}")

        if idx < len(to_process):
            log.debug(f"Waiting {DELAY_SECONDS}s before next request...")
            time.sleep(DELAY_SECONDS)

    filled = sum(
        1 for r in rows
        if int(r["SL_NO"].strip()) < CASE_STUDY_CUTOFF
        and r.get("NanoBanana_Prompt", "").strip()
    )
    log.info("═" * 60)
    log.info(f"Stage 1 complete: {filled}/{len(target_rows)} prompts in CSV")
    log.info(f"Errors: {errors}")
    log.info(f"Intermediate responses: {INTERMEDIATE_DIR}/")


if __name__ == "__main__":
    main()
