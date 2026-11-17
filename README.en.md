# dsh-go-aliyun-quota

Aliyun (Alibaba Cloud) balance and spending, natively in the [dsh-go](https://github.com/ccch1mneyyy/dsh-Go) phone app — no more digging through the console for coupons and bills.

- **Balance & coupons**: available cash, coupon face value and remainder, expiry reminder (student coupons show up here)
- **Spend & models**: this month, today, an 8-month trend, monthly tokens, per model / per product breakdown
- **In chat**: ask "how much did Aliyun cost this month" and get a native card

Data comes from the Aliyun BSS OpenAPI (read-only). The plugin has no runtime dependencies.

This is the dsh-go port of [dsh-aliyun-quota](https://github.com/20132556/dsh-aliyun-quota): the BSS client is reused as-is, the UI is rebuilt as native dsh-go surfaces.

## Install

```sh
dsh plugin --profile web add dsh-go-aliyun-quota
```

Where it shows up:

| Where | What |
|---|---|
| Strip above the composer | `Aliyun ¥123.45` (total usable); tap to open the balance panel; `Aliyun: no key` until configured |
| All features → Aliyun quota | Balance / Spending / Access key panels |
| Composer "+" panel | Refresh |
| Chat tools | `aliyun_quota`, `aliyun_usage`, with native cards |

## Get an AccessKey

1. [RAM → AccessKey](https://ram.console.aliyun.com/manage/ak) — create a **RAM user**, not the root AccessKey
2. Grant it **`AliyunBSSReadOnlyAccess`** (read-only: balance, coupons, bills)
3. In the app: Aliyun quota → Access key, paste the ID and secret, tap Save & verify

The key is verified with a real API call before it is written.

## Where the key lives

```
$DSH_HOME/dsh-aliyun-quota/config.json   (mode 0600, plain JSON, same path as the desktop plugin)
```

Environment variables win over the file: `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`.

> Plugin views have no password input, so the secret is visible while you type it. Prefer environment variables or a least-privilege RAM user.

## Caching

Balance: 90 s (strip pushes every 60 s). Bills: 5 minutes, fetched only when the panel opens or you tap refresh — a run costs 25+ requests. Billing data lags 1–6 hours.

## License

MIT. The API client is ported from [20132556/dsh-aliyun-quota](https://github.com/20132556/dsh-aliyun-quota) (MIT).