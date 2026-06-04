import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { REPO_ROOT, SCRIPTS_DIR, STAGE1_PROMPT, STAGE2_PROMPT, CREDENTIALS, SK_LOGO } from './paths'

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

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env: { ...process.env } })

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed: ${stderr.slice(0, 500)}`))
    })
  })
}

async function addWatermark(outputPath: string): Promise<void> {
  if (!fs.existsSync(SK_LOGO)) throw new Error(`SuperKalam logo not found: ${SK_LOGO}`)
  await runCommand('python3', [path.join(SCRIPTS_DIR, 'add_watermark.py'), SK_LOGO, outputPath], REPO_ROOT)
}

export async function runStage1(question: string, extra: string): Promise<string> {
  const system_prompt = fs.readFileSync(STAGE1_PROMPT, 'utf-8').trim()
  const result = await runPython('stage1_bridge.py', {
    question,
    extra,
    system_prompt,
    credentials_path: CREDENTIALS,
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
    credentials_path: CREDENTIALS,
    ...(binDir ? { bin_dir: binDir } : {}),
  })
  await addWatermark(outputPath)
  return result.filename as string
}
