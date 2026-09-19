'use strict';

// 样式会话的唯一接入点。尚未实现时必须保持 available=false，禁止假报插入成功。
// render({ job, resolve, project, timeline }) 应创建专用新视频轨道，不覆盖现有剪辑。
// 返回 { insertedCount: 正整数, message?: string }，失败应抛错并说明是否存在部分写入。
module.exports = {
  available: false,
  reason: 'Apple Music 样式模块尚未接入；当前可导出对接 JSON 或普通 SRT。',
  async render() { throw new Error('歌词渲染适配器尚未接入'); },
};
