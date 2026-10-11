// PDFs shared to the app from the phone's Share menu are parked in this cache by
// public/share-target-sw.js until the library page takes them.
const SHARE_CACHE = 'share-target'

export async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return []
  const cache = await caches.open(SHARE_CACHE)
  const keys = await cache.keys()
  const indexOf = (r: Request) => Number(new URL(r.url).pathname.split('/').pop())
  const files = await Promise.all(
    [...keys]
      .sort((a, b) => indexOf(a) - indexOf(b))
      .map(async (req) => {
        const res = await cache.match(req)
        if (!res) return null
        const blob = await res.blob()
        const name = decodeURIComponent(res.headers.get('X-File-Name') ?? 'chart.pdf')
        return new File([blob], name, { type: blob.type || 'application/pdf' })
      }),
  )
  await caches.delete(SHARE_CACHE)
  return files.filter((f): f is File => !!f)
}
