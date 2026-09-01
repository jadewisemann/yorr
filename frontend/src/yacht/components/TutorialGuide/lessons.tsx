import type { Lesson, LessonContext } from '@/yacht/components/TutorialGuide/types'
import { categoryLabel } from '@/yacht/domain/yachtCategoryView'
import { TUTORIAL_RECORD_CATEGORY } from '@/yacht/model/useSpotlight'
import { openHandLessons } from './openHandLessons'
import type { GuideStep } from './types'

function keepLesson(ctx: LessonContext, again: boolean): Lesson {
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

function recordLesson(ctx: LessonContext): Lesson {
  const pokerScore = ctx.candidates[TUTORIAL_RECORD_CATEGORY] ?? 0
  const where = ctx.wide ? '표시된 포커 행' : '아래 기록 패널에서 표시된 포커'
  return {
    title: `6이 ${ctx.sixes}개 — 이건 포커예요!`,
    body: `같은 눈이 4개 모이면 포커라고 불러요. 다섯 개를 다 더해 ${pokerScore}점이라, 식스에 적는 ${ctx.sixesScore}점보다 높아요. ${where}을 눌러 기록해 보세요.`,
  }
}

function handLesson(ctx: LessonContext): Lesson {
  const lessons = openHandLessons(ctx.candidates)
  const hand = lessons[ctx.handIndex]
  if (!hand) return doneLesson()

  const category = hand.category
  return {
    title: category === undefined ? (hand.name ?? '') : categoryLabel[category],
    body: hand.rule,
    hand: {
      ...(category === undefined ? {} : { category, score: ctx.candidates[category] }),
      index: ctx.handIndex,
      total: lessons.length,
    },
    action: ctx.handIndex >= lessons.length - 1 ? '다 봤어요' : '다음',
  }
}

function doneLesson(): Lesson {
  return {
    title: '한 턴을 다 하셨어요!',
    body: '이걸 12번 반복하면 게임이 끝나고, 총점이 가장 높은 사람이 이겨요. 이제 실전에서 만나요.',
    action: '연습 끝내기',
  }
}

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
