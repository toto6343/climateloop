'use client';

import React from 'react';
import { Check, AlertTriangle, ShieldAlert, Info } from 'lucide-react';
import { SemanticTone, TONE_CLASSES } from './tokens';

/*
 * 상태 뱃지 단일 컴포넌트.
 *
 * 기존 화면에는 같은 "상태 표시"가 세 가지 다른 모양으로 흩어져 있었다 —
 * 텍스트만(ScoreRiskBadge), 아이콘+테두리 알림 박스(GridRiskAlert), 알약형
 * 배지(GoalBadge, UpdatingBadge, AiSourceBadge). padding·radius·font-size가
 * 제각각이라 "이게 다 같은 종류의 정보"라는 것이 형태로 드러나지 않았다.
 *
 * 이제 상태를 나타내는 모든 자리는 이 Badge 하나로 통일한다. 톤(info/warning/
 * danger/success)마다 아이콘이 고정되어 있어 — 색약이거나 흑백 인쇄에서도
 * 아이콘 모양만으로 상태가 구분된다(WCAG 1.4.1: 색만으로 정보를 전달하지 않음).
 */

const TONE_ICON: Record<SemanticTone, React.ComponentType<{ className?: string }>> = {
  info: Info,
  warning: AlertTriangle,
  danger: ShieldAlert,
  success: Check,
};

export interface BadgeProps {
  tone: SemanticTone;
  /** 배지에 표시할 텍스트. 색만으로 상태를 전달하지 않기 위해 항상 필수값이다. */
  label: string;
  /** 'sm'은 인라인 목록·카드 헤더용, 'md'는 단독으로 눈에 띄어야 하는 자리용. */
  size?: 'sm' | 'md';
  /** true면 role="alert"를 붙여 스크린리더가 즉시 읽게 한다(위험 상태 전환 시). */
  urgent?: boolean;
  className?: string;
}

export function Badge({ tone, label, size = 'sm', urgent = false, className = '' }: BadgeProps) {
  const Icon = TONE_ICON[tone];
  const c = TONE_CLASSES[tone];

  return (
    <span
      role={urgent ? 'alert' : 'status'}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border font-semibold shrink-0',
        c.bg, c.border, c.text,
        size === 'sm' ? 'px-2.5 py-1 text-caption' : 'px-3 py-1.5 text-body',
        className,
      ].join(' ')}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3 shrink-0' : 'h-4 w-4 shrink-0'} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * 상세 설명이 필요한 위험/경고 상태를 위한 확장형(GridRiskAlert 대체).
 * Badge와 같은 톤·아이콘 규칙을 쓰되, 제목 아래 한 줄 설명을 더 붙일 자리가
 * 있는 카드형이다. urgent 상태(danger/warning)에서만 쓰는 것을 권장한다.
 */
export function AlertBanner({
  tone,
  title,
  description,
}: {
  tone: SemanticTone;
  title: string;
  description?: string;
}) {
  const Icon = TONE_ICON[tone];
  const c = TONE_CLASSES[tone];

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${c.bg} ${c.border} ${c.text}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-body font-semibold leading-snug">{title}</p>
        {description && <p className="text-caption mt-0.5 leading-snug opacity-90">{description}</p>}
      </div>
    </div>
  );
}
