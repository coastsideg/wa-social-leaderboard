// Gates the entire site (including data.json) behind HTTP Basic Auth. Runs at the
// edge before any static asset is served, so there's no client-side bypass — this is
// not a JS check that could be skipped by fetching data.json directly.
//
// Password lives only in the SITE_PASSWORD Vercel environment variable, never in source.

export const config = {
  matcher: '/((?!favicon.ico).*)',
};

export default function middleware(request) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return; // no password configured — fail open rather than lock everyone out

  const auth = request.headers.get('authorization');
  if (auth) {
    const [, encoded] = auth.split(' ');
    const [, password] = atob(encoded).split(':');
    if (password === expected) return;
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="WA Labor Digital Performance"' },
  });
}
