// Cloudflare Workers (workerd): handler trả lời sớm (403/404/409…) mà chưa đọc body của POST/PATCH/PUT/DELETE
// thì yêu cầu kế tiếp bị lỗi 503 "worker restarted". Luôn đọc hết body trước rồi đưa bản sao cho handler.
type Ctx = { params: Promise<Record<string, string>> };
export function drained<T extends Ctx>(impl: (req: Request, ctx: T) => Promise<Response>) {
  return async (req: Request, ctx: T): Promise<Response> => {
    const buf = await req.arrayBuffer();
    const copy = new Request(req.url, { method: req.method, headers: req.headers, body: buf.byteLength === 0 ? undefined : buf });
    return impl(copy, ctx);
  };
}
