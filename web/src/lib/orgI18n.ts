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
  'dash.blocked': { fr: 'Bloqué', ar: 'محجوب' },
  'dash.open_dossier': { fr: 'Ouvrir le dossier', ar: 'فتح الملف' },
  'dash.since_days': { fr: 'depuis {n} jours', ar: 'منذ {n} أيام' },

  // Status
  'status.en_cours': { fr: 'En cours', ar: 'قيد التنفيذ' },
  'status.cloture': { fr: 'Clôturé', ar: 'مغلق' },
  'status.a_faire': { fr: 'À faire', ar: 'للقيام' },
  'status.en_cours_task': { fr: 'En cours', ar: 'قيد التنفيذ' },
  'status.fait': { fr: 'Fait', ar: 'منجز' },
  'status.bloque_client': { fr: 'Bloqué client', ar: 'محجوب — في انتظار العميل' },

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

  // Expert
  'expert.comptables': { fr: 'Comptables du cabinet', ar: 'محاسبو المكتب' },
  'expert.clients_count': { fr: '{n} clients', ar: '{n} عملاء' },
  'expert.avg_progress': { fr: 'Avancement moyen', ar: 'متوسط التقدم' },
  'expert.blocked_dossiers': { fr: 'Dossiers bloqués', ar: 'الملفات المحجوبة' },

  // Donut
  'donut.done': { fr: 'Terminé', ar: 'منجز' },
  'donut.in_progress': { fr: 'En cours', ar: 'قيد التنفيذ' },
  'donut.blocked': { fr: 'Bloqué client', ar: 'محجوب' },

  // Templates
  'templates.title': { fr: 'Modèles de tâches', ar: 'قوالب المهام' },
  'templates.add': { fr: 'Ajouter une tâche type', ar: 'إضافة مهمة نموذجية' },
  'templates.requires_doc': { fr: 'Nécessite un document', ar: 'يتطلب مستنداً' },

  // Timeline
  'timeline.all': { fr: 'Tout', ar: 'الكل' },
  'timeline.blockages': { fr: 'Blocages uniquement', ar: 'الحجوب فقط' },
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
