import type { Lesson, LessonContext } from '@/yacht/components/TutorialGuide/types'
import { categoryLabel } from '@/yacht/domain/yachtCategoryView'
import { TUTORIAL_RECORD_CATEGORY } from '@/yacht/model/useSpotlight'
import { openHandLessons } from './openHandLessons'
import type { GuideStep } from './types'

/**
 * 각 단계에서 강조할 화면 조각. GamePlay가 붙여 둔 data-tutorial 표지를 찾는다 —
 * 좌표를 여기 적어 두면 레이아웃이 바뀔 때마다 조용히 어긋난다.
 *
 * 족보를 설명하는 동안에는 설명 중인 **그 칸**을 짚는다. 규칙만 읽어 주면 점수표에서 어느
 * 칸인지는 여전히 모르므로, 이름과 자리를 같은 순간에 붙여 준다.
 */
/**
 * 굴림 뒤 "남길 것을 고르는" 단계의 문구. 첫 선택과 두 번째 선택이 같은 판단을 하므로 한
 * 곳에 둔다 — 두 번째는 이 고르기가 매 굴림마다 반복되는 규칙이라는 것을 덧붙인다.
 */
export function keepLesson(ctx: LessonContext, again: boolean): Lesson {
  // 6이 아닌 걸 킵했으면 그것부터 알려 준다 — 초심자는 잘못 눌렀다는 것 자체를 모른다.
  if (ctx.keptOther > 0) {
    return {
      title: '6이 아닌 주사위를 킵했어요',
      body: again
        ? '한 번 더 탭하면 풀려요. 지금은 6만 모아 볼게요.'
        : '한 번 더 탭하면 킵이 풀려요. 지금은 6만 남겨 볼게요 — 같은 눈을 모을수록 점수가 커지거든요.',
    }
  }

  const left = ctx.sixes - ctx.keptSixes
  if (again) {
    return {
      title: `6이 ${ctx.sixes}개로 늘었어요`,
      body: `굴릴 때마다 남길 것을 다시 고르는 게 요트의 한 턴이에요. 새로 나온 6 ${left}개도 탭해서 킵해 보세요.`,
    }
  }
  return {
    title: ctx.keptSixes > 0 ? `좋아요, ${left}개 남았어요` : `6이 ${ctx.sixes}개 나왔어요`,
    body:
      ctx.keptSixes > 0
        ? `나머지 6 ${left}개도 탭해서 킵해 보세요. 6을 전부 모아 두고 나머지만 다시 굴릴 거예요.`
        : '같은 눈을 모으면 점수가 커져요. 6이 그려진 주사위를 모두 탭해서 킵해 보세요 — 킵한 주사위는 다시 굴려도 그대로 남아요.',
  }
}

/**
 * 기록 단계. 대본이 만들어 준 것은 "6이 네 개"인데, 그건 식스(24점)이면서 동시에
 * 포커(26점)다 — 더 높은 쪽이자 이름이 있는 쪽을 짚어 준다. 초심자가 "같은 눈 네 개는
 * 이름이 붙는다"를 처음 알게 되는 자리고, 점수 비교까지 한 문장에 들어간다.
 */
export function recordLesson(ctx: LessonContext): Lesson {
  const pokerScore = ctx.candidates[TUTORIAL_RECORD_CATEGORY] ?? 0
  const where = ctx.wide ? '표시된 포커 행' : '아래 기록 패널에서 표시된 포커'
  return {
    title: `6이 ${ctx.sixes}개 — 이건 포커예요!`,
    body: `같은 눈이 4개 모이면 포커라고 불러요. 다섯 개를 다 더해 ${pokerScore}점이라, 식스에 적는 ${ctx.sixesScore}점보다 높아요. ${where}을 눌러 기록해 보세요.`,
  }
}

/** 족보 한 장. 마지막 장에서만 버튼 문구가 "다 봤어요"로 바뀐다. */
export function handLesson(ctx: LessonContext): Lesson {
  const lessons = openHandLessons(ctx.candidates)
  const hand = lessons[ctx.handIndex]
  // 남은 칸이 없으면(모두 기록된 판) 설명할 것이 없다 — 마무리 문구로 대신한다.
  if (!hand) return doneLesson()

  const category = hand.category
  return {
    title: category === undefined ? (hand.name ?? '') : categoryLabel[category],
    body: hand.rule,
    hand: {
      // 보너스는 짚을 칸이 없다 — 강조도 말풍선도 없이 가운데에서 읽는다.
      ...(category === undefined ? {} : { category, score: ctx.candidates[category] }),
      index: ctx.handIndex,
      total: lessons.length,
    },
    action: ctx.handIndex >= lessons.length - 1 ? '다 봤어요' : '다음',
  }
}

export function doneLesson(): Lesson {
  return {
    title: '한 턴을 다 하셨어요!',
    body: '이걸 12번 반복하면 게임이 끝나고, 총점이 가장 높은 사람이 이겨요. 이제 실전에서 만나요.',
    action: '연습 끝내기',
  }
}

/**
 * 단계별 문구. 주사위 눈이 대본으로 고정돼 있으므로 "6 두 개를 킵하세요"처럼 화면에 실제로
 * 있는 것을 짚어 말할 수 있다 — 무작위였다면 "마음에 드는 걸 고르세요"밖에 못 한다.
 * 그래도 개수는 화면에서 세어 넣는다. 사용자가 안내와 다르게 킵하면 대본과 어긋나는데,
 * 그때 굳이 틀린 숫자를 우길 이유가 없다.
 */
export function lessonFor(step: GuideStep, ctx: LessonContext): Lesson {
  switch (step) {
    case 'greet':
      return {
        title: '요트 다이스가 처음이신가요?',
        body: '주사위 5개를 굴려 족보를 만드는 게임이에요. 여기서는 점수가 남지 않으니 마음껏 눌러 보세요. 한 턴을 처음부터 끝까지 같이 해볼게요.',
        action: '시작하기',
      }
    case 'roll':
      return {
        title: '먼저 주사위를 굴려요',
        body: ctx.wide
          ? '빨갛게 표시된 굴리기 버튼을 눌러 보세요. 스페이스바로도 굴릴 수 있어요. 한 턴에 3번까지예요.'
          : '빨갛게 표시된 굴리기 버튼을 눌러 보세요. 한 턴에 3번까지 굴릴 수 있어요.',
      }
    case 'keep':
      return keepLesson(ctx, false)
    case 'reroll':
      return {
        title: '나머지만 다시 굴려요',
        body: '킵한 6은 그대로 두고 나머지만 다시 굴러가요. 6이 더 붙는지 볼까요? 굴리기를 한 번 더 눌러 보세요.',
      }
    case 'keepAgain':
      return keepLesson(ctx, true)
    case 'askLastRoll':
      // 고르기를 끝낸 직후다. 여기서 곧바로 "센서를 켜라"로 넘어가면 방금 고른 결과를 볼
      // 틈도 없이 다음 지시가 떨어진다 — 한 번 묻고 사용자가 넘길 때 움직인다.
      return ctx.motionNoticeVisible
        ? {
            title: '이제 마지막 한 번이 남았어요',
            body: '한 턴에 세 번까지니까 이번이 마지막이에요. 어떻게 던져 볼까요?',
            action: '흔들어서 던지기',
            secondary: { label: '버튼으로 던지기', step: 'lastRoll' },
          }
        : {
            title: '이제 마지막 한 번이 남았어요',
            body: '한 턴에 세 번까지니까 이번이 마지막이에요. 굴리고 나면 다섯 개가 그대로 확정돼요.',
            action: '던져 볼게요',
          }
    case 'motion':
      return {
        title: '폰을 흔들어서 던져요',
        body: '표시된 "흔들기"를 눌러 센서를 켜고, 실제로 주사위를 굴리듯 폰을 흔들어 보세요.',
        action: '버튼으로 던질게요',
      }
    case 'lastRoll':
      return {
        title: '마지막 한 번 남았어요',
        body: '표시된 굴리기를 눌러 보세요. 굴리고 나면 다섯 개가 그대로 확정돼요.',
      }
    case 'categories':
      return handLesson(ctx)
    case 'record':
      return recordLesson(ctx)
    case 'done':
      return doneLesson()
  }
}
