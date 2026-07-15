import type { TeacherMessage } from './messages';

/**
 * 仅供测试和显式演示使用的确定性话术，不得由正常学习页导入。
 * 真实用户轮次必须经过服务端 ModelGateway 与 TeachingTurnOrchestrator。
 */

let seed = 0;
/** 演示消息 id 只需页面内唯一；不进入任何持久化或事件链路。 */
export function nextMessageId(): string {
  seed += 1;
  return `demo-${seed}`;
}

/** 开场白：问候 + 一个循序渐进的问题 + 主动建议打开演示。 */
export function initialTeacherMessages(): TeacherMessage[] {
  return [
    {
      id: nextMessageId(),
      role: 'teacher',
      text: '你好呀，我是你的 AI 老师。今天我们一起研究一个有趣的问题：计算机是怎么分辨猫和狗的？',
      cite: '课件 · 图像是怎么被认出来的',
    },
    {
      id: nextMessageId(),
      role: 'teacher',
      text: '先想一想：如果给你看一张动物照片，你会先看哪里来判断它是猫还是狗？这个概念用互动演示更容易理解，你可以亲手试一试。',
      suggestsCanvas: true,
    },
  ];
}

interface ReplyContext {
  canvasOpen: boolean;
  /** 学生已发送的消息数，用于确定性轮换默认回复。 */
  replyCount: number;
}

const fallbackReplies = [
  '说得不错！观察动物的外形特征正是分类的第一步。计算机也是这样：先提取特征，再做判断。你还能想到别的特征吗？',
  '这个想法很有意思。我们把它记下来：特征越明显，分类就越容易。要不要在演示里验证一下你的想法？',
  '嗯，让我们一步一步来。先记住今天最重要的一句话：计算机靠「特征」认东西，就像你靠耳朵和胡须认猫。',
] as const;

/**
 * 确定性规则回复：关键词命中优先，未命中按 replyCount 轮换兜底话术。
 * 学生消息在真实链路中是不可信输入；这里同样不解析任何“指令”，只做展示层关键词匹配。
 */
export function replyToStudent(
  studentText: string,
  context: ReplyContext,
): TeacherMessage[] {
  const text = studentText.trim();

  if (/演示|试试|看看|玩|游戏/.test(text) && !context.canvasOpen) {
    return [
      {
        id: nextMessageId(),
        role: 'teacher',
        text: '好，我们打开互动演示。把每个特征分给猫或狗，分完提交，我会告诉你结果。',
        suggestsCanvas: true,
      },
    ];
  }

  if (/题|练习|测验|考/.test(text)) {
    return [
      {
        id: nextMessageId(),
        role: 'teacher',
        text: '想练习太好了！我们先用这个分类小游戏热身，它会由服务端批改，做完我们看结果再决定下一步。',
        suggestsCanvas: !context.canvasOpen,
        outputCard: context.canvasOpen,
      },
    ];
  }

  if (/为什么|怎么|什么|吗/.test(text)) {
    return [
      {
        id: nextMessageId(),
        role: 'teacher',
        text: '好问题！计算机看到的照片其实是一大片数字。它会先从这些数字里找出「特征」——比如耳朵的形状、胡须的长短——再根据特征做出判断。',
        cite: '课件 · 第 3 页',
      },
      {
        id: nextMessageId(),
        role: 'teacher',
        text: '那你觉得，猫和狗身上哪个特征最不一样？',
      },
    ];
  }

  const fallback =
    fallbackReplies[context.replyCount % fallbackReplies.length]!;
  return [{ id: nextMessageId(), role: 'teacher', text: fallback }];
}

/** 学生接受建议打开演示后的老师承接语。 */
export function canvasOpenedMessage(): TeacherMessage {
  return {
    id: nextMessageId(),
    role: 'teacher',
    text: '演示已经打开了。左边随时可以继续问我；分完所有卡片后点「提交分类」。',
    outputCard: true,
  };
}

/** 学生选择继续文字讲解时的老师承接语。 */
export function continueTextMessage(): TeacherMessage {
  return {
    id: nextMessageId(),
    role: 'teacher',
    text: '没问题，我们先用文字讲。猫和狗最容易区分的特征有：瞳孔形状、胡须、吐舌头散热的习惯。想验证的时候随时说「打开演示」。',
    cite: '课件 · 第 3 页',
  };
}

/** 服务端判分返回后的老师反馈；数字来自可信反馈 DTO，不由脚本自行判断对错。 */
export function gradedMessage(
  correct: number,
  attempted: number,
): TeacherMessage {
  const allCorrect = correct === attempted && attempted > 0;
  return {
    id: nextMessageId(),
    role: 'teacher',
    text: allCorrect
      ? `太棒了，${attempted} 项全部分类正确！看来你已经抓住「特征」这个关键了。要不要再来一组更难的？`
      : `这次答对了 ${correct}/${attempted} 项。没关系，我们看看哪里搞混了：再观察一下每个特征更像猫还是狗，调整后可以再提交一次。`,
  };
}
