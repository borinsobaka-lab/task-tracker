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
  CheckCircle,
  ClipboardList,
  CloseCircle,
  MenuDots,
  MinusCircle,
  Notes,
  Paperclip,
  Refresh,
  Settings,
  SortVertical,
  Target,
  TrashBinMinimalistic,
  Videocamera,
  Widget,
} from '@solar-icons/react'

/** Оборачивает иконку: по умолчанию залитая двутональная, размер 18, цвет — currentColor. */
function duotone(Ico: ComponentType<IconProps>): ComponentType<IconProps> {
  return function SolarIcon(props: IconProps) {
    return <Ico weight="BoldDuotone" size={18} {...props} />
  }
}

export const IcoBrand = duotone(ClipboardList)
export const IcoBoard = duotone(Widget)
export const IcoCalendar = duotone(Calendar)
export const IcoMatrix = duotone(Target)
export const IcoRecurring = duotone(Refresh)
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
