import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  sh: 'shellscript',
  bash: 'shellscript',
  md: 'markdown',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
  sql: 'sql',
  xml: 'xml',
}

export function langFromPath(p: string) {
  return EXT_LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'text'
}

const LANG_ALIAS: Record<string, string> = { sh: 'shellscript', bash: 'shellscript', shell: 'shellscript', zsh: 'shellscript', js: 'javascript', ts: 'typescript', py: 'python', yml: 'yaml' }

/** Syntax highlighting via Shiki, loaded lazily; renders plain text until ready. */
export function CodeBlock({ code, lang = 'text', wrap = false }: { code: string; lang?: string; wrap?: boolean }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const l = LANG_ALIAS[lang] ?? lang
    import('shiki/bundle/web').then(async ({ codeToHtml, bundledLanguages }) => {
      const out = await codeToHtml(code, {
        lang: l in bundledLanguages ? l : 'text',
        themes: { light: 'github-light', dark: 'github-dark-dimmed' },
        defaultColor: false,
      })
      if (!cancelled) setHtml(out)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  const cls = `font-mono text-[12px] leading-[1.6] [&_pre]:overflow-x-auto ${
    wrap ? '[&_pre]:whitespace-pre-wrap [&_pre]:break-words' : '[&_pre]:whitespace-pre'
  }`
  if (!html)
    return (
      <div className={cls}>
        <pre className="text-fg-2">{code}</pre>
      </div>
    )
  return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />
}

export function SkillMarkdown({ source }: { source: string }) {
  return (
    <div className="prose-skill">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children }) {
            const text = String(children ?? '')
            const lang = /language-(\S+)/.exec(className ?? '')?.[1]
            if (!lang && !text.includes('\n')) return <code>{children}</code>
            return (
              <div className="code-frame">
                <CodeBlock code={text.replace(/\n$/, '')} lang={lang} />
              </div>
            )
          },
        }}
      >
        {source}
      </Markdown>
    </div>
  )
}
