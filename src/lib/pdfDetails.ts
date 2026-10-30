import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import './pdf' // sets up the pdf.js worker

export interface ChartDetails {
  pages: number
  key: string | null
  tempo: number | null
  timeSig: string | null
}

/**
 * Best-effort read of a chart PDF: page count, plus key / tempo / time signature when the chart
 * prints them (e.g. "Key - E | Tempo - 72 | Time - 4/4"). Anything not found is left empty.
 */
export async function readChartDetails(file: File): Promise<ChartDetails> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' ')
    const key = text.match(/\bKey\s*(?:of\s+|[-–—:|]\s*)([A-G](?:#|b|♯|♭)?m?)(?![a-z#♯♭])/)?.[1] ?? null
    const tempo = text.match(/\b(?:Tempo|BPM)\s*[-–—:|]?\s*(\d{2,3})\b/i)?.[1]
    const timeSig = text.match(/\bTime(?:\s*Sig(?:nature)?)?\s*[-–—:|]\s*(\d{1,2}\s*\/\s*\d{1,2})/i)?.[1]
    return {
      pages: doc.numPages,
      key: key?.replace('♯', '#').replace('♭', 'b') ?? null,
      tempo: tempo && Number(tempo) >= 30 && Number(tempo) <= 300 ? Number(tempo) : null,
      timeSig: timeSig?.replace(/\s+/g, '') ?? null,
    }
  } finally {
    void task.destroy()
  }
}
