'use client';

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from 'recharts';
import MapWrapper from './components/MapWrapper';

/** 에너지 믹스 3축. 합계는 항상 100%. */
interface EnergyMixValues {
  renewable: number;
  nuclear: number;
  fossil: number;
}

type MixKey = keyof EnergyMixValues;

/** 전력망 상태. 백엔드 build_grid()의 status enum과 대응. */
type GridStatus = 'deficit' | 'stable' | 'surplus';

/** 지속 가능성 지수를 구성하는 요인 키. 백엔드 FACTOR_WEIGHTS와 대응. */
type FactorKey = 'carbon' | 'grid' | 'fit';

/** 요인별 신호등. 임계값은 백엔드가 판정하므로 프론트에서 재계산하지 않는다. */
type FactorStatus = 'good' | 'warn' | 'bad';

interface WeatherInfo {
  solar_mult: number;
  wind_mult: number;
  demand_mult: number;
  msg: string;
}

/** 목표 명시(ARCS Confidence C-1). gap은 달성 시 0, 음수가 되지 않는다. */
interface Goal {
  target: number;
  current: number;
  gap: number;
  progress_pct: number;
  achieved: boolean;
}

interface ProgressLevel {
  id: number;
  name: string;
  min_score: number;
}

/** 단계적 성공 경험(C-2). 최고 단계에 도달하면 next가 null이 된다. */
interface LevelState {
  current: ProgressLevel;
  next: ProgressLevel | null;
  to_next: number;
  total_levels: number;
}

/** 귀인(C-3). contribution의 합 = sustainability_score. */
interface Factor {
  key: FactorKey;
  label: string;
  score: number;
  weight: number;
  contribution: number;  // score × weight — 총점에 기여한 점수
  penalty: number;       // (100-score) × weight — 이 요인 때문에 잃은 점수
  status: FactorStatus;
  detail: string;
}

/**
 * 실행 가능한 다음 한 걸음(C-3).
 * resulting_mix를 setMix()에 그대로 넣으면 expected_score가 재현된다
 * (백엔드가 프론트의 handleSliderChange와 동일한 재분배 규칙을 사용).
 */
interface NextAction {
  lever: MixKey;
  lever_label: string;
  delta: number;
  resulting_mix: EnergyMixValues;
  expected_score: number;
  expected_gain: number;
  expected_carbon: number;
  reaches_goal: boolean;
  primary_factor: FactorKey;
  reason: string;
  resulting_grid_status: GridStatus;
  grid_margin_change: number;  // 공급 여유 변화량. 음수면 공급 악화
}

interface GridState {
  status: GridStatus;
  label: string;      // 기존 grid_stability와 동일한 문자열
  production: number;
  demand: number;
  margin: number;
  margin_pct: number;
}

interface SimulationResult {
  // --- 기존 필드 ---
  carbon_emissions: number;
  sustainability_score: number;
  suitability: Record<string, number>;
  ai_message: string;
  current_region: string;
  grid_stability: string;
  weather_info: WeatherInfo;
  // --- Confidence 신규 필드 ---
  goal: Goal;
  level: LevelState;
  factors: Factor[];          // 항상 길이 3, carbon → grid → fit 순서
  next_action: NextAction | null;  // 개선 여지가 없으면 null
  grid: GridState;
  mix_used: EnergyMixValues;
  projection: ProjectionPoint[];   // 현재(step 0) + PROJECTION_STEPS
}

/**
 * 시뮬레이션 곡선의 한 점. 백엔드 build_projection() 이 만든다.
 * 숫자만 오고 라벨은 프론트에서 조립한다.
 */
interface ProjectionPoint {
  step: number;              // 재생에너지 증가폭(%p). 0이면 현재 지점
  renewable: number;         // 그 지점의 실제 재생 비중
  carbon_emissions: number;
  clamped: boolean;          // 재생 100% 상한에 걸려 step 만큼 못 올라간 경우
}

const MIX_LABELS: Record<string, string> = {
  renewable: '재생에너지',
  nuclear: '원자력',
  fossil: '화석연료'
};

import { Sun, Wind, Droplets, Flame, CloudRain, CloudLightning, Snowflake, ShieldAlert, Download } from 'lucide-react';

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  '태양광': <Sun className="w-4 h-4 text-orange-500" />,
  '풍력': <Wind className="w-4 h-4 text-blue-400" />,
  '수력': <Droplets className="w-4 h-4 text-blue-600" />,
  '화력': <Flame className="w-4 h-4 text-red-500" />
};

const WEATHER_SCENARIOS: { id: string; label: string; icon: React.ReactNode; description: string }[] = [
  { id: '맑음', label: '맑음/화창', icon: <Sun className="w-4 h-4 text-orange-500" />, description: "태양광 발전량이 높고 전력 수요가 안정적입니다." },
  { id: '흐림/비', label: '장마/폭우', icon: <CloudRain className="w-4 h-4 text-slate-500" />, description: "태양광 발전량이 크게 감소하고 풍력도 다소 줄며, 전력 수요는 조금 늘어납니다." },
  { id: '태풍', label: '태풍/강풍', icon: <CloudLightning className="w-4 h-4 text-amber-500" />, description: "안전을 위해 풍력 발전이 중단되고, 전력망이 불안정해질 수 있습니다." },
  { id: '겨울', label: '한파/겨울', icon: <Snowflake className="w-4 h-4 text-blue-300" />, description: "난방 수요가 급증하고 일조 시간이 짧아져 전력망에 부담이 됩니다." },
];

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
        <div className="relative group flex items-center gap-1.5">
          <span className="text-sm text-slate-500">지속 가능성 지수</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 group-hover:text-blue-500"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 bg-slate-800 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            탄소 배출량(55%), 전력망 안정성(30%), 지역 적합도(15%)를 가중평균한 점수입니다.
            지역 적합도는 이 지역·이 기상 조건의 재생에너지 잠재력과 현재 재생 비중이 얼마나 일치하는지를 봅니다.
            <span className="block mt-1.5 text-slate-300">
              탄소 항목에는 상대 비교용 예시 배출계수를 적용했으며, 공식 통계 수치가 아닙니다.
            </span>
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800"></div>
          </div>
        </div>
        <div className="flex items-baseline gap-1">
          <span className={`text-lg font-bold ${achieved ? 'text-green-600' : 'text-orange-500'}`}>
            {goal ? goal.current : '--'}
          </span>
          <span className="text-xs text-slate-400">/ {goal ? goal.target : '--'}점</span>
        </div>
      </div>

      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ease-out ${achieved ? 'bg-green-500' : 'bg-orange-400'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-xs text-slate-400 mt-1.5">
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
        <span className="text-sm text-slate-500">학습 단계</span>
        <span className="text-sm font-semibold text-slate-800">
          {level ? `${level.current.name} (${currentId}/${total})` : '--'}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {steps.map((step) => (
          <React.Fragment key={step}>
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-500 ${step <= currentId ? 'bg-blue-600' : 'bg-slate-200'}`} />
            {step < total && (
              <div className={`flex-grow h-0.5 transition-colors duration-500 ${step < currentId ? 'bg-blue-600' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      <p className="text-xs text-slate-400 mt-1.5">
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
//  2단계(include_ai=true) : AI 해설. Gemini 호출이 붙어 약 10초.
// 조작 중에는 1단계만 반복하고, 조작이 멎은 뒤에야 2단계가 나간다.
const SCORE_DEBOUNCE_MS = 300;
const AI_DEBOUNCE_MS = 1200;

// 환경변수가 비어 있으면 요청이 `undefined/calculate` 상대경로로 나가 404가 된다.
// 그 상태로는 원인을 알 수 없으므로 요청 전에 걸러내고 조치 방법까지 안내한다.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const MISSING_API_URL_MESSAGE =
  'NEXT_PUBLIC_API_URL이 설정되지 않았습니다. frontend/.env.local에 ' +
  'NEXT_PUBLIC_API_URL=http://localhost:8000 을 추가한 뒤 개발 서버를 다시 시작해 주세요.';

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

/** 합계 표시의 허용 오차(%p). 백엔드 normalize_mix()가 원본을 그대로 두는 폭과 같다. */
const MIX_TOTAL_TOLERANCE = 0.5;
/** 이 이상 어긋나면 경고를 빨강으로 올린다. */
const MIX_TOTAL_SEVERE = 5;

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
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full shrink-0">
      <Spinner className="w-3 h-3" />
      업데이트 중
    </span>
  );
}

/**
 * 에너지 믹스 변화에 따른 탄소 배출 시뮬레이션.
 *
 * 이전에는 2020~2024년 배출량을 프론트에 상수로 박아두고 2025년만 실제 값을 썼다.
 * 실제 관측치처럼 보이지만 출처가 없는 수치였으므로, 축 자체를 연도가 아니라
 * "재생에너지를 얼마나 늘렸는가"로 바꿨다. 네 점의 배출량은 모두 백엔드
 * /calculate 가 계산한 값이라 화면의 다른 수치와 같은 근거를 가진다.
 */
function EmissionSimulationChart({ projection }: { projection?: ProjectionPoint[] | null }) {
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

  const renderDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (cx === undefined || cy === undefined) return <g />;
    // 기준점(현재)만 크게 강조한다
    if (index === 0) {
      return <circle cx={cx} cy={cy} r={7} fill="#3b82f6" stroke="white" strokeWidth={2} />;
    }
    return <circle cx={cx} cy={cy} r={4} fill="#3b82f6" />;
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <h2 className="text-xl font-semibold mb-1 text-slate-800">에너지 믹스 변화에 따른 탄소 배출 시뮬레이션</h2>
      <p className="text-xs text-slate-500 mb-4">
        {current && last && reduction > 0 ? (
          <>
            재생에너지를 <span className="font-semibold text-blue-600">{Math.round(last.renewable - current.renewable)}%p</span> 늘리면{' '}
            <span className="font-semibold text-green-600">{reduction.toFixed(1)}g 감소</span>
          </>
        ) : (
          '재생에너지 비중을 단계별로 높였을 때의 배출량 변화'
        )}
      </p>
      <div className="h-60">
        {data ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} unit="g" domain={[0, 'dataMax + 50']} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '0.5rem', color: 'white' }}
                itemStyle={{ color: 'white' }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
              />
              <Line type="monotone" dataKey="carbon_emissions" stroke="#3b82f6" strokeWidth={2} dot={renderDot} activeDot={{ r: 6 }} name="배출량" unit=" gCO2/kWh" />
              {current && <ReferenceLine y={current.carbon_emissions} stroke="#3b82f6" strokeDasharray="4 4" />}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">계산 중...</div>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-2 text-center leading-relaxed">
        ※ 현재 설정한 에너지 믹스를 기반으로 계산한 시뮬레이션 결과입니다.
        <br />
        실제 과거 배출량 관측치가 아닙니다.
        <br />
        <span className="text-slate-400">
          배출계수는 상대 비교용 예시값(재생·원자력 12, 화력 650 gCO₂/kWh)이며 공식 통계가 아닙니다.
        </span>
      </p>
    </div>
  );
}

/** 탄소 배출량 추이 스파크라인. */
function CarbonEmissionChart({ current, history }: { current: number; history: number[] }) {
  const last = history.length > 1 ? history[history.length - 2] : 0;
  const change = current - last;

  const max = Math.max(...history, 1); // 0으로 나누는 것 방지
  const min = Math.min(...history);
  const range = max - min === 0 ? 1 : max - min;

  const points = history.map((val, i) => {
    const x = (i / (history.length - 1)) * 100;
    const y = 100 - ((val - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="text-right">
      <p className="text-sm text-slate-500 uppercase">탄소 배출량 추이</p>
      <div className="flex items-end justify-end gap-2">
        <p className="text-2xl font-bold text-blue-600">{current.toFixed(1)} <span className="text-sm font-normal text-slate-400">gCO2/kWh</span></p>
        <svg width="80" height="24" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline fill="none" stroke={change > 0 ? "#ef4444" : "#22c55e"} strokeWidth="5" points={points} /></svg>
      </div>
    </div>
  );
}

/** recharts Tooltip 의 content 로 넘길 때 주입되는 props (필요한 필드만). */
interface MixTooltipProps {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
}

function MixTooltip({ active, payload }: MixTooltipProps) {
  if (active && payload && payload.length) {
    const item = payload[0];
    return (
      <div className="p-2 bg-slate-800 text-white rounded-md text-xs">
        <p>{`${item.name}: ${(item.value ?? 0).toFixed(1)}%`}</p>
      </div>
    );
  }
  return null;
}

/** 설정 모달의 에너지 믹스 도넛 차트. */
function EnergyMixChart({ mixData }: { mixData: EnergyMixValues }) {
  const data = [
    { name: MIX_LABELS.renewable, value: mixData.renewable, color: '#22c55e' },
    { name: MIX_LABELS.nuclear, value: mixData.nuclear, color: '#3b82f6' },
    { name: MIX_LABELS.fossil, value: mixData.fossil, color: '#64748b' },
  ];

  return (
    <div className="h-32 -mb-4">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<MixTooltip />} />
          <Pie data={data} cx="50%" cy="50%" innerRadius={35} outerRadius={50} fill="#8884d8" paddingAngle={5} dataKey="value" nameKey="name">
            {data.map((entry) => (
              <Cell key={`cell-${entry.name}`} fill={entry.color} stroke={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedWeather: string;
  onWeatherChange: (weather: string) => void;
  mix: EnergyMixValues;
  tempMix: EnergyMixValues;
  onSliderChange: (type: MixKey, value: string) => void;
  onTextInputChange: (type: MixKey, value: string) => void;
  onNormalize: () => void;
  onDownloadPdf: () => void;
  isGeneratingPdf: boolean;
}

/**
 * 시뮬레이션 설정 모달.
 * Home 안에 두면 렌더마다 재생성되어 입력 포커스가 풀리므로 모듈 스코프에 둔다.
 */
function SettingsModal({
  isOpen,
  onClose,
  selectedWeather,
  onWeatherChange,
  mix,
  tempMix,
  onSliderChange,
  onTextInputChange,
  onNormalize,
  onDownloadPdf,
  isGeneratingPdf,
}: SettingsModalProps) {
  // 숫자 입력창은 blur 때 정규화하지 않는다. 한 칸을 고치고 다음 칸으로 넘어가는
  // 순간 아직 손대지 않은 두 값을 기준으로 비율이 다시 잡혀, 방금 입력한 숫자가
  // 사용자 의도와 다르게 바뀌기 때문이다(재생 40 입력 → 37.5로 미끄러짐).
  // 대신 합계를 실시간으로 보여주고, 100%로 맞추는 시점은 사용자가 버튼으로 정한다.
  const mixTotal = tempMix.renewable + tempMix.nuclear + tempMix.fossil;
  const totalOffBy = Math.abs(mixTotal - 100);
  const totalToneClass =
    totalOffBy <= MIX_TOTAL_TOLERANCE
      ? 'text-slate-500'
      : totalOffBy <= MIX_TOTAL_SEVERE
        ? 'text-amber-600 bg-amber-50'
        : 'text-red-600 bg-red-50';

  return (
    // 오버레이가 스크롤 컨테이너를 겸한다. overscroll-contain 이 스크롤 연쇄를 끊어
    // 모달 위에서 휠을 굴려도 뒤 페이지가 따라 움직이지 않는다.
    // 중앙 정렬을 translate 대신 flex 로 하는 이유: 패널이 뷰포트보다 커지는
    // 상황에서도 잘리지 않고 오버레이 스크롤로 흡수되기 때문이다.
    <div
      className={`fixed inset-0 bg-black/50 z-40 flex items-center justify-center overflow-y-auto overscroll-contain p-4 sm:p-6 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onClose}
    >
      {/* 패딩은 패널이 아니라 헤더/본문이 각자 갖는다. 패널에 패딩을 두면
          sticky 헤더가 그 패딩 위로 붙어 내용이 헤더 옆으로 비쳐 보인다.

          최대 높이는 90vh 가 아니라 오버레이 패딩(p-4 / sm:p-6)을 뺀 dvh 다.
          vh 는 모바일에서 주소창이 보이는 동안에도 "주소창이 사라진" 높이를
          가리키므로, 90vh 짜리 모달이 주소창 아래로 밀려 하단이 잘린다.
          패딩까지 빼두면 패널+패딩이 뷰포트를 넘지 않아, flex 중앙 정렬에서
          넘친 영역의 위쪽이 스크롤로 닿지 않게 되는 문제도 생기지 않는다. */}
      <div
        className={`w-full max-w-md max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain bg-slate-50 rounded-2xl shadow-2xl transition-all duration-300 ${isOpen ? 'opacity-100 scale-100' : 'opacity-90 scale-95'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 스크롤해도 제목과 닫기 버튼은 계속 보이도록 상단에 고정한다.
            아래 내용이 비쳐 보이지 않게 패널과 같은 불투명 배경을 준다. */}
        <div className="sticky top-0 z-10 flex justify-between items-center gap-2 bg-slate-50 border-b border-slate-200 px-5 sm:px-6 py-4">
          <h2 className="text-2xl font-bold text-slate-800">시뮬레이션 설정</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-200 transition-colors shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 sm:py-6">
          {/* Weather Scenario Section */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3 text-slate-700">기후 시나리오</h3>
            <div className="grid grid-cols-2 gap-2">
              {WEATHER_SCENARIOS.map((scen) => (
                <button
                  key={scen.id}
                  onClick={() => onWeatherChange(scen.id)}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-medium transition-all ${
                    selectedWeather === scen.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {scen.icon}
                  {scen.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2.5 p-2 bg-slate-100 rounded-md">
              {WEATHER_SCENARIOS.find(s => s.id === selectedWeather)?.description}
            </p>
          </div>

          {/* Energy Mix Sliders */}
          <div>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-700">에너지 믹스</h3>
              <div className="flex items-center gap-1.5">
                <span
                  aria-live="polite"
                  className={`text-xs font-medium tabular-nums px-1.5 py-1 rounded-md ${totalToneClass}`}
                >
                  합계: {Number(mixTotal.toFixed(1))}%
                </span>
                <button onClick={onNormalize} className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded-md hover:bg-blue-50">
                  100% 맞춤
                </button>
              </div>
            </div>
            <EnergyMixChart mixData={tempMix} />
            <div className="space-y-4">
              {(['renewable', 'nuclear', 'fossil'] as const).map((type) => (
                <div key={type}>
                  <div className="flex justify-between items-center text-sm mb-1">
                    <span className="text-slate-600 font-medium">{MIX_LABELS[type]}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(tempMix[type])}
                        onChange={(e) => onTextInputChange(type, e.target.value)}
                        className="w-16 text-right px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="w-4 text-slate-500">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0" max="100" step="0.1"
                    value={mix[type]} onChange={(e) => onSliderChange(type, e.target.value)}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Download Button */}
          <div className="mt-6">
            <button
              onClick={onDownloadPdf}
              disabled={isGeneratingPdf}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {isGeneratingPdf ? <Spinner className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {isGeneratingPdf ? 'PDF 생성 중...' : '리포트 PDF로 다운로드'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const formatDelta = (delta: number) => `${delta > 0 ? '+' : ''}${Number(delta.toFixed(1))}%p`;

const formatSigned = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}`;

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
}: {
  nextAction?: NextAction | null;
  currentScore?: number;
  isCalculating: boolean;
  appliedTarget: number | null;
  onApply: (action: NextAction) => void;
}) {
  // 적용으로 시작된 계산인지 구분한다. 슬라이더 조작 중에도 버튼은 잠그되,
  // "적용 중" 문구는 실제로 적용을 눌렀을 때만 보여준다.
  const isApplying = isCalculating && appliedTarget !== null;
  const showApplied = !isCalculating && appliedTarget !== null;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-center mb-4 gap-2">
        <h2 className="text-xl font-semibold text-slate-800">다음 단계</h2>
        {showApplied && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            적용 완료 · {currentScore ?? '--'}점
          </span>
        )}
      </div>

      {nextAction === undefined && (
        <p className="text-sm text-slate-400">계산 중...</p>
      )}

      {nextAction === null && (
        <p className="text-sm text-slate-500 leading-relaxed">
          현재 조합에서 추가 개선 가능한 행동이 없습니다.
        </p>
      )}

      {nextAction && (
        <div className={`transition-opacity duration-200 ${isCalculating ? 'opacity-50' : 'opacity-100'}`}>
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <span className="text-lg font-bold text-slate-800">
              {nextAction.lever_label} {formatDelta(nextAction.delta)}
            </span>
            {nextAction.reaches_goal && (
              <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
                목표 달성
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm mb-3">
            <span className="text-slate-400">{currentScore ?? '--'}점</span>
            <span className="text-slate-300">→</span>
            <span className="font-bold text-blue-600">{nextAction.expected_score}점</span>
            <span className="text-xs font-semibold text-green-600">
              {formatSigned(nextAction.expected_gain)}점
            </span>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-md border border-slate-100">
            {nextAction.reason}
          </p>

          {nextAction.grid_margin_change !== 0 && (
            <p className="text-xs mt-2 flex items-center gap-1.5">
              <span className="text-slate-500">전력 공급</span>
              <span className={`font-semibold ${nextAction.grid_margin_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatSigned(nextAction.grid_margin_change)}
              </span>
            </p>
          )}

          {nextAction.resulting_grid_status === 'deficit' && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 mt-2 flex items-start gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>적용 후에도 전력이 부족하지만, 부족분은 줄어듭니다.</span>
            </p>
          )}

          <button
            onClick={() => onApply(nextAction)}
            disabled={isCalculating}
            className="w-full mt-4 px-4 py-2.5 flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
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
  deficit: { dot: 'bg-red-500', text: 'text-red-600' },      // 공급 부족 — 위험
  stable: { dot: 'bg-green-500', text: 'text-green-600' },   // 안정
  surplus: { dot: 'bg-amber-500', text: 'text-amber-600' },  // 과잉 공급 / 출력제한
};

const FACTOR_STATUS_STYLES: Record<FactorStatus, { dot: string; value: string }> = {
  good: { dot: 'bg-green-500', value: 'text-green-600' },
  warn: { dot: 'bg-amber-500', value: 'text-amber-600' },
  bad: { dot: 'bg-red-500', value: 'text-red-600' },
};

/**
 * 점수 귀인. "무엇이 내 점수를 깎았나"에 답한다.
 *
 * 접힘/펼침은 네이티브 <details>로 처리해 별도 state를 쓰지 않는다.
 * factors 배열은 백엔드가 carbon → grid → fit 순서로 보장하므로 정렬하지 않는다.
 */
function FactorBreakdown({ factors }: { factors?: Factor[] | null }) {
  return (
    <details className="group bg-white rounded-xl shadow-sm border border-slate-200">
      <summary className="p-6 flex justify-between items-center cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2 className="text-xl font-semibold text-slate-800">왜 이 점수인가요?</h2>
        <svg
          xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-slate-400 transition-transform duration-200 group-open:rotate-180"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </summary>

      <div className="px-6 pb-6">
        {!factors || factors.length === 0 ? (
          <p className="text-sm text-slate-400">계산 중...</p>
        ) : (
          <div className="space-y-4">
            {factors.map((factor) => (
              <div key={factor.key}>
                <div className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${FACTOR_STATUS_STYLES[factor.status].dot}`} />
                    <span className="text-sm font-medium text-slate-700">{factor.label}</span>
                  </div>
                  <span className={`text-sm font-bold shrink-0 ${
                    factor.penalty > 0 ? FACTOR_STATUS_STYLES[factor.status].value : 'text-slate-400'
                  }`}>
                    {factor.penalty > 0 ? `-${Number(factor.penalty.toFixed(1))}점` : '0점'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mt-1 pl-4">
                  {factor.detail}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export default function Home() {
  const [selectedRegion, setSelectedRegion] = useState("서울");
  const [selectedWeather, setSelectedWeather] = useState("맑음");
  const [mix, setMix] = useState<EnergyMixValues>({
    renewable: 33.3,
    nuclear: 33.3,
    fossil: 33.4
  });
  const [tempMix, setTempMix] = useState(mix);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [results, setResults] = useState<SimulationResult | null>(null);
  const [emissionHistory, setEmissionHistory] = useState<number[]>([]);

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
    setTempMix(newMix);
    setAppliedTarget(null); // 직접 조작하면 "적용 완료" 피드백을 거둔다
  };

  const handleTextInputChange = (type: keyof typeof mix, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue) || numValue < 0 || numValue > 100) return;
    setTempMix(prev => ({ ...prev, [type]: numValue }));
  };

  // 적용 없이 모달을 닫으면 초안(tempMix)을 마지막으로 반영된 mix로 되돌린다.
  // 입력창이 blur 정규화를 하지 않게 된 뒤로, 합계가 100이 아닌 초안을 남긴 채
  // 닫으면 바깥 표시(mix 기준)와 다시 연 입력창(tempMix)이 서로 다른 값을 보였다.
  //
  // 닫으면서 정규화까지 해버리지는 않는다. 사용자가 "100% 맞춤"을 누르지 않은
  // 값을 임의로 확정하면 닫기가 조용한 적용이 되어버리기 때문이다.
  // 모달의 닫기 경로(오버레이 클릭, X 버튼)는 모두 onClose 하나를 타므로
  // 리셋도 여기 한 곳에만 둔다.
  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
    setTempMix(mix);
  };

  const normalizeMix = () => {
    const total = tempMix.renewable + tempMix.nuclear + tempMix.fossil;
    if (total === 0) {
      const equalMix = { renewable: 33.3, nuclear: 33.3, fossil: 33.4 };
      setMix(equalMix);
      setTempMix(equalMix);
      return;
    }
    const normalizedMix = {
      renewable: (tempMix.renewable / total) * 100,
      nuclear: (tempMix.nuclear / total) * 100,
      fossil: (tempMix.fossil / total) * 100,
    };
    setMix(normalizedMix);
    setTempMix(normalizedMix);
    setAppliedTarget(null);
  };

  // 추천 행동 적용. mix만 바꾸면 아래 두 useEffect가 tempMix 동기화와
  // 재계산을 각각 처리하므로 별도 요청 로직이 필요 없다.
  //
  // isCalculating을 여기서 즉시 켜는 이유: 재계산 useEffect는 300ms 디바운스 뒤에
  // 켜므로, 그대로 두면 클릭 직후 300ms 동안 버튼이 아무 반응 없는 것처럼 보인다.
  const handleApplyNextAction = (action: NextAction) => {
    setAppliedTarget(action.expected_score);
    setIsCalculating(true);
    setMix(action.resulting_mix);
    setTempMix(action.resulting_mix); // 설정 모달 입력값도 함께 맞춘다
  };

  // 지역/기상이 바뀌면 배출량 추이를 초기화한다. 조건이 다른 값을 한 선으로 이으면
  // 스파크라인이 "내 믹스 조작의 결과"가 아니게 되기 때문이다.
  // 초기화를 useEffect가 아닌 이벤트 핸들러에서 하는 이유는, 렌더 후 setState를
  // 한 번 더 유발하지 않고 같은 배치에서 처리하기 위해서다.
  const handleRegionChange = (region: string) => {
    if (region === selectedRegion) return;
    setSelectedRegion(region);
    setEmissionHistory([]);
    setAppliedTarget(null);
  };

  const handleWeatherChange = (weather: string) => {
    if (weather === selectedWeather) return;
    setSelectedWeather(weather);
    setEmissionHistory([]);
    setAppliedTarget(null);
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

    // 2단계: 조작이 멎은 뒤에만 AI 해설을 받아 ai_message만 교체한다.
    // 전체를 setResults 하면 emissionHistory가 중복 적재되고 화면이 한 번 더 흔들린다.
    const fetchAiMessage = async () => {
      setIsAiLoading(true);
      try {
        const data = await requestCalculate(true);
        if (cancelled) return;
        setResults(prev => (prev ? { ...prev, ai_message: data.ai_message } : data));
      } catch (error) {
        // AI 실패는 치명적이지 않다. 1단계의 결정론적 요약이 그대로 남는다.
        if (!cancelled) console.error("AI 설명 생성 실패:", error);
      } finally {
        if (!cancelled) setIsAiLoading(false);
      }
    };

    const scoreTimer = setTimeout(fetchScores, SCORE_DEBOUNCE_MS);
    const aiTimer = setTimeout(fetchAiMessage, AI_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(scoreTimer);
      clearTimeout(aiTimer);
    };
  }, [mix, selectedRegion, selectedWeather]);

  const handleDownloadPdf = async () => {
    // 중복 클릭 차단. disabled 로도 막지만, 이 가드가 있어야
    // 키보드 연타나 렌더 지연 상황에서도 요청이 두 번 나가지 않는다.
    if (isGeneratingPdf) return;

    setIsGeneratingPdf(true);
    try {
      if (!API_BASE_URL) throw new Error(MISSING_API_URL_MESSAGE);

      const response = await fetch(`${API_BASE_URL}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...mix,
          region: selectedRegion,
          weather_scenario: selectedWeather,
          // 화면에 떠 있는 해설을 그대로 넘겨 리포트가 같은 문장을 다시 만들지 않게 한다.
          // 없으면 백엔드가 새로 생성한다.
          ai_message: results?.ai_message ?? null,
        }),
      });

      if (!response.ok) {
        // 서버에서 보낸 에러 메시지를 포함하여 throw
        const errorText = await response.text();
        throw new Error(`PDF 생성에 실패했습니다. (서버 응답: ${response.status} ${errorText.substring(0, 100)}...)`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'climateloop_report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      console.error("PDF 다운로드 실패:", error);
      alert('PDF를 다운로드하는 중 오류가 발생했습니다.');
    } finally {
      // 성공·실패·예외 어느 경로로 빠져나가도 버튼을 되살린다.
      setIsGeneratingPdf(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-slate-50">
      <header className="w-full max-w-6xl mb-8">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">ClimateLoop</h1>
        <p className="text-slate-600">인터랙티브 기후 및 에너지 시뮬레이터</p>
      </header>

      {/* API Error Banner — 계산 실패 시에만 노출. 성공하면 자동으로 사라진다. */}
      {apiError && (
        <div
          role="alert"
          className="w-full max-w-6xl mb-6 flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50"
        >
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
          <div className="text-sm leading-relaxed">
            <p className="font-semibold text-red-800">데이터를 불러오지 못했습니다</p>
            <p className="text-red-700 mt-0.5">{apiError}</p>
            <p className="text-xs text-red-500 mt-1.5">
              아래 화면은 마지막으로 성공한 계산 결과입니다.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-6xl">
        {/* Left Panel: Map & Region Selection */}
        <div className="lg:col-span-8 bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-[400px]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">지역별 에너지 적합도</h2>
              <p className="text-sm text-blue-600 font-medium">현재 선택: {selectedRegion}</p>
            </div>
            <CarbonEmissionChart current={results?.carbon_emissions ?? 0} history={emissionHistory} />
          </div>
          
          <div className={`w-full h-[400px] bg-slate-100 rounded-lg overflow-hidden border border-slate-200 relative mb-6 transition-all ${isSettingsOpen ? 'z-0' : 'z-10'}`}>
            <MapWrapper selectedRegion={selectedRegion} onRegionChange={handleRegionChange} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(results?.suitability || { '태양광': 0, '풍력': 0, '수력': 0, '화력': 0 }).map(([source, val]) => (
              <div key={source} className="p-4 bg-white rounded-lg border border-slate-100 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    {SOURCE_ICONS[source]}
                    <span className="text-sm font-semibold text-slate-700">{source}</span>
                  </div>
                  <span className="text-sm font-bold text-blue-600">{Math.round(val)}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-500 ease-out"
                    style={{ width: `${val}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-2 tracking-tighter">상대 적합도 지수 (무차원)</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3 leading-relaxed">
            ※ 위 값은 <span className="text-slate-500">지역 계수 × 기상 배수 × 현재 에너지 믹스 비중</span>으로
            계산한 무차원 상대 지수입니다. 지역 고유의 잠재량이 아니라 <span className="text-slate-500">지금 선택한
            믹스가 이 지역·이 기상에서 얼마나 실현되는지</span>를 나타내므로, 슬라이더를 조정하면 값도 함께 바뀝니다.
            수력은 예외로 믹스·기상과 무관한 고정 지수입니다.
            <br />
            ※ 지역별 효율 계수는 전국 평균을 1.0으로 두고 지역 간 상대적 유불리를 표현한
            시뮬레이션용 정규화 지수입니다. 실제 설비 이용률이나 발전량 통계가 아닙니다.
          </p>
        </div>

        {/* Right Panel: Controls & AI */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Emission Simulation */}
          <EmissionSimulationChart projection={results?.projection} />

          {/* Simulation Summary */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between items-center mb-4 gap-2">
              <h2 className="text-xl font-semibold text-slate-800 shrink-0">시뮬레이션 요약</h2>
              <div className="flex items-center gap-2 shrink-0">
                {isCalculating && <UpdatingBadge />}
                <button onClick={() => setIsSettingsOpen(true)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                  설정 변경
                </button>
              </div>
            </div>

            {/* Current Energy Mix */}
            <div className="space-y-2 mb-4">
              <h3 className="text-sm font-medium text-slate-500 mb-2">현재 에너지 믹스</h3>
              {(['renewable', 'nuclear', 'fossil'] as const).map((type) => (
                <div key={type} className="flex justify-between items-center text-sm">
                  <span className="text-slate-600">{MIX_LABELS[type]}</span>
                  <span className="font-semibold text-slate-800">{Math.round(mix[type])}%</span>
                </div>
              ))}
            </div>

            <div className={`pt-4 border-t border-slate-100 space-y-3 transition-opacity duration-200 ${isCalculating ? 'opacity-50' : 'opacity-100'}`}>
              {/* Grid Stability */}
              {results?.grid && (
                <div className="flex justify-between items-start gap-3">
                  <span className="text-sm text-slate-500 shrink-0">전력망 안정도</span>
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

          {/* Next Action */}
          <NextActionCard
            nextAction={results?.next_action}
            currentScore={results?.sustainability_score}
            isCalculating={isCalculating}
            appliedTarget={appliedTarget}
            onApply={handleApplyNextAction}
          />

          {/* Factor Breakdown */}
          <FactorBreakdown factors={results?.factors} />

          {/* AI Assistant */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex-grow">
            <div className="flex justify-between items-center mb-4 gap-2">
              <h2 className="text-xl font-semibold text-slate-800 shrink-0">AI 어시스턴트</h2>
              {isAiLoading && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full shrink-0">
                  <Spinner className="w-3 h-3" />
                  설명 작성 중
                </span>
              )}
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800 mb-4 min-h-[100px] leading-relaxed whitespace-pre-wrap">
              {results?.ai_message || "슬라이더를 조절하여 환경에 미치는 영향을 확인해 보세요."}
            </div>
            {/*
              자유 질문 입력창이 있었으나 핸들러가 연결되지 않아 눌러도 반응이 없었다.
              동작하지 않는 UI를 남기는 대신, 같은 역할을 실제로 수행하는 두 카드로
              시선을 보내는 안내로 교체한다.
            */}
            <div className="flex items-start gap-2 text-xs text-slate-500 leading-relaxed">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-slate-400"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              <p>
                이 설명은 지역·기상·에너지 믹스를 바꿀 때마다 다시 작성됩니다.
                점수의 근거는 <span className="font-medium text-slate-600">왜 이 점수인가요?</span>에서,
                개선 방법은 <span className="font-medium text-slate-600">다음 단계</span>에서 확인하세요.
              </p>
            </div>
          </div>
        </div>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        selectedWeather={selectedWeather}
        onWeatherChange={handleWeatherChange}
        mix={mix}
        tempMix={tempMix}
        onSliderChange={handleSliderChange}
        onTextInputChange={handleTextInputChange}
        onNormalize={normalizeMix}
        onDownloadPdf={handleDownloadPdf}
        isGeneratingPdf={isGeneratingPdf}
      />

      <button
        onClick={() => setIsSettingsOpen(true)}
        className="fixed bottom-8 right-8 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 transition-all z-30"
        aria-label="Open settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V12a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
      </button>
    </main>
  );
}
