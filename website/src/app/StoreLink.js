'use client';

const STORE_URLS = {
  queue: "https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc",
  studio: "https://chromewebstore.google.com/detail/autoflow-studio/knodokbipcajhdpafplmlljbaamgfkao",
};

export default function StoreLink({ className, children, href, product = 'queue', onClick, style, id }) {
  const handleClick = (e) => {
    // Check if gtag is available on the window object
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'click_extension_store', {
        event_category: 'outbound',
        event_label: product === 'studio' ? 'Chrome Web Store - Studio' : 'Chrome Web Store - Queue',
        value: 1,
      });
    }
    if (onClick) {
      onClick(e);
    }
  };

  const linkHref = href || STORE_URLS[product] || STORE_URLS.queue;

  return (
    <a
      href={linkHref}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className}
      onClick={handleClick}
      style={style}
      id={id}
    >
      {children}
    </a>
  );
}
