// Контекст «прочитанного» комментариев (локально на устройстве) для красного
// бейджа непрочитанных на доске. Отдельно от панели комментариев — чтобы доска
// не тянула за собой редактор (TipTap) в стартовый бандл.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Card, Comment, ID } from '../types'
import { getCommentsSeen, setCommentsSeen } from '../config'
import { nowISO } from '../utils'

interface SeenCtx {
  seenAt: (cardId: ID) => string | null
  markSeen: (cardId: ID) => void
}

const CommentsSeenContext = createContext<SeenCtx>({ seenAt: () => null, markSeen: () => {} })

export function useCommentsSeen(): SeenCtx {
  return useContext(CommentsSeenContext)
}

export function CommentsSeenProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, string>>(getCommentsSeen)

  useEffect(() => {
    setCommentsSeen(map)
  }, [map])

  const seenAt = useCallback((cardId: ID) => map[cardId] ?? null, [map])
  const markSeen = useCallback((cardId: ID) => {
    setMap((prev) => ({ ...prev, [cardId]: nowISO() }))
  }, [])

  const value = useMemo(() => ({ seenAt, markSeen }), [seenAt, markSeen])
  return <CommentsSeenContext.Provider value={value}>{children}</CommentsSeenContext.Provider>
}

// ---------- Помощники для бейджа на доске ----------

export function liveComments(card: Card): Comment[] {
  return card.comments ? card.comments.filter((c) => !c.deleted) : []
}

export function hasUnseenComments(card: Card, myId: ID | null, seenAt: string | null): boolean {
  if (!card.comments) return false
  return card.comments.some(
    (c) => !c.deleted && c.authorId !== myId && (!seenAt || c.createdAt > seenAt),
  )
}
