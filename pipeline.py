"""
UPSC Diagram Generation Pipeline

Step 1: gemini-3.1-pro-preview identifies the best academic diagram for each question
         using the ImagePromptGenerator.txt system prompt.

Step 2: NanoBanana 2.0 generates the actual diagram image
         using the ImageGeneratorUsingNanoBanana.txt system prompt.

Credentials: place google_credentials.json in credentials/
Config:       copy .env.example to .env and fill in values
"""

import csv
import json
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.oauth2 import service_account

load_dotenv()

CREDENTIALS_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "credentials/google_credentials.json")
GEMINI_MODEL = "publishers/google/models/gemini-3.1-pro-preview"  # requires location=global

NANOBANANA_API_KEY = os.getenv("NANOBANANA_API_KEY", "")
NANOBANANA_API_URL = os.getenv("NANOBANANA_API_URL", "")

CSV_FILE = "DiagramsMakingSheet.csv"
STEP1_PROMPT_FILE = "ImagePromptGenerator.txt"
STEP2_PROMPT_FILE = "ImageGeneratorUsingNanoBanana.txt"
OUTPUT_DIR = Path("DiagramsGenerated")
INTERMEDIATE_DIR = OUTPUT_DIR / "intermediate"


def load_text(filepath: str) -> str:
    with open(filepath, "r") as f:
        return f.read().strip()


def setup_client() -> genai.Client:
    creds = service_account.Credentials.from_service_account_file(
        CREDENTIALS_PATH,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    project_id = json.load(open(CREDENTIALS_PATH))["project_id"]
    return genai.Client(vertexai=True, project=project_id, location="global", credentials=creds)


def call_gemini(client: genai.Client, system_prompt: str, question: str) -> str:
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=f"Question:\n{question}",
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.2,
            max_output_tokens=1024,
        ),
    )
    return "".join(p.text for p in response.candidates[0].content.parts if p.text)


def extract_nanobanana_input(gemini_response: str) -> str:
    match = re.search(
        r"NanoBanana Input:\s*\n([\s\S]+?)(?:\n\nGoal:|$)",
        gemini_response,
        re.IGNORECASE,
    )
    if match:
        return match.group(1).strip()
    # Fallback: last non-empty paragraph
    paragraphs = [p.strip() for p in gemini_response.strip().split("\n\n") if p.strip()]
    return paragraphs[-1] if paragraphs else gemini_response.strip()


def call_nanobanana(image_system_prompt: str, nanobanana_input: str, output_path: Path) -> None:
    """
    NanoBanana 2.0 image generation.

    TODO: Confirm the exact request/response structure for NanoBanana 2.0.
    The payload below is a best-guess — update once API docs are shared.
    """
    if not NANOBANANA_API_KEY or not NANOBANANA_API_URL:
        raise RuntimeError(
            "NANOBANANA_API_KEY and NANOBANANA_API_URL must be set in .env\n"
            "Please provide NanoBanana 2.0 API details."
        )

    payload = {
        "model": "nanobanana-2.0",
        "system": image_system_prompt,
        "prompt": nanobanana_input,
        "output_format": "png",
    }
    headers = {
        "Authorization": f"Bearer {NANOBANANA_API_KEY}",
        "Content-Type": "application/json",
    }
    response = requests.post(NANOBANANA_API_URL, json=payload, headers=headers, timeout=120)
    response.raise_for_status()

    # Adjust based on actual NanoBanana response format:
    # Option A — response body is the raw image bytes:
    output_path.write_bytes(response.content)

    # Option B — response is JSON with an image URL:
    # image_url = response.json()["image_url"]
    # output_path.write_bytes(requests.get(image_url, timeout=60).content)


def process_row(client: genai.Client, step1_prompt: str, step2_prompt: str, row: dict) -> None:
    sl_no = row["SL_NO"].strip()
    year = row["Year"].strip()
    question = row["Questions"].strip()

    print(f"\n[{sl_no}] {question[:70]}...")

    # Step 1 — Gemini identifies best diagram
    print(f"  Step 1: {GEMINI_MODEL}...")
    gemini_response = call_gemini(client, step1_prompt, question)

    INTERMEDIATE_DIR.mkdir(parents=True, exist_ok=True)
    (INTERMEDIATE_DIR / f"{sl_no}_{year}_gemini.txt").write_text(gemini_response, encoding="utf-8")

    nanobanana_input = extract_nanobanana_input(gemini_response)
    print(f"  NanoBanana Input: {nanobanana_input[:80]}...")

    # Step 2 — NanoBanana 2.0 generates the diagram image
    print("  Step 2: NanoBanana 2.0...")
    output_path = OUTPUT_DIR / f"{sl_no}_{year}.png"
    call_nanobanana(step2_prompt, nanobanana_input, output_path)
    print(f"  Saved: {output_path}")


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)

    step1_prompt = load_text(STEP1_PROMPT_FILE)
    step2_prompt = load_text(STEP2_PROMPT_FILE)

    client = setup_client()
    print(f"Connected: {GEMINI_MODEL} on Vertex AI")

    with open(CSV_FILE, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"Processing {len(rows)} questions...\n")

    for row in rows:
        try:
            process_row(client, step1_prompt, step2_prompt, row)
        except Exception as e:
            print(f"  ERROR on SL {row.get('SL_NO')}: {e}")
        time.sleep(2)

    print("\nDone.")
    print(f"Images:               {OUTPUT_DIR}/")
    print(f"Gemini responses:     {INTERMEDIATE_DIR}/")


if __name__ == "__main__":
    main()
