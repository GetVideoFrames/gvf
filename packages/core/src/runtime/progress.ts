/**
 * Progress events as JSONL on stderr (callers decide the stream).
 */

export type ProgressPhase =
  'probe' | 'extract' | 'analyze' | 'detect' | 'select' | 'export' | 'run' | 'setup'

export interface ProgressEvent {
  schema: 'gvf.progress/v1alpha1'
  phase: ProgressPhase
  done: number
  total: number
  message?: string
  percent?: number
}

export type ProgressReporter = (event: ProgressEvent) => void

export function createProgressEvent(
  phase: ProgressPhase,
  done: number,
  total: number,
  message?: string
): ProgressEvent {
  const safeTotal = Math.max(0, total)
  return {
    schema: 'gvf.progress/v1alpha1',
    phase,
    done,
    total: safeTotal,
    message,
    percent: safeTotal > 0 ? Math.min(100, Math.round((done / safeTotal) * 100)) : 0
  }
}

export function stderrJsonlProgress(): ProgressReporter {
  return (event) => {
    process.stderr.write(JSON.stringify(event) + '\n')
  }
}
