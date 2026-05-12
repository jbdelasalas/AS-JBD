'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => Promise<void>;
  isSuperadmin: boolean;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'light',
  setTheme: async () => {},
  isSuperadmin: false,
});

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  useEffect(() => {
    // Apply cached value instantly to avoid flash
    const cached = localStorage.getItem('app_theme') as Theme | null;
    if (cached) { setThemeState(cached); applyTheme(cached); }

    // Fetch the global setting from API
    fetch('/api/v1/settings')
      .then((r) => r.json())
      .then((data) => {
        const t: Theme = data?.dark_mode === 'true' ? 'dark' : 'light';
        setThemeState(t);
        applyTheme(t);
        localStorage.setItem('app_theme', t);
      })
      .catch(() => {});

    // Check if current user is superadmin
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? 'null');
      setIsSuperadmin(!!user?.is_superadmin);
    } catch {}
  }, []);

  async function setTheme(t: Theme) {
    const token = localStorage.getItem('access_token');
    await fetch('/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ dark_mode: String(t === 'dark') }),
    });
    setThemeState(t);
    applyTheme(t);
    localStorage.setItem('app_theme', t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isSuperadmin }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
