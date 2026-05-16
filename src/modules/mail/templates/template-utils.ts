export type Locale = 'en' | 'ar';

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const e = escapeHtml;

const isRtl = (locale: Locale): boolean => locale === 'ar';

export function layout({
  locale,
  preheader,
  bodyHtml,
}: {
  locale: Locale;
  preheader: string;
  bodyHtml: string;
}): string {
  const dir = isRtl(locale) ? 'rtl' : 'ltr';
  const lang = locale;
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${e(preheader)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
    <div style="display:none;font-size:1px;color:#f6f8fb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${e(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(15,23,42,.06);">
            <tr><td style="font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function button(href: string, label: string, locale: Locale): string {
  const dir = isRtl(locale) ? 'rtl' : 'ltr';
  return `<p style="margin:24px 0;text-align:center;">
    <a href="${e(href)}" dir="${dir}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">${e(label)}</a>
  </p>`;
}
