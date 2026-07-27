// Gates the entire site (including data.json) behind a single password — no username.
// Runs at the edge before any static asset is served, so there's no client-side bypass.
//
// The password itself never touches the browser after login: the cookie stores a SHA-256
// hash of it, not the password, so inspecting cookies doesn't reveal the password.

const COOKIE_NAME = 'wa_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const config = {
  matcher: '/((?!favicon.ico).*)',
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loginPage(error) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WA Labor - Digital Performance</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#F6F3EC; font:15px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#1C1A1E; }
  form { background:#fff; border:1px solid #E3DED2; border-radius:12px; padding:32px; width:280px; }
  h1 { font-size:16px; margin:0 0 4px; }
  p.sub { font-size:12.5px; color:#726b62; margin:0 0 18px; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #E3DED2;
    border-radius:8px; font-size:14px; margin-bottom:12px; }
  button { width:100%; padding:10px 12px; border:none; border-radius:8px; background:#C41E1A;
    color:#fff; font-weight:700; font-size:14px; cursor:pointer; }
  .err { color:#C41E1A; font-size:12.5px; margin:-6px 0 12px; }
  .hint { text-align:center; font-size:11.5px; color:#726b62; font-style:italic; margin:14px 0 0; }
</style></head><body>
<form method="POST">
  <h1>WA Labor - Digital Performance</h1>
  <p class="sub">Enter the password to continue.</p>
  ${error ? '<p class="err">Wrong password.</p>' : ''}
  <input type="password" name="password" autofocus />
  <button type="submit">Enter</button>
  <p class="hint">*Contact your WA Labor organiser for the password*</p>
</form>
</body></html>`;
}

export default async function middleware(request) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return; // no password configured — fail open rather than lock everyone out
  const expectedHash = await sha256(expected);

  if (request.method === 'POST') {
    const form = await request.formData();
    const submittedHash = await sha256(String(form.get('password') || ''));
    if (submittedHash === expectedHash) {
      const res = new Response(null, { status: 303, headers: { Location: '/' } });
      res.headers.append('Set-Cookie', `${COOKIE_NAME}=${expectedHash}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
      return res;
    }
    return new Response(loginPage(true), { status: 401, headers: { 'Content-Type': 'text/html' } });
  }

  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([a-f0-9]+)`));
  if (match?.[1] === expectedHash) return;

  return new Response(loginPage(false), { status: 401, headers: { 'Content-Type': 'text/html' } });
}
