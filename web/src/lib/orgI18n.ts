export type Lang = 'fr' | 'ar';

const translations: Record<string, Record<Lang, string>> = {
  // Navigation
  'nav.organizations': { fr: 'Cabinet', ar: 'المكتب' },
  'nav.dashboard': { fr: 'Tableau de bord', ar: 'لوحة التحكم' },
  'nav.clients': { fr: 'Clients', ar: 'العملاء' },
  'nav.settings': { fr: 'Paramètres', ar: 'الإعدادات' },
  'nav.logout': { fr: 'Déconnexion', ar: 'تسجيل الخروج' },

  // Auth
  'auth.login': { fr: 'Connexion', ar: 'تسجيل الدخول' },
  'auth.email': { fr: 'Email', ar: 'البريد الإلكتروني' },
  'auth.password': { fr: 'Mot de passe', ar: 'كلمة المرور' },
  'auth.login_btn': { fr: 'Se connecter', ar: 'تسجيل الدخول' },
  'auth.change_password': { fr: 'Changer le mot de passe', ar: 'تغيير كلمة المرور' },
  'auth.new_password': { fr: 'Nouveau mot de passe', ar: 'كلمة المرور الجديدة' },
  'auth.wrong_credentials': { fr: 'Identifiants incorrects', ar: 'بيانات اعتماد غير صحيحة' },
  'auth.min_12_chars': { fr: '12 caractères minimum', ar: '12 حرفًا على الأقل' },

  // Dashboard
  'dash.my_clients': { fr: 'Mes clients', ar: 'عملائي' },
  'dash.all_dossiers': { fr: 'Tous les dossiers', ar: 'جميع الملفات' },
  'dash.by_comptable': { fr: 'Par comptable', ar: 'حسب المحاسب' },
  'dash.global_view': { fr: 'Vue globale', ar: 'عرض عام' },
  'dash.progress': { fr: 'Avancement', ar: 'التقدم' },
  'dash.tasks_remaining': { fr: 'tâches restantes', ar: 'المهام المتبقية' },
  'dash.no_clients': { fr: 'Aucun client assigné', ar: 'لا عملاء معيّنين' },
  'dash.blocked': { fr: 'Bloqué client', ar: 'محجوز لدى العميل' },
  'dash.open_dossier': { fr: 'Ouvrir le dossier', ar: 'فتح الملف' },
  'dash.since_days': { fr: 'depuis {n} jours', ar: 'منذ {n} أيام' },

  // Status — 3 statuts visibles (En cours supprimé)
  'status.cloture': { fr: 'Clôturé', ar: 'مغلق' },
  'status.a_faire': { fr: 'À faire', ar: 'للقيام' },
  'status.fait': { fr: 'Fait', ar: 'منجز' },
  'status.bloque_client': { fr: 'Bloqué client', ar: 'محجوز لدى العميل' },
  'status.en_cours': { fr: 'À faire', ar: 'للقيام' },

  // Dossier
  'dossier.checklist': { fr: 'Checklist des tâches', ar: 'قائمة المهام' },
  'dossier.documents': { fr: 'Documents attendus', ar: 'المستندات المطلوبة' },
  'dossier.notes': { fr: 'Notes internes', ar: 'ملاحظات داخلية' },
  'dossier.timeline': { fr: 'Chronologie', ar: 'التسلسل الزمني' },
  'dossier.close': { fr: 'Clôturer l\'exercice', ar: 'إغلاق الفترة' },
  'dossier.closing_disabled': { fr: 'Clôture impossible — tâches restantes', ar: 'لا يمكن الإغلاق — مهام متبقية' },
  'dossier.open_next': { fr: 'Ouvrir l\'exercice suivant', ar: 'فتح الفترة التالية' },
  'dossier.add_note': { fr: 'Ajouter une note...', ar: 'إضافة ملاحظة...' },
  'dossier.mark_received': { fr: 'Marquer reçu', ar: 'تحديد كمستلم' },
  'dossier.manual_received': { fr: 'Reçu hors plateforme (WhatsApp/email)', ar: 'مستلم خارج المنصة' },
  'dossier.add_document': { fr: 'Ajouter un document', ar: 'إضافة وثيقة' },
  'dossier.doc_label': { fr: 'Libellé du document...', ar: 'تسمية الوثيقة...' },
  'dossier.doc_url': { fr: 'Lien (Drive, WhatsApp...) — facultatif', ar: 'رابط (درايف، واتساب...) — اختياري' },
  'dossier.open_link': { fr: 'Ouvrir', ar: 'فتح' },
  'dossier.edit_link': { fr: 'Modifier le lien', ar: 'تعديل الرابط' },
  'dossier.delete_doc': { fr: 'Supprimer le document', ar: 'حذف الوثيقة' },
  'dossier.no_task_docs': { fr: 'Aucun document', ar: 'لا وثائق' },
  'dossier.save': { fr: 'Enregistrer', ar: 'حفظ' },
  'dossier.attach_file': { fr: 'Joindre PDF/Image', ar: 'إرفاق PDF/صورة' },
  'dossier.open_file': { fr: 'Ouvrir le fichier', ar: 'فتح الملف' },
  'dossier.year': { fr: 'Année', ar: 'السنة' },
  'dossier.filter_all': { fr: 'Tous', ar: 'الكل' },
  'dossier.filter_annual': { fr: 'Annuel', ar: 'سنوي' },
  'dossier.month_tasks': { fr: 'tâches', ar: 'مهام' },
  'dossier.year_overview': { fr: 'Vue annuelle', ar: 'عرض سنوي' },
  'dossier.empty_month': { fr: 'Aucune tâche ce mois', ar: 'لا مهام هذا الشهر' },

  // Expert
  'expert.comptables': { fr: 'Comptables du cabinet', ar: 'محاسبو المكتب' },
  'expert.clients_count': { fr: '{n} clients', ar: '{n} عملاء' },
  'expert.avg_progress': { fr: 'Avancement moyen', ar: 'متوسط التقدم' },
  'expert.blocked_dossiers': { fr: 'Dossiers bloqués client', ar: 'ملفات محجوزة لدى العميل' },

  // Donut — 2 catégories : vert = fait, rouge = bloqué client
  'donut.done': { fr: 'Ça marche', ar: 'يعمل' },
  'donut.blocked': { fr: 'Bloqué client', ar: 'محجوز لدى العميل' },

  // Templates
  'templates.title': { fr: 'Modèles de tâches', ar: 'قوالب المهام' },
  'templates.add': { fr: 'Ajouter une tâche type', ar: 'إضافة مهمة نموذجية' },
  'templates.requires_doc': { fr: 'Nécessite un document', ar: 'يتطلب مستنداً' },
  'templates.comptable': { fr: 'Comptable assigné', ar: 'محاسب معين' },
  'templates.frequency': { fr: 'Fréquence', ar: 'التكرار' },
  'templates.freq_monthly': { fr: 'Mensuel', ar: 'شهري' },
  'templates.freq_quarterly': { fr: 'Trimestriel', ar: 'ثلاثي' },
  'templates.freq_annual': { fr: 'Annuel', ar: 'سنوي' },

  // Timeline
  'timeline.all': { fr: 'Tout', ar: 'الكل' },
  'timeline.blockages': { fr: 'Bloqués client uniquement', ar: 'المحجوزة لدى العميل فقط' },
  'timeline.documents': { fr: 'Documents uniquement', ar: 'المستندات فقط' },
  'timeline.time': { fr: 'Chrono', ar: 'التوقيت' },
  // Comptable detail
  'comp.tasks_done': { fr: 'Tâches terminées', ar: 'المهام المنجزة' },
  'comp.notes_written': { fr: 'Notes rédigées', ar: 'الملاحظات المكتوبة' },
  'comp.total_time': { fr: 'Temps total', ar: 'الوقت الكلي' },
  'comp.time_by_dossier': { fr: 'Temps par dossier', ar: 'الوقت حسب الملف' },
  'comp.recent_tasks': { fr: 'Tâches récentes', ar: 'المهام الأخيرة' },
  'comp.recent_notes': { fr: 'Notes récentes', ar: 'الملاحظات الأخيرة' },
  'comp.audit_log': { fr: 'Journal d\'activité', ar: 'سجل النشاط' },
  'comp.all_dossiers': { fr: 'Tous les dossiers', ar: 'جميع الملفات' },
  'comp.overview': { fr: 'Vue d\'ensemble', ar: 'نظرة عامة' },

  // Client portal
  'portal.title': { fr: 'Espace Client', ar: 'مساحة العميل' },
  'portal.upload': { fr: 'Uploader', ar: 'رفع' },
  'portal.progress_simple': { fr: 'Votre dossier est avancé à {n}%', ar: 'ملفك متقدم بنسبة {n}%' },
};

let currentLang: Lang = 'fr';
const listeners: Array<() => void> = [];

export function setLang(lang: Lang) {
  currentLang = lang;
  try { localStorage.setItem('eurex_org_lang', lang); } catch {}
  listeners.forEach(fn => fn());
}

export function getLang(): Lang {
  return currentLang;
}

export function initLang() {
  try {
    const stored = localStorage.getItem('eurex_org_lang') as Lang;
    if (stored === 'fr' || stored === 'ar') currentLang = stored;
  } catch {}
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[currentLang] || entry.fr || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

export function onLangChange(fn: () => void) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
