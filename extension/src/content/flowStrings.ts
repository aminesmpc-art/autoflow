/**
 * flowStrings.ts — All known Google Flow UI text translations.
 *
 * Google Flow translates button labels, placeholders, etc. based on
 * the user's browser language. This file provides all known translations
 * so the extension can detect UI elements regardless of language.
 *
 * HOW TO ADD A NEW LANGUAGE:
 *   1. Open Google Flow in the target language
 *   2. Note the translated text for each key below
 *   3. Add the translation to the corresponding array
 *   4. Rebuild the extension
 */

/** All known translations for each UI string */
export const FLOW_STRINGS = {
  /** Search input placeholder in asset/voice dialogs */
  search: [
    'search',        // EN
    'rechercher',    // FR
    'buscar',        // ES
    'pesquisar',     // PT
    'suchen',        // DE
    'cerca',         // IT
    'zoeken',        // NL
    'ara',           // TR
    'поиск',         // RU
    '検索',          // JA
    '검색',          // KO
    '搜索',          // ZH
    'بحث',          // AR
  ],

  /** "Done" / "Close" button in detail view */
  done: [
    'done',          // EN
    'close',         // EN
    'terminé',       // FR
    'fermer',        // FR
    'hecho',         // ES
    'listo',         // ES
    'cerrar',        // ES
    'concluído',     // PT
    'fechar',        // PT
    'fertig',        // DE
    'schließen',     // DE
    'fatto',         // IT
    'chiudi',        // IT
    'gereed',        // NL
    'sluiten',       // NL
    'bitti',         // TR
    'kapat',         // TR
    'готово',        // RU
    'закрыть',       // RU
    '完了',          // JA
    '閉じる',        // JA
    '완료',          // KO
    '닫기',          // KO
    '完成',          // ZH
    '关闭',          // ZH
    'تم',           // AR
    'إغلاق',        // AR
  ],

  /** "New project" button on homepage */
  newProject: [
    'new project',       // EN
    'nouveau projet',    // FR
    'nuevo proyecto',    // ES
    'novo projeto',      // PT
    'neues projekt',     // DE
    'nuovo progetto',    // IT
    'nieuw project',     // NL
    'yeni proje',        // TR
    'новый проект',      // RU
    '新しいプロジェクト', // JA
    '새 프로젝트',       // KO
    '新建项目',          // ZH
    'مشروع جديد',       // AR
  ],

  /** "Show history" button in detail view */
  showHistory: [
    'show history',          // EN
    "afficher l'historique", // FR
    'mostrar historial',     // ES
    'mostrar histórico',     // PT
    'verlauf anzeigen',      // DE
    'mostra cronologia',     // IT
    'geschiedenis tonen',    // NL
    'geçmişi göster',        // TR
    'показать историю',      // RU
    '履歴を表示',            // JA
    '기록 표시',             // KO
    '显示历史记录',          // ZH
    'عرض السجل',            // AR
  ],

  /** "Hide history" button in detail view */
  hideHistory: [
    'hide history',          // EN
    "masquer l'historique",  // FR
    'ocultar historial',     // ES
    'ocultar histórico',     // PT
    'verlauf ausblenden',    // DE
    'nascondi cronologia',   // IT
    'geschiedenis verbergen',// NL
    'geçmişi gizle',        // TR
    'скрыть историю',        // RU
    '履歴を非表示',          // JA
    '기록 숨기기',           // KO
    '隐藏历史记录',          // ZH
    'إخفاء السجل',          // AR
  ],

  /** "Retry" button on failed tiles */
  retry: [
    'retry',           // EN
    'réessayer',       // FR
    'reintentar',      // ES
    'tentar novamente',// PT
    'wiederholen',     // DE
    'riprova',         // IT
    'opnieuw proberen',// NL
    'tekrar dene',     // TR
    'повторить',       // RU
    '再試行',          // JA
    '다시 시도',       // KO
    '重试',            // ZH
    'إعادة المحاولة', // AR
  ],

  /** "Grid" view mode tab */
  grid: [
    'grid',            // EN
    'grille',          // FR
    'cuadrícula',      // ES
    'grade',           // PT
    'raster',          // DE
    'griglia',         // IT
    'raster',          // NL
    'ızgara',          // TR
    'сетка',           // RU
    'グリッド',        // JA
    '그리드',          // KO
    '网格',            // ZH
    'شبكة',           // AR
  ],

  /** "Batch" view mode tab */
  batch: [
    'batch',           // EN
    'lot',             // FR
    'lote',            // ES
    'lote',            // PT
    'stapel',          // DE
    'batch',           // IT
    'batch',           // NL
    'toplu',           // TR
    'пакет',           // RU
    'バッチ',          // JA
    '배치',            // KO
    '批量',            // ZH
    'دفعة',           // AR
  ],

  /** Prompt input placeholder keywords */
  prompt: [
    'prompt',          // EN
    'describe',        // EN
    'enter',           // EN
    'create',          // EN
    'what do you want',// EN
    'invite',          // FR
    'décrire',         // FR
    'créer',           // FR
    'que souhaitez',   // FR
    'mensaje',         // ES
    'describir',       // ES
    'crear',           // ES
    'eingabeaufforderung', // DE
    'beschreiben',     // DE
    'erstellen',       // DE
    'プロンプト',      // JA
    'プロンプトを入力', // JA
    '提示',            // ZH
    '描述',            // ZH
  ],

  /** "What happens next?" - extend prompt label */
  whatHappensNext: [
    'what happens next',           // EN
    'que se passe-t-il ensuite',   // FR
    'qué sucede a continuación',   // ES
    'was passiert als nächstes',   // DE
    'cosa succede dopo',           // IT
    'o que acontece a seguir',     // PT
    'wat gebeurt er daarna',       // NL
    'bundan sonra ne olacak',      // TR
    'что будет дальше',            // RU
    '次に何が起こる',              // JA
  ],

  /** "What do you want to create" - main prompt label */
  whatDoYouWantToCreate: [
    'what do you want to create',  // EN
    'que voulez-vous créer',       // FR
    'qué quieres crear',           // ES
    'was möchten sie erstellen',   // DE
    'cosa vuoi creare',            // IT
    'o que você quer criar',       // PT
  ],

  /** "Clear prompt on submit" - settings panel toggle */
  clearPromptOnSubmit: [
    'clear prompt on submit',      // EN
    'effacer le prompt',           // FR
    'borrar el prompt',            // ES
    'prompt nach senden löschen',  // DE
    "cancella prompt all'invio",   // IT
    'limpar prompt ao enviar',     // PT
  ],

  /** "Show tile details" - settings panel toggle */
  showTileDetails: [
    'show tile details',           // EN
    'afficher les détails',        // FR
    'mostrar detalles',            // ES
    'kacheldetails anzeigen',      // DE
    'mostra dettagli riquadro',    // IT
    'mostrar detalhes',            // PT
  ],

  /** "Sound on hover" - settings panel toggle (used for exclusion) */
  soundOnHover: [
    'sound on hover',              // EN
    'son au survol',               // FR
    'sonido al pasar',             // ES
    'ton bei hover',               // DE
    'suono al passaggio',          // IT
    'som ao passar',               // PT
  ],

  /** "View Tile Grid Settings" - trigger button label */
  viewTileGridSettings: [
    'view tile grid settings',     // EN
    'afficher les paramètres',     // FR
    'ver configuración',           // ES
    'rastereinstellungen',         // DE
    'impostazioni griglia',        // IT
  ],

  /** "Retry" button span text (exact) */
  retryExact: [
    'Retry',           // EN
    'Réessayer',       // FR
    'Reintentar',      // ES
    'Tentar novamente',// PT
    'Wiederholen',     // DE
    'Riprova',         // IT
    'Opnieuw proberen',// NL
    'Tekrar dene',     // TR
    'Повторить',       // RU
    '再試行',          // JA
    '다시 시도',       // KO
    '重试',            // ZH
  ],

  /** "Reuse Prompt" button text */
  reusePrompt: [
    'Reuse Prompt',         // EN
    'Réutiliser le prompt', // FR
    'Reutilizar prompt',    // ES
    'Reutilizar prompt',    // PT
    'Prompt wiederverwenden',// DE
    'Riutilizza prompt',    // IT
  ],

  /** Ingredient menu tab names: "Voice", "Image", "Character" */
  voice: [
    'Voice',           // EN
    'Voix',            // FR
    'Voz',             // ES
    'Voz',             // PT
    'Stimme',          // DE
    'Voce',            // IT
    'Ses',             // TR
    'Голос',           // RU
    '音声',            // JA
    '음성',            // KO
    '语音',            // ZH
  ],

  image: [
    'Image',           // EN
    'Image',           // FR
    'Imagen',          // ES
    'Imagem',          // PT
    'Bild',            // DE
    'Immagine',        // IT
    'Görsel',          // TR
    'Изображение',     // RU
    '画像',            // JA
    '이미지',          // KO
    '图片',            // ZH
  ],

  character: [
    'Character',       // EN
    'Personnage',      // FR
    'Personaje',       // ES
    'Personagem',      // PT
    'Charakter',       // DE
    'Personaggio',     // IT
    'Karakter',        // TR
    'Персонаж',        // RU
    'キャラクター',    // JA
    '캐릭터',          // KO
    '角色',            // ZH
  ],

  /** "Recently" (used to skip recently-used buttons in upload dialogs) */
  recently: [
    'recently',        // EN
    'récemment',       // FR
    'reciente',        // ES
    'recentemente',    // PT
    'kürzlich',        // DE
    'recentemente',    // IT
    'son kullanılan',  // TR
    'недавно',         // RU
  ],

  /** Error detection strings in tile text */
  generationFailed: [
    'generation failed',       // EN
    'échec de la génération',  // FR
    'generación fallida',      // ES
    'geração falhou',          // PT
    'generierung fehlgeschlagen', // DE
  ],

  tryAgain: [
    'try again',       // EN
    'réessayer',       // FR
    'intentar de nuevo',// ES
    'tente novamente', // PT
    'erneut versuchen',// DE
  ],
} as const;

/**
 * Build a CSS selector string that matches an input placeholder
 * in any known language for the given key.
 *
 * Example: placeholderSelector('search')
 * → 'input[placeholder*="Search"], input[placeholder*="Rechercher"], ...'
 */
export function placeholderSelector(key: keyof typeof FLOW_STRINGS): string {
  return FLOW_STRINGS[key]
    .map(t => `input[placeholder*="${t}"], input[placeholder*="${capitalize(t)}"]`)
    .join(', ');
}

/**
 * Check if a text string matches any known translation for a key.
 * Case-insensitive comparison.
 */
export function matchesFlowText(text: string, key: keyof typeof FLOW_STRINGS): boolean {
  const lower = text.trim().toLowerCase();
  return FLOW_STRINGS[key].some(t => lower.includes(t.toLowerCase()));
}

/**
 * Check if a text string exactly equals any known translation for a key.
 * Case-insensitive comparison.
 */
export function exactMatchFlowText(text: string, key: keyof typeof FLOW_STRINGS): boolean {
  const lower = text.trim().toLowerCase();
  return FLOW_STRINGS[key].some(t => lower === t.toLowerCase());
}

/** Build aria-label selectors for Close/Back buttons in all languages */
export function closeAriaSelectors(): string {
  const labels = [
    'Close', 'Back', 'Done',                    // EN
    'Fermer', 'Retour', 'Terminé',               // FR
    'Cerrar', 'Atrás', 'Hecho',                  // ES
    'Fechar', 'Voltar', 'Concluído',             // PT
    'Schließen', 'Zurück', 'Fertig',             // DE
    'Chiudi', 'Indietro', 'Fatto',               // IT
    'Sluiten', 'Terug', 'Gereed',                // NL
    'Kapat', 'Geri', 'Bitti',                    // TR
    'Закрыть', 'Назад', 'Готово',                // RU
  ];
  return labels.map(l => `button[aria-label="${l}"]`).join(', ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
