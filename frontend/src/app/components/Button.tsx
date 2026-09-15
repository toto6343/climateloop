'use client';

import React from 'react';

/*
 * 버튼 위계 3단계.
 *
 *   Primary   — 채워진 진한 남색. 화면(또는 화면 안의 한 카드) 당 1개만.
 *               "지금 이 화면에서 가장 하고 싶은 행동"에만 쓴다.
 *   Secondary — 테두리만 있는 버튼. Primary와 나란히 있거나, Primary가
 *               없는 자리의 보조 행동에 쓴다.
 *   Tertiary  — 텍스트 링크. 페이지 이동, "더 보기", 취소처럼 무게가
 *               가장 가벼운 행동.
 *
 * 기존 화면에는 브랜드색 채움 버튼이 화면 하나에 여러 개 동시에 떠 있었다
 * (결과 리포트 저장 / 추천 적용하기 / 교사 링크 만들기 등이 전부 같은 무게).
 * 이 컴포넌트로 옮기면서 "화면당 Primary 1개" 규칙을 지키려면, 의미상
 * 정말 행동을 유도해야 하는 버튼(추천 적용하기)만 Primary로 남기고
 * 나머지(리포트 저장, 링크 복사, 교사 링크)는 Secondary로 내린다.
 */

type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary-600)] text-white shadow-sm hover:bg-[var(--color-primary-700)] ' +
    'disabled:bg-slate-300 disabled:cursor-not-allowed',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 ' +
    'disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed',
  tertiary:
    'text-[var(--color-primary-600)] underline underline-offset-2 hover:text-[var(--color-primary-700)] ' +
    'disabled:text-slate-400 disabled:cursor-not-allowed disabled:no-underline',
};

const SIZE_CLASSES: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: { sm: 'px-3 py-1.5 text-caption rounded-md', md: 'px-4 py-2.5 text-body rounded-lg' },
  secondary: { sm: 'px-3 py-1.5 text-caption rounded-md', md: 'px-4 py-2.5 text-body rounded-lg' },
  tertiary: { sm: 'text-caption', md: 'text-body' },
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-1.5 font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-600)] focus-visible:ring-offset-2',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[variant][size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
