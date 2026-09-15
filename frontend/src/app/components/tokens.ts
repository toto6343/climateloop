/**
 * design-tokens.css 의 값을 JS 쪽에서 참조하기 위한 미러.
 *
 * 값 자체의 원본은 CSS 파일이다(실제로 렌더링에 쓰이는 것은 CSS 변수).
 * 이 파일은 컴포넌트가 "어떤 시맨틱 토큰을 쓸지" 타입으로 강제하기 위한
 * variant 이름·클래스 매핑용이며, 색상 hex 값을 여기서 새로 정의하지 않는다
 * (하드코딩된 값이 두 파일에서 어긋나는 것을 막기 위해 className 조합만 둔다).
 */

/** 상태를 나타내는 시맨틱 톤. 데이터 값(발전원 색 등)에는 쓰지 않는다. */
export type SemanticTone = 'info' | 'warning' | 'danger' | 'success';

/** 각 톤의 Tailwind 클래스 조합. bg/border/text 는 항상 함께 쓴다(soft 스타일). */
export const TONE_CLASSES: Record<SemanticTone, { bg: string; border: string; text: string; icon: string; solidBg: string; solidText: string }> = {
  info: {
    bg: 'bg-[var(--color-info-bg)]',
    border: 'border-[var(--color-info-border)]',
    text: 'text-[var(--color-info-text)]',
    icon: 'text-[var(--color-info-icon)]',
    solidBg: 'bg-[var(--color-info-solid)]',
    solidText: 'text-white',
  },
  warning: {
    bg: 'bg-[var(--color-warning-bg)]',
    border: 'border-[var(--color-warning-border)]',
    text: 'text-[var(--color-warning-text)]',
    icon: 'text-[var(--color-warning-icon)]',
    solidBg: 'bg-[var(--color-warning-solid)]',
    solidText: 'text-white',
  },
  danger: {
    bg: 'bg-[var(--color-danger-bg)]',
    border: 'border-[var(--color-danger-border)]',
    text: 'text-[var(--color-danger-text)]',
    icon: 'text-[var(--color-danger-icon)]',
    solidBg: 'bg-[var(--color-danger-solid)]',
    solidText: 'text-white',
  },
  success: {
    bg: 'bg-[var(--color-success-bg)]',
    border: 'border-[var(--color-success-border)]',
    text: 'text-[var(--color-success-text)]',
    icon: 'text-[var(--color-success-icon)]',
    solidBg: 'bg-[var(--color-success-solid)]',
    solidText: 'text-white',
  },
};

/**
 * 전력망 상태 → 시맨틱 톤 매핑.
 * 기존 GridStatus('deficit'|'stable'|'surplus')를 시맨틱 톤에 고정 연결한다.
 * 이 매핑이 이 파일에 있으므로, 다른 화면에서 같은 GridStatus 를 쓰면
 * 항상 같은 색이 나온다.
 */
export const GRID_STATUS_TONE: Record<'deficit' | 'stable' | 'surplus', SemanticTone> = {
  deficit: 'danger',
  stable: 'success',
  surplus: 'warning',
};

/** 학습 단계 스텝 인디케이터의 상태. */
export type StepState = 'done' | 'current' | 'upcoming';

/** 타이포그래피 스케일 이름 → 클래스. Tailwind 임의값 대신 이 상수로만 크기를 지정한다. */
export type TypeScale = 'heading' | 'subheading' | 'body' | 'caption';
export const TYPE_CLASSES: Record<TypeScale, string> = {
  heading: 'text-heading',
  subheading: 'text-subheading',
  body: 'text-body',
  caption: 'text-caption',
};

/** 스페이싱 스케일. Tailwind 유틸리티(p-2/p-4/p-6/p-8 = 8/16/24/32px)와 1:1 대응된다. */
export const SPACE = {
  1: 'var(--space-1)', // 8px
  2: 'var(--space-2)', // 16px
  3: 'var(--space-3)', // 24px
  4: 'var(--space-4)', // 32px
} as const;
