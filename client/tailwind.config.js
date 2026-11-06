/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#080e16',
          900: '#0d1520',
          850: '#111a26',
          800: '#161f2c',
          700: '#1e2a3a',
          600: '#2a3a4e',
          500: '#3d5168',
        },
        gold: {
          400: '#f0c75e',
          500: '#e8b84a',
          600: '#c99a2e',
          700: '#a67d1a',
        },
        alert: {
          400: '#e05a50',
          500: '#d4453a',
        },
        ok: {
          400: '#4fb87e',
          500: '#3d9b6a',
        },
        ink: {
          50: '#f4f6f8',
          100: '#e6eaef',
          200: '#c5cdd8',
          300: '#9aa6b5',
          400: '#6b7a8d',
          500: '#4d5e72',
        },
        gray: {
          50: '#111a26',
          100: '#161f2c',
          200: '#1e2a3a',
          300: '#2a3a4e',
          400: '#4d5e72',
          500: '#6b7a8d',
          600: '#9aa6b5',
          700: '#c5cdd8',
          800: '#e6eaef',
          900: '#f4f6f8',
          950: '#ffffff',
        },
        brand: {
          50: '#161f2c',
          100: '#1e2a3a',
          200: '#2a3a4e',
          300: '#3d5168',
          400: '#6b7a8d',
          500: '#d4453a',
          600: '#c99a2e',
          700: '#d4453a',
          800: '#0d1520',
          900: '#080e16',
        },
        status: {
          available: '#3d9b6a',
          dispatched: '#4f92d0',
          enroute: '#d4a017',
          onscene: '#d4453a',
          transporting: '#e8b84a',
          oos: '#6b7a8d',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      spacing: {
        sidebar: '240px',
        header: '72px',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'pulse-sos': {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(212, 69, 58, 0.55)' },
          '70%': { transform: 'scale(1.02)', boxShadow: '0 0 0 18px rgba(212, 69, 58, 0)' },
        },
      },
      animation: {
        'pulse-sos': 'pulse-sos 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
