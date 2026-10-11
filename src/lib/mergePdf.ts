import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { loadPdf } from './pdf'
import { chartUrl } from './supabase'
import { LINE_HEIGHT, markKey, strokePath, textLines, type Mark, type MarksByPage } from './marks'
import type { SetSong } from './types'

export interface MergeResult {
  blob: Blob
  /** Songs that couldn't be included (no chart uploaded, or the file wouldn't load). */
  skipped: string[]
}

/** Combines every chart in the set, in set order, into one PDF. */
export async function mergeCharts(
  title: string,
  songs: SetSong[],
  onProgress?: (done: number, total: number) => void,
  marks: MarksByPage = {},
): Promise<MergeResult> {
  const out = await PDFDocument.create()
  out.setTitle(title)
  const font = await out.embedFont(StandardFonts.HelveticaBold)
  const skipped: string[] = []
  for (const [i, song] of songs.entries()) {
    if (!song.pdf_path) {
      skipped.push(song.title)
    } else {
      const url = chartUrl(song.pdf_path)
      const firstPage = out.getPageCount()
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const src = await PDFDocument.load(await res.arrayBuffer(), { ignoreEncryption: true })
        // Encrypted pages can't be copied as-is; draw them as images instead.
        if (src.isEncrypted) throw new Error('encrypted')
        for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page)
      } catch {
        try {
          // Drop any pages a half-finished copy left behind before retrying as images.
          while (out.getPageCount() > firstPage) out.removePage(out.getPageCount() - 1)
          await addAsImages(out, url)
        } catch {
          skipped.push(song.title)
        }
      }
      // The set's markings go on top of each page of this song.
      for (let i = firstPage; i < out.getPageCount(); i++) {
        const items = marks[markKey(song.id, i - firstPage + 1)]
        if (items?.length) drawMarks(out.getPage(i), items, font)
      }
    }
    onProgress?.(i + 1, songs.length)
  }
  if (out.getPageCount() === 0) throw new Error('None of the charts could be loaded.')
  const bytes = await out.save()
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), skipped }
}

function hexColor(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

// The PDF's built-in font only covers Western characters; anything else would break the export.
const pdfSafe = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, '?')

function drawMarks(page: PDFPage, items: Mark[], font: PDFFont) {
  const { width: W, height: H } = page.getSize()
  for (const m of items) {
    if (m.t === 'text') {
      const size = m.s * W
      textLines(m).forEach((line, i) => {
        if (!line.trim()) return
        page.drawText(pdfSafe(line), {
          x: m.x * W,
          y: H - m.y * H - size * 0.85 - i * size * LINE_HEIGHT,
          size,
          font,
          color: hexColor(m.c),
        })
      })
    } else {
      page.drawSvgPath(strokePath(m.p, W, H), {
        x: 0,
        y: H,
        borderColor: hexColor(m.c),
        borderWidth: m.w * W,
        borderOpacity: m.t === 'hl' ? 0.4 : 1,
        borderLineCap: LineCapStyle.Round,
        blendMode: m.t === 'hl' ? BlendMode.Multiply : BlendMode.Normal,
      })
    }
  }
}

async function addAsImages(out: PDFDocument, url: string) {
  const doc = await loadPdf(url)
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const size = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 2.5 }) // ~180 dpi: sharp enough to print
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport }).promise
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('render failed'))), 'image/png'),
    )
    const image = await out.embedPng(await png.arrayBuffer())
    out.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height })
  }
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function pdfFileName(name: string, date: string | null) {
  const base = [name, date].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Charts'
  return `${base}.pdf`
}
