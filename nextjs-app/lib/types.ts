export interface DiagramRow {
  SL_NO: string
  Year: string
  Questions: string
  NanoBanana_Prompt: string
  Diagram_Name: string
  Extra_Instructions: string
}

export interface DiagramCard {
  sl_no: string
  year: string
  question: string
  prompt: string
  extra_instructions: string
  diagram_name: string
  image_file: string | null
}

export interface BucketItem {
  id: string
  filename: string
  source: 'quick' | 'diagram'
  label: string
  description: string
  added_at: string
}

export interface JobStatus {
  status: 'idle' | 'generating' | 'done' | string
}

export interface QuickJobStatus {
  status: 'stage1' | 'stage2' | 'done' | 'error' | 'not_found'
  stage1_prompt?: string | null
  image_file?: string | null
  description?: string
  diagram_type?: string
  error?: string
}
