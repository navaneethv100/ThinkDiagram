const g = globalThis as Record<string, unknown>
if (!g.__uploadActive) g.__uploadActive = new Set<string>()
export const activeSessions = g.__uploadActive as Set<string>
