import Link from "next/link";
import { getPostBySlug, getRelatedPosts, SITE_URL } from "../content";

const post = getPostBySlug("best-prompts-ai-video-generation");

export const metadata = {
  title: post.title,
  description: post.description,
  alternates: { canonical: `${SITE_URL}/blog/${post.slug}` },
  openGraph: {
    title: post.title,
    description: post.description,
    type: "article",
    publishedTime: post.date,
    modifiedTime: post.updated,
    tags: post.tags,
    images: [{ url: `${SITE_URL}${post.image}`, width: 1200, height: 630 }],
  },
};

export default function BlogPost() {
  const related = getRelatedPosts(post.slug);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: post.description,
            author: { "@type": "Organization", name: "AutoFlow" },
            publisher: {
              "@type": "Organization",
              name: "AutoFlow",
              logo: { "@type": "ImageObject", url: `${SITE_URL}/og-image.png` },
            },
            datePublished: post.date,
            dateModified: post.updated,
            mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
            image: `${SITE_URL}${post.image}`,
            keywords: post.tags.join(", "),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
              { "@type": "ListItem", position: 3, name: post.title, item: `${SITE_URL}/blog/${post.slug}` },
            ],
          }),
        }}
      />

      <article className="blog-article">
        <div className="container">
          <div className="blog-article-header">
            <Link href="/blog" className="blog-back">← Back to Blog</Link>
            <div className="blog-card-category">{post.category}</div>
            <h1>{post.title}</h1>
            <div className="blog-card-meta">
              <span>{new Date(post.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
              <span>·</span>
              <span>{post.readTime}</span>
            </div>
          </div>

          <nav className="blog-toc">
            <h4>📖 In This Article</h4>
            <ol>
              <li><a href="#cinematic">Cinematic & Film</a></li>
              <li><a href="#nature">Nature & Landscape</a></li>
              <li><a href="#product">Product & Commercial</a></li>
              <li><a href="#scifi">Sci-Fi & Fantasy</a></li>
              <li><a href="#tips">Prompt Writing Tips</a></li>
            </ol>
          </nav>

          <div className="blog-article-content">
            <p>
              The secret to stunning AI videos isn&apos;t just using the right tool — it&apos;s
              using the right <strong>prompts</strong>. A vague prompt gives you a vague video.
              A specific, well-crafted prompt gives you cinema-quality results.
            </p>
            <p>
              Here are 25 battle-tested prompts organized by category. Copy, paste into{" "}
              <Link href="/">AutoFlow</Link>, and generate. Each prompt is optimized for{" "}
              <strong>Google Flow&apos;s Veo 3</strong> model.
            </p>

            <h2 id="cinematic">🎬 Cinematic & Film (5 Prompts)</h2>

            <pre className="blog-code">
{`1. A slow-motion tracking shot of a woman in a red
dress walking through Tokyo streets at night, neon
reflections on wet pavement, anamorphic lens flares,
cinematic 4K

2. An epic wide shot of a lone horseman riding across
a vast desert at golden hour, dust particles catching
the sunlight, dramatic orchestral music feeling, 4K

3. A one-take following shot through a busy restaurant
kitchen, chefs plating dishes, steam rising, shallow
depth of field transitioning between subjects

4. A bird's-eye view slowly descending into a massive
canyon with a river flowing through it, morning fog,
ray-traced sunlight beams, drone cinematography style

5. Close-up of an old man's weathered hands playing a
piano in a dimly lit room, dust particles in a shaft
of warm light, emotional, shallow depth of field`}
            </pre>

            <h2 id="nature">🌿 Nature & Landscape (5 Prompts)</h2>

            <pre className="blog-code">
{`6. A time-lapse of storm clouds forming over a wheat
field, lightning strikes in the distance, dramatic
sky, hyper-realistic, 4K HDR

7. Underwater shot following a sea turtle gliding
through a coral reef, sunlight filtering through the
surface, bioluminescent particles, National Geographic
quality

8. Macro close-up of a butterfly emerging from its
chrysalis, time-lapse speed, morning dew drops, bokeh
background of wildflowers

9. Aerial flyover of autumn forest canopy, leaves in
vibrant orange and red, camera slowly tilting to
reveal a crystal-clear lake below, golden hour

10. Northern lights dancing over a frozen lake in
Iceland, perfect reflection in the still water, a
small cabin with warm glowing windows in the distance`}
            </pre>

            <h2 id="product">💫 Product & Commercial (5 Prompts)</h2>

            <pre className="blog-code">
{`11. A luxury perfume bottle rotating on a marble
surface, golden liquid catching light, smoky
atmosphere, premium product photography style, studio
lighting

12. Coffee being poured in extreme slow motion into a
ceramic cup, cream swirling in beautiful patterns,
steam rising, warm morning light, food commercial
quality

13. Sleek smartphone floating and rotating in space
with holographic UI elements appearing around it,
dark background with subtle blue glow, tech product
reveal

14. A pair of premium sneakers splashing through a
puddle on a city street, freeze-frame moment with
water droplets suspended, dramatic side lighting

15. Fresh sushi being placed on a wooden board by
chef's hands, extreme close-up showing rice texture,
fish glistening, wasabi being shaped, food
photography masterclass`}
            </pre>

            <h2 id="scifi">🚀 Sci-Fi & Fantasy (10 Prompts)</h2>

            <pre className="blog-code">
{`16. A massive spaceship emerging slowly from
hyperspace above a ringed planet, lens flare from the
nearby star, cinematic scale, sci-fi epic

17. A medieval knight removing their helmet to reveal
glowing magical runes on their face, firelight
flickering, rain falling, fantasy epic scene

18. A cyberpunk street market at night, holographic
signs in Japanese and English, flying vehicles in the
background, puddles reflecting neon, Blade Runner
atmosphere

19. A wizard casting a spell, particles of light
spiraling from their hands into the sky, ancient
stone circle, aurora borealis backdrop, magic realism

20. Futuristic city transportation pod zooming through
transparent tubes between skyscrapers, passengers
visible inside, sunset cityscape, concept art quality

21. A robot learning to paint, sitting at an easel in
a sunlit studio, oil paints on its metal fingers,
creating a beautiful landscape, emotional and
contemplative

22. Dragon soaring through mountain peaks at dawn,
scales catching golden sunlight, clouds parting
around its wingspan, aerial tracking shot, 4K fantasy

23. Astronaut floating in a space station window,
Earth visible below, sun rising over the planet's
edge, lens flare, peaceful and awe-inspiring

24. Ancient temple ruins being reclaimed by a
bioluminescent forest, glowing mushrooms and vines
covering stone pillars, mystical atmosphere, night

25. Time traveler stepping through a portal, one side
showing a futuristic city, the other showing medieval
marketplace, light distortion at the threshold`}
            </pre>

            <h2 id="tips">💡 Prompt Writing Tips</h2>
            <p>
              Want to write your own effective prompts? Follow these rules:
            </p>
            <ul>
              <li><strong>Be specific about camera movement</strong> — &quot;tracking shot,&quot; &quot;drone flyover,&quot; &quot;close-up,&quot; &quot;bird&apos;s-eye view&quot;</li>
              <li><strong>Include lighting</strong> — &quot;golden hour,&quot; &quot;neon lighting,&quot; &quot;backlit,&quot; &quot;dramatic shadows&quot;</li>
              <li><strong>Mention quality</strong> — &quot;4K,&quot; &quot;cinematic,&quot; &quot;HDR,&quot; &quot;hyper-realistic&quot;</li>
              <li><strong>Add atmosphere</strong> — &quot;fog,&quot; &quot;rain,&quot; &quot;dust particles,&quot; &quot;steam&quot;</li>
              <li><strong>Reference styles</strong> — &quot;National Geographic,&quot; &quot;Blade Runner,&quot; &quot;food commercial quality&quot;</li>
              <li><strong>Use sensory details</strong> — textures, reflections, sounds implied by the scene</li>
            </ul>

            <p>
              Want to run all 25 prompts at once?{" "}
              <Link href="/blog/how-to-batch-generate-ai-videos-google-flow">
                Learn how to batch process with AutoFlow →
              </Link>
            </p>
            <p>
              Having issues with failed generations?{" "}
              <Link href="/blog/google-flow-tips-avoid-failed-generations">
                Read our troubleshooting tips →
              </Link>
            </p>

            <p>
              <a href="https://chromewebstore.google.com" target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                Install AutoFlow — Free
              </a>
            </p>

            {related.length > 0 && (
              <div className="blog-related">
                <h3>📚 Related Articles</h3>
                <div className="blog-related-grid">
                  {related.map((r) => (
                    <Link key={r.slug} href={`/blog/${r.slug}`} className="blog-related-card">
                      <span className="blog-card-category">{r.category}</span>
                      <strong>{r.title}</strong>
                      <span className="blog-card-meta"><span>{r.readTime}</span></span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </article>
    </>
  );
}
