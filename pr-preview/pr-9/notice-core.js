export const noticeLabels={message:'你有一条新留言',goal:'今天还有一个打卡目标',todo:'有一项待办到期了',anniversary:'今天是一个值得记住的日子',pocket:'今天的存款记录还未完成',withdraw:'取出冷静期已结束，请再次确认',listen:'朋友邀请你一起听歌'};
export const noticePanels={goal:'checkinSpace',todo:'todoSpace',anniversary:'relationshipScrim',pocket:'pocketSpace',withdraw:'pocketSpace',listen:'listenScrim'};
export function notificationLabel(kind){return noticeLabels[kind]||noticeLabels.message;}
