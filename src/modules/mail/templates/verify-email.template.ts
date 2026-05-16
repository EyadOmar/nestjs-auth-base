import { button, e, layout, Locale, RenderedTemplate } from './template-utils';

export interface VerifyEmailArgs {
  firstName?: string | null;
  verifyUrl: string;
}

const COPY = {
  en: {
    subject: 'Verify your email',
    preheader: 'Confirm your email to activate your account.',
    greeting: (name?: string | null) => `Hi${name ? ` ${name}` : ''},`,
    body: 'Welcome! Click the button below to verify your email and activate your account. This link expires in 24 hours.',
    cta: 'Verify email',
    fallback: 'Or copy and paste this URL into your browser:',
    ignore: "If you didn't sign up, you can safely ignore this email.",
  },
  ar: {
    subject: 'تأكيد بريدك الإلكتروني',
    preheader: 'قم بتأكيد بريدك لتفعيل حسابك.',
    greeting: (name?: string | null) => `مرحبًا${name ? ` ${name}` : ''}،`,
    body: 'مرحبًا بك! اضغط على الزر أدناه لتأكيد بريدك الإلكتروني وتفعيل حسابك. هذا الرابط صالح لمدة 24 ساعة.',
    cta: 'تأكيد البريد',
    fallback: 'أو انسخ هذا الرابط والصقه في متصفحك:',
    ignore: 'إذا لم تقم بإنشاء حساب، يمكنك تجاهل هذه الرسالة.',
  },
} as const;

export function renderVerifyEmail(
  args: VerifyEmailArgs,
  locale: Locale = 'en',
): RenderedTemplate {
  const c = COPY[locale] ?? COPY.en;
  const bodyHtml = `
    <p>${e(c.greeting(args.firstName))}</p>
    <p>${e(c.body)}</p>
    ${button(args.verifyUrl, c.cta, locale)}
    <p style="color:#64748b;font-size:13px;">${e(c.fallback)}<br><span style="word-break:break-all;">${e(args.verifyUrl)}</span></p>
    <p style="color:#64748b;font-size:13px;">${e(c.ignore)}</p>
  `;
  const text = [
    c.greeting(args.firstName),
    '',
    c.body,
    '',
    args.verifyUrl,
    '',
    c.ignore,
  ].join('\n');
  return {
    subject: c.subject,
    html: layout({ locale, preheader: c.preheader, bodyHtml }),
    text,
  };
}
