/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'SF Pro Display', 'Helvetica Neue', 'sans-serif'],
        body: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'SF Pro Text', 'Helvetica Neue', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        apple: {
          bg: '#fbfbfd',
          'bg-secondary': '#f5f5f7',
          card: '#ffffff',
          text: '#1d1d1f',
          'text-secondary': '#6e6e73',
          'text-tertiary': '#86868b',
          blue: '#0071e3',
          'blue-hover': '#0077ed',
          green: '#34c759',
          orange: '#ff9f0a',
          red: '#ff3b30',
          border: 'rgba(0,0,0,0.04)',
        },
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
        '4xl': '24px',
      },
      boxShadow: {
        'apple-sm': '0 2px 8px rgba(0,0,0,0.04)',
        'apple-md': '0 4px 20px rgba(0,0,0,0.08)',
        'apple-lg': '0 12px 40px rgba(0,0,0,0.12)',
        'apple-xl': '0 20px 60px rgba(0,0,0,0.15)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
