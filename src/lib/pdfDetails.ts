import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import './pdf' // sets up the pdf.js worker

export interface ChartDetails {
  pages: number
  key: string | null
  tempo: number | null
  timeSig: string | null
  /** The chart's words, chord/number lines left out (null if the PDF has no text, e.g. a scan). */
  lyrics: string | null
}

const MAX_PAGES = 10
const MAX_LYRICS = 20_000

// A chord ("G", "D/F#", "Cmaj7", "Asus4") or Nashville number ("1", "6m", "4/6", "2m7"), or bar/repeat marks.
const CHORD =
  /^\(?(?:[A-G](?:#|b|♯|♭)?(?:maj|min|m|M|sus|dim|aug|add|°|ø|\+|-)?\d{0,2}(?:sus\d?|add\d{1,2}|maj\d?|no\d|[#b]\d{1,2})*(?:\/[A-G](?:#|b|♯|♭)?)?|[1-7](?:#|b|♯|♭)?(?:maj|m|-|sus|dim|aug|add|°|\+)?\d{0,2}(?:sus\d?|add\d{1,2})*(?:\/[1-7](?:#|b|♯|♭)?)?)\)?$/
const MARK = /^(?:[|:/\\.\-–—x×()[\]%]+|x\d+|\d+x|N\.?C\.?)$/i

function isChordLine(line: string) {
  // Dashes and bar marks don't count either way ("A - men" is a lyric, "| G | D |" is chords).
  const tokens = line.split(/\s+/).filter((t) => t && !MARK.test(t))
  if (!tokens.length) return true
  return tokens.filter((t) => CHORD.test(t)).length / tokens.length >= 0.6
}

/** Reads a chart PDF: page count, key/tempo/time when printed, and its words for lyrics search. */
export async function readChartBytes(data: Uint8Array): Promise<ChartDetails> {
  const task = pdfjs.getDocument({
    data,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  try {
    const doc = await task.promise
    const lines: string[] = []
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const content = await (await doc.getPage(n)).getTextContent()
      // Rebuild lines from the text pieces' positions (top to bottom, left to right).
      const rows: { y: number; parts: { x: number; s: string }[] }[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const x = item.transform[4]
        const y = item.transform[5]
        const row = rows.find((r) => Math.abs(r.y - y) < 2.5)
        if (row) row.parts.push({ x, s: item.str })
        else rows.push({ y, parts: [{ x, s: item.str }] })
      }
      rows.sort((a, b) => b.y - a.y)
      for (const r of rows) {
        lines.push(
          r.parts
            .sort((a, b) => a.x - b.x)
            .map((p) => p.s)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        )
      }
    }
    const all = lines.join('\n')
    const key = all.match(/\bKey\s*(?:of\s+|[-–—:|]\s*)([A-G](?:#|b|♯|♭)?m?)(?![a-z#♯♭])/)?.[1] ?? null
    const tempo = all.match(/\b(?:Tempo|BPM)\s*[-–—:|]?\s*(\d{2,3})\b/i)?.[1]
    const timeSig = all.match(/\bTime(?:\s*Sig(?:nature)?)?\s*[-–—:|]\s*(\d{1,2}\s*\/\s*\d{1,2})/i)?.[1]
    const words = lines.filter((l) => l && !isChordLine(l)).join('\n').slice(0, MAX_LYRICS)
    return {
      pages: doc.numPages,
      key: key?.replace('♯', '#').replace('♭', 'b') ?? null,
      tempo: tempo && Number(tempo) >= 30 && Number(tempo) <= 300 ? Number(tempo) : null,
      timeSig: timeSig?.replace(/\s+/g, '') ?? null,
      lyrics: words.trim() ? words : null,
    }
  } finally {
    void task.destroy()
  }
}

export async function readChartDetails(file: File): Promise<ChartDetails> {
  return readChartBytes(new Uint8Array(await file.arrayBuffer()))
}
