/* ============================================================
   AutoFlow Website — i18n Translations
   Supports: English, Arabic, French, Spanish
   ============================================================ */

export const locales = ['en', 'ar', 'fr', 'es'];
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
            'Sélection par prompt (jusqu\'à 10 chaque)',
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
            'Re-essai automatique en cas d\'échec',
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
      subtitle: 'Commencez en moins d\'une minute. Aucune configuration complexe.',
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
      desc: 'Automatisez la génération de vidéos AI avec Google Flow. Traitement par lots, files d\'attente et téléchargement — tout en autopilote.',
      product: 'Produit',
      support: 'Support',
      contact: 'Contact',
      legal: 'Légal',
      privacy: 'Politique de Confidentialité',
      terms: 'Conditions d\'Utilisation',
      copyright: 'AutoFlow. Non affilié à Google. Outil d\'automatisation tiers.',
    },
  },

  es: {
    meta: {
      title: 'AutoFlow — Automatiza la Generación de Videos AI con Google Flow',
      description: 'Extensión Chrome AutoFlow automatiza la generación de videos Google Flow. Procesamiento por lotes, gestión inteligente de colas, reintentos automáticos, descarga masiva en 4K.',
    },
    nav: {
      features: 'Funciones',
      howItWorks: 'Cómo Funciona',
      pricing: 'Precios',
      faq: 'FAQ',
      install: 'Instalar Gratis',
    },
    hero: {
      badge: 'Extensión Chrome para Google Flow',
      titleLine1: 'Generación de Videos AI',
      titleLine2: 'en Piloto Automático',
      subtitle: 'Pega tus prompts, haz clic en ejecutar y aléjate. AutoFlow se encarga de los clics, la espera, los reintentos y las descargas — concéntrate en crear.',
      installBtn: 'Instalar Gratis — Es Rápido',
      featuresBtn: 'Ver Funciones →',
    },
    features: {
      badge: 'Funciones',
      title: 'Todo lo que Necesitas para',
      titleGradient: 'Generar a Gran Escala',
      subtitle: 'AutoFlow potencia Google Flow con automatización poderosa — del prompt a la descarga.',
      items: [
        {
          tag: 'Crear',
          title: 'Procesamiento por Lotes de Prompts',
          desc: 'Deja de copiar y pegar prompts uno por uno. Pega tu guión completo — 5, 50 o 500 prompts — en el editor. AutoFlow analiza cada bloque como una tarea separada.',
          bullets: [
            'Pega todos los prompts de una vez — separados por líneas en blanco',
            'Detección automática de números de escena',
            'Soporta todos los modos de creación de Google Flow',
          ],
        },
        {
          tag: 'Imágenes',
          title: 'Mapeo de Imágenes de Referencia',
          desc: 'Adjunta imágenes de referencia a tus prompts. Usa imágenes compartidas, imágenes por prompt, o coincidencia automática de personajes — AutoFlow asocia el rostro correcto a cada escena.',
          bullets: [
            'Referencias compartidas adjuntas a cada prompt',
            'Coincidencia automática de personajes por nombre',
            'Selección por prompt (hasta 10 cada uno)',
          ],
        },
        {
          tag: 'Colas',
          title: 'Gestión Inteligente de Colas',
          desc: 'Cada ajuste visible de un vistazo — modelo, orientación, generaciones, timing, calidad. Crea múltiples colas con diferentes configuraciones.',
          bullets: [
            'Panel completo de ajustes — modelo, timing, descargas',
            'Destino: proyecto nuevo o proyecto actual',
            'Seguimiento de progreso con prompts completados/fallidos',
          ],
        },
        {
          tag: 'Automatización',
          title: 'Monitor en Vivo',
          desc: 'Observa AutoFlow trabajar en tiempo real. El monitor muestra cada acción — abrir ajustes, rellenar prompts, detectar tiles, esperar. Pausa, reanuda, salta o reintenta cuando quieras.',
          bullets: [
            'Registro en tiempo real de cada paso',
            'Controles Pausa / Reanudar / Detener / Saltar / Reintentar',
            'Reintento automático en fallos con comportamiento configurable',
          ],
        },
        {
          tag: 'Biblioteca',
          title: 'Escáner de Biblioteca y Descarga Masiva',
          desc: 'Después de la generación, escanea tu proyecto para ver todos los videos e imágenes agrupados por prompt. Selecciona favoritos, descarga en 720p, 1080p o 4K.',
          bullets: [
            'Escaneo con un clic de todos los assets',
            'Agrupados por prompt con contadores de video/imagen',
            'Descarga masiva o mejora de assets seleccionados',
          ],
        },
        {
          tag: 'Ajustes',
          title: 'Totalmente Configurable',
          desc: 'Elige tu modelo de video, ratio, número de generaciones, tiempos de espera y preferencias de descarga. Activa el modo escritura para un ritmo natural.',
          bullets: [
            'Selección de modelo y resolución de video',
            'Descarga automática con resolución personalizada (720p – 4K)',
            'Modo escritura para entrada similar a la humana',
          ],
        },
      ],
    },
    howItWorks: {
      badge: 'Cómo Funciona',
      title: 'Tres Pasos hacia la',
      titleGradient: 'Generación Automatizada',
      subtitle: 'Comienza en menos de un minuto. Sin configuración compleja.',
      steps: [
        {
          num: '01',
          title: 'Pega tus Prompts',
          desc: 'Abre el panel lateral de AutoFlow en cualquier página de Google Flow. Elige tu modo y pega todos tus prompts. Cada párrafo se convierte en una tarea separada.',
        },
        {
          num: '02',
          title: 'Configura y Ejecuta',
          desc: 'Añade tus prompts a una cola. Elige el modelo, orientación, número de generaciones y ajustes de descarga. Haz clic en Ejecutar. AutoFlow toma el control.',
        },
        {
          num: '03',
          title: 'Relájate y Recoge',
          desc: 'AutoFlow escribe cada prompt, hace clic en generar, espera los resultados, descarga los videos y pasa al siguiente. Escanea la biblioteca para revisar y descargar todo.',
        },
      ],
    },
    cta: {
      title: '¿Listo para Automatizar tu Flujo de Trabajo?',
      subtitle: 'Únete a los creadores que usan AutoFlow para generar videos AI 10x más rápido. Gratis para empezar.',
      btn: 'Instalar AutoFlow — Gratis',
    },
    footer: {
      desc: 'Automatiza la generación de videos AI con Google Flow. Procesamiento por lotes, colas y descarga — todo en piloto automático.',
      product: 'Producto',
      support: 'Soporte',
      contact: 'Contacto',
      legal: 'Legal',
      privacy: 'Política de Privacidad',
      terms: 'Términos de Servicio',
      copyright: 'AutoFlow. No afiliado a Google. Herramienta de automatización de terceros.',
    },
  },
};

export function getDictionary(locale) {
  return dictionaries[locale] || dictionaries.en;
}
