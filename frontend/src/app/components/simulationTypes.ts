/**
 * 시뮬레이션 결과의 타입과, 화면·리포트가 함께 쓰는 표시용 상수.
 *
 * 원래 이 선언들은 page.tsx 안에 있었다. PDF 리포트(PdfReport.tsx)가 같은 결과를
 * 다시 그리게 되면서 두 파일이 같은 타입을 봐야 했고, page.tsx 에서 import 하는
 * 것은 (Next 의 페이지 모듈을 컴포넌트가 거꾸로 참조하는 셈이라) 방향이 뒤집힌다.
 * 타입 정의는 여기 한 곳에 두고 양쪽이 가져다 쓴다.
 *
 * 값은 전부 백엔드가 정한다 — 이 파일에는 백엔드 응답의 모양과 라벨만 있고
 * 계산은 없다. 프론트에서 점수나 배출량을 다시 유도하면 언젠가 화면과 어긋난다.
 */

/** 에너지 믹스 3축. 합계는 항상 100%. */
export interface EnergyMixValues {
  renewable: number;
  nuclear: number;
  fossil: number;
}

export type MixKey = keyof EnergyMixValues;

/** 전력망 상태. 백엔드 build_grid()의 status enum과 대응. */
export type GridStatus = 'deficit' | 'stable' | 'surplus';

/** 지속 가능성 지수를 구성하는 요인 키. 백엔드 FACTOR_WEIGHTS와 대응. */
export type FactorKey = 'carbon' | 'grid' | 'fit';

/** 요인별 신호등. 임계값은 백엔드가 판정하므로 프론트에서 재계산하지 않는다. */
export type FactorStatus = 'good' | 'warn' | 'bad';

export interface WeatherInfo {
  solar_mult: number;
  wind_mult: number;
  demand_mult: number;
  msg: string;
}

export interface WeatherObservation {
  temperature_c: number;
  precipitation_type: number;
  wind_speed_ms: number | null;
  rainfall_mm: number | null;
  base_date: string;
  base_time: string;
}

export interface WeatherWarnings {
  storm: boolean;
  active_titles: string[];
  count: number;
}

export interface WeatherSnapshot {
  source: 'live' | 'fallback';
  scenario: string;
  raw?: {
    observation?: WeatherObservation;
    warnings?: WeatherWarnings;
  };
  meta?: {
    observed_at: string | null;
    age_seconds: number | null;
    stale: boolean;
    fetched_at: string;
    source_detail: string;
    profile_version: string;
  };
}

export interface ClimateNormals {
  available: boolean;
  region: string;
  source: 'live' | 'fallback';
  period?: { from: string | null; to: string | null; samples: number };
  averages?: {
    temperature_c: number | null;
    precipitation_mm: number | null;
    wind_speed_ms: number | null;
    solar_radiation: number | null;
  };
}

/** 목표 명시(ARCS Confidence C-1). gap은 달성 시 0, 음수가 되지 않는다. */
export interface Goal {
  target: number;
  current: number;
  gap: number;
  progress_pct: number;
  achieved: boolean;
}

export interface ProgressLevel {
  id: number;
  name: string;
  min_score: number;
}

/** 단계적 성공 경험(C-2). 최고 단계에 도달하면 next가 null이 된다. */
export interface LevelState {
  current: ProgressLevel;
  next: ProgressLevel | null;
  to_next: number;
  total_levels: number;
}

/** 귀인(C-3). contribution의 합 = sustainability_score. */
export interface Factor {
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
export interface NextAction {
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

export interface GridState {
  status: GridStatus;
  label: string;      // 기존 grid_stability와 동일한 문자열
  production: number;
  demand: number;
  margin: number;
  margin_pct: number;
}

/** AI 해설의 출처. 백엔드 run_simulation()의 ai_source와 대응. */
export type AiSource = 'llm' | 'fallback';

/**
 * 같은 에너지 믹스를 고정한 채 기후 시나리오만 바꿨을 때의 배출강도.
 * 백엔드 build_scenario_comparison()이 만든다.
 */
export interface ScenarioCarbon {
  scenario: string;          // WEATHER_SCENARIOS의 id와 같은 문자열
  carbon_emissions: number;
  grid_status: GridStatus;
  renewable_delivered: number;  // 계획한 재생 비중이 이 기상에서 실제로 만든 발전량(무차원)
  /** 지금 화면이 보여주는 시나리오. 프론트의 선택값이 아니라 백엔드 판정을 따른다 */
  is_current: boolean;
}

/**
 * 적합도 4개 값이 만들어진 재료. 백엔드 build_suitability_basis()가 만든다.
 *
 * suitability 가 "값"이라면 이건 "그 값이 어디서 나왔는지"다. 근거 토글이
 * 계산을 그대로 펼쳐 보이는 데만 쓰고, 프론트에서 적합도를 다시 계산하지는
 * 않는다 — 두 곳에서 같은 값을 계산하면 언젠가 어긋난다.
 */
export interface SuitabilityBasis {
  /** 지역 효율 계수. 1.0 = 전국 평균 (백엔드 seed_db.py 주석 참고) */
  region_factors: { solar: number; wind: number; hydro: number; thermal: number };
  /** 계수의 기준값. 유불리를 말할 때의 비교 대상 */
  region_factor_average: number;
  /** 수력 적합도의 고정 기준 지수. 수력만 믹스·기상과 무관하다 */
  hydro_base_index: number;
}

export interface SimulationResult {
  // --- 기존 필드 ---
  /** 기상까지 반영한 실제 인도 전력 1kWh당 배출량 */
  carbon_emissions: number;
  sustainability_score: number;
  suitability: Record<string, number>;
  suitability_basis: SuitabilityBasis;
  ai_message: string;
  current_region: string;
  grid_stability: string;
  weather_info: WeatherInfo;
  // --- Confidence 신규 필드 ---
  /** ai_message 가 LLM 생성인지("llm") 결정론적 요약인지("fallback") */
  ai_source: AiSource;
  goal: Goal;
  level: LevelState;
  factors: Factor[];          // 항상 길이 3, carbon → grid → fit 순서
  next_action: NextAction | null;  // 개선 여지가 없으면 null
  grid: GridState;
  mix_used: EnergyMixValues;
  projection: ProjectionPoint[];   // 현재(step 0) + PROJECTION_STEPS
  /** 믹스 자체의 배출강도(기상 무관). carbon_emissions와의 차이가 기상의 몫이다 */
  carbon_planned: number;
  carbon_by_scenario: ScenarioCarbon[];
  /**
   * 지역 효율 계수의 출처. "live" = seed_db.py 가 KPX 전력시장 발전설비 정보로
   * 유도한 계수, "fallback" = 내장 추정표.
   *
   * /regions 응답의 같은 이름 필드와 **가리키는 것이 다르다** — 그쪽은 발전원 구성
   * 도넛의 구성비가 KPX 발전량 현황을 반영했는지를 말한다. 둘을 섞어 쓰면 각주가
   * 엉뚱한 API 를 출처로 지목한다.
   *
   * 필드가 없는 구버전 백엔드도 있으므로 optional 이다. 없으면 fallback 으로 읽는다.
   */
  data_source?: 'live' | 'fallback';
  /**
   * 계수 68개의 발전원별 출처. 백엔드 data/coefficient_source.json 의 기록이다.
   *
   *   "kpx_file" — EPSIS 지역별 발전설비 설비용량 스냅샷 (현재 화력만)
   *   "kpx"      — KPX 실시간 API
   *   "builtin"  — 시뮬레이션용 내장 추정표
   *
   * data_source 하나로는 "화력만 실측"인 상태를 말할 수 없어서 이 표가 따로 있다.
   * 넷 다 실측이 아니면 data_source 는 fallback 이므로, 발전원별 각주는 이 값을 본다.
   */
  data_source_detail?: {
    origin?: string;
    covered_sources?: Partial<Record<'solar' | 'wind' | 'hydro' | 'thermal', string>>;
  };
}

export interface RegionComparison {
  meta?: { model_version?: string; generated_at?: string };
  conditions: { mix: EnergyMixValues; weather_scenario: string };
  regions: SimulationResult[];
}

/**
 * 시뮬레이션 곡선의 한 점. 백엔드 build_projection() 이 만든다.
 * 숫자만 오고 라벨은 프론트에서 조립한다.
 */
export interface ProjectionPoint {
  step: number;              // 재생에너지 증가폭(%p). 0이면 현재 지점
  renewable: number;         // 그 지점의 실제 재생 비중
  carbon_emissions: number;
  clamped: boolean;          // 재생 100% 상한에 걸려 step 만큼 못 올라간 경우
}

export const MIX_LABELS: Record<string, string> = {
  renewable: '재생에너지',
  nuclear: '원자력',
  fossil: '화석연료'
};

/**
 * 믹스 3축의 색. 슬라이더 줄 앞의 색 점과 PDF 리포트의 도넛이 이 값을 쓴다.
 *
 * 발전원 4종(energySources.ts SOURCE_COLORS)과 같은 그린 → 인디고 축 위에 있다.
 * 두 팔레트가 한 화면에 함께 나오므로(위 카드의 발전원 도넛, 아래 카드의 믹스
 * 슬라이더) 서로 다른 축을 쓰면 색이 두 가지 문법으로 읽힌다. 축을 공유하면
 * 양쪽 모두 "밝을수록 재생, 어두울수록 화석"이라는 한 가지 규칙으로 읽힌다.
 *
 * 세 색의 상대휘도는 약 0.44 / 0.19 / 0.017 로, 8px 짜리 점에서도 밝기만으로
 * 갈린다. 종전의 파랑(원자력 #3b82f6)·회색(화석 #64748b)을 버린 이유가 이것이다 —
 * 회색은 "값이 없음"으로 읽히기 쉬웠고, 파랑은 옆 카드의 수력과 겹쳤다.
 */
export const MIX_COLORS: Record<MixKey, string> = {
  renewable: '#22c55e', // green-500
  nuclear: '#6366f1',   // indigo-500
  fossil: '#1e1b4b'     // indigo-950
};

/**
 * 전력망 상태의 짧은 이름.
 *
 * 백엔드가 주는 grid.label("불안정 (전력 부족 위험)")은 현재 시나리오 한 건을
 * 위한 문장이라 네 줄짜리 비교 툴팁에는 길다. 여기서는 상태만 짧게 부른다.
 */
export const GRID_STATUS_LABELS: Record<GridStatus, string> = {
  deficit: '공급 부족',
  stable: '안정',
  surplus: '공급 과잉',
};

/** 부호를 붙인 소수 한 자리. 증감을 말하는 자리에서 +/- 가 늘 보이게 한다. */
export const formatSigned = (value: number) =>
  `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}`;

