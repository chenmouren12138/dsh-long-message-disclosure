/**
 * Host half of @local/dsh-long-message-disclosure.
 *
 * The disclosure itself lives in the browser: the Client half replaces the
 * `text` cell of the message-body text seat with a composable disclosure
 * container. This half owns the runtime policy: it validates the row config and
 * publishes the resolved props on a same-origin route the Client half reads
 * once per page load. Nothing model-facing is registered.
 */
import { Config, DEFAULTS, publicConfig, resolveConfig } from './lib/config.js'

export const name = 'dsh-long-message-disclosure'
export { Config }

const CONFIG_PATH = '/dsh-long-message-disclosure/config'

function createHandler(policy) {
  const body = JSON.stringify({ ok: true, data: policy })
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  }
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      res.end('method not allowed')
      return
    }
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

export function apply(ctx, rawConfig) {
  const { value, issues } = resolveConfig(rawConfig ?? DEFAULTS)
  const policy = publicConfig(value)
  for (const problem of issues) {
    console.warn(`[dsh-long-message-disclosure] config ${problem.path?.join('.') ?? ''}: ${problem.message}`)
  }

  const webServer = ctx.get('webServer')
  if (webServer) {
    ctx.effect(
      () => webServer.register({ kind: 'exact', path: CONFIG_PATH, handler: createHandler(policy) }),
      'dsh-long-message-disclosure: config route',
    )
  } else {
    console.warn('[dsh-long-message-disclosure] webServer 不可用，Client 将使用内置默认策略')
  }

  console.log(
    `[dsh-long-message-disclosure] 已加载：threshold=${policy.threshold} chars, `
      + `preview=${policy.previewChars} chars / ${policy.previewLines} lines, strategy=${policy.strategy}, `
      + `enabled=${policy.enabled}`,
  )
}
