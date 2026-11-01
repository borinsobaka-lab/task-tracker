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
        clean.setAttribute('title', href)
        // ссылка, у которой текст — это длинный адрес, выводится коротко
        const text = el.textContent ?? ''
        if (el.children.length === 0 && isBareUrlText(text, href)) {
          clean.textContent = shortenUrl(text.trim())
          dest.appendChild(clean)
          return
        }
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

// ---------- Короткие подписи для длинных ссылок ----------

/** Ссылки с текстом короче этого не сокращаем. */
const SHORT_LINK_MIN = 40
const SEGMENT_MAX = 24

/** Текст ссылки — это просто её адрес (как при вставке «голой» ссылки)? */
export function isBareUrlText(text: string, href: string): boolean {
  const t = text.trim()
  if (!t || !href) return false
  return t === href || `https://${t}` === href || `http://${t}` === href
}

/**
 * Короткая подпись для длинного адреса: «домен/…/последний-сегмент».
 * Например, https://www.example.com/a/b/very-long-page?x=1 → example.com/…/very-long-page…
 * Если сократить не выходит — возвращает исходную строку.
 */
export function shortenUrl(raw: string): string {
  if (raw.length <= SHORT_LINK_MIN) return raw
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return raw
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname) return raw
  const host = url.hostname.replace(/^www\./i, '')
  const segments = url.pathname.split('/').filter(Boolean)
  const tail = url.search || url.hash ? '…' : ''
  let label: string
  if (segments.length === 0) {
    label = host + (tail ? '/' + tail : '')
  } else {
    let last = segments[segments.length - 1]
    try {
      last = decodeURIComponent(last)
    } catch {
      /* оставляем как есть */
    }
    const lastTrimmed = last.length > SEGMENT_MAX ? last.slice(0, SEGMENT_MAX - 1) + '…' : last
    const ellipsis = lastTrimmed.endsWith('…') ? '' : tail
    label = host + (segments.length > 1 ? '/…/' : '/') + lastTrimmed + ellipsis
  }
  return label.length < raw.length ? label : raw
}
