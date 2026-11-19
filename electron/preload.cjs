const { contextBridge, ipcRenderer } = require("electron");

const api = {
  briefing: {
    /** 通过 IPC 请求主进程显示当前账号的明日简报。 */
    show: (body, account) => ipcRenderer.invoke("briefing:show", { body, account }),
    /** 请求主进程显示生日通知，按生日和提醒阶段持久化去重。 */
    showBirthday: (body, account, key) =>
      ipcRenderer.invoke("briefing:show", { body, account, birthdayKey: key }),
    /** 订阅晚间简报检查事件，并返回取消订阅的方法。 */
    onCheck(cb) {
      /** 将主进程的简报检查事件转交给渲染页面回调。 */
      const listener = () => cb();
      ipcRenderer.on("briefing:check", listener);
      return () => ipcRenderer.removeListener("briefing:check", listener);
    },
  },
  data: {
    /** 请求主进程原子保存 AI 计划，账号在主进程再次检查。 */
    addAiPlans: (input) => ipcRenderer.invoke("data:addAiPlans", input),
    /** 应用时间线修改，同时校验版本并重算相关排程。 */
    changeTimeline: (input) => ipcRenderer.invoke("data:changeTimeline", input),
    /** 通过 IPC 从主进程读取当前账号的完整日历快照。 */
    load: () => ipcRenderer.invoke("data:load"),
    /** 新增指定日期的计划。 */
    addPlan: (input) => ipcRenderer.invoke("data:addPlan", input),
    /** 切换计划的完成状态。 */
    togglePlan: (id) => ipcRenderer.invoke("data:togglePlan", { id }),
    /** 删除指定计划，保留同步所需的删除标记。 */
    removePlan: (id) => ipcRenderer.invoke("data:removePlan", { id }),
    /** 新增指定日期的每日记录。 */
    addNote: (input) => ipcRenderer.invoke("data:addNote", input),
    /** 删除每日记录，保留同步所需的删除标记。 */
    removeNote: (id) => ipcRenderer.invoke("data:removeNote", { id }),
    /** 新增需要持续打卡的习惯。 */
    addHabit: (input) => ipcRenderer.invoke("data:addHabit", input),
    /** 切换指定习惯在某一天的打卡状态。 */
    toggleHabitCheckIn: (input) => ipcRenderer.invoke("data:toggleHabitCheckIn", input),
    /** 移除指定习惯。 */
    removeHabit: (id) => ipcRenderer.invoke("data:removeHabit", { id }),
    /** 新增纪念日，并保留单次或每年重复的类型。 */
    addAnniversary: (input) => ipcRenderer.invoke("data:addAnniversary", input),
    /** 移除指定纪念日。 */
    removeAnniversary: (id) => ipcRenderer.invoke("data:removeAnniversary", { id }),
    /** 新增提醒规则。 */
    addReminder: (input) => ipcRenderer.invoke("data:addReminder", input),
    /** 启用或停用指定提醒。 */
    setReminderEnabled: (id, enabled) =>
      ipcRenderer.invoke("data:setReminderEnabled", { id, enabled }),
    /** 移除指定提醒。 */
    removeReminder: (id) => ipcRenderer.invoke("data:removeReminder", { id }),
    /** 设置天气卡片使用的常住城市。 */
    setHomeCity: (city) => ipcRenderer.invoke("data:setHomeCity", city),
    /** 设置关注城市；传入空值时取消关注。 */
    setWatchCity: (city) => ipcRenderer.invoke("data:setWatchCity", city),
    /** 更新计划的分享对象列表。 */
    setPlanShare: (id, usernames) => ipcRenderer.invoke("data:setPlanShare", { id, usernames }),
    /** 更新每日记录的分享对象列表。 */
    setNoteShare: (id, usernames) => ipcRenderer.invoke("data:setNoteShare", { id, usernames }),
    /** 切换当前账号的数据存储，空账号对应未登录时的本地数据。 */
    setAccount: (username) => ipcRenderer.invoke("data:setAccount", username),
    /** 用完整数据快照替换当前账号的本地数据。 */
    replaceAll: (data) => ipcRenderer.invoke("data:replaceAll", data),
    /** 订阅日历数据变化，并返回取消订阅的方法。 */
    subscribe(cb) {
      /** 将主进程广播的日历快照转交给页面订阅者。 */
      const listener = (_e, data) => cb(data);
      ipcRenderer.on("data:changed", listener);
      return () => ipcRenderer.removeListener("data:changed", listener);
    },
  },
  quickAdd: {
    /** 隐藏快速添加窗口。 */
    hide: () => ipcRenderer.send("quick-add:hide"),
  },
  weather: {
    /** 更新桌面天气功能使用的城市坐标。 */
    setLocation: (loc) => ipcRenderer.invoke("weather:setLocation", loc),
  },
};

contextBridge.exposeInMainWorld("desktopAPI", api);
