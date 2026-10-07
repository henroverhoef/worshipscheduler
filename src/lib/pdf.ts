// The legacy build polyfills newer JS (e.g. Map.getOrInsertComputed) so charts open on older phones too.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDoc = pdfjs.PDFDocumentProxy
export type PdfPage = pdfjs.PDFPageProxy

const cache = new Map<string, Promise<PdfDoc>>()

export function loadPdf(url: string): Promise<PdfDoc> {
  let doc = cache.get(url)
  if (!doc) {
    doc = pdfjs.getDocument({
      url,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    }).promise
    doc.catch(() => cache.delete(url))
    cache.set(url, doc)
  }
  return doc
}
