/**
 * Client half of @local/dsh-long-message-disclosure.
 *
 * Contributes a composable disclosure container at the message-body layer by
 * replacing the `text` cell of `conversation.user.text.node` — the seat the
 * Conversation package dispatches one user-message text run through. The entry
 * stays a plain inline text run for short bodies (and for every non-interactive
 * surface such as the queue preview), and becomes a WAI-ARIA disclosure for
 * bodies above the runtime threshold:
 *
 * - the trigger carries `aria-expanded` / `aria-controls`;
 * - the collapsed state mounts only the cropped preview, so the rest of the body
 *   is absent from the DOM, the accessibility tree, and the Tab sequence;
 * - toggling keeps the trigger anchored in the viewport, and the correction is
 *   skipped while the reader follows the transcript tail so it never fights the
 *   host's follow / measurement machinery.
 *
 * Props are resolved at registration time from the Host policy route; styles,
 * the locale dictionary, the config fetch, and the registration itself are all
 * owned by plugin effects.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-long-message-disclosure',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-long-message-disclosure'
    const SLOT = 'conversation.user.text.node'
    const SLOT_KEY = 'text'
    const CONFIG_PATH = '/dsh-long-message-disclosure/config'

    /** Must mirror lib/config.js DEFAULTS, used when the Host route is absent. */
    const DEFAULTS = Object.freeze({
      enabled: true,
      threshold: 1200,
      previewChars: 480,
      previewLines: 8,
      strategy: 'boundary',
      labels: Object.freeze({}),
    })

    const ZH = {
      'disclosure.region': '消息正文',
      'disclosure.expand': '展开全文',
      'disclosure.collapse': '收起全文',
      'disclosure.count': '共 {count} 字',
      'disclosure.cropped': '已折叠，仅显示前 {shown} 字',
    }

    const EN = {
      'disclosure.region': 'Message body',
      'disclosure.expand': 'Show full message',
      'disclosure.collapse': 'Collapse message',
      'disclosure.count': '{count} characters',
      'disclosure.cropped': 'Collapsed; showing the first {shown} characters',
    }

    const FALLBACK = ZH

    const CSS = `
.lmd-root{display:block;max-width:100%;overflow-wrap:anywhere}
.lmd-bodyWrap{position:relative;display:block;max-width:100%}
.lmd-body{display:block;max-width:100%;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
.lmd-body[data-open="false"]{max-height:calc((22px + var(--dsh-content-font-delta,0px)) * var(--lmd-lines,8));overflow:hidden}
.lmd-fade{position:absolute;left:0;right:0;bottom:0;height:calc(22px + var(--dsh-content-font-delta,0px));pointer-events:none;background:linear-gradient(180deg,transparent 0%,var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-1)) 94%)}
.lmd-actions{display:flex;align-items:center;gap:8px;margin-top:2px;white-space:nowrap}
.lmd-toggle{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;padding:2px 6px;margin-left:-6px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;white-space:nowrap}
.lmd-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.lmd-toggle:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.lmd-chevron{flex:none;transition:transform .12s ease}
.lmd-chevron[data-open="true"]{transform:rotate(180deg)}
.lmd-count{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.lmd-chevron{transition:none}}
`

    /* ------------------------------- config store ------------------------------ */

    function clampInt(value, fallback, min, max) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
      return Math.min(max, Math.max(min, Math.round(value)))
    }

    function readLabels(raw) {
      const labels = {}
      if (!raw || typeof raw !== 'object') return labels
      for (const key of ['expand', 'collapse', 'count']) {
        const value = raw[key]
        if (typeof value === 'string' && value.trim() !== '') labels[key] = value.trim()
      }
      return labels
    }

    /** Defensive mirror of the Host normalization: the wire is data, not an API. */
    function normalizeConfig(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      const threshold = clampInt(source.threshold, DEFAULTS.threshold, 200, 200000)
      let previewChars = clampInt(source.previewChars, DEFAULTS.previewChars, 80, 20000)
      if (previewChars >= threshold) previewChars = Math.max(80, threshold - 1)
      return {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULTS.enabled,
        threshold,
        previewChars,
        previewLines: clampInt(source.previewLines, DEFAULTS.previewLines, 1, 40),
        strategy: source.strategy === 'hard' ? 'hard' : 'boundary',
        labels: readLabels(source.labels),
      }
    }

    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set(next) {
          const normalized = normalizeConfig(next)
          if (JSON.stringify(normalized) === JSON.stringify(value)) return
          value = normalized
          for (const listener of Array.from(listeners)) {
            try {
              listener()
            } catch (error) {
              console.error('[dsh-long-message-disclosure] config listener failed:', error)
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    /* --------------------------------- helpers -------------------------------- */

    /** Read the display string of a plain JSON text node the way the host does. */
    function readNodeText(node, raw) {
      const data = node && typeof node === 'object' ? node.data : undefined
      if (data && typeof data.display === 'string') return data.display
      if (data && typeof data.text === 'string') return data.text
      return typeof raw === 'string' ? raw : ''
    }

    const BREAKS = ['\n\n', '\n', '。', '！', '？', '；', '. ', '! ', '? ', '; ', '，', ', ', ' ']

    /**
     * Crop a meaningful preview. `boundary` prefers a paragraph, sentence, or
     * word break in the last stretch of the budget; `hard` cuts at the budget.
     */
    function cropPreview(text, budget, strategy) {
      if (text.length <= budget) return { body: text, cropped: false }
      let end = budget
      if (strategy !== 'hard') {
        const window = text.slice(0, budget)
        const floor = Math.floor(budget * 0.55)
        for (const token of BREAKS) {
          const index = window.lastIndexOf(token)
          if (index >= floor) {
            end = index + token.length
            break
          }
        }
      }
      const body = text.slice(0, end).replace(/\s+$/u, '')
      return { body: body === '' ? text.slice(0, budget) : body, cropped: true }
    }

    /** Nearest ancestor that actually scrolls, or null when nothing scrolls. */
    function findScrollContainer(element) {
      let node = element ? element.parentElement : null
      while (node) {
        const style = window.getComputedStyle(node)
        const overflowY = style.overflowY
        if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
          && node.scrollHeight > node.clientHeight + 1) {
          return node
        }
        node = node.parentElement
      }
      return null
    }

    /** True while the reader is pinned to the tail; follow owns the position then. */
    function isFollowingTail(container) {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight
      return distance <= 8
    }

    function copyText(t, overrides, name, fallback) {
      const override = overrides ? overrides[name] : undefined
      if (typeof override === 'string' && override !== '') return override
      const key = `disclosure.${name}`
      const value = typeof t === 'function' ? t(key) : undefined
      return typeof value === 'string' && value !== key ? value : fallback
    }

    function fill(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
      ))
    }

    function Chevron({ open }) {
      return h('svg', {
        className: 'lmd-chevron',
        width: 12,
        height: 12,
        viewBox: '0 0 12 12',
        'data-open': open ? 'true' : 'false',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: 'M2.5 4.25 6 7.75l3.5-3.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /* -------------------------- disclosure container -------------------------- */

    function MessageDisclosure({ text, previewChars, previewLines, strategy, overrides, t }) {
      const reactId = React.useId()
      const bodyId = `lmd-body${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
      const [open, setOpen] = React.useState(false)
      const buttonRef = React.useRef(null)
      const anchorRef = React.useRef(null)
      const preview = React.useMemo(
        () => cropPreview(text, previewChars, strategy),
        [text, previewChars, strategy],
      )

      // Keep the trigger — the reader's eye position — stable across the toggle.
      React.useLayoutEffect(() => {
        const anchor = anchorRef.current
        anchorRef.current = null
        if (!anchor || !anchor.container || anchor.pinned || anchor.top === null) return
        const button = buttonRef.current
        if (!button) return
        const top = button.getBoundingClientRect().top
        const delta = top - anchor.top
        if (Math.abs(delta) > 0.5) anchor.container.scrollTop += delta
      }, [open])

      const toggle = React.useCallback(() => {
        const button = buttonRef.current
        const container = findScrollContainer(button)
        anchorRef.current = {
          container,
          top: button ? button.getBoundingClientRect().top : null,
          pinned: container ? isFollowingTail(container) : true,
        }
        setOpen((value) => !value)
      }, [])

      const total = text.length
      const countLabel = fill(copyText(t, overrides, 'count', FALLBACK['disclosure.count']), {
        count: total.toLocaleString(),
      })
      const actionLabel = open
        ? copyText(t, overrides, 'collapse', FALLBACK['disclosure.collapse'])
        : copyText(t, overrides, 'expand', FALLBACK['disclosure.expand'])
      const croppedLabel = fill(copyText(t, overrides, 'cropped', FALLBACK['disclosure.cropped']), {
        shown: preview.body.length.toLocaleString(),
      })

      return h('div', {
        className: 'lmd-root',
        'data-lmd': 'disclosure',
        'data-lmd-open': open ? 'true' : 'false',
      },
      h('div', { className: 'lmd-bodyWrap' },
        h('div', {
          className: 'lmd-body',
          id: bodyId,
          'data-open': open ? 'true' : 'false',
          style: { '--lmd-lines': String(previewLines) },
          title: open ? undefined : croppedLabel,
        }, open ? text : preview.body),
        open ? null : h('span', { className: 'lmd-fade', 'aria-hidden': 'true' })),
      h('div', { className: 'lmd-actions' },
        h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'lmd-toggle',
          'aria-expanded': open,
          'aria-controls': bodyId,
          onClick: toggle,
        },
        h(Chevron, { open }),
        h('span', { className: 'lmd-actionText' }, actionLabel),
        h('span', { className: 'lmd-count' }, countLabel))))
    }

    /* ------------------------------ slot renderer ----------------------------- */

    function makeRenderer(policy) {
      /**
       * The message-body text cell. Short bodies, disabled policy, and
       * non-interactive surfaces (queue previews, pending echoes) stay plain
       * inline text, exactly like the shipped renderer.
       */
      function LongTextNode(props) {
        const text = readNodeText(props.node, props.raw)
        if (!policy.enabled || props.interactive !== true || text.length <= policy.threshold) {
          return h(React.Fragment, null, text)
        }
        return h(MessageDisclosure, {
          text,
          previewChars: policy.previewChars,
          previewLines: policy.previewLines,
          strategy: policy.strategy,
          overrides: policy.labels,
          t: props.t,
        })
      }
      return LongTextNode
    }

    /* ---------------------------------- styles -------------------------------- */

    function installStyles(ctx, css) {
      const styles = ctx.get('styles')
      if (styles && typeof styles.insert === 'function') return styles.insert(css)
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-long-message-disclosure'
      tag.dataset.pluginCss = '@local/dsh-long-message-disclosure/disclosure.css'
      tag.textContent = css
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    return {
      inject: ['slots', 'locale'],
      // Exposed for the plugin's own render smoke test; the loader only consumes
      // `inject` and `apply`.
      internals: { cropPreview, normalizeConfig, makeRenderer },
      apply(ctx) {
        const store = createStore(DEFAULTS)

        ctx.effect(() => installStyles(ctx, CSS), 'dsh-long-message-disclosure: styles')

        ctx.effect(
          () => ctx.locale.register(NS, { zh: ZH, en: EN }),
          'dsh-long-message-disclosure: dictionaries',
        )

        // The Host half publishes the resolved policy; props are built from it.
        ctx.effect(() => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 3000)
          let live = true
          fetch(CONFIG_PATH, {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
              if (!live || !payload || payload.ok !== true) return
              store.set(payload.data)
            })
            .catch(() => {
              // Keep the compiled defaults; the plugin stays usable.
            })
            .finally(() => clearTimeout(timer))
          return () => {
            live = false
            clearTimeout(timer)
            controller.abort()
          }
        }, 'dsh-long-message-disclosure: config fetch')

        ctx.slots.inject(SLOT, () => {
          let dispose = null
          const install = () => {
            if (dispose) {
              dispose()
              dispose = null
            }
            dispose = ctx.slots.register({
              name: SLOT,
              key: SLOT_KEY,
              priority: 10,
              locale: NS,
            }, makeRenderer(store.get()))
          }
          install()
          const unsubscribe = store.subscribe(install)
          return () => {
            unsubscribe()
            if (dispose) {
              dispose()
              dispose = null
            }
          }
        })
      },
    }
  },
})
