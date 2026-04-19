export function parseAssistantText(content: string): {
  content: string
  kind?: 'final' | 'progress'
} {
  const trimmed = content.trim()
  if (!trimmed) {
    return { content: '' }
  }

  const markers: Array<{
    prefix: string
    kind: 'final' | 'progress'
  }> = [
    { prefix: '<final>', kind: 'final' },
    { prefix: '[FINAL]', kind: 'final' },
    { prefix: '<progress>', kind: 'progress' },
    { prefix: '[PROGRESS]', kind: 'progress' },
  ]

  for (const marker of markers) {
    if (trimmed.startsWith(marker.prefix)) {
      const raw = trimmed.slice(marker.prefix.length).trim()
      const close = marker.kind === 'progress' ? /<\/progress>/gi : /<\/final>/gi
      return {
        content: raw.replace(close, '').trim(),
        kind: marker.kind,
      }
    }
  }

  return { content: trimmed }
}

export function formatAssistantText(message: {
  role: 'assistant' | 'assistant_progress'
  content: string
}): string {
  if (message.role === 'assistant_progress') {
    return `<progress>\n${message.content}\n</progress>`
  }

  return message.content
}
