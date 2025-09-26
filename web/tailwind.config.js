/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        border: 'var(--border)',
        card: 'var(--card)',
        muted: 'var(--muted)',
        primary: 'var(--primary)',
        primaryForeground: 'var(--primary-foreground)',
        success: 'var(--success)',
        secondary: 'var(--secondary)'
      },
      boxShadow: {
        focus: '0 0 0 3px rgba(130,219,173,.35)'
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem'
      }
    }
  },
  plugins: []
};
