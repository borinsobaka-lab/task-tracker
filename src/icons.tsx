// Единый набор иконок приложения — залитые двутональные (BoldDuotone) из @solar-icons/react.
// Эмодзи остаются только у статусов колонок (ROLE_META) — те же приходят в Telegram-отчётах.
import type { ComponentType } from 'react'
import { SOLAR } from './solarIcons'

export interface IconProps {
  size?: number | string
  color?: string
}

/** Иконка Solar: залитая двутональная (BoldDuotone), размер 18, цвет наследуется (currentColor).
 *  Разметка путей — из src/solarIcons.ts (генерируется scripts/gen-icons.mjs). */
function duotone(name: keyof typeof SOLAR): ComponentType<IconProps> {
  const html = { __html: SOLAR[name] }
  return function SolarIcon({ size = 18, color = 'currentColor' }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" color={color} aria-hidden="true" dangerouslySetInnerHTML={html} />
    )
  }
}

export const IcoBrand = duotone('ClipboardList')
export const IcoBoard = duotone('SliderVertical')
export const IcoCalendar = duotone('Calendar')
export const IcoMatrix = duotone('Widget')
export const IcoRecurring = duotone('RepeatOneMinimalistic')
export const IcoMeeting = duotone('UsersGroupRounded')
export const IcoCamera = duotone('Camera')
export const IcoClose = duotone('CloseCircle')
export const IcoCheck = duotone('CheckCircle')
export const IcoMenu = duotone('MenuDots')
export const IcoChevronDown = duotone('AltArrowDown')
export const IcoChevronLeft = duotone('AltArrowLeft')
export const IcoChevronRight = duotone('AltArrowRight')
export const IcoOpen = duotone('ArrowRightUp')
export const IcoTrash = duotone('TrashBinMinimalistic')
export const IcoSort = duotone('SortVertical')
export const IcoSettings = duotone('Settings')
export const IcoPaperclip = duotone('Paperclip')
export const IcoDescription = duotone('Notes')
export const IcoNone = duotone('MinusCircle')
export const IcoSearch = duotone('Magnifer')
export const IcoLaunch = duotone('Rocket')
export const IcoLink = duotone('Link')
export const IcoComment = duotone('ChatRoundLine')
export const IcoNotes = duotone('Notebook')
export const IcoCompose = duotone('PenNewSquare')
export const IcoPin = duotone('Pin')
export const IcoChecklist = duotone('ListCheck')
export const IcoGallery = duotone('Gallery')
export const IcoFile = duotone('DocumentText')

/** Чистый тонкий крестик закрытия (аккуратнее и крупнее, чем залитый кружок). */
export function IcoX({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Простые понятные стрелки-«шевроны» (крупнее и жирнее набора Solar). */
export function IcoArrowLeft({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 4.5 7.5 12 15 19.5" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
export function IcoArrowRight({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4.5 16.5 12 9 19.5" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
