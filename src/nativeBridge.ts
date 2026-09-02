// Мост в Android-оболочку (WebView). Приложение сообщает нативной части, кто
// сейчас выбран в «Кто вы?» — виджет на рабочем столе показывает задачи только
// этого участника. В обычном браузере объекта нет и вызовы просто игнорируются.

interface AndroidBridge {
  /** id и имя выбранного участника; пустые строки — участник не выбран. */
  setIdentity(id: string, name: string): void
}

declare global {
  interface Window {
    TaskTrackerAndroid?: AndroidBridge
  }
}

/** Сообщить Android-оболочке выбранного участника (best-effort). */
export function reportIdentityToNative(id: string | null, name: string | null): void {
  try {
    window.TaskTrackerAndroid?.setIdentity(id ?? '', name ?? '')
  } catch {
    /* не Android или мост недоступен — не важно */
  }
}
