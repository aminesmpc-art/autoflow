import { NextResponse } from 'next/server';

const locales = ['en', 'ar', 'fr', 'es'];
const defaultLocale = 'en';

// Paths that should NOT be locale-prefixed
const publicPaths = [
  '/_next',
  '/api',
  '/favicon.ico',
  '/og-image.png',
  '/screenshots',
  '/icons',
  '/robots.txt',
  '/sitemap.xml',
  '/prompts',
  '/extractor',
  '/dashboard',
  '/login',
  '/register'
];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Skip public paths
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check if the pathname already has a locale
  const pathnameHasLocale = locales.some(
    locale => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );

  if (pathnameHasLocale) {
    return NextResponse.next();
  }

  // Detect language from Accept-Language header
  const acceptLang = request.headers.get('accept-language') || '';
  let detectedLocale = defaultLocale;

  for (const locale of locales) {
    if (acceptLang.toLowerCase().includes(locale)) {
      detectedLocale = locale;
      break;
    }
  }

  // For the root path, don't redirect English users (keep / as English for SEO)
  if (detectedLocale === defaultLocale) {
    // Rewrite to /en internally but keep URL clean
    const url = request.nextUrl.clone();
    url.pathname = `/en${pathname}`;
    return NextResponse.rewrite(url);
  }

  // For non-English, redirect to locale path
  const url = request.nextUrl.clone();
  url.pathname = `/${detectedLocale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Match all paths except Next.js internals and static files
    '/((?!_next|api|favicon.ico|og-image|screenshots|icons|robots|sitemap).*)',
  ],
};
