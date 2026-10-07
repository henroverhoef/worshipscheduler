// Copies pdf.js font data into public/ so charts with non-embedded fonts render offline.
import { cpSync, mkdirSync } from 'node:fs'

const from = 'node_modules/pdfjs-dist'
mkdirSync('public/pdfjs', { recursive: true })
for (const dir of ['standard_fonts', 'cmaps']) {
  cpSync(`${from}/${dir}`, `public/pdfjs/${dir}`, { recursive: true })
}
