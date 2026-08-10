#!/usr/bin/env python3
"""Stage 2 bridge: NanoBanana prompt -> PNG image via Gemini Flash Image.
Reads JSON from stdin, writes JSON to stdout.
Moves existing image to bin/ before saving if bin_dir is provided.
"""
import io, json, sys, time, warnings
from pathlib import Path
warnings.filterwarnings("ignore")

TARGET_W, TARGET_H = 1024, 768

def convert_to_4x3(img_bytes: bytes) -> bytes:
    from PIL import Image
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img.thumbnail((TARGET_W, TARGET_H), Image.LANCZOS)
    canvas = Image.new("RGB", (TARGET_W, TARGET_H), (255, 255, 255))
    canvas.paste(img, ((TARGET_W - img.width) // 2, (TARGET_H - img.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

def main():
    payload       = json.load(sys.stdin)
    nb_prompt     = payload["nb_prompt"]
    system_prompt = payload["system_prompt"]
    output_path   = Path(payload["output_path"])
    creds_path    = payload["credentials_path"]
    bin_dir       = payload.get("bin_dir")

    from google import genai
    from google.genai import types
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_file(
        creds_path, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    with open(creds_path) as f:
        project_id = json.load(f)["project_id"]

    client = genai.Client(
        vertexai=True, project=project_id, location="global", credentials=creds)

    full_prompt = f"{system_prompt}\n\n{nb_prompt}"

    resp = client.models.generate_content(
        model="publishers/google/models/gemini-3.1-flash-image",
        contents=full_prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"], temperature=1.0),
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

    img_bytes = convert_to_4x3(img_bytes)

    # Archive existing file to bin before saving new one
    if bin_dir and output_path.exists():
        Path(bin_dir).mkdir(exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        output_path.rename(Path(bin_dir) / f"{output_path.stem}_{ts}.png")

    output_path.parent.mkdir(exist_ok=True)
    output_path.write_bytes(img_bytes)
    print(json.dumps({"ok": True, "filename": output_path.name}))

try:
    main()
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
    sys.exit(1)
