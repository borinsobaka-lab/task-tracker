// Санитайзер HTML для показа комментариев (и любого пользовательского rich-text)
// в режиме «только чтение». Строим НОВОЕ дерево из белого списка тегов — всё
// прочее (скрипты, обработчики, style, опасные ссылки) отбрасывается. Так даже
// если в данные каким-то образом попадёт вредоносный HTML (например, через
// синхронизацию), при выводе он будет безопасным.

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL',
  'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'CODE', 'PRE', 'SPAN',
])

/** Пропускаем только безопасные протоколы ссылок. */
function safeHref(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  // относительные/якорные ссылки безопасны
  if (url.startsWith('#') || url.startsWith('/')) return url
  if (/^(https?:|mailto:)/i.test(url)) return url
  // есть какая-то схема, но не из разрешённых (javascript:, data: и т.п.) — режем
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null
  // без схемы — трактуем как относительную
  return url
}

function sanitizeInto(src: Node, dest: Node, doc: Document): void {
  src.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      dest.appendChild(doc.createTextNode(child.textContent ?? ''))
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    const tag = el.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE') return // содержимое отбрасываем целиком
    if (!ALLOWED_TAGS.has(tag)) {
      // неизвестный тег «разворачиваем» — оставляем безопасное содержимое
      sanitizeInto(el, dest, doc)
      return
    }
    const clean = doc.createElement(tag.toLowerCase())
    if (tag === 'A') {
      const href = safeHref(el.getAttribute('href') ?? '')
      if (href) {
        clean.setAttribute('href', href)
        clean.setAttribute('target', '_blank')
        clean.setAttribute('rel', 'noopener noreferrer nofollow')
      }
    }
    sanitizeInto(el, clean, doc)
    dest.appendChild(clean)
  })
}

/** Возвращает безопасный HTML для вывода через dangerouslySetInnerHTML. */
export function sanitizeCommentHtml(html: string): string {
  if (!html) return ''
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const container = parsed.createElement('div')
  sanitizeInto(parsed.body, container, parsed)
  return container.innerHTML
}
