'use client';

export default function StoreLink({ className, children, href, onClick }) {
  const handleClick = (e) => {
    // Check if gtag is available on the window object
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'click_extension_store', {
        event_category: 'outbound',
        event_label: 'Chrome Web Store',
        value: 1,
      });
    }
    if (onClick) {
      onClick(e);
    }
  };

  const linkHref = href || "https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc";

  return (
    <a
      href={linkHref}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
