/**
 * 에너지원 기초 상식 퀴즈의 문제 풀.
 *
 * 이 앱이 쓰는 용어(배출강도, 에너지 믹스, 적합도, 지속 가능성 지수 …)는 일부러
 * 넣지 않았다. 화면의 수치를 읽는 법은 각 카드의 근거 토글이 이미 설명하고 있고,
 * 이 퀴즈가 맡는 것은 그보다 앞의 상식 — "태양광은 흐린 날 어떻게 되나", "풍력은
 * 바람이 세면 어떻게 되나" 같은, 화면을 보기 전에 알고 있으면 결과가 달리 읽히는
 * 것들이다. 그래서 문제는 앱 밖에서도 그대로 성립한다.
 *
 * 정답과 해설은 발전 방식의 물리적 사실만 다룬다. 나라별 통계나 정책처럼 시점에
 * 따라 달라지는 것은 넣지 않았다 — 문제 풀이 조용히 낡는 것을 막으려는 것이다.
 */

/** 문제가 다루는 발전원. 카드에 작은 표식으로 띄워 무엇에 관한 문제인지 먼저 보인다. */
export type QuizTopic = '태양광' | '풍력' | '원자력' | '화력' | '수력' | '공통';

export interface QuizQuestion {
  id: string;
  topic: QuizTopic;
  /** 문제 문장. O/X 문제는 서술문, 4지선다는 물음표로 끝난다. */
  prompt: string;
  kind: 'ox' | 'choice';
  /** O/X 는 ['O', 'X'] 두 개. 4지선다는 네 개. */
  choices: string[];
  /** 정답의 choices 인덱스. */
  answer: number;
  /** 한 줄 해설. 왜 그런지까지 적어 정답만 외우고 끝나지 않게 한다. */
  explanation: string;
}

const OX = ['O', 'X'];

export const QUIZ_POOL: QuizQuestion[] = [
  {
    id: 'nuclear-co2',
    topic: '원자력',
    prompt: '원자력 발전은 발전 과정에서 이산화탄소를 거의 배출하지 않는다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '핵분열은 연료를 태우는 반응이 아니라서 발전 자체로는 이산화탄소가 나오지 않습니다. 다만 발전소 건설과 연료 가공 과정에서는 배출이 발생합니다.',
  },
  {
    id: 'solar-cloudy',
    topic: '태양광',
    prompt: '태양광 발전은 흐린 날에는 전혀 발전이 되지 않는다.',
    kind: 'ox',
    choices: OX,
    answer: 1,
    explanation:
      '구름을 통과해 흩어진 빛(산란광)으로도 발전합니다. 맑은 날보다 크게 줄어들 뿐 0이 되지는 않습니다.',
  },
  {
    id: 'wind-cutout',
    topic: '풍력',
    prompt: '풍력 발전기는 바람이 너무 강하면 오히려 가동을 멈춘다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '설계 한계를 넘는 바람에서는 날개와 발전기가 상할 수 있어 일부러 회전을 멈춥니다. 이 기준 풍속을 정지 풍속(cut-out)이라고 합니다.',
  },
  {
    id: 'solar-heat',
    topic: '태양광',
    prompt: '태양광 패널은 온도가 높을수록 발전 효율이 좋아진다.',
    kind: 'ox',
    choices: OX,
    answer: 1,
    explanation:
      '반대입니다. 실리콘 패널은 뜨거워지면 효율이 떨어져, 한여름 폭염보다 햇빛이 강하면서 서늘한 날에 더 잘 만듭니다.',
  },
  {
    id: 'hydro-head',
    topic: '수력',
    prompt: '수력 발전은 물이 떨어지는 높이차가 클수록 더 많은 전력을 얻을 수 있다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '발전량은 떨어지는 높이(낙차)와 흘려보내는 물의 양에 함께 비례합니다. 그래서 댐은 높이를 확보할 수 있는 지형에 세웁니다.',
  },
  {
    id: 'pumped-storage',
    topic: '수력',
    prompt: '양수 발전은 전기가 남을 때 물을 위쪽 저수지로 퍼올려 두었다가, 필요할 때 흘려보내 발전한다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '전기를 물의 위치에너지로 바꿔 저장하는 방식이라, 사실상 커다란 배터리처럼 쓰입니다. 퍼올릴 때 쓴 전기보다 되받는 전기가 조금 적습니다.',
  },
  {
    id: 'thermal-steam',
    topic: '화력',
    prompt: '화력 발전은 연료를 태운 열로 물을 끓이고, 그 증기로 터빈을 돌려 전기를 만든다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '연료가 하는 일은 물을 끓이는 것까지입니다. 전기를 만드는 것은 증기가 돌리는 터빈과 거기 이어진 발전기입니다.',
  },
  {
    id: 'nuclear-steam',
    topic: '원자력',
    prompt: '원자력 발전소도 결국 증기로 터빈을 돌려 전기를 만든다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '물을 끓여 증기로 터빈을 돌리는 구조는 화력과 같습니다. 그 열을 연료를 태워 얻는지, 핵분열로 얻는지가 다릅니다.',
  },
  {
    id: 'solar-moon',
    topic: '태양광',
    prompt: '태양광 발전은 밤에도 달빛으로 어느 정도 발전할 수 있다.',
    kind: 'ox',
    choices: OX,
    answer: 1,
    explanation:
      '달빛은 햇빛을 반사한 것이어서 세기가 수십만 분의 1 수준입니다. 실질적인 발전은 되지 않아, 밤 시간은 다른 발전원이 메웁니다.',
  },
  {
    id: 'hydro-fuel',
    topic: '수력',
    prompt: '수력 발전은 발전하는 동안 연료를 태우지 않는다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '물의 힘으로 터빈을 직접 돌리므로 태울 연료가 없습니다. 대신 댐을 만들 때 생기는 수몰과 생태계 변화가 과제로 남습니다.',
  },
  {
    id: 'nuclear-fuel',
    topic: '원자력',
    prompt: '원자력 발전의 연료로 주로 쓰이는 물질은 무엇일까요?',
    kind: 'choice',
    choices: ['우라늄', '석탄', '천연가스', '헬륨'],
    answer: 0,
    explanation:
      '우라늄입니다. 우라늄 원자핵이 쪼개질 때 나오는 열을 이용하며, 아주 적은 양으로 많은 열을 낼 수 있습니다.',
  },
  {
    id: 'solar-principle',
    topic: '태양광',
    prompt: '태양광 발전이 전기를 만드는 원리는 무엇일까요?',
    kind: 'choice',
    choices: [
      '빛이 반도체에 닿아 전자가 움직인다',
      '빛의 열로 물을 끓여 터빈을 돌린다',
      '빛이 자석을 회전시킨다',
      '빛이 화학반응을 일으켜 연료를 만든다',
    ],
    answer: 0,
    explanation:
      '빛 알갱이가 반도체 안의 전자를 밀어내면서 전류가 흐릅니다. 터빈이나 회전하는 부품이 없어서 소리도 거의 나지 않습니다.',
  },
  {
    id: 'wind-blade',
    topic: '풍력',
    prompt: '풍력 발전기에서 바람의 힘을 회전하는 힘으로 바꾸는 부분은 어디일까요?',
    kind: 'choice',
    choices: ['날개(블레이드)', '기둥(타워)', '변압기', '기초 콘크리트'],
    answer: 0,
    explanation:
      '날개가 바람을 받아 돌고, 그 회전이 안쪽 발전기를 돌려 전기가 됩니다. 날개가 길수록 받는 바람이 많아져 발전량이 늘어납니다.',
  },
  {
    id: 'burn-fuel',
    topic: '공통',
    prompt: '다음 중 발전하는 동안 연료를 태우는 방식은 무엇일까요?',
    kind: 'choice',
    choices: ['석탄 화력 발전', '태양광 발전', '풍력 발전', '수력 발전'],
    answer: 0,
    explanation:
      '석탄 화력만 연료를 태웁니다. 태양광·풍력·수력은 햇빛과 바람, 물의 흐름을 그대로 쓰기 때문에 태울 연료가 없습니다.',
  },
  {
    id: 'nuclear-waste',
    topic: '원자력',
    prompt: '원자력 발전은 다 쓴 연료를 오랫동안 따로 관리해야 한다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '사용을 마친 연료도 오래 열과 방사선을 냅니다. 그래서 물속이나 특수 용기에 보관하며, 최종 처분 방법은 여러 나라가 아직 준비하고 있는 과제입니다.',
  },
  {
    id: 'wind-night',
    topic: '풍력',
    prompt: '풍력 발전은 밤에도 바람이 불면 발전할 수 있다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '바람은 햇빛과 달리 시간대에 묶이지 않으므로 밤에도 발전합니다. 다만 언제 얼마나 불지 미리 정할 수 없다는 점은 그대로입니다.',
  },
  {
    id: 'thermal-dust',
    topic: '화력',
    prompt: '석탄 화력 발전에서 나오는 물질은 미세먼지가 생기는 원인 가운데 하나다.',
    kind: 'ox',
    choices: OX,
    answer: 0,
    explanation:
      '연소 과정에서 나오는 황·질소 산화물이 공기 중에서 반응해 미세먼지가 됩니다. 그래서 발전소에는 이를 걸러내는 설비를 함께 둡니다.',
  },
];

/**
 * 지금 문제와 다른 문제를 무작위로 하나 고른다.
 *
 * 같은 문제가 연속으로 나오지 않게, 현재 인덱스를 뺀 나머지에서만 고른다 —
 * "다시 뽑고 같으면 또 뽑기" 식으로 하면 운이 나쁠 때 몇 번을 헛돌고, 문제가
 * 하나뿐인 경우 영원히 돌 수도 있다.
 *
 * Math.random() 을 쓰므로 렌더 중에 부르면 서버와 클라이언트가 다른 문제를 그려
 * hydration 이 깨진다. 반드시 이벤트 핸들러에서만 부른다.
 */
export function pickNextQuizIndex(current: number): number {
  if (QUIZ_POOL.length <= 1) return current;
  const offset = Math.floor(Math.random() * (QUIZ_POOL.length - 1)) + 1;
  return (current + offset) % QUIZ_POOL.length;
}
