/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--pf-text)',
        muted: 'var(--pf-text-muted)',
        line: 'var(--pf-border)',
        accent: {
          DEFAULT: 'rgb(var(--pf-accent-rgb) / <alpha-value>)',
          ink: 'var(--pf-accent-fg)',
        },
      },
      borderColor: {
        line: 'var(--pf-border)',
      },
      borderRadius: {
        glass: 'var(--pf-radius)',
        capsule: '999px',
      },
      boxShadow: {
        glass: 'var(--pf-shadow)',
        'glass-lg': 'var(--pf-shadow-lg)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
