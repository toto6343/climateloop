'use client';

import React from 'react';
import { CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import { QuizQuestion } from './energyQuiz';

/*
  발전원별로 파스텔 배경을 여섯 가지 깔아 두었다. 문제의 주제를 말하는 라벨일
  뿐인데 색이 여섯 개나 돌아 화면에서 가장 화려한 조각이 됐고, 무엇보다 그 색이
  차트의 발전원 색과 달라 같은 발전원을 두 가지 색으로 가리켰다. 라벨은 값이
  아니므로 색을 뺀다 — 주제는 글자가 말하고, 발전원 색은 차트에만 남긴다.
*/
/**
 * 에너지원 기초 상식 퀴즈 카드.
 *
 * 문제와 선택 상태는 바깥이 관리한다. Wizard 안에서 한 번만 렌더링되며, 부모가
 * 선택 답을 보관하므로 다른 화면 인스턴스와 피드백이 갈라지지 않는다.
 */
export default function EnergyQuizCard({
  question,
  onNext,
  selectedIndex,
  onAnswer,
}: {
  question: QuizQuestion;
  /** "다음 문제" — 문제를 고르는 책임은 바깥에 있다. */
  onNext: () => void;
  selectedIndex: number | null;
  onAnswer: (index: number) => void;
}) {
  const answered = selectedIndex !== null;
  const isCorrect = selectedIndex === question.answer;
  const isOx = question.kind === 'ox';

  return (
    <div className="bg-white p-3 rounded-lg shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">에너지 상식 퀴즈</h3>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 shrink-0">
              {question.topic}
            </span>
          </div>
          {/* 교체 규칙(지역·기후를 바꾸면 새 문제)은 섹션 머리글이 이미 적고 있으므로
              여기서는 문제 형식만 밝힌다. */}
          <p className="text-xs text-slate-600 mt-0.5">{isOx ? 'O / X 문제' : '4지선다 문제'}</p>
        </div>

        <button
          type="button"
          onClick={onNext}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded-lg px-2.5 py-1.5 shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          다음 문제
        </button>
      </div>

      <p className="text-[15px] sm:text-base text-slate-900 leading-relaxed font-medium mt-2.5">
        {question.prompt}
      </p>

      {/*
        O/X 는 두 칸을 크게, 4지선다는 화면 폭에 따라 1 → 2 → 4 칸으로 벌어진다.

        한때 넓은 화면에서도 두 칸으로 묶어 두었다. 선택지 글이 길어질 수 있어(태양광
        원리 문제) 네 칸을 한 줄에 세우면 줄바꿈이 겹친다는 이유였는데, 그것은 카드가
        1152px 컨테이너의 폭을 쓰던 시절 기준이다. 지금 이 카드는 1400px 를 통째로
        쓰므로 네 칸이면 한 칸이 340px 이고, 가장 긴 선택지도 두 줄 안에 들어간다.
        두 칸으로 두면 같은 글이 두 줄(약 90px)을 더 차지할 뿐이다.
      */}
      {/*
        O/X 두 칸에는 max-w 를 씌운다. 이 카드가 폭 전체(1400px)를 쓰게 되면서 O 와 X
        버튼이 각각 700px 이 됐다 — 글자 한 자를 담는 버튼으로는 과하고, 두 개뿐이라
        가로로 벌릴수록 눌러야 할 곳을 눈으로 찾는 거리만 멀어진다.
      */}
      <div className={`grid gap-2 mt-2.5 ${isOx ? 'grid-cols-2 max-w-sm' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}`}>
        {question.choices.map((choice, index) => {
          const isAnswer = index === question.answer;
          const isPicked = index === selectedIndex;

          /*
            답하기 전에는 전부 중립. 답한 뒤에는 정답 칸을 초록으로 보이게 하고,
            틀린 답을 골랐다면 그 칸만 빨강으로 짚는다 — 고른 것만 색칠하면 오답일
            때 "그럼 뭐가 맞나"가 화면에 없다.

            색만으로 말하지 않도록 아이콘도 함께 붙인다(적록 색각 대응).
          */
          let tone = 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50 hover:border-slate-300';
          if (answered) {
            if (isAnswer) tone = 'bg-green-50 border-green-300 text-green-900';
            else if (isPicked) tone = 'bg-red-50 border-red-300 text-red-900';
            else tone = 'bg-white border-slate-200 text-slate-400';
          }

          return (
            <button
              key={choice}
              type="button"
              onClick={() => onAnswer(index)}
              // 한 문제에 한 번만 답한다. 다시 고르게 두면 정답을 본 뒤 눌러 맞힐 수 있다.
              disabled={answered}
              aria-pressed={isPicked}
              className={`flex items-center gap-2 border rounded-lg px-3 transition-colors text-left disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${tone} ${
                isOx ? 'justify-center py-3' : 'py-2.5'
              }`}
            >
              {answered && isAnswer && <CircleCheck className="w-4 h-4 shrink-0 text-green-600" />}
              {answered && isPicked && !isAnswer && (
                <CircleX className="w-4 h-4 shrink-0 text-red-600" />
              )}
              <span
                className={
                  isOx
                    ? 'text-xl font-bold leading-none'
                    : 'text-sm leading-relaxed min-w-0'
                }
              >
                {choice}
              </span>
            </button>
          );
        })}
      </div>

      {/*
        해설은 답한 뒤에만 나온다. 자리를 미리 비워 두지 않는 이유: 빈 칸이 있으면
        카드 높이가 늘 해설 몫만큼 커져, 아직 읽을 것이 없는데도 그만큼을 차지한다.
      */}
      {answered && (
        <div
          role="status"
          className={`flex items-start gap-2.5 mt-2.5 p-2.5 rounded-lg border ${
            isCorrect
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          {isCorrect ? (
            <CircleCheck className="w-4 h-4 shrink-0 mt-0.5 text-green-600" />
          ) : (
            <CircleX className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          )}
          <div className="min-w-0">
            <p
              className={`text-sm font-bold ${isCorrect ? 'text-green-900' : 'text-red-900'}`}
            >
              {isCorrect ? '정답입니다' : '오답입니다'}
              {!isCorrect && (
                <span className="font-medium">
                  {' '}· 정답은 {question.choices[question.answer]}
                </span>
              )}
            </p>
            <p
              className={`text-[13px] leading-relaxed mt-1 ${
                isCorrect ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {question.explanation}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
