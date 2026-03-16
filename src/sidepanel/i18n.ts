/* ============================================================
   AutoFlow – Internationalization (i18n)
   Supports: English, Arabic, French, Spanish
   ============================================================ */

export type Lang = 'en' | 'ar' | 'fr' | 'es';

export interface TranslationSet {
  [key: string]: string;
}

const translations: Record<Lang, TranslationSet> = {
  en: {
    // Tabs
    'tab.create': 'Create',
    'tab.settings': 'Settings',
    'tab.queues': 'Queues',
    'tab.library': 'Library',
    'tab.account': 'Account',

    // Create tab — modes
    'mode.createImage': 'Create Image',
    'mode.createImage.desc': 'AI images from text',
    'mode.textToVideo': 'Text-to-Video',
    'mode.textToVideo.desc': 'Video from prompts',
    'mode.frameToVideo': 'Frame-to-Video',
    'mode.frameToVideo.desc': 'Start → End frames',
    'mode.ingredients': 'Ingredients',
    'mode.ingredients.desc': 'Video + ref images',

    // Create tab — prompts
    'prompts.label': 'Prompts',
    'prompts.hint': 'Separate prompts with a blank line. Each block = one task.',
    'prompts.parse': 'Parse Prompts',
    'prompts.addQueue': 'Add to Queue',
    'prompts.newProject': 'New Project',
    'prompts.thisProject': 'This Project',

    // Create tab — images
    'images.shared': 'Shared Reference Images',
    'images.shared.hint': 'Attached to every prompt automatically.',
    'images.character': 'Character Images',
    'images.character.hint': 'Auto-match images by character name in prompts.',
    'images.map': 'Map Images to Prompts',
    'images.map.hint': 'Image 1 → prompt 1, image 2 → prompt 2, etc.',
    'images.uploadMap': 'Upload & Map',
    'images.frameChain': 'Frame Chain',
    'images.frameChain.hint': "Select N images → creates N−1 prompts. Each prompt's end frame becomes the next prompt's start frame.",
    'images.uploadChain': 'Upload & Chain Frames',
    'btn.add': '+ Add',

    // Monitor
    'monitor.title': 'Run Monitor',
    'monitor.pause': 'Pause',
    'monitor.resume': 'Resume',
    'monitor.stop': 'Stop',
    'monitor.skip': 'Skip',
    'monitor.retry': 'Retry',

    // Failed
    'failed.title': 'Failed Generations',
    'failed.scanPage': 'Scan Page',
    'failed.copyPrompts': 'Copy Prompts',
    'failed.retryAll': 'Retry All',
    'failed.manualIntervention': 'Manual intervention required.',

    // Settings tab
    'settings.generation': 'Generation',
    'settings.videoModel': 'Video Model',
    'settings.videoRatio': 'Video Ratio',
    'settings.videosPerTask': 'Videos per task',
    'settings.imageModel': 'Image Model',
    'settings.imageRatio': 'Image Ratio',
    'settings.timing': 'Timing',
    'settings.waitMin': 'Wait min (sec)',
    'settings.waitMax': 'Wait max (sec)',
    'settings.typingMode': 'Typing Mode',
    'settings.typingSpeed': 'Typing Speed',
    'settings.behavior': 'Behavior',
    'settings.stopOnError': 'Stop on error',
    'settings.download': 'Download',
    'settings.autoDownloadVideos': 'Auto-download videos',
    'settings.videoResolution': 'Video Resolution',
    'settings.autoDownloadImages': 'Auto-download images',
    'settings.imageResolution': 'Image Resolution',
    'settings.interface': 'Interface',
    'settings.language': 'Language',
    'settings.maintenance': 'Maintenance',
    'settings.refreshModels': 'Refresh Models',
    'settings.configFolder': 'Configure Folder',
    'settings.clearCache': 'Clear Flow Cache',
    'settings.clearCache.hint': 'Clears cached tokens and reloads Flash.',

    // Queues tab
    'queues.title': 'Queues',
    'queues.empty': 'No queues yet.',
    'queues.emptyHint': 'Add prompts in the Create tab.',

    // Library tab
    'library.title': 'Library',
    'library.scan': 'Scan Project',
    'library.all': 'All',
    'library.videos': 'Videos',
    'library.photos': 'Photos',
    'library.search': 'Search prompts...',
    'library.selectAll': 'Select All',
    'library.clearSel': 'Clear',
    'library.download': 'Download',
    'library.retrySelected': 'Retry',
    'library.upscale': 'Upscale',
    'library.empty': 'No assets found. Click Scan to search.',

    // Account tab
    'account.signIn': 'Sign In',
    'account.createAccount': 'Create Account',
    'account.email': 'Email',
    'account.password': 'Password',
    'account.btnSignIn': 'Sign In',
    'account.btnCreate': 'Create Account',
    'account.signOut': 'Sign Out',
    'account.refreshUsage': 'Refresh Usage',
    'account.upgradePro': 'Upgrade to Pro',
    'account.textPrompts': 'Text Prompts',
    'account.fullFeature': 'Full Feature',
    'account.verifyEmail': 'Verify Your Email',
    'account.verifyHint': 'We sent a verification email to',
    'account.resendVerify': 'Resend Verification Email',
    'account.backToLogin': 'Back to Login',

    // Toast / general
    'toast.copied': 'Copied!',
    'toast.saved': 'Settings saved.',
    'general.or': 'or',
  },

  ar: {
    // Tabs
    'tab.create': 'إنشاء',
    'tab.settings': 'الإعدادات',
    'tab.queues': 'القوائم',
    'tab.library': 'المكتبة',
    'tab.account': 'الحساب',

    // Create tab — modes
    'mode.createImage': 'إنشاء صورة',
    'mode.createImage.desc': 'صور بالذكاء الاصطناعي',
    'mode.textToVideo': 'نص إلى فيديو',
    'mode.textToVideo.desc': 'فيديو من النصوص',
    'mode.frameToVideo': 'إطار إلى فيديو',
    'mode.frameToVideo.desc': 'بداية ← نهاية',
    'mode.ingredients': 'المكونات',
    'mode.ingredients.desc': 'فيديو + صور مرجعية',

    // Create tab — prompts
    'prompts.label': 'النصوص',
    'prompts.hint': 'افصل النصوص بسطر فارغ. كل كتلة = مهمة واحدة.',
    'prompts.parse': 'تحليل النصوص',
    'prompts.addQueue': 'أضف إلى القائمة',
    'prompts.newProject': 'مشروع جديد',
    'prompts.thisProject': 'هذا المشروع',

    // Create tab — images
    'images.shared': 'صور مرجعية مشتركة',
    'images.shared.hint': 'تُرفق مع كل نص تلقائياً.',
    'images.character': 'صور الشخصيات',
    'images.character.hint': 'مطابقة تلقائية حسب اسم الشخصية.',
    'images.map': 'ربط الصور بالنصوص',
    'images.map.hint': 'صورة 1 ← نص 1، صورة 2 ← نص 2، إلخ.',
    'images.uploadMap': 'رفع وربط',
    'images.frameChain': 'سلسلة الإطارات',
    'images.frameChain.hint': 'اختر N صورة ← ينشئ N-1 نص. نهاية كل نص = بداية التالي.',
    'images.uploadChain': 'رفع وسلسلة',
    'btn.add': '+ إضافة',

    // Monitor
    'monitor.title': 'مراقبة التشغيل',
    'monitor.pause': 'إيقاف مؤقت',
    'monitor.resume': 'استئناف',
    'monitor.stop': 'إيقاف',
    'monitor.skip': 'تخطي',
    'monitor.retry': 'إعادة',

    // Failed
    'failed.title': 'عمليات فاشلة',
    'failed.scanPage': 'فحص الصفحة',
    'failed.copyPrompts': 'نسخ النصوص',
    'failed.retryAll': 'إعادة الكل',
    'failed.manualIntervention': 'تدخل يدوي مطلوب.',

    // Settings tab
    'settings.generation': 'الإنشاء',
    'settings.videoModel': 'نموذج الفيديو',
    'settings.videoRatio': 'نسبة الفيديو',
    'settings.videosPerTask': 'فيديوهات لكل مهمة',
    'settings.imageModel': 'نموذج الصورة',
    'settings.imageRatio': 'نسبة الصورة',
    'settings.timing': 'التوقيت',
    'settings.waitMin': 'انتظار أدنى (ثانية)',
    'settings.waitMax': 'انتظار أقصى (ثانية)',
    'settings.typingMode': 'وضع الكتابة',
    'settings.typingSpeed': 'سرعة الكتابة',
    'settings.behavior': 'السلوك',
    'settings.stopOnError': 'توقف عند الخطأ',
    'settings.download': 'التحميل',
    'settings.autoDownloadVideos': 'تحميل الفيديو تلقائياً',
    'settings.videoResolution': 'دقة الفيديو',
    'settings.autoDownloadImages': 'تحميل الصور تلقائياً',
    'settings.imageResolution': 'دقة الصورة',
    'settings.interface': 'الواجهة',
    'settings.language': 'اللغة',
    'settings.maintenance': 'الصيانة',
    'settings.refreshModels': 'تحديث النماذج',
    'settings.configFolder': 'إعدادات المجلد',
    'settings.clearCache': 'مسح ذاكرة التخزين',
    'settings.clearCache.hint': 'يمسح الرموز المخزنة ويعيد تحميل Flow.',

    // Queues tab
    'queues.title': 'القوائم',
    'queues.empty': 'لا توجد قوائم بعد.',
    'queues.emptyHint': 'أضف نصوصاً في تبويب الإنشاء.',

    // Library tab
    'library.title': 'المكتبة',
    'library.scan': 'فحص المشروع',
    'library.all': 'الكل',
    'library.videos': 'فيديوهات',
    'library.photos': 'صور',
    'library.search': 'بحث في النصوص...',
    'library.selectAll': 'تحديد الكل',
    'library.clearSel': 'مسح',
    'library.download': 'تحميل',
    'library.retrySelected': 'إعادة',
    'library.upscale': 'تحسين',
    'library.empty': 'لم يتم العثور على أصول. انقر فحص للبحث.',

    // Account tab
    'account.signIn': 'تسجيل الدخول',
    'account.createAccount': 'إنشاء حساب',
    'account.email': 'البريد الإلكتروني',
    'account.password': 'كلمة المرور',
    'account.btnSignIn': 'تسجيل الدخول',
    'account.btnCreate': 'إنشاء حساب',
    'account.signOut': 'تسجيل الخروج',
    'account.refreshUsage': 'تحديث الاستخدام',
    'account.upgradePro': 'ترقية إلى Pro',
    'account.textPrompts': 'نصوص عادية',
    'account.fullFeature': 'ميزة كاملة',
    'account.verifyEmail': 'تأكيد بريدك الإلكتروني',
    'account.verifyHint': 'أرسلنا بريد تأكيد إلى',
    'account.resendVerify': 'إعادة إرسال بريد التأكيد',
    'account.backToLogin': 'العودة لتسجيل الدخول',

    // Toast / general
    'toast.copied': 'تم النسخ!',
    'toast.saved': 'تم الحفظ.',
    'general.or': 'أو',
  },

  fr: {
    // Tabs
    'tab.create': 'Créer',
    'tab.settings': 'Paramètres',
    'tab.queues': 'Files',
    'tab.library': 'Bibliothèque',
    'tab.account': 'Compte',

    // Create tab — modes
    'mode.createImage': 'Créer Image',
    'mode.createImage.desc': 'Images IA depuis texte',
    'mode.textToVideo': 'Texte-en-Vidéo',
    'mode.textToVideo.desc': 'Vidéo depuis prompts',
    'mode.frameToVideo': 'Image-en-Vidéo',
    'mode.frameToVideo.desc': 'Début → Fin',
    'mode.ingredients': 'Ingrédients',
    'mode.ingredients.desc': 'Vidéo + images réf.',

    // Create tab — prompts
    'prompts.label': 'Prompts',
    'prompts.hint': 'Séparez les prompts par une ligne vide. Chaque bloc = une tâche.',
    'prompts.parse': 'Analyser les Prompts',
    'prompts.addQueue': 'Ajouter à la File',
    'prompts.newProject': 'Nouveau Projet',
    'prompts.thisProject': 'Ce Projet',

    // Create tab — images
    'images.shared': 'Images de Référence Partagées',
    'images.shared.hint': 'Attachées automatiquement à chaque prompt.',
    'images.character': 'Images de Personnages',
    'images.character.hint': 'Correspondance auto par nom de personnage.',
    'images.map': 'Mapper Images aux Prompts',
    'images.map.hint': 'Image 1 → prompt 1, image 2 → prompt 2, etc.',
    'images.uploadMap': 'Charger & Mapper',
    'images.frameChain': 'Chaîne d\'Images',
    'images.frameChain.hint': 'Sélectionnez N images → crée N-1 prompts. La fin de chaque prompt = début du suivant.',
    'images.uploadChain': 'Charger & Chaîner',
    'btn.add': '+ Ajouter',

    // Monitor
    'monitor.title': 'Moniteur',
    'monitor.pause': 'Pause',
    'monitor.resume': 'Reprendre',
    'monitor.stop': 'Arrêter',
    'monitor.skip': 'Passer',
    'monitor.retry': 'Réessayer',

    // Failed
    'failed.title': 'Générations Échouées',
    'failed.scanPage': 'Scanner Page',
    'failed.copyPrompts': 'Copier Prompts',
    'failed.retryAll': 'Tout Réessayer',
    'failed.manualIntervention': 'Intervention manuelle requise.',

    // Settings tab
    'settings.generation': 'Génération',
    'settings.videoModel': 'Modèle Vidéo',
    'settings.videoRatio': 'Ratio Vidéo',
    'settings.videosPerTask': 'Vidéos par tâche',
    'settings.imageModel': 'Modèle Image',
    'settings.imageRatio': 'Ratio Image',
    'settings.timing': 'Timing',
    'settings.waitMin': 'Attente min (sec)',
    'settings.waitMax': 'Attente max (sec)',
    'settings.typingMode': 'Mode Frappe',
    'settings.typingSpeed': 'Vitesse Frappe',
    'settings.behavior': 'Comportement',
    'settings.stopOnError': 'Arrêter sur erreur',
    'settings.download': 'Téléchargement',
    'settings.autoDownloadVideos': 'Auto-télécharger vidéos',
    'settings.videoResolution': 'Résolution Vidéo',
    'settings.autoDownloadImages': 'Auto-télécharger images',
    'settings.imageResolution': 'Résolution Image',
    'settings.interface': 'Interface',
    'settings.language': 'Langue',
    'settings.maintenance': 'Maintenance',
    'settings.refreshModels': 'Actualiser Modèles',
    'settings.configFolder': 'Configurer Dossier',
    'settings.clearCache': 'Vider le Cache Flow',
    'settings.clearCache.hint': 'Efface les jetons et recharge Flow.',

    // Queues tab
    'queues.title': 'Files d\'attente',
    'queues.empty': 'Aucune file pour l\'instant.',
    'queues.emptyHint': 'Ajoutez des prompts dans l\'onglet Créer.',

    // Library tab
    'library.title': 'Bibliothèque',
    'library.scan': 'Scanner Projet',
    'library.all': 'Tout',
    'library.videos': 'Vidéos',
    'library.photos': 'Photos',
    'library.search': 'Rechercher...',
    'library.selectAll': 'Tout Sélect.',
    'library.clearSel': 'Effacer',
    'library.download': 'Télécharger',
    'library.retrySelected': 'Réessayer',
    'library.upscale': 'Améliorer',
    'library.empty': 'Aucun fichier. Cliquez Scanner pour chercher.',

    // Account tab
    'account.signIn': 'Connexion',
    'account.createAccount': 'Créer un Compte',
    'account.email': 'E-mail',
    'account.password': 'Mot de passe',
    'account.btnSignIn': 'Se Connecter',
    'account.btnCreate': 'Créer le Compte',
    'account.signOut': 'Déconnexion',
    'account.refreshUsage': 'Actualiser',
    'account.upgradePro': 'Passer à Pro',
    'account.textPrompts': 'Prompts Texte',
    'account.fullFeature': 'Fonct. Complète',
    'account.verifyEmail': 'Vérifiez votre E-mail',
    'account.verifyHint': 'Un e-mail de vérification a été envoyé à',
    'account.resendVerify': 'Renvoyer l\'E-mail',
    'account.backToLogin': 'Retour à la Connexion',

    // Toast / general
    'toast.copied': 'Copié !',
    'toast.saved': 'Paramètres enregistrés.',
    'general.or': 'ou',
  },

  es: {
    // Tabs
    'tab.create': 'Crear',
    'tab.settings': 'Ajustes',
    'tab.queues': 'Colas',
    'tab.library': 'Biblioteca',
    'tab.account': 'Cuenta',

    // Create tab — modes
    'mode.createImage': 'Crear Imagen',
    'mode.createImage.desc': 'Imágenes IA desde texto',
    'mode.textToVideo': 'Texto-a-Video',
    'mode.textToVideo.desc': 'Video desde prompts',
    'mode.frameToVideo': 'Marco-a-Video',
    'mode.frameToVideo.desc': 'Inicio → Fin',
    'mode.ingredients': 'Ingredientes',
    'mode.ingredients.desc': 'Video + imágenes ref.',

    // Create tab — prompts
    'prompts.label': 'Prompts',
    'prompts.hint': 'Separa prompts con línea en blanco. Cada bloque = una tarea.',
    'prompts.parse': 'Analizar Prompts',
    'prompts.addQueue': 'Añadir a Cola',
    'prompts.newProject': 'Nuevo Proyecto',
    'prompts.thisProject': 'Este Proyecto',

    // Create tab — images
    'images.shared': 'Imágenes de Referencia',
    'images.shared.hint': 'Se adjuntan automáticamente a cada prompt.',
    'images.character': 'Imágenes de Personajes',
    'images.character.hint': 'Coincidencia automática por nombre.',
    'images.map': 'Mapear Imágenes a Prompts',
    'images.map.hint': 'Imagen 1 → prompt 1, imagen 2 → prompt 2, etc.',
    'images.uploadMap': 'Subir y Mapear',
    'images.frameChain': 'Cadena de Marcos',
    'images.frameChain.hint': 'Selecciona N imágenes → crea N-1 prompts. El final = inicio del siguiente.',
    'images.uploadChain': 'Subir y Encadenar',
    'btn.add': '+ Añadir',

    // Monitor
    'monitor.title': 'Monitor',
    'monitor.pause': 'Pausar',
    'monitor.resume': 'Reanudar',
    'monitor.stop': 'Detener',
    'monitor.skip': 'Saltar',
    'monitor.retry': 'Reintentar',

    // Failed
    'failed.title': 'Generaciones Fallidas',
    'failed.scanPage': 'Escanear Página',
    'failed.copyPrompts': 'Copiar Prompts',
    'failed.retryAll': 'Reintentar Todo',
    'failed.manualIntervention': 'Se requiere intervención manual.',

    // Settings tab
    'settings.generation': 'Generación',
    'settings.videoModel': 'Modelo de Video',
    'settings.videoRatio': 'Proporción Video',
    'settings.videosPerTask': 'Videos por tarea',
    'settings.imageModel': 'Modelo de Imagen',
    'settings.imageRatio': 'Proporción Imagen',
    'settings.timing': 'Temporización',
    'settings.waitMin': 'Espera mín (seg)',
    'settings.waitMax': 'Espera máx (seg)',
    'settings.typingMode': 'Modo Escritura',
    'settings.typingSpeed': 'Velocidad Escritura',
    'settings.behavior': 'Comportamiento',
    'settings.stopOnError': 'Detener con error',
    'settings.download': 'Descarga',
    'settings.autoDownloadVideos': 'Auto-descargar videos',
    'settings.videoResolution': 'Resolución Video',
    'settings.autoDownloadImages': 'Auto-descargar imágenes',
    'settings.imageResolution': 'Resolución Imagen',
    'settings.interface': 'Interfaz',
    'settings.language': 'Idioma',
    'settings.maintenance': 'Mantenimiento',
    'settings.refreshModels': 'Actualizar Modelos',
    'settings.configFolder': 'Configurar Carpeta',
    'settings.clearCache': 'Limpiar Caché de Flow',
    'settings.clearCache.hint': 'Limpia tokens y recarga Flow.',

    // Queues tab
    'queues.title': 'Colas',
    'queues.empty': 'No hay colas todavía.',
    'queues.emptyHint': 'Añade prompts en la pestaña Crear.',

    // Library tab
    'library.title': 'Biblioteca',
    'library.scan': 'Escanear Proyecto',
    'library.all': 'Todo',
    'library.videos': 'Videos',
    'library.photos': 'Fotos',
    'library.search': 'Buscar prompts...',
    'library.selectAll': 'Seleccionar Todo',
    'library.clearSel': 'Limpiar',
    'library.download': 'Descargar',
    'library.retrySelected': 'Reintentar',
    'library.upscale': 'Mejorar',
    'library.empty': 'No se encontraron archivos. Haz clic en Escanear.',

    // Account tab
    'account.signIn': 'Iniciar Sesión',
    'account.createAccount': 'Crear Cuenta',
    'account.email': 'Correo',
    'account.password': 'Contraseña',
    'account.btnSignIn': 'Iniciar Sesión',
    'account.btnCreate': 'Crear Cuenta',
    'account.signOut': 'Cerrar Sesión',
    'account.refreshUsage': 'Actualizar',
    'account.upgradePro': 'Mejorar a Pro',
    'account.textPrompts': 'Prompts de Texto',
    'account.fullFeature': 'Función Completa',
    'account.verifyEmail': 'Verifica tu Correo',
    'account.verifyHint': 'Enviamos un correo de verificación a',
    'account.resendVerify': 'Reenviar Verificación',
    'account.backToLogin': 'Volver al Inicio',

    // Toast / general
    'toast.copied': '¡Copiado!',
    'toast.saved': 'Ajustes guardados.',
    'general.or': 'o',
  },
};

// Map dropdown value → lang code
const langMap: Record<string, Lang> = {
  'English': 'en',
  'Spanish': 'es',
  'French': 'fr',
  'Arabic': 'ar',
};

let currentLang: Lang = 'en';

/** Get the current language */
export function getCurrentLang(): Lang {
  return currentLang;
}

/** Get a translated string by key */
export function t(key: string): string {
  return translations[currentLang]?.[key] ?? translations.en[key] ?? key;
}

/** Apply translations to all elements with data-i18n attributes */
export function applyLanguage(langValue: string): void {
  const lang = langMap[langValue] ?? 'en';
  currentLang = lang;

  // Set RTL for Arabic
  const body = document.body;
  if (lang === 'ar') {
    body.setAttribute('dir', 'rtl');
    body.classList.add('af-rtl');
  } else {
    body.setAttribute('dir', 'ltr');
    body.classList.remove('af-rtl');
  }

  // Translate all [data-i18n] elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!;
    const text = t(key);
    // Preserve child elements (like SVGs, icons) — only update text nodes
    const childNodes = el.childNodes;
    let textNodeFound = false;
    for (let i = 0; i < childNodes.length; i++) {
      if (childNodes[i].nodeType === Node.TEXT_NODE && childNodes[i].textContent?.trim()) {
        childNodes[i].textContent = text;
        textNodeFound = true;
        break;
      }
    }
    // If it's a pure text element (no mixed content)
    if (!textNodeFound && el.children.length === 0) {
      el.textContent = text;
    }
    // If there are child elements but no text node found, prepend/append text
    if (!textNodeFound && el.children.length > 0) {
      // Find the last text node (text often comes after SVGs)
      for (let i = childNodes.length - 1; i >= 0; i--) {
        if (childNodes[i].nodeType === Node.TEXT_NODE) {
          childNodes[i].textContent = ' ' + text;
          textNodeFound = true;
          break;
        }
      }
      if (!textNodeFound) {
        el.appendChild(document.createTextNode(' ' + text));
      }
    }
  });

  // Translate [data-i18n-placeholder]
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')!;
    (el as HTMLInputElement).placeholder = t(key);
  });

  // Translate [data-i18n-title]
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')!;
    el.setAttribute('title', t(key));
  });

  // Save language preference
  chrome.storage.local.set({ autoflow_ui_lang: langValue });
}

/** Load saved language on startup */
export async function initLanguage(): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.get('autoflow_ui_lang', result => {
      const saved = result.autoflow_ui_lang || 'English';
      const langSelect = document.getElementById('setting-language') as HTMLSelectElement | null;
      if (langSelect) {
        langSelect.value = saved;
      }
      applyLanguage(saved);
      resolve();
    });
  });
}
