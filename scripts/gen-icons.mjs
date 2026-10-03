// Генерирует src/solarIcons.ts — только нужные иконки Solar и только стиль
// BoldDuotone. Пакет @solar-icons/react кладёт в сборку все 6 стилей каждой
// иконки (~200 КБ JS), а нам нужен один — так стартовый бандл заметно легче.
// Запуск: node scripts/gen-icons.mjs (после добавления иконки в список ниже).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const NAMES = [
  'AltArrowDown', 'AltArrowLeft', 'AltArrowRight', 'ArrowRightUp', 'Calendar', 'Camera', 'Gallery',
  'ChatRoundLine', 'CheckCircle', 'ClipboardList', 'CloseCircle', 'DocumentText', 'Link', 'ListCheck',
  'Magnifer', 'MenuDots', 'MinusCircle', 'Notebook', 'Notes', 'Paperclip', 'PenNewSquare', 'Pin',
  'RepeatOneMinimalistic', 'Rocket', 'Settings', 'SliderVertical', 'SortVertical', 'TrashBinMinimalistic',
  'UsersGroupRounded', 'Widget',
]

// Имя иконки → файл с её стилями: index.mjs → csr/<категория>/<Имя>.mjs → defs/…
const PKG = 'node_modules/@solar-icons/react/dist/esm'
const index = new Map()
const aliases = new Map()
for (const cat of readdirSync(join(PKG, 'csr'))) {
  if (!cat.includes('.')) for (const f of readdirSync(join(PKG, 'csr', cat))) {
    const src = readFileSync(join(PKG, 'csr', cat, f), 'utf8')
    const def = src.match(/from "\.\.\/\.\.\/(defs\/[^"]+)"/)
    const alias = src.match(/^import \w+ from "\.\/([^"]+)\.mjs";/m) // старое написание имени → новое
    if (def) index.set(f.replace(/\.mjs$/, ''), join(PKG, def[1]))
    else if (alias) aliases.set(f.replace(/\.mjs$/, ''), alias[1])
  }
}
for (const [from, to] of aliases) if (index.has(to)) index.set(from, index.get(to))

const out = []
for (const name of NAMES) {
  const file = index.get(name)
  if (!file) throw new Error(`Нет иконки ${name}`)
  const weights = (await import('../' + file)).default
  const el = weights.get('BoldDuotone')
  if (!el) throw new Error(`Нет BoldDuotone у ${name}`)
  out.push(`  ${name}: ${JSON.stringify(renderToStaticMarkup(createElement('g', null, el)).replace(/^<g>|<\/g>$/g, ''))},`)
}

writeFileSync(
  'src/solarIcons.ts',
  `// СГЕНЕРИРОВАНО scripts/gen-icons.mjs — не править руками.\n// Solar Icons Set by 480 Design (CC BY 4.0), из пакета @solar-icons/react (MIT), стиль BoldDuotone: содержимое <svg viewBox="0 0 24 24">.\n\nexport const SOLAR = {\n${out.join('\n')}\n} as const\n`,
)
console.log(`src/solarIcons.ts: ${NAMES.length} иконок`)
