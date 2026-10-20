import type { ToolKind } from '../../../server/types.ts'

export const KINDS: { kind: ToolKind; label: string }[] = [
  { kind: 'read', label: 'Read' },
  { kind: 'write', label: 'Write' },
  { kind: 'exec', label: 'Shell' },
  { kind: 'web', label: 'Web' },
  { kind: 'mcp', label: 'MCP' },
  { kind: 'agent', label: 'Agent' },
  { kind: 'other', label: 'Other' },
]

export const kindColor = (k: ToolKind) => `var(--k-${k})`
