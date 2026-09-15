'use client';

import React from 'react';
import { Check } from 'lucide-react';

/*
 * 학습 단계 표시 — dot + 연결선.
 *
 * 기존에는 두 군데가 막대(rectangle) 모양이었다.
 *   1. LevelStepper — 채워진 사각 세그먼트가 슬라이더 트랙처럼 보였다.
 *   2. BeginnerWizard 상단 3단계 표시 — 굵은 막대 3개를 <button>으로 감싸
 *      "드래그해서 값을 바꾸는 컨트롤"과 시각적으로 구분되지 않았다.
 *
 * 원형 dot + 가는 연결선은 "이산적인 단계"라는 것을 형태로 말한다 — 막대는
 * 연속값(0~100%)을 연상시키지만 점은 끊어진 개별 지점을 연상시킨다. 완료한
 * 단계는 체크 아이콘으로 채워 "그냥 지나간 점"과 구분한다(색만으로 구분하지
 * 않음 — 접근성 요구사항).
 *
 * 클릭 가능 여부(onStepChange)는 그대로 옵션으로 둔다 — 이전 단계로 돌아가는
 * 기존 동작은 유지하되, 모양만 "컨트롤처럼 보이지 않게" 바꾼다.
 */

export interface StepIndicatorProps {
  /** 각 단계의 라벨. 인덱스 0부터 시작. */
  steps: string[];
  /** 현재 단계 인덱스(0-based). */
  currentIndex: number;
  /** 지정하면 완료된 단계(과거 단계)를 눌러 이동할 수 있다. */
  onStepChange?: (index: number) => void;
  className?: string;
}

export function StepIndicator({ steps, currentIndex, onStepChange, className = '' }: StepIndicatorProps) {
  return (
    <ol className={`flex items-start ${className}`} aria-label="진행 단계">
      {steps.map((label, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
        const clickable = Boolean(onStepChange) && index <= currentIndex && index !== currentIndex;
        const isLast = index === steps.length - 1;

        return (
          <li key={label} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepChange?.(index)}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`${index + 1}단계 · ${label} · ${state === 'done' ? '완료' : state === 'current' ? '진행 중' : '예정'}`}
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-caption font-bold transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-600)] focus-visible:ring-offset-2',
                  state === 'done'
                    ? 'bg-[var(--color-primary-600)] text-white'
                    : state === 'current'
                      ? 'border-2 border-[var(--color-primary-600)] bg-white text-[var(--color-primary-600)]'
                      : 'border-2 border-slate-200 bg-white text-slate-400',
                  clickable ? 'cursor-pointer' : 'cursor-default',
                ].join(' ')}
              >
                {state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
              </button>
              <span
                className={`text-caption mt-1.5 max-w-[5.5rem] text-center leading-tight ${
                  state === 'current' ? 'font-bold text-slate-900' : state === 'done' ? 'font-medium text-slate-600' : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div
                aria-hidden="true"
                className={`mx-1.5 mt-3.5 h-0.5 flex-1 rounded-full ${index < currentIndex ? 'bg-[var(--color-primary-600)]' : 'bg-slate-200'}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
