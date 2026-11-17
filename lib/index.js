// lib/index.js — dsh-go 原生插件：阿里云额度与花费
//
// 桌面版（dsh-aliyun-quota）的移植：数据层 aliyun.js 与查询逻辑保持不变，
// 界面从 React 侧边栏换成 dsh-go 的原生面板、状态条和密钥表单；
// 同时保留调阿里云用的两个对话工具（aliyun_quota / aliyun_usage）。
//
// 数据来源：阿里云 BSS OpenAPI（business.aliyuncs.com），只读。
// 密钥：$DSH_HOME/dsh-aliyun-quota/config.json（0600），或环境变量。

import { fetchQuota, fetchUsage, ping } from './aliyun.js'
import { clearConfig, configFile, maskAk, readConfig, saveConfig } from './store.js'
import { compactQuota, compactUsage, quotaCard, quotaData, quotaView, settingsData, settingsView, stripText, usageCard, usageData, usageView, words } from './view.js'

export const name = 'local-aliyun-quota'

/** 额度缓存：余额 + 代金券，两个请求，刷新可以勤一点 */
const quotaCache = { at: 0, data: null, ttl: 90_000, inflight: null }
/** 账单缓存：一次要发 25+ 个请求（8 个账期 + 当月逐日），TTL 放长 */
const usageCache = { at: 0, data: null, ttl: 5 * 60_000, inflight: null }

function resetCaches() {
  quotaCache.at = 0
  quotaCache.data = null
  usageCache.at = 0
  usageCache.data = null
}

function creds() {
  const cfg = readConfig()
  if (!cfg.configured) {
    const err = new Error('尚未配置 AccessKey')
    err.code = 'NOT_CONFIGURED'
    throw err
  }
  return cfg
}

async function loadQuota(force = false) {
  if (!force && quotaCache.data && Date.now() - quotaCache.at < quotaCache.ttl) return quotaCache.data
  if (quotaCache.inflight) return quotaCache.inflight
  quotaCache.inflight = (async () => {
    try {
      const data = await fetchQuota(creds())
      quotaCache.at = Date.now()
      quotaCache.data = data
      return data
    } finally {
      quotaCache.inflight = null
    }
  })()
  return quotaCache.inflight
}

async function loadUsage(force = false) {
  if (!force && usageCache.data && Date.now() - usageCache.at < usageCache.ttl) return usageCache.data
  if (usageCache.inflight) return usageCache.inflight
  usageCache.inflight = (async () => {
    try {
      const data = await fetchUsage(creds(), { months: 8 })
      usageCache.at = Date.now()
      usageCache.data = data
      return data
    } finally {
      usageCache.inflight = null
    }
  })()
  return usageCache.inflight
}

// ── 小工具 ────────────────────────────────────────────────

/** 提示条不超过 40 字，报错也要像人话 */
function toastText(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

/**
 * 把阿里云/网络错误翻成人话。认不出来的保留原样，方便进一步排查。
 */
function friendlyError(err) {
  const code = String(err?.aliyunCode || '')
  const msg = String(err?.message || err || '')
  if (code === 'InvalidAccessKeyId.NotFound' || /access key is not found/i.test(msg)) return 'AccessKey ID 不存在或已删除'
  if (/SignatureDoesNotMatch/i.test(msg)) return 'AccessKey Secret 不对（或系统时间偏差过大）'
  if (code === 'Forbidden' || /Forbidden|NoPermission|not authorized|no permission/i.test(msg)) return '这个 AccessKey 没有账单只读权限'
  if (/Throttling/i.test(msg)) return '阿里云限流了，等一分钟再试'
  if (/fetch failed|aborted|abort|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|network/i.test(msg)) return '连不上阿里云，检查网络'
  return msg
}

function statusText(err, w, limit = 160) {
  if (!err) return ''
  if (err.code === 'NOT_CONFIGURED') return w.notConfigured
  const s = w.failed(friendlyError(err))
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s
}

function quotaPayload(q, locale, err) {
  const w = words(locale)
  const d = quotaData(q, locale)
  if (err) d.status = statusText(err, w)
  else if (!q) d.status = w.notConfigured
  return d
}

function usagePayload(u, locale, err) {
  const w = words(locale)
  const d = usageData(u, locale)
  if (err) d.status = statusText(err, w)
  else if (!u) d.status = w.notConfigured
  return d
}

/**
 * 表单提交时 dsh-go 传来 { values: { "data.form.ak": "…", "data.form.sk": "…" } }。
 * 这里按不同形态做兼容，只取这两个字段。
 */
function formValues(value) {
  const flat = new Map()
  const walk = (v, depth = 0) => {
    if (depth > 3 || v === null || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string') {
        const key = String(k).replace(/^data\./, '').toLowerCase()
        if (!flat.has(key) || flat.get(key) === '') flat.set(key, x)
      } else if (x && typeof x === 'object') {
        walk(x, depth + 1)
      }
    }
  }
  walk(value)
  const pick = (...names) => {
    for (const n of names) if (flat.get(n)) return String(flat.get(n)).trim()
    return ''
  }
  return { ak: pick('form.ak', 'ak', 'accesskeyid'), sk: pick('form.sk', 'sk', 'accesskeysecret') }
}

// ── 插件主体 ──────────────────────────────────────────────

export function apply(ctx) {
  const log = (msg) => {
    try {
      ctx.logger?.info?.(`[aliyun-quota] ${msg}`)
    } catch {
      /* ignore */
    }
  }

  // 1) dsh-go 原生界面：面板、状态条、密钥表单
  ctx.inject(['dshGo'], (ctx) => {
    // ── 额度与券 ──
    ctx.dshGo.panel('quota', {
      view: (scope, caps) => quotaView(caps),
      data: (scope, emit, caps) => {
        let closed = false
        let busy = false
        const push = (payload) => {
          if (!closed && payload) emit(payload)
        }
        const tick = async () => {
          const cfg = readConfig()
          if (!cfg.configured) return push(quotaPayload(null, caps.locale))
          if (quotaCache.data) push(quotaPayload(quotaCache.data, caps.locale))
          if (busy) return
          busy = true
          try {
            push(quotaPayload(await loadQuota(false), caps.locale))
          } catch (err) {
            push(quotaPayload(quotaCache.data, caps.locale, err))
          } finally {
            busy = false
          }
        }
        tick()
        const timer = setInterval(tick, 60_000)
        return () => {
          closed = true
          clearInterval(timer)
        }
      },
      actions: {
        refresh: (scope, event) => {
          const w = words(event?.locale)
          return {
            pending: { label: w.refreshing, timeoutMs: 30_000 },
            result: async (signal) => {
              try {
                const q = await loadQuota(true)
                if (signal?.aborted) return []
                return { toast: w.refreshed, patch: quotaPayload(q, event?.locale) }
              } catch (err) {
                return {
                  toast: toastText(err.code === 'NOT_CONFIGURED' ? w.notConfigured : friendlyError(err)),
                  patch: quotaPayload(quotaCache.data, event?.locale, err),
                }
              }
            },
          }
        },
        'open-usage': () => ({ open: 'panel:usage' }),
        'open-settings': () => ({ open: 'panel:settings' }),
      },
    })

    // ── 花费与模型 ──
    ctx.dshGo.panel('usage', {
      view: (scope, caps) => usageView(caps),
      data: (scope, emit, caps) => {
        let closed = false
        let busy = false
        const push = (payload) => {
          if (!closed && payload) emit(payload)
        }
        const tick = async () => {
          const cfg = readConfig()
          if (!cfg.configured) return push(usagePayload(null, caps.locale))
          if (usageCache.data) push(usagePayload(usageCache.data, caps.locale))
          if (busy) return
          busy = true
          try {
            push(usagePayload(await loadUsage(false), caps.locale))
          } catch (err) {
            push(usagePayload(usageCache.data, caps.locale, err))
          } finally {
            busy = false
          }
        }
        tick()
        const timer = setInterval(tick, 5 * 60_000)
        return () => {
          closed = true
          clearInterval(timer)
        }
      },
      actions: {
        refresh: (scope, event) => {
          const w = words(event?.locale)
          return {
            pending: { label: w.refreshing, timeoutMs: 60_000 },
            result: async (signal) => {
              try {
                const u = await loadUsage(true)
                if (signal?.aborted) return []
                return { toast: w.refreshed, patch: usagePayload(u, event?.locale) }
              } catch (err) {
                return {
                  toast: toastText(err.code === 'NOT_CONFIGURED' ? w.notConfigured : friendlyError(err)),
                  patch: usagePayload(usageCache.data, event?.locale, err),
                }
              }
            },
          }
        },
        'open-quota': () => ({ open: 'panel:quota' }),
        'open-settings': () => ({ open: 'panel:settings' }),
      },
    })

    // ── 密钥设置 ──
    ctx.dshGo.panel('settings', {
      view: (scope, caps) => settingsView(caps),
      data: (scope, emit, caps) => {
        const cfg = readConfig()
        emit(
          settingsData(
            { configured: cfg.configured, masked: maskAk(cfg.accessKeyId), source: cfg.source, path: configFile() },
            caps.locale,
          ),
        )
        return () => {}
      },
      actions: {
        save: (scope, event) => {
          const w = words(event?.locale)
          const { ak, sk } = formValues(event?.value)
          if (!ak || !sk) return { toast: w.fillBoth }
          return {
            pending: { label: w.verifying, timeoutMs: 30_000 },
            result: async (signal) => {
              try {
                // 先真的调一次接口，验证不过不落盘
                await ping({ accessKeyId: ak, accessKeySecret: sk })
              } catch (err) {
                const message = friendlyError(err)
                return {
                  toast: toastText(w.verifyFail(message)),
                  patch: { status: w.verifyFail(message).slice(0, 160) },
                }
              }
              if (signal?.aborted) return []
              saveConfig(ak, sk)
              resetCaches()
              log('AccessKey 已保存并通过验证')
              return {
                toast: w.saved,
                patch: { status: w.statusConfigured(maskAk(ak), w.srcFile), form: { ak: '', sk: '' } },
              }
            },
          }
        },
        clear: (scope, event) => {
          const w = words(event?.locale)
          if (event?.value?.confirmed === false) return []
          clearConfig()
          resetCaches()
          // 环境变量里的密钥清不掉，状态照实显示
          const cfg = readConfig()
          return {
            toast: w.cleared,
            patch: {
              status: cfg.configured
                ? w.statusConfigured(maskAk(cfg.accessKeyId), w.srcEnv)
                : w.statusNotConfigured,
              form: { ak: '', sk: '' },
            },
          }
        },
        'open-quota': () => ({ open: 'panel:quota' }),
        'open-usage': () => ({ open: 'panel:usage' }),
      },
    })

    // ── 输入框上方的状态条：合计可用，点开额度面板 ──
    ctx.dshGo.strip('strip-quota', (scope, emit, caps) => {
      let closed = false
      const w = words(caps?.locale)
      const push = (q, cfg) => {
        if (closed) return
        const usable = q?.summary?.usable
        emit({ text: stripText(cfg.configured ? usable : null, cfg.configured, caps?.locale), icon: 'wallet' })
      }
      const tick = async () => {
        const cfg = readConfig()
        push(quotaCache.data, cfg)
        if (!cfg.configured) return
        try {
          const q = await loadQuota(false)
          if (!closed) push(q, cfg)
        } catch {
          /* 状态条不弹错，面板里看得到 */
        }
      }
      tick()
      const timer = setInterval(tick, 60_000)
      return () => {
        closed = true
        clearInterval(timer)
      }
    })

    // ── 加号面板里的「刷新额度」 ──
    ctx.dshGo.on('refresh-quota', (scope, event) => {
      const w = words(event?.locale)
      return {
        pending: { label: w.refreshing, timeoutMs: 30_000 },
        result: async (signal) => {
          try {
            const q = await loadQuota(true)
            if (signal?.aborted) return []
            return { toast: `${w.refreshed} ${w.usable} ${quotaData(q, event?.locale).usable}` }
          } catch (err) {
            return { toast: toastText(err.code === 'NOT_CONFIGURED' ? w.notConfigured : friendlyError(err)) }
          }
        },
      }
    })
  })

  // 2) 对话工具：可以直接问「这个月阿里云花了多少」
  ctx.inject(['tools'], (ctx) => {
    const tools = ctx.tools ?? ctx.get?.('tools', false)
    if (!tools || typeof tools.register !== 'function') return
    const disposers = []
    const register = (def) => {
      try {
        const dispose = tools.register(def)
        if (typeof dispose === 'function') disposers.push(dispose)
        log(`已注册工具 ${def.name}`)
      } catch (err) {
        log(`工具 ${def.name} 注册跳过：${err.message}`)
      }
    }

    register({
      name: 'aliyun_quota',
      description:
        '查询本机已配置的阿里云账户额度：可用余额、代金券（含大学生优惠券）面额与剩余、最近到期时间。不传参数即查询全部。',
      parameters: {
        type: 'object',
        properties: {
          refresh: { type: 'boolean', description: '跳过缓存，强制重新拉取' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            text: { type: 'string' },
            data: { anyOf: [{ type: 'object' }, { type: 'null' }] },
          },
          required: ['ok', 'text'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
        presentationMeta: (_args, value) => {
          try {
            if (!value?.ok || !value.data) return {}
            const view = quotaCard(value.data, 'zh')
            return JSON.stringify(view).length <= 8000 ? { 'dsh-go/view': view } : {}
          } catch {
            return {}
          }
        },
      },
      execute: async (args) => {
        try {
          const d = await loadQuota(Boolean(args?.refresh))
          const s = d.summary || {}
          const lines = []
          lines.push(`可用余额：¥${(d.balance?.available ?? 0).toFixed(2)}`)
          if (d.coupons.length) {
            lines.push(`代金券：${s.couponCount} 张，剩余 ¥${s.totalBalance.toFixed(2)} / 面额 ¥${s.totalNominal.toFixed(2)}`)
            for (const c of d.coupons.slice(0, 8)) {
              const exp = c.expiry ? ` 到期 ${c.expiry.slice(0, 10)}` : ''
              lines.push(`  · ${c.name} ¥${c.balance.toFixed(2)}/${c.nominal.toFixed(2)}${exp}`)
            }
          } else {
            lines.push('代金券：无')
          }
          if (s.nextExpiryDays !== undefined) lines.push(`最近到期：${s.nextExpiryDays} 天后`)
          lines.push(`合计可用：¥${(s.usable ?? 0).toFixed(2)}`)
          if (d.warnings?.length) lines.push(`注意：${d.warnings.join('；')}`)
          return { ok: true, text: lines.join('\n'), data: compactQuota(d) }
        } catch (err) {
          return {
            ok: false,
            text:
              err.code === 'NOT_CONFIGURED'
                ? '尚未配置阿里云 AccessKey：打开 dsh-go 的「全部功能 → 阿里云额度 → 密钥设置」填写。'
                : `查询失败：${err.message}`,
            data: null,
          }
        }
      },
    })

    register({
      name: 'aliyun_usage',
      description:
        '查询本机已配置的阿里云账户的花费与模型调用量：本月已花多少、今日花费、近几个月账单趋势、按产品/按模型的费用与 token 用量明细。',
      parameters: {
        type: 'object',
        properties: {
          months: { type: 'integer', description: '回溯账期数，默认 8' },
          refresh: { type: 'boolean', description: '跳过 5 分钟缓存，强制重新拉取' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            text: { type: 'string' },
            data: { anyOf: [{ type: 'object' }, { type: 'null' }] },
          },
          required: ['ok', 'text'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
        presentationMeta: (_args, value) => {
          try {
            if (!value?.ok || !value.data) return {}
            const view = usageCard(value.data, 'zh')
            return JSON.stringify(view).length <= 8000 ? { 'dsh-go/view': view } : {}
          } catch {
            return {}
          }
        },
      },
      execute: async (args) => {
        try {
          const d = await loadUsage(Boolean(args?.refresh))
          const m = d.monthStat || {}
          const t = d.todayStat || {}
          const tk = (thousand) => {
            const n = Number(thousand) * 1000
            if (!Number.isFinite(n) || n <= 0) return '0'
            if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
            if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
            if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
            return String(Math.round(n))
          }
          const lines = []
          lines.push(`账期 ${d.cycle}`)
          lines.push(`本月已花：¥${(m.amount ?? 0).toFixed(2)}（券抵 ¥${(m.coupon ?? 0).toFixed(2)}，现金 ¥${(m.cash ?? 0).toFixed(2)}）`)
          lines.push(`今日花费：¥${(t.amount ?? 0).toFixed(2)}（券抵 ¥${(t.coupon ?? 0).toFixed(2)}）`)
          lines.push(
            `本月 token：${tk(m.thousandTokens ?? 0)}（输入 ${tk(d.models?.reduce((s, x) => s + x.inputThousand, 0) ?? 0)} / 缓存 ${tk(d.models?.reduce((s, x) => s + x.cacheThousand, 0) ?? 0)} / 输出 ${tk(d.models?.reduce((s, x) => s + x.outputThousand, 0) ?? 0)}）`,
          )
          if (d.months?.length) {
            lines.push('')
            lines.push('近几个月账单：')
            for (const x of d.months) {
              lines.push(`  ${x.cycle}  ¥${x.amount.toFixed(2)}${x.coupon ? `（券抵 ¥${x.coupon.toFixed(2)}）` : ''}`)
            }
          }
          if (d.models?.length) {
            lines.push('')
            lines.push('按模型 / 计费项（本月）：')
            for (const mm of d.models.slice(0, 8)) {
              const tokenPart = mm.totalThousand > 0 ? ` ${tk(mm.totalThousand)} tokens` : ''
              lines.push(`  · ${mm.model}  ¥${mm.amount.toFixed(2)}${tokenPart}`)
              for (const p of mm.parts.slice(0, 4)) {
                const u = p.thousand > 0 ? ` ${tk(p.thousand)} tokens` : ''
                lines.push(`      - ${p.label} ¥${p.amount.toFixed(4)}${u}`)
              }
            }
          }
          if (d.products?.length > 1) {
            lines.push('')
            lines.push('按产品（本月）：')
            for (const p of d.products.slice(0, 6)) lines.push(`  · ${p.name}  ¥${p.amount.toFixed(2)}`)
          }
          if (d.warnings?.length) lines.push(`\n注意：${d.warnings.join('；')}`)
          return { ok: true, text: lines.join('\n'), data: compactUsage(d) }
        } catch (err) {
          return {
            ok: false,
            text:
              err.code === 'NOT_CONFIGURED'
                ? '尚未配置阿里云 AccessKey：打开 dsh-go 的「全部功能 → 阿里云额度 → 密钥设置」填写。'
                : `查询失败：${err.message}`,
            data: null,
          }
        }
      },
    })

    ctx.effect(
      () => () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* ignore */
          }
        }
      },
      'aliyun-quota: tools',
    )
  })
}