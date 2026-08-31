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

  /**
   * "Not enough Google Flow credits to perform this action."
   *
   * Matched on the word for credits alone rather than the whole sentence.
   * The full string is long and its wording changes; the noun is the stable
   * part, and it is paired with an upgrade button before we act on it, so a
   * loose match here cannot fire on its own.
   */
  credits: [
    'credits',         // EN
    'crédits',         // FR
    'créditos',        // ES/PT
    'guthaben',        // DE
    'crediti',         // IT
    'tegoed',          // NL
    'kredi',           // TR
    'кредит',          // RU
    'クレジット',      // JA
    '크레딧',          // KO
    '积分',            // ZH
    'رصيد',           // AR
  ],

  /** "Upgrade" — the button Flow offers alongside a credit warning */
  upgrade: [
    'upgrade',         // EN
    'mettre à niveau', // FR
    'mejorar',         // ES
    'fazer upgrade',   // PT
    'upgraden',        // DE/NL
    'esegui l\'upgrade', // IT
    'yükselt',         // TR
    'обновить',        // RU
    'アップグレード',  // JA
    '업그레이드',      // KO
    '升级',            // ZH
    'ترقية',          // AR
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
    'créer ?',                     // FR (exact prompt placeholder from UI)
    'créer',                       // FR
    'qué quieres crear',           // ES
    'crear ?',                     // ES
    'crear',                       // ES
    'was möchten sie erstellen',   // DE
    'erstellen ?',                 // DE
    'erstellen',                   // DE
    'cosa vuoi creare',            // IT
    'creare ?',                    // IT
    'o que você quer criar',       // PT
    'criar ?',                     // PT
    '作成したいもの',               // JA
    '무엇을 만들고 싶으신가요',      // KO
    '想要创作什么',                // ZH
    'ماذا تريد أن تنشئ',           // AR
  ],

  /** "Clear prompt on submit" - settings panel toggle */
  clearPromptOnSubmit: [
    'clear prompt on submit',      // EN
    'effacer le prompt',           // FR
    "effacer le prompt après l'envoi", // FR (exact UI)
    'borrar el prompt',            // ES
    'prompt nach senden löschen',  // DE
    "cancella prompt all'invio",   // IT
    'limpar prompt ao enviar',     // PT
  ],

  /** "Show tile details" - settings panel toggle */
  showTileDetails: [
    'show tile details',           // EN
    'afficher les détails',        // FR
    'afficher les détails du bloc',// FR (exact UI)
    'mostrar detalles',            // ES
    'kacheldetails anzeigen',      // DE
    'mostra dettagli riquadro',    // IT
    'mostrar detalhes',            // PT
  ],

  /** "Sound on hover" - settings panel toggle (used for exclusion) */
  soundOnHover: [
    'sound on hover',              // EN
    'son au survol',               // FR
    'son en pointant',             // FR (exact UI)
    'sonido al pasar',             // ES
    'ton bei hover',               // DE
    'suono al passaggio',          // IT
    'som ao passar',               // PT
  ],

  /** "On" toggle state button */
  toggleOn: [
    'on',              // EN
    'activé',          // FR
    'activée',         // FR
    'actif',           // FR
    'activado',        // ES
    'ativado',         // PT
    'ein',             // DE
    'an',              // DE
    'attivato',        // IT
    'aan',             // NL
    'açık',            // TR
    'вкл',             // RU
    'オン',            // JA
    '켜짐',            // KO
    '사용',            // KO
    '开启',            // ZH
    '开',              // ZH
    'مفعل',            // AR
    'تشغيل',           // AR
  ],

  /** "Off" toggle state button */
  toggleOff: [
    'off',             // EN
    'désactivée',      // FR
    'désactivé',       // FR
    'désactivés',      // FR
    'desactivado',     // ES
    'desativado',      // PT
    'aus',             // DE
    'disattivato',     // IT
    'uit',             // NL
    'kapalı',          // TR
    'выкл',            // RU
    'オフ',            // JA
    '꺼짐',            // KO
    '사용 안함',       // KO
    '关闭',            // ZH
    '关',              // ZH
    'معطل',            // AR
    'إيقاف',           // AR
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

  /** "Video" media-type tab in the settings menu.
      CRITICAL: without this key the engine cannot switch Image->Video on
      non-English UIs — FR "Vidéo" ≠ EN "video" in a substring match. */
  video: [
    'Video',           // EN / DE / IT / TR
    'Vidéo',           // FR
    'Vídeo',           // ES / PT
    'Видео',           // RU
    '動画',            // JA
    '동영상',          // KO
    '영상',            // KO (short form)
    '视频',            // ZH
  ],

  /** "Ingredients" creation-type tab (video mode) */
  ingredients: [
    'Ingredients',     // EN
    'Ingrédients',     // FR
    'Ingredientes',    // ES / PT
    'Zutaten',         // DE
    'Ingredienti',     // IT
    'Malzemeler',      // TR
    'Ингредиенты',     // RU
    '素材',            // JA / ZH
    '材料',            // JA (alt)
    '재료',            // KO
    '配料',            // ZH (alt)
  ],

  /** "Frames" creation-type tab (video mode) */
  frames: [
    'Frames',          // EN / DE
    'Images',          // FR (exact Frames tab from UI)
    'Cadres',          // FR (alt)
    'Fotogramas',      // ES / PT
    'Imágenes',        // ES (alt)
    'Imagens',         // PT (alt)
    'Fotogrammi',      // IT
    'Immagini',        // IT (alt)
    'Kareler',         // TR
    'Кадры',           // RU
    'Изображения',     // RU (alt)
    'フレーム',        // JA
    '画像',            // JA (alt)
    '프레임',          // KO
    '이미지',          // KO (alt)
    '首尾帧',          // ZH
    '帧',              // ZH (alt)
    '图像',            // ZH (alt)
    'الإطارات',        // AR
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
    'failed',                  // EN (bare)
    'échec de la génération',  // FR
    'échoué',                  // FR (bare)
    'generación fallida',      // ES
    'fallido',                 // ES (bare)
    'geração falhou',          // PT
    'falhou',                  // PT (bare)
    'generierung fehlgeschlagen', // DE
    'fehlgeschlagen',          // DE (bare)
    'generazione fallita',     // IT
    'fallito',                 // IT (bare)
    'mislukt',                 // NL
    'başarısız',               // TR
    'ошибка генерации',        // RU
    'не удалось',              // RU
    '生成に失敗',              // JA
    '생성 실패',               // KO
    '生成失败',                // ZH
    'فشل التوليد',            // AR
  ],

  tryAgain: [
    'try again',       // EN
    'réessayer',       // FR
    'intentar de nuevo',// ES
    'tente novamente', // PT
    'erneut versuchen',// DE
    'riprova',         // IT
    'opnieuw proberen',// NL
    'tekrar dene',     // TR
    'попробовать снова', // RU
    'もう一度お試しください', // JA
    '다시 시도',       // KO
    '重试',            // ZH
    'حاول مرة أخرى',   // AR
  ],

  /** "This generation was cancelled" - cancelled tile detection */
  generationCancelled: [
    'was cancelled',               // EN
    'was canceled',                // EN (US spelling)
    'generation was cancelled',    // EN (full)
    'a été annulée',               // FR
    'génération annulée',          // FR
    'fue cancelada',               // ES
    'generación cancelada',        // ES
    'foi cancelada',               // PT
    'geração cancelada',           // PT
    'wurde abgebrochen',           // DE
    'generierung abgebrochen',     // DE
    'è stata annullata',           // IT
    'generazione annullata',       // IT
    'is geannuleerd',              // NL
    'generatie geannuleerd',       // NL
    'iptal edildi',                // TR
    'oluşturma iptal edildi',      // TR
    'была отменена',               // RU
    'генерация отменена',          // RU
    'キャンセルされました',         // JA
    '취소되었습니다',               // KO
    '已取消',                      // ZH
    '生成已取消',                  // ZH
    'تم إلغاؤها',                 // AR
  ],

  /** "You were not charged" - appears on cancelled tiles */
  notCharged: [
    'not been charged',            // EN
    'not charged',                 // EN
    'were not charged',            // EN
    "n'avez pas été facturé",      // FR
    'no se te ha cobrado',         // ES
    'não foi cobrado',             // PT
    'nicht berechnet',             // DE
    'non è stato addebitato',      // IT
    'niet in rekening gebracht',   // NL
    'ücretlendirilmediniz',        // TR
    'не было списано',             // RU
    '課金されていません',          // JA
    '요금이 청구되지 않았습니다',   // KO
    '未收费',                      // ZH
    'لم يتم تحصيل رسوم',         // AR
  ],

  /** "Start" frame slot label */
  start: [
    'Start',           // EN
    'Début',           // FR
    'Inicio',          // ES
    'Início',          // PT
    'Start',           // DE / NL
    'Inizio',          // IT
    'Başlangıç',       // TR
    'Начало',          // RU
    '開始',            // JA
    '시작',            // KO
    '开始',            // ZH
    'بداية',          // AR
  ],

  /** "End" frame slot label */
  end: [
    'End',             // EN
    'Fin',             // FR / ES
    'Fim',             // PT
    'Ende',            // DE
    'Fine',            // IT
    'Einde',           // NL
    'Bitiş',           // TR
    'Конец',           // RU
    '終了',            // JA
    '끝',              // KO
    '结束',            // ZH
    'نهاية',          // AR
  ],

  /** "Create" / generate action button */
  create: [
    'Create',          // EN
    'Créer',           // FR
    'Crear',           // ES
    'Criar',           // PT
    'Erstellen',       // DE
    'Crea',            // IT
    'Maken',           // NL
    'Oluştur',         // TR
    'Создать',         // RU
    '作成',            // JA
    '만들기',          // KO
    '创建',            // ZH
    'إنشاء',          // AR
  ],

  /** "Add to Prompt" confirm button in asset/voice dialogs */
  addToPrompt: [
    'Add to Prompt',           // EN
    'Ajouter au prompt',       // FR
    'Añadir al prompt',        // ES
    'Adicionar ao prompt',     // PT
    'Zum Prompt hinzufügen',   // DE
    'Aggiungi al prompt',      // IT
    'Toevoegen aan prompt',    // NL
    'İsteme ekle',             // TR
    'Добавить в промпт',       // RU
    'プロンプトに追加',        // JA
    '프롬프트에 추가',         // KO
    '添加到提示',              // ZH
  ],

  /** "Send" / "Generate" / "Run" — generate button aria-labels */
  send: [
    'Send',            // EN
    'Generate',        // EN
    'Run',             // EN
    'Submit',          // EN
    'Envoyer',         // FR
    'Générer',         // FR
    'Enviar',          // ES / PT
    'Generar',         // ES
    'Gerar',           // PT
    'Senden',          // DE
    'Generieren',      // DE
    'Invia',           // IT
    'Genera',          // IT
    'Verzenden',       // NL
    'Genereren',       // NL
    'Gönder',          // TR
    'Oluştur',         // TR
    'Отправить',       // RU
    'Сгенерировать',   // RU
    '送信',            // JA
    '生成',            // JA / ZH
    '전송',            // KO
    '생성',            // KO
    '发送',            // ZH
    'إرسال',          // AR
    'إنشاء',          // AR
  ],

  /** "Upload" tab in asset dialogs */
  upload: [
    'Upload',          // EN
    'Télécharger',     // FR
    'Importer',        // FR (alt)
    'Subir',           // ES
    'Carregar',        // PT
    'Hochladen',       // DE
    'Carica',          // IT
    'Uploaden',        // NL
    'Yükle',           // TR
    'Загрузить',       // RU
    'アップロード',    // JA
    '업로드',          // KO
    '上传',            // ZH
    'تحميل',          // AR
  ],

  /** "Queued" generation status */
  queued: [
    'queued',          // EN
    'en file',         // FR
    'en cola',         // ES
    'na fila',         // PT
    'warteschlange',   // DE
    'in coda',         // IT
    'in wachtrij',     // NL
    'sırada',          // TR
    'в очереди',       // RU
    'キューに入っています', // JA
    '대기 중',         // KO
    '排队中',          // ZH
  ],

  /** "Preparing" / "Creating video" / "Almost finished" generation status */
  preparing: [
    'preparing',       // EN
    'creating video',  // EN
    'almost finished', // EN
    'is preparing',    // EN
    'préparation',     // FR
    'création de la vidéo', // FR
    'presque terminé', // FR
    'preparando',      // ES / PT
    'creando vídeo',   // ES
    'casi terminado',  // ES
    'criando vídeo',   // PT
    'quase pronto',    // PT
    'wird vorbereitet',// DE
    'video wird erstellt', // DE
    'fast fertig',     // DE
    'preparazione',    // IT
    'creazione video', // IT
    'quasi finito',    // IT
    'voorbereiden',    // NL
    'hazırlanıyor',    // TR
    'подготовка',      // RU
    'создание видео',  // RU
    'почти готово',    // RU
    '準備中',          // JA
    '동영상 생성 중',  // KO
    '준비 중',         // KO
    '准备中',          // ZH
    '正在创建视频',    // ZH
  ],

  /** "Agent" toggle button */
  agent: [
    'Agent',           // EN / FR / DE / IT / ES / PT / NL / TR
    'Агент',           // RU
    'エージェント',    // JA
    '에이전트',        // KO
    '代理',            // ZH
    'وكيل',           // AR
  ],

  /** "Download" menu item */
  download: [
    'download',        // EN
    'télécharger',     // FR
    'descargar',       // ES
    'baixar',          // PT
    'herunterladen',   // DE
    'scarica',         // IT
    'downloaden',      // NL
    'indir',           // TR
    'скачать',         // RU
    'ダウンロード',    // JA
    '다운로드',        // KO
    '下载',            // ZH
    'تنزيل',          // AR
  ],

  /** "Delete" button */
  deleteTile: [
    'delete',          // EN
    'supprimer',       // FR
    'eliminar',        // ES
    'excluir',         // PT
    'löschen',         // DE
    'elimina',         // IT
    'verwijderen',     // NL
    'sil',             // TR
    'удалить',         // RU
    '削除',            // JA
    '삭제',            // KO
    '删除',            // ZH
    'حذف',            // AR
  ],

  /** "Upscaling" toast message */
  upscaling: [
    'upscaling',       // EN
    'upscale',         // EN
    'mise à l\'échelle', // FR
    'amélioration',    // FR
    'escalado',        // ES
    'redimensionando', // PT
    'hochskalierung',  // DE
    'upscaling',       // IT / NL
    'ölçekleme',       // TR
    'масштабирование', // RU
    'アップスケーリング', // JA
    '업스케일링',      // KO
    '升级',            // ZH
  ],

  /** "Downloading" toast message */
  downloading: [
    'downloading',     // EN
    'téléchargement',  // FR
    'descargando',     // ES
    'baixando',        // PT
    'wird heruntergeladen', // DE
    'download in corso', // IT
    'downloaden',      // NL
    'indiriliyor',     // TR
    'загрузка',        // RU
    'ダウンロード中',  // JA
    '다운로드 중',     // KO
    '下载中',          // ZH
  ],

  /** Safety / policy violation detection strings */
  violate: [
    'violate',         // EN
    'violates',        // EN
    'violation',       // EN
    'viole',           // FR
    'violation',       // FR
    'viola',           // ES / IT
    'violação',        // PT
    'verstoß',         // DE
    'verstößt',        // DE
    'schending',       // NL
    'ihlal',           // TR
    'нарушение',       // RU
    'нарушает',        // RU
    '違反',            // JA / ZH
    '위반',            // KO
    'انتهاك',         // AR
  ],

  /** "Unable to generate" / "Something went wrong" error text */
  unableToGenerate: [
    'unable to generate',      // EN
    'something went wrong',    // EN
    'oops',                    // EN
    'impossible de générer',   // FR
    'un problème est survenu', // FR
    'no se puede generar',     // ES
    'algo salió mal',          // ES
    'não foi possível gerar',  // PT
    'algo deu errado',         // PT
    'generierung nicht möglich', // DE
    'etwas ist schiefgelaufen', // DE
    'impossibile generare',    // IT
    'qualcosa è andato storto', // IT
    'kan niet genereren',      // NL
    'oluşturulamıyor',         // TR
    'bir sorun oluştu',        // TR
    'невозможно сгенерировать', // RU
    'что-то пошло не так',     // RU
    '生成できません',          // JA
    '생성할 수 없습니다',      // KO
    '无法生成',                // ZH
    '出了点问题',              // ZH
  ],

  /** "Blocked" / "Rejected" safety outcome */
  blocked: [
    'blocked',         // EN
    'rejected',        // EN
    'bloqué',          // FR
    'rejeté',          // FR
    'bloqueado',       // ES / PT
    'rechazado',       // ES
    'rejeitado',       // PT
    'blockiert',       // DE
    'abgelehnt',       // DE
    'bloccato',        // IT
    'rifiutato',       // IT
    'geblokkeerd',     // NL
    'engellendi',      // TR
    'заблокировано',   // RU
    'отклонено',       // RU
    'ブロック',        // JA
    '차단됨',          // KO
    '거부됨',          // KO
    '已屏蔽',          // ZH
    '已拒绝',          // ZH
    'محظور',          // AR
  ],

  /** "Content policy" — policy violation text */
  contentPolicy: [
    'content policy',          // EN
    'politique de contenu',    // FR
    'règles relatives au contenu', // FR (alt)
    'política de contenido',   // ES
    'política de conteúdo',    // PT
    'inhaltsrichtlinie',       // DE
    'politica sui contenuti',  // IT
    'inhoudsbeleid',           // NL
    'içerik politikası',       // TR
    'политика контента',       // RU
    'コンテンツポリシー',      // JA
    '콘텐츠 정책',             // KO
    '内容政策',                // ZH
    'سياسة المحتوى',          // AR
  ],

  /** "Try a different prompt" error text */
  tryDifferentPrompt: [
    'try a different prompt',          // EN
    'please try a different prompt',   // EN
    'essayez un autre prompt',         // FR
    'essayez une autre requête',       // FR (alt)
    'prueba con otro mensaje',         // ES
    'tente um prompt diferente',       // PT
    'versuchen sie einen anderen prompt', // DE
    'prova un prompt diverso',         // IT
    'probeer een andere prompt',       // NL
    'farklı bir istem deneyin',        // TR
    'попробуйте другой промпт',        // RU
    '別のプロンプトを試してください', // JA
    '다른 프롬프트를 시도하세요',      // KO
    '请尝试不同的提示',               // ZH
  ],

  /** Safety/policy keywords: prominent people, minors, harmful, inappropriate, prohibited */
  safetyError: [
    'prominent people',    // EN
    'minors',              // EN
    'harmful content',     // EN
    'inappropriate',       // EN
    'prohibited',          // EN
    'safety',              // EN
    'personnalités',       // FR
    'mineurs',             // FR
    'contenu nuisible',    // FR
    'inapproprié',         // FR
    'interdit',            // FR
    'sécurité',            // FR
    'personas prominentes',// ES
    'menores',             // ES
    'contenido dañino',    // ES
    'inapropiado',         // ES
    'prohibido',           // ES
    'seguridad',           // ES
    'personaggi pubblici', // IT
    'minorenni',           // IT
    'contenuto dannoso',   // IT
    'proibito',            // IT
    'prominente personen', // DE
    'minderjährige',       // DE
    'schädliche inhalte',  // DE
    'unangemessen',        // DE
    'verboten',            // DE
    'sicherheit',          // DE
    'известные люди',      // RU
    'несовершеннолетние',  // RU
    'вредный контент',     // RU
    'запрещено',           // RU
    '有名人',              // JA
    '未成年者',            // JA
    '有害なコンテンツ',    // JA
    '禁止',               // JA / ZH
    '유명인',              // KO
    '미성년자',            // KO
    '유해한 콘텐츠',       // KO
    '금지',                // KO
    '名人',                // ZH
    '未成年人',            // ZH
    '有害内容',            // ZH
  ],

  /** Rate limiting / quota errors */
  quotaError: [
    'too quickly',             // EN
    'queue full',              // EN
    'limit reached',           // EN
    'exhausted',               // EN
    'quota',                   // EN / FR / DE / IT
    'unusual activity',        // EN
    'trop rapidement',         // FR
    "file d'attente pleine",   // FR
    'limite atteinte',         // FR
    'activité inhabituelle',   // FR
    'demasiado rápido',        // ES
    'cola llena',              // ES
    'límite alcanzado',        // ES
    'actividad inusual',       // ES
    'muito rapidamente',       // PT
    'fila cheia',              // PT
    'limite atingido',         // PT
    'atividade incomum',       // PT
    'zu schnell',              // DE
    'warteschlange voll',      // DE
    'limit erreicht',          // DE
    'ungewöhnliche aktivität', // DE
    'troppo velocemente',      // IT
    'coda piena',              // IT
    'limite raggiunto',        // IT
    'attività insolita',       // IT
    'te snel',                 // NL
    'çok hızlı',              // TR
    'sıra dolu',              // TR
    'слишком быстро',          // RU
    'очередь заполнена',       // RU
    'лимит достигнут',         // RU
  ],

  /** Generic error text: "error", "cannot", "capacity", "unavailable" */
  genericError: [
    'error',               // EN / ES / IT
    'cannot',              // EN
    'capacity',            // EN
    'unavailable',         // EN
    'erreur',              // FR
    'impossible',          // FR
    'capacité',            // FR
    'indisponible',        // FR
    'no se puede',         // ES
    'capacidad',           // ES
    'no disponible',       // ES
    'erro',                // PT
    'não é possível',      // PT
    'capacidade',          // PT
    'indisponível',        // PT
    'fehler',              // DE
    'nicht möglich',       // DE
    'kapazität',           // DE
    'nicht verfügbar',     // DE
    'errore',              // IT
    'non disponibile',     // IT
    'fout',                // NL
    'hata',                // TR
    'ошибка',              // RU
    'невозможно',          // RU
    'недоступно',          // RU
    'エラー',              // JA
    '오류',                // KO
    '错误',                // ZH
    'خطأ',                // AR
  ],
} as const;

/**
 * Build a CSS selector string that matches an aria-label
 * in any known language for the given key.
 */
export function ariaLabelSelector(key: keyof typeof FLOW_STRINGS): string {
  return FLOW_STRINGS[key]
    .map(t => `[aria-label="${t}"]`)
    .join(', ');
}

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
 * Build a CSS selector for both aria-label AND placeholder matching
 * for search inputs in all known languages.
 */
export function searchInputSelector(): string {
  return '#add-menu-input, ' +
    FLOW_STRINGS.search
      .flatMap(t => [
        `input[aria-label*="${t}"]`,
        `input[aria-label*="${capitalize(t)}"]`,
        `input[placeholder*="${t}"]`,
        `input[placeholder*="${capitalize(t)}"]`,
      ])
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
    '閉じる', '戻る', '完了',                     // JA
    '닫기', '뒤로', '완료',                       // KO
    '关闭', '返回', '完成',                       // ZH
    'إغلاق', 'رجوع', 'تم',                      // AR
  ];
  return labels.map(l => `button[aria-label="${l}"]`).join(', ');
}

/**
 * Check if text looks like an error/noise string in any language.
 * Combines multiple error-detection keys into one convenience check.
 */
export function isFlowErrorText(text: string): boolean {
  return matchesFlowText(text, 'generationFailed') ||
    matchesFlowText(text, 'tryAgain') ||
    matchesFlowText(text, 'notCharged') ||
    matchesFlowText(text, 'unableToGenerate') ||
    matchesFlowText(text, 'violate') ||
    matchesFlowText(text, 'blocked') ||
    matchesFlowText(text, 'contentPolicy') ||
    matchesFlowText(text, 'tryDifferentPrompt');
}

/**
 * Check if text indicates a safety/policy violation in any language.
 */
export function isSafetyViolation(text: string): boolean {
  return matchesFlowText(text, 'violate') ||
    matchesFlowText(text, 'blocked') ||
    matchesFlowText(text, 'contentPolicy') ||
    matchesFlowText(text, 'safetyError');
}

/**
 * Check if text indicates rate limiting / quota exhaustion in any language.
 */
export function isQuotaError(text: string): boolean {
  return matchesFlowText(text, 'quotaError');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
