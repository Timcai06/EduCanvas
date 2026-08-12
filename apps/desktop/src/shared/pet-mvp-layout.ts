export const MVP_CHAT_WIDTH = 300;
export const MVP_CHAT_HEIGHT = 224;
export const MVP_PET_SIZE = 176;
// idle.png 29 帧 alpha 联合边界：源图 (79, 76)–(417, 449)，按 176px 显示尺寸向外取整。
export const MVP_PET_VISIBLE_X = 27;
export const MVP_PET_VISIBLE_Y = 26;
export const MVP_PET_VISIBLE_WIDTH = 123;
export const MVP_PET_VISIBLE_HEIGHT = 133;
export const MVP_PADDING = 8;
export const MVP_GAP = 8;
export const MVP_WINDOW_WIDTH = 500;
export const MVP_WINDOW_HEIGHT = 240;
export const MVP_CHAT_EXPAND_WIDTH = 30;
export const MVP_CHAT_EXPAND_HEIGHT = 38;
export const MVP_CHAT_EXPAND_X = MVP_PADDING + MVP_CHAT_WIDTH + MVP_GAP + 9;
export const MVP_CHAT_EXPAND_Y_IN_PET = 70;

export function petVisibleRect(windowHeight: number) {
  return {
    x: MVP_PADDING + MVP_CHAT_WIDTH + MVP_GAP + MVP_PET_VISIBLE_X,
    y: windowHeight - MVP_PADDING - MVP_PET_SIZE + MVP_PET_VISIBLE_Y,
    width: MVP_PET_VISIBLE_WIDTH,
    height: MVP_PET_VISIBLE_HEIGHT,
  };
}

export function chatExpandRect(windowHeight: number) {
  return {
    x: MVP_CHAT_EXPAND_X,
    y: windowHeight - MVP_PADDING - MVP_PET_SIZE + MVP_CHAT_EXPAND_Y_IN_PET,
    width: MVP_CHAT_EXPAND_WIDTH,
    height: MVP_CHAT_EXPAND_HEIGHT,
  };
}
