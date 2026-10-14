// Shift code rules: how each code in the schedule maps to its 班別, filter category and hours.
export const SHIFT_TYPES = {
    '1': 'NT-1', M1: 'NT-M1', '2': 'NT-2', M2: 'NT-M2', '3': 'NT-3',
    '早': 'NT-早', 'T早': 'NT-T早', '中': 'NT-中', 'T中': 'NT-T中',
    '晚': 'NT-晚', '日': 'NT-日', '小夜': 'NT-小夜', '大夜': 'NT-大夜',
    N: 'NT-正', N8: 'E001', X: '例假日', Y: '休息日', Z: '國定假日', S: 'NT-S', T: 'NT-T'
};
export const TIME_ALIASES = { 'T早': '早', 'T中': '中', M1: '1', '大夜': '3', '小夜': '2', '日': '1' };
// On-duty hours of these codes (they take priority over the NNOC班別 sheet) and the hours actually worked: the extra hours are support, not duty.
export const DUTY_TIMES = { M1: ['08:00', '16:00'], 'T早': ['08:00', '16:00'], M2: ['16:00', '24:00'], 'T中': ['16:00', '24:00'] };
export const FULL_TIMES = { M1: ['08:00', '19:00'], 'T早': ['08:00', '19:00'], M2: ['13:00', '24:00'], 'T中': ['13:00', '24:00'] };
// Same duty hours as the base code, so they are rostered and counted as colleagues together.
export const ROSTER_GROUPS = { M1: '1', 'T早': '早', M2: '2', 'T中': '中' };
export const REST_CODES = new Set(['X', 'Y', 'Z', 'S', 'T']);
export const COLORS = {
    '1': 'morning', M1: 'morning', '早': 'morning', 'T早': 'morning', '日': 'morning',
    '2': 'afternoon', M2: 'afternoon', '中': 'afternoon', 'T中': 'afternoon', '小夜': 'afternoon',
    '3': 'night', '晚': 'night', '大夜': 'night'
};
export const GROUP_LABELS = { '1': 'Mobile 早班', '早': 'TX 早班', '中': 'TX 中班' };
