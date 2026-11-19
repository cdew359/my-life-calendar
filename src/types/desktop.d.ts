import type { AiPlanBatch } from "../lib/aiPlans";
import type { TimelineChange } from "../lib/timelines";
import type { AppData, CityRecord, Domain, Reminder, Birthday } from "../lib/types";

declare global {
  interface DesktopDataApi {
    /** 原子保存当前账号确认的 AI 计划批次。 */
    addAiPlans(input: AiPlanBatch): Promise<AppData>;
    /** 应用时间线修改，同时校验版本并重算相关排程。 */
    changeTimeline(input: TimelineChange): Promise<AppData>;
    /** 从桌面主进程读取当前账号的日历快照。 */
    load(): Promise<AppData>;
    /** 新增指定日期的计划。 */
    addPlan(input: { date: string; text: string; domain: Domain }): Promise<AppData>;
    /** 切换计划的完成状态。 */
    togglePlan(id: string): Promise<AppData>;
    /** 删除指定计划，保留同步所需的删除标记。 */
    removePlan(id: string): Promise<AppData>;
    /** 新增指定日期的每日记录。 */
    addNote(input: { date: string; text: string; domain: Domain }): Promise<AppData>;
    /** 删除每日记录，保留同步所需的删除标记。 */
    removeNote(id: string): Promise<AppData>;
    /** 新增需要持续打卡的习惯。 */
    addHabit(input: { text: string; domain: Domain }): Promise<AppData>;
    /** 切换指定习惯在某一天的打卡状态。 */
    toggleHabitCheckIn(input: { id: string; date: string }): Promise<AppData>;
    /** 移除指定习惯。 */
    removeHabit(id: string): Promise<AppData>;
    /** 新增纪念日，并保留单次或每年重复的类型。 */
    addAnniversary(input: {
      name: string;
      kind: "yearly" | "once";
      date: string;
      birthday?: Birthday;
    }): Promise<AppData>;
    /** 移除指定纪念日。 */
    removeAnniversary(id: string): Promise<AppData>;
    /** 新增提醒规则。 */
    addReminder(
      input: Omit<Reminder, "id" | "createdAt" | "updatedAt" | "deletedAt">,
    ): Promise<AppData>;
    /** 启用或停用指定提醒。 */
    setReminderEnabled(id: string, enabled: boolean): Promise<AppData>;
    /** 移除指定提醒。 */
    removeReminder(id: string): Promise<AppData>;
    /** 设置天气卡片使用的常住城市。 */
    setHomeCity(city: CityRecord): Promise<AppData>;
    /** 设置关注城市；传入空值时取消关注。 */
    setWatchCity(city: CityRecord | null): Promise<AppData>;
    /** 更新计划的分享对象列表。 */
    setPlanShare(id: string, usernames: string[]): Promise<AppData>;
    /** 更新每日记录的分享对象列表。 */
    setNoteShare(id: string, usernames: string[]): Promise<AppData>;
    /** 切换当前账号的数据存储，空账号对应未登录时的本地数据。 */
    setAccount(username: string | null): Promise<AppData>;
    /** 用完整数据快照替换当前账号的本地数据。 */
    replaceAll(data: AppData): Promise<AppData>;
    /** 订阅日历数据变化，并返回取消订阅的方法。 */
    subscribe(cb: (data: AppData) => void): () => void;
  }

  interface DesktopApi {
    briefing: {
      /** 请求桌面主进程显示当前账号的明日简报，并返回是否成功显示。 */
      show(body: string, account: string | null): Promise<boolean>;
      /** 显示生日通知，按账号、生日日期和提醒阶段分别去重。 */
      showBirthday(body: string, account: string | null, key: string): Promise<boolean>;
      /** 订阅晚间简报检查事件，并返回取消订阅的方法。 */
      onCheck(cb: () => void): () => void;
    };
    data: DesktopDataApi;
    quickAdd: {
      /** 隐藏快速添加窗口。 */
      hide(): void;
    };
    weather: {
      /** 更新桌面天气功能使用的城市坐标。 */
      setLocation(loc: { name: string; lat: number; lon: number }): Promise<void>;
    };
  }

  interface Window {
    desktopAPI?: DesktopApi;
  }
}

export {};
