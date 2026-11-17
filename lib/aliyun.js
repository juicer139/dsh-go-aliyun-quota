// lib/aliyun.js — 阿里云 BSS OpenAPI 客户端（无 SDK，手写 RPC 签名）
//
// 用到的接口：
//   QueryAccountBalance  账户可用额度（现金 + 信控）
//   QueryCashCoupons     代金券列表（大学生 300 元券属于这一类）
//   QueryAccountBill     按账期汇总的实际花费（月度）
//   DescribeInstanceBill 按天 + 按实例（百炼的实例 ID 里带模型名和计费项）的明细
//
// 签名算法：RPC 风格 HMAC-SHA1（Version 2017-12-14）
//   stringToSign = "GET&%2F&" + percentEncode(canonicalizedQueryString)
//   signature    = Base64(HMAC-SHA1(AccessKeySecret + "&", stringToSign))

import { createHmac, randomUUID } from 'node:crypto'

// BSS OpenAPI 的接入点是 aliyuncs.com 域下的 business（business.aliyun.com 解析不到）
const ENDPOINT = 'https://business.aliyuncs.com/'
const VERSION = '2017-12-14'

/** 并发请求数上限：阿里云账单接口吃得住 6 路，再高容易触发限流 */
const CONCURRENCY = 6

/** RFC3986 编码：encodeURIComponent 之后再修正 + * ~ 三个字符 */
function pe(str) {
  return encodeURIComponent(String(str))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

/** 生成带签名的完整 URL */
function signedUrl(action, params, accessKeyId, accessKeySecret) {
  const common = {
    Format: 'JSON',
    Version: VERSION,
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID().replace(/-/g, ''),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Action: action,
  }
  const all = { ...common, ...params }

  const canonical = Object.keys(all)
    .sort()
    .map((k) => `${pe(k)}=${pe(all[k])}`)
    .join('&')

  const stringToSign = `GET&${pe('/')}&${pe(canonical)}`
  const signature = createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64')

  return `${ENDPOINT}?Signature=${pe(signature)}&${canonical}`
}

/** 业务错误里哪些属于「等一会儿再试」 */
function isRetryable(code, message) {
  const t = `${code || ''} ${message || ''}`
  return /Throttling|ServiceUnavailable|InternalError|RequestTimeout|SDKServerError/i.test(t)
}

/** 网络层错误：DNS 冷启动、TLS 抖动、连接重置 */
function isNetworkError(err) {
  if (err.aliyunCode) return false
  return /fetch failed|aborted|abort|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|network|other side closed/i.test(
    String(err.message),
  )
}

/**
 * 调一次接口，返回解析后的 JSON。
 * 重试 3 次：网络抖动 + 阿里云限流都值一次重试，权限/签名类错误立刻抛。
 */
async function call(action, params, ak, sk, timeoutMs = 15000) {
  let lastErr = null

  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const url = signedUrl(action, params, ak, sk)
      const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } })
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`${action} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
      }
      const okCode = !data.Code || data.Code === '200' || data.Code === 'Success' || data.Success === true
      if (!okCode) {
        const msg = data.Message || data.Code
        const err = new Error(`${action} 失败：${msg}`)
        err.aliyunCode = data.Code
        if (isRetryable(data.Code, data.Message) && attempt < 2) {
          lastErr = err
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)))
          continue
        }
        throw err
      }
      return data
    } catch (err) {
      lastErr = err
      if (!isNetworkError(err) || attempt === 2) throw err
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

/** 数字容错：'300.00' / 300 / null → number */
function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 从各种可能字段名里捞一个值 */
function pick(obj, keys, fallback = undefined) {
  if (!obj || typeof obj !== 'object') return fallback
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return fallback
}

/** 阿里云同一个字段有时给数组、有时给单对象、有时给 null */
function asArray(v) {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

/**
 * 把 QueryCashCoupons 的返回摊平成统一结构。
 * 阿里云不同版本字段名有出入，这里做多形态兼容。
 */
function normalizeCoupons(data) {
  const raw =
    data?.Data?.CashCoupon ||
    data?.Data?.CashCoupons ||
    data?.Data?.CouponList ||
    data?.CashCoupon ||
    []
  const list = Array.isArray(raw) ? raw : [raw].filter(Boolean)

  return list.map((c) => {
    const nominal = toNum(pick(c, ['NominalValue', 'FaceValue', 'Amount', 'TotalAmount'], 0))
    const balance = toNum(pick(c, ['Balance', 'RemainingAmount', 'AvailableAmount', 'LeftAmount'], nominal))
    return {
      id: String(pick(c, ['CashCouponId', 'CouponId', 'Id'], '')),
      name: String(pick(c, ['CashCouponType', 'Name', 'CouponType', 'Description'], '代金券')),
      nominal,
      balance,
      used: Number(Math.max(0, nominal - balance).toFixed(2)),
      status: String(pick(c, ['Status', 'EffectiveStatus'], '')),
      expiry: String(pick(c, ['ExpiryTime', 'ExpireTime', 'EndTime'], '')),
      start: String(pick(c, ['GrantTime', 'StartTime', 'EffectiveTime'], '')),
      products: String(pick(c, ['ApplicableProducts', 'ProductType', 'Scope'], '')),
      currency: String(pick(c, ['Currency'], 'CNY')),
    }
  })
}

/**
 * 查询额度总览。
 * @param {{accessKeyId:string, accessKeySecret:string}} cred
 * @returns {Promise<object>}
 */
export async function fetchQuota(cred) {
  const { accessKeyId: ak, accessKeySecret: sk } = cred
  const result = {
    ok: true,
    fetchedAt: new Date().toISOString(),
    balance: null,
    coupons: [],
    summary: null,
    warnings: [],
  }

  // 1. 账户余额
  try {
    const d = await call('QueryAccountBalance', {}, ak, sk)
    const data = d.Data || {}
    result.balance = {
      available: toNum(pick(data, ['AvailableAmount', 'AvailableCashAmount'], 0)),
      cash: toNum(pick(data, ['AvailableCashAmount'], 0)),
      credit: toNum(pick(data, ['CreditAmount', 'MybankCreditAmount'], 0)),
      quotaLimit: toNum(pick(data, ['QuotaLimit'], 0)),
      currency: String(pick(data, ['Currency'], 'CNY')),
    }
  } catch (err) {
    result.warnings.push(`账户余额查询失败：${err.message}`)
  }

  // 2. 代金券（大学生优惠券在这里）
  try {
    let d
    try {
      d = await call('QueryCashCoupons', {}, ak, sk)
    } catch (err) {
      // 部分账号要求给时间范围，补一个宽区间重试
      if (/MissingParameter|InvalidParameter/i.test(err.message)) {
        const now = new Date()
        const start = new Date(now.getFullYear() - 2, 0, 1)
        const end = new Date(now.getFullYear() + 3, 11, 31)
        const fmt = (x) => x.toISOString().replace(/\.\d{3}Z$/, 'Z')
        d = await call('QueryCashCoupons', { ExpiryTimeStart: fmt(start), ExpiryTimeEnd: fmt(end) }, ak, sk)
      } else {
        throw err
      }
    }
    result.coupons = normalizeCoupons(d)
  } catch (err) {
    result.warnings.push(`代金券查询失败：${err.message}`)
  }

  // 3. 汇总
  const totalNominal = result.coupons.reduce((s, c) => s + c.nominal, 0)
  const totalBalance = result.coupons.reduce((s, c) => s + c.balance, 0)
  const active = result.coupons.filter((c) => c.balance > 0.005)
  result.summary = {
    couponCount: result.coupons.length,
    activeCount: active.length,
    totalNominal: Number(totalNominal.toFixed(2)),
    totalBalance: Number(totalBalance.toFixed(2)),
    used: Number((totalNominal - totalBalance).toFixed(2)),
    // 可用总额 = 现金余额 + 代金券余额
    usable: Number(((result.balance?.available || 0) + totalBalance).toFixed(2)),
    currency: result.balance?.currency || 'CNY',
  }

  // 4. 下次到期（只看还有余额的）
  const withExpiry = active
    .filter((c) => c.expiry)
    .map((c) => ({ ...c, ts: Date.parse(c.expiry) }))
    .filter((c) => Number.isFinite(c.ts))
    .sort((a, b) => a.ts - b.ts)
  if (withExpiry.length) {
    const next = withExpiry[0]
    result.summary.nextExpiry = next.expiry
    result.summary.nextExpiryDays = Math.max(0, Math.ceil((next.ts - Date.now()) / 86400000))
  }

  return result
}

/** 轻量连通性检查：只查余额，最快 */
export async function ping(cred) {
  await call('QueryAccountBalance', {}, cred.accessKeyId, cred.accessKeySecret)
  return true
}

// ─────────────────────────── 账单 / 用量 ───────────────────────────

/** 账期字符串：2026-11 */
function cycleOf(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 有限并发跑一批任务，顺序与入参一致 */
async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 百炼（sfm）的 InstanceID 形如
 *   7752890;ws-wlhl9tvtza5rpkd6;deepseek-v4.1-flash-1017;output_token_peak;0
 * 第 3 段是模型名，第 4 段是计费项。其它产品给的是普通实例 ID，退回产品名。
 */
function splitInstance(item) {
  const raw = String(item.InstanceID || '')
  const parts = raw.split(';')
  if (parts.length >= 4 && parts[2] && !/\s/.test(parts[2])) {
    return { model: parts[2], kind: parts[3] || '', isModel: true }
  }
  return {
    model: String(item.ProductDetail || item.ProductName || '其它'),
    kind: String(item.BillingItem || ''),
    isModel: false,
  }
}

const KIND_LABELS = {
  input_token_peak: '输入 · 高峰',
  input_token_offpeak: '输入 · 闲时',
  input_token_cache_peak: '输入缓存 · 高峰',
  input_token_cache_offpeak: '输入缓存 · 闲时',
  output_token_peak: '输出 · 高峰',
  output_token_offpeak: '输出 · 闲时',
}

/** 计费项的可读名字，未知项做通用转换 */
function kindLabel(kind) {
  if (!kind) return '用量'
  if (KIND_LABELS[kind]) return KIND_LABELS[kind]
  return String(kind)
    .replace(/_token_/g, ' · ')
    .replace(/_/g, ' ')
    .replace(/peak$/i, '高峰')
    .replace(/offpeak$/i, '闲时')
}

/** 计费项归类到 输入 / 输出 / 缓存 / 其它 */
function kindBucket(kind) {
  const k = String(kind || '')
  if (/^input_token_cache/i.test(k)) return 'cache'
  if (/^input/i.test(k)) return 'input'
  if (/^output/i.test(k)) return 'output'
  return 'other'
}

/** 一条账单明细 → 统一结构 */
function normalizeItem(it) {
  const { model, kind, isModel } = splitInstance(it)
  return {
    model,
    kind,
    kindLabel: kindLabel(kind),
    bucket: kindBucket(kind),
    isModel,
    product: String(it.ProductName || ''),
    productCode: String(it.ProductCode || ''),
    region: String(it.Region || ''),
    date: String(it.BillingDate || '').slice(0, 10),
    // 原价（券前）、券抵扣、现金实付
    amount: toNum(it.PretaxGrossAmount),
    coupon: toNum(it.DeductedByCoupons),
    cash: toNum(pick(it, ['CashAmount', 'PretaxAmount', 'PaymentAmount'], 0)),
    // 用量（千 tokens）与时长
    usage: toNum(it.Usage),
    usageUnit: String(it.UsageUnit || ''),
    seconds: toNum(it.ServicePeriod),
  }
}

/** 汇总一天的明细 */
function sumItems(items) {
  let amount = 0
  let coupon = 0
  let cash = 0
  for (const it of items) {
    amount += it.amount
    coupon += it.coupon
    cash += it.cash
  }
  return { amount, coupon, cash, count: items.length }
}

/**
 * 拉取花费 + 模型调用用量。
 *
 * @param {{accessKeyId:string, accessKeySecret:string}} cred
 * @param {{months?:number, daily?:boolean}} opts
 */
export async function fetchUsage(cred, opts = {}) {
  const { accessKeyId: ak, accessKeySecret: sk } = cred
  const monthCount = Math.max(1, Math.min(24, opts.months || 8))
  const wantDaily = opts.daily !== false

  const now = new Date()
  const cycle = cycleOf(now)
  const todayStr = `${cycle}-${String(now.getDate()).padStart(2, '0')}`

  const result = {
    ok: true,
    fetchedAt: new Date().toISOString(),
    cycle,
    today: todayStr,
    months: [],
    days: [],
    products: [],
    models: [],
    todayStat: null,
    monthStat: null,
    warnings: [],
  }

  // ── 1. 近 N 个月账期汇总 ──
  const cycles = []
  for (let k = 0; k < monthCount; k++) {
    cycles.push(cycleOf(new Date(now.getFullYear(), now.getMonth() - k, 1)))
  }

  const monthResults = await pool(cycles, CONCURRENCY, async (c) => {
    try {
      const d = await call(
        'QueryAccountBill',
        { BillingCycle: c, Granularity: 'MONTHLY', PageNum: 1, PageSize: 300 },
        ak,
        sk,
      )
      const items = asArray(d?.Data?.Items?.Item)
      const gross = items.reduce((s, x) => s + toNum(x.PretaxGrossAmount), 0)
      const coupon = items.reduce((s, x) => s + toNum(x.DeductedByCoupons), 0)
      const discount = items.reduce((s, x) => s + toNum(x.InvoiceDiscount), 0)
      const cash = items.reduce(
        (s, x) => s + toNum(pick(x, ['CashAmount', 'PretaxAmount', 'PaymentAmount'], 0)),
        0,
      )
      return { cycle: c, amount: gross, coupon, discount, cash, rows: items.length, ok: true }
    } catch (err) {
      return { cycle: c, ok: false, error: err.message, amount: 0, coupon: 0, discount: 0, cash: 0, rows: 0 }
    }
  })

  result.months = monthResults
  const failedMonths = monthResults.filter((m) => !m.ok)
  if (failedMonths.length) {
    result.warnings.push(`部分账期查询失败：${failedMonths.map((m) => `${m.cycle}(${m.error})`).join('；')}`)
  }

  // ── 2. 本月逐日明细（同时拿到模型维度） ──
  let allItems = []
  if (wantDaily) {
    const lastDay = now.getDate()
    const dates = []
    for (let d = 1; d <= lastDay; d++) dates.push(`${cycle}-${String(d).padStart(2, '0')}`)

    const dayResults = await pool(dates, CONCURRENCY, async (bd) => {
      try {
        const d = await call(
          'DescribeInstanceBill',
          { BillingCycle: cycle, BillingDate: bd, Granularity: 'DAILY', IsBillingItem: true, MaxResults: 300 },
          ak,
          sk,
        )
        const raw = asArray(d?.Data?.Items)
        const total = toNum(d?.Data?.TotalCount)
        return {
          date: bd,
          items: raw.map(normalizeItem),
          truncated: total > raw.length,
          ok: true,
        }
      } catch (err) {
        return { date: bd, items: [], truncated: false, ok: false, error: err.message }
      }
    })

    const failedDays = dayResults.filter((d) => !d.ok)
    if (failedDays.length) {
      result.warnings.push(`${failedDays.length} 天的明细拉取失败（${failedDays[0].date} 起）`)
    }
    const truncatedDays = dayResults.filter((d) => d.truncated)
    if (truncatedDays.length) {
      result.warnings.push(`${truncatedDays.length} 天明细超过 300 条，只统计了前 300 条`)
    }

    result.days = dayResults
      .filter((d) => d.items.length > 0)
      .map((d) => {
        const s = sumItems(d.items)
        const tokens = d.items.reduce((s2, it) => s2 + (it.isModel ? it.usage : 0), 0)
        return { date: d.date, amount: s.amount, coupon: s.coupon, cash: s.cash, rows: s.count, thousandTokens: tokens }
      })

    allItems = dayResults.flatMap((d) => d.items)

    // 今日
    const todayItems = (dayResults.find((d) => d.date === todayStr) || { items: [] }).items
    if (todayItems.length) {
      const s = sumItems(todayItems)
      result.todayStat = {
        amount: s.amount,
        coupon: s.coupon,
        cash: s.cash,
        rows: s.count,
        thousandTokens: todayItems.reduce((n, it) => n + (it.isModel ? it.usage : 0), 0),
      }
    } else {
      result.todayStat = { amount: 0, coupon: 0, cash: 0, rows: 0, thousandTokens: 0 }
    }

    // ── 3. 按产品聚合 ──
    const productMap = new Map()
    for (const it of allItems) {
      const key = it.productCode || it.product || '其它'
      let p = productMap.get(key)
      if (!p) {
        p = { code: key, name: it.product || key, amount: 0, coupon: 0, cash: 0, rows: 0 }
        productMap.set(key, p)
      }
      p.amount += it.amount
      p.coupon += it.coupon
      p.cash += it.cash
      p.rows += 1
    }
    result.products = [...productMap.values()].sort((a, b) => b.amount - a.amount)

    // ── 4. 按模型聚合 ──
    const modelMap = new Map()
    for (const it of allItems) {
      let m = modelMap.get(it.model)
      if (!m) {
        m = {
          model: it.model,
          product: it.product,
          isModel: it.isModel,
          amount: 0,
          coupon: 0,
          cash: 0,
          inputThousand: 0,
          outputThousand: 0,
          cacheThousand: 0,
          otherThousand: 0,
          totalThousand: 0,
          seconds: 0,
          parts: [],
        }
        modelMap.set(it.model, m)
      }
      m.amount += it.amount
      m.coupon += it.coupon
      m.cash += it.cash
      m.seconds += it.seconds
      if (it.usage > 0) {
        m.totalThousand += it.usage
        if (it.bucket === 'input') m.inputThousand += it.usage
        else if (it.bucket === 'output') m.outputThousand += it.usage
        else if (it.bucket === 'cache') m.cacheThousand += it.usage
        else m.otherThousand += it.usage
      }
      let part = m.parts.find((x) => x.kind === it.kind)
      if (!part) {
        part = { kind: it.kind, label: it.kindLabel, bucket: it.bucket, amount: 0, coupon: 0, thousand: 0, unit: it.usageUnit }
        m.parts.push(part)
      }
      part.amount += it.amount
      part.coupon += it.coupon
      part.thousand += it.usage
    }
    result.models = [...modelMap.values()].sort((a, b) => b.amount - a.amount)
    for (const m of result.models) m.parts.sort((a, b) => b.amount - a.amount)

    // ── 5. 本月合计（以逐日明细为准，比账期汇总更新） ──
    const ms = sumItems(allItems)
    result.monthStat = {
      amount: ms.amount,
      coupon: ms.coupon,
      cash: ms.cash,
      rows: ms.count,
      thousandTokens: result.models.reduce((n, m) => n + m.totalThousand, 0),
      modelCount: result.models.filter((m) => m.isModel).length,
      productCount: result.products.length,
      activeDays: result.days.length,
    }
  }

  return result
}
