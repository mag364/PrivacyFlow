import { create } from 'zustand';

// -----------------------------------------------------------------------------
// Appearance store. Persists theme / contrast / transparency / motion to
// localStorage and reflects them onto <html data-*> so the CSS token layer in
// styles/index.css can respond.
// -----------------------------------------------------------------------------

type Theme = 'dark' | 'light';
type Contrast = 'normal' | 'high';
type Transparency = 'on' | 'off';
type Motion = 'on' | 'off';

interface ThemeState {
  theme: Theme;
  contrast: Contrast;
  transparency: Transparency;
  motion: Motion;
  setTheme: (v: Theme) => void;
  setContrast: (v: Contrast) => void;
  setTransparency: (v: Transparency) => void;
  setMotion: (v: Motion) => void;
  apply: () => void;
}

const KEY = 'privacyflow.appearance.v1';

function read(): Pick<ThemeState, 'theme' | 'contrast' | 'transparency' | 'motion'> {
  const fallback = { theme: 'dark' as Theme, contrast: 'normal' as Contrast, transparency: 'on' as Transparency, motion: 'on' as Motion };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<ThemeState>) };
  } catch {
    return fallback;
  }
}

function persist(state: Pick<ThemeState, 'theme' | 'contrast' | 'transparency' | 'motion'>) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function reflect(state: Pick<ThemeState, 'theme' | 'contrast' | 'transparency' | 'motion'>) {
  const el = document.documentElement;
  el.setAttribute('data-theme', state.theme);
  el.setAttribute('data-contrast', state.contrast);
  el.setAttribute('data-transparency', state.transparency);
  el.setAttribute('data-motion', state.motion);
}

export const useTheme = create<ThemeState>((set, get) => ({
  ...read(),
  setTheme(theme) {
    set({ theme });
    const s = get();
    persist(s);
    reflect(s);
  },
  setContrast(contrast) {
    set({ contrast });
    const s = get();
    persist(s);
    reflect(s);
  },
  setTransparency(transparency) {
    set({ transparency });
    const s = get();
    persist(s);
    reflect(s);
  },
  setMotion(motion) {
    set({ motion });
    const s = get();
    persist(s);
    reflect(s);
  },
  apply() {
    reflect(get());
  },
}));