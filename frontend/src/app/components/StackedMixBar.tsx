'use client';

import React, { useCallback, useRef, useState } from 'react';

/*
 * 에너지 믹스 스택형 바.
 *
 * 기존에는 재생/원자력/화석 세 축을 각자 독립된 슬라이더 세 개로 조작했다.
 * "합계는 항상 100%" 규칙은 각주 문장으로만 설명되고, 조작하는 동안 그
 * 사실이 화면에 보이지 않았다 — 세 트랙이 서로 다른 자리에 있어서 합이
 * 100인지 눈으로 확인할 방법이 없었다.
 *
 * 하나의 가로 바 안에 세 구간을 누적으로 쌓으면(폭 = 비율) 합계가 항상
 * 바 전체 폭이 되므로, "셋을 더하면 100%"라는 불변식이 그 자체로 보인다.
 * 두 구간 사이의 경계선을 드래그하면 그 경계와 맞닿은 두 축의 비율이
 * 바뀐다 — 세 번째 축은 그대로 둔 채로.
 *
 * 값 갱신 규약은 기존 handleSliderChange(type, value)와 동일하게 유지한다.
 *   · 첫 번째 경계(구간0/구간1 사이)를 옮기면 → onChange(segments[0].key, 새값)
 *     이는 기존 "재생에너지 슬라이더를 옮긴다"와 동일한 신호이므로, 호출부의
 *     redistributeMix 가 나머지 두 축을 비율대로 재분배하는 로직을 그대로 재사용한다.
 *   · 두 번째 경계(구간1/구간2 사이)를 옮기면 → onChange(segments[2].key, 100-새경계)
 *     이는 "화석연료 슬라이더를 옮긴다"와 동일한 신호다.
 * 즉 이 컴포넌트는 새 재분배 로직을 만들지 않고, 기존 onChange 시그니처
 * 위에 다른 입력 방식(드래그)을 얹은 것뿐이다.
 *
 * 접근성: 각 경계선은 role="slider"로 값·최소·최대·현재값을 스크린리더에
 * 알리고, 방향키(←/→, Home/End)로도 같은 조작이 가능하다. 숫자를 정확히
 * 찍어야 하는 경우를 위해 바 아래에 각 구간의 숫자 입력도 함께 둔다 —
 * 드래그가 "대강 맞추기", 숫자칸이 "정확히 찍기" 역할을 나눠 맡는 것은
 * 기존 슬라이더+숫자입력 패턴과 같다.
 */

export interface MixSegment<K extends string = string> {
  /** 백엔드/상위 상태의 키. onChange 콜백에 그대로 돌려준다. */
  key: K;
  label: string;
  color: string;
  value: number; // 0~100, 세 세그먼트 합은 항상 100이어야 한다.
}

export interface StackedMixBarProps<K extends string = string> {
  /** 정확히 3개, 항상 같은 순서(예: 재생/원자력/화석)로 전달한다. */
  segments: [MixSegment<K>, MixSegment<K>, MixSegment<K>];
  /**
   * 기존 handleSliderChange(type, value)와 같은 시그니처.
   *
   * K를 제네릭으로 둔 이유: 호출부의 핸들러가 보통 (key: keyof EnergyMixValues,
   * value: string) => void 처럼 key를 좁은 유니온 타입으로 제한해 둔다. 여기를
   * (key: string, ...) 로 고정하면 "이 함수는 어떤 문자열이 와도 처리한다"는
   * 뜻이 되어, 더 좁은 타입의 실제 핸들러를 대입할 수 없다(매개변수 반공변성).
   * segments의 key 리터럴 타입에서 K가 추론되므로 호출부에서 타입 인자를
   * 직접 적을 필요는 없다.
   */
  onChange: (key: K, value: string) => void;
}

const STEP = 1; // 방향키 한 번, 드래그 반올림 단위(%)

export function StackedMixBar<K extends string = string>({ segments, onChange }: StackedMixBarProps<K>) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<0 | 1 | null>(null);

  const [a, b, c] = segments;
  const boundary1 = a.value;           // 구간0 끝 (= 구간1 시작)
  const boundary2 = a.value + b.value; // 구간1 끝 (= 구간2 시작)

  const percentFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(100, Math.max(0, Math.round(ratio * 100 / STEP) * STEP));
  }, []);

  const commitBoundary = useCallback((which: 0 | 1, rawPercent: number) => {
    if (which === 0) {
      // 경계1: 최소 0, 최대는 경계2(다음 경계) 위치를 넘을 수 없다.
      const clamped = Math.min(rawPercent, boundary2);
      onChange(a.key, String(clamped));
    } else {
      // 경계2: 최소는 경계1 위치, 최대 100. 구간2(c) 값 = 100 - 경계2.
      const clamped = Math.max(rawPercent, boundary1);
      onChange(c.key, String(100 - clamped));
    }
  }, [a.key, c.key, boundary1, boundary2, onChange]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (dragging === null) return;
    commitBoundary(dragging, percentFromPointer(event.clientX));
  }, [dragging, commitBoundary, percentFromPointer]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  React.useEffect(() => {
    if (dragging === null) return;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragging, handlePointerMove, handlePointerUp]);

  const handleKeyDown = (which: 0 | 1) => (event: React.KeyboardEvent) => {
    const current = which === 0 ? boundary1 : boundary2;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      commitBoundary(which, current - STEP);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      commitBoundary(which, current + STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      commitBoundary(which, which === 0 ? 0 : boundary1);
    } else if (event.key === 'End') {
      event.preventDefault();
      commitBoundary(which, which === 0 ? boundary2 : 100);
    }
  };

  return (
    <div>
      {/* 누적 바 본체 */}
      <div
        ref={trackRef}
        className="relative flex h-10 w-full overflow-hidden rounded-lg ring-1 ring-slate-200"
      >
        {segments.map((seg) => (
          <div
            key={seg.key}
            style={{ width: `${seg.value}%`, backgroundColor: seg.color }}
            className="flex items-center justify-center transition-[width] duration-150 ease-out"
          >
            {seg.value >= 12 && (
              <span className="text-caption font-bold text-white drop-shadow-sm tabular-nums">
                {Math.round(seg.value)}%
              </span>
            )}
          </div>
        ))}

        {/* 드래그 가능한 경계선 2개. 세그먼트 위에 절대 위치로 얹는다. */}
        {[boundary1, boundary2].map((pos, index) => (
          <div
            key={index}
            role="slider"
            tabIndex={0}
            aria-label={index === 0 ? `${a.label}과 ${b.label} 사이 경계` : `${b.label}과 ${c.label} 사이 경계`}
            aria-valuemin={index === 0 ? 0 : boundary1}
            aria-valuemax={index === 0 ? boundary2 : 100}
            aria-valuenow={Math.round(pos)}
            aria-valuetext={`${Math.round(pos)}%`}
            onPointerDown={(e) => {
              e.preventDefault();
              (index === 0 ? setDragging : setDragging)(index as 0 | 1);
            }}
            onKeyDown={handleKeyDown(index as 0 | 1)}
            style={{ left: `calc(${pos}% - 6px)` }}
            className="absolute top-0 h-10 w-3 cursor-ew-resize touch-none
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                       before:absolute before:left-1/2 before:top-1/2 before:h-6 before:w-1
                       before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full
                       before:bg-white/90 before:shadow"
          />
        ))}
      </div>

      {/* 범례 + 숫자 입력 — 드래그의 보조 수단이자, 값 확인용 텍스트 라벨 */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center justify-between gap-1.5 rounded-md bg-slate-50 px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} aria-hidden="true" />
              <span className="text-caption truncate font-medium text-slate-700">{seg.label}</span>
            </span>
            <NumberField
              value={seg.value}
              label={`${seg.label} 비중(%) 직접 입력`}
              onCommit={(next) => onChange(seg.key, String(next))}
            />
          </div>
        ))}
      </div>
      <p className="text-caption mt-1.5 leading-snug text-slate-500">
        경계선을 드래그하거나 숫자를 입력하세요. 한 값을 바꾸면 나머지 둘이 비율대로 나뉘어 합계는 항상 100%입니다.
      </p>
    </div>
  );
}

/** 스택 바 아래 숫자 입력칸. 기존 MixNumberInput과 같은 draft 처리 규칙. */
function NumberField({ value, label, onCommit }: { value: number; label: string; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(Math.round(value))}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw !== '') onCommit(Number(raw));
        }}
        onBlur={() => setDraft(null)}
        className="text-caption w-10 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-bold text-slate-900 tabular-nums
                   focus:outline-none focus:border-[var(--color-primary-600)] focus:ring-1 focus:ring-[var(--color-primary-600)]"
      />
      <span className="text-caption font-bold text-slate-700">%</span>
    </span>
  );
}
