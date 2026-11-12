export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; background: #f6f7f5; color: #1d2a24; }
  header { background: #1f4d3a; color: #fff; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
  header a, header button { color: #fff; }
  main { max-width: 720px; margin: 0 auto; padding: 16px; }
  section { background: #fff; border: 1px solid #dfe3df; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #eef0ee; }
  label { display: block; margin: 8px 0 4px; }
  input, select { padding: 6px; width: 100%; max-width: 360px; box-sizing: border-box; }
  button { padding: 8px 14px; margin-top: 12px; }
  .error { color: #a3261b; }
  .notice { color: #1f4d3a; }
  .demo { font-size: 12px; color: #5d6b63; }
`;

export function page(title: string, body: string, signedInAs?: string): string {
  const who = signedInAs
    ? `<span>${escapeHtml(signedInAs)} · <form method="post" action="/sign-out" style="display:inline"><button>Sign out</button></form></span>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Cedar Pay</title><style>${STYLE}</style></head>
<body><header><strong><a href="/home" style="text-decoration:none">Cedar Pay</a></strong>${who}</header>
<main><h1>${escapeHtml(title)}</h1>${body}
<p class="demo">Cedar Bank is fictional. Every customer, account and figure here is invented for a demonstration.</p></main></body></html>`;
}
