/* ============================================================
   AutoFlow Website — i18n Translations
   Supports: English, Arabic, French, Spanish, German, Italian
   ============================================================ */

export const locales = ['en', 'ar', 'fr', 'es', 'de', 'it'];
export const defaultLocale = 'en';

const dictionaries = {
  en: {
    meta: {
      title: 'AutoFlow — Automate Google Flow AI Video Generation',
      description: 'AutoFlow Chrome extension automates Google Flow video generation. Batch process hundreds of prompts, smart queue management, auto-retry failures, bulk download in 4K.',
    },
    nav: {
      features: 'Features',
      howItWorks: 'How It Works',
      pricing: 'Pricing',
      faq: 'FAQ',
      prompts: 'Prompts',
      install: 'Install Free',
    },
    hero: {
      badge: 'Chrome Extension for Google Flow',
      titleLine1: 'AI Video Generation',
      titleLine2: 'on Autopilot',
      subtitle: "Paste your prompts, hit run, and walk away. AutoFlow handles the clicking, waiting, retrying, and downloading — so you can focus on creating.",
      installBtn: "Install Free — It's Fast",
      featuresBtn: 'See Features →',
    },
    features: {
      badge: 'Features',
      title: 'Everything You Need to',
      titleGradient: 'Generate at Scale',
      subtitle: 'AutoFlow supercharges Google Flow with powerful automation — from prompt to download.',
      items: [
        {
          tag: 'Create',
          title: 'Batch Prompt Processing',
          desc: 'Stop copy-pasting prompts one by one. Paste your entire script — 5, 50, or 500 prompts — into the editor. AutoFlow instantly parses each block into a separate task, ready to queue. Supports text-to-video, image-to-video, frame-to-video, and ingredients mode.',
          bullets: [
            'Paste all prompts at once — separated by blank lines',
            'Auto-detects scene numbers and formats',
            'Supports every Google Flow creation mode',
          ],
        },
        {
          tag: 'Images',
          title: 'Reference Image Mapping',
          desc: 'Attach reference images to your prompts for image-to-video generation. Use shared images (applied to every prompt), per-prompt images, or automatic character matching — upload a character sheet and AutoFlow maps the right face to each scene.',
          bullets: [
            'Shared references attached to every prompt',
            'Character image auto-matching by name',
            'Per-prompt image selection (up to 10 each)',
          ],
        },
        {
          tag: 'Queues',
          title: 'Smart Queue Management',
          desc: 'Every setting is visible at a glance — model, orientation, generations, timing, download quality, and more. Create multiple queues with different configs, reorder them, and run them sequentially.',
          bullets: [
            'Full settings grid — model, timing, downloads, behavior',
            'Run target: new project or current project',
            'Progress tracking with prompts/done/failed/pending',
          ],
        },
        {
          tag: 'Automation',
          title: 'Live Run Monitor',
          desc: 'Watch AutoFlow work in real time. The run monitor shows every action — opening settings, filling prompts, detecting tiles, waiting for generation. Pause, resume, skip a prompt, or force retry whenever you want.',
          bullets: [
            'Real-time log of every automation step',
            'Pause / Resume / Stop / Skip / Retry controls',
            'Auto-retry on failures with configurable behavior',
          ],
        },
        {
          tag: 'Library',
          title: 'Library Scanner & Batch Download',
          desc: 'After generation, scan your Flow project to see all videos and images grouped by prompt. Select favorites, batch download in 720p, 1080p, or 4K, or trigger upscaling — all from the side panel.',
          bullets: [
            'One-click scan of all generated assets',
            'Grouped by prompt with video/image counts',
            'Batch download or upscale selected assets',
          ],
        },
        {
          tag: 'Settings',
          title: 'Fully Configurable',
          desc: 'Choose your video model (Veo 3.1 Fast, Veo 3, etc.), aspect ratio, generation count, wait times, and download preferences. Enable typing mode for natural input pacing, set auto-download to save videos automatically.',
          bullets: [
            'Video model and resolution selection',
            'Auto-download with custom resolution (720p – 4K)',
            'Typing mode for human-like input pacing',
          ],
        },
      ],
    },
    howItWorks: {
      badge: 'How It Works',
      title: 'Three Steps to',
      titleGradient: 'Automated Generation',
      subtitle: 'Get started in under a minute. No complex setup required.',
      steps: [
        {
          num: '01',
          title: 'Paste Your Prompts',
          desc: "Open AutoFlow's side panel on any Google Flow page. Choose your mode (text-to-video, image-to-video, ingredients), then paste all your prompts. Each paragraph becomes a separate task.",
        },
        {
          num: '02',
          title: 'Configure & Run',
          desc: 'Add your prompts to a queue. Choose your video model, orientation, generation count, and download settings. Set your run target and hit Run. AutoFlow takes over from here.',
        },
        {
          num: '03',
          title: 'Sit Back & Collect',
          desc: "AutoFlow types each prompt, clicks generate, waits for results, downloads the videos, and moves to the next prompt automatically. When it's done, scan the library to review and batch download everything.",
        },
      ],
    },
    cta: {
      title: 'Ready to Automate Your Workflow?',
      subtitle: 'Join creators using AutoFlow to generate AI videos 10x faster. Free to start — no account required.',
      btn: 'Install AutoFlow — Free',
    },
    footer: {
      desc: 'Automate AI video generation with Google Flow. Batch process, queue, and download — all on autopilot.',
      product: 'Product',
      support: 'Support',
      contact: 'Contact',
      legal: 'Legal',
      privacy: 'Privacy Policy',
      terms: 'Terms of Service',
      copyright: 'AutoFlow. Not affiliated with Google. Third-party automation tool.',
    },
    pricing: {
      badge: 'Pricing',
      title: 'Simple, Transparent',
      titleGradient: 'Pricing',
      subtitle: 'Start free. Upgrade when you need unlimited power.',
      free: {
        name: 'Free',
        price: '$0',
        period: '/ forever',
        desc: 'Perfect for getting started and light usage.',
        features: ['Text-to-Video generation', 'Up to 10 text prompts/day', 'Up to 3 full-feature prompts/day', 'Auto-download', 'Batch prompt processing'],
        btn: 'Install Free',
      },
      pro: {
        name: 'Pro',
        price: '$9.99',
        period: '/ month',
        desc: 'Unlimited everything. For serious creators.',
        features: ['Everything in Free', 'Unlimited text prompts', 'Unlimited full-feature prompts', 'Priority generation queue', 'Bulk upscale & download', 'Character image library', 'Frame chain mode', 'Priority support'],
        btn: 'Upgrade to Pro',
      },
    },
    faq: {
      badge: 'FAQ',
      title: 'Frequently Asked',
      titleGradient: 'Questions',
      subtitle: 'Everything you need to know about AutoFlow.',
      items: [
        { q: 'What is AutoFlow?', a: 'AutoFlow is a Chrome extension that automates your workflow on Google Flow (labs.google). It lets you batch process video prompts, manage queues, attach images, and auto-download results — turning hours of manual clicking into minutes.' },
        { q: 'Is AutoFlow affiliated with Google?', a: 'No. AutoFlow is an independent third-party tool. It automates your interactions with Google Flow inside your own browser session. We do not access Google\'s servers directly.' },
        { q: 'How do I install AutoFlow?', a: 'Click \'Install Free\' to go to the Chrome Web Store. Click \'Add to Chrome\' and the extension will be ready. Open Google Flow, then click the AutoFlow icon to open the side panel.' },
        { q: 'What\'s the difference between Free and Pro?', a: 'Free gives you daily-limited text and full-feature prompts. Pro removes all limits — unlimited prompts, bulk upscale, character libraries, frame chains, and priority support.' },
        { q: 'What are \'text\' vs \'full-feature\' prompts?', a: 'Text prompts are pure text-to-video. Full-feature prompts include image attachments (reference images, character images, or frame chains). Full-feature prompts have a separate daily limit on the Free plan.' },
        { q: 'Does AutoFlow store my prompts or videos?', a: 'No. All data stays in your browser\'s local storage. AutoFlow never uploads your prompts, images, or generated videos to any external server.' },
        { q: 'What happens if my generation fails?', a: 'AutoFlow automatically retries failed prompts (up to 2 retries). If a prompt still fails, it\'s marked as failed and you can retry it later.' },
        { q: 'How do I cancel my Pro subscription?', a: 'You can cancel anytime from your account settings. Your Pro features will remain active until the end of your billing period.' },
      ],
    },
    blog: {
      badge: 'Blog',
      title: 'Tips &',
      titleGradient: 'Tutorials',
      subtitle: 'Learn how to get the most out of AutoFlow and AI video generation.',
      allPosts: 'All Posts',
      readMore: 'Read more →',
      minRead: 'min read',
      featured: 'Featured',
    },
    privacyPage: {
      title: 'Privacy Policy',
      lastUpdated: 'Last updated: March 2026',
    },
    termsPage: {
      title: 'Terms of Service',
      lastUpdated: 'Last updated: March 2026',
    },
    promptsPage: {
      badge: 'Prompt Library',
      title: 'Best Prompts for',
      titleGradient: 'Google Flow AI',
      subtitle: 'Copy and paste these highly optimized text-to-video prompts. Use AutoFlow to run them all at once.',
      copyBtn: 'Copy Prompt',
      copiedBtn: 'Copied!',
      runBtn: 'Run in AutoFlow',
      categories: {
        cinematic: 'Cinematic & Realistic',
        animation: 'Animation & 3D',
        abstract: 'Abstract & Experimental'
      },
      prompts: [
        {
          category: 'cinematic',
          title: 'Neon Cyberpunk City',
          text: 'A cinematic drone shot flying through a dense, neon-lit futuristic cyberpunk city while it rains. Volumetric fog, 8k resolution, photorealistic, anamorphic lens flare, moody atmosphere.'
        },
        {
          category: 'cinematic',
          title: 'Desert Coffee Pour',
          text: 'Extreme close up macro shot of dark espresso coffee pouring into a ceramic cup resting on golden sand dunes. Slow motion 120fps, highly detailed, dramatic lighting, depth of field.'
        },
        {
          category: 'animation',
          title: 'Pixar-style Cute Robot',
          text: 'A cute, rusty little robot holding a glowing blue flower in a magical forest. Pixar 3D animation style, soft lighting, vibrant colors, expressive eyes, magical glowing dust motes in the air.'
        },
        {
          category: 'animation',
          title: 'Anime Samurai Duel',
          text: '2D anime style animation of a samurai drawing a glowing katana on a snowy mountain peak at midnight. High action, dynamic camera angle, Studio Ghibli style, cherry blossoms blowing in the wind.'
        },
        {
          category: 'abstract',
          title: 'Liquid Gold Flow',
          text: 'Abstract macro fluid dynamics of liquid gold mixing with deep space nebula colors. Swirling, mesmerizing slow motion, highly detailed 8k, particle simulation, luxury aesthetic.'
        }
      ]
    },
  },

  ar: {
    meta: {
      title: 'AutoFlow — أتمتة إنشاء فيديوهات AI عبر Google Flow',
      description: 'إضافة AutoFlow لمتصفح Chrome تُأتمت إنشاء الفيديو بالذكاء الاصطناعي. معالجة مئات النصوص دفعة واحدة، إدارة ذكية للقوائم، إعادة المحاولة تلقائياً، تحميل جماعي بدقة 4K.',
    },
    nav: {
      features: 'المميزات',
      howItWorks: 'كيف يعمل',
      pricing: 'الأسعار',
      faq: 'الأسئلة الشائعة',
      prompts: 'النصوص',
      install: 'تثبيت مجاني',
    },
    hero: {
      badge: 'إضافة Chrome لـ Google Flow',
      titleLine1: 'إنشاء فيديو بالذكاء الاصطناعي',
      titleLine2: 'بشكل تلقائي',
      subtitle: 'الصق نصوصك، اضغط تشغيل، واترك الباقي. AutoFlow يتولى النقر والانتظار وإعادة المحاولة والتحميل — ركّز أنت على الإبداع.',
      installBtn: 'تثبيت مجاني — سريع',
      featuresBtn: '← شاهد المميزات',
    },
    features: {
      badge: 'المميزات',
      title: 'كل ما تحتاجه',
      titleGradient: 'للإنشاء بكميات كبيرة',
      subtitle: 'AutoFlow يعزز Google Flow بأتمتة قوية — من النص إلى التحميل.',
      items: [
        {
          tag: 'إنشاء',
          title: 'معالجة النصوص دفعة واحدة',
          desc: 'توقف عن نسخ ولصق النصوص واحداً تلو الآخر. الصق سيناريوك بالكامل — ٥ أو ٥٠ أو ٥٠٠ نص — في المحرر. AutoFlow يحلل كل فقرة كمهمة منفصلة.',
          bullets: [
            'الصق جميع النصوص دفعة واحدة — مفصولة بأسطر فارغة',
            'كشف تلقائي لأرقام المشاهد',
            'يدعم جميع أوضاع Google Flow',
          ],
        },
        {
          tag: 'الصور',
          title: 'ربط الصور المرجعية',
          desc: 'أرفق صوراً مرجعية لنصوصك لإنشاء فيديو من الصور. استخدم صوراً مشتركة أو صوراً لكل نص أو مطابقة الشخصيات التلقائية.',
          bullets: [
            'صور مشتركة تُرفق مع كل نص',
            'مطابقة تلقائية لصور الشخصيات بالاسم',
            'اختيار صور لكل نص (حتى ١٠)',
          ],
        },
        {
          tag: 'القوائم',
          title: 'إدارة ذكية للقوائم',
          desc: 'كل إعداد مرئي بلمحة — النموذج والاتجاه وعدد الإنشاء والتوقيت وجودة التحميل. أنشئ قوائم متعددة بإعدادات مختلفة.',
          bullets: [
            'شبكة إعدادات كاملة — النموذج والتوقيت والتحميل',
            'هدف التشغيل: مشروع جديد أو المشروع الحالي',
            'تتبع التقدم مع النصوص المكتملة والفاشلة',
          ],
        },
        {
          tag: 'الأتمتة',
          title: 'مراقبة مباشرة',
          desc: 'شاهد AutoFlow يعمل في الوقت الفعلي. يعرض المراقب كل إجراء — فتح الإعدادات وملء النصوص واكتشاف البلاطات والانتظار. إيقاف مؤقت أو استئناف أو تخطي أو إعادة المحاولة.',
          bullets: [
            'سجل مباشر لكل خطوة أتمتة',
            'أزرار إيقاف / استئناف / إيقاف / تخطي / إعادة',
            'إعادة محاولة تلقائية عند الفشل',
          ],
        },
        {
          tag: 'المكتبة',
          title: 'ماسح المكتبة والتحميل الجماعي',
          desc: 'بعد الإنشاء، امسح مشروعك لرؤية جميع الفيديوهات والصور مجمعة حسب النص. حدد المفضلة وحمّل دفعة واحدة بدقة 720p أو 1080p أو 4K.',
          bullets: [
            'مسح بنقرة واحدة لجميع الأصول',
            'مجمعة حسب النص مع عدد الفيديوهات',
            'تحميل جماعي أو تحسين الأصول المحددة',
          ],
        },
        {
          tag: 'الإعدادات',
          title: 'قابل للتخصيص بالكامل',
          desc: 'اختر نموذج الفيديو ونسبة العرض وعدد الإنشاء وأوقات الانتظار وتفضيلات التحميل. فعّل وضع الكتابة للسرعة الطبيعية.',
          bullets: [
            'اختيار نموذج الفيديو والدقة',
            'تحميل تلقائي بدقة مخصصة (720p – 4K)',
            'وضع كتابة يحاكي الإدخال البشري',
          ],
        },
      ],
    },
    howItWorks: {
      badge: 'كيف يعمل',
      title: 'ثلاث خطوات نحو',
      titleGradient: 'إنشاء تلقائي',
      subtitle: 'ابدأ في أقل من دقيقة. لا حاجة لإعداد معقد.',
      steps: [
        {
          num: '٠١',
          title: 'الصق نصوصك',
          desc: 'افتح لوحة AutoFlow الجانبية في أي صفحة Google Flow. اختر الوضع ثم الصق جميع نصوصك. كل فقرة تصبح مهمة منفصلة.',
        },
        {
          num: '٠٢',
          title: 'اضبط وشغّل',
          desc: 'أضف نصوصك إلى قائمة. اختر نموذج الفيديو والاتجاه وعدد الإنشاء وإعدادات التحميل. اضغط تشغيل. AutoFlow يتولى الباقي.',
        },
        {
          num: '٠٣',
          title: 'استرخِ واجمع',
          desc: 'AutoFlow يكتب كل نص ويضغط إنشاء وينتظر النتائج ويحمّل الفيديوهات وينتقل تلقائياً. عند الانتهاء، امسح المكتبة لمراجعة وتحميل كل شيء.',
        },
      ],
    },
    cta: {
      title: 'جاهز لأتمتة عملك؟',
      subtitle: 'انضم للمبدعين الذين يستخدمون AutoFlow لإنشاء فيديوهات AI أسرع ١٠ مرات. مجاني للبدء.',
      btn: 'تثبيت AutoFlow — مجاني',
    },
    footer: {
      desc: 'أتمتة إنشاء فيديو AI مع Google Flow. معالجة دفعات وقوائم وتحميل — كل شيء تلقائياً.',
      product: 'المنتج',
      support: 'الدعم',
      contact: 'اتصل بنا',
      legal: 'قانوني',
      privacy: 'سياسة الخصوصية',
      terms: 'شروط الخدمة',
      copyright: 'AutoFlow. غير تابع لـ Google. أداة أتمتة مستقلة.',
    },
    pricing: {
      badge: 'الأسعار',
      title: 'أسعار بسيطة',
      titleGradient: 'وشفافة',
      subtitle: 'ابدأ مجاناً. قم بالترقية عندما تحتاج قوة غير محدودة.',
      free: {
        name: 'مجاني',
        price: '$0',
        period: '/ للأبد',
        desc: 'مثالي للبدء والاستخدام الخفيف.',
        features: ['إنشاء فيديو من نص', 'حتى 10 نصوص يومياً', 'حتى 3 نصوص كاملة يومياً', 'تحميل تلقائي', 'معالجة النصوص دفعة واحدة'],
        btn: 'تثبيت مجاني',
      },
      pro: {
        name: 'بريميوم',
        price: '$9.99',
        period: '/ شهرياً',
        desc: 'كل شيء بلا حدود. للمحترفين.',
        features: ['كل ميزات المجاني', 'نصوص غير محدودة', 'نصوص كاملة غير محدودة', 'أولوية في الإنشاء', 'تحسين وتحميل جماعي', 'مكتبة صور الشخصيات', 'وضع سلسلة الإطارات', 'دعم ذو أولوية'],
        btn: 'ترقية إلى بريميوم',
      },
    },
    faq: {
      badge: 'الأسئلة الشائعة',
      title: 'الأسئلة',
      titleGradient: 'الشائعة',
      subtitle: 'كل ما تحتاج معرفته عن AutoFlow.',
      items: [
        { q: 'ما هو AutoFlow؟', a: 'AutoFlow هو إضافة لمتصفح Chrome تؤتمت عملك على Google Flow. تتيح لك معالجة نصوص الفيديو دفعة واحدة، وإدارة القوائم، وإرفاق الصور، والتحميل التلقائي — تحول ساعات من النقر اليدوي إلى دقائق.' },
        { q: 'هل AutoFlow تابع لـ Google؟', a: 'لا. AutoFlow أداة مستقلة. يؤتمت تفاعلاتك مع Google Flow داخل جلسة المتصفح الخاصة بك. لا نصل إلى خوادم Google مباشرة.' },
        { q: 'كيف أثبت AutoFlow؟', a: 'انقر على "تثبيت مجاني" للذهاب إلى متجر Chrome. انقر "إضافة إلى Chrome" وستكون الإضافة جاهزة. افتح Google Flow ثم انقر على أيقونة AutoFlow.' },
        { q: 'ما الفرق بين المجاني والبريميوم؟', a: 'المجاني يعطيك نصوص يومية محدودة. البريميوم يزيل جميع الحدود — نصوص غير محدودة، تحسين جماعي، مكتبات الشخصيات، سلاسل الإطارات، ودعم ذو أولوية.' },
        { q: 'ما هي النصوص "النصية" مقابل "الكاملة"؟', a: 'النصوص النصية هي نص-إلى-فيديو فقط. النصوص الكاملة تشمل مرفقات الصور. النصوص الكاملة لها حد يومي منفصل في الخطة المجانية.' },
        { q: 'هل يخزن AutoFlow نصوصي أو فيديوهاتي؟', a: 'لا. جميع البيانات تبقى في التخزين المحلي لمتصفحك. AutoFlow لا يرفع أبداً نصوصك أو صورك أو فيديوهاتك إلى أي خادم خارجي.' },
        { q: 'ماذا يحدث إذا فشل الإنشاء؟', a: 'AutoFlow يعيد المحاولة تلقائياً للنصوص الفاشلة (حتى محاولتين). إذا استمر الفشل، يتم تمييزه كفاشل ويمكنك إعادة المحاولة لاحقاً.' },
        { q: 'كيف ألغي اشتراك البريميوم؟', a: 'يمكنك الإلغاء في أي وقت من إعدادات حسابك. ستبقى ميزات البريميوم نشطة حتى نهاية فترة الفوترة.' },
      ],
    },
    blog: {
      badge: 'المدونة',
      title: 'نصائح و',
      titleGradient: 'دروس',
      subtitle: 'تعلم كيف تحقق أقصى استفادة من AutoFlow وإنشاء فيديو بالذكاء الاصطناعي.',
      allPosts: 'جميع المقالات',
      readMore: '← اقرأ المزيد',
      minRead: 'دقائق قراءة',
      featured: 'مميز',
    },
    privacyPage: {
      title: 'سياسة الخصوصية',
      lastUpdated: 'آخر تحديث: مارس 2026',
    },
    termsPage: {
      title: 'شروط الخدمة',
      lastUpdated: 'آخر تحديث: مارس 2026',
    },
    promptsPage: {
      badge: 'مكتبة النصوص',
      title: 'أفضل النصوص لـ',
      titleGradient: 'Google Flow AI',
      subtitle: 'انسخ والصق هذه النصوص المحسنة لإنشاء الفيديوهات. استخدم AutoFlow لتشغيلها جميعًا دفعة واحدة.',
      copyBtn: 'نسخ النص',
      copiedBtn: 'تم النسخ!',
      runBtn: 'تشغيل في AutoFlow',
      categories: {
        cinematic: 'سينمائي وواقعي',
        animation: 'رسوم متحركة و3D',
        abstract: 'تجريدي وتجريبي'
      },
      prompts: [
        {
          category: 'cinematic',
          title: 'مدينة سايبر بانك نيون',
          text: 'لقطة سينمائية بطائرة بدون طيار تحلق عبر مدينة مستقبلية كثيفة ومضاءة بالنيون أثناء المطر. ضباب حجمي، دقة 8k، واقعية عالية، توهج عدسة، جو درامي.'
        },
        {
          category: 'cinematic',
          title: 'صب القهوة في الصحراء',
          text: 'لقطة مقربة جداً لقهوة إسبريسو داكنة تُصب في كوب سيراميك على الكثبان الرملية الذهبية. تصوير بطيء 120 إطار في الثانية، تفاصيل عالية، إضاءة درامية، عمق ميداني.'
        },
        {
          category: 'animation',
          title: 'روبوت لطيف بأسلوب بيكسار',
          text: 'روبوت صغير ولطيف وصدئ يحمل زهرة زرقاء متوهجة في غابة سحرية. أسلوب الرسوم المتحركة ثلاثية الأبعاد لبيكسار، إضاءة ناعمة، ألوان نابضة بالحياة، عيون معبرة، غبار متوهج سحري في الهواء.'
        },
        {
          category: 'animation',
          title: 'مبارزة ساموراي بأسلوب الأنمي',
          text: 'رسوم متحركة ثنائية الأبعاد لساموراي يسحب سيف كاتانا متوهج على قمة جبل ثلجي في منتصف الليل. حركة عالية، زاوية كاميرا ديناميكية، أسلوب استوديو جيبلي، أزهار الكرز تهب في الريح.'
        },
        {
          category: 'abstract',
          title: 'تدفق الذهب السائل',
          text: 'ديناميكيات السوائل التجريدية للذهب السائل يختلط بألوان السديم في الفضاء العميق. دوامات، تصوير بطيء ساحر، دقة 8k عالية التفاصيل، محاكاة الجسيمات، جمالية فاخرة.'
        }
      ]
    },
  },

  fr: {
    meta: {
      title: 'AutoFlow — Automatiser la Génération de Vidéos AI avec Google Flow',
      description: "Extension Chrome AutoFlow pour automatiser la génération vidéo Google Flow. Traitement par lots de prompts, gestion intelligente de files d'attente, re-essai automatique, téléchargement en masse en 4K.",
    },
    nav: {
      features: 'Fonctionnalités',
      howItWorks: 'Comment ça marche',
      pricing: 'Tarifs',
      faq: 'FAQ',
      prompts: 'Prompts',
      install: 'Installer Gratuit',
    },
    hero: {
      badge: 'Extension Chrome pour Google Flow',
      titleLine1: 'Génération de Vidéos AI',
      titleLine2: 'en Pilote Automatique',
      subtitle: "Collez vos prompts, lancez, et partez. AutoFlow gère les clics, l'attente, les re-essais et les téléchargements — concentrez-vous sur la création.",
      installBtn: "Installer Gratuit — C'est Rapide",
      featuresBtn: 'Voir les Fonctionnalités →',
    },
    features: {
      badge: 'Fonctionnalités',
      title: 'Tout ce dont Vous Avez Besoin pour',
      titleGradient: 'Générer à Grande Échelle',
      subtitle: 'AutoFlow booste Google Flow avec une automatisation puissante — du prompt au téléchargement.',
      items: [
        {
          tag: 'Créer',
          title: 'Traitement par Lots de Prompts',
          desc: "Arrêtez de copier-coller les prompts un par un. Collez votre script entier — 5, 50 ou 500 prompts — dans l'éditeur. AutoFlow analyse chaque bloc en une tâche séparée, prête à être mise en file.",
          bullets: [
            'Collez tous les prompts en une fois — séparés par des lignes vides',
            'Détection auto des numéros de scène',
            'Supporte tous les modes de création Google Flow',
          ],
        },
        {
          tag: 'Images',
          title: 'Mapping des Images de Référence',
          desc: "Attachez des images de référence à vos prompts. Utilisez des images partagées, des images par prompt, ou la correspondance automatique de personnages — AutoFlow associe le bon visage à chaque scène.",
          bullets: [
            'Références partagées attachées à chaque prompt',
            'Correspondance auto des personnages par nom',
            "Sélection par prompt (jusqu'à 10 chaque)",
          ],
        },
        {
          tag: 'Files',
          title: "Gestion Intelligente des Files d'Attente",
          desc: "Chaque paramètre est visible d'un coup d'œil — modèle, orientation, nombre de générations, timing, qualité. Créez plusieurs files avec différentes configs.",
          bullets: [
            'Grille complète des paramètres — modèle, timing, téléchargements',
            'Cible : nouveau projet ou projet actuel',
            'Suivi de progression avec prompts complétés/échoués',
          ],
        },
        {
          tag: 'Automatisation',
          title: 'Moniteur en Direct',
          desc: "Observez AutoFlow en temps réel. Le moniteur affiche chaque action — ouverture des paramètres, remplissage des prompts, détection des tuiles. Pause, reprise, saut ou re-essai à tout moment.",
          bullets: [
            "Journal en temps réel de chaque étape d'automatisation",
            'Contrôles Pause / Reprendre / Arrêter / Passer / Réessayer',
            "Re-essai automatique en cas d'échec",
          ],
        },
        {
          tag: 'Bibliothèque',
          title: 'Scan de Bibliothèque & Téléchargement en Masse',
          desc: "Après la génération, scannez votre projet pour voir toutes les vidéos et images groupées par prompt. Sélectionnez vos favoris, téléchargez en 720p, 1080p ou 4K.",
          bullets: [
            'Scan en un clic de tous les assets',
            'Groupés par prompt avec compteurs vidéo/image',
            'Téléchargement ou amélioration en masse',
          ],
        },
        {
          tag: 'Paramètres',
          title: 'Entièrement Configurable',
          desc: "Choisissez votre modèle vidéo, ratio, nombre de générations, temps d'attente et préférences de téléchargement. Activez le mode frappe pour un rythme naturel.",
          bullets: [
            'Sélection du modèle et de la résolution',
            'Téléchargement auto avec résolution personnalisée (720p – 4K)',
            'Mode frappe pour une saisie naturelle',
          ],
        },
      ],
    },
    howItWorks: {
      badge: 'Comment ça marche',
      title: 'Trois Étapes vers la',
      titleGradient: 'Génération Automatisée',
      subtitle: "Commencez en moins d'une minute. Aucune configuration complexe.",
      steps: [
        {
          num: '01',
          title: 'Collez Vos Prompts',
          desc: "Ouvrez le panneau latéral AutoFlow sur n'importe quelle page Google Flow. Choisissez votre mode, puis collez tous vos prompts. Chaque paragraphe devient une tâche séparée.",
        },
        {
          num: '02',
          title: 'Configurez & Lancez',
          desc: "Ajoutez vos prompts à une file. Choisissez le modèle, l'orientation, le nombre de générations. Cliquez sur Exécuter. AutoFlow prend le relais.",
        },
        {
          num: '03',
          title: 'Relaxez & Récoltez',
          desc: "AutoFlow tape chaque prompt, clique sur générer, attend les résultats, télécharge les vidéos et passe au suivant. Scannez ensuite la bibliothèque pour tout télécharger.",
        },
      ],
    },
    cta: {
      title: 'Prêt à Automatiser votre Workflow ?',
      subtitle: 'Rejoignez les créateurs qui utilisent AutoFlow pour générer des vidéos AI 10x plus vite. Gratuit pour commencer.',
      btn: 'Installer AutoFlow — Gratuit',
    },
    footer: {
      desc: "Automatisez la génération de vidéos AI avec Google Flow. Traitement par lots, files d'attente et téléchargement — tout en autopilote.",
      product: 'Produit',
      support: 'Support',
      contact: 'Contact',
      legal: 'Légal',
      privacy: 'Politique de Confidentialité',
      terms: "Conditions d'Utilisation",
      copyright: "AutoFlow. Non affilié à Google. Outil d'automatisation tiers.",
    },
    pricing: {
      badge: 'Tarifs',
      title: 'Des Tarifs Simples et',
      titleGradient: 'Transparents',
      subtitle: 'Commencez gratuitement. Passez au Pro quand vous avez besoin de puissance illimitée.',
      free: {
        name: 'Gratuit',
        price: '$0',
        period: '/ pour toujours',
        desc: 'Parfait pour débuter et un usage léger.',
        features: ['Génération texte-vers-vidéo', "Jusqu'à 10 prompts texte/jour", "Jusqu'à 3 prompts complets/jour", 'Téléchargement auto', 'Traitement par lots'],
        btn: 'Installer Gratuit',
      },
      pro: {
        name: 'Pro',
        price: '$9.99',
        period: '/ mois',
        desc: 'Tout en illimité. Pour les créateurs sérieux.',
        features: ['Tout du Gratuit', 'Prompts texte illimités', 'Prompts complets illimités', 'File de génération prioritaire', 'Amélioration et téléchargement en masse', 'Bibliothèque de personnages', 'Mode chaîne d\'images', 'Support prioritaire'],
        btn: 'Passer au Pro',
      },
    },
    faq: {
      badge: 'FAQ',
      title: 'Questions',
      titleGradient: 'Fréquentes',
      subtitle: 'Tout ce que vous devez savoir sur AutoFlow.',
      items: [
        { q: "Qu'est-ce qu'AutoFlow ?", a: "AutoFlow est une extension Chrome qui automatise votre workflow sur Google Flow. Elle vous permet de traiter des prompts vidéo par lots, gérer des files d'attente, attacher des images et télécharger automatiquement — transformant des heures de clics en minutes." },
        { q: 'AutoFlow est-il affilié à Google ?', a: 'Non. AutoFlow est un outil tiers indépendant. Il automatise vos interactions avec Google Flow dans votre propre session de navigateur.' },
        { q: 'Comment installer AutoFlow ?', a: "Cliquez sur 'Installer Gratuit' pour aller au Chrome Web Store. Cliquez 'Ajouter à Chrome' et l'extension sera prête. Ouvrez Google Flow, puis cliquez sur l'icône AutoFlow." },
        { q: 'Quelle est la différence entre Gratuit et Pro ?', a: "Le Gratuit vous donne des prompts quotidiens limités. Pro supprime toutes les limites — prompts illimités, amélioration en masse, bibliothèques de personnages, chaînes d'images et support prioritaire." },
        { q: "Que sont les prompts 'texte' vs 'complets' ?", a: "Les prompts texte sont du texte-vers-vidéo pur. Les prompts complets incluent des pièces jointes d'images. Les prompts complets ont une limite quotidienne séparée dans le plan Gratuit." },
        { q: 'AutoFlow stocke-t-il mes prompts ou vidéos ?', a: "Non. Toutes les données restent dans le stockage local de votre navigateur. AutoFlow n'envoie jamais vos prompts, images ou vidéos à un serveur externe." },
        { q: 'Que se passe-t-il si ma génération échoue ?', a: "AutoFlow réessaie automatiquement les prompts échoués (jusqu'à 2 tentatives). Si un prompt échoue encore, il est marqué comme échoué et vous pouvez réessayer plus tard." },
        { q: 'Comment annuler mon abonnement Pro ?', a: 'Vous pouvez annuler à tout moment depuis vos paramètres. Vos fonctionnalités Pro resteront actives jusqu\'à la fin de votre période de facturation.' },
      ],
    },
    blog: {
      badge: 'Blog',
      title: 'Conseils &',
      titleGradient: 'Tutoriels',
      subtitle: 'Apprenez à tirer le meilleur parti d\'AutoFlow et de la génération vidéo AI.',
      allPosts: 'Tous les Articles',
      readMore: 'Lire la suite →',
      minRead: 'min de lecture',
      featured: 'En vedette',
    },
    privacyPage: {
      title: 'Politique de Confidentialité',
      lastUpdated: 'Dernière mise à jour : Mars 2026',
    },
    termsPage: {
      title: "Conditions d'Utilisation",
      lastUpdated: 'Dernière mise à jour : Mars 2026',
    },
    promptsPage: {
      badge: 'Bibliothèque de Prompts',
      title: 'Les Meilleurs Prompts',
      titleGradient: 'Google Flow AI',
      subtitle: 'Copiez et collez ces prompts optimisés pour la vidéo. Utilisez AutoFlow pour tous les exécuter en même temps.',
      copyBtn: 'Copier le Prompt',
      copiedBtn: 'Copié !',
      runBtn: 'Lancer dans AutoFlow',
      categories: {
        cinematic: 'Cinématique & Réaliste',
        animation: 'Animation & 3D',
        abstract: 'Abstrait & Expérimental'
      },
      prompts: [
        {
          category: 'cinematic',
          title: 'Ville Cyberpunk Néon',
          text: 'Un plan cinématique de drone volant à travers une ville cyberpunk futuriste dense et éclairée au néon pendant qu\'il pleut. Brouillard volumétrique, résolution 8k, photoréaliste, atmosphère sombre.'
        },
        {
          category: 'cinematic',
          title: 'Café dans le Désert',
          text: 'Gros plan extrême sur du café expresso noir versé dans une tasse en céramique posée sur des dunes de sable doré. Ralenti 120fps, très détaillé, éclairage dramatique, profondeur de champ.'
        },
        {
          category: 'animation',
          title: 'Robot Mignon Style Pixar',
          text: 'Un petit robot rouillé et mignon tenant une fleur bleue lumineuse dans une forêt magique. Style d\'animation 3D Pixar, éclairage doux, couleurs vibrantes, yeux expressifs, poussière magique dans l\'air.'
        },
        {
          category: 'animation',
          title: 'Duel de Samouraï Anime',
          text: 'Animation style anime 2D d\'un samouraï dégainant un katana lumineux sur un sommet de montagne enneigé à minuit. Action intense, angle de caméra dynamique, style Studio Ghibli, fleurs de cerisier dans le vent.'
        },
        {
          category: 'abstract',
          title: 'Or Liquide',
          text: 'Dynamique des fluides macro abstraite d\'or liquide se mélangeant aux couleurs d\'une nébuleuse de l\'espace profond. Tourbillonnant, ralenti hypnotisant, 8k très détaillé, esthétique de luxe.'
        }
      ]
    },
  },

  es: {
    meta: { title: 'AutoFlow — Automatiza la Generación de Videos AI con Google Flow', description: 'Extensión de Chrome que automatiza la generación de video con IA. Procesa cientos de prompts por lotes, gestión inteligente de colas, reintentos automáticos, descarga masiva en 4K.' },
    nav: { features: 'Funciones', howItWorks: 'Cómo Funciona', pricing: 'Precios', faq: 'FAQ', prompts: 'Prompts', install: 'Instalar Gratis' },
    hero: { badge: 'Extensión de Chrome para Google Flow', titleLine1: 'Generación de Videos AI', titleLine2: 'en Piloto Automático', subtitle: 'Pega tus prompts, presiona ejecutar y aléjate. AutoFlow maneja los clics, la espera, los reintentos y las descargas — tú concéntrate en crear.', installBtn: 'Instalar Gratis — Es Rápido', featuresBtn: 'Ver Funciones →' },
    features: {
      badge: 'Funciones', title: 'Todo lo que Necesitas para', titleGradient: 'Generar a Gran Escala', subtitle: 'AutoFlow potencia Google Flow con automatización poderosa — del prompt a la descarga.',
      items: [
        { tag: 'Crear', title: 'Procesamiento por Lotes', desc: 'Deja de copiar y pegar prompts uno por uno. Pega tu guión completo — 5, 50 o 500 prompts. AutoFlow analiza cada bloque como una tarea separada.', bullets: ['Pega todos los prompts de una vez', 'Detección automática de números de escena', 'Soporta todos los modos de Google Flow'] },
        { tag: 'Imágenes', title: 'Mapeo de Imágenes de Referencia', desc: 'Adjunta imágenes de referencia a tus prompts. Usa imágenes compartidas, por prompt, o coincidencia automática de personajes.', bullets: ['Referencias compartidas para cada prompt', 'Coincidencia automática de personajes por nombre', 'Selección por prompt (hasta 10)'] },
        { tag: 'Colas', title: 'Gestión Inteligente de Colas', desc: 'Cada ajuste visible de un vistazo — modelo, orientación, generaciones, timing, calidad. Crea múltiples colas con diferentes configuraciones.', bullets: ['Panel completo de ajustes', 'Objetivo: proyecto nuevo o actual', 'Seguimiento con prompts completados/fallidos'] },
        { tag: 'Automatización', title: 'Monitor en Vivo', desc: 'Observa AutoFlow en tiempo real. El monitor muestra cada acción. Pausa, reanuda, salta o reintenta cuando quieras.', bullets: ['Registro en tiempo real de cada paso', 'Controles Pausar / Reanudar / Detener / Saltar', 'Reintento automático en fallos'] },
        { tag: 'Biblioteca', title: 'Escáner y Descarga Masiva', desc: 'Después de generar, escanea tu proyecto para ver todos los videos agrupados por prompt. Selecciona favoritos y descarga en 720p, 1080p o 4K.', bullets: ['Escaneo con un clic', 'Agrupados por prompt', 'Descarga masiva o mejora de calidad'] },
        { tag: 'Ajustes', title: 'Totalmente Configurable', desc: 'Elige modelo de video, proporción, cantidad de generaciones, tiempos de espera y preferencias de descarga.', bullets: ['Selección de modelo y resolución', 'Descarga automática (720p – 4K)', 'Modo de escritura natural'] },
      ],
    },
    howItWorks: { badge: 'Cómo Funciona', title: 'Tres Pasos hacia la', titleGradient: 'Generación Automática', subtitle: 'Comienza en menos de un minuto. Sin configuración compleja.', steps: [{ num: '01', title: 'Pega tus Prompts', desc: 'Abre el panel lateral de AutoFlow en cualquier página de Google Flow. Elige tu modo y pega todos tus prompts.' }, { num: '02', title: 'Configura y Ejecuta', desc: 'Agrega tus prompts a una cola. Elige modelo, orientación, cantidad. Presiona Ejecutar.' }, { num: '03', title: 'Relájate y Recolecta', desc: 'AutoFlow escribe cada prompt, genera, espera, descarga y pasa al siguiente automáticamente.' }] },
    cta: { title: '¿Listo para Automatizar?', subtitle: 'Únete a los creadores que usan AutoFlow para generar videos AI 10x más rápido. Gratis para empezar.', btn: 'Instalar AutoFlow — Gratis' },
    footer: { desc: 'Automatiza la generación de video AI con Google Flow. Procesamiento por lotes, colas y descarga — todo en piloto automático.', product: 'Producto', support: 'Soporte', contact: 'Contacto', legal: 'Legal', privacy: 'Política de Privacidad', terms: 'Términos de Servicio', copyright: 'AutoFlow. No afiliado a Google. Herramienta de automatización independiente.' },
    pricing: { badge: 'Precios', title: 'Precios Simples y', titleGradient: 'Transparentes', subtitle: 'Empieza gratis. Actualiza cuando necesites poder ilimitado.', free: { name: 'Gratis', price: '$0', period: '/ siempre', desc: 'Perfecto para empezar.', features: ['Generación texto-a-video', 'Hasta 10 prompts de texto/día', 'Hasta 3 prompts completos/día', 'Descarga automática', 'Procesamiento por lotes'], btn: 'Instalar Gratis' }, pro: { name: 'Pro', price: '$9.99', period: '/ mes', desc: 'Todo ilimitado. Para creadores serios.', features: ['Todo lo del plan Gratis', 'Prompts de texto ilimitados', 'Prompts completos ilimitados', 'Cola de generación prioritaria', 'Mejora y descarga masiva', 'Biblioteca de personajes', 'Modo cadena de frames', 'Soporte prioritario'], btn: 'Actualizar a Pro' } },
    faq: { badge: 'FAQ', title: 'Preguntas', titleGradient: 'Frecuentes', subtitle: 'Todo lo que necesitas saber sobre AutoFlow.', items: [{ q: '¿Qué es AutoFlow?', a: 'AutoFlow es una extensión de Chrome que automatiza tu flujo de trabajo en Google Flow. Procesa prompts de video por lotes, gestiona colas, adjunta imágenes y descarga automáticamente.' }, { q: '¿Está AutoFlow afiliado a Google?', a: 'No. AutoFlow es una herramienta independiente que automatiza tus interacciones con Google Flow dentro de tu propio navegador.' }, { q: '¿Cómo instalo AutoFlow?', a: 'Haz clic en "Instalar Gratis" para ir a la Chrome Web Store. Haz clic en "Añadir a Chrome" y la extensión estará lista.' }, { q: '¿Cuál es la diferencia entre Gratis y Pro?', a: 'Gratis te da prompts diarios limitados. Pro elimina todos los límites — prompts ilimitados, mejora masiva, bibliotecas de personajes y soporte prioritario.' }, { q: '¿AutoFlow almacena mis prompts o videos?', a: 'No. Todos los datos permanecen en el almacenamiento local de tu navegador. AutoFlow nunca sube tus datos a servidores externos.' }, { q: '¿Qué pasa si mi generación falla?', a: 'AutoFlow reintenta automáticamente los prompts fallidos (hasta 2 reintentos). Si sigue fallando, se marca como fallido y puedes reintentar después.' }] },
    blog: { badge: 'Blog', title: 'Consejos y', titleGradient: 'Tutoriales', subtitle: 'Aprende a sacar el máximo provecho de AutoFlow.', allPosts: 'Todos los Artículos', readMore: 'Leer más →', minRead: 'min de lectura', featured: 'Destacado' },
    privacyPage: { title: 'Política de Privacidad', lastUpdated: 'Última actualización: Marzo 2026' },
    termsPage: { title: 'Términos de Servicio', lastUpdated: 'Última actualización: Marzo 2026' },
    promptsPage: { badge: 'Biblioteca de Prompts', title: 'Mejores Prompts para', titleGradient: 'Google Flow AI', subtitle: 'Copia y pega estos prompts optimizados. Usa AutoFlow para ejecutarlos todos a la vez.', copyBtn: 'Copiar Prompt', copiedBtn: '¡Copiado!', runBtn: 'Ejecutar en AutoFlow', categories: { cinematic: 'Cinematográfico y Realista', animation: 'Animación y 3D', abstract: 'Abstracto y Experimental' }, prompts: [{ category: 'cinematic', title: 'Ciudad Cyberpunk Neón', text: 'Toma cinematográfica de un dron volando por una ciudad futurista cyberpunk iluminada con neón bajo la lluvia. Niebla volumétrica, resolución 8k, fotorrealista.' }, { category: 'cinematic', title: 'Café en el Desierto', text: 'Primer plano extremo de café espresso oscuro vertiéndose en una taza de cerámica sobre dunas de arena dorada. Cámara lenta 120fps, muy detallado.' }, { category: 'animation', title: 'Robot Lindo Estilo Pixar', text: 'Un pequeño robot oxidado y adorable sosteniendo una flor azul brillante en un bosque mágico. Estilo animación 3D Pixar, iluminación suave, colores vibrantes.' }, { category: 'animation', title: 'Duelo Samurái Anime', text: 'Animación 2D estilo anime de un samurái desenvainando una katana brillante en una montaña nevada a medianoche. Acción intensa, estilo Studio Ghibli.' }, { category: 'abstract', title: 'Flujo de Oro Líquido', text: 'Dinámica de fluidos macro abstracta de oro líquido mezclándose con colores de nebulosa del espacio profundo. Hipnótico, cámara lenta, 8k, estética de lujo.' }] },
  },

  de: {
    meta: { title: 'AutoFlow — Google Flow AI-Videogenerierung automatisieren', description: 'Chrome-Erweiterung zur Automatisierung der Google Flow Videogenerierung. Hunderte Prompts stapelweise verarbeiten, intelligente Warteschlangen, automatische Wiederholungen, Massendownload in 4K.' },
    nav: { features: 'Funktionen', howItWorks: 'So funktioniert es', pricing: 'Preise', faq: 'FAQ', prompts: 'Prompts', install: 'Kostenlos installieren' },
    hero: { badge: 'Chrome-Erweiterung für Google Flow', titleLine1: 'KI-Videogenerierung', titleLine2: 'auf Autopilot', subtitle: 'Prompts einfügen, starten und zurücklehnen. AutoFlow übernimmt das Klicken, Warten, Wiederholen und Herunterladen — du konzentrierst dich aufs Kreieren.', installBtn: 'Kostenlos installieren — Schnell', featuresBtn: 'Funktionen ansehen →' },
    features: {
      badge: 'Funktionen', title: 'Alles was du brauchst um', titleGradient: 'im großen Stil zu generieren', subtitle: 'AutoFlow verstärkt Google Flow mit leistungsstarker Automatisierung — vom Prompt zum Download.',
      items: [
        { tag: 'Erstellen', title: 'Stapelverarbeitung von Prompts', desc: 'Hör auf, Prompts einzeln zu kopieren. Füge dein gesamtes Skript ein — 5, 50 oder 500 Prompts. AutoFlow analysiert jeden Block als separate Aufgabe.', bullets: ['Alle Prompts auf einmal einfügen', 'Automatische Szenennummernerkennung', 'Unterstützt alle Google Flow Modi'] },
        { tag: 'Bilder', title: 'Referenzbilder-Zuordnung', desc: 'Hänge Referenzbilder an deine Prompts an. Nutze geteilte Bilder, pro-Prompt-Bilder oder automatische Charaktererkennung.', bullets: ['Geteilte Referenzen für jeden Prompt', 'Automatische Charakterzuordnung nach Name', 'Pro-Prompt-Auswahl (bis zu 10)'] },
        { tag: 'Warteschlangen', title: 'Intelligente Warteschlangen', desc: 'Jede Einstellung auf einen Blick — Modell, Ausrichtung, Generierungen, Timing, Qualität. Erstelle mehrere Warteschlangen mit verschiedenen Konfigurationen.', bullets: ['Vollständiges Einstellungsfeld', 'Ziel: neues oder aktuelles Projekt', 'Fortschrittsverfolgung'] },
        { tag: 'Automatisierung', title: 'Live-Monitor', desc: 'Beobachte AutoFlow in Echtzeit. Der Monitor zeigt jede Aktion. Pausiere, setze fort, überspringe oder wiederhole jederzeit.', bullets: ['Echtzeit-Protokoll jedes Schritts', 'Pause / Fortsetzen / Stoppen / Überspringen', 'Automatische Wiederholung bei Fehlern'] },
        { tag: 'Bibliothek', title: 'Scanner & Massendownload', desc: 'Nach der Generierung scanne dein Projekt um alle Videos gruppiert nach Prompt zu sehen. Wähle Favoriten und lade in 720p, 1080p oder 4K herunter.', bullets: ['Ein-Klick-Scan', 'Gruppiert nach Prompt', 'Massendownload oder Qualitätsverbesserung'] },
        { tag: 'Einstellungen', title: 'Vollständig konfigurierbar', desc: 'Wähle Videomodell, Seitenverhältnis, Generierungsanzahl, Wartezeiten und Download-Einstellungen.', bullets: ['Modell- und Auflösungsauswahl', 'Auto-Download (720p – 4K)', 'Natürlicher Tippmodus'] },
      ],
    },
    howItWorks: { badge: 'So funktioniert es', title: 'Drei Schritte zur', titleGradient: 'automatisierten Generierung', subtitle: 'Starte in unter einer Minute. Keine komplexe Einrichtung.', steps: [{ num: '01', title: 'Prompts einfügen', desc: 'Öffne das AutoFlow-Seitenpanel auf jeder Google Flow Seite. Wähle deinen Modus und füge alle Prompts ein.' }, { num: '02', title: 'Konfigurieren & Starten', desc: 'Füge Prompts zur Warteschlange hinzu. Wähle Modell, Ausrichtung, Anzahl. Klicke auf Ausführen.' }, { num: '03', title: 'Zurücklehnen & Sammeln', desc: 'AutoFlow tippt jeden Prompt, generiert, wartet, lädt herunter und wechselt automatisch zum nächsten.' }] },
    cta: { title: 'Bereit zu automatisieren?', subtitle: 'Schließe dich Kreativen an, die AutoFlow nutzen um AI-Videos 10x schneller zu generieren. Kostenlos starten.', btn: 'AutoFlow installieren — Kostenlos' },
    footer: { desc: 'Automatisiere AI-Videogenerierung mit Google Flow. Stapelverarbeitung, Warteschlangen und Download — alles auf Autopilot.', product: 'Produkt', support: 'Support', contact: 'Kontakt', legal: 'Rechtliches', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', copyright: 'AutoFlow. Nicht mit Google verbunden. Unabhängiges Automatisierungstool.' },
    pricing: { badge: 'Preise', title: 'Einfache, transparente', titleGradient: 'Preise', subtitle: 'Kostenlos starten. Upgraden wenn du unbegrenzte Power brauchst.', free: { name: 'Kostenlos', price: '$0', period: '/ für immer', desc: 'Perfekt zum Starten.', features: ['Text-zu-Video Generierung', 'Bis zu 10 Text-Prompts/Tag', 'Bis zu 3 Vollfeature-Prompts/Tag', 'Auto-Download', 'Stapelverarbeitung'], btn: 'Kostenlos installieren' }, pro: { name: 'Pro', price: '$9.99', period: '/ Monat', desc: 'Alles unbegrenzt. Für ernsthafte Kreative.', features: ['Alles aus Kostenlos', 'Unbegrenzte Text-Prompts', 'Unbegrenzte Vollfeature-Prompts', 'Prioritäts-Generierungswarteschlange', 'Massen-Upscale & Download', 'Charakter-Bildbibliothek', 'Frame-Chain-Modus', 'Prioritäts-Support'], btn: 'Auf Pro upgraden' } },
    faq: { badge: 'FAQ', title: 'Häufig gestellte', titleGradient: 'Fragen', subtitle: 'Alles was du über AutoFlow wissen musst.', items: [{ q: 'Was ist AutoFlow?', a: 'AutoFlow ist eine Chrome-Erweiterung die deinen Workflow auf Google Flow automatisiert. Verarbeite Video-Prompts stapelweise, verwalte Warteschlangen, hänge Bilder an und lade automatisch herunter.' }, { q: 'Ist AutoFlow mit Google verbunden?', a: 'Nein. AutoFlow ist ein unabhängiges Tool das deine Interaktionen mit Google Flow in deinem eigenen Browser automatisiert.' }, { q: 'Wie installiere ich AutoFlow?', a: 'Klicke auf "Kostenlos installieren" um zum Chrome Web Store zu gelangen. Klicke "Zu Chrome hinzufügen" und die Erweiterung ist bereit.' }, { q: 'Was ist der Unterschied zwischen Kostenlos und Pro?', a: 'Kostenlos gibt dir tägliche begrenzte Prompts. Pro entfernt alle Limits — unbegrenzte Prompts, Massen-Upscale, Charakterbibliotheken und Prioritäts-Support.' }, { q: 'Speichert AutoFlow meine Prompts oder Videos?', a: 'Nein. Alle Daten bleiben im lokalen Speicher deines Browsers. AutoFlow lädt niemals deine Daten auf externe Server hoch.' }, { q: 'Was passiert wenn meine Generierung fehlschlägt?', a: 'AutoFlow wiederholt fehlgeschlagene Prompts automatisch (bis zu 2 Versuche). Bei anhaltendem Fehler wird er markiert und du kannst später erneut versuchen.' }] },
    blog: { badge: 'Blog', title: 'Tipps &', titleGradient: 'Tutorials', subtitle: 'Lerne wie du das Beste aus AutoFlow herausholst.', allPosts: 'Alle Artikel', readMore: 'Weiterlesen →', minRead: 'Min. Lesezeit', featured: 'Empfohlen' },
    privacyPage: { title: 'Datenschutzerklärung', lastUpdated: 'Letzte Aktualisierung: März 2026' },
    termsPage: { title: 'Nutzungsbedingungen', lastUpdated: 'Letzte Aktualisierung: März 2026' },
    promptsPage: { badge: 'Prompt-Bibliothek', title: 'Beste Prompts für', titleGradient: 'Google Flow AI', subtitle: 'Kopiere diese optimierten Prompts. Nutze AutoFlow um sie alle gleichzeitig auszuführen.', copyBtn: 'Prompt kopieren', copiedBtn: 'Kopiert!', runBtn: 'In AutoFlow ausführen', categories: { cinematic: 'Kinematisch & Realistisch', animation: 'Animation & 3D', abstract: 'Abstrakt & Experimentell' }, prompts: [{ category: 'cinematic', title: 'Neon Cyberpunk Stadt', text: 'Kinematische Drohnenaufnahme durch eine dichte, neonbeleuchtete futuristische Cyberpunk-Stadt im Regen. Volumetrischer Nebel, 8k Auflösung, fotorealistisch.' }, { category: 'cinematic', title: 'Wüstenkaffee', text: 'Extreme Nahaufnahme von dunklem Espresso der in eine Keramiktasse auf goldenen Sanddünen gegossen wird. Zeitlupe 120fps, hochdetailliert.' }, { category: 'animation', title: 'Süßer Pixar-Roboter', text: 'Ein kleiner, rostiger, niedlicher Roboter der eine leuchtende blaue Blume in einem magischen Wald hält. Pixar 3D-Animationsstil, sanfte Beleuchtung.' }, { category: 'animation', title: 'Anime Samurai-Duell', text: '2D Anime-Animation eines Samurai der ein leuchtendes Katana auf einem verschneiten Berggipfel um Mitternacht zieht. Studio Ghibli Stil.' }, { category: 'abstract', title: 'Flüssiges Gold', text: 'Abstrakte Makro-Fluiddynamik von flüssigem Gold das sich mit Weltraumnebel-Farben mischt. Hypnotisch, Zeitlupe, 8k, Luxus-Ästhetik.' }] },
  },

  it: {
    meta: { title: 'AutoFlow — Automatizza la Generazione di Video AI con Google Flow', description: 'Estensione Chrome che automatizza la generazione video con IA. Elaborazione batch di centinaia di prompt, gestione intelligente delle code, riprova automatica, download in massa in 4K.' },
    nav: { features: 'Funzionalità', howItWorks: 'Come Funziona', pricing: 'Prezzi', faq: 'FAQ', prompts: 'Prompt', install: 'Installa Gratis' },
    hero: { badge: 'Estensione Chrome per Google Flow', titleLine1: 'Generazione Video AI', titleLine2: 'in Pilota Automatico', subtitle: 'Incolla i tuoi prompt, premi avvia e vai. AutoFlow gestisce clic, attese, ritentativi e download — tu concentrati sulla creazione.', installBtn: 'Installa Gratis — È Veloce', featuresBtn: 'Vedi Funzionalità →' },
    features: {
      badge: 'Funzionalità', title: 'Tutto Ciò che Serve per', titleGradient: 'Generare su Larga Scala', subtitle: 'AutoFlow potenzia Google Flow con un\'automazione avanzata — dal prompt al download.',
      items: [
        { tag: 'Crea', title: 'Elaborazione Batch dei Prompt', desc: 'Smetti di copiare e incollare un prompt alla volta. Incolla tutto il tuo script — 5, 50 o 500 prompt — nell\'editor. AutoFlow analizza ogni blocco come un compito separato.', bullets: ['Incolla tutti i prompt in una volta', 'Rilevamento automatico dei numeri di scena', 'Supporta tutte le modalità di Google Flow'] },
        { tag: 'Immagini', title: 'Mappatura Immagini di Riferimento', desc: 'Allega immagini di riferimento ai tuoi prompt. Usa immagini condivise, per prompt, o la corrispondenza automatica dei personaggi.', bullets: ['Riferimenti condivisi per ogni prompt', 'Corrispondenza automatica per nome', 'Selezione per prompt (fino a 10)'] },
        { tag: 'Code', title: 'Gestione Intelligente delle Code', desc: 'Ogni impostazione visibile a colpo d\'occhio — modello, orientamento, generazioni, timing, qualità. Crea più code con configurazioni diverse.', bullets: ['Pannello completo delle impostazioni', 'Obiettivo: progetto nuovo o attuale', 'Monitoraggio con prompt completati/falliti'] },
        { tag: 'Automazione', title: 'Monitor in Tempo Reale', desc: 'Osserva AutoFlow in tempo reale. Il monitor mostra ogni azione. Metti in pausa, riprendi, salta o ritenta quando vuoi.', bullets: ['Log in tempo reale di ogni passaggio', 'Controlli Pausa / Riprendi / Ferma / Salta', 'Riprova automatica in caso di errore'] },
        { tag: 'Libreria', title: 'Scanner e Download in Massa', desc: 'Dopo la generazione, scansiona il tuo progetto per vedere tutti i video raggruppati per prompt. Seleziona i preferiti e scarica in 720p, 1080p o 4K.', bullets: ['Scansione con un clic', 'Raggruppati per prompt', 'Download in massa o upscaling'] },
        { tag: 'Impostazioni', title: 'Completamente Configurabile', desc: 'Scegli il modello video, proporzione, numero di generazioni, tempi di attesa e preferenze di download.', bullets: ['Selezione modello e risoluzione', 'Download automatico (720p – 4K)', 'Modalità digitazione naturale'] },
      ],
    },
    howItWorks: { badge: 'Come Funziona', title: 'Tre Passi verso la', titleGradient: 'Generazione Automatica', subtitle: 'Inizia in meno di un minuto. Nessuna configurazione complessa.', steps: [{ num: '01', title: 'Incolla i Tuoi Prompt', desc: 'Apri il pannello laterale di AutoFlow su qualsiasi pagina Google Flow. Scegli la modalità e incolla tutti i tuoi prompt.' }, { num: '02', title: 'Configura e Avvia', desc: 'Aggiungi i prompt a una coda. Scegli modello, orientamento, quantità. Premi Avvia.' }, { num: '03', title: 'Rilassati e Raccogli', desc: 'AutoFlow digita ogni prompt, genera, attende, scarica e passa al successivo automaticamente.' }] },
    cta: { title: 'Pronto ad Automatizzare?', subtitle: 'Unisciti ai creatori che usano AutoFlow per generare video AI 10 volte più velocemente. Gratis per iniziare.', btn: 'Installa AutoFlow — Gratis' },
    footer: { desc: 'Automatizza la generazione video AI con Google Flow. Elaborazione batch, code e download — tutto in pilota automatico.', product: 'Prodotto', support: 'Supporto', contact: 'Contatto', legal: 'Legale', privacy: 'Informativa sulla Privacy', terms: 'Termini di Servizio', copyright: 'AutoFlow. Non affiliato a Google. Strumento di automazione indipendente.' },
    pricing: { badge: 'Prezzi', title: 'Prezzi Semplici e', titleGradient: 'Trasparenti', subtitle: 'Inizia gratis. Aggiorna quando hai bisogno di potenza illimitata.', free: { name: 'Gratuito', price: '$0', period: '/ per sempre', desc: 'Perfetto per iniziare.', features: ['Generazione testo-a-video', 'Fino a 10 prompt di testo/giorno', 'Fino a 3 prompt completi/giorno', 'Download automatico', 'Elaborazione batch'], btn: 'Installa Gratis' }, pro: { name: 'Pro', price: '$9.99', period: '/ mese', desc: 'Tutto illimitato. Per creatori seri.', features: ['Tutto del piano Gratuito', 'Prompt di testo illimitati', 'Prompt completi illimitati', 'Coda di generazione prioritaria', 'Upscale e download in massa', 'Libreria immagini personaggi', 'Modalità catena di frame', 'Supporto prioritario'], btn: 'Passa a Pro' } },
    faq: { badge: 'FAQ', title: 'Domande', titleGradient: 'Frequenti', subtitle: 'Tutto ciò che devi sapere su AutoFlow.', items: [{ q: 'Cos\'è AutoFlow?', a: 'AutoFlow è un\'estensione Chrome che automatizza il tuo flusso di lavoro su Google Flow. Elabora prompt video in batch, gestisce code, allega immagini e scarica automaticamente.' }, { q: 'AutoFlow è affiliato a Google?', a: 'No. AutoFlow è uno strumento indipendente che automatizza le tue interazioni con Google Flow nel tuo browser.' }, { q: 'Come installo AutoFlow?', a: 'Clicca su "Installa Gratis" per andare al Chrome Web Store. Clicca "Aggiungi a Chrome" e l\'estensione sarà pronta.' }, { q: 'Qual è la differenza tra Gratuito e Pro?', a: 'Gratuito ti dà prompt giornalieri limitati. Pro rimuove tutti i limiti — prompt illimitati, upscale in massa, librerie personaggi e supporto prioritario.' }, { q: 'AutoFlow memorizza i miei prompt o video?', a: 'No. Tutti i dati restano nella memoria locale del tuo browser. AutoFlow non carica mai i tuoi dati su server esterni.' }, { q: 'Cosa succede se la generazione fallisce?', a: 'AutoFlow ritenta automaticamente i prompt falliti (fino a 2 tentativi). Se continua a fallire, viene contrassegnato e puoi ritentare dopo.' }] },
    blog: { badge: 'Blog', title: 'Consigli e', titleGradient: 'Tutorial', subtitle: 'Scopri come ottenere il massimo da AutoFlow.', allPosts: 'Tutti gli Articoli', readMore: 'Leggi di più →', minRead: 'min di lettura', featured: 'In Evidenza' },
    privacyPage: { title: 'Informativa sulla Privacy', lastUpdated: 'Ultimo aggiornamento: Marzo 2026' },
    termsPage: { title: 'Termini di Servizio', lastUpdated: 'Ultimo aggiornamento: Marzo 2026' },
    promptsPage: { badge: 'Libreria Prompt', title: 'I Migliori Prompt per', titleGradient: 'Google Flow AI', subtitle: 'Copia e incolla questi prompt ottimizzati. Usa AutoFlow per eseguirli tutti insieme.', copyBtn: 'Copia Prompt', copiedBtn: 'Copiato!', runBtn: 'Esegui in AutoFlow', categories: { cinematic: 'Cinematografico e Realistico', animation: 'Animazione e 3D', abstract: 'Astratto e Sperimentale' }, prompts: [{ category: 'cinematic', title: 'Città Cyberpunk al Neon', text: 'Ripresa cinematografica con drone che vola attraverso una densa città cyberpunk futuristica illuminata al neon sotto la pioggia. Nebbia volumetrica, risoluzione 8k, fotorealistico.' }, { category: 'cinematic', title: 'Caffè nel Deserto', text: 'Primo piano estremo di caffè espresso scuro versato in una tazza di ceramica su dune di sabbia dorata. Slow motion 120fps, molto dettagliato, illuminazione drammatica.' }, { category: 'animation', title: 'Robot Carino Stile Pixar', text: 'Un piccolo robot arrugginito e adorabile che tiene un fiore blu luminoso in una foresta magica. Stile animazione 3D Pixar, illuminazione morbida, colori vivaci.' }, { category: 'animation', title: 'Duello Samurai Anime', text: 'Animazione 2D stile anime di un samurai che estrae una katana luminosa su una vetta innevata a mezzanotte. Azione intensa, stile Studio Ghibli.' }, { category: 'abstract', title: 'Flusso d\'Oro Liquido', text: 'Dinamica dei fluidi macro astratta di oro liquido che si mescola ai colori di una nebulosa nello spazio profondo. Ipnotico, slow motion, 8k, estetica di lusso.' }] },
  },
};

export function getDictionary(locale) {
  return dictionaries[locale] || dictionaries.en;
}
