// lib/view.js — 把查询结果映射成 dsh-go 原生视图
//
// 面板用 view v2（表单、样式），工具卡用 v1 基础组件。
// 视图里只有绑定（{ "$": "data.x" }），数字和文案都由 index.js 推来的数据决定。

const pad2 = (n) => String(n).padStart(2, '0')

/** ¥12.34 */
function money(n) {
  const v = Number(n)
  return `¥${Number.isFinite(v) ? v.toFixed(2) : '0.00'}`
}

/** 账单里的 Usage 单位是千 tokens，展示成真实 token 数 */
function tokenText(thousand) {
  const n = Number(thousand) * 1000
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function clockText(iso) {
  const d = new Date(iso || Date.now())
  if (!Number.isFinite(d.getTime())) return '—'
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function dateText(iso) {
  const s = String(iso || '')
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '—'
}

const ZH = {
  title: '阿里云额度',
  quota: '额度与券',
  usage: '花费与模型',
  settings: '密钥设置',
  updated: (t) => `更新于 ${t}`,
  waiting: '正在查询…',
  refreshing: '正在刷新',
  refreshed: '已刷新',
  verifying: '正在验证',
  stripOff: '阿里云 未配置',
  stripUnknown: '阿里云 查询中',
  stripPrefix: '阿里云',
  notConfigured: '尚未配置 AccessKey，点「密钥设置」填写',
  failed: (m) => `查询失败：${m}`,
  usable: '合计可用',
  cash: '现金余额',
  coupon: '代金券',
  availableCash: '可用现金',
  credit: '信控额度',
  couponUsed: '券已用 / 面额',
  activeCoupons: '有效券',
  nextExpiry: '最近到期',
  none: '无',
  days: (n) => `${n} 天后`,
  couponList: '代金券明细',
  couponCol: '代金券',
  leftCol: '剩余',
  expiryCol: '到期',
  monthSpend: '本月已花',
  todaySpend: '今日花费',
  monthTokens: '本月 token',
  couponDeduct: '券抵扣',
  cashPaid: '现金实付',
  input: '输入',
  cache: '缓存',
  output: '输出',
  hitRate: '缓存命中率',
  cycle: '账期',
  monthTrend: '近几个月消费',
  monthTrendCaption: '按账期汇总，单位元',
  tokenSplit: '本月 token 构成',
  tokenSplitCaption: '单位：千 tokens',
  daily: '本月逐日消费',
  dailyCaption: '单位元',
  byModel: '按模型',
  byProduct: '按产品',
  modelCol: '模型',
  costCol: '费用',
  tokenCol: 'tokens',
  productCol: '产品',
  refresh: '刷新',
  toUsage: '花费明细',
  toQuota: '额度与券',
  toSettings: '密钥设置',
  settingsHint: '建议用 RAM 子账号，只授予 AliyunBSSReadOnlyAccess。密钥只存在本机文件，不会上传。',
  akLabel: 'AccessKey ID',
  skLabel: 'AccessKey Secret',
  akPlaceholder: 'LTAI 开头的 24 位 ID',
  skPlaceholder: '粘贴 30 位 Secret',
  save: '保存并验证',
  verifyHint: '保存前会真的调用一次接口验证，验证不过不保存。',
  clear: '清除密钥',
  cancel: '取消',
  cleared: '已清除密钥',
  statusNotConfigured: '尚未配置 AccessKey',
  statusConfigured: (masked, src) => `已配置 ${masked}（${src}）`,
  srcFile: '文件',
  srcEnv: '环境变量',
  path: (p) => `配置文件：${p}`,
  saved: '已保存并验证',
  verifyFail: (m) => `验证失败：${m}`,
  fillBoth: '请填写 ID 和 Secret',
}

const EN = {
  title: 'Aliyun quota',
  quota: 'Balance & coupons',
  usage: 'Spend & models',
  settings: 'Access key',
  updated: (t) => `Updated ${t}`,
  waiting: 'Loading…',
  refreshing: 'Refreshing',
  refreshed: 'Refreshed',
  verifying: 'Verifying',
  stripOff: 'Aliyun: no key',
  stripUnknown: 'Aliyun: loading',
  stripPrefix: 'Aliyun',
  notConfigured: 'No AccessKey yet — open “Access key”',
  failed: (m) => `Query failed: ${m}`,
  usable: 'Usable',
  cash: 'Cash balance',
  coupon: 'Coupons',
  availableCash: 'Available cash',
  credit: 'Credit',
  couponUsed: 'Coupon used / face',
  activeCoupons: 'Active coupons',
  nextExpiry: 'Next expiry',
  none: 'None',
  days: (n) => `in ${n} d`,
  couponList: 'Coupons',
  couponCol: 'Coupon',
  leftCol: 'Left',
  expiryCol: 'Expiry',
  monthSpend: 'This month',
  todaySpend: 'Today',
  monthTokens: 'Tokens this month',
  couponDeduct: 'Coupon covered',
  cashPaid: 'Cash paid',
  input: 'Input',
  cache: 'Cached',
  output: 'Output',
  hitRate: 'Cache hit',
  cycle: 'Cycle',
  monthTrend: 'Monthly spend',
  monthTrendCaption: 'Billing cycles, CNY',
  tokenSplit: 'Token split',
  tokenSplitCaption: 'Thousand tokens',
  daily: 'Daily spend',
  dailyCaption: 'CNY',
  byModel: 'By model',
  byProduct: 'By product',
  modelCol: 'Model',
  costCol: 'Cost',
  tokenCol: 'Tokens',
  productCol: 'Product',
  refresh: 'Refresh',
  toUsage: 'Spend',
  toQuota: 'Balance',
  toSettings: 'Access key',
  settingsHint: 'Use a RAM user with AliyunBSSReadOnlyAccess. The key stays in a local file and is never uploaded.',
  akLabel: 'AccessKey ID',
  skLabel: 'AccessKey Secret',
  akPlaceholder: '24-char ID starting with LTAI',
  skPlaceholder: 'Paste the 30-char secret',
  save: 'Save & verify',
  verifyHint: 'The key is verified with a real API call before it is saved.',
  clear: 'Clear key',
  cancel: 'Cancel',
  cleared: 'Key cleared',
  statusNotConfigured: 'No AccessKey configured',
  statusConfigured: (masked, src) => `Configured ${masked} (${src})`,
  srcFile: 'file',
  srcEnv: 'env',
  path: (p) => `Config file: ${p}`,
  saved: 'Saved and verified',
  verifyFail: (m) => `Verify failed: ${m}`,
  fillBoth: 'Fill in both ID and Secret',
}

/** 输入框上方的状态条文案（≤ 24 字） */
export function stripText(usable, configured, locale) {
  const w = words(locale)
  if (!configured) return w.stripOff
  if (usable === null || usable === undefined) return w.stripUnknown
  return `${w.stripPrefix} ${money(usable)}`
}

export function words(locale) {
  return String(locale || '').toLowerCase().startsWith('en') ? EN : ZH
}

/** 额度面板的数据模型 */
export function quotaData(q, locale) {
  const w = words(locale)
  const base = {
    status: w.waiting,
    usable: '—',
    cash: '—',
    coupon: '—',
    availableCash: '—',
    credit: '—',
    couponUsed: '—',
    activeCoupons: '—',
    nextExpiry: '—',
    couponRows: [],
    warn: '',
  }
  if (!q) return base
  const s = q.summary || {}
  return {
    ...base,
    status: w.updated(clockText(q.fetchedAt)),
    usable: money(s.usable),
    cash: money(q.balance?.available),
    coupon: money(s.totalBalance),
    availableCash: money(q.balance?.cash),
    credit: money(q.balance?.credit),
    couponUsed: `${money(s.used)} / ${money(s.totalNominal)}`,
    activeCoupons: `${s.activeCount ?? 0} / ${s.couponCount ?? 0}`,
    nextExpiry: s.nextExpiry ? `${dateText(s.nextExpiry)}（${w.days(s.nextExpiryDays ?? 0)}）` : w.none,
    couponRows: (q.coupons || []).slice(0, 12).map((c) => [c.name, money(c.balance), c.expiry ? dateText(c.expiry) : '—']),
    warn: (q.warnings || []).join('；'),
  }
}

/** 花费面板的数据模型 */
export function usageData(u, locale) {
  const w = words(locale)
  const base = {
    status: w.waiting,
    monthSpend: '—',
    todaySpend: '—',
    monthTokens: '—',
    couponDeduct: '—',
    cashPaid: '—',
    input: '—',
    cache: '—',
    output: '—',
    hitRate: '—',
    cycle: '—',
    months: { labels: [], values: [] },
    tokens: { labels: [w.input, w.cache, w.output], values: [] },
    days: { labels: [], values: [] },
    modelRows: [],
    productRows: [],
    warn: '',
  }
  if (!u) return base
  const m = u.monthStat || {}
  const t = u.todayStat || {}
  const models = u.models || []
  const sum = (key) => models.reduce((s, x) => s + (Number(x[key]) || 0), 0)
  const inputTh = sum('inputThousand')
  const cacheTh = sum('cacheThousand')
  const outTh = sum('outputThousand')
  const hit = inputTh + cacheTh > 0 ? cacheTh / (inputTh + cacheTh) : 0
  const months = (u.months || []).slice().reverse()
  const days = u.days || []
  return {
    ...base,
    status: w.updated(clockText(u.fetchedAt)),
    monthSpend: money(m.amount),
    todaySpend: money(t.amount),
    monthTokens: tokenText(m.thousandTokens),
    couponDeduct: money(m.coupon),
    cashPaid: money(m.cash),
    input: tokenText(inputTh),
    cache: tokenText(cacheTh),
    output: tokenText(outTh),
    hitRate: `${(hit * 100).toFixed(1)}%`,
    cycle: String(u.cycle || '—'),
    months: {
      labels: months.map((x) => `${Number(String(x.cycle).slice(5))}月`),
      values: months.map((x) => Number((Number(x.amount) || 0).toFixed(2))),
    },
    tokens: { labels: [w.input, w.cache, w.output], values: [inputTh, cacheTh, outTh] },
    days: {
      labels: days.map((d) => String(Number(String(d.date).slice(8)))),
      values: days.map((d) => Number((Number(d.amount) || 0).toFixed(2))),
    },
    modelRows: models.slice(0, 8).map((x) => [String(x.model), money(x.amount), tokenText(x.totalThousand)]),
    productRows: (u.products || []).slice(0, 6).map((p) => [String(p.name), money(p.amount)]),
    warn: (u.warnings || []).join('；'),
  }
}

/** 密钥设置面板的数据模型（不包含密钥本身） */
export function settingsData(state, locale) {
  const w = words(locale)
  return {
    status: state.configured
      ? w.statusConfigured(state.masked || '', state.source === 'env' ? w.srcEnv : w.srcFile)
      : w.statusNotConfigured,
    form: { ak: '', sk: '' },
    path: w.path(state.path || ''),
  }
}

/** 工具卡只吃这些字段：别把整份账单塞进会话 */
export function compactQuota(q) {
  if (!q) return null
  return {
    fetchedAt: q.fetchedAt,
    balance: q.balance || null,
    summary: q.summary || null,
    coupons: (q.coupons || []).slice(0, 8),
    warnings: q.warnings || [],
  }
}

export function compactUsage(u) {
  if (!u) return null
  return {
    fetchedAt: u.fetchedAt,
    cycle: u.cycle,
    monthStat: u.monthStat,
    todayStat: u.todayStat,
    months: (u.months || []).map((m) => ({ cycle: m.cycle, amount: m.amount })),
    days: (u.days || []).map((d) => ({ date: d.date, amount: d.amount })),
    models: (u.models || []).slice(0, 8).map((m) => ({
      model: m.model,
      amount: m.amount,
      totalThousand: m.totalThousand,
      inputThousand: m.inputThousand,
      cacheThousand: m.cacheThousand,
      outputThousand: m.outputThousand,
    })),
    products: (u.products || []).slice(0, 6),
    warnings: u.warnings || [],
  }
}

const heading = (size = 'subtitle') => ({ size, weight: 'bold' })
const note = { size: 'caption' }

/** 额度与券面板 */
export function quotaView(caps) {
  const w = words(caps?.locale)
  return {
    v: 2,
    type: 'stack',
    accent: 'app',
    style: { gap: 'M' },
    children: [
      { type: 'text', text: { $: 'data.status' }, tone: 'muted', style: note },
      {
        type: 'row',
        children: [
          { type: 'metric', label: w.usable, value: { $: 'data.usable' }, tone: 'good' },
          { type: 'metric', label: w.cash, value: { $: 'data.cash' } },
          { type: 'metric', label: w.coupon, value: { $: 'data.coupon' } },
        ],
      },
      {
        type: 'keyValue',
        items: [
          [w.availableCash, { $: 'data.availableCash' }],
          [w.credit, { $: 'data.credit' }],
          [w.couponUsed, { $: 'data.couponUsed' }],
          [w.activeCoupons, { $: 'data.activeCoupons' }],
          [w.nextExpiry, { $: 'data.nextExpiry' }],
        ],
      },
      { type: 'text', text: w.couponList, style: heading() },
      {
        type: 'table',
        columns: [w.couponCol, { label: w.leftCol, align: 'end' }, w.expiryCol],
        rows: { $: 'data.couponRows' },
      },
      { type: 'text', text: { $: 'data.warn' }, tone: 'muted', style: note },
      {
        type: 'actions',
        items: [
          { label: w.refresh, action: 'refresh', icon: 'refresh', style: 'primary' },
          { label: w.toUsage, action: 'open-usage', icon: 'chart' },
          { label: w.toSettings, action: 'open-settings', icon: 'settings' },
        ],
      },
    ],
  }
}

/** 花费与模型面板 */
export function usageView(caps) {
  const w = words(caps?.locale)
  return {
    v: 2,
    type: 'stack',
    accent: 'app',
    style: { gap: 'M' },
    children: [
      { type: 'text', text: { $: 'data.status' }, tone: 'muted', style: note },
      {
        type: 'row',
        children: [
          { type: 'metric', label: w.monthSpend, value: { $: 'data.monthSpend' }, tone: 'info' },
          { type: 'metric', label: w.todaySpend, value: { $: 'data.todaySpend' } },
          { type: 'metric', label: w.monthTokens, value: { $: 'data.monthTokens' } },
        ],
      },
      {
        type: 'keyValue',
        items: [
          [w.couponDeduct, { $: 'data.couponDeduct' }],
          [w.cashPaid, { $: 'data.cashPaid' }],
          [w.input, { $: 'data.input' }],
          [w.cache, { $: 'data.cache' }],
          [w.output, { $: 'data.output' }],
          [w.hitRate, { $: 'data.hitRate' }],
          [w.cycle, { $: 'data.cycle' }],
        ],
      },
      {
        type: 'chart',
        kind: 'bar',
        categories: { $: 'data.months.labels' },
        series: [{ name: w.monthTrend, values: { $: 'data.months.values' } }],
        unit: '元',
        caption: w.monthTrendCaption,
      },
      {
        type: 'chart',
        kind: 'donut',
        categories: { $: 'data.tokens.labels' },
        series: [{ values: { $: 'data.tokens.values' } }],
        caption: w.tokenSplitCaption,
      },
      { type: 'text', text: w.byModel, style: heading() },
      {
        type: 'table',
        columns: [w.modelCol, { label: w.costCol, align: 'end' }, { label: w.tokenCol, align: 'end' }],
        rows: { $: 'data.modelRows' },
      },
      { type: 'text', text: w.byProduct, style: heading() },
      {
        type: 'table',
        columns: [w.productCol, { label: w.costCol, align: 'end' }],
        rows: { $: 'data.productRows' },
      },
      { type: 'text', text: w.daily, style: heading() },
      {
        type: 'chart',
        kind: 'bar',
        categories: { $: 'data.days.labels' },
        series: [{ values: { $: 'data.days.values' } }],
        unit: '元',
        caption: w.dailyCaption,
      },
      { type: 'text', text: { $: 'data.warn' }, tone: 'muted', style: note },
      {
        type: 'actions',
        items: [
          { label: w.refresh, action: 'refresh', icon: 'refresh', style: 'primary' },
          { label: w.toQuota, action: 'open-quota', icon: 'wallet' },
          { label: w.toSettings, action: 'open-settings', icon: 'settings' },
        ],
      },
    ],
  }
}

/** 密钥设置面板 */
export function settingsView(caps) {
  const w = words(caps?.locale)
  return {
    v: 2,
    type: 'stack',
    accent: 'app',
    style: { gap: 'M' },
    children: [
      { type: 'text', text: { $: 'data.status' } },
      { type: 'callout', text: w.settingsHint, tone: 'info' },
      {
        type: 'form',
        submit: 'save',
        submitLabel: w.save,
        children: [
          {
            type: 'textField',
            label: w.akLabel,
            bind: 'data.form.ak',
            placeholder: w.akPlaceholder,
            required: true,
            minLength: 16,
            maxLength: 64,
          },
          {
            type: 'textField',
            label: w.skLabel,
            bind: 'data.form.sk',
            placeholder: w.skPlaceholder,
            required: true,
            minLength: 20,
            maxLength: 80,
          },
        ],
      },
      { type: 'text', text: w.verifyHint, tone: 'muted', style: note },
      { type: 'confirm', id: 'clear', confirmLabel: w.clear, cancelLabel: w.cancel },
      { type: 'text', text: { $: 'data.path' }, tone: 'muted', style: note },
      {
        type: 'actions',
        items: [
          { label: w.toQuota, action: 'open-quota', icon: 'wallet' },
          { label: w.toUsage, action: 'open-usage', icon: 'chart' },
        ],
      },
    ],
  }
}

/** 工具卡：额度（v1 基础组件，无绑定） */
export function quotaCard(q, locale) {
  const w = words(locale)
  const d = quotaData(q, locale)
  return {
    type: 'stack',
    title: w.title,
    children: [
      { type: 'text', text: d.status, tone: 'muted' },
      {
        type: 'row',
        children: [
          { type: 'metric', label: w.usable, value: d.usable, tone: 'good' },
          { type: 'metric', label: w.cash, value: d.cash },
          { type: 'metric', label: w.coupon, value: d.coupon },
        ],
      },
      {
        type: 'keyValue',
        items: [
          [w.availableCash, d.availableCash],
          [w.couponUsed, d.couponUsed],
          [w.nextExpiry, d.nextExpiry],
        ],
      },
      {
        type: 'list',
        items: (q.coupons || []).slice(0, 5).map((c) => ({
          title: String(c.name),
          trailing: money(c.balance),
        })),
      },
    ],
  }
}

/** 工具卡：花费（v1 基础组件，无绑定） */
export function usageCard(u, locale) {
  const w = words(locale)
  const d = usageData(u, locale)
  return {
    type: 'stack',
    title: w.usage,
    children: [
      { type: 'text', text: d.status, tone: 'muted' },
      {
        type: 'row',
        children: [
          { type: 'metric', label: w.monthSpend, value: d.monthSpend, tone: 'info' },
          { type: 'metric', label: w.todaySpend, value: d.todaySpend },
          { type: 'metric', label: w.monthTokens, value: d.monthTokens },
        ],
      },
      {
        type: 'chart',
        kind: 'bar',
        categories: d.months.labels,
        series: [{ name: w.monthTrend, values: d.months.values }],
        unit: '元',
      },
      {
        type: 'table',
        columns: [w.modelCol, w.costCol],
        rows: d.modelRows.slice(0, 5).map((r) => [r[0], r[1]]),
      },
    ],
  }
}