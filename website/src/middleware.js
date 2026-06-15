import { NextResponse } from 'next/server';

const locales = ['en', 'ar', 'fr', 'es', 'de'];
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
  '/llms.txt',
  '/llms-full.txt'
];

// Paths that are English-only and exist outside of [locale]
const unlocalizedPaths = [
  '/blog',
  '/faq',
  '/pricing',
  '/privacy',
  '/terms',
  '/changelog'
];

export function middleware(request) {
  const { pathname } = request.nextUrl;
  console.log("--> middleware called for pathname:", pathname);

  // Skip public paths
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // If the pathname explicitly starts with the default locale (e.g. /en/something)
  // we should REDIRECT them to the clean URL without /en/ to prevent 404s
  if (pathname.startsWith(`/${defaultLocale}/`) || pathname === `/${defaultLocale}`) {
    const cleanPath = pathname.replace(new RegExp(`^/${defaultLocale}`), '') || '/';
    console.log("--> redirecting from", pathname, "to", cleanPath);
    const url = request.nextUrl.clone();
    url.pathname = cleanPath;
    return NextResponse.redirect(url);
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

  // For English users, serve unlocalized paths and root directly. Otherwise, rewrite to /en.
  if (detectedLocale === defaultLocale) {
    if (pathname === '/' || unlocalizedPaths.some(p => pathname.startsWith(p))) {
      console.log("--> serving unlocalized or root directly:", pathname);
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = `/en${pathname}`;
    console.log("--> rewriting to", url.pathname);
    return NextResponse.rewrite(url);
  }

  // For non-English, rewrite (NOT redirect) to locale path
  // This avoids confusing Googlebot which crawls with varying Accept-Language headers
  const url = request.nextUrl.clone();
  url.pathname = `/${detectedLocale}${pathname}`;
  console.log("--> non-English rewriting to", url.pathname);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    // Match all paths except Next.js internals and static files
    '/((?!_next|api|favicon.ico|og-image|screenshots|icons|robots|sitemap).*)',
  ],
};
