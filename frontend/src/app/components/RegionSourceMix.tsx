'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import { BestSourceHint, ENERGY_SOURCES, formatMwh, RegionStat, sourceColor } from './energySources';

interface PieSlice {
  name: string;
  value: number;       // 총 추정 발전량 대비 비율(%)
  generation: number;  // 추정 발전량(MWh)
  color: string;
}

/** 조각 hover 시 항목명 + 비율(%) + 추정 발전량(MWh). */
function SliceTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: PieSlice }> }) {
  const slice = active ? payload?.[0]?.payload : undefined;
  if (!slice) return null;
  return (
    <div className="px-2 py-1 bg-slate-800 text-white rounded-md text-xs shadow-lg whitespace-nowrap">
      <span className="font-semibold">{slice.name}</span> {slice.value.toFixed(1)}%
      <span className="text-slate-300"> · {formatMwh(slice.generation)} MWh(추정)</span>
    </div>
  );
}

interface RegionSourceMixProps {
  region: RegionStat;
  /** false면 아직 /regions 응답이 없는 상태. 값이 0인 것과 구분해야 한다. */
  isLoaded: boolean;
  /**
   * 적합도 결론(가장 적합한 발전원). 아직 계산 전이면 null.
   *
   * 이 패널이 스스로 고르지 않고 받아 그리기만 하는 이유: 결론을 정하는 곳은
   * page.tsx 의 pickBestSource() 하나뿐이어야 한다. 여기서 따로 계산하면
   * 같은 화면의 상세 결론 박스와 다른 발전원을 가리키는 순간이 생긴다.
   */
  best?: BestSourceHint | null;
  /**
   * 이 구성이 KPX 실시간 발전량을 반영했는지 ("live") 로컬 추정값인지 ("fallback").
   *
   * /regions 응답의 data_source 를 그대로 받는다. 아래 ※ 각주 문구가 이 값으로
   * 갈린다 — 같은 자리에 같은 모양으로 두 출처가 섞여 나오면 사용자가 구분할
   * 방법이 없다 (README 9.3 면책 원칙).
   *
   * 기본값은 "fallback" 이다. 확신이 없으면 추정값 쪽으로 둔다.
   */
  dataSource?: 'live' | 'fallback';
}

/**
 * 발전원 구성 위에 얹는 결론 한 줄.
 *
 * 결론(어느 발전원이 이 지역에 맞는가)은 원래 이 카드에서 한참 아래로 스크롤해야
 * 나오는 별도 박스에만 있었다. 지도·도넛을 보는 동안에는 보이지 않으므로, 핵심만
 * 압축한 한 줄을 여기에 두고 계수·배수 같은 근거는 원래 박스(근거 토글)에 남겼다.
 *
 * 앞머리 화살표는 글리프(→)에 발전원 색을 입힌 것이었다. 지금은 Lucide 아이콘에
 * 무채색이다 — 이 화살표는 값을 나타내지 않고 문장의 방향만 가리키므로, 색을 주면
 * 옆 도넛의 발전원 색과 같은 뜻으로 읽힌다. 어느 발전원인지는 글자가 말한다.
 */
function BestSourceLine({ best }: { best: BestSourceHint }) {
  return (
    <p className="mt-1.5 rounded-md bg-white px-2 py-1 text-[11px] leading-snug">
      <span className="flex items-baseline gap-1.5">
        <ArrowRight aria-hidden="true" className="w-3 h-3 shrink-0 translate-y-px text-slate-500" />
        <span className="text-slate-600 min-w-0">
          설비 인프라 기준 <span className="font-bold text-slate-900">{best.source}</span>이 가장 적합
          {best.runnerUp && best.lead >= 0.5 && (
            <span className="text-slate-500">
              {` (2위 ${best.runnerUp}보다 +${Math.round(best.lead)}%p)`}
            </span>
          )}
        </span>
      </span>
      <span className="mt-0.5 block pl-[18px] text-[10px] text-slate-400">
        탄소 기준이 아닌 설비 분포 기준
      </span>
    </p>
  );
}

/**
 * 선택한 지역의 발전원 구성 패널.
 *
 * 한동안 이 패널은 지도 위에 떠 있는 오버레이였다. 마커를 클릭했을 때만 잠깐
 * 나타나는 것이었으므로 무언가를 가려도 곧 사라져 문제가 되지 않았다.
 *
 * 지역 선택이 select box 하나로 모이면서 이 패널은 "고른 지역의 상시 정보"가 됐고,
 * 그렇다면 떠 있을 이유가 없다 — 계속 떠 있는 패널은 옆 칸(지역 select)을 영영
 * 덮어버린다. 그래서 지도에서 떼어내 레이아웃의 한 칸으로 세웠다. Leaflet 에
 * 기대는 것이 없으므로 지도와 달리 서버에서도 그려진다.
 */
export function RegionSourceMix({ region, isLoaded, best, dataSource = 'fallback' }: RegionSourceMixProps) {
  const total = region.totalGeneration;

  const data: PieSlice[] = ENERGY_SOURCES.map((source) => {
    const generation = region.sources[source] ?? 0;
    return {
      name: source,
      value: total > 0 ? (generation / total) * 100 : 0,
      generation,
      color: sourceColor(source),
    };
  });

  const hasData = total > 0;

  return (
    /*
      바탕을 흰색 → slate-50 으로 바꾸고 테두리를 뗀다.

      이 패널은 흰 카드("지역과 발전원 구성") 안에 든 칸이다. 카드가 테두리 대신
      얇은 그림자 한 겹만 쓰게 되면서, 흰 카드 위의 흰 패널을 가르던 것은 그 1px
      선 하나뿐이 됐다. 선을 그대로 두면 이 화면에서 테두리가 뜻하는 것("강조" 또는
      "누를 수 있음")과 어긋나고, 선만 떼면 패널이 카드에 녹아 없어진다.

      그래서 선 대신 바탕을 반 톤 내린다. 옆 지도 칸도 같은 방식(bg-slate-100)이라,
      카드 안에서 두 칸이 같은 문법으로 갈린다 — 선이 아니라 면으로.
    */
    <div className="h-full rounded-lg bg-slate-50">
      {/*
        이 패널의 높이가 지도 칸의 높이를 정한다(옆 칸이 grid stretch 로 따라온다).
        그래서 여기서 줄인 몇 px 이 파이프라인 1행 전체의 높이로 그대로 옮겨간다 —
        안쪽 여백 3 → 2.5, 지역명과 총발전량을 한 줄로 눕혀 약 20px 을 걷었다.
      */}
      <div className="px-2.5 pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-bold text-slate-800 truncate">{region.name}</p>
          <p className="text-[11px] text-slate-500 shrink-0">
            총 발전량(추정){' '}
            <span className="font-semibold text-slate-700 tabular-nums">
              {hasData ? `${formatMwh(total)} MWh` : '--'}
            </span>
          </p>
        </div>

        {/* 결론은 발전량(도넛)이 아니라 적합도에서 나오므로 hasData 와 무관하게 뜬다. */}
        {best && <BestSourceLine best={best} />}
      </div>

      {hasData ? (
        <>
          <div className="h-[124px] mt-0.5">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <ChartTooltip content={<SliceTooltip />} />
                {/* 반지름도 함께 줄인다 — 상자만 낮추면 도넛이 위아래로 잘린다. */}
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={32}
                  outerRadius={54}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  isAnimationActive={false}
                >
                  {data.map((slice) => (
                    // 조각 사이 2px 간격. 선 색은 패널 바탕(slate-50)과 같아야 "틈"으로
                    // 보인다 — 흰색을 그대로 두면 slate-50 위에서 밝은 선 네 개가
                    // 도넛 위에 얹힌 별개의 도형처럼 읽힌다.
                    <Cell key={slice.name} fill={slice.color} stroke="#f8fafc" strokeWidth={2} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* 범례 겸 직접 라벨. 그린·틸(태양광·풍력)은 밝은 배경 대비가 3:1 미만이라
              색만으로 구분하게 두면 안 되므로, 항목명과 비율을 글자로 함께 적는다. */}
          {/*
            범례 폭에 상한(17rem)을 두고 가운데로 모은다.

            비율(%)은 ml-auto 로 줄 오른쪽 끝에 붙는다. 좁은 화면에서는 이게 맞다 —
            숫자가 한 열로 정렬돼 서로 비교된다. 그런데 이 패널은 ① 칸의 남는 폭을
            전부 받으므로(지도 칸은 14rem 고정) 화면이 넓어질수록 혼자 늘어난다:
            1366px 에서 263px 이던 범례가 1920/2560px 에서는 377px 이 되고, 항목명과
            비율 사이가 51px → 108px 로 벌어져 "태양광 ......... 16%" 처럼 둘이 같은
            줄이라는 것이 잘 안 읽힌다.

            17rem(272px)은 1366px 에서의 실측 폭(263px)보다 크므로 그 해상도에서는
            아무것도 바뀌지 않고, 넓은 화면에서만 상한이 걸린다. mx-auto 로 가운데에
            두는 이유는 위 도넛도 가운데 정렬이라서다 — 둘의 중심축을 맞춘다.
          */}
          <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5 px-2.5 pb-1.5 w-full max-w-[17rem] mx-auto">
            {data.map((slice) => (
              <li key={slice.name} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-slate-500 truncate">{slice.name}</span>
                <span className="ml-auto font-semibold text-slate-700 tabular-nums">
                  {Math.round(slice.value)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        // 값이 0인 것과 아직 안 온 것은 다르다. 에너지 믹스를 원자력 100%로
        // 두면 네 발전원이 모두 실제로 0이 되는데, 그때 "불러오는 중"이라고
        // 하면 오지 않을 데이터를 기다리게 만든다.
        <p className="px-2.5 py-5 text-xs text-slate-400 text-center leading-relaxed">
          {isLoaded
            ? '현재 에너지 믹스에서는 이 네 발전원의 추정 발전량이 0입니다. 원자력은 이 차트에 포함되지 않습니다.'
            : '이 지역의 발전 구성을 불러오는 중입니다.'}
        </p>
      )}

      {/*
        지도 원 크기까지 함께 밝힌다. 같은 내용이 지역 select 아래에도 적혀 있었는데,
        그쪽은 숫자가 없는 자리라 각주만 세 줄 서 있었다. 값이 있는 이 패널에 모았다.

        KPX 실시간 연동이 붙었는지에 따라 문장이 갈린다. 문구만 조건 분기하고
        위치·크기·※ 기호는 그대로 둔다 — 각주가 자리를 옮기면 같은 정보가 두
        모양으로 보인다.

        실데이터일 때도 "전부 실측"이라고 적지 않는다. KPX 발전량 현황은 전국
        단위이므로 **지역별 배분은 여전히 추정**이고, 지도 원 크기가 바로 그
        배분이다. 무엇이 실데이터로 바뀌었고 무엇이 그대로인지를 한 문장에 함께
        적는 것이 이 각주의 일이다.
      */}
      <p className="px-2.5 pb-2.5 text-[10px] text-slate-400 leading-tight">
        {dataSource === 'live'
          ? '※ 이 구성은 한국전력거래소 실시간 발전원별 발전량 데이터를 반영했습니다. 다만 지도 원 크기(지역별 배분)는 여전히 지역 효율계수 기반 추정 시뮬레이션값입니다.'
          : '※ 이 구성과 지도 원 크기는 실제 발전량 통계가 아니라, 지역 효율계수·기상·에너지 믹스로 계산한 추정 시뮬레이션값입니다.'}
      </p>
    </div>
  );
}
