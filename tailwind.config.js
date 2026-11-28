/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.jsx'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', '"Fira Code"', 'monospace'],
      },
      colors: {
        obsidian: {
          bg: '#09090b',       // Primary window canvas
          surface: '#111114',  // Sidebar & elevated panels
          elevated: '#18181b', // Cards, inputs, buttons
          hover: '#222226',    // Subtle hover state
          border: '#27272a',   // Crisp 1px hairlines
          text: '#f4f4f5',     // Primary readable text
          secondary: '#a1a1aa',// Secondary text
          muted: '#71717a',    // Muted labels / timestamps
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.16s ease-out',
        'typing': 'typing 1.2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        typing: {
          '0%, 100%': { opacity: '0.25' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
