/**
 * Runtime policy for @local/dsh-long-message-disclosure.
 *
 * `Config` is a Standard Schema v1 object: Cordis resolves the plugin row's
 * config with `Config['~standard'].validate(...)`. The `schema` member is the
 * documentation surface for Settings / Plugin Manager; `~standard.validate`
 * is the authority and always yields a complete, clamped policy.
 *
 * The Client half consumes the same resolved shape through the same-origin
 * config route, so both halves agree on names and bounds.
 */

export const DEFAULTS = Object.freeze({
  enabled: true,
  threshold: 1200,
  previewChars: 480,
  previewLines: 8,
  previewStrategy: 'boundary',
  labels: Object.freeze({ expand: '', collapse: '', count: '' }),
})

const BOUNDS = {
  threshold: { min: 200, max: 200000 },
  previewChars: { min: 80, max: 20000 },
  previewLines: { min: 1, max: 40 },
}

const STRATEGIES = new Set(['boundary', 'hard'])

function issue(message, path) {
  return { message, path }
}

function readInteger(input, key, issues) {
  const value = input[key]
  if (value === undefined || value === null) return DEFAULTS[key]
  const bound = BOUNDS[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(issue('expected a finite number', [key]))
    return DEFAULTS[key]
  }
  const rounded = Math.round(value)
  if (rounded < bound.min || rounded > bound.max) {
    issues.push(issue(`expected a number between ${bound.min} and ${bound.max}`, [key]))
  }
  return Math.min(bound.max, Math.max(bound.min, rounded))
}

function readLabels(input, issues) {
  const labels = { ...DEFAULTS.labels }
  const raw = input.labels
  if (raw === undefined || raw === null) return labels
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push(issue('expected an object of copy overrides', ['labels']))
    return labels
  }
  for (const key of Object.keys(labels)) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') {
      issues.push(issue('expected a string', ['labels', key]))
      continue
    }
    labels[key] = value.trim().slice(0, 200)
  }
  return labels
}

/**
 * Normalize one raw row config into the complete policy used by both halves.
 * Unknown keys are ignored, bounded numbers are clamped, and the crop budget is
 * kept strictly below the trigger so a disclosure always reveals something.
 */
export function resolveConfig(raw) {
  const issues = []
  const input = raw === undefined || raw === null ? {} : raw
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { value: { ...DEFAULTS, labels: { ...DEFAULTS.labels } }, issues: [issue('expected an object', [])] }
  }

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : DEFAULTS.enabled
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    issues.push(issue('expected a boolean', ['enabled']))
  }

  const threshold = readInteger(input, 'threshold', issues)
  let previewChars = readInteger(input, 'previewChars', issues)
  const previewLines = readInteger(input, 'previewLines', issues)

  if (previewChars >= threshold) {
    // A preview at or above the trigger would collapse a message into itself.
    previewChars = Math.max(BOUNDS.previewChars.min, threshold - 1)
    issues.push(issue('previewChars must be smaller than threshold; clamped', ['previewChars']))
  }

  let previewStrategy = DEFAULTS.previewStrategy
  if (typeof input.previewStrategy === 'string') {
    if (STRATEGIES.has(input.previewStrategy)) previewStrategy = input.previewStrategy
    else issues.push(issue('expected "boundary" or "hard"', ['previewStrategy']))
  } else if (input.previewStrategy !== undefined && input.previewStrategy !== null) {
    issues.push(issue('expected "boundary" or "hard"', ['previewStrategy']))
  }

  return {
    value: {
      enabled,
      threshold,
      previewChars,
      previewLines,
      previewStrategy,
      labels: readLabels(input, issues),
    },
    issues,
  }
}

/** The wire shape the Client half reads: no Host-only fields, no secrets. */
export function publicConfig(value) {
  return {
    enabled: value.enabled,
    threshold: value.threshold,
    previewChars: value.previewChars,
    previewLines: value.previewLines,
    strategy: value.previewStrategy,
    labels: { ...value.labels },
  }
}

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-long-message-disclosure',
    validate(raw) {
      // Always resolve: bounded values clamp, unknown keys are ignored, and a
      // malformed row still yields a usable policy. `apply` logs the problems,
      // so a typo never blocks activation.
      const { value } = resolveConfig(raw)
      return { value }
    },
  },
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Turn the disclosure container on or off. Off renders message bodies exactly like the host.',
      },
      threshold: {
        type: 'integer',
        minimum: BOUNDS.threshold.min,
        maximum: BOUNDS.threshold.max,
        description: 'Message-body length in characters at which the body collapses by default.',
      },
      previewChars: {
        type: 'integer',
        minimum: BOUNDS.previewChars.min,
        maximum: BOUNDS.previewChars.max,
        description: 'Maximum characters mounted for the collapsed preview. The rest of the body stays unmounted.',
      },
      previewLines: {
        type: 'integer',
        minimum: BOUNDS.previewLines.min,
        maximum: BOUNDS.previewLines.max,
        description: 'Visible preview height in wrapped lines; the preview is clipped to this height.',
      },
      previewStrategy: {
        type: 'string',
        enum: ['boundary', 'hard'],
        description: 'Where the preview is cut: at a natural paragraph / sentence / word boundary, or exactly at previewChars.',
      },
      labels: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expand: { type: 'string', description: 'Copy override for the expand trigger. Empty uses the locale dictionary.' },
          collapse: { type: 'string', description: 'Copy override for the collapse trigger. Empty uses the locale dictionary.' },
          count: { type: 'string', description: 'Copy override for the body size hint; {count} is replaced by the character count.' },
        },
      },
    },
  },
}
