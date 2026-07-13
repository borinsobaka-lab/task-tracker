// Единый набор иконок приложения — залитые двутональные (BoldDuotone) из @solar-icons/react.
// Эмодзи остаются только у статусов колонок (ROLE_META) — те же приходят в Telegram-отчётах.
import type { ComponentType } from 'react'
import type { IconProps } from '@solar-icons/react'
import {
  AltArrowDown,
  AltArrowLeft,
  AltArrowRight,
  ArrowRightUp,
  Calendar,
  Camera,
  ChatRoundLine,
  CheckCircle,
  ClipboardList,
  CloseCircle,
  Link,
  Magnifer,
  MenuDots,
  MinusCircle,
  Notes,
  Paperclip,
  RepeatOneMinimalistic,
  Rocket,
  Settings,
  SliderVertical,
  SortVertical,
  TrashBinMinimalistic,
  Videocamera,
  Widget,
} from '@solar-icons/react'

/** Оборачивает иконку: залитая двутональная (BoldDuotone), размер 18, цвет наследуется (currentColor). */
function duotone(Ico: ComponentType<IconProps>): ComponentType<IconProps> {
  return function SolarIcon({ size = 18, ...rest }: IconProps) {
    return <Ico weight="BoldDuotone" size={size} {...rest} />
  }
}

export const IcoBrand = duotone(ClipboardList)
export const IcoBoard = duotone(SliderVertical)
export const IcoCalendar = duotone(Calendar)
export const IcoMatrix = duotone(Widget)
export const IcoRecurring = duotone(RepeatOneMinimalistic)
export const IcoMeeting = duotone(Videocamera)
export const IcoCamera = duotone(Camera)
export const IcoClose = duotone(CloseCircle)
export const IcoCheck = duotone(CheckCircle)
export const IcoMenu = duotone(MenuDots)
export const IcoChevronDown = duotone(AltArrowDown)
export const IcoChevronLeft = duotone(AltArrowLeft)
export const IcoChevronRight = duotone(AltArrowRight)
export const IcoOpen = duotone(ArrowRightUp)
export const IcoTrash = duotone(TrashBinMinimalistic)
export const IcoSort = duotone(SortVertical)
export const IcoSettings = duotone(Settings)
export const IcoPaperclip = duotone(Paperclip)
export const IcoDescription = duotone(Notes)
export const IcoNone = duotone(MinusCircle)
export const IcoSearch = duotone(Magnifer)
export const IcoLaunch = duotone(Rocket)
export const IcoLink = duotone(Link)
export const IcoComment = duotone(ChatRoundLine)

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
