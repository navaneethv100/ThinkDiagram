import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { REPO_ROOT, SCRIPTS_DIR, STAGE1_PROMPT, STAGE2_PROMPT } from './paths'

function runPython(scriptName: string, payload: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [path.join(SCRIPTS_DIR, scriptName)], {
      cwd: REPO_ROOT, // all relative paths in Python resolve from repo root
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.stdin.write(JSON.stringify(payload))
    proc.stdin.end()

    proc.on('close', (code) => {
      try {
        const result = JSON.parse(stdout.trim()) as Record<string, unknown>
        if (result.ok) resolve(result)
        else reject(new Error((result.error as string) || 'Python script failed'))
      } catch {
        reject(new Error(`Python script crashed (exit ${code}): ${stderr.slice(0, 500)}`))
      }
    })
  })
}

export async function runStage1(question: string, extra: string): Promise<string> {
  const system_prompt = fs.readFileSync(STAGE1_PROMPT, 'utf-8').trim()
  const result = await runPython('stage1_bridge.py', {
    question,
    extra,
    system_prompt,
  })
  return result.prompt as string
}

export async function runStage2(
  nbPrompt: string,
  outputPath: string,
  binDir?: string,
): Promise<string> {
  const system_prompt = fs.readFileSync(STAGE2_PROMPT, 'utf-8').trim()
  const result = await runPython('stage2_bridge.py', {
    nb_prompt: nbPrompt,
    system_prompt,
    output_path: outputPath,
    ...(binDir ? { bin_dir: binDir } : {}),
  })
  return result.filename as string
}
