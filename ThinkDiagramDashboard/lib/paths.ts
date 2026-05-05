import path from 'path'

// ThinkDiagramDashboard/ is one level inside the repo root
export const REPO_ROOT       = path.resolve(process.cwd(), '..')
export const CSV_FILE        = path.join(REPO_ROOT, 'DiagramsMakingSheet.csv')
export const BUCKET_FILE     = path.join(REPO_ROOT, 'bucket.json')
export const FINAL_DIAGRAMS  = path.join(REPO_ROOT, 'FinalDiagrams')
export const QUICK_GENERATED = path.join(REPO_ROOT, 'QuickGenerated')
export const BIN_DIR         = path.join(REPO_ROOT, 'bin')
export const STAGE1_PROMPT   = path.join(REPO_ROOT, 'stage1_gemini_prompt_generator.txt')
export const STAGE2_PROMPT   = path.join(REPO_ROOT, 'stage2_nanoBanana_image_generator.txt')
export const SCRIPTS_DIR     = path.join(process.cwd(), 'scripts')
export const CREDENTIALS     = path.join(REPO_ROOT, 'credentials', 'google_credentials.json')
export const CASE_STUDY_CUTOFF = 74
