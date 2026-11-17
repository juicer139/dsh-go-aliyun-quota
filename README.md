# dsh-go-aliyun-quota

在 [dsh-go](https://github.com/ccch1mneyyy/dsh-Go) 手机 App 里看阿里云账户的**额度**和**花费**，不用去控制台翻「我的权益」和「费用账单」。

- **额度与券**：可用余额、代金券面额与剩余、到期提醒（学生认证的 300 元券也在这里）
- **花费与模型**：本月已花、今日花费、近 8 个月账单趋势、每月 token 用量、按模型 / 按产品的明细
- **对话里直接问**：「这个月阿里云花了多少」会返回一张原生卡片

数据来自阿里云 BSS OpenAPI（只读），插件本身零运行时依赖。

这是桌面版 [dsh-aliyun-quota](https://github.com/20132556/dsh-aliyun-quota) 的 dsh-go 移植：数据层原样复用，界面换成 dsh-go 的原生状态条、面板和表单。

## 安装

```sh
dsh plugin --profile web add dsh-go-aliyun-quota
```

装完在 App 里能看到：

| 位置 | 内容 |
|---|---|
| 输入框上方状态条 | `阿里云 ¥123.45`（合计可用），点开额度面板；未配置时显示 `阿里云 未配置` |
| 全部功能 → 阿里云额度 | 额度与券 / 花费与模型 / 密钥设置 三个面板 |
| 输入框「+」面板 | 刷新额度 |
| 对话 | `aliyun_quota`、`aliyun_usage` 两个工具，带原生卡片 |

## 先拿 AccessKey

1. 打开 [RAM 访问控制 → AccessKey](https://ram.console.aliyun.com/manage/ak)，**建议建 RAM 子账号**，不要用主账号 AK
2. 给这个子账号授予 **`AliyunBSSReadOnlyAccess`**（只读，足够查余额、代金券和账单）
3. App 里进「阿里云额度 → 密钥设置」，填 ID 和 Secret，点「保存并验证」

保存前会真的调一次接口验证，验证不过不会落盘。

## 密钥存在哪

```
$DSH_HOME/dsh-aliyun-quota/config.json   （权限 0600，明文 JSON，与桌面版同目录同格式）
```

也可以用环境变量（优先于文件）：

```sh
export ALIYUN_ACCESS_KEY_ID=LTAI...
export ALIYUN_ACCESS_KEY_SECRET=...
```

面板上的「清除密钥」只删文件；环境变量里的密钥清不掉，界面会照实显示来源为 `环境变量`。

> dsh-go 的插件视图不支持密码输入框，所以填写 Secret 时屏幕上可见。介意的话请用环境变量或最小权限的 RAM 子账号。

## 刷新与缓存

- 状态条：60 秒心跳推送，余额缓存 90 秒
- 额度面板：打开即查，缓存 90 秒
- 花费面板：一次要发 25+ 个请求（8 个账期 + 当月逐日），缓存 5 分钟，只在打开面板或主动刷新时拉取
- 账单接口有 1–6 小时延迟，刚花的钱不一定立刻出现（控制台同理）

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 看不到插件 / 状态条 | 引擎还没重新加载插件 | App「设置 → 引擎」重启引擎，或重开 App |
| 「AccessKey ID 不存在或已删除」 | AK 填错 / 已禁用 | 去 RAM 控制台核对 |
| 「这个 AccessKey 没有账单只读权限」 | 未授权 | 授予 `AliyunBSSReadOnlyAccess` |
| 「连不上阿里云」 | 网络 / DNS | 换网络或代理后重试 |
| 花费页空 | 账单延迟 / 权限不足 | 等一会儿；确认权限 |
| 模型显示成产品名 | 非百炼产品没有 `InstanceID` 的模型段 | 正常行为 |

## 开发

```sh
node "$DSH_HOME/skills/dsh-go-plugin/kit/bin/check.mjs" . --load --app 1.1.0
```

- `lib/aliyun.js`：BSS OpenAPI 客户端（`node:crypto` + `fetch`，无依赖）
- `lib/store.js`：密钥读写
- `lib/view.js`：原生视图与数据映射
- `lib/index.js`：面板 / 状态条 / 表单 / 工具注册

## License

MIT。数据层移植自 [20132556/dsh-aliyun-quota](https://github.com/20132556/dsh-aliyun-quota)（MIT）。