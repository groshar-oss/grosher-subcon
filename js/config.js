// הגדרות חיבור. כשהשדות ריקים המערכת עובדת במצב הדגמה (נתונים נשמרים רק בדפדפן הזה).
// אחרי הקמת Supabase: מדביקים כאן את כתובת הפרויקט (Project URL) ואת המפתח הציבורי (Publishable key או anon public).
// נמצאים ב-Supabase בהגדרות הפרויקט > מפתחות גישה (Project Settings > API Keys). לא להדביק את המפתח הסודי.
export const CONFIG = {
  supabaseUrl: 'https://leheyfyjnbmqjmjeunwi.supabase.co',
  supabaseAnonKey: 'sb_publishable_GErjk-Y1BEdVoZQkaluApw_8lbrjPJ_',
  // מזהה OAuth של Google (לא חובה כאן, אפשר להזין גם במסך "תצוגה ומצב"). משמש לשמירת קבצים בדרייב ולשליחת התראות מה-Gmail.
  googleClientId: '',
  appName: 'גרושר · בקרת עלויות ותזרים'
};
