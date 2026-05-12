export type ThemeKey = 'blue' | 'red' | 'green' | 'purple' | 'orange' | 'teal';

type Scale = { 50: string; 100: string; 400: string; 500: string; 600: string; 700: string; 900: string };

export const COLOR_THEMES: Record<ThemeKey, Scale> = {
  blue:   { 50:'239 246 255', 100:'219 234 254', 400:'96 165 250',  500:'59 130 246',  600:'37 99 235',   700:'29 78 216',   900:'30 58 138'  },
  red:    { 50:'254 242 242', 100:'254 226 226', 400:'248 113 113', 500:'239 68 68',   600:'220 38 38',   700:'185 28 28',   900:'127 29 29'  },
  green:  { 50:'240 253 244', 100:'220 252 231', 400:'74 222 128',  500:'34 197 94',   600:'22 163 74',   700:'21 128 61',   900:'20 83 45'   },
  purple: { 50:'250 245 255', 100:'243 232 255', 400:'192 132 252', 500:'168 85 247',  600:'147 51 234',  700:'126 34 206',  900:'88 28 135'  },
  orange: { 50:'255 247 237', 100:'255 237 213', 400:'251 146 60',  500:'249 115 22',  600:'234 88 12',   700:'194 65 12',   900:'124 45 18'  },
  teal:   { 50:'240 253 250', 100:'204 251 241', 400:'45 212 191',  500:'20 184 166',  600:'13 148 136',  700:'15 118 110',  900:'19 78 74'   },
};

export const THEME_LABELS: Record<ThemeKey, string> = {
  blue:   'Blue',
  red:    'Red',
  green:  'Green',
  purple: 'Purple',
  orange: 'Orange',
  teal:   'Teal',
};

export const THEME_SWATCH: Record<ThemeKey, string> = {
  blue:   '#2563eb',
  red:    '#dc2626',
  green:  '#16a34a',
  purple: '#9333ea',
  orange: '#ea580c',
  teal:   '#0d9488',
};

export function applyTheme(theme: ThemeKey) {
  const scale = COLOR_THEMES[theme];
  const root = document.documentElement;
  (Object.entries(scale) as [string, string][]).forEach(([k, v]) => {
    root.style.setProperty(`--brand-${k}`, v);
  });
}

export function loadBranding() {
  if (typeof window === 'undefined') return;
  const theme = (localStorage.getItem('branding_theme') ?? 'blue') as ThemeKey;
  applyTheme(theme);
}

export function saveBrandingTheme(theme: ThemeKey) {
  localStorage.setItem('branding_theme', theme);
  applyTheme(theme);
}

export function getBrandingTheme(): ThemeKey {
  return (localStorage.getItem('branding_theme') ?? 'blue') as ThemeKey;
}

export function getBrandingBg(): string | null {
  return localStorage.getItem('branding_login_bg');
}

export function saveBrandingBg(dataUrl: string | null) {
  if (dataUrl) {
    localStorage.setItem('branding_login_bg', dataUrl);
  } else {
    localStorage.removeItem('branding_login_bg');
  }
}
