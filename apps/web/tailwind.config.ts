import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

// shadcn/ui-compatible token setup (CSS variables in globals.css). Dark mode
// follows the OS setting.
const config: Config = {
  darkMode: 'media',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', ...defaultTheme.fontFamily.sans],
        mono: ['ui-monospace', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Semantic status colors — `<name>` is the accessible text/icon color,
        // `<name>-bg` its soft tint background (see globals.css).
        success: { DEFAULT: 'hsl(var(--success))', bg: 'hsl(var(--success-bg))' },
        warning: { DEFAULT: 'hsl(var(--warning))', bg: 'hsl(var(--warning-bg))' },
        danger: { DEFAULT: 'hsl(var(--danger))', bg: 'hsl(var(--danger-bg))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};

export default config;
