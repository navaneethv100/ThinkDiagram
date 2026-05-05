import type { JobStatus, QuickJobStatus } from './types'

// Use globalThis so job state survives HMR in development
const g = globalThis as Record<string, unknown>

if (!g.__diagramJobs) g.__diagramJobs = new Map<string, JobStatus>()
if (!g.__quickJobs)   g.__quickJobs   = new Map<string, QuickJobStatus>()

export const diagramJobs = g.__diagramJobs as Map<string, JobStatus>
export const quickJobs   = g.__quickJobs   as Map<string, QuickJobStatus>
