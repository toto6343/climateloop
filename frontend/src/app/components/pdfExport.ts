/**
 * 숨겨진 PdfReport 를 섹션 단위로 캡처해 A4 PDF 로 조립한다.
 *
 * 예전에는 백엔드(fpdf2)가 텍스트만 찍어 내려주었다. 차트를 실을 방법이 없었고
 * (recharts 는 브라우저에서만 그려진다), 대부분의 줄을 fpdf 의 cell() 로 쓰고 있어
 * 한 줄을 넘는 문장은 줄바꿈 없이 잘렸다. 지금은 브라우저에서 만든다 — 화면에 이미
 * 있는 차트 라이브러리와 글꼴을 그대로 쓸 수 있고, 줄바꿈은 브라우저의 몫이 된다.
 *
 * 화면을 그대로 캡처하지는 않는다. PdfReport 가 A4 폭에 맞춰 따로 조판한 마크업을
 * 캡처한다 — 그 이유는 PdfReport.tsx 의 주석에 적었다.
 */

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  PDF_CONTENT_H_MM,
  PDF_CONTENT_MM,
  PDF_PAGE_MM,
  PDF_ROOT_ID,
  PDF_SECTION_ATTR,
} from './PdfReport';

/** 캡처 배율. 2 면 A4 180mm 폭이 1360px 로 떠져 인쇄에서 글자가 뭉개지지 않는다. */
const CAPTURE_SCALE = 2;

/**
 * 차트가 그려질 시간을 주는 대기.
 *
 * PdfReport 의 차트는 크기를 못으로 박고 애니메이션을 껐으므로 첫 렌더에 완성된
 * SVG 가 나온다. 그래도 대기를 두는 이유는 두 가지다 — (1) React 가 방금 바꾼
 * overflow/height 를 브라우저가 실제로 레이아웃에 반영할 틈, (2) 글꼴이 아직
 * 내려오는 중이면 캡처가 대체 글꼴로 떠지는 것을 막는 틈.
 *
 * rAF 두 번으로 레이아웃 반영을 기다리고, document.fonts.ready 로 글꼴을 기다린
 * 다음, 그래도 남는 여유로 SETTLE_MS 를 더 준다.
 */
const SETTLE_MS = 600;

async function waitForRender(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  // fonts API 가 없는 환경(구형 브라우저)에서는 조용히 건너뛴다.
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    } catch {
      // 글꼴 로딩 실패는 캡처를 막을 이유가 아니다. 대체 글꼴로 진행한다.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

/**
 * mm 단위의 A4 문서. 좌표 계산을 한 곳에 모아 두면 페이지 넘김 규칙이 흩어지지 않는다.
 */
class A4Doc {
  readonly doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  /** 다음 그림을 얹을 y 좌표(mm). 페이지 상단 여백에서 시작한다. */
  private cursor = PDF_PAGE_MM.margin;
  private isFirstPage = true;

  /** 남은 높이(mm). */
  private get remaining(): number {
    return PDF_PAGE_MM.margin + PDF_CONTENT_H_MM - this.cursor;
  }

  /**
   * 높이 비교에 주는 여유(mm).
   *
   * 캡처된 캔버스의 높이는 정수 픽셀이다. 180mm 를 680px 로 그리므로 1px ≈ 0.26mm,
   * 즉 "본문 높이에 꼭 맞게" 만든 섹션도 반올림 때문에 0.3mm 쯤 넘칠 수 있다. 그
   * 0.3mm 를 넘침으로 판정하면 표지가 쪼개져 1px 짜리 조각이 다음 장으로 넘어간다
   * (실제로 그렇게 빈 장이 하나 생겼다). 픽셀 반올림보다 큰 여유를 준다.
   */
  private static readonly EPS_MM = 1;

  newPage() {
    // 첫 장은 jsPDF 가 이미 만들어 두었다. 여기서 또 부르면 빈 장이 하나 생긴다.
    if (this.isFirstPage) {
      this.isFirstPage = false;
    } else {
      this.doc.addPage();
    }
    this.cursor = PDF_PAGE_MM.margin;
  }

  /**
   * 캔버스 하나를 본문 폭에 맞춰 얹는다.
   *
   * 섹션은 통째로 한 장에 들어가는 것을 원칙으로 한다 — 남은 높이에 안 들어가면
   * 다음 장으로 넘긴다. 한 장보다 큰 섹션(글이 아주 길어진 결과 해석 등)은 넘길
   * 곳이 없으므로 본문 높이 단위로 잘라 여러 장에 이어 붙인다.
   */
  place(canvas: HTMLCanvasElement, opts: { startOnNewPage?: boolean } = {}) {
    const heightMm = (canvas.height / canvas.width) * PDF_CONTENT_MM;

    if (opts.startOnNewPage || this.isFirstPage) {
      this.newPage();
    }

    if (heightMm <= PDF_CONTENT_H_MM + A4Doc.EPS_MM) {
      // 한 장에 들어가는 섹션. 이 장에 자리가 없으면 다음 장부터.
      if (heightMm > this.remaining + A4Doc.EPS_MM) this.newPage();
      // 여유(EPS) 안쪽의 넘침은 여기서 흡수한다 — 그림을 0.3mm 줄여 얹으면
      // 하단 여백을 침범하지 않고, 그 정도 축소는 눈에 보이지 않는다.
      const drawH = Math.min(heightMm, PDF_CONTENT_H_MM);
      this.doc.addImage(
        canvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        PDF_PAGE_MM.margin,
        this.cursor,
        PDF_CONTENT_MM,
        drawH,
      );
      // 섹션 사이 간격. 다음 섹션이 바로 붙어 한 덩어리로 읽히지 않게 띄운다.
      this.cursor += drawH + 10;
      return;
    }

    // 본문 높이를 넘는 섹션 — 원본 캔버스를 픽셀로 잘라 장마다 나눠 싣는다.
    const pxPerMm = canvas.width / PDF_CONTENT_MM;
    const sliceH = Math.floor(PDF_CONTENT_H_MM * pxPerMm);
    let offset = 0;
    while (offset < canvas.height) {
      const h = Math.min(sliceH, canvas.height - offset);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      const ctx = slice.getContext('2d');
      if (!ctx) throw new Error('2d 컨텍스트를 만들 수 없어 섹션을 나눌 수 없습니다.');
      // 잘린 조각의 여백이 검게 차지 않도록 흰 바탕을 먼저 깐다.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, offset, canvas.width, h, 0, 0, canvas.width, h);

      if (offset > 0) this.newPage();
      this.doc.addImage(
        slice.toDataURL('image/jpeg', 0.92),
        'JPEG',
        PDF_PAGE_MM.margin,
        this.cursor,
        PDF_CONTENT_MM,
        (h / canvas.width) * PDF_CONTENT_MM,
      );
      this.cursor += (h / canvas.width) * PDF_CONTENT_MM + 10;
      offset += h;
    }
  }

  /**
   * 모든 장의 하단에 페이지 번호와 워터마크를 넣는다.
   *
   * 캡처한 그림이 아니라 jsPDF 의 텍스트로 그린다 — 전체 장 수는 마지막 섹션을
   * 얹고 나서야 알 수 있으므로 그림에 미리 넣을 수가 없고, 벡터 글자라 확대해도
   * 또렷하다. 글자를 ASCII 로만 쓰는 이유는 jsPDF 내장 글꼴(Helvetica)에 한글
   * 글리프가 없기 때문이다. 한글 TTF 를 함께 싣는 방법도 있지만, 4MB 짜리 글꼴을
   * 페이지 번호 한 줄 때문에 번들에 넣을 일은 아니다.
   */
  stampFooters() {
    const total = this.doc.getNumberOfPages();
    for (let page = 1; page <= total; page += 1) {
      this.doc.setPage(page);
      const y = PDF_PAGE_MM.height - PDF_PAGE_MM.margin + 7;

      this.doc.setDrawColor(203, 213, 225);
      this.doc.setLineWidth(0.2);
      this.doc.line(
        PDF_PAGE_MM.margin,
        y - 4,
        PDF_PAGE_MM.width - PDF_PAGE_MM.margin,
        y - 4,
      );

      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8);
      this.doc.setTextColor(148, 163, 184);
      this.doc.text('ClimateLoop  ·  Simulation Report', PDF_PAGE_MM.margin, y);
      this.doc.text(
        `${page} / ${total}`,
        PDF_PAGE_MM.width - PDF_PAGE_MM.margin,
        y,
        { align: 'right' },
      );
    }
  }

  save(filename: string) {
    this.doc.save(filename);
  }
}

/**
 * 숨겨진 리포트를 캡처해 PDF 를 내려준다.
 *
 * 호출부는 PdfReport 에 데이터를 이미 넘겨 렌더가 끝난 뒤에 불러야 한다 — 이 함수는
 * DOM 을 읽을 뿐 React 상태를 기다리지 않는다.
 */
export async function exportReportPdf(filename = 'climateloop_report.pdf'): Promise<void> {
  const root = document.getElementById(PDF_ROOT_ID);
  if (!root) throw new Error('PDF 리포트 요소를 찾을 수 없습니다.');

  const sections = Array.from(
    root.querySelectorAll<HTMLElement>(`[${PDF_SECTION_ATTR}]`),
  );
  if (sections.length === 0) {
    throw new Error('PDF 리포트에 실을 내용이 아직 없습니다. 계산이 끝난 뒤 다시 시도해 주세요.');
  }

  /*
    리포트는 평소 height:0 + overflow:hidden 으로 접혀 있다(페이지 스크롤 높이를
    늘리지 않으려고). html2canvas 는 요소의 실제 크기를 재서 캔버스를 만들므로,
    캡처하는 동안만 펼쳐 준다. finally 에서 반드시 되돌린다 — 예외가 나도 접힌
    상태로 돌아가야 화면이 멀쩡하다.
  */
  const prevHeight = root.style.height;
  const prevOverflow = root.style.overflow;
  root.style.height = 'auto';
  root.style.overflow = 'visible';

  try {
    await waitForRender();

    const pdf = new A4Doc();
    for (const section of sections) {
      const canvas = await html2canvas(section, {
        scale: CAPTURE_SCALE,
        backgroundColor: '#ffffff',
        // 화면 밖(left:-9999px)에 있는 요소라 기본값(현재 스크롤 위치)으로는
        // 캡처 영역이 어긋난다. 창 좌상단을 원점으로 고정한다.
        scrollX: 0,
        scrollY: 0,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        // 캡처용 클론에는 화면 밖으로 밀어내는 좌표가 필요 없다. 원점으로 되돌려
        // 두면 html2canvas 가 좌표를 다시 계산하다 잘라내는 일이 없다.
        onclone: (clonedDoc) => {
          const clonedRoot = clonedDoc.getElementById(PDF_ROOT_ID);
          if (clonedRoot instanceof HTMLElement) {
            clonedRoot.style.left = '0px';
            clonedRoot.style.position = 'static';
            clonedRoot.style.height = 'auto';
            clonedRoot.style.overflow = 'visible';
          }
        },
      });

      // 표지는 늘 1면. 나머지는 남은 자리를 보고 흐른다.
      pdf.place(canvas, {
        startOnNewPage: section.getAttribute(PDF_SECTION_ATTR) === 'cover',
      });
    }

    pdf.stampFooters();
    pdf.save(filename);
  } finally {
    root.style.height = prevHeight;
    root.style.overflow = prevOverflow;
  }
}
