/* ============================================================
   AutoFlow Website — i18n Translations
   Supports: English, Arabic, French
   ============================================================ */

export const locales = ['en', 'ar', 'fr'];
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
  },
};

export function getDictionary(locale) {
  return dictionaries[locale] || dictionaries.en;
}
