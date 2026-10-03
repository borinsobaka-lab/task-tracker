/** Экран запуска — тот же, что рисует index.html до загрузки скриптов (стили
 *  .boot-* там же): фон и шапка приложения, без белой вспышки. Спиннер с
 *  подписью появляется, только если ждать приходится заметно (первый вход). */
export function BootScreen({ text }: { text: string }) {
  return (
    <div className="boot" aria-busy="true">
      <div className="boot-hdr" />
      <div className="boot-main">
        <div className="boot-wait">
          <div className="boot-spin" />
          <div>{text}</div>
        </div>
      </div>
      <div className="boot-nav" />
    </div>
  )
}
