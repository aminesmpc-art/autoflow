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
  '/sitemap.xml'
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

  // For English users, serve paths from the root directly (e.g. /blog)
  if (detectedLocale === defaultLocale) {
    return NextResponse.next();
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
