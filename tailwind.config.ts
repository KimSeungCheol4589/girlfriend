import type { Config } from 'tailwindcss';

/**
 * 색상은 CSS 변수로 정의하고 Tailwind 유틸리티에서 참조한다.
 * 테마 프리셋(cream/rose/sage)과 포인트 색상은 런타임에 변수만 바꾼다.
 * DESIGN.md 4.1의 변수 구분: background, surface, text, muted, accent, border.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        'background-blur': 'var(--color-background-blur)',
        surface: 'var(--color-surface)',
        'surface-blur': 'var(--color-surface-blur)',
        'surface-muted': 'var(--color-surface-muted)',
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        accent: 'var(--color-accent)',
        'accent-contrast': 'var(--color-accent-contrast)',
        'accent-soft': 'var(--color-accent-soft)',
        border: 'var(--color-border)',
      },
      maxWidth: {
        // DESIGN.md 4.1: 콘텐츠 최대 폭 1,120px
        content: '1120px',
      },
      spacing: {
        // 주요 터치 영역 최소 크기
        touch: '44px',
      },
      borderRadius: {
        card: '20px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(58, 51, 46, 0.04), 0 8px 24px -16px rgba(58, 51, 46, 0.25)',
        raised: '0 2px 6px rgba(58, 51, 46, 0.08), 0 18px 40px -24px rgba(58, 51, 46, 0.4)',
      },
      fontFamily: {
        sans: ['var(--font-app-sans)'],
      },
    },
  },
  plugins: [],
};

export default config;
