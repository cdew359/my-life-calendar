import { browserStorage as localStorage } from "./browserStorage";
import type { AppData } from "./types";
import { apiPull, apiPush, normalizeServer } from "./api";
import { dataEquals, mergeData } from "./sync";
import { upgradeSyncServer } from "./config";

export type SyncState = "off" | "idle" | "syncing" | "error";

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  message: string | null;
}

const SERVER_KEY = "calendar.sync.server";
const TOKEN_KEY = "calendar.sync.token";
const USER_KEY = "calendar.sync.user";
/** 本机最近一次同步的账号——用于登录其他账号时提示数据归属 */
const LAST_USER_KEY = "calendar.sync.lastUser";

/** 读取本机最近同步的账号，用于提示本地数据归属。 */
export function getLastSyncUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

/** 读取同步地址、令牌和账号，并迁移已知的旧地址。 */
export function getSyncConfig(): { server: string; token: string; username?: string } | null {
  try {
    const server = localStorage.getItem(SERVER_KEY);
    const token = localStorage.getItem(TOKEN_KEY);
    if (server && token) {
      const username = localStorage.getItem(USER_KEY) ?? undefined;
      const upgraded = upgradeSyncServer(server);
      if (upgraded !== server) localStorage.setItem(SERVER_KEY, upgraded);
      return { server: upgraded, token, username };
    }
  } catch {
    // localStorage 不可用时视为未配置
  }
  return null;
}

/** 保存规范化的同步地址及当前账号凭据。 */
export function saveSyncConfig(server: string, token: string, username?: string) {
  localStorage.setItem(SERVER_KEY, upgradeSyncServer(server));
  localStorage.setItem(TOKEN_KEY, token);
  if (username) localStorage.setItem(USER_KEY, username);
}

/** 清除同步地址、令牌和当前账号配置。 */
export function clearSyncConfig() {
  localStorage.removeItem(SERVER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

interface EngineOptions {
  /** 取得当前账号最新的本地数据快照。 */
  getLocal: () => AppData;
  /** 合并结果写回应用状态；引擎保证仅在数据变化时调用 */
  apply: (data: AppData) => void | Promise<void>;
  /** 将同步引擎的最新状态通知界面。 */
  onStatus: (status: SyncStatus) => void;
}

/**
 * 同步引擎：拉取 → 与本地合并 → 写回 → 推送合并结果。
 * 由登录/恢复登录、手动「立即同步」及晚间简报前触发；
 * 没有后台轮询、没有焦点拉取、保存后也不自动推送——本地改动在下次同步前只留在本机。
 */
export class SyncEngine {
  private opts: EngineOptions;
  private cfg: { server: string; token: string } | null = null;
  private inFlight: Promise<boolean> | null = null;
  private flightConfig: { server: string; token: string } | null = null;
  /** 恢复登录后挂起同步：等调用方切好账号数据库（restoreSyncOnce）才放行，防止无主库数据串进账号 */
  private hold = false;
  /** 下一次同步改为“直接采用云端”（登录不同账号时选了以云端为准） */
  private adoptRemoteOnce = false;
  private status: SyncStatus = { state: "off", lastSyncAt: null, message: null };

  /** 注入读取本地数据、应用快照及通知同步状态的回调。 */
  constructor(opts: EngineOptions) {
    this.opts = opts;
  }

  /** 合并同步状态变更，并通知界面刷新。 */
  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.opts.onStatus(this.status);
  }

  /** 保存登录连接并启动首次同步，可选择本次直接采用云端数据。 */
  enable(server: string, token: string, username?: string, opts?: { adoptRemote?: boolean }) {
    const normalized = normalizeServer(upgradeSyncServer(server));
    if (!normalized) throw new Error("服务器地址无效");
    this.cfg = { server: normalized, token };
    saveSyncConfig(normalized, token, username);
    if (username) localStorage.setItem(LAST_USER_KEY, username);
    // adoptRemote：不合并本机数据，直接采用云端（登录他人/新账号时选“以云端为准”）
    this.adoptRemoteOnce = !!opts?.adoptRemote;
    // 登录是用户显式动作，解除一切挂起
    this.hold = false;
    this.setStatus({ state: "idle", message: null });
    void this.syncOnce();
  }

  /** 解除当前同步连接，清除登录配置并重置同步状态。 */
  disable() {
    this.cfg = null;
    this.hold = false;
    clearSyncConfig();
    try {
      localStorage.removeItem(LAST_USER_KEY);
    } catch {
      // 存储不可用忽略
    }
    this.setStatus({ state: "off", lastSyncAt: null, message: null });
  }

  /** 恢复已保存的登录连接，等待账号本地库切换完成后再放行同步。 */
  restore(): boolean {
    const saved = getSyncConfig();
    if (saved) {
      this.cfg = saved;
      this.hold = true;
      this.setStatus({ state: "idle", message: null });
      return true;
    }
    return false;
  }

  /** restore 后由调用方触发首次同步（同时解除挂起） */
  restoreSyncOnce() {
    if (!this.cfg) return;
    this.hold = false;
    void this.syncOnce();
  }

  /** 手动「立即同步」：用户显式动作，无视挂起状态，永远可用 */
  forceSyncOnce() {
    if (!this.cfg) return;
    this.hold = false;
    void this.syncOnce();
  }

  /** 合并同一连接的并发同步请求，账号变化时等待前一次操作结束。 */
  syncOnce(): Promise<boolean> {
    if (!this.cfg || this.hold) return Promise.resolve(false);
    if (this.inFlight)
      return this.flightConfig === this.cfg
        ? this.inFlight
        : this.inFlight.then(() => this.syncOnce());
    this.flightConfig = this.cfg;
    const operation = this.performSync(this.cfg);
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    return operation;
  }

  /**
   * 校验服务器能力后拉取、合并并上传数据。
   * 上传结束后再次读取本地快照，保留请求期间的编辑；每次异步返回均检查连接身份，避免切换账号后串库。
   * @returns 本轮同步成功时为 true；连接已切换、未完成或请求失败时为 false。
   */
  private async performSync(activeConfig: { server: string; token: string }): Promise<boolean> {
    this.setStatus({ state: "syncing" });
    try {
      const { server, token } = activeConfig;
      const signal = AbortSignal.timeout(15_000);
      if (this.opts.getLocal().anniversaries.some((a) => a.birthday)) {
        const response = await fetch(`${server}/api/health`, { signal });
        const health = await response.json();
        if (!response.ok || !health.capabilities?.includes("birthday-reminders-v1"))
          throw new Error("服务器尚不支持家人生日，请更新服务端后再同步；本机生日已保留");
      }
      if ((this.opts.getLocal().timelines ?? []).length) {
        const response = await fetch(`${server}/api/health`, { signal });
        const health = await response.json();
        const capability = this.opts
          .getLocal()
          .timelines.some((t) => t.stepsMode || t.goalPlanId || t.items.some((i) => i.step))
          ? "timelines-goal-v1"
          : this.opts.getLocal().timelines.some((t) => t.endTime !== undefined)
            ? "timelines-backward-v1"
            : "timelines-v1";
        if (!response.ok || !health.capabilities?.includes(capability))
          throw new Error("服务器尚不支持时间预排，请更新服务端后再同步；本机数据已保留");
      }
      const remote = await apiPull(server, token, signal);
      if (this.cfg !== activeConfig) return false;
      const local = this.opts.getLocal();
      if (this.adoptRemoteOnce) {
        // 以云端为准：不做合并、不回推，直接采用云端数据（新账号从干净状态开始）
        this.adoptRemoteOnce = false;
        if (!dataEquals(remote.data, local)) {
          await this.opts.apply(remote.data);
        }
      } else {
        const merged = mergeData(local, remote.data);
        if (!dataEquals(merged, local)) {
          await this.opts.apply(merged);
        }
        if (this.cfg !== activeConfig) return false;
        const saved = await apiPush(server, token, merged, signal);
        if (this.cfg !== activeConfig) return false;
        // Preserve edits made while the upload was in flight.
        const current = this.opts.getLocal();
        const reconciled = mergeData(current, saved.data);
        if (!dataEquals(reconciled, current)) await this.opts.apply(reconciled);
      }
      if (this.cfg !== activeConfig) return false;
      this.setStatus({ state: "idle", lastSyncAt: Date.now(), message: null });
      return true;
    } catch (error) {
      if (this.cfg !== activeConfig) return false;
      this.setStatus({
        state: "error",
        message: error instanceof Error ? error.message : "同步失败",
      });
      return false;
    }
  }

  /** 停用当前引擎连接，供组件卸载时清理。 */
  stop() {
    // 纯被动同步：没有需要停止的定时器，保留方法兼容挂载清理
  }
}
