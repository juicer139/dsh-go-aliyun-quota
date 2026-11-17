// lib/store.js — AccessKey 的落地位置
//
// 与桌面版 dsh-aliyun-quota 保持同一个目录和格式，方便两边共用：
//   $DSH_HOME/dsh-aliyun-quota/config.json   { accessKeyId, accessKeySecret }
// 文件权限设为 0600；环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 优先于文件。

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function configDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-aliyun-quota')
}

export function configFile() {
  return path.join(configDir(), 'config.json')
}

/** 读配置：文件优先，其次环境变量；不返回给界面，只在引擎里用。 */
export function readConfig() {
  let file = null
  try {
    const f = configFile()
    if (existsSync(f)) file = JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    file = null
  }
  const ak = String(file?.accessKeyId || process.env.ALIYUN_ACCESS_KEY_ID || '').trim()
  const sk = String(file?.accessKeySecret || process.env.ALIYUN_ACCESS_KEY_SECRET || '').trim()
  const source = file?.accessKeyId ? 'file' : process.env.ALIYUN_ACCESS_KEY_ID ? 'env' : 'none'
  return { accessKeyId: ak, accessKeySecret: sk, configured: Boolean(ak && sk), source }
}

/** 保存密钥；成功时文件权限为 0600。 */
export function saveConfig(accessKeyId, accessKeySecret) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const f = configFile()
  writeFileSync(f, JSON.stringify({ accessKeyId, accessKeySecret }, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(f, 0o600)
  } catch {
    /* 有些文件系统不支持 chmod，忽略 */
  }
}

export function clearConfig() {
  try {
    const f = configFile()
    if (existsSync(f)) unlinkSync(f)
    return true
  } catch {
    return false
  }
}

/** AK 打码：LTAI5t****9xQz */
export function maskAk(ak) {
  const s = String(ak || '')
  if (!s) return ''
  if (s.length <= 10) return `${s.slice(0, 3)}****`
  return `${s.slice(0, 6)}****${s.slice(-4)}`
}