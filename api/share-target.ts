// Only reached if the app's offline worker isn't running yet (e.g. right after installing):
// send the person to the library with a hint instead of an error page.
export function POST() {
  return new Response(null, { status: 303, headers: { Location: '/library?shared=failed' } })
}
export const GET = POST
