import type { DiarySearch } from "../../src/lib/diary.ts";
import type { IndexedDiary } from "./diary-store.ts";
export const DIARY_INDEX = "calendar-diaries-v1";
export class DiarySearchUnavailable extends Error {}
/** 构造固定账号过滤、排除删除记录、日期范围和分页的 ES 关键词查询。 */
export function diarySearchBody(accountId: string, input: DiarySearch) {
  const filter: unknown[] = [{ term: { accountId } }, { term: { deleted: false } }];
  if (input.from || input.to)
    filter.push({
      range: {
        date: {
          ...(input.from ? { gte: input.from } : {}),
          ...(input.to ? { lte: input.to } : {}),
        },
      },
    });
  return {
    from: (input.page - 1) * 20,
    size: 20,
    track_total_hits: true,
    query: {
      bool: {
        filter,
        must: [
          { multi_match: { query: input.q, fields: ["title^3", "content"], operator: "and" } },
        ],
      },
    },
    sort: ["_score", { date: "desc" }],
    _source: ["date", "revision"],
  };
}
export class DiarySearchIndex {
  /** 保存搜索服务地址及可选 API 密钥，并校验索引名称。 */
  constructor(
    private url: string,
    private apiKey?: string,
    readonly index = DIARY_INDEX,
  ) {
    if (!/^[a-z][a-z0-9_-]{2,100}$/.test(index)) throw Error("索引名称无效");
  }
  /** 向 ES 发送带超时的 JSON 请求，网络失败时转换为搜索不可用提示。 */
  async call(path: string, method: string, body?: unknown) {
    try {
      return await fetch(this.url.replace(/\/$/, "") + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: "ApiKey " + this.apiKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      throw new DiarySearchUnavailable("搜索服务暂时不可用，日记保存不受影响，请稍后重试");
    }
  }
  /** 检查索引是否存在，不存在时创建支持中文分词的日记映射。 */
  async ensure() {
    const exists = await this.call("/" + this.index, "HEAD");
    if (exists.ok) return;
    if (exists.status !== 404) throw new DiarySearchUnavailable("搜索服务暂时不可用");
    const r = await this.call("/" + this.index, "PUT", {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        dynamic: "strict",
        properties: {
          accountId: { type: "keyword" },
          date: { type: "date" },
          revision: { type: "long" },
          deleted: { type: "boolean" },
          title: { type: "text", analyzer: "cjk" },
          content: { type: "text", analyzer: "cjk" },
        },
      },
    });
    if (
      !r.ok &&
      !(r.status === 400 && (await r.text()).includes("resource_already_exists_exception"))
    )
      throw new DiarySearchUnavailable("搜索索引初始化失败");
  }
  /** 以账号和日期标识文档，按外部版本号写入正文或删除状态，避免旧任务覆盖新内容。 */
  async put(entry: IndexedDiary) {
    const id = Buffer.from(JSON.stringify([entry.accountId, entry.date])).toString("base64url");
    const r = await this.call(
      `/${this.index}/_doc/${id}?version=${entry.revision}&version_type=external_gte&refresh=wait_for`,
      "PUT",
      {
        accountId: entry.accountId,
        date: entry.date,
        revision: entry.revision,
        deleted: entry.deleted,
        title: entry.deleted ? "" : entry.title,
        content: entry.deleted ? "" : entry.content,
      },
    );
    if (!r.ok && r.status !== 409) throw new DiarySearchUnavailable("搜索索引更新失败");
  }
  /** 执行当前账号的关键词查询，返回命中文档的日期、版本和总数。 */
  async search(
    accountId: string,
    input: DiarySearch,
  ): Promise<{ total: number; hits: { date: string; revision: number }[] }> {
    await this.ensure();
    const r = await this.call(
      "/" + this.index + "/_search",
      "POST",
      diarySearchBody(accountId, input),
    );
    if (!r.ok) throw new DiarySearchUnavailable("搜索服务暂时不可用，请稍后重试");
    const body = (await r.json()) as {
      hits: { total: { value: number }; hits: { _source: { date: string; revision: number } }[] };
    };
    return { total: body.hits.total.value, hits: body.hits.hits.map((h) => h._source) };
  }
}
