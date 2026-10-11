import { PDFDocument } from 'pdf-lib'
import { loadPdf } from './pdf'
import { chartUrl } from './supabase'
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
): Promise<MergeResult> {
  const out = await PDFDocument.create()
  out.setTitle(title)
  const skipped: string[] = []
  for (const [i, song] of songs.entries()) {
    if (!song.pdf_path) {
      skipped.push(song.title)
    } else {
      const url = chartUrl(song.pdf_path)
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const src = await PDFDocument.load(await res.arrayBuffer(), { ignoreEncryption: true })
        // Encrypted pages can't be copied as-is; draw them as images instead.
        if (src.isEncrypted) throw new Error('encrypted')
        for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page)
      } catch {
        try {
          await addAsImages(out, url)
        } catch {
          skipped.push(song.title)
        }
      }
    }
    onProgress?.(i + 1, songs.length)
  }
  if (out.getPageCount() === 0) throw new Error('None of the charts could be loaded.')
  const bytes = await out.save()
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), skipped }
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
