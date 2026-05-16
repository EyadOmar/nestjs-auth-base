import { button, e, layout, Locale, RenderedTemplate } from './template-utils';

export interface MagicLinkArgs {
  firstName?: string | null;
  magicUrl: string;
}

const COPY = {
  en: {
    subject: 'Your sign-in link',
    preheader: 'Tap to sign in. This link expires in 15 minutes.',
    greeting: (name?: string | null) => `Hi${name ? ` ${name}` : ''},`,
    body: 'Tap the button below to sign in. The link expires in 15 minutes and can only be used once.',
    cta: 'Sign in',
    fallback: 'Or copy and paste this URL into your browser:',
    ignore: "If you didn't request this, you can safely ignore this email.",
  },
  ar: {
    subject: 'رابط تسجيل الدخول',
    preheader: 'اضغط لتسجيل الدخول. الرابط صالح لمدة 15 دقيقة.',
    greeting: (name?: string | null) => `مرحبًا${name ? ` ${name}` : ''}،`,
    body: 'اضغط على الزر أدناه لتسجيل الدخول. الرابط صالح لمدة 15 دقيقة ويمكن استخدامه مرة واحدة فقط.',
    cta: 'تسجيل الدخول',
    fallback: 'أو انسخ هذا الرابط والصقه في متصفحك:',
    ignore: 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.',
  },
} as const;

export function renderMagicLink(
  args: MagicLinkArgs,
  locale: Locale = 'en',
): RenderedTemplate {
  const c = COPY[locale] ?? COPY.en;
  const bodyHtml = `
    <p>${e(c.greeting(args.firstName))}</p>
    <p>${e(c.body)}</p>
    ${button(args.magicUrl, c.cta, locale)}
    <p style="color:#64748b;font-size:13px;">${e(c.fallback)}<br><span style="word-break:break-all;">${e(args.magicUrl)}</span></p>
    <p style="color:#64748b;font-size:13px;">${e(c.ignore)}</p>
  `;
  const text = [
    c.greeting(args.firstName),
    '',
    c.body,
    '',
    args.magicUrl,
    '',
    c.ignore,
  ].join('\n');
  return {
    subject: c.subject,
    html: layout({ locale, preheader: c.preheader, bodyHtml }),
    text,
  };
}
