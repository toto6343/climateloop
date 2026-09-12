'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import MapWrapper from './components/MapWrapper';
import { BestSourceHint, RegionStat, sourceColor } from './components/energySources';
import { REGION_NAMES } from './components/regions';
import { RegionSourceMix } from './components/RegionSourceMix';

/*
  시뮬레이션 결과의 타입과 표시용 상수는 components/simulationTypes.ts 로 옮겼다.
  PDF 리포트(PdfReport.tsx)가 같은 결과를 다시 그리므로 두 곳이 같은 정의를 봐야 하고,
  컴포넌트가 페이지 모듈을 거꾸로 import 하는 모양은 피한다.
*/
import {
  AiSource,
  EnergyMixValues,
  Factor,
  FactorStatus,
  Goal,
  GridStatus,
  LevelState,
  MixKey,
  NextAction,
  ProjectionPoint,
  ScenarioCarbon,
  SimulationResult,
  RegionComparison,
  SuitabilityBasis,
  WeatherInfo,
  WeatherSnapshot,
    ClimateNormals,
  GRID_STATUS_LABELS,
  MIX_COLORS,
  MIX_LABELS,
  formatSigned,
} from './components/simulationTypes';
import PdfReport, { ReportData } from './components/PdfReport';
import GisangiGreeting from './components/GisangiGreeting';
import EnergyQuizCard from './components/EnergyQuizCard';
import { QUIZ_POOL, pickNextQuizIndex } from './components/energyQuiz';

import { Sun, Wind, Droplets, Flame, CloudRain, CloudLightning, Snowflake, ShieldAlert, Download, Sparkles, Zap, CircleAlert, Send, X, MapPin, Gauge, Copy, Check, Award, GraduationCap, ArrowUp } from 'lucide-react';

// 아이콘 색은 SOURCE_COLORS에서 가져온다. 지도 오버레이의 원형 차트와 같은 색이라야
// 같은 화면에 뜬 두 표현이 같은 발전원을 가리킨다는 것이 색만으로 읽힌다.
const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  '태양광': Sun,
  '풍력': Wind,
  '수력': Droplets,
  '화력': Flame
};

/** 요약 카드 한 줄의 아이콘. 백엔드가 모르는 발전원을 보내면 아이콘 없이 이름만 나온다. */
function SourceIcon({ source }: { source: string }) {
  const Icon = SOURCE_ICONS[source];
  if (!Icon) return null;
  return <Icon className="w-4 h-4" style={{ color: sourceColor(source) }} />;
}

/*
  기후 시나리오 탭.

  아이콘 색을 뺐다(주황·회색·황색·하늘색 → currentColor). 이 아이콘들은 값을
  나타내지 않는 라벨 장식인데, 네 탭에 네 가지 색이 돌면서 아래 발전원 데이터 색과
  섞여 "색이 무언가를 뜻한다"는 오해를 만들었다. 지금은 글자 색을 그대로 물려받아,
  선택된 탭에서만 브랜드 색이 되고 나머지는 무채색이다.
*/
const WEATHER_SCENARIOS: { id: string; label: string; icon: React.ReactNode; description: string }[] = [
  { id: '맑음', label: '맑음/화창', icon: <Sun className="w-4 h-4" />, description: "태양광 발전량이 높고 전력 수요가 안정적입니다." },
  { id: '흐림/비', label: '장마/폭우', icon: <CloudRain className="w-4 h-4" />, description: "태양광 발전량이 크게 감소하고 풍력도 다소 줄며, 전력 수요는 조금 늘어납니다." },
  { id: '태풍', label: '태풍/강풍', icon: <CloudLightning className="w-4 h-4" />, description: "안전을 위해 풍력 발전이 중단되고, 전력망이 불안정해질 수 있습니다." },
  { id: '겨울', label: '한파/겨울', icon: <Snowflake className="w-4 h-4" />, description: "난방 수요가 급증하고 일조 시간이 짧아져 전력망에 부담이 됩니다." },
];

/*
  PDF 리포트가 시나리오를 화면 탭과 같은 이름·같은 순서로 세우도록 여기서 뽑아 준다.
  PdfReport 가 WEATHER_SCENARIOS 를 직접 import 하지 않는 이유는, 그 배열이 아이콘
  JSX 까지 들고 있어 리포트가 화면용 아이콘 컴포넌트에 딸려 들어가기 때문이다.
*/
const SCENARIO_LABELS: Record<string, string> = Object.fromEntries(
  WEATHER_SCENARIOS.map((scen) => [scen.id, scen.label]),
);
const SCENARIO_ORDER: string[] = WEATHER_SCENARIOS.map((scen) => scen.id);

/**
 * PDF 표지에 찍는 생성 일시. "2026년 8월 20일 14:32" 꼴.
 *
 * toLocaleString 을 쓰지 않는 이유: 실행 환경의 로케일에 따라 표기가 달라져,
 * 같은 버튼을 눌러도 사람마다 다른 모양의 리포트가 나온다.
 */
function formatStamp(now: Date): { display: string; slug: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const d = now.getDate();
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return {
    display: `${y}년 ${mo}월 ${d}일 ${hh}:${mm}`,
    // 파일명용. 표시 문자열에서 숫자만 걷어내면 월·일이 한 자리일 때 자리수가
    // 흐트러져 20268201451 처럼 읽을 수 없는 이름이 된다.
    slug: `${y}${pad(mo)}${pad(d)}_${hh}${mm}`,
  };
}

/**
 * 목표 진행률. 백엔드 goal.target이 단일 진실 원본이므로 임계값을 하드코딩하지 않는다.
 * results가 아직 없는 최초 렌더에서는 빈 게이지를 보여준다.
 */
function GoalProgress({ goal }: { goal?: Goal | null }) {
  const achieved = goal?.achieved ?? false;
  const progress = goal ? Math.min(100, Math.max(0, goal.progress_pct)) : 0;

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="group flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-600">지속 가능성 지수</span>
          {/*
            위치 기준(relative)을 묶음 전체가 아니라 물음표 아이콘에만 준다.

            예전에는 relative 가 [라벨 + 아이콘] 묶음에 걸려 있고 말풍선이 그 묶음의
            가운데(left-1/2 -translate-x-1/2)에 걸렸다. 이 묶음은 "결과 해석" 3단
            그리드의 첫 칸 왼쪽 끝에 있으므로, 화면 폭이 좁아 컨테이너가 max-w 상한에
            닿지 않는 구간(1600px 미만 — 1366px 노트북이 여기 들어간다)에서는 묶음
            중심이 화면 왼쪽에서 100px 밖에 안 떨어져 있다. w-64(256px) 말풍선을 그
            중심에 맞추면 왼쪽 128px 이 화면 밖으로 나가 27px 이 잘렸다. 1920/2560 에서는
            컨테이너가 가운데로 모이면서 여백이 생겨 안 잘렸다 — 넓은 화면에서만 멀쩡한
            버그였다.

            이제 기준이 아이콘이고 말풍선을 왼쪽으로 32px 만 밀어(-translate-x-8),
            어느 폭에서도 화면 안에 들어온다. 꼬리는 left-8 로 같은 32px 자리에 두어
            아이콘 중심을 그대로 가리킨다 — 이 두 값은 항상 같이 움직여야 한다.
          */}
          <span className="relative flex">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 group-hover:text-slate-900"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <div className="absolute bottom-full left-1/2 -translate-x-8 mb-2 w-64 p-2.5 bg-slate-800 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              탄소 배출량(55%), 전력망 안정성(30%), 지역 적합도(15%)를 가중평균한 점수입니다.
              지역 적합도는 이 지역·이 기상 조건의 재생에너지 잠재력과 현재 재생 비중이 얼마나 일치하는지를 봅니다.
              <span className="block mt-1.5 text-slate-300">
                탄소 항목에는 상대 비교용 예시 배출계수를 적용했으며, 공식 통계 수치가 아닙니다.
              </span>
              <div className="absolute top-full left-8 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800"></div>
            </div>
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className={`text-lg font-bold ${achieved ? 'text-brand-700' : 'text-slate-900'}`}>
            {goal ? goal.current : '--'}
          </span>
          <span className="text-xs text-slate-500">/ {goal ? goal.target : '--'}점</span>
        </div>
      </div>

      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ease-out ${achieved ? 'bg-brand-600' : 'bg-slate-400'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-xs text-slate-600 mt-1.5">
        {!goal
          ? '계산 중...'
          : achieved
            ? `목표 ${goal.target}점을 달성했습니다`
            : `목표까지 ${goal.gap}점`}
      </p>
    </div>
  );
}

/**
 * 학습 단계 표시. 목표 달성 이후에도 다음 단계가 남아 동기가 이어진다.
 * 최고 단계에 도달하면 level.next가 null로 오므로 안내 문구를 바꾼다.
 */
function LevelStepper({ level }: { level?: LevelState | null }) {
  const total = level?.total_levels ?? 4;
  const currentId = level?.current.id ?? 0;
  const steps = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-slate-600">학습 단계</span>
        <span className="text-sm font-bold text-slate-900">
          {level ? `${level.current.name} (${currentId}/${total})` : '--'}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {steps.map((step) => (
          <React.Fragment key={step}>
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-500 ${step <= currentId ? 'bg-brand-600' : 'bg-slate-200'}`} />
            {step < total && (
              <div className={`flex-grow h-0.5 transition-colors duration-500 ${step < currentId ? 'bg-brand-600' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      <p className="text-xs text-slate-600 mt-1.5">
        {!level
          ? '계산 중...'
          : level.next
            ? `다음 단계 '${level.next.name}'까지 ${level.to_next}점`
            : '최고 단계에 도달했습니다'}
      </p>
    </div>
  );
}

// /calculate 를 2단계로 나눠 호출한다.
//  1단계(include_ai=false): 점수·goal·level·factors·next_action. 응답 약 10ms.
//  2단계(include_ai=true) : AI 해설. LLM 호출이 붙어 약 10초.
// 조작 중에는 1단계만 반복하고, 조작이 멎은 뒤에야 2단계가 나간다.
const SCORE_DEBOUNCE_MS = 300;
const AI_DEBOUNCE_MS = 1200;

// 환경변수가 비어 있으면 요청이 `undefined/calculate` 상대경로로 나가 404가 된다.
// 그 상태로는 원인을 알 수 없으므로 요청 전에 걸러내고 조치 방법까지 안내한다.
//
// 끝의 슬래시는 떼어 낸다. 아래 호출은 모두 `${API_BASE_URL}/경로` 로 이어 붙이므로
// 값에 슬래시가 남아 있으면 `https://host//calculate` 가 된다. Vercel·Railway 의
// 환경변수 입력란에 주소를 복사해 넣으면 슬래시가 따라오는 일이 흔하다.
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
const MISSING_API_URL_MESSAGE =
  'NEXT_PUBLIC_API_URL이 설정되지 않았습니다. frontend/.env.local에 ' +
  'NEXT_PUBLIC_API_URL=http://localhost:8000 을 추가한 뒤 개발 서버를 다시 시작해 주세요.';
const BEGINNER_SESSION_KEY = 'climateloop-beginner-session-v1';
const BADGES_STORAGE_KEY = 'climateloop-learning-badges-v1';

const LEARNING_BADGES = [
  { id: 'explorer', label: '탐험 시작', description: '지역과 날씨를 골랐어요.' },
  { id: 'mixer', label: '에너지 요리사', description: '에너지 믹스를 직접 바꿨어요.' },
  { id: 'goal', label: '목표 도착', description: '지속 가능성 목표에 도착했어요.' },
] as const;

/** 화면에 띄울 한 줄짜리 원인 문구로 바꾼다. 상세 내용은 콘솔에 남긴다. */
function describeApiError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === MISSING_API_URL_MESSAGE) return error.message;
    // fetch는 네트워크 실패(서버 미기동, CORS, DNS)를 TypeError로 던진다
    if (error instanceof TypeError) {
      return `백엔드(${API_BASE_URL || '주소 미설정'})에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.`;
    }
    return error.message;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

/**
 * 재분배 가중치에 두 축 모두에게 얹어주는 최소 지분(%p).
 *
 * 순수 비율(base/currentTotalOther)만 쓰면 0%인 축은 가중치가 영원히 0이라
 * 되살아나지 못하고, 두 축의 합이 아주 작을 때도(예: 0.2 대 0) 반올림 수준의
 * 차이가 100:0 쏠림으로 증폭된다. 두 축에 같은 값을 더해 가중치를 만들면 두
 * 경우 모두 완만해지고, 합이 0이면 정확히 50:50이 되어 기존 예외 분기를
 * 그대로 대체한다. 백엔드 REDISTRIBUTE_FLOOR와 반드시 같은 값이어야 한다.
 */
const REDISTRIBUTE_FLOOR = 0.5;

/**
 * 슬라이더 조작 시 나머지 두 축을 기존 비율대로 재분배한다.
 * 백엔드 redistribute() 와 같은 규칙이라, projection 이 약속한 값과
 * 사용자가 슬라이더로 실제 도달하는 값이 일치한다.
 */
function redistributeMix(base: EnergyMixValues, lever: MixKey, newValue: number): EnergyMixValues {
  const others = (Object.keys(base) as MixKey[]).filter(k => k !== lever);
  const firstShare = Math.max(base[others[0]], 0);
  const secondShare = Math.max(base[others[1]], 0);
  const currentTotalOther = firstShare + secondShare;
  const newTotalOther = 100 - newValue;

  // 최소 지분은 나머지 두 축이 몫을 "돌려받는" 방향일 때만 얹는다.
  // 늘어나는 몫에만 바닥을 깔면 0%인 축이 다시 자라면서도, lever를 올릴 때
  // (=두 축이 줄어들 때)의 순수 비율은 종전 그대로다. 후자까지 건드리면
  // "재생을 올렸는데 0이던 화석이 되살아나 배출량이 오히려 는다"가 생겨
  // 백엔드 build_projection이 약속한 단조 감소가 깨진다.
  const floor = newTotalOther > currentTotalOther ? REDISTRIBUTE_FLOOR : 0;
  const firstWeight = firstShare + floor;
  const secondWeight = secondShare + floor;
  const totalWeight = firstWeight + secondWeight;

  const [first, second] = totalWeight <= 0
    // lever가 100%라 나눠줄 몫 자체가 없는 경우
    ? [newTotalOther / 2, newTotalOther / 2]
    : [newTotalOther * (firstWeight / totalWeight), newTotalOther * (secondWeight / totalWeight)];

  return { ...base, [lever]: newValue, [others[0]]: first, [others[1]]: second };
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** 계산 중임을 알리는 배지. 기존 결과를 지우지 않고 갱신 중임만 알린다. */
function UpdatingBadge() {
  return (
    /*
      알약(바탕+테두리+rounded-full)이었다. 이 배지는 "지금 계산 중"이라는 한때의
      상태를 알리는 것뿐인데, 상시로 떠 있는 "현재"·"목표 달성" 배지와 같은 모양이라
      같은 무게로 읽혔다. 글자와 스피너만 남긴다.
    */
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 shrink-0">
      <Spinner className="w-3 h-3" />
      업데이트 중
    </span>
  );
}

/**
 * AI 해설의 출처 배지.
 *
 * LLM이 쓴 문장과 백엔드의 결정론적 요약이 같은 자리·같은 라벨로 나오면
 * 사용자는 둘을 구분할 수 없다. 어느 쪽인지 밝히는 것이 목적이므로,
 * 폴백을 "실패"처럼 보이게 하지 않는다 — 결정론적 요약도 그 자체로 읽을
 * 만한 정상 산출물이라 경고색 대신 중립색(slate)을 쓴다.
 */
function AiSourceBadge({ source }: { source: AiSource }) {
  const isLlm = source === 'llm';
  return (
    <span
      title={isLlm
        ? 'LLM이 생성한 해설입니다.'
        : '계산 결과로 만든 요약입니다. AI 호출 없이 즉시 생성됩니다.'}
      /*
        LLM 이든 폴백이든 같은 무채색 글자로 둔다. 알약 바탕을 걷어낸 이유는 위
        UpdatingBadge 와 같다 — 이 배지는 출처를 밝히는 각주에 가깝고, 상태 배지와
        같은 모양을 쓸 만큼 강조할 것이 아니다. 구분은 아이콘과 글자가 진다.
      */
      className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 shrink-0"
    >
      {isLlm ? <Sparkles className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
      {isLlm ? 'AI 생성' : '즉시 요약'}
    </span>
  );
}

/** 배출량 비교 막대의 색. 강조(현재) 1색 + 나머지는 무채색. */
// 강조 막대는 브랜드 색. 이 막대가 말하는 것은 배출강도(값)지만, 넷 중 하나만
// 물들이는 이유는 "지금 고른 것"을 가리키는 것이므로 선택 상태와 같은 색을 쓴다.
// 나머지는 맥락으로 물러난 무채색이다.
const SCENARIO_BAR_CURRENT = '#4338ca';  // brand-600
const SCENARIO_BAR_OTHER = '#94a3b8';    // slate-400 — 맥락으로 물러난 나머지

/**
 * 기후 시나리오별 배출강도 비교. 믹스는 고정, 기후만 바꾼 결과다.
 *
 * 강조(emphasis) 형식을 쓴다 — 현재 시나리오만 브랜드 인디고, 나머지는 회색. 4개 막대에
 * 4가지 색을 쓰면 "지금 어디에 있는지"가 묻힌다. 색만으로 구분하게 두지 않도록
 * 모든 행에 이름과 수치를 글자로 적는다(회색 막대의 배경 대비는 2.5:1).
 *
 * 값은 백엔드가 화면 대표 수치와 같은 simulate()로 계산한다. 프론트에서 다시
 * 유도하지 않으므로 막대와 헤더의 숫자가 어긋날 수 없다.
 */
function ScenarioCarbonBars({ rows, isCalculating }: { rows?: ScenarioCarbon[] | null; isCalculating: boolean }) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-slate-500 py-4">계산 중...</p>;
  }

  const byScenario = new Map(rows.map((row) => [row.scenario, row]));
  // 탭과 같은 순서로 세운다. 백엔드가 시나리오를 추가하면 목록에 없는 것도 뒤에 붙인다.
  const ordered = [
    ...WEATHER_SCENARIOS.map((scen) => ({ label: scen.label, row: byScenario.get(scen.id) })),
    ...rows
      .filter((row) => !WEATHER_SCENARIOS.some((scen) => scen.id === row.scenario))
      .map((row) => ({ label: row.scenario, row })),
  ].filter((item): item is { label: string; row: ScenarioCarbon } => item.row !== undefined);

  const current = rows.find((row) => row.is_current);
  // 막대 길이는 0을 기준으로 하고, 네 값 중 최댓값을 화면 폭에 맞춘다.
  const max = Math.max(...ordered.map((item) => item.row.carbon_emissions), 1);

  return (
    <ul className={`space-y-1.5 transition-opacity duration-200 ${isCalculating ? 'opacity-60' : 'opacity-100'}`}>
      {ordered.map(({ label, row }) => {
        const isCurrent = row.is_current;
        const delta = current ? row.carbon_emissions - current.carbon_emissions : 0;

        return (
          <li
            key={row.scenario}
            title={`${label} · 배출강도 ${row.carbon_emissions.toFixed(1)} gCO₂/kWh · `
              + `전력망 ${GRID_STATUS_LABELS[row.grid_status]} · `
              + `재생 실현 ${row.renewable_delivered.toFixed(1)}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`text-xs truncate ${isCurrent ? 'font-bold text-slate-800' : 'font-medium text-slate-600'}`}>
                  {label}
                </span>
                {isCurrent && (
                  <span className="text-[10px] font-bold text-white bg-brand-600 px-1.5 rounded-full shrink-0">
                    현재
                  </span>
                )}
              </span>
              <span className="flex items-baseline gap-1.5 shrink-0">
                <span className={`text-xs tabular-nums ${isCurrent ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                  {row.carbon_emissions.toFixed(1)}
                </span>
                {!isCurrent && Math.abs(delta) >= 0.05 && (
                  <span className={`text-[10px] font-semibold tabular-nums ${delta > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {formatSigned(delta)}
                  </span>
                )}
              </span>
            </div>
            {/* 트랙 위의 막대. 데이터 끝만 둥글게 하고 기준선(0) 쪽은 각을 유지한다. */}
            <div className="w-full h-2.5 bg-slate-100 rounded-sm">
              <div
                className="h-full rounded-r-[3px] transition-all duration-500 ease-out"
                style={{
                  width: `${(row.carbon_emissions / max) * 100}%`,
                  backgroundColor: isCurrent ? SCENARIO_BAR_CURRENT : SCENARIO_BAR_OTHER,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * ③ 탄소 배출 시뮬레이션 카드.
 *
 * 입력을 하나씩만 움직여 본 두 곡선을 함께 싣는다 — "믹스 고정 · 기후 변화"와
 * "기후 고정 · 믹스 변화". 한동안 뒤쪽은 ③ 에너지 믹스 카드가 들고 있었지만,
 * 그 카드가 조작기를 요약 카드에 내주고 없어지면서 짝이 되는 이 자리로 돌아왔다.
 *
 * 현재 배출강도(스파크라인)도 이 카드로 옮겼다. 예전에는 적합도 카드 헤더에
 * 있었는데, 적합도 카드에서 가장 큰 숫자가 적합도가 아니라 배출량인 상태였다.
 */
function CarbonEmissionCard({
  carbon,
  history,
  byScenario,
  projection,
  scenarioLabel,
  isCalculating,
}: {
  carbon: number;
  history: number[];
  byScenario?: ScenarioCarbon[] | null;
  /** 기후 고정 · 믹스 변화 곡선용. 계산은 백엔드가 하고 여기서는 그리기만 한다 */
  projection?: ProjectionPoint[] | null;
  scenarioLabel: string;
  isCalculating: boolean;
}) {
  return (
    <div className="bg-white p-3 rounded-lg shadow-card">
      {/* 단계 배지·제목·설명을 한 줄로 눕힌다. 세로로 쌓으면 세 줄(약 90px)이 된다. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900">탄소 배출 시뮬레이션</h2>
          <p className="text-[11px] text-slate-600">
            위에서 고른 <span className="font-semibold text-slate-800">지역·기후</span>와
            아래에서 조정하는 <span className="font-semibold text-slate-800">에너지 믹스</span>가 함께 만드는 값입니다
          </p>
        </div>
        {isCalculating && <UpdatingBadge />}
      </div>

      {/*
        세 그림을 나란히 세운다 — 현재값(스파크라인) · 기후만 바꾼 비교 · 믹스만 바꾼 곡선.
        예전에는 이 셋이 세로로 쌓이면서 카드 하나가 790px 이었다. 셋 다 같은 배출강도를
        서로 다른 축으로 자른 것이므로 나란히 놓이는 편이 비교에도 맞는다.

        폭 배분: 현재값 타일은 숫자 하나라 좁아도 되고(14rem 고정), 남는 폭은 막대 목록과
        꺾은선이 1:1.3 으로 나눈다 — 꺾은선은 x축에 5개 눈금이 들어가야 라벨이 겹치지 않는다.
      */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1.3fr)] gap-3 mt-2">
        <CarbonEmissionChart current={carbon} history={history} />

        {/* 믹스 고정 · 기후 변화 */}
        <div className="xl:border-l xl:border-slate-200 xl:pl-3">
          <h3 className="text-sm font-semibold text-slate-800">기후 시나리오별 비교</h3>
          <p className="text-[11px] text-slate-600 mt-0.5 mb-2">
            믹스는 그대로 두고 기후만 바꿨을 때 (gCO₂/kWh)
          </p>
          <ScenarioCarbonBars rows={byScenario} isCalculating={isCalculating} />
        </div>

        {/* 기후 고정 · 믹스 변화 */}
        <div className="md:col-span-2 xl:col-span-1 xl:border-l xl:border-slate-200 xl:pl-3">
          <MixProjectionChart
            projection={projection}
            scenarioLabel={scenarioLabel}
            isCalculating={isCalculating}
          />
        </div>
      </div>

      {/*
        각주 하나로 모았다. 예전에는 세 덩어리마다 ※ 줄이 따로 붙어 세 곳에서
        "실제 관측치가 아니다"를 되풀이했고, 셋이 합쳐 90px 을 먹었다. 내용은
        그대로 남기고 중복만 걷어낸다.
      */}
      <p className="text-[11px] text-slate-500 mt-2 leading-snug">
        ※ 기상이 재생 발전을 눌러 실제 인도 전력의 화력 비중이 올라가면 1kWh당 배출량도 함께 오릅니다
        (태풍은 풍력 정지·태양광 10%). 오른쪽 점선은 현재 배출강도입니다.
        세 값 모두 과거 관측치가 아니라 지금 설정으로 계산한 시뮬레이션이며,
        배출계수는 상대 비교용 예시값(재생·원자력 12, 화력 650 gCO₂/kWh)으로 공식 통계가 아닙니다.
      </p>
    </div>
  );
}

/**
 * ③ 에너지 믹스 변화 곡선. 기후는 고정하고 재생에너지 비중만 단계별로 올려본다.
 *
 * 조작(슬라이더)은 "시뮬레이션 요약" 카드 한 곳에 있다. 거기서 비중을 움직이면
 * 이 곡선의 출발점(현재)이 함께 옮겨간다.
 *
 * 이전에는 2020~2024년 배출량을 프론트에 상수로 박아두고 2025년만 실제 값을
 * 썼다. 실제 관측치처럼 보이지만 출처가 없는 수치였으므로, 축 자체를 연도가 아니라
 * "재생에너지를 얼마나 늘렸는가"로 바꿨다.
 */
function MixProjectionChart({
  projection,
  scenarioLabel,
  isCalculating,
}: {
  projection?: ProjectionPoint[] | null;
  scenarioLabel: string;
  isCalculating: boolean;
}) {
  // 백엔드는 숫자만 준다. 축/툴팁 표기는 여기서 만든다.
  const data = projection?.map((point) => ({
    ...point,
    label: point.step === 0 ? '현재' : `+${point.step}%p`,
    fullLabel:
      point.step === 0
        ? `현재 에너지 믹스 (재생 ${Math.round(point.renewable)}%)`
        : `재생에너지 +${point.step}%p → 재생 ${Math.round(point.renewable)}%` +
          (point.clamped ? ' (상한 도달)' : ''),
  })) ?? null;

  const current = data?.[0];
  const last = data?.[data.length - 1];
  const reduction = current && last ? current.carbon_emissions - last.carbon_emissions : 0;

  // y축 상한을 50 단위로 올려 눈금이 깔끔한 숫자로 떨어지게 한다.
  // 'dataMax + 50'을 쓰면 최상단 눈금이 배출량 원값을 그대로 물려받아
  // "292.77g" 처럼 읽히지 않는 값이 나온다.
  const yMax = data
    ? Math.max(50, Math.ceil((Math.max(...data.map((point) => point.carbon_emissions)) * 1.12) / 50) * 50)
    : 50;

  const renderDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (cx === undefined || cy === undefined) return <g />;
    // 기준점(현재)만 크게 강조한다
    if (index === 0) {
      return <circle cx={cx} cy={cy} r={7} fill="#4338ca" stroke="white" strokeWidth={2} />;
    }
    return <circle cx={cx} cy={cy} r={4} fill="#4338ca" />;
  };

  return (
    <div className={`transition-opacity duration-200 ${isCalculating ? 'opacity-60' : 'opacity-100'}`}>
      <h3 className="text-sm font-semibold text-slate-800">에너지 믹스 변화</h3>
      <p className="text-[11px] text-slate-600 mt-0.5 mb-1 leading-snug">
        <span className="font-semibold text-slate-800">{scenarioLabel}</span> 조건에서 재생에너지 비중을 단계별로 높였을 때
        {current && last && reduction > 0 && (
          <>
            {' — '}
            <span className="font-bold text-slate-900">{Math.round(last.renewable - current.renewable)}%p</span> 늘리면{' '}
            <span className="font-bold text-green-700">{reduction.toFixed(1)}g 감소</span>
          </>
        )}
      </p>
      {/*
        h-52(208px) → h-40(160px). 이 차트의 x축은 눈금 5개, y축은 4~5개짜리라
        160px 에서도 눈금이 겹치지 않는다. 남는 48px 은 카드가 옆 칸들과 같은
        220px 안에 들어가는 데 그대로 쓰인다.
      */}
      <div className="h-40">
        {data ? (
          <ResponsiveContainer width="100%" height="100%">
            {/*
              오른쪽 여백 20 → 30.

              x축 마지막 눈금("+30%p")은 그 데이터점 위에 가운데 정렬로 놓이므로
              라벨 폭의 절반(12px Arial 기준 19px)이 플롯 영역 밖 오른쪽 여백을
              쓴다. 여백이 20px 이던 동안 1366px 화면에서 라벨 오른쪽 끝과 svg
              오른쪽 끝 사이가 0.9px 이었다 — 잘리지는 않았지만 1px 만 어긋나면
              (폰트 대체, 반올림, 눈금 문자열이 한 자 늘어남) 그대로 잘린다.
              svg 는 자기 경계에서 넘치는 그림을 잘라내므로 조용히 사라진다.
              30 으로 올리면 11px 의 여유가 생기고, 플롯이 10px 좁아지는 것은
              눈금 5개짜리 이 차트에서 눈금 간격에 영향을 주지 않는다.
            */}
            <LineChart data={data} margin={{ top: 5, right: 30, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" stroke="#475569" fontSize={12} />
              <YAxis stroke="#475569" fontSize={12} unit="g" domain={[0, yMax]} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '0.5rem', color: 'white' }}
                itemStyle={{ color: 'white' }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
              />
              {/*
                isAnimationActive={false} — 선이 그려지지 않던 원인이다.

                증상: 점 네 개는 제 자리에 찍히는데 잇는 선이 없거나, 현재 → +10%p
                까지만 그려지고 뒤가 끊겼다. 데이터가 모자란 것으로 오해하기 쉬운
                모양이지만 그렇지 않다 — 백엔드 build_projection() 은 (0, 10, 20, 30)
                네 지점 모두를 simulate() 로 실제 계산해서 내려주고, 응답에도 네 점의
                carbon_emissions 가 모두 들어 있다. 끊긴 곳에 "미탐색 구간" 같은 것은
                없다.

                원인은 recharts 의 등장 애니메이션이다. <Line> 은 선을 그려 나가는
                효과를 strokeDasharray 를 "0px {전체길이}px" 에서 "{전체길이}px 0px"
                로 움직여 만든다. 그런데 이 차트는 슬라이더·기후 탭·지역 select 어느
                것을 건드려도 results 가 새로 오면서 다시 렌더된다. 애니메이션이 끝나기
                전에 렌더가 겹치면 dasharray 가 중간값에 멈춘 채 남고, 그 값이 0 에
                가까우면 선 전체가, 절반쯤이면 뒤쪽 구간이 통째로 안 보인다. 첫 화면
                에서도 /regions 와 /calculate 응답이 잇따라 도착하면서 같은 일이 난다.

                끄면 선은 매 렌더마다 완성된 path 로 한 번에 나온다. 이 화면의 다른
                recharts 차트(발전원 도넛, PDF 리포트 두 곳)도 같은 이유로 이미
                꺼 두었다 — 여기만 남아 있었다.
              */}
              <Line
                type="monotone"
                dataKey="carbon_emissions"
                stroke="#4338ca"
                strokeWidth={2}
                dot={renderDot}
                activeDot={{ r: 6 }}
                name="배출량"
                unit=" gCO2/kWh"
                isAnimationActive={false}
              />
              {current && <ReferenceLine y={current.carbon_emissions} stroke="#4338ca" strokeDasharray="4 4" />}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-500">계산 중...</div>
        )}
      </div>
    </div>
  );
}

/**
 * 현재 배출강도 + 최근 조작에 따른 추이 스파크라인.
 *
 * 데이터 흐름은 그대로다(current + history). 자리만 적합도 카드 헤더에서
 * 탄소 배출 카드 안으로 옮겼고, 파란 숫자를 대비가 확보되는 진한 남색으로 바꿨다.
 */
function CarbonEmissionChart({ current, history }: { current: number; history: number[] }) {
  const last = history.length > 1 ? history[history.length - 2] : 0;
  const change = current - last;

  const max = Math.max(...history, 1); // 0으로 나누는 것 방지
  const min = Math.min(...history);
  const range = max - min === 0 ? 1 : max - min;

  // 점이 하나뿐이면 x 좌표가 0/0 이 되어 선을 그릴 수 없다. 그때는 선을 생략한다.
  const hasTrend = history.length > 1;
  const points = hasTrend
    ? history.map((val, i) => {
        const x = (i / (history.length - 1)) * 100;
        const y = 100 - ((val - min) / range) * 100;
        return `${x},${y}`;
      }).join(' ')
    : '';

  return (
    /*
      3칸 중 첫 칸으로 들어가면서 세로 타일이 됐다. 옆 두 칸(막대 목록·꺾은선)이
      220px 안팎이므로 h-full 로 그 높이를 받고, 숫자를 가운데로 모아 이 카드에서
      가장 큰 값이 화면 왼쪽에서 먼저 읽히게 한다 — 이 칸의 역할은 "지금 몇인가"다.
    */
    <div className="flex h-full flex-col justify-center gap-2 rounded-lg bg-slate-50 p-3">
      <div>
        <p className="text-xs font-medium text-slate-600">현재 배출강도</p>
        <p className="text-3xl font-bold text-slate-900 tabular-nums leading-tight">
          {current.toFixed(1)}{' '}
          <span className="text-xs font-medium text-slate-600">gCO₂/kWh</span>
        </p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-slate-600 mb-1">최근 조작 추이</p>
        {hasTrend ? (
          <svg width="100%" height="28" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="최근 배출강도 추이">
            <polyline fill="none" stroke={change > 0 ? '#b91c1c' : '#15803d'} strokeWidth="5" points={points} />
          </svg>
        ) : (
          <p className="text-[11px] text-slate-500">조작하면 표시됩니다</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 파이프라인의 순서를 무엇으로 말하는가
//
// 지역·기후 선택 → 적합도 → 탄소 배출은 하나의 흐름이다. 한동안 그 순서를 화면에
// 그려 넣어 두었다 — 카드 제목 위에 얹는 검은 원형 단계 번호와, 카드 사이를 잇는
// 흰 알약 모양 화살표 두 종류의 부품이 있었다.
//
// 둘 다 걷어냈다. 카드가 열 장을 넘어가면서 원과 알약이 겹겹이 얹혀, 정작 읽어야 할
// 값보다 "1 · 2 · 3" 이라는 장식이 먼저 눈에 들어왔다. 그리고 그 번호들은 실제로
// 아무 정보도 더하지 않았다 — 카드 제목이 이미 "지역과 발전원 구성", "지역별 에너지
// 적합도", "탄소 배출 시뮬레이션" 이라고 순서대로 적고 있고, 섹션 머리글도
// "지역 → 기후·적합도 → 탄소 배출" 이라고 한 줄로 말한다.
//
// 지금 순서를 만드는 것은 배치와 글자 크기뿐이다: 위에서 아래로 읽히는 자리, 섹션
// 제목(text-sm)과 카드 제목(text-base)과 본문(text-[11px]) 사이의 크기 차이, 그리고
// 그 사이의 여백. 화면에 선과 원을 더 그리지 않고도 같은 것을 말한다.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 적합도 근거
//
// 적합도 4개 값은 백엔드가 계산해 내려준다. 여기서는 "그 값이 어떤 입력에서
// 나왔는지"만 되짚는다 — 곱셈의 각 항(믹스 비중 · 지역 계수 · 기상 배수)을 모두
// 응답에서 그대로 가져오고, 곱은 화면 표시용으로만 쓴다. 적합도를 프론트에서
// 다시 계산하면 언젠가 한쪽만 고쳐져 근거가 값을 반박하게 된다.
// ---------------------------------------------------------------------------

/** 적합도 카드 표시 순서. 백엔드 suitability 의 키와 같은 문자열이어야 한다. */
const SUITABILITY_ORDER = ['태양광', '풍력', '수력', '화력'] as const;

/** 값이 오기 전에도 카드 4장이 자리를 지키도록. */
const EMPTY_SUITABILITY: Record<string, number> = { '태양광': 0, '풍력': 0, '수력': 0, '화력': 0 };

/** 계산식의 곱셈 한 항. */
interface ReasonTerm {
  label: string;
  value: string;
}

interface SuitabilityReason {
  terms: ReasonTerm[];
  /** 상한 100 적용 전의 곱. 상한에 걸렸는지 보이려면 원값이 필요하다 */
  raw: number;
  clamped: boolean;
  /** 요약 한 줄에 붙일 짧은 근거. 발전원마다 실제로 곱해지는 항만 말한다 */
  headline: string;
  /** 왜 이 값이 이만큼인지 — 토글 안의 한 문장 */
  why: string;
  /** 부연: 지역 계수 유불리, 기상 영향, 슬라이더와의 관계 */
  notes: string[];
}

const formatCoefficient = (value: number) => value.toFixed(2);
const formatMultiplier = (value: number) => value.toFixed(1);
const formatPercent = (value: number) => `${Math.round(value)}%`;
/** 45.0 처럼 뒤에 붙는 0을 떼고 보여준다. */
const formatIndex = (value: number) => String(Number(value.toFixed(1)));

/** 계수 열의 출처 키. 백엔드 coefficient_source.json 의 covered_sources 값이다. */
type CoefficientOrigin = 'kpx_file' | 'kea_file' | 'kpx' | 'builtin';

/** 발전원 이름 → covered_sources 의 키. 백엔드 EFF_COLUMNS 와 같은 이름이다. */
const SOURCE_TO_FACTOR_KEY: Record<string, 'solar' | 'wind' | 'hydro' | 'thermal'> = {
  '태양광': 'solar',
  '풍력': 'wind',
  '수력': 'hydro',
  '화력': 'thermal',
};

/**
 * 지역 계수가 어떤 데이터에서 나왔는지 한 조각 — **발전원마다 다르다.**
 *
 * 계수 68개(17개 시·도 × 4개 발전원)의 출처는 열마다 갈린다. 지금은 화력만
 * EPSIS 지역별 발전설비 설비용량에서 유도하고, 태양광·풍력·수력은 내장 추정표다.
 * EPSIS 의 발전형식 구분에 태양광·풍력·수력이 없어서(전부 "신재생" 한 덩어리이고
 * 수력은 별도 열조차 없다) 넷을 한 번에 바꿀 수 없었다.
 *
 * 그래서 문구를 한 개만 두면 넷 중 셋이 거짓이 된다. 발전원을 받아 그 열의
 * 출처만 말한다 — 없는 출처를 주장하지 않는다는 이 화면의 원칙(README 9.3)이
 * 열 단위로도 지켜져야 한다.
 */
export function describeCoefficientOrigin(origin: CoefficientOrigin): string {
  switch (origin) {
    case 'kpx_file':
      return '한국전력거래소 지역별 발전설비 설비용량(2025) 기반';
    case 'kea_file':
      return '한국에너지공단 신·재생에너지 보급용량(2024) 기반';
    case 'kpx':
      return '한국전력거래소 전력시장 발전설비 정보 기반';
    default:
      return '내장 추정표 기반 · 공공데이터 미연동';
  }
}

/** covered_sources 에서 이 발전원의 출처를 꺼낸다. 모르면 내장 표로 본다. */
function coefficientOriginFor(
  source: string,
  covered?: Partial<Record<'solar' | 'wind' | 'hydro' | 'thermal', string>>,
): CoefficientOrigin {
  const key = SOURCE_TO_FACTOR_KEY[source];
  const value = key ? covered?.[key] : undefined;
  return value === 'kpx_file' || value === 'kea_file' || value === 'kpx'
    ? value
    : 'builtin';
}

/**
 * 계수가 무엇을 재는 값인지 한 줄.
 *
 * 네 발전원 모두 공표 설비용량에서 나오므로 의미가 하나로 모였다 — "그 지역에
 * 이 발전원의 설비가 얼마나 모여 있는가"(공급). 종전 내장 표는 "그 발전원이 이
 * 지역에서 얼마나 잘 돌아가는가"(자원 여건)를 가정한 값이었고, 방향이 다르다.
 *
 * 그 차이가 가장 크게 벌어지는 곳이 풍력이다 — describeCoefficientCaveat 참고.
 */
function describeCoefficientMeaning(origin: CoefficientOrigin): string {
  return origin === 'builtin'
    ? '이 발전원이 이 지역에서 얼마나 잘 돌아가는지를 가정한 상대 지수'
    : '지역 내 발전설비 집중도(설비용량 기준)';
}

/**
 * 설비 기준 계수가 오해를 사는 지점을 발전원별로 한 줄.
 *
 * 계수를 설비용량으로 바꾸면 "자원은 좋은데 아직 안 지은 지역"이 낮게 나온다.
 * 값 자체는 정확하지만, 사용자가 들고 있는 상식과 어긋나는 자리가 발전원마다
 * 다르므로 그 자리에서 각각 짚어 준다. 내장 표(builtin)인 열에는 이 경고가
 * 필요 없다 — 그 값은 애초에 자원 여건을 가정한 것이다.
 *
 *   화력  설비가 모인 곳 ≠ 전력을 많이 쓰는 곳. 서울이 1.30 → 0.87 로 내려간 이유다.
 *   풍력  설비가 모인 곳 ≠ 바람이 좋은 곳. 부산이 1.30 → 0.10 으로 떨어진 이유다 —
 *         연안 풍력 여건은 있지만 실측 설비가 45kW 뿐이다. 이 열은 하한(0.10)에
 *         다섯 지역(부산·광주·울산·세종·충북)이 함께 붙어 서로 구분되지 않는다.
 *   태양광·수력  같은 성격이지만 편차가 덜 극단적이라 한 문장으로 족하다.
 */
function describeCoefficientCaveat(source: string, origin: CoefficientOrigin): string | null {
  if (origin === 'builtin') return null;
  switch (source) {
    case '화력':
      return '설비가 모여 있다는 것과 그 지역이 화력에 의존한다는 것은 다릅니다 — 수요가 큰 대도시는 설비가 적어도 전력을 많이 씁니다.';
    case '풍력':
      return '설비 집중도(공급)와 바람 자원 잠재력은 다릅니다 — 자원이 좋아도 아직 설비가 적은 지역이 있습니다. 설비가 거의 없는 지역은 여럿이 하한값(0.10)에 함께 놓입니다.';
    case '태양광':
      return '설비 집중도(공급)와 일사 자원 잠재력은 다릅니다 — 일사량은 지역 차가 크지 않은데도 설비는 남부에 몰려 있습니다.';
    case '수력':
      return '설비 집중도(공급)와 하천·낙차 여건은 다릅니다 — 설비는 대형 댐이 있는 지역에 몰립니다.';
    default:
      return null;
  }
}

/** 지역 계수를 전국 평균과 견준 말. 기준값은 응답이 주므로 여기서 정하지 않는다. */
function describeRegionFactor(factor: number, average: number): string {
  const ratio = average > 0 ? factor / average : 1;
  const base = `전국 평균(${formatCoefficient(average)})`;
  if (ratio >= 1.15) return `${base}보다 유리합니다`;
  if (ratio <= 0.85) return `${base}보다 불리합니다`;
  return `${base} 수준입니다`;
}

/** 요약 한 줄에 끼워 넣을 짧은 형태. */
function describeRegionFactorShort(factor: number, average: number): string {
  const ratio = average > 0 ? factor / average : 1;
  if (ratio >= 1.15) return '전국 평균보다 높음';
  if (ratio <= 0.85) return '전국 평균보다 낮음';
  return '전국 평균 수준';
}

function describeWeatherMultiplier(multiplier: number): string {
  if (multiplier <= 0) return '이 기상에서는 발전이 멈춥니다';
  if (multiplier >= 1.05) return '이 기상이 발전량을 끌어올립니다';
  if (multiplier <= 0.95) return '이 기상이 발전량을 끌어내립니다';
  return '이 기상의 영향은 거의 없습니다';
}

interface ReasonContext {
  region: string;
  weatherLabel: string;
  basis: SuitabilityBasis;
  /** 백엔드가 실제로 계산에 쓴 믹스. 화면의 슬라이더 값이 아니라 이 값을 써야 식이 맞는다 */
  mixUsed: EnergyMixValues;
  weather: WeatherInfo;
  /**
   * 계수 열의 발전원별 출처. /calculate 의 data_source_detail.covered_sources 다.
   *
   * 단일 값이 아니라 표인 이유: 화력만 EPSIS 설비용량이고 나머지 셋은 내장 표다.
   * 근거 토글의 계수 줄이 발전원마다 다른 출처를 적어야 한다.
   */
  coefficientSources?: Partial<Record<'solar' | 'wind' | 'hydro' | 'thermal', string>>;
}

/** 목록에 없는 발전원이 오면 근거를 만들지 않는다(카드는 값만 보여준다). */
function explainSuitability(source: string, ctx: ReasonContext): SuitabilityReason | null {
  const { region, weatherLabel, basis, mixUsed, weather, coefficientSources } = ctx;
  // 출처는 발전원별로 다르다. 이 함수는 한 발전원의 근거만 만들므로 그 열만 본다.
  const originKey = coefficientOriginFor(source, coefficientSources);
  const coefficientOrigin = describeCoefficientOrigin(originKey);
  const coefficientMeaning = describeCoefficientMeaning(originKey);
  // 설비 기준 계수가 상식과 어긋나는 자리. 내장 표인 열에서는 null 이다.
  const coefficientCaveat = describeCoefficientCaveat(source, originKey);
  const factors = basis.region_factors;
  const average = basis.region_factor_average;
  const renewableTerm: ReasonTerm = { label: '재생에너지 비중', value: formatPercent(mixUsed.renewable) };
  const renewableSliderNote = '재생에너지 슬라이더를 움직이면 이 값도 함께 움직입니다.';

  if (source === '태양광' || source === '풍력') {
    const isSolar = source === '태양광';
    const factor = isSolar ? factors.solar : factors.wind;
    const multiplier = isSolar ? weather.solar_mult : weather.wind_mult;
    const raw = mixUsed.renewable * factor * multiplier;
    return {
      terms: [
        renewableTerm,
        // 네 발전원 모두 설비용량 기준이라 항 이름도 무엇을 재는지로 통일한다.
        { label: `${region} ${source} 설비 집중도`, value: formatCoefficient(factor) },
        { label: `${weatherLabel} ${source} 배수`, value: formatMultiplier(multiplier) },
      ],
      raw,
      clamped: raw > 100,
      headline: `${region}의 ${source} 설비 집중도 ${formatCoefficient(factor)}`
        + `(${describeRegionFactorShort(factor, average)})에 ${weatherLabel} 배수 `
        + `${formatMultiplier(multiplier)}, 재생에너지 비중 ${formatPercent(mixUsed.renewable)}가 곱해진 결과`,
      why: `${region}의 ${source} 설비 집중도 ${formatCoefficient(factor)}에 ${weatherLabel} 조건의 배수 `
        + `${formatMultiplier(multiplier)}, 현재 재생에너지 비중 ${formatPercent(mixUsed.renewable)}가 곱해진 값입니다. `
        + `이 계수는 ${region}에 ${source} 설비가 얼마나 모여 있는지(설비용량 기준)를 나타냅니다.`,
      notes: [
        `지역 계수 ${formatCoefficient(factor)} — ${coefficientMeaning}. ${describeRegionFactor(factor, average)} (${coefficientOrigin})`,
        ...(coefficientCaveat ? [coefficientCaveat] : []),
        `기상 배수 ${formatMultiplier(multiplier)} — ${describeWeatherMultiplier(multiplier)}.`,
        renewableSliderNote,
      ],
    };
  }

  if (source === '수력') {
    const raw = basis.hydro_base_index * factors.hydro;
    return {
      terms: [
        { label: '고정 기준 지수', value: formatIndex(basis.hydro_base_index) },
        { label: `${region} 수력 설비 집중도`, value: formatCoefficient(factors.hydro) },
      ],
      raw,
      clamped: raw > 100,
      headline: `믹스·기상과 무관한 고정 기준 지수 ${formatIndex(basis.hydro_base_index)}에 `
        + `${region}의 수력 설비 집중도 ${formatCoefficient(factors.hydro)}`
        + `(${describeRegionFactorShort(factors.hydro, average)})만 곱해진 결과`,
      why: `수력은 네 발전원 중 유일하게 기상과 무관합니다. `
        + `${region}의 수력 설비 집중도 ${formatCoefficient(factors.hydro)}만 반영합니다 — `
        + `${region}에 수력 설비가 얼마나 모여 있는지(설비용량 기준)입니다.`,
      notes: [
        `지역 계수 ${formatCoefficient(factors.hydro)} — ${coefficientMeaning}. ${describeRegionFactor(factors.hydro, average)} (${coefficientOrigin})`,
        ...(coefficientCaveat ? [coefficientCaveat] : []),
        '슬라이더를 움직이거나 기후 시나리오를 바꿔도 이 값은 변하지 않습니다.',
      ],
    };
  }

  if (source === '화력') {
    const raw = mixUsed.fossil * factors.thermal;
    return {
      terms: [
        { label: '화석연료 비중', value: formatPercent(mixUsed.fossil) },
        // "계수" 대신 무엇을 재는지 이름에 적는다. 이 값만 외부 설비 통계에서 나오므로
        // 나머지 셋과 성격이 다르고, 식을 펼친 칩에서 그 차이가 먼저 읽혀야 한다.
        { label: `${region} 화력 설비 집중도`, value: formatCoefficient(factors.thermal) },
      ],
      raw,
      clamped: raw > 100,
      headline: `${region}의 화력 설비 집중도 ${formatCoefficient(factors.thermal)}`
        + `(${describeRegionFactorShort(factors.thermal, average)})에 현재 화석연료 비중 `
        + `${formatPercent(mixUsed.fossil)}가 곱해진 결과`,
      why: `${region}의 화력 설비 집중도 ${formatCoefficient(factors.thermal)}에 현재 화석연료 비중 `
        + `${formatPercent(mixUsed.fossil)}가 곱해진 값입니다. 이 계수는 ${region}에 화력 `
        + `발전설비가 얼마나 모여 있는지(설비용량 기준)를 나타내며, ${region}이 전력을 `
        + `얼마나 쓰는지가 아닙니다. 기상 배수는 곱하지 않습니다 — 화력은 날씨와 무관하게 `
        + `급전할 수 있는 전원입니다.`,
      notes: [
        `지역 계수 ${formatCoefficient(factors.thermal)} — ${coefficientMeaning}. ${describeRegionFactor(factors.thermal, average)} (${coefficientOrigin})`,
        ...(coefficientCaveat ? [coefficientCaveat] : []),
        '화석연료 슬라이더를 내리면 이 값도 함께 내려갑니다.',
        '적합도가 높다는 것은 "이 지역에 그 설비가 많다"는 뜻이며, 탄소 배출에는 불리합니다.',
      ],
    };
  }

  return null;
}

interface BestSource {
  source: string;
  value: number;
  runnerUp: { source: string; value: number } | null;
  /** 2위와의 격차(%p). 2위가 없으면 0 */
  lead: number;
}

/**
 * 가장 적합한 발전원. 네 값이 모두 0이면(최초 렌더, 혹은 재생·화석 0%)
 * "가장 적합한" 것을 말할 수 없으므로 null 을 돌려준다.
 */
function pickBestSource(suitability: Record<string, number>): BestSource | null {
  const rows = Object.entries(suitability).filter(([, value]) => Number.isFinite(value));
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || sorted[0][1] <= 0) return null;

  const [source, value] = sorted[0];
  const second = sorted[1];
  return {
    source,
    value,
    runnerUp: second ? { source: second[0], value: second[1] } : null,
    lead: second ? value - second[1] : 0,
  };
}

/** 근거 토글 표식(CircleAlert 아이콘). 부모 <details className="group/reason"> 의 열림 상태에 반응한다. */
function ReasonBadge({ srLabel }: { srLabel: string }) {
  return (
    <span
      className="flex items-center justify-center w-5 h-5 rounded-full border border-slate-300 bg-white text-slate-600 shrink-0 transition-colors group-hover/reason:border-slate-500 group-hover/reason:text-slate-900 group-open/reason:bg-slate-900 group-open/reason:border-slate-900 group-open/reason:text-white"
      title="선정 근거 보기"
    >
      <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

/** 계산식을 항 단위로 펼친 줄. 화면의 숫자와 식의 숫자가 같은 응답에서 나온다. */
function ReasonFormula({ reason }: { reason: SuitabilityReason }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {reason.terms.map((term, index) => (
        <React.Fragment key={term.label}>
          {index > 0 && <span className="text-slate-500">×</span>}
          <span className="px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-700">
            {term.label}{' '}
            <span className="font-bold text-slate-900 tabular-nums">{term.value}</span>
          </span>
        </React.Fragment>
      ))}
      <span className="text-slate-500">=</span>
      <span className="px-1.5 py-0.5 rounded bg-slate-900 font-bold text-white tabular-nums">
        {reason.raw.toFixed(1)}
      </span>
      {reason.clamped && (
        <span className="text-amber-800 font-medium">→ 상한 100 적용</span>
      )}
    </div>
  );
}

function ReasonNotes({ notes }: { notes: string[] }) {
  return (
    <ul className="space-y-1">
      {notes.map((note) => (
        <li key={note} className="flex gap-1.5 text-[11px] text-slate-700 leading-relaxed">
          <span className="text-slate-400 shrink-0">·</span>
          <span>{note}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 적합도 섹션 맨 위의 한 줄 요약 + 근거 토글.
 *
 * "이 지역에 무엇이 가장 맞는가"는 적합도 섹션의 결론인데, 예전에는 카드 4장을
 * 눈으로 비교해 스스로 찾아내야 했다. 결론을 먼저 적고, 그 결론이 어디서 나왔는지는
 * 근거 토글 안으로 넣는다 — 계산식·지역 계수·기상 배수·믹스 반영 방식이 모두 여기 있다.
 */
function BestSourceSummary({
  region,
  suitability,
  ctx,
  best,
}: {
  region: string;
  suitability: Record<string, number>;
  ctx: ReasonContext | null;
  /** Home 이 pickBestSource() 로 한 번 뽑은 결론. 발전원 구성 패널의 한 줄 요약과 같은 값이다. */
  best: BestSource | null;
}) {
  if (!best || !ctx) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
        {best
          ? '적합도 근거를 계산하고 있습니다...'
          : `${region}의 적합도를 계산하고 있습니다...`}
      </p>
    );
  }

  const reason = explainSuitability(best.source, ctx);

  return (
    <details className="group/reason rounded-lg border border-slate-300 bg-slate-50 open:border-slate-400 open:bg-white">
      <summary className="flex items-start gap-2 px-3 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 shrink-0">
          <SourceIcon source={best.source} />
        </span>
        <p className="text-sm text-slate-800 leading-relaxed min-w-0">
          <span className="font-bold text-slate-900">{region}</span>에 가장 적합한 에너지원:{' '}
          <span className="font-bold text-slate-900">
            {best.source} ({formatPercent(best.value)})
          </span>
          <span className="text-slate-700">
            {' — '}
            {reason ? reason.headline : '자세한 근거는 오른쪽 근거 버튼을 눌러 확인하세요'}
            {best.runnerUp && best.lead >= 0.5 && (
              <>
                {` (2위 ${best.runnerUp.source} ${formatPercent(best.runnerUp.value)}보다 `}
                <span className="font-semibold text-slate-900">
                  {Math.round(best.lead)}%p
                </span>
                {' 높음)'}
              </>
            )}
          </span>
        </p>
        <span className="ml-auto pl-1 shrink-0">
          <ReasonBadge srLabel={`${best.source}이 가장 적합한 이유 보기`} />
        </span>
      </summary>

      <div className="px-3 pb-3 pt-3 border-t border-slate-200 space-y-3">
        <div>
          <h4 className="text-xs font-bold text-slate-900 mb-1.5">
            왜 {best.source}인가요?
          </h4>
          {reason ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-700 leading-relaxed">{reason.why}</p>
              <ReasonFormula reason={reason} />
              <ReasonNotes notes={reason.notes} />
            </div>
          ) : (
            <p className="text-xs text-slate-600">이 발전원의 계산 근거를 표시할 수 없습니다.</p>
          )}
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-900 mb-1.5">이 조건에서의 순위</h4>
          <ul className="space-y-1">
            {[...Object.entries(suitability)]
              .sort((a, b) => b[1] - a[1])
              .map(([source, value], index) => (
                <li key={source} className="flex items-center gap-2 text-[11px]">
                  <span className="w-4 text-slate-500 tabular-nums shrink-0">{index + 1}.</span>
                  <SourceIcon source={source} />
                  <span className={index === 0 ? 'font-bold text-slate-900' : 'text-slate-700'}>
                    {source}
                  </span>
                  <span className="ml-auto font-semibold text-slate-900 tabular-nums">
                    {formatPercent(value)}
                  </span>
                </li>
              ))}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-900 mb-1.5">적합도를 계산하는 방식</h4>
          <ul className="space-y-1 text-[11px] text-slate-700 leading-relaxed">
            <li>
              · <span className="font-semibold text-slate-900">지역 계수</span> — 1.0을 전국 평균으로 두고
              지역 간 상대적 유불리를 표현한 시뮬레이션용 정규화 지수입니다.
              실제 설비 이용률이나 발전량 통계가 아닙니다.
            </li>
            <li>
              · <span className="font-semibold text-slate-900">기상 배수</span> — 지금 고른 기후 시나리오가
              태양광·풍력 발전량을 몇 배로 만드는지입니다. 화력·수력에는 곱하지 않습니다.
            </li>
            <li>
              · <span className="font-semibold text-slate-900">현재 에너지 믹스</span> — 아래 슬라이더의
              재생에너지·화석연료 비중이 그대로 곱해집니다. 그래서 적합도는 지역 고유의 잠재량이 아니라
              <span className="font-semibold text-slate-900"> 지금 이 믹스가 이 지역·이 기상에서 얼마나 실현되는지</span>를
              나타냅니다.
            </li>
            <li>
              · 결과는 상한 100의 <span className="font-semibold text-slate-900">무차원 상대 지수</span>입니다.
              단위가 있는 발전량(MWh)이 아니므로 지역·조건 간 비교 용도로만 읽어 주세요.
            </li>
          </ul>
        </div>
      </div>
    </details>
  );
}

/** 적합도 카드 한 장. 카드 전체가 근거를 펼치는 토글이 된다. */
function SuitabilityCard({
  source,
  value,
  ctx,
}: {
  source: string;
  value: number;
  ctx: ReasonContext | null;
}) {
  const reason = ctx ? explainSuitability(source, ctx) : null;

  return (
    /*
      카드 밑에 "상대 적합도 지수 (무차원)" 한 줄이 붙어 있었다. 네 장이 같은 문구를
      네 번 반복하면서 카드마다 22px 을 더 먹었는데(합 44px, 카드가 두 줄일 때), 같은
      말을 카드 묶음 아래 각주가 이미 한 번 하고 있다. 각주 쪽만 남긴다.
    */
    <details className="group/reason p-2.5 rounded-lg bg-slate-50 border border-slate-200 open:bg-white open:border-slate-400">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex justify-between items-center gap-1.5 mb-1.5">
          <span className="flex items-center gap-1.5 min-w-0">
            <SourceIcon source={source} />
            <span className="text-sm font-semibold text-slate-800 truncate">{source}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <span className="text-sm font-bold text-slate-900 tabular-nums">{Math.round(value)}%</span>
            <ReasonBadge srLabel={`${source} 적합도 근거 보기`} />
          </span>
        </div>
        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: sourceColor(source) }}
          />
        </div>
      </summary>

      <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-2">
        {reason ? (
          <>
            <p className="text-xs text-slate-700 leading-relaxed">{reason.why}</p>
            <ReasonFormula reason={reason} />
            <ReasonNotes notes={reason.notes} />
          </>
        ) : (
          <p className="text-xs text-slate-600">계산 중...</p>
        )}
      </div>
    </details>
  );
}

/** 적합도 카드 묶음의 id. 기후 시나리오 탭이 aria-controls 로 가리킨다. */
const SUITABILITY_PANEL_ID = 'suitability-panel';

const weatherTabId = (index: number) => `weather-tab-${index}`;

/** 목록에 없는 시나리오가 와도 첫 탭으로 떨어뜨려 -1 인덱스를 막는다. */
const weatherTabIndex = (weather: string) =>
  Math.max(0, WEATHER_SCENARIOS.findIndex((s) => s.id === weather));

/**
 * 라벨 + select 를 한 줄로 묶은 컨트롤 한 칸.
 *
 * 라벨을 위, select 를 아래로 쌓으면 컨트롤 하나가 세로 두 줄을 먹어서
 * 나란히 놓을수록 위아래로 길어진다. 한 줄로 묶어 두면 칸을 옆으로 늘리기만
 * 하면 되므로, 곧 붙을 "기후 시나리오" 는 이 컴포넌트를 한 번 더 쓰면 된다.
 *
 * 보더/라운드/그림자는 카드 안의 작은 상자들(예: 근거 패널)과 같은 톤으로 맞췄다.
 * select 자체의 보더는 지우고 focus 표시는 묶음 전체(focus-within)가 받는다 —
 * 상자 안에 상자가 겹쳐 보이지 않게 하면서 키보드 초점은 그대로 보이게.
 */
function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/40 hover:border-slate-300">
      <label htmlFor={id} className="text-sm font-semibold text-slate-800 whitespace-nowrap">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[6.5rem] bg-transparent py-0.5 text-sm font-semibold text-slate-900 border-0 cursor-pointer focus:outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * 지역 선택 드롭다운.
 *
 * 예전에는 같은 일을 하는 입력이 셋이었다 — 지도 마커 클릭, 17개 칩 버튼,
 * 그리고 고른 값을 되풀이해 적던 "현재 선택" 배지. 그중 마커 클릭만 파이차트를
 * 함께 띄웠으므로 어느 길로 들어왔느냐에 따라 결과가 달랐다.
 *
 * 이제 지역을 바꾸는 길은 이 select 하나뿐이고, 지도 강조와 파이차트는 둘 다
 * selectedRegion 에서 파생된다. 고른 값은 select 가 직접 보여주므로 배지도 없앴다.
 */
function RegionSelect({
  selectedRegion,
  onRegionChange,
}: {
  selectedRegion: string;
  onRegionChange: (region: string) => void;
}) {
  return (
    <div>
      {/*
        컨트롤 줄. 지금은 지역 선택 하나뿐이지만 기후 시나리오 select 가 붙으면
        같은 줄에 나란히 서고, 폭이 모자라면 flex-wrap 으로 아랫줄로 접힌다.
      */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <SelectField
          id="region-select"
          label="지역 선택"
          value={selectedRegion}
          options={REGION_NAMES}
          onChange={onRegionChange}
        />
      </div>

      {/*
        네 줄이었다. 뒤의 ※ 세 줄은 "추정 발전량(MWh)은 관측 통계가 아니라 시뮬레이션값"
        이라는 내용인데, 그 숫자를 실제로 띄우는 발전원 구성 패널(RegionSourceMix)이
        자기 각주로 같은 말을 이미 하고 있다. 같은 화면에서 두 번 적을 이유가 없으므로
        값이 있는 쪽에 남기고 여기서는 지운다 — 안내는 한 줄로 줄었다.
      */}
      <p className="text-[11px] text-slate-600 mt-1.5 leading-snug">
        고른 지역은 지도에서 진한 파란 원·라벨로 표시되고, 나머지 원의 크기는 그 지역의 추정 발전량입니다.
      </p>
    </div>
  );
}

/**
 * 기후 시나리오 탭.
 *
 * 예전에는 설정 모달 안의 2×2 버튼이었다. 시나리오를 바꾸면 적합도 수치가
 * 즉시 바뀌는데 그 변화가 모달에 가려 보이지 않았으므로, 결과(적합도 카드)
 * 바로 위로 옮겨 조작과 반응이 한 화면에 들어오게 했다.
 *
 * Home 안에 두면 렌더마다 재생성되어 포커스가 풀리므로 모듈 스코프에 둔다.
 */
function WeatherTabs({
  selectedWeather,
  onWeatherChange,
  carbon,
  carbonPlanned,
  liveScenario,
  weatherSnapshot,
  climateNormals,
}: {
  selectedWeather: string;
  onWeatherChange: (weather: string) => void;
  /** 이 기상 조건 + 현재 믹스의 배출강도. 탭과 탄소 섹션을 잇는 연결 문구에 쓴다 */
  carbon?: number;
  carbonPlanned?: number;
  /**
   * 기상청 실황·특보로 판별한 추천 시나리오 id. 참고 표시 전용이다.
   *
   * null 이면 배지를 렌더링하지 않는다 — 백엔드가 source="fallback" 을 준
   * 경우(키 미설정·상류 장애)가 여기로 들어온다. 판정하지 못한 값을 실시간
   * 데이터처럼 보이게 하지 않는다.
   *
   * **이 값은 탭 선택을 바꾸지 않는다.** 고른 탭은 끝까지 사용자 것이다.
   */
  liveScenario?: string | null;
  weatherSnapshot?: WeatherSnapshot | null;
  climateNormals?: ClimateNormals | null;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = weatherTabIndex(selectedWeather);

  // 백엔드는 시나리오 id("맑음"/"흐림/비"/"태풍"/"겨울")를 주고, 화면 라벨
  // ("맑음/화창" …)은 프론트가 들고 있다. 라벨을 백엔드에 두면 표기를 고칠 때
  // 두 곳을 만져야 하므로 여기서 옮긴다.
  //
  // 목록에 없는 id 가 오면 배지를 띄우지 않는다(find 가 undefined). 백엔드가
  // 시나리오를 하나 더 늘렸는데 화면이 아직 모르는 상황에서, 뜻을 모르는 값을
  // "기상청 실시간 데이터 기준"이라고 적는 것보다 접는 편이 낫다.
  const liveScenarioLabel = liveScenario
    ? WEATHER_SCENARIOS.find((scen) => scen.id === liveScenario)?.label
    : undefined;

  // WAI-ARIA tabs 패턴: 탭 목록 전체가 Tab 키 한 번에 지나가고(roving tabindex),
  // 그 안은 좌우 화살표로 훑는다.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (activeIndex + step + WEATHER_SCENARIOS.length) % WEATHER_SCENARIOS.length;
    onWeatherChange(WEATHER_SCENARIOS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    /*
      "기후 시나리오" h3 를 지웠다(약 28px). 탭 줄은 그 자체로 무엇을 고르는 곳인지
      보이고, 카드 제목이 이미 "기후 시나리오 → 적합도"라고 적고 있다. 스크린리더용
      이름은 아래 tablist 의 aria-label 이 그대로 들고 있으므로 잃는 것이 없다.
    */
    <div className="mb-2.5">
      {/* 좁은 화면에서는 탭 줄이 가로로 스크롤된다. 줄바꿈시키면 밑줄이
          두 줄로 끊겨 어느 것이 선택된 탭인지 읽기 어려워진다. */}
      <div
        role="tablist"
        aria-label="기후 시나리오"
        className="flex items-stretch gap-0.5 sm:gap-1 border-b border-slate-200 overflow-x-auto overscroll-x-contain"
      >
        {WEATHER_SCENARIOS.map((scen, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={scen.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={weatherTabId(index)}
              aria-selected={isActive}
              aria-controls={SUITABILITY_PANEL_ID}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onWeatherChange(scen.id)}
              onKeyDown={handleKeyDown}
              className={`flex items-center gap-1.5 whitespace-nowrap shrink-0 px-1.5 sm:px-2.5 py-2 -mb-px border-b-2 rounded-t-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-400'
              }`}
            >
              {/* 아이콘은 sm 이상에서만. 390px 화면에서 네 탭이 한 줄에 들어가려면
                  이 32px가 필요하다. 라벨만으로도 시나리오는 구분된다. */}
              <span className="hidden sm:inline-flex">{scen.icon}</span>
              {scen.label}
            </button>
          );
        })}
      </div>
      {/*
        기상청 실시간 데이터 기준 배지.

        탭 바로 아래, 안내 문구 위에 한 줄로 둔다 — "지금 실제 날씨는 이쪽"이라는
        참고 정보이므로 탭(조작)과 설명(결과) 사이가 자리다.

        누를 수 없는 표시다. onWeatherChange 를 부르지 않으므로 탭이 저절로
        바뀌는 일이 없고, 사용자가 다른 탭을 보고 있어도 배지 문구는 그대로
        실황을 가리킨다 — 둘이 어긋나 보이는 것이 맞다. 이 시뮬레이터의 요점은
        "실제와 다른 조건도 눌러 볼 수 있다"이기 때문이다.

        liveScenario 가 null 이면 이 블록 전체가 없다. 폴백일 때 배지를 회색으로
        낮춰 표시하는 선택지도 있었지만, 그렇게 하면 "판정 못 했음"이 "판정 결과"
        와 같은 자리·같은 모양으로 나와 사용자가 구분할 방법이 없다.
      */}
      {liveScenarioLabel && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600">
          {/*
            점 하나로 "지금 살아 있는 값"임을 표시한다.

            한동안 초록(green-600)이었다. 실시간 표시등의 관습색이기도 하고, 그때는
            발전원 팔레트(amber/sky/blue/red)에 초록이 없어서 데이터 색으로 오인될
            일도 없었다. 지금은 발전원 램프가 그린 → 인디고 축이라 초록이 곧
            태양광·재생에너지를 뜻한다 — 바로 왼쪽 카드의 도넛에서 그 색이 값으로
            쓰이고 있으므로, 같은 행에서 초록 점을 상태 표시로 또 쓸 수 없다.

            브랜드 색으로 옮긴다. 이 앱에서 브랜드 인디고는 "지금 고른 것 / 지금
            상태"를 가리키고 값은 절대 나타내지 않는데, "실시간 데이터 기준"은
            정확히 그 상태 진술이다.
          */}
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-brand-600 shrink-0" />
          기상청 실시간 데이터 기준:{' '}
          <span className="font-bold text-slate-900">{liveScenarioLabel}</span>
        </p>
      )}
      <WeatherObservationCard snapshot={weatherSnapshot} />
      <ClimateNormalsLine climate={climateNormals} />
      {/*
        기후 탭과 탄소 배출 섹션을 잇는 연결 문구.

        예전에는 이 자리에 시나리오 설명만 있었다. 탭을 눌러 적합도가 바뀌는 것은
        보이는데 그것이 배출량으로 이어지는 대목이 화면에 없어서, 적합도 섹션과
        탄소 섹션이 서로 무관한 두 기능처럼 읽혔다. 같은 수치를 여기서 한 문장으로
        받아 주면 탭 → 적합도 → 배출량이 한 흐름으로 이어진다.

        숫자를 크게 키우지는 않는다. 오른쪽 탄소 배출 카드가 같은 값을 큰 글씨로
        들고 있어서, 여기서 또 크게 쓰면 같은 수치가 한 화면에서 두 번 주인공이 된다.
      */}
      <div className="mt-1.5 px-2 py-1.5 bg-slate-100 border border-slate-200 rounded-md">
        <p className="text-[11px] text-slate-700 leading-snug">
          {WEATHER_SCENARIOS[activeIndex].description}
        </p>
        <p className="text-[11px] text-slate-700 leading-snug mt-1 pt-1 border-t border-slate-300">
          <span className="font-bold text-slate-900">{WEATHER_SCENARIOS[activeIndex].label}</span> 기준,
          현재 에너지 믹스로 계산 시{' '}
          <span className="font-bold text-slate-900 tabular-nums">
            {carbon === undefined ? '--' : carbon.toFixed(1)}
          </span>{' '}
          gCO₂/kWh
          {/* 기상이 배출강도를 얼마나 움직였는지. 이 차이가 곧 "기후 → 배출" 연결의 크기다. */}
          {carbon !== undefined && carbonPlanned !== undefined
            && Math.abs(carbon - carbonPlanned) >= 0.5 && (
            <span className="text-slate-600">
              {' '}(믹스 자체 {carbonPlanned.toFixed(1)}g · 이 기상에서{' '}
              <span className={carbon > carbonPlanned ? 'text-red-700 font-semibold' : 'text-green-700 font-semibold'}>
                {formatSigned(carbon - carbonPlanned)}g
              </span>
              )
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function ClimateNormalsLine({ climate }: { climate?: ClimateNormals | null }) {
  if (!climate?.available || !climate.averages) return null;
  const { averages } = climate;
  return (
    <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
      연평균 관측 요약 · 기온 {averages.temperature_c == null ? '--' : `${averages.temperature_c}°C`} · 풍속 {averages.wind_speed_ms == null ? '--' : `${averages.wind_speed_ms} m/s`} · 강수 {averages.precipitation_mm == null ? '--' : `${averages.precipitation_mm} mm`}
    </div>
  );
}

function WeatherObservationCard({ snapshot }: { snapshot?: WeatherSnapshot | null }) {
  const observation = snapshot?.raw?.observation;
  const warnings = snapshot?.raw?.warnings;
  const hasLiveObservation = snapshot?.source === 'live' && observation;

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-700">현재 관측 참고</p>
        <span className="text-[10px] text-slate-500">
          {hasLiveObservation ? '기상청 실황' : '관측값 없음'}
        </span>
      </div>
      {hasLiveObservation ? (
        <>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs text-slate-700">
            <div><span className="block text-[10px] text-slate-500">기온</span><strong>{observation.temperature_c.toFixed(1)}°C</strong></div>
            <div><span className="block text-[10px] text-slate-500">풍속</span><strong>{observation.wind_speed_ms == null ? '--' : `${observation.wind_speed_ms.toFixed(1)} m/s`}</strong></div>
            <div><span className="block text-[10px] text-slate-500">강수</span><strong>{observation.rainfall_mm == null ? '--' : `${observation.rainfall_mm.toFixed(1)} mm`}</strong></div>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            {warnings?.storm
              ? `강풍·태풍 특보 ${warnings.count}건이 반영되었습니다.`
              : warnings?.count
                ? `현재 특보 ${warnings.count}건이 있으나 시나리오 판정에는 반영되지 않았습니다.`
                : '활성 특보가 없습니다.'}
          </p>
          {snapshot.meta?.observed_at && (
            <p className={`mt-1 text-[10px] ${snapshot.meta.stale ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
              기준 {snapshot.meta.observed_at.slice(0, 16).replace('T', ' ')} KST
              {snapshot.meta.stale ? ' · 오래된 관측' : ''}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-[10px] leading-snug text-slate-500">
          기상청 실황·특보를 확인할 수 없어 내장 시나리오 배수만 사용합니다.
        </p>
      )}
    </div>
  );
}

const formatDelta = (delta: number) => `${delta > 0 ? '+' : ''}${Number(delta.toFixed(1))}%p`;


/**
 * 실행 가능한 다음 한 걸음.
 * resulting_mix를 그대로 setMix()에 넘기면 기존 재계산 useEffect가 트리거되어
 * expected_score가 실제로 재현된다(백엔드가 handleSliderChange와 동일한
 * 재분배 규칙으로 후보를 만들기 때문).
 *
 * nextAction === undefined  → 아직 응답 없음
 * nextAction === null       → 백엔드가 개선 여지 없다고 판정
 */
function NextActionCard({
  nextAction,
  currentScore,
  isCalculating,
  appliedTarget,
  onApply,
  factors,
}: {
  nextAction?: NextAction | null;
  currentScore?: number;
  isCalculating: boolean;
  appliedTarget: number | null;
  onApply: (action: NextAction) => void;
  /** 감점 요인 세 줄. "왜 이 점수인가요?" 카드와 같은 백엔드 값을 그대로 그린다. */
  factors?: Factor[] | null;
}) {
  // 적용으로 시작된 계산인지 구분한다. 슬라이더 조작 중에도 버튼은 잠그되,
  // "적용 중" 문구는 실제로 적용을 눌렀을 때만 보여준다.
  const isApplying = isCalculating && appliedTarget !== null;
  const showApplied = !isCalculating && appliedTarget !== null;

  return (
    /*
      이 화면에서 테두리를 두르는 유일한 일반 카드다.

      나머지 카드는 전부 얇은 그림자 한 겹(shadow-card)만으로 바닥에서 떠 있고 선이
      없다. 그래서 선이 있다는 사실 자체가 강조가 된다 — 색으로 칠하거나 글자를 키우지
      않고도 "여러 카드 중 여기부터 보라"가 된다. 이 규칙은 선이 드물 때만 작동하므로,
      다른 카드에 테두리를 하나라도 더 붙이면 그때 이 카드의 강조도 함께 없어진다.

      색을 brand-200 으로 두는 이유: 이 카드가 시키는 일("재생에너지를 N% 로")을
      실행하는 버튼도 브랜드 색이다. 테두리와 버튼이 같은 계열이라 카드 전체가
      하나의 행동 단위로 읽힌다.
    */
    <div className="h-full bg-white p-3 rounded-lg shadow-card border border-brand-200">
      <div className="flex justify-between items-center mb-2 gap-2">
        <h2 className="text-base font-semibold text-slate-900">다음 단계</h2>
        {showApplied && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            적용 완료 · {currentScore ?? '--'}점
          </span>
        )}
      </div>

      {nextAction === undefined && (
        <p className="text-sm text-slate-500">계산 중...</p>
      )}

      {nextAction === null && (
        <p className="text-sm text-slate-600 leading-relaxed">
          현재 조합에서 추가 개선 가능한 행동이 없습니다.
        </p>
      )}

      {nextAction && (
        <div className={`transition-opacity duration-200 ${isCalculating ? 'opacity-50' : 'opacity-100'}`}>
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <span className="text-lg font-bold text-slate-900">
              {nextAction.lever_label} {formatDelta(nextAction.delta)}
            </span>
            {/*
              그린 계열을 쓴다. 이 배지는 "이 제안을 적용하면 목표 점수에 닿는다"는
              긍정 판정이고, 이 화면에서 긍정 지표는 초록이다(요인 신호등의 good,
              점수 증가분 +N점, 재생에너지). 브랜드 인디고였을 때는 바로 아래
              "적용하기" 버튼과 같은 색이어서, 값을 말하는 배지와 누르는 버튼이 한
              색으로 묶여 보였다 — 브랜드 색은 조작을 가리키고 값을 가리키지 않는다는
              규칙(globals.css)에도 어긋났다.

              토큰은 새로 만들지 않고 EnergyQuizCard 의 정답 표시가 쓰는 조합
              (bg-green-50 / border-green-200 / text-green-800)을 그대로 가져왔다.
              같은 뜻("맞았다 / 닿았다")에 같은 색이면 화면 전체에서 한 번만 배우면 된다.

              대비: green-800(#166534) on green-50(#f0fdf4) = 6.81:1. 이 글자는 10px
              굵은체라 WCAG 의 "큰 글자" 예외(18.66px 이상 굵은체)에 해당하지 않으므로
              일반 기준 4.5:1 을 넘어야 하고, 6.81 은 그것을 넘어 AAA(7:1)에 근접한다.
              종전 brand 조합은 8.88:1 이었으니 대비는 낮아지지만 기준 안쪽이다.
            */}
            {nextAction.reaches_goal && (
              <span className="text-[10px] font-semibold text-green-800 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
                목표 달성
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm mb-2.5">
            <span className="text-slate-600">{currentScore ?? '--'}점</span>
            <span className="text-slate-400">→</span>
            <span className="font-bold text-slate-900">{nextAction.expected_score}점</span>
            <span className="text-xs font-bold text-green-700">
              {formatSigned(nextAction.expected_gain)}점
            </span>
          </div>

          <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded-md border border-slate-200">
            {nextAction.reason}
          </p>

          {/*
            지금 점수를 깎고 있는 것들. 추천 행동 바로 아래에 두는 이유는,
            "무엇을 할 것인가"와 "왜 해야 하는가"가 한 눈에 들어와야 하기 때문이다.
            같은 목록이 아래 "왜 이 점수인가요?" 카드에도 접힌 채 남아 있고,
            둘 다 같은 factors 배열을 그린다.
          */}
          {factors && factors.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-slate-200">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <h3 className="text-xs font-semibold text-slate-600">지금 점수를 깎는 요인</h3>
                <FactorBreakdownLink />
              </div>
              <FactorRows factors={factors} spacing="space-y-2" />
            </div>
          )}

          {nextAction.grid_margin_change !== 0 && (
            <p className="text-xs mt-1.5 flex items-center gap-1.5">
              <span className="text-slate-600">전력 공급</span>
              <span className={`font-semibold ${nextAction.grid_margin_change > 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatSigned(nextAction.grid_margin_change)}
              </span>
            </p>
          )}

          {nextAction.resulting_grid_status === 'deficit' && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 mt-1.5 flex items-start gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>적용 후에도 전력이 부족하지만, 부족분은 줄어듭니다.</span>
            </p>
          )}

          <button
            onClick={() => onApply(nextAction)}
            disabled={isCalculating}
            className="w-full mt-3 px-4 py-2.5 flex items-center justify-center gap-2 bg-brand-600 text-white text-sm font-medium rounded-md hover:bg-brand-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {isApplying && <Spinner className="w-4 h-4" />}
            {isApplying ? '적용 중...' : '적용하기'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 전력망 상태별 스타일. 백엔드 GridStatus 판정을 색으로만 옮긴다.
 * Record<GridStatus, ...>이므로 백엔드가 상태를 추가하면 컴파일 단계에서 잡힌다.
 */
const GRID_STATUS_STYLES: Record<GridStatus, { dot: string; text: string }> = {
  deficit: { dot: 'bg-red-500', text: 'text-red-700' },      // 공급 부족 — 위험
  stable: { dot: 'bg-green-500', text: 'text-green-700' },   // 안정
  surplus: { dot: 'bg-amber-500', text: 'text-amber-800' },  // 과잉 공급 / 출력제한
};

const FACTOR_STATUS_STYLES: Record<FactorStatus, { dot: string; value: string }> = {
  good: { dot: 'bg-green-500', value: 'text-green-700' },
  warn: { dot: 'bg-amber-500', value: 'text-amber-800' },
  bad: { dot: 'bg-red-500', value: 'text-red-700' },
};

/** "왜 이 점수인가요?" 카드의 앵커. "다음 단계" 카드의 링크가 이걸 가리킨다. */
const FACTOR_BREAKDOWN_ID = 'score-factors';

/**
 * 감점 요인 세 줄(탄소 배출 / 전력망 안정 / 지역 적합도).
 *
 * 같은 목록을 두 곳이 그린다 — 기본 노출 자리인 "다음 단계" 카드와, 접힌 채로
 * 남아 있는 "왜 이 점수인가요?" 카드. 마크업을 한 곳에 두어 두 표시가 어긋나지
 * 않게 한다. 값은 백엔드 factors 를 그대로 쓰고 여기서 계산하지 않는다.
 *
 * factors 배열은 백엔드가 carbon → grid → fit 순서로 보장하므로 정렬하지 않는다.
 */
function FactorRows({ factors, spacing = 'space-y-3' }: { factors: Factor[]; spacing?: string }) {
  return (
    <div className={spacing}>
      {factors.map((factor) => (
        <div key={factor.key}>
          <div className="flex justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${FACTOR_STATUS_STYLES[factor.status].dot}`} />
              <span className="text-sm font-semibold text-slate-800">{factor.label}</span>
            </div>
            <span className={`text-sm font-bold shrink-0 ${
              factor.penalty > 0 ? FACTOR_STATUS_STYLES[factor.status].value : 'text-slate-500'
            }`}>
              {factor.penalty > 0 ? `-${Number(factor.penalty.toFixed(1))}점` : '0점'}
            </span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed mt-1 pl-4">
            {factor.detail}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * "왜 이 점수인가요?" 카드로 보내는 링크.
 *
 * <details> 는 앵커로 이동한다고 저절로 열리지 않는다(브라우저마다 다르다).
 * 열림 상태는 여전히 details 자신이 갖고 — 그래서 별도 state 를 두지 않는다 —
 * 여기서는 이동하는 김에 한 번 밀어 열어 줄 뿐이다.
 */
function FactorBreakdownLink() {
  return (
    <a
      href={`#${FACTOR_BREAKDOWN_ID}`}
      onClick={() => {
        const el = document.getElementById(FACTOR_BREAKDOWN_ID);
        if (el instanceof HTMLDetailsElement) el.open = true;
      }}
      className="text-[11px] font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 shrink-0"
    >
      계산 근거 자세히 보기
    </a>
  );
}

/**
 * 데이터 출처 — 페이지 최하단 각주 블록.
 *
 * 이 화면은 다섯 개의 외부 API 를 쓰는데, 그 사실이 지금까지 화면 어디에도 없었다.
 * 카드마다 붙은 ※ 각주들은 "이 값은 추정 시뮬레이션값"이라고 말할 뿐, 무엇이
 * 추정이 아닌지 — 어떤 기관의 어떤 데이터가 들어왔는지 — 는 말하지 않았다.
 *
 * ── 왜 섹션 제목을 다른 섹션보다 작게 두는가 ──
 *
 * 위 세 섹션의 제목은 text-lg 다. 이 블록은 그 규칙을 따르지 않는다 — 읽을 내용이
 * 아니라 확인할 내용이고, 화면의 주인공은 데이터지 출처 목록이 아니다. 그래서
 * 카드들과 같은 층에 서지 않고, 얇은 구분선 아래 각주 크기(11px 회색)로 물러난다.
 * 색은 새로 만들지 않고 각주들이 쓰는 slate-500/400 을 그대로 쓴다.
 *
 * ── 문구의 원칙 ──
 *
 * "무엇에 쓰였는가"만 적지 않고 "무엇에는 쓰이지 않았는가"까지 적는다. 예를 들어
 * KPX 발전량 현황은 도넛의 **구성비**만 바꾸고 MWh 절대 크기·지역별 배분은 바꾸지
 * 않는다(services/kpx_api.py 상단 주석). 그 경계를 빼고 "발전량 데이터 사용"이라고만
 * 적으면, 화면의 숫자가 전부 실측인 것처럼 읽힌다 — 카드 각주들이 애써 지키고 있는
 * 구분이 이 목록 한 줄에 무너진다.
 *
 * 기상청 두 API 도 같다. 이 API 들은 시나리오를 **추천**할 뿐 기후 탭 선택이나 적합도
 * 계산을 대신하지 않는다(services/weather_api.py). "적합도 판단에 사용"으로 적으면
 * 적합도가 관측 기반이라는 뜻이 되어 사실과 다르다.
 *
 * [TODO] 공공데이터포털·OpenRouter 이용약관이 요구하는 정형 표기 문구가 따로 있는지는
 * 확인되지 않았다. 아래는 일반적인 형태의 초안이며, 약관이 정한 문구가 있으면
 * SOURCES 배열의 name/note 를 그 문구로 교체한다.
 */
interface DataSource {
  /** 제공 기관 */
  provider: string;
  /** 자료 이름 — 공공데이터포털·기관 표기를 그대로 쓴다 */
  name: string;
  /** 파일 스냅샷인지 요청 시점에 부르는 API 인지 */
  kind: '파일' | 'API';
  /** 기준연도. 실시간 API 처럼 해당 없는 경우 null */
  baseYear: number | null;
  /** 화면의 어느 부분에 쓰였는가 (한 줄) */
  usedFor: string;
  /** 쓰이지 않은 범위, 또는 반영되지 않는 이유. 없으면 생략 */
  limit?: string;
}

interface DataSourceGroup {
  /** 묶음 제목. 상태를 제목이 말한다 */
  title: string;
  /** 묶음 안에서만 통하는 부연. 없으면 생략 */
  note?: string;
  items: DataSource[];
}

/**
 * 데이터 출처를 상태별로 세 묶음으로 나눈다.
 *
 * 평평한 목록이던 동안 문제가 있었다. 일곱 항목이 같은 모양으로 나열돼 있어서,
 * "지금 값에 반영되는 것"과 "연결만 해 둔 것"과 "안 쓰는 것"이 구분되지 않았다.
 * 특히 두 항목은 단정형("반영됩니다")으로 적혀 있었는데 실측으로는 활용신청
 * 미승인이라 한 번도 반영된 적이 없었다 — 목록이 사실과 어긋나 있었다.
 *
 * 상태를 묶음 제목이 말하게 하면 개별 항목의 시제를 헷갈릴 자리가 없어진다.
 * 각 묶음의 항목 수도 스스로 드러난다.
 */
const DATA_SOURCE_GROUPS: DataSourceGroup[] = [
  {
    title: '실제로 값에 반영되는 것',
    items: [
      {
        provider: '한국전력거래소',
        name: '지역별 발전설비 설비용량 (전력통계정보시스템 EPSIS)',
        kind: '파일',
        baseYear: 2025,
        usedFor: '17개 시·도의 화력 발전설비 용량(MW)에서 "화력 계수"를 유도합니다. 이 계수는 "지역별 에너지 적합도"의 화력 카드와 지도 원 크기 계산에 들어갑니다.',
        limit: '설비가 어디에 모여 있는지를 나타내며 그 지역의 전력 수요·의존도가 아닙니다. 태양광·풍력·수력 계수에는 쓰이지 않습니다 — 이 자료는 재생에너지를 "신재생" 한 항목으로만 구분해 발전원을 나눌 수 없고, 그 세 계수는 아래 자료에서 옵니다.',
      },
      {
        provider: '한국에너지공단',
        name: '기초지자체별 신재생에너지 보급 현황',
        kind: '파일',
        baseYear: 2024,
        usedFor: '17개 시·도의 태양광·풍력·수력 발전설비 보급용량(kW)에서 각 발전원의 "지역 계수"를 유도합니다. 위 화력과 같은 방식입니다.',
        limit: '설비가 어디에 모여 있는지를 나타내며 그 지역의 자원 잠재력(일사량·풍속·낙차)이 아닙니다 — 자원이 좋아도 아직 설비가 적은 지역은 낮게 나옵니다. 수력은 양수발전을 제외한 값입니다.',
      },
      {
        provider: 'OpenRouter',
        name: 'LLM API',
        kind: 'API',
        baseYear: null,
        usedFor: '우측 하단 AI 어시스턴트의 요약 해설과 채팅 답변을 생성합니다.',
        limit: '화면의 점수·배출량·적합도 계산에는 관여하지 않습니다 — 그 값들은 모두 백엔드가 결정론적으로 계산합니다. 호출이 불가능하면 계산 결과로 만든 문구로 대체되고, 패널 배지가 "즉시 요약"으로 바뀝니다.',
      },
    ],
  },
  {
    title: '연동돼 있으나 현재 값에 반영되지 않는 것',
    note: '코드에 호출 경로가 있고 실패하면 조용히 내장 추정값으로 떨어집니다. 아래 사유가 해소되면 별도 수정 없이 반영됩니다 — 마지막 항목만 예외입니다.',
    items: [
      {
        provider: '기상청',
        name: '단기예보 조회서비스(초단기실황) + 기상특보 조회서비스',
        kind: 'API',
        baseYear: null,
        usedFor: '기온·강수형태·풍속과 발효 중인 특보를 읽어 4종 기후 시나리오(맑음/장마·폭우/태풍·강풍/한파·겨울) 중 현재 상황에 가까운 하나를 추천합니다. "기상청 실시간 데이터 기준" 배지가 그 결과입니다.',
        limit: '특보 조회서비스가 활용신청 미승인이라 현재 이 배지가 표시되지 않습니다. 두 호출 중 하나라도 실패하면 추천 자체를 하지 않습니다 — 실황만 읽고 "기상청 기준"이라고 말하면 태풍이 접근하는 중에 비가 그친 순간을 "맑음"이라고 하게 됩니다. 추천이 되더라도 기후 탭 선택과 적합도 계산은 사용자 선택과 시나리오별 내장 배수로 하며, 실황이 이를 덮어쓰지 않습니다.',
      },
      {
        provider: '한국전력거래소',
        name: '발전원별 발전량 현황조회(GW)',
        kind: 'API',
        baseYear: null,
        usedFor: '"지역과 발전원 구성" 카드의 발전원 구성 도넛에서 태양광·풍력·수력·화력의 구성비에 반영하려는 자료입니다.',
        limit: '활용신청 미승인이라 현재 미반영입니다. 도넛의 구성비는 지역 효율계수·기상·에너지 믹스로 계산한 추정 시뮬레이션값입니다. 승인되어도 총 발전량(MWh)의 절대 크기와 지역별 배분은 바뀌지 않습니다 — 이 자료의 단위는 순시 출력(GW)이라 에너지(MWh)로 잇는 데 필요한 이용률·시간 적분이 없습니다.',
      },
      {
        provider: '한국전력거래소',
        name: '전력시장 발전설비 정보',
        kind: 'API',
        baseYear: null,
        usedFor: '지역 계수를 요청 시점에 보강하려고 검토한 경로입니다.',
        limit: '검토했으나 채택하지 않았습니다 — 이 API 의 지역 구분이 수도권·비수도권·제주 3분할이어서 17개 시·도 계수를 만들 수 없습니다. 같은 기관의 자료를 시·도 단위로 받는 길이 위 EPSIS 설비용량이고, 그쪽을 씁니다.',
      },
    ],
  },
  {
    title: '검토했으나 미사용',
    items: [
      {
        provider: '한국에너지공단',
        name: '에너지 사용 및 온실가스 배출량 마이크로데이터',
        kind: 'API',
        baseYear: null,
        usedFor: '화면의 어느 값에도 쓰이지 않습니다. 코드에 연동 경로도 없습니다.',
        limit: '활용신청 승인 대기 중입니다. 다만 승인되어도 지역 계수에는 쓸 수 없습니다 — 이 자료는 에너지 다소비 사업장별 에너지 사용량·온실가스 배출량(수요측)이고, 지역 계수가 필요로 하는 것은 발전설비 용량(공급측)입니다. 발전업만 골라내도 나오는 값은 연료 투입량과 배출량이라 설비용량이 아니며, 배출계수(gCO₂/kWh)로 쓰려 해도 분모가 될 발전량이 이 자료에 없습니다.',
      },
    ],
  },
];

/** 묶음 전체의 항목 수. 아코디언 제목의 "(8)" 이 이 값이다. */
const DATA_SOURCE_COUNT = DATA_SOURCE_GROUPS.reduce((sum, group) => sum + group.items.length, 0);

function DataSources() {
  return (
    <section
      aria-labelledby="sources-heading"
      /*
        아래 여백은 AI 어시스턴트 플로팅 버튼의 자리다.

        그 버튼은 position:fixed 로 우하단 bottom-4(모바일)/bottom-6(sm 이상)에 떠
        있고 크기가 56~60px 이라, 화면 아래에서 최대 84px 을 늘 차지한다. 이 섹션은
        페이지의 마지막 요소이므로 끝까지 스크롤하면 마지막 줄이 정확히 그 자리에
        놓인다 — 실측으로 768px 폭에서 1줄, 390px 폭에서 2줄이 버튼 밑에 깔렸다.

        아코디언이 되면서 접힌 상태에서도 같은 검사가 필요해졌다. 접히면 페이지가
        짧아져 스크롤이 없을 수도 있는데, 그때는 마지막 줄이 뷰포트 아래쪽 어디에
        놓이는지가 화면 높이에 따라 달라진다. 두 상태 모두 실측으로 확인했다.
      */
      className="border-t border-slate-200 pt-4 mt-2 pb-[calc(6rem+env(safe-area-inset-bottom))]"
    >
      {/*
        "왜 이 점수인가요?" 와 같은 네이티브 <details> 를 쓴다. 기본 접힘이고 별도
        state 가 없다. 그 카드와 같은 부품을 쓰는 이유는 화면에서 "펼쳐 보는 것"이
        한 가지 모양이어야 하기 때문이다 — 접힘/펼침 장치가 두 종류면 사용자가
        각각 배워야 한다.

        다만 카드 껍데기(bg-white shadow-card)는 두르지 않는다. 이 블록은 각주지
        카드가 아니고, 페이지 맨 아래 얇은 구분선 아래에 물러나 있어야 한다.
      */}
      <details className="group">
        <summary className="flex items-center justify-between gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <h2 id="sources-heading" className="text-xs font-semibold text-slate-600">
            데이터 출처 <span className="tabular-nums font-normal text-slate-400">({DATA_SOURCE_COUNT})</span>
          </h2>
          <svg
            xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </summary>

        <p className="mt-2 text-[11px] text-slate-500 leading-snug">
          이 화면이 쓰는 공개 자료입니다. 요청 시점에 부르는 API 와, 한 번 받아 저장해 둔 파일 스냅샷이 섞여 있고
          각 항목의 상태를 아래 세 묶음으로 갈라 적었습니다.
        </p>

        {/*
          묶음 제목은 새 색을 쓰지 않는다. 항목 본문이 slate-600/500/400 이므로
          제목은 그중 가장 옅은 slate-400 에 uppercase tracking 만 얹어 "이건
          라벨"임을 낸다 — 굵게 하거나 크게 하면 항목보다 먼저 읽힌다.
        */}
        <div className="mt-3 space-y-3.5">
          {DATA_SOURCE_GROUPS.map((group, groupIndex) => {
            // 번호는 묶음을 건너 이어진다 — 마무리 각주가 "1·2번" 처럼 가리킨다.
            const offset = DATA_SOURCE_GROUPS
              .slice(0, groupIndex)
              .reduce((sum, previous) => sum + previous.items.length, 0);
            return (
              <div key={group.title}>
                <p className="text-[10px] font-medium tracking-wide text-slate-400">
                  {group.title} <span className="tabular-nums">({group.items.length})</span>
                </p>
                {group.note && (
                  <p className="mt-0.5 text-[10px] text-slate-400 leading-snug">{group.note}</p>
                )}

                <ol className="mt-1.5 space-y-2">
                  {group.items.map((source, index) => (
                    <li key={`${source.provider}-${source.name}`} className="flex gap-2 text-[11px] leading-snug">
                      <span className="shrink-0 tabular-nums text-slate-400">{offset + index + 1}.</span>
                      <div className="min-w-0">
                        <p className="text-slate-600">
                          <span className="font-semibold text-slate-700">{source.provider}</span>
                          {' — '}
                          {source.name}
                          {/*
                            파일/API 와 기준연도를 이름 뒤에 붙인다. 항목마다 기준연도가
                            다를 수 있다는 것이 이 목록의 요점 중 하나다(화력 2025 ·
                            재생 2024). 실시간 API 는 기준연도가 없으므로 생략한다.
                          */}
                          <span className="text-slate-400">
                            {` · ${source.kind}`}
                            {source.baseYear !== null && ` · ${source.baseYear}년 기준`}
                          </span>
                        </p>
                        <p className="text-slate-500">{source.usedFor}</p>
                        {source.limit && <p className="text-slate-400">{source.limit}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>

        <p className="mt-3.5 text-[10px] text-slate-400 leading-snug">
          1·2번은 공공데이터포털(data.go.kr)에 공개된 자료를 1회 받아 저장한 스냅샷입니다(취득 2026-08-21, 연 1회 갱신).
          1번은 포털의 해당 항목이 파일을 직접 제공하지 않고 전력통계정보시스템(EPSIS) 화면으로 연결하기 때문에 그
          공개 값을 받아 저장했습니다.
          {' '}
          <span className="text-slate-500">
            두 자료의 기준연도가 다릅니다 — 화력은 2025년, 태양광·풍력·수력은 2024년입니다.
          </span>
          {' '}
          정규화가 발전원별로 독립이라(각 발전원의 전국 중위 지역을 1.0 으로 둔다) 이 차이가 계수를 왜곡하지 않습니다.
          발전원 사이의 절대 크기를 비교하지 않기 때문입니다 — 애초에 화력의 MW 와 재생에너지의 kW 를 한 기준으로
          묶을 수도 없습니다. 배출계수(재생·원자력 12, 화력 650 gCO₂/kWh)와 시나리오별 기상 배수는 외부 데이터가
          아니라 상대 비교를 위한 내장 예시값이며 공식 통계가 아닙니다.
        </p>

        {/*
          자산 라이선스 안내 — 데이터 출처와 별개다.
          위 목록은 "이 숫자가 어디서 왔나"를 말하고, 이 줄은 "이 리포지토리를 받아
          쓰려면 무엇을 지켜야 하나"를 말한다. 화면에서 이 둘을 한 자리에 두는 이유는
          출처를 확인하러 온 사람이 곧 재사용을 생각하는 사람이기 때문이다.

          코드(MIT)와 기상이 이미지(비상업)의 조건이 다르다는 사실이 여기서 한 번 더
          드러나야 한다 — 마스코트 옆 각주는 그 이미지만 말하고, 프로젝트 전체의
          라이선스 구조는 말하지 않는다.
        */}
        <p className="mt-2 text-[10px] text-slate-400 leading-snug">
          이 프로젝트의 <span className="text-slate-500">소스 코드는 MIT 라이선스</span>입니다.
          다만 기상이 마스코트 이미지는 별도 조건(출처표시 · 상업적 이용금지)이 적용됩니다 —
          리포지토리의 <span className="font-medium text-slate-500">LICENSE-ASSETS.md</span> 와{' '}
          <span className="font-medium text-slate-500">THIRD_PARTY_NOTICES.md</span> 를 참고하세요.
        </p>
      </details>
    </section>
  );
}

/**
 * 점수 귀인. "무엇이 내 점수를 깎았나"에 답한다.
 *
 * 이 세 줄의 기본 노출 자리는 이제 "다음 단계" 카드다 — 감점 요인은 그 자체로
 * 읽히기보다 "그래서 무엇을 할 것인가" 바로 옆에 있을 때 쓸모가 있고, 별도 카드로
 * 떨어져 있으면 추천을 보는 동안 시야에 없었다. 이 카드는 접힌 채로 남아 계산
 * 근거를 다시 펼쳐볼 자리 역할만 한다(<details> 는 open 없이 기본 닫힘).
 *
 * 접힘/펼침은 네이티브 <details>로 처리해 별도 state를 쓰지 않는다.
 */
function FactorBreakdown({ factors }: { factors?: Factor[] | null }) {
  return (
    /*
      h-full 을 뺐다. 이 카드는 이제 칸을 혼자 쓰지 않는다 — 아래에 기상이 박스가
      함께 들어가고, 칸을 채우는 일은 그 박스(flex-1)가 맡는다. 여기서 h-full 을
      들고 있으면 카드가 칸 높이를 전부 먹어 박스가 밀려난다.

      shrink-0: 접혔을 때든 펼쳤을 때든 이 카드는 자기 콘텐츠 높이를 지킨다. 칸에
      자리가 모자랄 때 눌려서 글이 잘리는 쪽이 아니라, 아래 박스가 줄어드는 쪽이다.
    */
    <details id={FACTOR_BREAKDOWN_ID} className="group shrink-0 bg-white rounded-lg shadow-card scroll-mt-4">
      <summary className="p-3 flex justify-between items-center cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold text-slate-900">왜 이 점수인가요?</h2>
        <svg
          xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-slate-500 transition-transform duration-200 group-open:rotate-180"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </summary>

      <div className="px-3 pb-3">
        {!factors || factors.length === 0 ? (
          <p className="text-sm text-slate-500">계산 중...</p>
        ) : (
          <FactorRows factors={factors} />
        )}

        {/*
          이 카드에 "AI 가 생성했습니다" 를 적지 않는다 — 적으면 거짓이 된다.

          여기 세 줄은 백엔드 score_factors() 가 배출강도·공급마진·적합도에서 가중합으로
          계산한 값이고, 그 경로에 LLM 이 없다. 같은 입력이면 언제나 같은 값이 나온다.
          AI 가 만드는 것은 우하단 어시스턴트의 해설과 채팅 답변뿐이다.

          그래서 여기서는 반대쪽을 밝힌다. 화면에 AI 생성물이 섞여 있다는 것을 사용자가
          알아야 한다면, 어느 것이 AI 가 아닌지도 같이 알아야 한다 — 고지가 한쪽에만
          붙어 있으면 나머지 전부의 성격이 불확실해진다.
        */}
        <p className="mt-2.5 pt-2 border-t border-slate-200 text-[11px] text-slate-500 leading-snug">
          ※ 이 세 줄은 배출강도·공급마진·지역 적합도를 가중 합산한 계산 결과입니다.
          AI 가 생성한 문장이 아니며, 같은 설정이면 항상 같은 값이 나옵니다.
          AI 가 작성하는 것은 우측 하단 <span className="font-medium text-slate-600">AI 어시스턴트</span>의
          해설과 채팅 답변이며, 그 답변은 OpenRouter를 통한 AI 모델로 생성됩니다.
        </p>
      </div>
    </details>
  );
}

function CalculationFlow() {
  const steps = [
    { number: '01', title: '입력', detail: '지역 · 날씨 · 에너지 믹스' },
    { number: '02', title: '실제 발전량', detail: '믹스 × 지역 계수 × 기상 배수' },
    { number: '03', title: '영향 계산', detail: '탄소 배출 · 공급과 수요 · 지역 적합도' },
    { number: '04', title: '종합 점수', detail: '탄소 55% · 전력망 30% · 적합도 15%' },
  ];

  return (
    <section aria-labelledby="calculation-flow-heading" className="bg-white rounded-lg shadow-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="calculation-flow-heading" className="text-lg font-bold tracking-tight text-slate-900">계산이 이렇게 이어져요</h2>
        <p className="text-xs text-slate-600">화면의 숫자는 아래 순서로 같은 입력에서 계산됩니다</p>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <li key={step.number} className="min-w-0 rounded-md bg-slate-50 px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black tabular-nums text-brand-700">{step.number}</span>
              <h3 className="text-sm font-bold text-slate-900">{step.title}</h3>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{step.detail}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        적합도 카드와 `왜 이 점수인가요?`를 펼치면 현재 결과에 사용된 항 단위 숫자와 근거를 확인할 수 있습니다.
      </p>
    </section>
  );
}

/**
 * 믹스 한 축의 숫자 입력. 슬라이더와 같은 값을 반대편에서 잡는 손잡이다.
 *
 * 값을 바꾸는 길은 슬라이더와 완전히 같다 — 둘 다 onSliderChange(=Home 의
 * handleSliderChange)를 부르고, 거기서 redistributeMix 가 나머지 두 축을
 * 비율대로 다시 나눈다. 그래서 합계 100% 규칙이 입력에도 그대로 걸리고,
 * 한쪽을 조작하면 다른 쪽 표시가 따라온다(양방향 동기화).
 *
 * draft 는 "지우고 다시 치는 중"의 한 순간만 담는다. 빈 칸을 그대로 넘기면
 * parseFloat('')가 NaN → 0 으로 확정되어, 지우자마자 믹스가 0%로 튀고 두 축이
 * 재분배돼 버린다. 빈 칸일 때는 커밋하지 않고, 포커스가 떠나면 실제 믹스 값으로
 * 되돌린다 — 화면에 남는 값은 언제나 진짜 mix 다.
 */
function MixNumberInput({
  type,
  value,
  onSliderChange,
}: {
  type: MixKey;
  value: number;
  onSliderChange: (type: MixKey, value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-1 shrink-0">
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        aria-label={`${MIX_LABELS[type]} 비중(%) 직접 입력`}
        value={draft ?? String(Math.round(value))}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw !== '') onSliderChange(type, raw);
        }}
        onBlur={() => setDraft(null)}
        className="w-[60px] px-1.5 py-1 text-sm font-bold text-slate-900 text-right tabular-nums bg-white border border-slate-200 rounded-md focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/40"
      />
      <span className="text-sm font-bold text-slate-900">%</span>
    </span>
  );
}

/**
 * 시뮬레이션 요약 카드 — 결과를 읽는 자리이자, 믹스를 조정하는 유일한 자리.
 *
 * 조작기는 세 번 옮겨 다녔다. 처음에는 모달, 다음에는 위쪽 ③ 카드(요약의
 * "설정 변경"이 그리로 스크롤해 올렸다), 그 다음에는 이 카드 안의 아코디언.
 * 셋 다 같은 문제를 남겼다 — 바꾸는 자리와 결과를 읽는 자리가 떨어져 있거나,
 * 한 번 더 눌러야 나타났다. 이제 조작기(슬라이더·숫자 입력)와 결과(점수·전력망·
 * 목표)가 처음부터 같은 카드에 함께 있고, 여닫을 것도 누를 것도 없다.
 *
 * 한때 이 카드 맨 위에는 믹스 도넛도 있었다. 세 줄짜리 슬라이더가 이미 같은
 * 비율을 숫자와 색 점으로 말하고 있었으므로, 도넛은 같은 말을 한 번 더 하면서
 * 카드 상단을 차지할 뿐이었다.
 *
 * Home 안에 두면 렌더마다 재생성되어 슬라이더 포커스가 풀리므로 모듈 스코프에 둔다.
 */
function SimulationSummaryCard({
  mix,
  onSliderChange,
  results,
  isCalculating,
}: {
  mix: EnergyMixValues;
  onSliderChange: (type: MixKey, value: string) => void;
  results: SimulationResult | null;
  isCalculating: boolean;
}) {
  return (
    <div className="h-full bg-white p-3 rounded-lg shadow-card">
      <div className="flex justify-between items-center mb-2 gap-2">
        <h2 className="text-base font-semibold text-slate-900 shrink-0">시뮬레이션 요약</h2>
        {isCalculating && <UpdatingBadge />}
      </div>

      {/*
        에너지 믹스 — 축마다 슬라이더(대강 끌기)와 숫자 입력(정확히 찍기)이 한 줄에
        붙어 있다. 둘은 같은 핸들러를 부르므로 어느 쪽을 건드려도 나머지 하나가
        따라 움직이고, 합계 100% 재분배도 똑같이 걸린다.
      */}
      <div className="mb-2.5">
        {/*
          라벨과 안내를 한 줄로 눕혔다. 위아래로 쌓았을 때 제목 한 줄 + 두 줄짜리
          안내문이 60px 을 먹었는데, 정작 조작기(슬라이더 세 개)보다 안내가 더 컸다.
        */}
        <div className="flex flex-wrap items-baseline gap-x-2 mb-1.5">
          <h3 className="text-sm font-semibold text-slate-700">에너지 믹스</h3>
          <p className="text-[11px] text-slate-600">슬라이더나 숫자를 바꾸면 위 배출·적합도와 아래 점수가 함께 갱신됩니다</p>
        </div>

        <div className="space-y-2">
          {(['renewable', 'nuclear', 'fossil'] as const).map((type) => (
            <div key={type}>
              <div className="flex justify-between items-center text-sm">
                {/* 축마다 고정된 색 점. 세 줄을 글자 없이도 구분하게 한다. */}
                <span className="flex items-center gap-2 text-slate-700 font-medium">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: MIX_COLORS[type] }}
                  />
                  {MIX_LABELS[type]}
                </span>
                <MixNumberInput type={type} value={mix[type]} onSliderChange={onSliderChange} />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                aria-label={`${MIX_LABELS[type]} 비중(%)`}
                value={mix[type]}
                onChange={(e) => onSliderChange(type, e.target.value)}
                className="mt-1 w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
              />
            </div>
          ))}
        </div>

        {/*
          합계를 맞추라고 요구하지 않는다. 한 축을 움직이면 나머지 두 축이 비율대로
          재분배되므로(redistributeMix) 합계는 언제나 100%다.
        */}
        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
          한 축을 움직이면 나머지 둘이 비율대로 나뉘어 합계는 항상 100%입니다.
        </p>
      </div>

      <div className={`pt-2.5 border-t border-slate-200 space-y-2 transition-opacity duration-200 ${isCalculating ? 'opacity-50' : 'opacity-100'}`}>
        {/* Grid Stability */}
        {results?.grid && (
          <div className="flex justify-between items-start gap-3">
            <span className="text-sm font-medium text-slate-600 shrink-0">전력망 안정도</span>
            <span className={`flex items-center gap-1.5 text-sm font-bold text-right ${GRID_STATUS_STYLES[results.grid.status].text}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${GRID_STATUS_STYLES[results.grid.status].dot}`} />
              {results.grid.label}
            </span>
          </div>
        )}

        {/* Goal Progress */}
        <GoalProgress goal={results?.goal} />

        {/* Level Stepper */}
        <LevelStepper level={results?.level} />
      </div>

    </div>
  );
}

/**
 * 결과 리포트 저장 버튼.
 *
 * 원래 "시뮬레이션 요약" 카드 맨 아래에 있었다. 리포트는 화면 전체의 결과를 담는
 * 것인데 버튼이 세 칼럼 중 한 칸 밑에 앉아 있어, 그 카드에 딸린 기능처럼 보였고
 * 무엇보다 페이지를 한참 내려야 닿았다. 지금은 머리글에 붙어 스크롤과 무관하게
 * 늘 같은 자리에 있다.
 *
 * 좁은 화면에서는 글자를 접고 아이콘만 남긴다 — 로고와 나란히 서기에는 버튼이
 * 너무 넓어져 둘이 겹치거나 머리글이 두 줄로 접힌다. 글자를 감출 때도 뜻이
 * 사라지지 않도록 aria-label 을 늘 붙여 둔다.
 */
function SaveReportButton({
  onDownloadPdf,
  isGeneratingPdf,
}: {
  onDownloadPdf: () => void;
  isGeneratingPdf: boolean;
}) {
  const label = isGeneratingPdf ? 'PDF 생성 중...' : '결과 리포트 저장';

  return (
    <button
      type="button"
      onClick={onDownloadPdf}
      disabled={isGeneratingPdf}
      aria-label={label}
      className="flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand-600 px-2.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:px-3.5 sm:py-2 sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      {isGeneratingPdf ? <Spinner className="w-4 h-4" /> : <Download className="w-4 h-4" />}
      {/* 좁은 화면에서는 아이콘만. aria-label 이 이름을 대신 들고 있다. */}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ShareButton({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('이 링크를 복사하세요.', shareUrl);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="현재 실험 링크 복사"
      title="현재 실험 링크 복사"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only">{copied ? '링크가 복사되었습니다' : '현재 실험 링크 복사'}</span>
    </button>
  );
}

function TeacherLinkButton({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    const rawTarget = window.prompt('학생들이 도전할 목표 점수를 입력하세요.', '70');
    if (rawTarget === null) return;
    const target = Number(rawTarget);
    if (!Number.isFinite(target) || target < 0 || target > 100) {
      window.alert('목표 점수는 0에서 100 사이로 입력해 주세요.');
      return;
    }

    const url = new URL(shareUrl);
    url.searchParams.set('mode', 'teacher');
    url.searchParams.set('target', String(Math.round(target)));
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('이 수업 링크를 복사하세요.', url.toString());
    }
  };

  return (
    <button
      type="button"
      onClick={handleCreate}
      aria-label="교사용 수업 링크 만들기"
      title="교사용 수업 링크 만들기"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <GraduationCap className="h-4 w-4" />}
      <span className="sr-only">{copied ? '수업 링크가 복사되었습니다' : '교사용 수업 링크 만들기'}</span>
    </button>
  );
}

function beginnerGrade(score?: number) {
  if (score == null) return { label: '계산 중', tone: 'neutral', message: '내 선택이 어떤 변화를 만드는지 곧 보여드릴게요.' };
  if (score >= 85) return { label: '아주 좋아요', tone: 'good', message: '지구가 편안해하는 조합이에요!' };
  if (score >= 70) return { label: '좋아요', tone: 'good', message: '좋은 방향이에요. 한 걸음 더 가볼까요?' };
  if (score >= 40) return { label: '조금 아쉬워요', tone: 'warn', message: '재생에너지를 조금 더 늘려 볼까요?' };
  return { label: '도전 중', tone: 'bad', message: '괜찮아요. 슬라이더를 움직이며 답을 찾아봐요.' };
}

function beginnerMood(score?: number) {
  if (score == null) return 'ready';
  if (score >= 70) return 'happy';
  if (score >= 40) return 'thinking';
  return 'concerned';
}

function BeginnerMixSlider({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-2xl bg-white/85 p-4 shadow-sm ring-1 ring-slate-900/5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-base font-bold text-slate-800">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
          {label}
        </span>
        <span className="text-xl font-black tabular-nums text-slate-900">{Math.round(value)}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="beginner-range h-3 w-full cursor-pointer appearance-none rounded-full"
        style={{ accentColor: color }}
        aria-label={`${label} 비율`}
        aria-valuetext={`${Math.round(value)}퍼센트`}
      />
    </label>
  );
}

function BeginnerClimateScene({ score }: { score?: number }) {
  const mood = beginnerMood(score);
  return (
    <div className={`climate-scene climate-scene-${mood}`} aria-label="에너지 선택에 따라 변하는 하늘 풍경">
      <span className="climate-sun" aria-hidden="true" />
      <span className="climate-cloud climate-cloud-one" aria-hidden="true" />
      <span className="climate-cloud climate-cloud-two" aria-hidden="true" />
      <span className="climate-hill climate-hill-back" aria-hidden="true" />
      <span className="climate-hill climate-hill-front" aria-hidden="true" />
      <div className="relative z-10 flex h-full items-end justify-between p-5 text-white">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/75">오늘의 지구</p>
          <p className="mt-1 text-lg font-black">{mood === 'happy' ? '맑고 가벼운 하늘' : mood === 'concerned' ? '조금 무거운 하늘' : '변화 중인 하늘'}</p>
        </div>
        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold backdrop-blur">선택에 따라 변해요</span>
      </div>
    </div>
  );
}

function LearningBadges({ unlocked }: { unlocked: string[] }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="학습 배지">
      {LEARNING_BADGES.map((badge) => {
        const isUnlocked = unlocked.includes(badge.id);
        return (
          <span key={badge.id} title={badge.description} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${isUnlocked ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-400'}`}>
            <Award className={`h-3.5 w-3.5 ${isUnlocked ? 'text-amber-600' : 'text-slate-300'}`} aria-hidden="true" />
            {badge.label}
          </span>
        );
      })}
    </div>
  );
}

function BeginnerWizard({
  step,
  setStep,
  selectedRegion,
  selectedWeather,
  onRegionChange,
  onWeatherChange,
  mix,
  onSliderChange,
  results,
  isCalculating,
  quizIndex,
  advanceQuiz,
  onShowDetails,
  hasSavedSession,
  onResetSession,
  teacherMode,
  teacherTarget,
  badges,
}: {
  step: number;
  setStep: (step: number) => void;
  selectedRegion: string;
  selectedWeather: string;
  onRegionChange: (value: string) => void;
  onWeatherChange: (value: string) => void;
  mix: EnergyMixValues;
  onSliderChange: (key: MixKey, value: string) => void;
  results: SimulationResult | null;
  isCalculating: boolean;
  quizIndex: number;
  advanceQuiz: () => void;
  onShowDetails: () => void;
  hasSavedSession: boolean;
  onResetSession: () => void;
  teacherMode: boolean;
  teacherTarget: number;
  badges: string[];
}) {
  const grade = beginnerGrade(results?.sustainability_score);
  const mood = beginnerMood(results?.sustainability_score);
  const carbon = results?.carbon_emissions;
  const metaphor = carbon == null
    ? '선택을 바꾸면 지구의 표정도 달라져요.'
    : carbon <= 120
      ? '탄소 부담이 낮은 편이에요. 맑은 공기를 지키는 선택에 가까워요.'
      : carbon <= 300
        ? '탄소 부담이 중간 정도예요. 화석연료를 줄이면 더 가벼워질 수 있어요.'
        : '탄소 부담이 높은 편이에요. 재생에너지를 늘려 변화를 살펴보세요.';

  return (
    <section id="beginner-wizard" aria-label="초보자 기후·에너지 학습 활동" className="beginner-wizard w-full max-w-[1100px] overflow-hidden rounded-[2rem] bg-[#fffdf7] shadow-xl shadow-slate-900/10 ring-1 ring-white/80">
      <div className="bg-[#fff6d8] px-5 pb-5 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-emerald-700">ClimateLoop 배움 여행</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">내가 고른 에너지, 지구는 어떻게 느낄까?</h2>
          </div>
          <span className="hidden rounded-full bg-white/75 px-3 py-1.5 text-xs font-bold text-slate-600 sm:block">3분 체험</span>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2" aria-label="학습 단계">
          {['지역 고르기', '에너지 바꾸기', '결과와 퀴즈'].map((label, index) => {
            const number = index + 1;
            return (
              <button key={label} type="button" onClick={() => number <= step && setStep(number)} className="text-left" aria-current={step === number ? 'step' : undefined}>
                <div className={`mb-2 h-2 rounded-full ${number <= step ? 'bg-emerald-500' : 'bg-white/70'}`} />
                <span className={`text-xs font-bold ${number === step ? 'text-emerald-800' : 'text-slate-500'}`}>{number}. {label}</span>
              </button>
            );
          })}
        </div>
        {hasSavedSession && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-600" role="status">
            <span>지난 실험을 이어서 보고 있어요.</span>
            <button type="button" onClick={onResetSession} className="font-bold text-emerald-700 underline underline-offset-2">처음부터</button>
          </div>
        )}
        {teacherMode && (
          <div className="mt-4 rounded-xl bg-slate-900 px-3 py-2.5 text-xs text-white" role="status">
            <span className="font-bold text-emerald-300">수업 미션</span>
            <span className="ml-2">지속 가능성 {teacherTarget}점에 도전해 보세요.</span>
          </div>
        )}
      </div>

      <div className="grid gap-5 p-5 sm:p-8 lg:grid-cols-[1fr_0.72fr] lg:items-center">
        <div className="min-w-0">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-bold text-emerald-700">1단계 · 내 동네부터 시작해요</p>
                <h3 className="mt-1 text-3xl font-black tracking-tight text-slate-900">어디의 이야기를<br />살펴볼까요?</h3>
              </div>
              <select value={selectedRegion} onChange={(event) => onRegionChange(event.target.value)} className="h-16 w-full rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-5 text-xl font-black text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" aria-label="지역 선택">
                {REGION_NAMES.map((region) => <option key={region} value={region}>{region}</option>)}
              </select>
              <div>
                <p className="mb-2 text-sm font-bold text-slate-600">오늘의 날씨를 골라보세요</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {WEATHER_SCENARIOS.map((scenario) => <button key={scenario.id} type="button" onClick={() => onWeatherChange(scenario.id)} className={`min-h-12 rounded-xl px-2 text-sm font-bold transition ${selectedWeather === scenario.id ? 'bg-emerald-500 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{scenario.label}</button>)}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-bold text-emerald-700">2단계 · 에너지 레시피 만들기</p>
                <h3 className="mt-1 text-3xl font-black tracking-tight text-slate-900">발전원 비율을<br />살짝 바꿔볼까요?</h3>
                <p className="mt-2 text-sm text-slate-600">한 가지를 올리면 나머지는 자동으로 맞춰져요.</p>
              </div>
              <div className="space-y-3">
                <BeginnerMixSlider label="햇빛·바람 에너지" value={mix.renewable} color="#35b779" onChange={(value) => onSliderChange('renewable', value)} />
                <BeginnerMixSlider label="원자력 에너지" value={mix.nuclear} color="#7c83fd" onChange={(value) => onSliderChange('nuclear', value)} />
                <BeginnerMixSlider label="화석연료" value={mix.fossil} color="#f29c7c" onChange={(value) => onSliderChange('fossil', value)} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-bold text-emerald-700">3단계 · 결과를 읽어봐요</p>
                <h3 className="mt-1 text-3xl font-black tracking-tight text-slate-900">{selectedRegion}의<br />에너지 표정이에요.</h3>
              </div>
              <div className={`rounded-3xl p-5 ${grade.tone === 'good' ? 'bg-emerald-50' : grade.tone === 'warn' ? 'bg-amber-50' : grade.tone === 'bad' ? 'bg-rose-50' : 'bg-slate-100'}`}>
                <div className="flex items-center justify-between gap-4">
                  <div><p className="text-sm font-bold text-slate-600">지구 건강 점수</p><p className="mt-1 text-4xl font-black text-slate-900">{results?.sustainability_score ?? '--'}<span className="ml-1 text-lg">점</span></p></div>
                  <span className={`rounded-full px-3 py-2 text-sm font-black ${grade.tone === 'good' ? 'bg-emerald-500 text-white' : grade.tone === 'warn' ? 'bg-amber-400 text-amber-950' : 'bg-rose-400 text-white'}`}>{grade.label}</span>
                </div>
                {teacherMode && <p className="mt-2 text-xs font-bold text-slate-600">미션 목표: {teacherTarget}점 · {results && results.sustainability_score >= teacherTarget ? '달성' : '아직 도전 중'}</p>}
                <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-700">{grade.message}</p>
              </div>
              {results && (teacherMode ? results.sustainability_score >= teacherTarget : results.goal?.achieved) && (
                <div className="flex items-center gap-3 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-black text-emerald-900" role="status" aria-live="polite">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white" aria-hidden="true"><Check className="h-4 w-4 text-emerald-600" /></span>
                  목표 점수에 도착했어요! 직접 바꿔 만든 결과예요.
                </div>
              )}
              <div className="rounded-2xl bg-[#fff6d8] p-4"><p className="text-xs font-bold text-amber-800">쉽게 말하면</p><p className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">{metaphor}</p><p className="mt-2 text-[10px] leading-snug text-slate-500">※ 공식적인 나무·자동차 환산값이 아니라, 이 시뮬레이션 안에서 상대적인 부담을 이해하기 위한 표현이에요.</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">다음에 해볼 일</p><p className="mt-1 text-sm font-bold text-slate-800">{isCalculating ? '새 조합을 살펴보는 중이에요...' : results?.next_action?.reason ?? '슬라이더를 움직여 다른 결과도 비교해보세요.'}</p></div>
            </div>
          )}
        </div>

        <div className="flex min-h-[250px] flex-col justify-end gap-4">
          <BeginnerClimateScene score={results?.sustainability_score} />
          <div className="flex items-end gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
            <Image src="/images/gisangi-hello.png" alt="기상이" width={82} height={82} className={`h-20 w-20 shrink-0 object-contain transition-transform duration-300 ${mood === 'happy' ? '-rotate-6' : mood === 'concerned' ? 'rotate-6' : ''}`} />
            <div className="relative rounded-2xl bg-[#e8f7ee] px-4 py-3 text-sm font-bold leading-relaxed text-slate-700">
              {step === 1 ? `${selectedRegion}을 골랐어요. 이제 에너지 조합을 만들어봐요!` : step === 2 ? grade.message : grade.message}
              <span className="absolute bottom-3 -left-2 h-4 w-4 rotate-45 bg-[#e8f7ee]" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      {step === 3 && <div className="border-t border-slate-100 bg-[#fbfaf4] p-5 sm:p-8"><EnergyQuizCard key={quizIndex} question={QUIZ_POOL[quizIndex]} onNext={advanceQuiz} /></div>}

      {step === 3 && <div className="px-5 pb-4 sm:px-8"><LearningBadges unlocked={badges} /></div>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 sm:px-8">
        <button type="button" onClick={onShowDetails} className="text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-800">계산 근거 펼치기</button>
        <div className="flex gap-2">
          {step > 1 && <button type="button" onClick={() => setStep(step - 1)} className="min-h-11 rounded-xl px-5 text-sm font-bold text-slate-600 hover:bg-slate-100">이전</button>}
          {step < 3 && <button type="button" onClick={() => setStep(step + 1)} className="min-h-11 rounded-xl bg-emerald-500 px-6 text-sm font-black text-white shadow-md shadow-emerald-500/20 transition hover:bg-emerald-600">다음으로</button>}
          {step === 3 && <button type="button" onClick={() => setStep(1)} className="min-h-11 rounded-xl bg-emerald-500 px-6 text-sm font-black text-white shadow-md shadow-emerald-500/20 transition hover:bg-emerald-600">다시 해보기</button>}
        </div>
      </div>
    </section>
  );
}

function SimulationContextBar({
  region,
  weather,
  score,
  isCalculating,
}: {
  region: string;
  weather: string;
  score?: number;
  isCalculating: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2.5 shadow-card backdrop-blur-sm sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
          <MapPin className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">현재 실험</p>
          <p className="truncate text-sm font-semibold text-slate-900">
            {region} <span className="px-1 text-slate-400">·</span> {weather}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span className="hidden h-5 w-px bg-slate-200 sm:block" aria-hidden="true" />
        <Gauge className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span>지속 가능성</span>
        <strong className="tabular-nums text-slate-900">{score == null ? '--' : `${score}점`}</strong>
        <span className={`flex items-center gap-1.5 ${isCalculating ? 'text-brand-700' : 'text-slate-500'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isCalculating ? 'animate-pulse bg-brand-600' : 'bg-emerald-500'}`} aria-hidden="true" />
          {isCalculating ? '계산 중' : '최신 결과'}
        </span>
      </div>
    </div>
  );
}

function RegionComparisonCard({
  comparison,
  regionA,
  regionB,
  onClose,
}: {
  comparison: RegionComparison | null;
  regionA: string;
  regionB: string;
  onClose: () => void;
}) {
  if (!comparison) return null;
  const rows = comparison.regions;
  const best = rows.map((result) => Object.entries(result.suitability).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '--');
  const metrics = [
    { label: '지속 가능성', values: rows.map((result) => `${result.sustainability_score}점`), winner: 'higher' },
    { label: '배출강도', values: rows.map((result) => `${result.carbon_emissions.toFixed(1)} g`), winner: 'lower' },
    { label: '전력망', values: rows.map((result) => result.grid.label), winner: 'none' },
    { label: '가장 적합한 발전원', values: best, winner: 'none' },
  ];
  return (
    <section aria-labelledby="comparison-heading" className="rounded-lg bg-white p-3 shadow-card sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">같은 조건 비교</p>
          <h2 id="comparison-heading" className="mt-0.5 text-base font-bold text-slate-900">{regionA}와 {regionB}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">비교 닫기</button>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
        <div>{regionA}</div><div>{regionB}</div>
      </div>
      <div className="divide-y divide-slate-100">
        {metrics.map((metric) => {
          const numeric = metric.winner === 'none' ? [] : rows.map((result) => metric.label === '지속 가능성' ? result.sustainability_score : result.carbon_emissions);
          const winner = metric.winner === 'higher' ? Math.max(...numeric) : Math.min(...numeric);
          return (
            <div key={metric.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 py-2 text-xs">
              {metric.values.map((value, index) => (
                <div key={`${metric.label}-${index}`} className={`min-w-0 ${numeric[index] === winner && metric.winner !== 'none' ? 'font-bold text-brand-700' : 'text-slate-700'}`}>
                  <span className="mr-1 text-[10px] text-slate-400 sm:hidden">{metric.label}</span>{value}
                </div>
              ))}
              <span className="col-span-2 -mt-1 text-[10px] text-slate-500 sm:col-span-2">{metric.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComparisonControls({
  selectedRegion,
  compareRegion,
  onChange,
}: {
  selectedRegion: string;
  compareRegion: string | null;
  onChange: (region: string | null) => void;
}) {
  const options = REGION_NAMES.filter((region) => region !== selectedRegion);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white/60 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-700">지역 비교</span>
      <select
        aria-label="비교할 지역"
        value={compareRegion ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="min-w-32 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
      >
        <option value="">비교 지역 선택</option>
        {options.map((region) => <option key={region} value={region}>{region}</option>)}
      </select>
      <span className="text-slate-500">현재 지역과 같은 기상·믹스 조건으로 비교합니다.</span>
    </div>
  );
}

/** 채팅 한 줄. 백엔드 ChatTurn 과 같은 모양이다. */
interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * /chat 에 함께 보내는 화면 상태.
 *
 * 전부 이미 계산되어 화면에 떠 있는 값이다. 여기서 새로 만들거나 다시 계산하지
 * 않는 이유는, 사용자가 보고 있는 숫자와 답변 속 숫자가 반드시 같아야 하기
 * 때문이다. 필드 이름은 백엔드 ChatContext 와 맞춘다.
 */
interface ChatContextPayload {
  region: string;
  weather: string;
  mix: EnergyMixValues;
  score?: number;
  carbon?: number;
  grid_status?: string;
  best_source?: string;
  factors: { label: string; penalty: number; detail: string }[];
  summary?: string;
}

const CHAT_PANEL_ID = 'ai-assistant-chat';

/** 어떤 원인이든 사용자가 할 수 있는 일은 하나뿐이므로 안내도 하나로 모은다. */
const CHAT_ERROR_MESSAGE = '답변을 받지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** "생각 중" 표시. 점 세 개가 시차를 두고 튄다. */
function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" role="status" aria-label="답변을 생각하는 중">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** 말풍선 한 개. 사용자는 오른쪽 파랑, 어시스턴트는 왼쪽 회색. */
function ChatBubble({ role, children }: { role: ChatTurn['role']; children: React.ReactNode }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-slate-50 text-slate-800 border border-slate-200 rounded-bl-sm'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * AI 어시스턴트 — 화면 우하단에 고정된 floating action button(FAB)과, 누르면
 * 그 위로 펼쳐지는 채팅 패널.
 *
 * 예전에는 "결과 해석" 그리드의 한 칸을 카드로 차지하고 있었다. 접힌 상태에서도
 * 카드 한 장 높이를 계속 쓰는데, 정작 그 칸에서 읽을 것은 "무엇이든 물어보세요"
 * 한 줄뿐이었다 — 같은 열의 "왜 이 점수인가요?"가 좁아진 대가로 얻는 것이 너무
 * 적었다. 지금은 그리드에서 빠져 나와 화면에 떠 있고, 그 칸은 귀인 카드가 그대로
 * 이어받는다. 스크롤 위치와 무관하게 늘 닿는 자리라는 점도 함께 얻는다.
 *
 * 첫 말풍선은 /calculate 의 ai_message 를 prop 에서 바로 그린다. state 에 복사해
 * 두지 않는 것은 지역·기상·믹스를 바꾸면 해설이 새로 오기 때문이다 — 복사해 두면
 * 대화창 맨 위에 낡은 문장이 남는다.
 */
function AiAssistantFab({
  aiMessage,
  aiSource,
  isAiLoading,
  context,
  isHidden = false,
}: {
  aiMessage?: string;
  aiSource?: AiSource;
  isAiLoading: boolean;
  context: ChatContextPayload;
  /** PDF 캡처처럼 화면을 그대로 떠내는 동안에는 통째로 감춘다. */
  isHidden?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 실패한 질문. "다시 시도"가 같은 말풍선을 하나 더 만들지 않고 재전송하는 데 쓴다. */
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 버튼과 패널을 함께 감싼다. 이 밖을 누르면 닫는다. */
  const rootRef = useRef<HTMLDivElement | null>(null);

  const intro = aiMessage || '슬라이더를 조절하여 환경에 미치는 영향을 확인해 보세요.';

  // 말풍선이 쌓이면 아래쪽이 보이게 한다.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns, isSending, error, isOpen]);

  /**
   * 패널 바깥 클릭과 Esc 로 닫기.
   *
   * 열려 있을 때만 리스너를 건다 — 닫힌 상태에서 문서 전역 이벤트를 붙잡고 있을
   * 이유가 없다. isHidden 도 함께 보는 이유는 그때 아무것도 렌더하지 않기
   * 때문이다: 화면에 없는 패널을 Esc 로 닫아 두면 다시 나타났을 때 사용자가
   * 남겨 둔 자리가 아니라 접힌 상태로 돌아온다.
   *
   * pointerdown 을 쓰는 이유는 click 이면 "바깥을 눌러 닫는" 판정이 마우스를
   * 뗄 때까지 밀리고, 누른 곳과 뗀 곳이 다를 때 어긋나기 때문이다.
   */
  useEffect(() => {
    if (!isOpen || isHidden) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isHidden]);

  /**
   * priorTurns 를 인자로 받는 이유: 방금 화면에 띄운 사용자 말풍선은 message 로
   * 따로 보내므로 history 에 또 들어가면 안 된다. 재시도 경로에도 같은 규칙이
   * 걸리도록 호출부가 명시적으로 넘긴다.
   */
  const sendMessage = async (message: string, priorTurns: ChatTurn[]) => {
    setIsSending(true);
    setError(null);
    setFailedMessage(null);

    // 첫 말풍선(요약)도 어시스턴트 발화로 함께 넘긴다 — "방금 말한 그거"를
    // 되물었을 때 모델이 무엇을 가리키는지 알 수 있어야 한다.
    const history: ChatTurn[] = [{ role: 'assistant', content: intro }, ...priorTurns];

    try {
      if (!API_BASE_URL) throw new Error(MISSING_API_URL_MESSAGE);

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context, history }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`/chat 요청 실패: ${response.status} ${detail.substring(0, 200)}`);
      }

      const data = await response.json();
      const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
      // 200 이어도 본문이 비면 빈 말풍선이 생긴다. 그것도 실패로 다룬다.
      if (!reply) throw new Error('/chat 응답에 reply 가 없습니다.');

      setTurns((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      // 상세 원인은 콘솔에만 남긴다. 화면에는 사용자가 할 수 있는 일만 적는다.
      console.error('AI 어시스턴트 응답 실패:', err);
      setError(CHAT_ERROR_MESSAGE);
      setFailedMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isSending) return;

    setDraft('');
    // 화면에는 즉시 띄우고, 서버에는 이 말풍선 직전까지를 history 로 보낸다.
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    void sendMessage(message, turns);
  };

  const handleRetry = () => {
    if (!failedMessage || isSending) return;
    // 실패한 사용자 말풍선은 목록 맨 끝에 그대로 남아 있으므로 history 에서 뺀다.
    void sendMessage(failedMessage, turns.slice(0, -1));
  };

  /*
    PDF 생성 중에는 아예 렌더하지 않는다 — display:none 과 달리 전역 리스너까지
    함께 걷힌다.

    열림 상태(isOpen)와 대화 내용(turns)은 그대로 둔다. 리포트 생성은 10초 안팎이
    걸리고, 그 사이 물어보던 대화를 지워 버리면 돌아온 사용자가 다시 처음부터
    물어야 한다. 다시 나타날 때 패널은 두고 간 그대로다.
  */
  if (isHidden) return null;

  return (
    /*
      right/bottom 에 env(safe-area-inset-*) 를 더한다. iOS 홈 인디케이터나 안드로이드
      제스처 바가 있는 화면에서 버튼이 그 위에 겹쳐 앉으면 눌러도 시스템이 먼저
      먹는다. 지원하지 않는 브라우저에서는 env() 가 0 으로 계산되어 기본 여백만 남는다.

      data-pdf-exclude / print:hidden 은 화면을 그대로 떠내는 경로에서 이 요소를 빼기
      위한 표시다. 지금 PDF 는 백엔드가 만들고 프론트는 내려받기만 하므로 isHidden
      한 줄로 충분하지만, 브라우저 인쇄나 html2canvas 계열 캡처가 나중에 붙어도
      이 버튼이 리포트에 찍히지 않게 표시를 함께 남긴다.
    */
    <div
      ref={rootRef}
      data-pdf-exclude="true"
      data-html2canvas-ignore="true"
      className="print:hidden fixed z-50 flex flex-col items-end gap-3
                 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))]
                 sm:right-6 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]"
    >
      {isOpen && (
        <div
          id={CHAT_PANEL_ID}
          role="dialog"
          aria-label="AI 어시스턴트"
          /*
            폭은 데스크톱에서 23rem, 좁은 화면에서는 양옆 여백을 뺀 만큼까지만.
            높이도 vh 로 묶어 두어 주소창이 접히는 모바일에서 패널이 화면을 넘지 않는다.
          */
          className="w-[min(23rem,calc(100vw-2rem))] max-h-[min(32rem,calc(100vh-9rem))]
                     flex flex-col overflow-hidden rounded-lg border border-slate-200
                     bg-white shadow-lg shadow-slate-900/10 origin-bottom-right
                     motion-safe:animate-[climateloop-fab-panel-in_180ms_ease-out]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 shrink-0 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900 shrink-0">무엇이든 물어보세요</h2>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isAiLoading ? (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <Spinner className="w-3 h-3" />
                  설명 작성 중
                </span>
              ) : (
                // 작성 중에는 아직 출처가 확정되지 않았으므로 로딩 배지에 자리를 내준다.
                aiSource && <AiSourceBadge source={aiSource} />
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center w-7 h-7 rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <X className="w-4 h-4" />
                <span className="sr-only">AI 어시스턴트 닫기</span>
              </button>
            </div>
          </div>

          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-2.5"
          >
            {/* 첫 말풍선 = 지금 화면의 요약. state 가 아니라 prop 에서 바로 그린다. */}
            <ChatBubble role="assistant">{intro}</ChatBubble>

            {turns.map((turn, index) => (
              <ChatBubble key={`${turn.role}-${index}`} role={turn.role}>
                {turn.content}
              </ChatBubble>
            ))}

            {isSending && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-lg rounded-bl-sm bg-slate-50 border border-slate-200">
                  <TypingDots />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
                <div className="min-w-0">
                  <p className="leading-relaxed">{error}</p>
                  {failedMessage && (
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="mt-1.5 font-semibold underline underline-offset-2 hover:text-amber-900"
                    >
                      다시 시도
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 px-4 py-3">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={isSending}
                aria-label="AI 어시스턴트에게 보낼 질문"
                placeholder="이 지역에 왜 태양광이 맞나요?"
                className="flex-1 min-w-0 px-3 py-2 text-sm text-slate-900 bg-white border border-slate-200 rounded-md placeholder:text-slate-400 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/40 disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={isSending || !draft.trim()}
                className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {isSending ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                <span className="sr-only">보내기</span>
              </button>
            </form>

            {/*
              AI 생성물이라는 사실을 패널 안에서 밝힌다.

              헤더의 "AI 생성 / 즉시 요약" 배지가 이미 있지만, 그것은 아이콘과 두 글자로
              된 상태 표시라 어떤 서비스가 문장을 썼는지는 말하지 않는다. 생성 주체를
              이름으로 적는 자리는 따로 있어야 한다 — 사용자가 이 답변을 어디까지 믿을지
              판단하는 데 필요한 정보다.

              입력창 바로 아래에 두는 이유: 질문을 보내기 직전에 읽히는 자리다. 패널을
              닫았다 열면 스크롤이 대화 끝으로 가므로 위쪽 고지는 시야에서 사라지지만
              이 줄은 남는다.
            */}
            <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
              이 답변은 OpenRouter를 통한 AI 모델로 생성됩니다. 답변은 지금 화면의 계산 결과를
              근거로 작성되며, 실제 관측·통계가 아닙니다. AI 호출이 불가능할 때는 계산 결과로
              만든 문구로 대체되고, 위 배지가 &ldquo;즉시 요약&rdquo;으로 바뀝니다.
            </p>
          </div>
        </div>
      )}

      {/*
        맥박(animate-ping) 후광이 있었다. 아무 일도 일어나지 않았는데 계속 뛰면서
        시선을 끄는 순수 장식이었고, 옆의 "결과 리포트 저장"보다 이 보조 기능이 더
        눈에 띄는 결과가 됐다. 걷어냈다.
      */}
      <span className="relative flex shrink-0">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls={CHAT_PANEL_ID}
          className="relative flex items-center justify-center w-14 h-14 sm:w-[60px] sm:h-[60px] rounded-full bg-slate-900 text-white hover:bg-slate-800 transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
          <span className="sr-only">
            {isOpen ? 'AI 어시스턴트 닫기' : 'AI 어시스턴트 열기'}
          </span>
        </button>
      </span>
    </div>
  );
}

export default function Home() {
  const [wizardStep, setWizardStep] = useState(1);
  const [showDetails, setShowDetails] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [teacherMode, setTeacherMode] = useState(false);
  const [teacherTarget, setTeacherTarget] = useState(70);
  const [badges, setBadges] = useState<string[]>([]);
  const [selectedRegion, setSelectedRegion] = useState("서울");
  const [compareRegion, setCompareRegion] = useState<string | null>(null);
  const shareReady = useRef(false);
  const [selectedWeather, setSelectedWeather] = useState("맑음");
  const [mix, setMix] = useState<EnergyMixValues>({
    renewable: 33.3,
    nuclear: 33.3,
    fossil: 33.4
  });
  // 조정 결과는 mix 하나에만 담긴다 — 임시 버퍼(tempMix)를 두던 시절에는 숫자
  // 입력칸이 합계 100%를 벗어난 중간 상태를 들고 있어야 했지만, 조작기가
  // 슬라이더뿐이면 redistributeMix 가 매 조작마다 합계를 맞춰 준다.

  const [results, setResults] = useState<SimulationResult | null>(null);
  const [comparison, setComparison] = useState<RegionComparison | null>(null);
  const [emissionHistory, setEmissionHistory] = useState<number[]>([]);
  // 17개 시·도의 발전원별 지수. 지도 마커 크기와 클릭 시 뜨는 원형 차트에 쓴다.
  // /calculate 는 선택한 한 지역만 주므로 지역 간 비교를 할 수 없어 따로 받는다.
  const [regionStats, setRegionStats] = useState<RegionStat[]>([]);
  /**
   * 발전원 구성이 KPX 실시간 데이터를 반영했는지 ("live") 로컬 추정값인지 ("fallback").
   *
   * /regions 응답의 data_source 를 그대로 담는다. 섹션 1 각주가 이 값으로 갈린다.
   * 기본값을 "fallback" 으로 두는 이유: 아직 응답을 못 받은 첫 렌더에서 "실시간
   * 연동"이라고 적혀 있으면, 그 문장이 참이 되기 전에 화면에 나온다.
   */
  const [regionsSource, setRegionsSource] = useState<'live' | 'fallback'>('fallback');
  /**
   * 기상청 실황·특보로 판별한 추천 시나리오. 참고 배지 전용이다.
   *
   * null = 판정하지 못함(키 미설정·상류 장애). 그때 배지는 렌더링되지 않는다.
   * 이 값은 selectedWeather 를 절대 건드리지 않는다 — 탭은 사용자 것이다.
   */
  const [liveScenario, setLiveScenario] = useState<string | null>(null);
  const [weatherSnapshot, setWeatherSnapshot] = useState<WeatherSnapshot | null>(null);
  const [climateNormals, setClimateNormals] = useState<ClimateNormals | null>(null);

  // 계산 진행 여부. 결과를 비우는 대신 "업데이트 중"으로 표현하는 데 쓴다.
  // AI 대기와는 분리한다. 합치면 화면 전체가 10초간 흐려진다.
  const [isCalculating, setIsCalculating] = useState(false);
  // AI 해설(2단계) 대기 여부. AI 패널에만 영향을 준다.
  const [isAiLoading, setIsAiLoading] = useState(false);
  // 1단계(계산) 실패 사유. 성공하면 즉시 해제한다.
  // 2단계(AI) 실패는 여기에 담지 않는다 — 1단계의 결정론적 요약이 남아 치명적이지 않다.
  const [apiError, setApiError] = useState<string | null>(null);
  // PDF 생성 진행 여부. /generate-pdf 는 AI 해설을 포함해 10초 안팎이 걸린다.
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  /**
   * PDF 표지에 박을 생성 일시. null 이면 지금 만들고 있지 않다는 뜻이다.
   *
   * 이 값이 state 인 이유: 캡처는 DOM 을 읽으므로, 표지에 찍힐 시각이 화면(정확히는
   * 화면 밖 리포트)에 이미 그려진 뒤에 시작해야 한다. 클릭 핸들러에서 곧바로
   * 캡처하면 아직 이전 렌더의 값이 떠진다. 그래서 클릭은 시각만 심고, 아래
   * useEffect 가 렌더가 끝난 다음 캡처를 맡는다.
   */
  const [pdfStamp, setPdfStamp] = useState<{ display: string; slug: string } | null>(null);

  /**
   * 지금 내고 있는 퀴즈 문제의 인덱스.
   *
   * 초기값을 0 으로 고정한다 — Math.random() 으로 정하면 서버가 그린 문제와 클라이언트가
   * 그린 문제가 달라 hydration 이 깨진다. 무작위 교체는 사용자가 무언가를 누른 뒤,
   * 즉 이벤트 핸들러에서만 일어난다.
   */
  const [quizIndex, setQuizIndex] = useState(0);

  /** 지역·기후 변경과 "다음 문제" 버튼이 함께 쓰는 문제 교체. */
  const advanceQuiz = () => setQuizIndex((prev) => pickNextQuizIndex(prev));

  /* URL 상태를 클라이언트에서 복원하는 hydration 경계다. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetParam = Number(params.get('target'));
    if (params.get('mode') === 'teacher') setTeacherMode(true);
    if (Number.isFinite(targetParam)) setTeacherTarget(Math.min(100, Math.max(0, targetParam)));
    try {
      const savedBadges = JSON.parse(localStorage.getItem(BADGES_STORAGE_KEY) ?? '[]');
      if (Array.isArray(savedBadges)) setBadges(savedBadges.filter((value): value is string => typeof value === 'string'));
    } catch {
      localStorage.removeItem(BADGES_STORAGE_KEY);
    }
    const hasSharedState = ['region', 'weather', 'renewable', 'nuclear', 'fossil', 'compare', 'mode', 'target']
      .some((key) => params.has(key));
    if (!hasSharedState) {
      try {
        const saved = JSON.parse(localStorage.getItem(BEGINNER_SESSION_KEY) ?? 'null') as {
          step?: number;
          region?: string;
          weather?: string;
          compare?: string | null;
          mix?: EnergyMixValues;
        } | null;
        if (saved) {
          if (saved.region && REGION_NAMES.includes(saved.region)) setSelectedRegion(saved.region);
          if (saved.weather && WEATHER_SCENARIOS.some((scenario) => scenario.id === saved.weather)) setSelectedWeather(saved.weather);
          if (saved.compare && REGION_NAMES.includes(saved.compare)) setCompareRegion(saved.compare);
          if (saved.mix && Object.values(saved.mix).every((value) => Number.isFinite(value))) setMix(saved.mix);
          if (saved.step && saved.step >= 1 && saved.step <= 3) setWizardStep(saved.step);
          setHasSavedSession(true);
        }
      } catch {
        localStorage.removeItem(BEGINNER_SESSION_KEY);
      }
    }
    const sharedRegion = params.get('region');
    const sharedWeather = params.get('weather');
    const sharedCompare = params.get('compare');
    const parseMix = (key: MixKey, fallback: number) => {
      const value = Number(params.get(key));
      return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
    };
    if (sharedRegion && REGION_NAMES.includes(sharedRegion)) setSelectedRegion(sharedRegion);
    if (sharedWeather && WEATHER_SCENARIOS.some((scenario) => scenario.id === sharedWeather)) setSelectedWeather(sharedWeather);
    if (sharedCompare && REGION_NAMES.includes(sharedCompare) && sharedCompare !== sharedRegion) setCompareRegion(sharedCompare);
    if (params.has('renewable') || params.has('nuclear') || params.has('fossil')) {
      setMix({
        renewable: parseMix('renewable', 33.3),
        nuclear: parseMix('nuclear', 33.3),
        fossil: parseMix('fossil', 33.4),
      });
    }
    shareReady.current = true;
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const unlockBadge = (id: string) => {
    setBadges((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      localStorage.setItem(BADGES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const shareUrl = typeof window === 'undefined' ? '' : (() => {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({
      region: selectedRegion,
      weather: selectedWeather,
      renewable: mix.renewable.toFixed(1),
      nuclear: mix.nuclear.toFixed(1),
      fossil: mix.fossil.toFixed(1),
      ...(teacherMode ? { mode: 'teacher', target: String(teacherTarget) } : {}),
      ...(compareRegion ? { compare: compareRegion } : {}),
    }).toString();
    return url.toString();
  })();

  useEffect(() => {
    if (!shareReady.current) return;
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({
      region: selectedRegion,
      weather: selectedWeather,
      renewable: mix.renewable.toFixed(1),
      nuclear: mix.nuclear.toFixed(1),
      fossil: mix.fossil.toFixed(1),
      ...(teacherMode ? { mode: 'teacher', target: String(teacherTarget) } : {}),
      ...(compareRegion ? { compare: compareRegion } : {}),
    }).toString();
    window.history.replaceState(null, '', url);
  }, [selectedRegion, selectedWeather, mix, compareRegion, teacherMode, teacherTarget]);

  useEffect(() => {
    if (showDetails) return;
    localStorage.setItem(BEGINNER_SESSION_KEY, JSON.stringify({
      step: wizardStep,
      region: selectedRegion,
      weather: selectedWeather,
      compare: compareRegion,
      mix,
    }));
  }, [wizardStep, selectedRegion, selectedWeather, compareRegion, mix, showDetails]);

  const resetBeginnerSession = () => {
    localStorage.removeItem(BEGINNER_SESSION_KEY);
    setWizardStep(1);
    setSelectedRegion('서울');
    setSelectedWeather('맑음');
    setCompareRegion(null);
    setMix({ renewable: 33.3, nuclear: 33.3, fossil: 33.4 });
    setHasSavedSession(false);
    setBadges([]);
    localStorage.removeItem(BADGES_STORAGE_KEY);
  };
  // 추천 적용으로 시작된 계산인지 구분하고, 완료 후 "적용 완료" 피드백을 띄우는 데 쓴다.
  // 값은 적용 시점의 expected_score이며, 사용자가 직접 조작하면 null로 되돌린다.
  const [appliedTarget, setAppliedTarget] = useState<number | null>(null);

  const handleSliderChange = (type: keyof typeof mix, value: string) => {
    let newValue = parseFloat(value);
    if (isNaN(newValue) || newValue < 0) {
      newValue = 0;
    }
    if (newValue > 100) {
      newValue = 100;
    }

    // 시뮬레이션 곡선도 같은 규칙을 써야 예고값과 실제 조작 결과가 일치하므로
    // 재분배 로직을 모듈 스코프 헬퍼 하나로 모았다.
    const newMix = redistributeMix(mix, type, newValue);

    setMix(newMix);
    unlockBadge('mixer');
    setAppliedTarget(null); // 직접 조작하면 "적용 완료" 피드백을 거둔다
  };

  // 추천 행동 적용. mix만 바꾸면 아래 재계산 useEffect가 나머지를 처리하므로
  // 별도 요청 로직이 필요 없다.
  //
  // isCalculating을 여기서 즉시 켜는 이유: 재계산 useEffect는 300ms 디바운스 뒤에
  // 켜므로, 그대로 두면 클릭 직후 300ms 동안 버튼이 아무 반응 없는 것처럼 보인다.
  const handleApplyNextAction = (action: NextAction) => {
    setAppliedTarget(action.expected_score);
    setIsCalculating(true);
    setMix(action.resulting_mix);
  };

  // 지역/기상이 바뀌면 배출량 추이를 초기화한다. 조건이 다른 값을 한 선으로 이으면
  // 스파크라인이 "내 믹스 조작의 결과"가 아니게 되기 때문이다.
  // 초기화를 useEffect가 아닌 이벤트 핸들러에서 하는 이유는, 렌더 후 setState를
  // 한 번 더 유발하지 않고 같은 배치에서 처리하기 위해서다.
  /*
    지역·기후를 바꾸면 퀴즈 문제도 함께 새로 뽑는다(advanceQuiz).

    useEffect([selectedRegion, selectedWeather]) 로 감시하지 않고 이 두 핸들러에서
    직접 부르는 이유가 두 가지다. 첫째, effect 는 마운트 때도 한 번 돌아서 첫 화면의
    문제가 무작위가 되고 — 그러면 서버가 그린 문제와 어긋난다. 둘째, 여기 있는 조기
    반환(같은 값이면 아무것도 하지 않는다)이 그대로 적용된다: 이미 선택된 지역을 다시
    고른 것은 "바꿨다"가 아니므로 문제도 그대로 있어야 한다.
  */
  const handleRegionChange = (region: string) => {
    if (region === selectedRegion) return;
    setSelectedRegion(region);
    setEmissionHistory([]);
    setAppliedTarget(null);
    if (region === compareRegion) setCompareRegion(null);
    setComparison(null);
    unlockBadge('explorer');
    advanceQuiz();
  };

  const handleWeatherChange = (weather: string) => {
    if (weather === selectedWeather) return;
    setSelectedWeather(weather);
    setEmissionHistory([]);
    setAppliedTarget(null);
    setComparison(null);
    advanceQuiz();
  };

  useEffect(() => {
    // 뒤늦게 도착한 이전 요청이 최신 결과를 덮어쓰지 않도록 취소 플래그를 둔다.
    // 로딩 표시가 생기면서 이 경합이 눈에 보이게 되므로 함께 처리한다.
    let cancelled = false;

    const requestCalculate = async (includeAi: boolean) => {
      if (!API_BASE_URL) throw new Error(MISSING_API_URL_MESSAGE);

      const response = await fetch(`${API_BASE_URL}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...mix,
          region: selectedRegion,
          weather_scenario: selectedWeather,
          include_ai: includeAi,
        }),
      });

      if (!response.ok) {
        // 응답이 JSON이 아닐 수 있으므로 텍스트로 먼저 읽습니다.
        const errorText = await response.text();
        throw new Error(`API 요청 실패: ${response.status} ${response.statusText}. 응답: ${errorText.substring(0, 200)}...`);
      }

      return response.json();
    };

    // 1단계: AI 없이 계산만. 조작 중에도 점수·목표·단계·요인·추천이 즉시 따라온다.
    // 이때 내려오는 ai_message는 백엔드가 만든 결정론적 요약이라 그 자체로 읽을 만하다.
    const fetchScores = async () => {
      setIsCalculating(true);
      try {
        const data = await requestCalculate(false);
        if (cancelled) return;

        // 기존 결과를 지우지 않고 새 값으로 교체한다 (화면이 빈 상태로 깜빡이지 않도록).
        setResults(data);
        if (data.sustainability_score >= (teacherMode ? teacherTarget : data.goal?.target ?? 70)) unlockBadge('goal');
        setApiError(null);
        if (data.carbon_emissions) {
          setEmissionHistory(prev => [...prev, data.carbon_emissions].slice(-30)); // 최근 30개 데이터만 저장
        }

      } catch (error) {
        if (!cancelled) {
          console.error("데이터 계산 실패:", error);
          // 실패 시에도 결과를 비우지 않는다. 직전 값을 유지하는 편이 빈 화면보다 낫다.
          setApiError(describeApiError(error));
          setAppliedTarget(null);
        }
      } finally {
        // 취소된 요청은 로딩을 끄지 않는다. 뒤이은 요청이 이미 로딩을 켠 상태다.
        if (!cancelled) setIsCalculating(false);
      }
    };

    // 지도용 전 지역 데이터. 1단계와 같은 타이밍에 나가고, 지역이 아니라
    // 믹스·기상에만 의존하므로 selectedRegion 이 바뀌어도 결과는 같다.
    //
    // 실패해도 apiError 배너를 띄우지 않는다. 마커는 기본 크기로, 오버레이는
    // 안내 문구로 떨어질 뿐이고, 점수·요약 같은 본체는 1단계가 책임진다.
    const fetchRegions = async () => {
      if (!API_BASE_URL) return; // 1단계가 이미 같은 원인을 배너로 알린다
      try {
        const response = await fetch(`${API_BASE_URL}/regions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...mix, weather_scenario: selectedWeather }),
        });
        if (!response.ok) throw new Error(`지역 데이터 요청 실패: ${response.status}`);

        const data = await response.json();
        if (cancelled) return;
        setRegionStats(
          (data.regions ?? []).map((region: { name: string; sources: Record<string, number>; total_generation: number }) => ({
            name: region.name,
            sources: region.sources,
            totalGeneration: region.total_generation,
          }))
        );
        // "live" 라고 적혀 있을 때만 live 다. 필드가 없는 구버전 백엔드나
        // 예상 밖 값은 fallback 으로 떨어뜨린다 — 확신이 없으면 추정값 쪽이다.
        setRegionsSource(data.data_source === 'live' ? 'live' : 'fallback');
      } catch (error) {
        if (!cancelled) {
          console.error("지역별 데이터 조회 실패:", error);
          // 직전 응답이 live 였어도 되돌린다. 지금 화면에 떠 있는 구성은
          // 그 응답 그대로이지만, 각주가 "실시간"이라고 말하는 동안 값이
          // 갱신되지 않는 상태를 만들지 않는다.
          setRegionsSource('fallback');
        }
      }
    };

    // 2단계: 조작이 멎은 뒤에만 AI 해설을 받아 ai_message만 교체한다.
    // 전체를 setResults 하면 emissionHistory가 중복 적재되고 화면이 한 번 더 흔들린다.
    const fetchAiMessage = async () => {
      setIsAiLoading(true);
      try {
        const data = await requestCalculate(true);
        if (cancelled) return;
        // ai_source도 함께 옮긴다. 1단계는 include_ai=false라 항상 "fallback"이므로,
        // 이 값을 갱신하지 않으면 LLM 문장이 와도 배지가 "즉시 요약"에 머문다.
        setResults(prev => (prev
          ? { ...prev, ai_message: data.ai_message, ai_source: data.ai_source }
          : data));
      } catch (error) {
        // AI 실패는 치명적이지 않다. 1단계의 결정론적 요약이 그대로 남는다.
        if (!cancelled) console.error("AI 설명 생성 실패:", error);
      } finally {
        if (!cancelled) setIsAiLoading(false);
      }
    };

    const scoreTimer = setTimeout(() => {
      fetchScores();
      fetchRegions();
    }, SCORE_DEBOUNCE_MS);
    const aiTimer = setTimeout(fetchAiMessage, AI_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(scoreTimer);
      clearTimeout(aiTimer);
    };
  }, [mix, selectedRegion, selectedWeather, teacherMode, teacherTarget]);

  /**
   * 기상청 실황·특보로 본 추천 시나리오. 참고 배지 하나를 위한 조회다.
   *
   * 위 재계산 useEffect 와 분리한 이유가 둘 있다.
   *   1. 의존성이 다르다. 이 값은 **지역**에만 달려 있고 믹스·기후 탭과 무관하다.
   *      같은 effect 에 넣으면 슬라이더를 만질 때마다 같은 값을 다시 받는다.
   *   2. 디바운스가 필요 없다. 지역 변경은 연속 조작이 아니고, 백엔드가 8분
   *      캐싱하므로 지역을 왕복해도 상류 호출은 늘지 않는다.
   *
   * 실패해도 배너를 띄우지 않는다. 이 조회가 없으면 배지가 안 뜰 뿐이고,
   * 시나리오 선택·적합도·배출량은 전부 그대로 동작한다.
   */
  useEffect(() => {
    let cancelled = false;

    const fetchLiveScenario = async () => {
      if (!API_BASE_URL) return;
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/weather/scenario?region=${encodeURIComponent(selectedRegion)}`,
        );
        if (!response.ok) throw new Error(`시나리오 조회 실패: ${response.status}`);

        const data = await response.json();
        if (cancelled) return;
        // source 가 "live" 일 때만 값을 받는다. fallback 이면 null 로 두어
        // 배지 자체가 렌더링되지 않게 한다 — 판정하지 못한 값을 실시간
        // 데이터처럼 보이게 하지 않기 위함이다.
        setLiveScenario(data.source === 'live' ? (data.scenario ?? null) : null);
        setWeatherSnapshot({
          source: data.source === 'live' ? 'live' : 'fallback',
          scenario: typeof data.scenario === 'string' ? data.scenario : '맑음',
          raw: data.raw,
          meta: data.meta,
        });
        const climateResponse = await fetch(
          `${API_BASE_URL}/api/weather/climate?region=${encodeURIComponent(selectedRegion)}`,
        );
        if (climateResponse.ok && !cancelled) setClimateNormals(await climateResponse.json());
      } catch (error) {
        if (!cancelled) {
          console.error("실시간 기상 시나리오 조회 실패:", error);
          setLiveScenario(null);
          setWeatherSnapshot(null);
                  setClimateNormals(null);
        }
      }
    };

    fetchLiveScenario();
    return () => {
      cancelled = true;
    };
  }, [selectedRegion]);

  useEffect(() => {
    let cancelled = false;
    if (!compareRegion || compareRegion === selectedRegion || !API_BASE_URL) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...mix, region_a: selectedRegion, region_b: compareRegion, weather_scenario: selectedWeather }),
        });
        if (!response.ok) throw new Error(`비교 요청 실패: ${response.status}`);
        const data = await response.json();
        if (!cancelled) setComparison(data);
      } catch (error) {
        if (!cancelled) {
          console.error('지역 비교 실패:', error);
          setComparison(null);
        }
      }
    }, SCORE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [compareRegion, selectedRegion, selectedWeather, mix]);

  // 지금 고른 기후 시나리오의 표시 이름.
  const currentScenario = WEATHER_SCENARIOS[weatherTabIndex(selectedWeather)];

  // 화면에 뜬 적합도 값이 어느 기상 조건에서 나온 것인지. 프론트의 선택값이 아니라
  // 백엔드가 "현재"로 표시한 행을 따른다 — 디바운스 구간에서 선택은 이미 바뀌었지만
  // 숫자는 아직 이전 조건인 순간이 있고, 그때 근거가 엉뚱한 시나리오를 가리키면 안 된다.
  const resultScenarioId = results?.carbon_by_scenario?.find((row) => row.is_current)?.scenario;
  const resultWeatherLabel =
    WEATHER_SCENARIOS.find((scen) => scen.id === resultScenarioId)?.label
    ?? resultScenarioId
    ?? currentScenario.label;

  const suitability = results?.suitability ?? EMPTY_SUITABILITY;

  // 카드 순서는 SUITABILITY_ORDER 로 고정하고, 백엔드가 발전원을 추가하면 뒤에 붙인다.
  const suitabilityRows: [string, number][] = [
    ...SUITABILITY_ORDER
      .filter((source) => source in suitability)
      .map((source) => [source, suitability[source]] as [string, number]),
    ...Object.entries(suitability)
      .filter(([source]) => !(SUITABILITY_ORDER as readonly string[]).includes(source)),
  ];

  /**
   * 적합도 섹션의 결론. 여기서 한 번만 뽑아 두 곳이 나눠 쓴다 —
   * 지도 옆 발전원 구성 패널의 한 줄 요약과, 아래 상세 결론 박스.
   * selectedRegion/selectedWeather 가 바뀌면 results.suitability 가 바뀌므로
   * 이 값도 함께 갱신된다.
   */
  const bestSource = pickBestSource(suitability);

  /** 발전원 구성 패널에 넘길 표시용 축약형. 값은 위 결론 그대로다. */
  const bestSourceHint: BestSourceHint | null = bestSource
    ? {
        source: bestSource.source,
        runnerUp: bestSource.runnerUp?.source ?? null,
        lead: bestSource.lead,
      }
    : null;

  /**
   * AI 어시스턴트가 답할 때 참고할 화면 상태.
   *
   * 전부 이 화면이 이미 들고 있는 값이다 — 여기서 새로 계산하는 것은 없다.
   * 믹스는 슬라이더의 mix 가 아니라 백엔드가 실제로 계산에 쓴 mix_used 를
   * 넘긴다. 그래야 사용자가 보고 있는 점수·배출량과 같은 입력에서 나온 답이
   * 된다(디바운스 구간에서는 둘이 잠시 어긋난다).
   */
  const chatContext: ChatContextPayload = {
    region: selectedRegion,
    weather: selectedWeather,
    mix: results?.mix_used ?? mix,
    score: results?.sustainability_score,
    carbon: results?.carbon_emissions,
    grid_status: results?.grid?.label,
    best_source: bestSource?.source,
    factors: (results?.factors ?? []).map((factor) => ({
      label: factor.label,
      penalty: factor.penalty,
      detail: factor.detail,
    })),
    // 채팅 첫 말풍선과 같은 문장. 모델이 "방금 그 요약"을 가리킬 수 있게 한다.
    summary: results?.ai_message,
  };

  /**
   * PDF 리포트에 실을 데이터 한 뭉치.
   *
   * 화면이 이미 들고 있는 값만 모은다 — 여기서 새로 계산하는 것은 없다. 결과가
   * 오기 전(results === null)에는 실을 것이 없으므로 null 이고, 그때는 PdfReport 가
   * 섹션을 아예 만들지 않는다.
   */
  const reportData: ReportData | null = results
    ? {
        results,
        mix,
        // 백엔드가 계산에 쓴 지역 이름을 따른다. 디바운스 구간에서 selectedRegion 이
        // 먼저 바뀌어 있어도 리포트의 숫자와 지역명이 어긋나지 않게 하려는 것.
        regionName: results.current_region,
        weatherLabel: resultWeatherLabel,
        weatherDescription:
          WEATHER_SCENARIOS.find((scen) => scen.id === selectedWeather)?.description ?? '',
        generatedAt: pdfStamp?.display ?? '',
        scenarioLabels: SCENARIO_LABELS,
        scenarioOrder: SCENARIO_ORDER,
      }
    : null;

  /**
   * 다운로드 버튼. 시각만 심고 실제 캡처는 아래 useEffect 가 맡는다 —
   * 이유는 pdfStamp 선언부 주석에.
   */
  const handleDownloadPdf = () => {
    if (isGeneratingPdf) return;
    if (!results) {
      alert('계산 결과를 기다리고 있습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setIsGeneratingPdf(true);
    setPdfStamp(formatStamp(new Date()));
  };

  /**
   * pdfStamp 가 심어지면(= 버튼이 눌리면) 화면 밖 리포트를 캡처해 PDF 로 내려준다.
   *
   * jspdf/html2canvas 는 합쳐서 1MB 가 넘는다. 첫 화면에는 필요 없으므로 동적
   * import 로 미뤄 두고, 버튼을 누른 사람만 내려받게 한다.
   */
  useEffect(() => {
    if (!pdfStamp) return;

    let cancelled = false;
    void (async () => {
      try {
        const { exportReportPdf } = await import('./components/pdfExport');
        await exportReportPdf(`climateloop_report_${pdfStamp.slug}.pdf`);
      } catch (err) {
        console.error('PDF 생성 실패:', err);
        alert('PDF를 만드는 중 오류가 발생했습니다.');
      } finally {
        // 언마운트된 뒤 setState 하지 않도록 막는다. 캡처는 몇 초가 걸린다.
        if (!cancelled) {
          setIsGeneratingPdf(false);
          setPdfStamp(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfStamp]);

  /**
   * 근거 토글이 계산식을 되짚는 데 쓰는 재료.
   *
   * 슬라이더의 mix 가 아니라 백엔드가 실제로 계산에 쓴 mix_used 를 넘긴다.
   * 그래야 카드에 뜬 적합도와 토글 안 식의 숫자가 같은 계산에서 나온다.
   */
  const reasonCtx: ReasonContext | null =
    results?.suitability_basis && results?.mix_used && results?.weather_info
      ? {
          region: results.current_region,
          weatherLabel: resultWeatherLabel,
          basis: results.suitability_basis,
          mixUsed: results.mix_used,
          weather: results.weather_info,
          // 발전원별 출처 표. 필드가 없으면 undefined → 전부 내장 표로 읽힌다
          // (coefficientOriginFor 의 기본값). 확신이 없으면 추정값 쪽이다.
          coefficientSources: results.data_source_detail?.covered_sources,
        }
      : null;

  return (
    /*
      바깥 여백을 lg:p-8(32px) 에서 lg:p-5(20px) 로 줄인다. 1440px 화면에서
      좌우 64px + 아래 컨테이너의 max-w-6xl(1152px) 상한이 겹쳐 224px 이 그냥
      비어 있었다. 세로로도 위아래 64px 을 먹어 첫 화면(900px)의 7% 를 여백에
      내주고 있었다.
    */
    <main className="app-shell flex min-h-screen flex-col items-center p-3 sm:p-4 lg:p-5">
      {/*
        머리글을 sticky 로 고정한다.

        "결과 리포트 저장"이 스크롤과 무관하게 늘 우측 상단에 있어야 하는데, 버튼
        하나만 sticky 로 만들 수는 없다 — sticky 는 조상 안에서만 붙어 있으므로,
        60px 짜리 머리글 안에 두면 머리글이 화면을 벗어나는 순간 함께 사라진다.
        그래서 로고와 버튼을 담은 머리글 전체를 붙인다. 페이지 높이 전체가 스크롤
        영역이므로 끝까지 따라온다.

        배경을 명시하는 이유: sticky 로 떠 있는 동안 아래 콘텐츠가 그 밑을 지나간다.
        투명하게 두면 글자가 겹쳐 읽힌다. main 의 bg-slate-100 과 같은 색을 깔아
        고정된 것처럼 보이지 않게 하고, 반투명 + blur 로 밑에 뭔가 지나간다는
        것만 남긴다.

        z-40: 지도(z-10)보다 위, AI 어시스턴트 플로팅 버튼(z-50)보다 아래.
      */}
      {/*
        제목과 부제를 한 줄로 눕혔다. 세로로 쌓여 있을 때 이 머리글만 105px 를
        먹었는데, sticky 라서 그 높이가 스크롤 내내 화면에서 빠진다. 부제는 제목
        옆에 붙이고(좁은 화면에서는 접힌다) 제목 크기를 text-4xl → text-xl 로
        내려 55px 안쪽으로 들어온다. 이 화면의 주인공은 로고가 아니라 데이터다.
      */}
      <header className="sticky top-0 z-40 w-full max-w-[1600px] mb-3 border-b border-slate-200/80 bg-[#eef2f5]/90 py-2.5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white">CL</span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">ClimateLoop</h1>
            </div>
            <p className="hidden truncate text-xs text-slate-600 sm:block">인터랙티브 기후 및 에너지 시뮬레이터</p>
          </div>

          <SaveReportButton
            onDownloadPdf={handleDownloadPdf}
            isGeneratingPdf={isGeneratingPdf}
          />
          <TeacherLinkButton shareUrl={shareUrl} />
          <ShareButton shareUrl={shareUrl} />
        </div>
      </header>

      {/* API Error Banner — 계산 실패 시에만 노출. 성공하면 자동으로 사라진다. */}
      {apiError && (
        <div
          role="alert"
          className="w-full max-w-[1600px] mb-4 flex items-start gap-3 p-4 rounded-lg border border-red-300 bg-red-50"
        >
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
          <div className="text-sm leading-relaxed">
            <p className="font-semibold text-red-900">데이터를 불러오지 못했습니다</p>
            <p className="text-red-800 mt-0.5">{apiError}</p>
            <p className="text-xs text-red-700 mt-1.5">
              아래 화면은 마지막으로 성공한 계산 결과입니다.
            </p>
          </div>
        </div>
      )}

      <BeginnerWizard
        step={wizardStep}
        setStep={setWizardStep}
        selectedRegion={selectedRegion}
        selectedWeather={selectedWeather}
        onRegionChange={handleRegionChange}
        onWeatherChange={handleWeatherChange}
        mix={mix}
        onSliderChange={handleSliderChange}
        results={results}
        isCalculating={isCalculating}
        quizIndex={quizIndex}
        advanceQuiz={advanceQuiz}
        onShowDetails={() => {
          setShowDetails(true);
          requestAnimationFrame(() => document.getElementById('detailed-analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }}
        hasSavedSession={hasSavedSession}
        onResetSession={resetBeginnerSession}
        teacherMode={teacherMode}
        teacherTarget={teacherTarget}
        badges={badges}
      />

      {showDetails && (
        <div id="detailed-analysis" className="w-full max-w-[1600px] scroll-mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SimulationContextBar
              region={selectedRegion}
              weather={currentScenario.label}
              score={results?.sustainability_score}
              isCalculating={isCalculating}
            />
            <button
              type="button"
              onClick={() => {
                setShowDetails(false);
                requestAnimationFrame(() => document.getElementById('beginner-wizard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }}
              className="flex min-h-11 items-center gap-2 rounded-md px-3 text-xs font-bold text-slate-600 hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <ArrowUp className="h-4 w-4 rotate-180" aria-hidden="true" />
              학습 화면으로 돌아가기
            </button>
          </div>
        </div>
      )}
      <div className="mt-2 w-full max-w-[1600px]">
        <ComparisonControls
          selectedRegion={selectedRegion}
          compareRegion={compareRegion}
          onChange={(region) => {
            setCompareRegion(region);
            setComparison(null);
          }}
        />
      </div>

      {/*
        섹션 사이 간격 2.5(10px) → 9(36px).

        예전에는 각 섹션이 테두리와 배경색을 두른 트레이 안에 들어 있어서, 간격이
        10px 이어도 상자와 상자가 갈라져 보였다. 그 트레이를 걷어낸 지금 두 섹션을
        가르는 것은 이 여백 하나뿐이다 — 카드 사이 간격(8px)보다 네 배 넓어야
        "다른 묶음"으로 읽힌다. 같은 이유로 섹션 제목도 카드 제목보다 크다.
      */}
      {showDetails && <div className="w-full max-w-[1600px] space-y-9">
        <CalculationFlow />
        <RegionComparisonCard comparison={comparison} regionA={selectedRegion} regionB={compareRegion ?? ''} onClose={() => setCompareRegion(null)} />
        {/*
          ── 파이프라인 그룹 ──

          지역·기후 선택 → 적합도 → 탄소 배출은 하나의 흐름인데, 예전에는 8/4 두 컬럼에
          흩어져 각자 다른 기능처럼 보였다. 한동안은 이 셋을 테두리·배경을 두른 트레이
          안에 넣고 카드 사이에 화살표 알약을 세워 한 파이프라인으로 묶었다.

          지금 그 둘은 없다. 셋을 묶는 것은 이 섹션의 머리글 한 줄("지역 → 기후·적합도
          → 탄소 배출")과, 아래 섹션과의 사이에 둔 36px 여백뿐이다. 세 카드가 서로
          가까이(8px) 붙어 있고 다음 묶음이 멀리(36px) 떨어져 있으면 근접성만으로
          한 덩어리가 된다 — 상자를 한 겹 더 두르지 않아도 된다.

          믹스 조정은 이 섹션에 없다. 조작기를 결과(점수·해설) 바로 옆에 두는 편이,
          단계 순서를 지키느라 조작과 결과를 갈라놓는 것보다 낫다고 보아 요약 카드로 내렸다.

          ── 3단계를 2행으로 나눈 이유 ──

          한동안 이 섹션은 [①지역+지도+기후탭+적합도 | ②탄소] 두 칸이었다. ① 안에서
          지도 행(316px) → 기후 탭(150px) → 적합도 카드 4장(210px)이 세로로 쌓여 카드
          하나가 970px 이 됐고, 옆 ② 는 790px 이라 어느 쪽도 900px 화면에 들어오지
          못했다. 게다가 ① 이 더 길어서 ② 아래에는 180px 짜리 빈 공간이 남았다.

          지금은 세로로 쌓여 있던 세 덩어리를 가로로 편다.
            1행: ① 지역 선택 + 지도 + 발전원 구성   |   ② 기후 탭 + 적합도
            2행: ③ 탄소 배출 (폭 전체, 안에서 다시 3칸)
          두 칸의 높이가 비슷해져(약 440px) 남는 여백이 사라지고, 세로 총합이
          970 → 440 + 310 으로 줄어 세 단계가 첫 화면에 함께 들어온다.
        */}
        <section aria-labelledby="pipeline-heading" className="space-y-2">
          {/*
            섹션 머리글 — 제목 text-lg(18px) + 부제 text-xs(12px).

            카드 제목은 text-base(16px) semibold 이고 카드 안 본문은 11~14px 이다.
            섹션 제목만 그보다 한 단계 크고 굵어서, 트레이 없이도 "여기서부터 새
            묶음" 이 글자 크기만으로 읽힌다. 부제를 같은 줄에 눕혀 두는 것은 세로를
            아끼기 위해서다 — 이 화면은 세 단계가 첫 화면(900px)에 함께 들어와야 한다.
          */}
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 id="pipeline-heading" className="text-lg font-bold tracking-tight text-slate-900">시뮬레이션 파이프라인</h2>
            <p className="text-xs text-slate-600">
              지역 → 기후·적합도 → 탄소 배출. 에너지 믹스는 아래 요약 카드에서 조정합니다
            </p>
          </div>

          {/*
            ①·② — xl(1280px) 이상에서만 나란히 세운다.

            처음에는 lg(1024px) 부터 나란히 뒀는데, 그 폭에서 ① 이 받는 자리는 약
            380px 이라 [지도 224px + 발전원 구성] 이 들어가지 못했다 — 도넛이 패널
            밖으로 삐져나오고 범례가 "태 16%" 처럼 한 글자로 잘렸다. 1024px 에서는
            위아래로 쌓아 두 카드가 각자 전체 폭을 쓰게 하고, 가로로 펴는 것은 폭이
            실제로 남는 1280px 이상에서만 한다.
          */}
          <div className="flex flex-col xl:flex-row items-stretch gap-2 xl:gap-0">
            {/*
              ① 지역 선택 — 고르는 곳(select)과 고른 결과 둘(지도 강조, 발전원 구성)만
              담는다. 셋 다 selectedRegion 하나에서 나오므로 select 를 바꾸면 나머지
              둘이 같이 바뀐다. 기후 탭은 ② 로 넘겼다 — 탭이 여는 패널(적합도)과 같은
              칸에 있어야 조작과 반응이 한눈에 들어온다.
            */}
            <div className="min-w-0 xl:flex-[5]">
              <div className="h-full bg-white p-3 rounded-lg shadow-card">
                {/* 고른 지역은 아래 select 가 그대로 들고 있으므로 제목에 한 번 더 적지 않는다. */}
                <h2 className="text-base font-semibold text-slate-900 mb-2.5">지역과 발전원 구성</h2>

                <RegionSelect selectedRegion={selectedRegion} onRegionChange={handleRegionChange} />

                {/*
                  지도 칸을 14rem(224px)로 잡는다. 13rem 으로 줄였더니 Leaflet 저작자
                  표시("Leaflet | © OpenStreetMap contributors")가 한 줄에 못 들어가
                  두 줄로 접혔다 — 글자를 10px 로 내려도 몇 px 이 모자란다. 지도는 이
                  화면의 첫 번째 우선순위이기도 하니 폭은 줄이는 쪽이 아니라 되돌리는
                  쪽이 맞다.
                */}
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-2.5 mt-2">
                  {/*
                    지도 칸의 높이를 오른쪽 발전원 구성 패널에 맞춘다.

                    예전에는 고정 높이로 못을 박아 두었다. 오른쪽 패널은 헤더 + 결론
                    한 줄 + 도넛 + 범례 + 각주가 쌓여 실제로는 280px 안팎이 되므로,
                    두 칸의 아래끝이 60px 가까이 어긋나 지도 밑에 빈 공간이 남았다.

                    sm 이상에서는 높이를 grid 의 stretch 에 맡긴다(h-auto). 그러면 행
                    높이는 오른쪽 패널이 정하고 지도가 그 높이를 채운다. min-h(200px)는
                    반대 경우의 바닥값이다 — 오른쪽이 짧아질 때(발전량이 0이어서 도넛 대신
                    한 줄 안내만 뜨는 경우) 지도가 납작해지지 않게 한다. 지금은 오른쪽이
                    늘 이 값보다 크므로 실제 높이를 정하는 것은 오른쪽 패널이고, min-h 를
                    낮추는 것만으로는 이 행이 짧아지지 않는다.

                    좁은 화면은 1열이라 나란히 놓일 짝이 없다. 그때는 stretch 로 얻을
                    높이가 없으므로(지도 내부는 전부 % 높이라 콘텐츠 높이가 0) 종전처럼
                    고정 높이를 쓴다.

                    MapComponent 는 ResizeObserver 로 컨테이너 크기 변화를 잡아
                    invalidateSize() 를 부르므로, 높이가 이렇게 유동적이어도 타일과
                    fitBounds 가 함께 다시 맞는다.
                  */}
                  <div className="w-full max-w-[16rem] sm:max-w-none mx-auto sm:mx-0 h-[210px] sm:h-auto sm:min-h-[200px] bg-slate-100 rounded-lg z-10">
                    <MapWrapper selectedRegion={selectedRegion} regions={regionStats} />
                  </div>

                  <RegionSourceMix
                    region={regionStats.find((r) => r.name === selectedRegion)
                      ?? { name: selectedRegion, sources: {}, totalGeneration: 0 }}
                    isLoaded={regionStats.some((r) => r.name === selectedRegion)}
                    best={bestSourceHint}
                    dataSource={regionsSource}
                  />
                </div>
              </div>
            </div>

            {/* ② 기후 시나리오 → 적합도. 탭과 그 탭이 여는 패널이 같은 카드 안에 있다. */}
            <div className="min-w-0 xl:flex-[7]">
              {/*
                flex 컬럼으로 둔다. 이 칸은 grid/flex stretch 로 옆 ① 칸과 같은 높이를
                받는데, 안쪽 내용이 그보다 80px 쯤 짧아서 카드 아래끝에 죽은 공간이
                남았다. 각주를 mt-auto 로 바닥에 붙이면 그 여백이 카드 4장과 각주 사이의
                숨 쉬는 간격으로 재배치된다 — 카드가 잘린 것처럼 보이지 않는다.
              */}
              <div className="h-full flex flex-col bg-white p-3 rounded-lg shadow-card">
                <h2 className="text-base font-semibold text-slate-900 mb-2.5">지역별 에너지 적합도</h2>

                <WeatherTabs
                  selectedWeather={selectedWeather}
                  onWeatherChange={handleWeatherChange}
                  carbon={results?.carbon_emissions}
                  carbonPlanned={results?.carbon_planned}
                  liveScenario={liveScenario}
                  weatherSnapshot={weatherSnapshot}
                  climateNormals={climateNormals}
                />

                {/*
                  적합도 섹션의 결론을 맨 위에 한 줄로 적는다.

                  예전에는 카드 4장만 있어서 "그래서 이 지역엔 무엇이 맞는가"를 사용자가
                  눈으로 비교해 스스로 찾아야 했다. 근거 토글 안에 계산식·지역 계수·기상 배수·
                  믹스 반영 방식이 모두 들어 있어, 길게 늘어져 있던 각주도 여기로 접어 넣었다.
                */}
                {/* 기후 시나리오 탭이 가리키는 패널. 요약과 카드 4장이 모두 그 선택의 결과다. */}
                <div
                  id={SUITABILITY_PANEL_ID}
                  role="tabpanel"
                  aria-labelledby={weatherTabId(weatherTabIndex(selectedWeather))}
                  tabIndex={0}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded-lg"
                >
                  <BestSourceSummary
                    region={reasonCtx?.region ?? selectedRegion}
                    suitability={suitability}
                    ctx={reasonCtx}
                    best={bestSource}
                  />

                  {/*
                    카드 4장. 이 칸은 1440px 화면에서 약 780px 을 받으므로 넷을 한 줄에
                    세운다(xl:grid-cols-4) — 2×2 로 두면 같은 정보가 두 줄을 먹어 카드
                    높이만큼(약 80px) 세로가 길어지고, 옆 ① 칸보다 커져 다시 여백이 생긴다.
                  */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
                    {suitabilityRows.map(([source, value]) => (
                      <SuitabilityCard key={source} source={source} value={value} ctx={reasonCtx} />
                    ))}
                  </div>
                </div>
                {/*
                  곱의 세 항을 각각 어디서 얻은 값인지 밝힌다.

                  세 항의 성격이 다 다르다. 기상 배수는 백엔드에 박아 둔 상수이고 믹스
                  비중은 사용자가 슬라이더로 정한 값이며, 지역 계수는 **발전원마다 출처가
                  갈린다** — 화력만 EPSIS 설비용량에서 나오고 나머지 셋은 내장 추정표다.
                  각주가 "계산한 상대 지수"라고만 적으면 넷 다 같은 근거처럼 읽힌다.

                  화력을 따로 떼어 적는 이유가 하나 더 있다. 이 계수는 설비용량 기준이라
                  "그 지역에 화력 설비가 얼마나 모여 있는가"를 재는데, 종전 내장 표의
                  화력 값은 "그 지역이 화력에 얼마나 의존하는가"에 가까웠다. 서울이
                  1.30 → 0.87 로 뒤집힌 것이 그 차이다(전력은 많이 쓰지만 설비는 적다).
                  각주가 그 전환을 말하지 않으면 사용자는 옛 해석을 그대로 들고 읽는다.

                  발전원별 문구는 describeCoefficientOrigin() / describeCoefficientMeaning()
                  이 만들고, 근거 토글 안의 계수 줄도 같은 함수를 쓴다.
                */}
                <p className="text-[11px] text-slate-500 mt-auto pt-2 leading-snug">
                  ※ 지역 계수 × 기상 배수 × 에너지 믹스 비중으로 계산한 무차원 상대 지수이며 발전량 통계가 아닙니다.
                  <span className="block mt-0.5">
                    <span className="font-medium text-slate-600">지역 계수</span>는 네 발전원 모두 그 지역에 해당
                    발전설비가 얼마나 모여 있는지(설비용량 기준)를 나타냅니다 — 자원 잠재력이나 전력 수요가 아닙니다.
                    자원이 좋아도 아직 설비가 적은 지역은 낮게 나옵니다. 화력은 한국전력거래소 지역별 발전설비
                    설비용량(2025), 태양광·풍력·수력은 한국에너지공단 신·재생에너지 보급용량(2024) 기준이며,
                    발전원마다 그 발전원의 전국 중위 지역을 1.0 으로 두고 정규화했습니다.
                  </span>
                  <span className="block mt-0.5">
                    기상 배수는 시나리오별 내장 상수, 믹스 비중은 아래 슬라이더 값입니다.
                    근거 버튼을 누르면 항목별 계산 근거가 열립니다.
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/*
            ③ 탄소 배출 — 폭 전체를 쓴다. 오른쪽 칸에 세로로 세워 두면 스파크라인·
            시나리오 막대·믹스 곡선이 위아래로 쌓여 790px 이 됐다. 폭을 다 주면 셋이
            나란히 서서 310px 로 접히고, 세 그림을 한눈에 비교할 수 있게 된다.
          */}
          <CarbonEmissionCard
            carbon={results?.carbon_emissions ?? 0}
            history={emissionHistory}
            byScenario={results?.carbon_by_scenario}
            projection={results?.projection}
            scenarioLabel={currentScenario.label}
            isCalculating={isCalculating}
          />
        </section>

        {/*
          ── 결과 해석 그룹 ──

          점수·추천·귀인·해설은 "위 설정이 만든 결과"라는 한 묶음이다. 위 파이프라인과는
          섹션 사이 여백(36px)과 제목 한 줄로 갈린다 — 배경색을 달리해 두 그룹을 칠해
          나누던 방식은 걷어냈다. 배경이 두 가지면 화면에 색 덩어리가 늘 뿐, 어느 쪽이
          먼저 읽혀야 하는지는 말해 주지 않는다.

          믹스 슬라이더도 이 안(요약 카드)에 있다. 순서로만 보면 파이프라인 쪽이
          맞지만, 조작기는 그 결과가 바로 보이는 자리에 있는 편이 훨씬 낫다 —
          슬라이더나 숫자 입력을 바꾸면 같은 카드의 점수가, 그리고 위 섹션의 배출량과
          적합도가 함께 움직인다.
        */}
        <section aria-labelledby="results-heading" className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 id="results-heading" className="text-lg font-bold tracking-tight text-slate-900">결과 해석</h2>
            <p className="text-xs text-slate-600">
              위 설정이 만든 점수와 다음에 바꿀 것. 믹스 슬라이더를 움직이면 위 파이프라인이 함께 갱신됩니다
            </p>
          </div>

          {/*
            items-start 를 걷어내 기본값(align-items: stretch)으로 돌린다.

            예전에는 세 칸이 각자 콘텐츠 높이만큼만 자랐다. 그러면 시작점은 맞아도
            끝점이 어긋난다 — 실측으로 앞 두 칸은 664px, 접힌 채로 있는 "왜 이 점수인가요?"
            는 70px 이어서 카드 테두리 아래끝이 594px 이나 벌어졌다.

            stretch 로 두면 행 높이(= 가장 긴 칸)가 세 칸 모두에 적용돼 아래끝이
            일직선으로 맞는다. 카드 안쪽은 손대지 않는다 — 블록 흐름이라 내용은 그대로
            위에서부터 쌓이고, 남는 높이는 카드 아래쪽 빈 공간으로 남는다. 내용을 억지로
            늘려 채우지 않는다는 뜻이다.

            grid 를 flex 로 바꾸지 않은 이유: align-items 는 grid 에서도 똑같이 동작해
            결과가 같은데, flex 로 옮기면 grid-cols-1 lg:grid-cols-3 이 하던 반응형
            칼럼 배분을 flex-col lg:flex-row + lg:flex-1 로 다시 짜야 한다. 얻는 것
            없이 건드릴 곳만 늘어난다.
          */}
          {/*
            세 칸을 1:1:0.72 로 나눈다. 셋이 똑같이 1fr 이던 시절, 마지막 칸은 접힌
            아코디언 하나와 마스코트 박스뿐인데도 앞 두 칸과 같은 460px 를 차지했다.
            그만큼 앞 두 칸(조작기·추천)이 좁아져 글이 더 접히고 카드가 세로로 길어졌다.
            정보가 많은 쪽에 폭을 몰아주면 같은 내용이 덜 접혀 행 높이도 함께 낮아진다.
          */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.72fr)] gap-2">
            {/* Simulation Summary — 믹스 슬라이더와 숫자 입력이 여기 함께 산다. */}
            <SimulationSummaryCard
              mix={mix}
              onSliderChange={handleSliderChange}
              results={results}
              isCalculating={isCalculating}
            />

            {/* Next Action */}
            <NextActionCard
              nextAction={results?.next_action}
              currentScore={results?.sustainability_score}
              isCalculating={isCalculating}
              appliedTarget={appliedTarget}
              onApply={handleApplyNextAction}
              factors={results?.factors}
            />

            {/*
              귀인 — 세 줄의 기본 노출 자리는 위 "다음 단계" 카드로 옮겼고, 이 카드는
              접힌 채로 남아 같은 값의 상세 근거를 다시 펼쳐볼 자리가 된다.

              한때 이 아래에 AI 어시스턴트 카드가 함께 쌓여 있었다. 그 카드가 우하단
              플로팅 버튼으로 나가면서 감싸던 열 래퍼(div)도 없앴다 — 카드가 하나뿐인
              열을 한 겹 더 감쌀 이유가 없고, 이제 귀인 카드가 3열의 마지막 칸을 통째로
              쓴다. 열 수(lg:grid-cols-3)는 그대로다: 카드가 셋이면 칸도 셋이면 맞고,
              둘로 줄이면 남는 카드 하나가 아래로 떨어져 오히려 어긋난다.
            */}
            {/*
              3번째 칸 — [귀인 카드] + [기상이 박스]를 세로로 쌓는다.

              칸 자체는 여전히 grid 의 stretch 를 받아 옆 두 칼럼과 같은 높이가 되고,
              그 높이를 카드와 박스가 나눠 쓴다. 카드는 shrink-0 로 자기 콘텐츠 크기를
              지키고, 박스가 flex-1 로 남는 만큼을 받는다. 그래서 카드를 펼치면 카드가
              커지고 박스가 그만큼 줄어들 뿐, 칸 높이는 그대로다 — 세 칼럼 아래끝은
              계속 일직선이다.
            */}
            <div className="flex flex-col gap-2">
              <FactorBreakdown factors={results?.factors} />
              <GisangiGreeting />
            </div>
          </div>
        </section>

        {/*
          ── 에너지 상식 퀴즈 ──

          위 두 섹션이 "이 설정이 만든 결과"를 말한다면, 이 섹션은 그 결과를 읽는 데
          필요한 배경 지식을 묻는다. 그래서 결과 해석 아래에 별도 섹션으로 두고 전체
          폭을 쓴다 — 3단 그리드의 한 칸에 끼워 넣으면 선택지 글이 접히고, 무엇보다
          점수·추천과 나란히 놓여 같은 종류의 정보처럼 읽힌다.

          문제는 화면의 계산 결과와 무관하다. 앱 전용 용어(배출강도·에너지 믹스 등)를
          쓰지 않는 것도 같은 이유다 — 여기서 배우는 것은 이 앱의 사용법이 아니라
          발전 방식 자체다.
        */}
        <section aria-labelledby="quiz-heading" className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 id="quiz-heading" className="text-lg font-bold tracking-tight text-slate-900">에너지 상식</h2>
            <p className="text-xs text-slate-600">
              발전원별 기초 상식 한 문제. 지역·기후를 바꾸거나 &ldquo;다음 문제&rdquo;를 누르면 새 문제가 나옵니다
            </p>
          </div>

          {/*
            key 에 문제 인덱스를 준다. 문제가 바뀌면 카드가 새로 마운트되면서 앞 문제에
            고른 답과 해설이 저절로 사라진다 — 카드 안에서 useEffect 로 지우는 것보다
            정확하다(문제가 바뀐 그 렌더에 이미 비어 있다).
          */}
          <EnergyQuizCard
            key={quizIndex}
            question={QUIZ_POOL[quizIndex]}
            onNext={advanceQuiz}
          />
        </section>

        {/*
          데이터 출처 — 컨테이너 안쪽 최하단.

          main 바깥으로 빼지 않는 이유: 위 카드들과 좌우 정렬이 맞아야 한다. max-w
          컨테이너 밖에 두면 넓은 화면에서 목록만 화면 끝까지 늘어난다.
        */}
        <DataSources />
      </div>}

      {/*
        PDF 전용 리포트 — 화면 밖(left:-9999px)에 렌더된다.

        화면 UI 를 캡처하지 않고 리포트만을 위한 마크업을 따로 두는 이유는
        PdfReport.tsx 주석에 적었다. 여기서는 두 가지만: 화면에 보이지 않지만
        레이아웃은 정상으로 계산돼야 차트가 그려지므로 display:none 이 아니고,
        평소에는 height:0 으로 접혀 페이지 스크롤 높이를 늘리지 않는다.
      */}
      <PdfReport data={reportData} />

      {/*
        AI 어시스턴트 — 그리드 밖. position:fixed 로 화면 우하단에 떠 있으므로 DOM
        위치가 표시 자리를 바꾸지는 않지만, "결과 해석" 섹션 안에 두면 그 섹션의
        일부처럼 읽힌다. 이 버튼은 페이지 어디를 보고 있든 같은 자리에 있다.

        isHidden 에 isGeneratingPdf 를 넘긴다 — 리포트를 만드는 동안에는 화면에서
        빠져 있어야 캡처/인쇄 경로가 붙어도 버튼이 리포트에 찍히지 않는다.
      */}
      <AiAssistantFab
        aiMessage={results?.ai_message}
        aiSource={results?.ai_source}
        isAiLoading={isAiLoading}
        context={chatContext}
        isHidden={isGeneratingPdf}
      />

      {/*
        믹스를 조정하는 길은 이제 하나다 — "시뮬레이션 요약" 카드의 슬라이더 세 개.
        설정 모달, 우하단 톱니 버튼, ③ 카드로 스크롤해 올리던 "설정 변경" 링크,
        그 자리를 이어받았던 아코디언까지 차례로 걷어낸 끝이다. 띄울 창도, 페이지를
        끌어올릴 이유도, 조작기를 꺼내려고 한 번 더 누를 버튼도 남지 않았다.
      */}
    </main>
  );
}
