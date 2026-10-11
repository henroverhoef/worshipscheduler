// Receives PDFs shared to the installed app from the phone's Share menu (Web Share Target).
// The files are parked in a cache and the library page picks them up from there.
const SHARE_CACHE = 'share-target'

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData()
        const files = form.getAll('charts').filter((f) => typeof f !== 'string')
        await caches.delete(SHARE_CACHE)
        const cache = await caches.open(SHARE_CACHE)
        await Promise.all(
          files.map((file, i) =>
            cache.put(
              `/shared-chart/${i}`,
              new Response(file, {
                headers: {
                  'Content-Type': file.type || 'application/pdf',
                  'X-File-Name': encodeURIComponent(file.name || `chart-${i + 1}.pdf`),
                },
              }),
            ),
          ),
        )
        return Response.redirect(`/library?shared=${files.length}`, 303)
      } catch {
        return Response.redirect('/library?shared=failed', 303)
      }
    })(),
  )
})
