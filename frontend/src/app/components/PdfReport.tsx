'use client';

import React from 'react';
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  EnergyMixValues,
  Factor,
  GRID_STATUS_LABELS,
  MIX_COLORS,
  MIX_LABELS,
  MixKey,
  ProjectionPoint,
  ScenarioCarbon,
  SimulationResult,
  formatSigned,
} from './simulationTypes';

/*
  ── A4 기하 ──

  이 값들은 PdfReport 와 pdfExport.ts 가 함께 본다. 한쪽만 바꾸면 캡처한 픽셀 폭과
  PDF 에 얹는 mm 폭이 어긋나 그림이 늘어나거나 잘린다.

  섹션을 CSS px 로 그리고 mm 로 얹으므로 둘 사이 환산비가 필요하다. 브라우저의
  1px = 1/96 inch 를 기준으로 삼는다(96dpi). 그래서 본문 글자 크기를 정할 때는
  화면 기준이 아니라 "PDF 에 올라간 뒤의 크기"를 봐야 한다 — 180mm 폭을 680px 로
  그려 넣으므로 1px ≈ 0.75pt 로 줄어든다. 15px 본문이 PDF 에서 약 11pt 가 된다.
*/
export const PDF_PAGE_MM = { width: 210, height: 297, margin: 15 };
/** 좌우 여백을 뺀 본문 폭. 캡처한 그림을 이 폭에 맞춰 얹는다. */
export const PDF_CONTENT_MM = PDF_PAGE_MM.width - PDF_PAGE_MM.margin * 2; // 180
/** 상하 여백을 뺀 본문 높이. 섹션이 이보다 커지면 다음 장으로 넘긴다. */
export const PDF_CONTENT_H_MM = PDF_PAGE_MM.height - PDF_PAGE_MM.margin * 2; // 267
const PX_PER_MM = 96 / 25.4;
export const PDF_CONTENT_PX = Math.round(PDF_CONTENT_MM * PX_PER_MM); // 680
const PDF_COVER_H_PX = Math.round(PDF_CONTENT_H_MM * PX_PER_MM); // 1009

/*
  섹션 안쪽 여백.

  캡처 캔버스는 요소의 경계까지만 담는다. 그래서 글자가 경계에 딱 붙어 있으면 마지막
  글자의 오른쪽 끝이나 마지막 줄의 아래쪽이 반올림 한두 픽셀만큼 깎여 나간다 — 처음
  만든 리포트에서 "-19.9점"의 끝과 각 섹션 마지막 각주 줄이 그렇게 잘렸다. 경계에
  아무것도 닿지 않도록 안쪽으로 조금 물려 둔다.

  bottom 을 크게 주는 이유: 각 섹션의 마지막 요소는 각주 문단이고, 문단의 마지막
  줄은 line-height 만큼 아래로 더 내려간다. 좌우보다 여유가 더 필요하다.
*/
const SECTION_PAD = { block: 2, inline: 6, bottom: 16 };
const SECTION_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  paddingTop: SECTION_PAD.block,
  paddingBottom: SECTION_PAD.bottom,
  paddingLeft: SECTION_PAD.inline,
  paddingRight: SECTION_PAD.inline,
};
/** 표지는 한 장을 꽉 채운다. 위아래 여백만큼은 빼야 본문 높이를 넘지 않는다. */
const COVER_INNER_H_PX = PDF_COVER_H_PX - SECTION_PAD.block - SECTION_PAD.bottom;

/** 캡처 순서대로 섹션을 찾는 표식. pdfExport.ts 가 이 속성으로 훑는다. */
export const PDF_SECTION_ATTR = 'data-pdf-section';
/** 리포트 뿌리 요소를 찾는 표식. */
export const PDF_ROOT_ID = 'pdf-report-root';

/*
  ── 색 ──

  전부 hex 다. Tailwind v4 의 유틸리티 클래스는 oklch() 색을 내놓는데, html2canvas
  1.x 의 CSS 파서는 oklch 를 모르고 파싱 단계에서 예외를 던진다. 그래서 이 파일은
  Tailwind 클래스를 한 개도 쓰지 않고 인라인 스타일 + hex 로만 그린다. 화면용 카드와
  달라 보이는 것을 감수하는 대신, 캡처가 색 하나 때문에 통째로 실패하는 길을 막는다.
*/
const C = {
  ink: '#0f172a',      // 본문
  inkSoft: '#475569',  // 보조 설명
  inkFaint: '#94a3b8', // 각주
  rule: '#cbd5e1',     // 구분선
  ruleSoft: '#e2e8f0',
  panel: '#f8fafc',    // 옅은 바탕
  // 강조색은 화면의 브랜드 인디고와 같은 값이다. 리포트와 화면이 서로 다른 색을
  // "우리 색"이라고 부르면, 같은 세션에서 뽑은 PDF 가 다른 서비스의 것처럼 보인다.
  accent: '#4338ca',     // brand-600
  accentDeep: '#312e81', // brand-800
  good: '#15803d',
  warn: '#b45309',
  bad: '#b91c1c',
  white: '#ffffff',
};

const FACTOR_COLOR: Record<Factor['status'], string> = {
  good: C.good,
  warn: C.warn,
  bad: C.bad,
};

/*
  글꼴은 시스템 스택으로 고정한다. 화면은 globals.css 의 Arial 계열을 쓰지만, 캡처된
  SVG(차트)는 페이지 CSS 를 못 보는 별개 문서로 그려지므로 요소마다 명시해야 한글이
  대체 글꼴로 튀지 않는다.
*/
const FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', Arial, sans-serif";

/** 본문 기본값. 지시대로 11px 이상 / 줄간격 1.6 이상을 밑돌지 않게 한 곳에서 잡는다. */
const BODY: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 15,
  lineHeight: 1.7,
  color: C.ink,
};

/* ────────────────────────── 조각들 ────────────────────────── */

/** 섹션 상단의 제목 + 얇은 구분선. */
function SectionHead({ index, title, lead }: { index: number; title: string; lead?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span
          style={{
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: 700,
            color: C.accent,
            letterSpacing: 1,
          }}
        >
          {String(index).padStart(2, '0')}
        </span>
        <h2 style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: C.ink, margin: 0 }}>
          {title}
        </h2>
      </div>
      {/* 얇은 구분선. 1px 은 캡처 후 축소되면 사라질 수 있어 2px 로 둔다. */}
      <div style={{ height: 2, backgroundColor: C.rule, marginTop: 8 }} />
      {lead && (
        <p style={{ ...BODY, fontSize: 13, color: C.inkSoft, margin: '10px 0 0' }}>{lead}</p>
      )}
    </div>
  );
}

/** 이름-값 한 줄. 값이 길어도 접히도록 오른쪽 칸의 폭을 고정하지 않는다. */
function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: '9px 0',
        borderBottom: `1px solid ${C.ruleSoft}`,
        alignItems: 'baseline',
      }}
    >
      <span style={{ ...BODY, fontSize: 14, color: C.inkSoft, width: 150, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ ...BODY, fontWeight: 700, flex: 1, minWidth: 0 }}>
        {value}
        {note && (
          <span style={{ fontWeight: 400, fontSize: 13, color: C.inkSoft }}> {note}</span>
        )}
      </span>
    </div>
  );
}

/** 큰 수치 한 칸. 세 개를 나란히 놓아 요약 첫 줄로 쓴다. */
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div
      style={{
        flex: 1,
        backgroundColor: C.panel,
        border: `1px solid ${C.ruleSoft}`,
        borderRadius: 8,
        padding: '14px 16px',
      }}
    >
      <div style={{ ...BODY, fontSize: 13, color: C.inkSoft, lineHeight: 1.5 }}>{label}</div>
      <div style={{ ...BODY, fontSize: 26, fontWeight: 700, lineHeight: 1.3, marginTop: 2 }}>
        {value}
        {unit && (
          <span style={{ fontSize: 13, fontWeight: 400, color: C.inkSoft }}> {unit}</span>
        )}
      </div>
    </div>
  );
}

/**
 * 기후 시나리오별 배출강도 막대.
 *
 * recharts 가 아니라 div 로 그린다. 라벨이 한글이고, html2canvas 는 SVG 를 페이지
 * CSS 가 닿지 않는 별개 이미지로 직렬화하므로 SVG 안의 한글은 글꼴이 어긋날 여지가
 * 있다. 막대는 사각형 두 개면 되는 그림이라 HTML 로 두는 편이 안전하다.
 */
function ScenarioBars({
  rows,
  scenarioLabels,
}: {
  rows: ScenarioCarbon[];
  scenarioLabels: Record<string, string>;
}) {
  const max = Math.max(...rows.map((r) => r.carbon_emissions), 1);
  const current = rows.find((r) => r.is_current);

  return (
    <div>
      {rows.map((row) => {
        const delta = current ? row.carbon_emissions - current.carbon_emissions : 0;
        const width = `${(row.carbon_emissions / max) * 100}%`;
        return (
          <div key={row.scenario} style={{ marginBottom: 14 }}>
            <div
              /*
                alignItems 가 baseline 이면 안 된다. 이 줄의 오른쪽 칸은 그 자체가
                flex 컨테이너(라벨 + 배지)인데, 그런 항목을 기준선으로 맞추면
                html2canvas 가 안쪽 글자의 위치를 잘못 재서 배지 글자가 잘린다.
              */
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 5,
              }}
            >
              {/*
                라벨과 "현재" 배지를 flex 로 나란히 둔다. 배지를 글 흐름 속 inline
                (또는 inline-block)으로 두면 html2canvas 가 글자의 기준선을 인라인
                박스가 아니라 부모의 line-height 로 잡아, 알약 배경 안에서 글자가
                위아래로 잘린 채 떠진다. 블록 박스로 만들면 그 계산이 끼어들지 않는다.
              */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ ...BODY, fontSize: 14, fontWeight: row.is_current ? 700 : 400 }}>
                  {scenarioLabels[row.scenario] ?? row.scenario}
                </span>
                {row.is_current && (
                  /*
                    흰 글자를 얹은 알약 배지를 쓰지 않는다.

                    화면 카드처럼 진한 파랑 배경에 흰 "현재"를 넣어 봤지만, html2canvas
                    가 채운 작은 상자 위의 글자를 그릴 때 한글 글리프의 위아래를 잘라
                    냈다. inline-block, 배경/글자 분리, 부모의 baseline 정렬 제거까지
                    세 가지 구조를 시험했지만 모두 같은 결과였다.

                    이 리포트의 다른 모든 글자(흰 바탕 위 진한 글자)는 멀쩡하게 떠지므로,
                    배지도 같은 형태로 바꿨다 — 배경 없이 강조색 굵은 글자. 뜻은 그대로
                    남고(막대 색까지 이미 같은 것을 가리킨다) 잘릴 위험은 사라진다.
                  */
                  <span
                    style={{
                      fontFamily: FONT,
                      fontSize: 12,
                      fontWeight: 700,
                      color: C.accentDeep,
                      flexShrink: 0,
                      letterSpacing: 0.3,
                    }}
                  >
                    ◀ 현재 조건
                  </span>
                )}
              </span>
              <span style={{ ...BODY, fontSize: 14 }}>
                <span style={{ fontWeight: 700 }}>{row.carbon_emissions.toFixed(1)}</span>
                <span style={{ fontSize: 12, color: C.inkSoft }}> gCO2/kWh</span>
                {!row.is_current && Math.abs(delta) >= 0.05 && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      marginLeft: 8,
                      color: delta > 0 ? C.bad : C.good,
                    }}
                  >
                    {formatSigned(delta)}
                  </span>
                )}
              </span>
            </div>
            <div style={{ height: 12, backgroundColor: C.ruleSoft, borderRadius: 2 }}>
              <div
                style={{
                  height: 12,
                  width,
                  borderRadius: 2,
                  backgroundColor: row.is_current ? C.accentDeep : C.inkFaint,
                }}
              />
            </div>
            <div style={{ ...BODY, fontSize: 12, color: C.inkSoft, marginTop: 4 }}>
              전력망 {GRID_STATUS_LABELS[row.grid_status]} · 재생 실현{' '}
              {row.renewable_delivered.toFixed(1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────── 섹션 ────────────────────────── */

interface ReportData {
  results: SimulationResult;
  mix: EnergyMixValues;
  regionName: string;
  weatherLabel: string;
  weatherDescription: string;
  /** 표지에 찍는 생성 일시. 렌더 중에 new Date() 를 부르지 않으려고 문자열로 받는다. */
  generatedAt: string;
  /** 시나리오 id → 표시 이름. 화면 탭과 같은 순서·같은 이름을 쓰게 page.tsx 가 넘긴다. */
  scenarioLabels: Record<string, string>;
  /** 화면 탭 순서. 막대를 같은 순서로 세운다. */
  scenarioOrder: string[];
}

/** 1면 — 표지. 본문 높이를 꽉 채워 한 장을 통째로 쓴다. */
function Cover({ data }: { data: ReportData }) {
  const { results, regionName, weatherLabel, generatedAt } = data;
  return (
    <div
      style={{
        height: COVER_INNER_H_PX,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: C.white,
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 로고 — 지구를 두르는 순환(loop). 인라인 SVG 라 글꼴에 의존하지 않는다. */}
          <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="20" fill="none" stroke={C.accent} strokeWidth="3" />
            <ellipse cx="22" cy="22" rx="20" ry="8" fill="none" stroke={C.accent} strokeWidth="2" />
            <circle cx="22" cy="22" r="6" fill={C.good} />
          </svg>
          <span style={{ ...BODY, fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>
            ClimateLoop
          </span>
        </div>
        <div style={{ height: 3, backgroundColor: C.ink, margin: '28px 0 0' }} />
      </div>

      <div>
        <p style={{ ...BODY, fontSize: 15, color: C.inkSoft, margin: 0, letterSpacing: 3 }}>
          SIMULATION REPORT
        </p>
        <h1
          style={{
            ...BODY,
            fontSize: 46,
            fontWeight: 700,
            lineHeight: 1.35,
            margin: '10px 0 0',
          }}
        >
          시뮬레이션 리포트
        </h1>
        <p style={{ ...BODY, fontSize: 17, color: C.inkSoft, margin: '18px 0 0' }}>
          {regionName} · {weatherLabel} 조건에서 계산한
          <br />
          에너지 믹스와 탄소 배출 시뮬레이션 결과입니다.
        </p>
      </div>

      <div>
        <div style={{ height: 2, backgroundColor: C.rule, marginBottom: 4 }} />
        <Row label="선택 지역" value={regionName} />
        <Row label="기후 시나리오" value={weatherLabel} note={`(${data.weatherDescription})`} />
        <Row
          label="지속 가능성 지수"
          value={`${results.sustainability_score}%`}
          note={`${results.level.current.name} 단계`}
        />
        <Row
          label="탄소 배출강도"
          value={`${results.carbon_emissions.toFixed(1)} gCO2/kWh`}
        />
        <Row label="생성 일시" value={generatedAt} />
        <p style={{ ...BODY, fontSize: 12, color: C.inkFaint, margin: '20px 0 0' }}>
          이 리포트의 수치는 상대 비교를 위한 시뮬레이션 결과이며, 실제 관측치나 공식
          통계가 아닙니다.
        </p>
      </div>
    </div>
  );
}

/** 2면 — 지역·기후 요약. */
function SummarySection({ data }: { data: ReportData }) {
  const { results, regionName, weatherLabel, weatherDescription } = data;
  const { grid, weather_info, goal, level } = results;
  const weatherShare = results.carbon_emissions - results.carbon_planned;

  return (
    <div>
      <SectionHead
        index={1}
        title="지역 · 기후 요약"
        lead="선택한 지역과 기후 시나리오가 이번 계산에 어떤 조건으로 들어갔는지."
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <Stat label="지속 가능성 지수" value={`${results.sustainability_score}`} unit="%" />
        <Stat label="탄소 배출강도" value={results.carbon_emissions.toFixed(1)} unit="gCO2/kWh" />
        <Stat label="전력망" value={GRID_STATUS_LABELS[grid.status]} />
      </div>

      <Row label="지역" value={regionName} />
      <Row label="기후 시나리오" value={weatherLabel} note={`— ${weatherDescription}`} />
      <Row
        label="기상 배수"
        value={`태양광 ×${weather_info.solar_mult} · 풍력 ×${weather_info.wind_mult} · 수요 ×${weather_info.demand_mult}`}
      />
      <Row
        label="믹스 자체 배출강도"
        value={`${results.carbon_planned.toFixed(1)} gCO2/kWh`}
        note={`기상이 ${formatSigned(weatherShare)}g 움직였습니다`}
      />
      <Row
        label="전력망 수급"
        value={`생산 ${grid.production.toFixed(1)} / 수요 ${grid.demand.toFixed(1)}`}
        note={`여유 ${formatSigned(grid.margin)} (${formatSigned(grid.margin_pct)}%)`}
      />
      <Row
        label="학습 단계"
        value={`${level.current.id} / ${level.total_levels} ${level.current.name}`}
        note={level.next ? `다음 단계까지 ${level.to_next}점` : '최고 단계'}
      />
      <Row
        label="목표"
        value={
          goal.achieved
            ? `${goal.target}점 달성`
            : `${goal.target}점까지 ${goal.gap}점 남음`
        }
        note={`현재 ${goal.current}점`}
      />

      <p style={{ ...BODY, fontSize: 12, color: C.inkFaint, marginTop: 16 }}>
        ※ 기상 배수는 같은 에너지 믹스라도 기후 조건에 따라 실제 발전량이 달라지는
        정도입니다. 태양광·풍력 배수가 낮으면 계획한 재생 비중만큼 전력을 만들지 못해
        배출강도가 올라갑니다.
      </p>
    </div>
  );
}

/**
 * 3면 — 에너지 믹스 구성. 도넛 + 슬라이더로 정한 값 요약.
 *
 * 도넛은 recharts PieChart 를 고정 크기로 그린다. ResponsiveContainer 를 쓰지 않는
 * 이유: 화면 밖(left:-9999px)에 있는 요소의 폭을 ResizeObserver 로 재는 과정이
 * 한 프레임 뒤에 끝나므로, 캡처 시점과 경쟁이 생긴다. 크기를 못으로 박으면 첫
 * 렌더에 완성된 SVG 가 나온다. 애니메이션도 끈다(isAnimationActive={false}) —
 * 500ms 를 기다리는 것보다 애초에 기다릴 것을 없애는 편이 확실하다.
 */
function MixSection({ data }: { data: ReportData }) {
  const { results, mix } = data;
  const used = results.mix_used;
  const keys: MixKey[] = ['renewable', 'nuclear', 'fossil'];
  const pieData = keys.map((key) => ({
    name: MIX_LABELS[key],
    value: Math.max(0, used[key]),
    color: MIX_COLORS[key],
  }));

  return (
    <div>
      <SectionHead
        index={2}
        title="에너지 믹스 구성"
        lead="슬라이더로 정한 세 발전원의 비중과, 그 비중이 실제 계산에 쓰인 값."
      />

      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ flexShrink: 0 }}>
          <PieChart width={260} height={240}>
            <Pie
              data={pieData}
              dataKey="value"
              cx={130}
              cy={120}
              innerRadius={58}
              outerRadius={100}
              startAngle={90}
              endAngle={-270}
              stroke={C.white}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {pieData.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {keys.map((key) => (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                padding: '10px 0',
                borderBottom: `1px solid ${C.ruleSoft}`,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: MIX_COLORS[key],
                  flexShrink: 0,
                }}
              />
              <span style={{ ...BODY, fontSize: 15, flex: 1 }}>{MIX_LABELS[key]}</span>
              <span style={{ ...BODY, fontSize: 19, fontWeight: 700 }}>
                {used[key].toFixed(1)}
                <span style={{ fontSize: 13, fontWeight: 400, color: C.inkSoft }}>%</span>
              </span>
            </div>
          ))}
          <div style={{ ...BODY, fontSize: 13, color: C.inkSoft, marginTop: 10 }}>
            합계 {(used.renewable + used.nuclear + used.fossil).toFixed(1)}%
            {/* 화면 슬라이더 값과 계산에 쓰인 값이 다르면 그 사실을 적는다. 반올림
                차이는 무시하고, 사용자가 알아볼 만한 차이일 때만 한 줄 붙는다. */}
            {keys.some((key) => Math.abs(mix[key] - used[key]) >= 0.1) && (
              <span>
                {' '}· 화면 슬라이더 값(
                {keys.map((key) => `${mix[key].toFixed(1)}`).join(' / ')})을 합계 100%로
                맞춘 뒤 계산했습니다
              </span>
            )}
          </div>
        </div>
      </div>

      <p style={{ ...BODY, fontSize: 12, color: C.inkFaint, marginTop: 18 }}>
        ※ 도넛의 각 조각은 위 표의 비중과 같은 값입니다. 배출계수는 상대 비교용
        예시값이며 공식 통계가 아닙니다.
      </p>
    </div>
  );
}

/** 4면 — 기후 시나리오별 배출강도 비교. */
function ScenarioSection({ data }: { data: ReportData }) {
  const { results, scenarioLabels, scenarioOrder } = data;
  const byId = new Map(results.carbon_by_scenario.map((row) => [row.scenario, row]));
  // 화면 탭과 같은 순서로 세우고, 목록에 없는 시나리오는 뒤에 붙인다.
  const ordered = [
    ...scenarioOrder.map((id) => byId.get(id)).filter((row): row is ScenarioCarbon => !!row),
    ...results.carbon_by_scenario.filter((row) => !scenarioOrder.includes(row.scenario)),
  ];

  return (
    <div>
      <SectionHead
        index={3}
        title="기후 시나리오별 배출강도"
        lead="에너지 믹스는 그대로 두고 기후 조건만 바꿨을 때의 배출강도. 파란 막대가 이 리포트의 조건입니다."
      />
      <ScenarioBars rows={ordered} scenarioLabels={scenarioLabels} />
      <p style={{ ...BODY, fontSize: 12, color: C.inkFaint, marginTop: 14 }}>
        ※ 같은 믹스라도 기후에 따라 태양광·풍력이 실제로 만드는 전력이 달라지고, 그
        부족분을 화력이 메우면서 배출강도가 움직입니다.
      </p>
    </div>
  );
}

/**
 * 5면 — 재생에너지 비중별 배출강도 추이(라인차트).
 *
 * x축 라벨을 재생 비중 숫자(퍼센트)로 둔다. 화면 차트는 '현재', '+10%p' 같은 한글을
 * 쓰지만, 이 SVG 는 캡처될 때 페이지 CSS 와 분리된 이미지로 직렬화되므로 축 글자는
 * 숫자만 남기고 뜻은 아래 캡션(HTML)이 맡는다.
 */
function ProjectionSection({ data }: { data: ReportData }) {
  const { results, weatherLabel } = data;
  const points: ProjectionPoint[] = results.projection;
  const chartData = points.map((point) => ({
    ...point,
    axis: `${Math.round(point.renewable)}`,
  }));
  const first = points[0];
  const last = points[points.length - 1];
  const reduction = first && last ? first.carbon_emissions - last.carbon_emissions : 0;
  const yMax = Math.max(
    50,
    Math.ceil((Math.max(...points.map((p) => p.carbon_emissions)) * 1.12) / 50) * 50,
  );

  return (
    <div>
      <SectionHead
        index={4}
        title="재생에너지 비중별 배출강도"
        lead={`${weatherLabel} 조건에서 재생에너지 비중만 단계별로 올렸을 때 배출강도가 어떻게 움직이는지.`}
      />

      <div
        style={{
          border: `1px solid ${C.ruleSoft}`,
          borderRadius: 8,
          padding: '16px 12px 8px',
          backgroundColor: C.white,
        }}
      >
        <LineChart
          width={PDF_CONTENT_PX - 34}
          height={260}
          data={chartData}
          margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={C.ruleSoft} />
          <XAxis
            dataKey="axis"
            stroke={C.inkSoft}
            tick={{ fontSize: 13, fill: C.inkSoft, fontFamily: 'Arial, sans-serif' }}
            unit="%"
          />
          <YAxis
            stroke={C.inkSoft}
            tick={{ fontSize: 13, fill: C.inkSoft, fontFamily: 'Arial, sans-serif' }}
            domain={[0, yMax]}
            allowDecimals={false}
            unit="g"
            width={62}
          />
          {first && (
            <ReferenceLine y={first.carbon_emissions} stroke={C.accent} strokeDasharray="4 4" />
          )}
          <Line
            type="monotone"
            dataKey="carbon_emissions"
            stroke={C.accent}
            strokeWidth={3}
            dot={{ r: 5, fill: C.accent, stroke: C.white, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </div>

      <div style={{ marginTop: 14 }}>
        <p style={{ ...BODY, fontSize: 14, margin: 0 }}>
          가로축은 <strong>재생에너지 비중(%)</strong>, 세로축은{' '}
          <strong>배출강도(gCO2/kWh)</strong>입니다. 점선은 현재 배출강도(
          {first ? first.carbon_emissions.toFixed(1) : '--'}g) 기준선입니다.
        </p>
        {first && last && reduction > 0 && (
          <p style={{ ...BODY, fontSize: 14, margin: '8px 0 0' }}>
            재생 비중을 {Math.round(first.renewable)}% → {Math.round(last.renewable)}% 로{' '}
            {Math.round(last.renewable - first.renewable)}%p 올리면 배출강도가{' '}
            <strong style={{ color: C.good }}>{reduction.toFixed(1)}g 줄어듭니다</strong>.
          </p>
        )}
        {points.some((p) => p.clamped) && (
          <p style={{ ...BODY, fontSize: 13, color: C.inkSoft, margin: '8px 0 0' }}>
            일부 구간은 재생 비중 100% 상한에 걸려 계획한 만큼 올라가지 못했습니다.
          </p>
        )}
      </div>

      <p style={{ ...BODY, fontSize: 12, color: C.inkFaint, marginTop: 14 }}>
        ※ 과거 관측치가 아니라 지금 설정으로 계산한 시뮬레이션 곡선입니다.
      </p>
    </div>
  );
}

/** 6면 — 결과 해석. 점수를 깎은 요인, 다음 한 걸음, AI 해설. */
function InterpretationSection({ data }: { data: ReportData }) {
  const { results } = data;
  const { factors, next_action, ai_message, ai_source } = results;

  return (
    <div>
      <SectionHead
        index={5}
        title="결과 해석"
        lead="무엇이 점수를 깎았고, 다음에 무엇을 바꾸면 좋은지."
      />

      <h3 style={{ ...BODY, fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>
        점수를 구성한 세 요인
      </h3>
      {factors.map((factor) => (
        <div
          key={factor.key}
          style={{
            padding: '11px 0',
            borderBottom: `1px solid ${C.ruleSoft}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: FACTOR_COLOR[factor.status],
                flexShrink: 0,
              }}
            />
            <span style={{ ...BODY, fontSize: 15, fontWeight: 700, flex: 1 }}>
              {factor.label}
            </span>
            <span style={{ ...BODY, fontSize: 14, color: C.inkSoft }}>
              가중치 {Math.round(factor.weight * 100)}%
            </span>
            <span
              style={{
                ...BODY,
                fontSize: 15,
                fontWeight: 700,
                color: factor.penalty > 0 ? FACTOR_COLOR[factor.status] : C.inkSoft,
                width: 76,
                textAlign: 'right',
              }}
            >
              {factor.penalty > 0 ? `-${Number(factor.penalty.toFixed(1))}점` : '0점'}
            </span>
          </div>
          {/* 이 문장이 예전 PDF 에서 잘려 나갔던 대목이다. 폭을 좁히지 않고 그대로
              흘려 여러 줄이 되게 둔다 — 캡처는 요소의 실제 높이를 따라간다. */}
          <p style={{ ...BODY, fontSize: 13, color: C.inkSoft, margin: '5px 0 0 20px' }}>
            {factor.detail}
          </p>
        </div>
      ))}

      {next_action && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            backgroundColor: C.panel,
            border: `1px solid ${C.ruleSoft}`,
            borderRadius: 8,
          }}
        >
          <h3 style={{ ...BODY, fontSize: 15, fontWeight: 700, margin: 0 }}>다음 한 걸음</h3>
          <p style={{ ...BODY, fontSize: 14, margin: '8px 0 0' }}>{next_action.reason}</p>
          <p style={{ ...BODY, fontSize: 14, margin: '8px 0 0' }}>
            {next_action.lever_label} {formatSigned(next_action.delta)}%p → 예상 점수{' '}
            <strong>{next_action.expected_score}%</strong> (
            {formatSigned(next_action.expected_gain)}점), 예상 배출강도{' '}
            <strong>{next_action.expected_carbon.toFixed(1)} gCO2/kWh</strong>, 전력망{' '}
            {GRID_STATUS_LABELS[next_action.resulting_grid_status]} (여유{' '}
            {formatSigned(next_action.grid_margin_change)})
          </p>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <h3 style={{ ...BODY, fontSize: 15, fontWeight: 700, margin: '0 0 8px' }}>
          AI 해설
          <span style={{ fontSize: 12, fontWeight: 400, color: C.inkSoft }}>
            {' '}
            · {ai_source === 'llm' ? 'AI 생성' : '즉시 요약'}
          </span>
        </h3>
        <p style={{ ...BODY, fontSize: 14, margin: 0 }}>{ai_message}</p>
      </div>
    </div>
  );
}

/* ────────────────────────── 뿌리 ────────────────────────── */

/**
 * PDF 전용 리포트.
 *
 * 화면 UI 를 그대로 캡처하지 않고 리포트만을 위한 마크업을 따로 둔다. 화면 카드는
 * 좁은 열에 맞춰 글자를 줄이고 문장을 접어 둔 것이 많아, 그대로 떠내면 A4 에서
 * 어색하고 접힌 내용은 아예 빠진다. 여기서는 A4 본문 폭(180mm)을 기준으로 다시
 * 조판하고, 화면에서 <details> 안에 접혀 있던 값도 펼쳐서 싣는다.
 *
 * 배치가 left:-9999px 인 이유: display:none 이면 요소의 크기가 0 이 되어 차트가
 * 그려지지 않고 html2canvas 도 빈 캔버스를 낸다. 화면 밖으로 밀어내면 레이아웃은
 * 정상으로 계산되면서 눈에는 보이지 않는다. aria-hidden 과 음수 tabIndex 로
 * 스크린리더와 탭 이동에서도 빼 둔다 — 화면 본문에 같은 내용이 이미 있다.
 */
export default function PdfReport(props: { data: ReportData | null }) {
  const { data } = props;

  return (
    <div
      id={PDF_ROOT_ID}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -9999,
        top: 0,
        width: PDF_CONTENT_PX,
        backgroundColor: C.white,
        // 캡처 중이 아닐 때 페이지 스크롤 높이를 늘리지 않게 접어 둔다.
        // 캡처 직전에 pdfExport.ts 가 이 값을 'visible' 로 바꾼다.
        overflow: 'hidden',
        height: 0,
        pointerEvents: 'none',
      }}
    >
      {/*
        data 가 없으면 섹션을 아예 만들지 않는다. 계산 결과가 오기 전에 캡처가
        시작될 수 없도록 pdfExport.ts 도 섹션 수를 확인하지만, 빈 리포트가 만들어질
        길 자체를 두지 않는 편이 낫다.
      */}
      {data && (
        <>
          <div {...{ [PDF_SECTION_ATTR]: 'cover' }} style={SECTION_STYLE}>
            <Cover data={data} />
          </div>
          <div {...{ [PDF_SECTION_ATTR]: 'summary' }} style={SECTION_STYLE}>
            <SummarySection data={data} />
          </div>
          <div {...{ [PDF_SECTION_ATTR]: 'mix' }} style={SECTION_STYLE}>
            <MixSection data={data} />
          </div>
          <div {...{ [PDF_SECTION_ATTR]: 'scenario' }} style={SECTION_STYLE}>
            <ScenarioSection data={data} />
          </div>
          <div {...{ [PDF_SECTION_ATTR]: 'projection' }} style={SECTION_STYLE}>
            <ProjectionSection data={data} />
          </div>
          <div {...{ [PDF_SECTION_ATTR]: 'interpretation' }} style={SECTION_STYLE}>
            <InterpretationSection data={data} />
          </div>
        </>
      )}
    </div>
  );
}

export type { ReportData };
