/**
 * 발전원 4종의 표시 규칙. 지도 오버레이 원형 차트와 하단 요약 카드가
 * 같은 색을 쓰도록 한 곳에 모았다. 한쪽만 고치면 같은 화면에서 태양광이
 * 두 가지 색으로 보인다.
 *
 * ── 왜 무지개가 아니라 한 축인가 ──
 *
 * 예전 팔레트는 amber / sky / blue / red 네 색이었다. 네 조각이 서로 잘 갈리기는
 * 했지만 색끼리 아무 관계가 없어서, 도넛을 봐도 "네 개가 있다"는 것 말고는 읽히는
 * 것이 없었다. 특히 화력의 빨강은 이 화면에서 경고색(요인 신호등의 bad)과 같은
 * 빨강이라, 발전 구성에 화력이 섞여 있다는 사실이 곧 오류 표시처럼 보였다.
 *
 * 지금은 그린 → 틸 → 인디고 → 짙은 인디고 한 축에 네 발전원을 순서대로 올린다.
 * 축의 방향이 곧 재생에너지 → 화석연료이므로, 조각의 밝기만 봐도 이 지역 구성이
 * 어느 쪽으로 기울어 있는지가 먼저 읽힌다. 값을 가리키는 색이라는 성격은 그대로다.
 *
 * ── 색 선택 근거 (light 배경 기준) ──
 *
 * 네 색의 상대휘도가 약 0.44 / 0.33 / 0.19 / 0.045 로 단조 감소하고, 인접한
 * 어느 쌍도 휘도 차가 0.10 이상이다. 색상만으로 갈리는 것이 아니라 밝기까지 함께
 * 달라지므로 적록색약(protan/deutan)에서도 네 조각의 순서가 유지된다 — 무지개
 * 팔레트를 한 축으로 좁히면서 색상 차를 잃는 대신 밝기 차를 얻은 것이다.
 *
 * 다만 그린·틸은 흰 배경 대비가 3:1 미만이라 색만으로 식별하게 두면 안 된다 —
 * 차트 옆에 항목명과 비율을 글자로 함께 적는다(오버레이 범례, 요약 카드 라벨).
 *
 * 브랜드 인디고(brand-600 #4338ca)와의 관계는 globals.css 에 적었다: 램프는
 * #6366f1(밝은 쪽)과 #312e81(어두운 쪽)만 쓰고 그 사이의 중간 명도는 비워 둔다.
 */

/** 표시 순서. 백엔드 simulate()의 suitability 키와 같은 이름을 쓴다. */
export const ENERGY_SOURCES = ['태양광', '풍력', '수력', '화력'] as const;

export type EnergySource = (typeof ENERGY_SOURCES)[number];

export const SOURCE_COLORS: Record<EnergySource, string> = {
  '태양광': '#22c55e', // green-500   — 램프의 밝은 끝
  '풍력': '#14b8a6',   // teal-500    — 그린에서 인디고로 넘어가는 다리
  '수력': '#6366f1',   // indigo-500  — 인디고 진입
  '화력': '#312e81',   // indigo-900  — 램프의 어두운 끝
};

/** 백엔드가 발전원을 추가해도 화면이 깨지지 않도록 회색으로 떨어뜨린다. */
const FALLBACK_COLOR = '#94a3b8'; // slate-400

export function sourceColor(source: string): string {
  return SOURCE_COLORS[source as EnergySource] ?? FALLBACK_COLOR;
}

/**
 * "이 지역엔 무엇이 가장 맞는가"의 표시용 요약.
 *
 * 값 자체는 page.tsx 의 pickBestSource() 가 적합도에서 뽑는다. 여기 있는 것은
 * 그 결론을 그리는 쪽(발전원 구성 패널)이 알아야 할 최소한의 모양뿐이다 —
 * 계산은 한 곳에서만 하고, 화면 여러 곳은 같은 결과를 받아 그리기만 한다.
 */
export interface BestSourceHint {
  source: string;
  /** 2위 발전원 이름. 2위가 없으면 null */
  runnerUp: string | null;
  /** 2위와의 격차(%p). 2위가 없으면 0 */
  lead: number;
}

/**
 * POST /regions 응답 한 건. 백엔드는 total_generation(snake_case)으로 주고
 * 프론트에서 totalGeneration으로 옮긴다.
 *
 * 단위는 MWh지만 실측이 아니라 추정 시뮬레이션값이다(백엔드 estimate_generation).
 * 화면 표기에서 "추정"을 떼면 안 된다 — 라벨·툴팁·각주 모두에 남겨 둔다.
 *
 * sources: 발전원별 추정 발전량(MWh). 원형 차트의 비율은 이 값을
 *          totalGeneration으로 나눠 프론트에서 계산한다.
 */
export interface RegionStat {
  name: string;
  sources: Record<string, number>;
  totalGeneration: number;
}

/** 추정 발전량 표기. 단위는 붙이지 않는다(라벨마다 "MWh (추정)" 위치가 다르다). */
export function formatMwh(value: number, fractionDigits = 1): string {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
