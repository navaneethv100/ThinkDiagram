#!/usr/bin/env python3
"""Stage 1 bridge: question -> NanoBanana prompt via the Gemini API.
Reads JSON from stdin, writes JSON to stdout.
"""
import json, os, re, sys, warnings
warnings.filterwarnings("ignore")

def main():
    payload       = json.load(sys.stdin)
    question      = payload["question"]
    extra         = payload.get("extra", "")
    system_prompt = payload["system_prompt"]

    from google import genai
    from google.genai import types

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured")

    client = genai.Client(api_key=api_key)

    content = f"Question:\n{question}"
    if extra:
        content += f"\n\nSpecial Instructions from user: {extra}"

    resp = client.models.generate_content(
        model="gemini-3.1-pro-preview",
        contents=content,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt, temperature=0.2, max_output_tokens=4096),
    )
    text = "".join(
        p.text for p in resp.candidates[0].content.parts if getattr(p, "text", None))

    m = re.search(r"NanoBanana Input:\s*\n([\s\S]+?)(?:\n\nGoal:|\Z)", text, re.IGNORECASE)
    if m:
        result = m.group(1).strip()
    else:
        paras = [p.strip() for p in text.strip().split("\n\n")
                 if p.strip() and not p.strip().startswith("Question:") and len(p.strip()) > 40]
        result = paras[-1] if paras else text.strip()

    print(json.dumps({"ok": True, "prompt": result}))

try:
    main()
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
    sys.exit(1)
