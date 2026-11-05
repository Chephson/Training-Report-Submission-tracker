import { unzipSync, strFromU8 } from 'fflate'

/* ------------------------------------------------------------------ *
 * Normalisers
 * ------------------------------------------------------------------ */

export function normEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/[^\s<>",;]+@[^\s<>",;]+\.[^\s<>",;]+/)
  if (!m) return null
  return m[0].toLowerCase().replace(/\.$/, '')
}

const TITLES = /^(dr|mr|mrs|ms|miss|prof|professor|sir|madam|rev)\.?\s+/i

/** Lowercase, strip punctuation/diacritics, collapse whitespace. */
export function normName(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Surname, Firstname" -> "firstname surname"; also drops titles. */
function nameVariants(raw: string): string[] {
  const base = raw.replace(TITLES, '').replace(/’/g, "'").trim()
  const out = new Set<string>()
  const push = (s: string) => {
    const n = normName(s)
    if (n) out.add(n)
  }
  push(base)
  const comma = base.split(',')
  if (comma.length === 2) {
    push(`${comma[1]} ${comma[0]}`)
    push(`${comma[0]} ${comma[1]}`)
  }
  // "Doe J." style initials: keep only tokens of length > 1
  push(normName(base).split(' ').filter((t) => t.length > 1).join(' '))
  return [...out]
}

export function namesMatch(a: string, b: string): boolean {
  const va = nameVariants(a)
  const vb = nameVariants(b)
  for (const x of va) {
    for (const y of vb) {
      if (x === y) return true
      // tolerate a missing middle name / initials: every token of the
      // shorter string appears in the longer one
      const sx = new Set(x.split(' '))
      const sy = new Set(y.split(' '))
      const [small, big] = sx.size <= sy.size ? [sx, sy] : [sy, sx]
      if (small.size >= 2 && [...small].every((t) => big.has(t))) return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v))) {
    const n = Number(v)
    // Excel serial dates (roughly 1954 - 2118)
    if (n > 20000 && n < 80000) {
      return new Date(EXCEL_EPOCH + n * 86400000).toISOString()
    }
    if (n > 1e12) return new Date(n).toISOString()
  }
  if (typeof v === 'number') return null
  const s = String(v).trim()
  if (!s) return null

  // ISO-ish first: 2026-11-04 / 2026-11-04T10:22:00Z
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = iso
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)).toISOString()
  }
  // UK style: 04/11/2026 10:22  (day first when unambiguous)
  const uk = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*([AaPp][Mm]))?/)
  if (uk) {
    let [, a, b, y, h = '0', mi = '0', se = '0', ampm] = uk
    let d = +a
    let mo = +b
    if (mo > 12 && d <= 12) [d, mo] = [mo, d] // clearly month-first
    let year = +y
    if (year < 100) year += year < 70 ? 2000 : 1900
    let hour = +h
    if (ampm) {
      const pm = ampm.toLowerCase() === 'pm'
      if (pm && hour < 12) hour += 12
      if (!pm && hour === 12) hour = 0
    }
    return new Date(Date.UTC(year, mo - 1, d, hour, +mi, +se)).toISOString()
  }
  const parsed = Date.parse(s)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

/* ------------------------------------------------------------------ *
 * Delimited text (CSV / TSV)
 * ------------------------------------------------------------------ */

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 5000).split(/\r?\n/).slice(0, 5).join('\n')
  const counts: Record<string, number> = {
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
    '\t': (sample.match(/\t/g) || []).length,
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ','
}

export function parseDelimited(input: string): { headers: string[]; rows: string[][] } {
  const text = input.replace(/^\uFEFF/, '')
  const delim = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch === '\r') {
      // ignore, handled by \n
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  const cleaned = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (!cleaned.length) return { headers: [], rows: [] }
  const headers = cleaned[0].map((h) => h.trim())
  return { headers, rows: cleaned.slice(1) }
}

/* ------------------------------------------------------------------ *
 * XLSX (minimal, dependency-light reader built on fflate)
 * ------------------------------------------------------------------ */

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
}

function colToIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase()
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function parseXlsx(bytes: Uint8Array): { headers: string[]; rows: string[][] } {
  const files = unzipSync(bytes)
  const readText = (p: string) => (files[p] ? strFromU8(files[p]) : '')

  // --- shared strings
  const shared: string[] = []
  const sst = readText('xl/sharedStrings.xml')
  if (sst) {
    for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) || []) {
      const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlUnescape(m[1]))
      shared.push(parts.join(''))
    }
  }

  // --- first sheet
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = readText('xl/workbook.xml')
  const rels = readText('xl/_rels/workbook.xml.rels')
  if (wb && rels) {
    const firstSheet = wb.match(/<sheet[^>]*r:id="([^"]+)"/)
    if (firstSheet) {
      const rid = firstSheet[1]
      const rel = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))
      if (rel) {
        const target = rel[1].replace(/^\/?xl\//, '').replace(/^\.\//, '')
        sheetPath = `xl/${target}`
      }
    }
  }

  // --- date-formatted style indexes (so serial dates are recognised)
  let dateStyles = new Set<number>()
  const styles = readText('xl/styles.xml')
  if (styles) {
    const cellXfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)
    if (cellXfs) {
      const xfs = cellXfs[1].match(/<xf\b[^>]*>/g) || []
      xfs.forEach((xf, i) => {
        const id = xf.match(/numFmtId="(\d+)"/)
        if (id && [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47].includes(+id[1])) {
          dateStyles.add(i)
        }
      })
    }
    for (const m of styles.matchAll(/<numFmt[^>]*formatCode="([^"]+)"/g)) {
      const code = xmlUnescape(m[1])
      if (/[dmy]/i.test(code) && !/[#0]/.test(code)) {
        // register its id too
        const idm = m[0].match(/numFmtId="(\d+)"/)
        if (idm) dateStyles.add(+idm[1])
      }
    }
  }

  const sheet = readText(sheetPath)
  if (!sheet) return { headers: [], rows: [] }

  const grid: string[][] = []
  for (const rowXml of sheet.match(/<row[\s\S]*?<\/row>/g) || []) {
    const row: string[] = []
    for (const cellXml of rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || []) {
      const refM = cellXml.match(/r="([A-Z]+\d+)"/)
      const idx = refM ? colToIndex(refM[1]) : row.length
      const t = (cellXml.match(/t="([^"]+)"/) || [])[1]
      const sIdx = (cellXml.match(/\bs="(\d+)"/) || [])[1]
      let val = ''

      if (t === 'inlineStr') {
        val = [...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlUnescape(m[1])).join('')
      } else {
        const vm = cellXml.match(/<v>([\s\S]*?)<\/v>/)
        if (vm) {
          const raw = xmlUnescape(vm[1])
          if (t === 's') val = shared[Number(raw)] ?? ''
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE'
          else val = raw
        }
      }

      // Excel dates arrive as serial numbers — normalise them to a readable value
      if (val && sIdx !== undefined && dateStyles.has(Number(sIdx)) && /^\d+(\.\d+)?$/.test(val)) {
        const n = Number(val)
        if (n > 20000 && n < 80000) {
          val = new Date(EXCEL_EPOCH + n * 86400000).toISOString()
        }
      }
      row[idx] = val
    }
    grid.push(Array.from(row, (v) => v ?? ''))
  }

  const cleaned = grid.filter((r) => r.some((c) => String(c).trim() !== ''))
  if (!cleaned.length) return { headers: [], rows: [] }
  const headers = cleaned[0].map((h) => String(h).trim())
  return { headers, rows: cleaned.slice(1).map((r) => r.map((c) => String(c))) }
}

/* ------------------------------------------------------------------ *
 * Column / field detection
 * ------------------------------------------------------------------ */

const EMAIL_RE = /(e-?mail|email address|mail id|responder|username|user name)/i
const NAME_RE = /(full ?name|staff ?name|employee ?name|name of|^name$|responder name|surname|last name|first name)/i
const TIME_RE = /(completion ?time|submitted|submit time|date ?(?:and|&)? ?time|timestamp|date of submission|time of submission|completed on|response date|^date$)/i
const ID_RE = /(response ?id|^id$)/i

export type Mapping = { email?: number; name?: number; time?: number; id?: number; programme?: number }

export function detectColumns(headers: string[]): Mapping {
  const map: Mapping = {}
  headers.forEach((h, i) => {
    if (map.time === undefined && TIME_RE.test(h)) map.time = i
    else if (map.email === undefined && EMAIL_RE.test(h) && !/name/i.test(h)) map.email = i
    else if (map.name === undefined && NAME_RE.test(h)) map.name = i
    else if (map.id === undefined && ID_RE.test(h)) map.id = i
    else if (map.programme === undefined && /(training programme|programme attended|course title|course name|training title|programme name)/i.test(h)) map.programme = i
  })
  return map
}

/* ------------------------------------------------------------------ *
 * Webhook payload extraction (Power Automate / Graph / Zapier / custom)
 * ------------------------------------------------------------------ */

export type IngestRecord = {
  email: string | null
  full_name: string | null
  submitted_at: string | null
  response_id: string | null
  notes: string | null
  training_programme: string | null
  training_start_date: string | null
  duration_days: number | null
  raw: unknown
}

function flatten(obj: unknown, out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || depth > 4) return out
  if (Array.isArray(obj)) {
    obj.slice(0, 5).forEach((v, i) => flatten(v, out, depth + 1))
    return out
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      out[k] = JSON.stringify(v)
      flatten(v, out, depth + 1)
    } else {
      out[k] = v
    }
  }
  return out
}

function pick(obj: Record<string, unknown>, re: RegExp, test: (v: string) => boolean): string | null {
  const entries = Object.entries(obj)
  const scored = entries
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : v == null ? '' : String(v)
      const keyHit = re.test(k.replace(/[_\-.]+/g, ' ')) ? 2 : 0
      return { s, score: test(s) ? keyHit + 1 : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.length ? scored[0].s : null
}

/** Turn any JSON body from a form-integration into a normalised record. */
export function extractRecord(body: unknown): IngestRecord | null {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  // unwrap common envelopes
  const inner =
    (root.body && typeof root.body === 'object' ? (root.body as Record<string, unknown>) : null) ||
    (root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : null) ||
    root

  const flat = flatten(inner)
  const flatRoot = flatten(root)

  const email =
    normEmail(flat.email) ||
    normEmail(flat.Email) ||
    normEmail(pick({ ...flat, ...flatRoot }, /(e-?mail|responder|mail)/i, (v) => !!normEmail(v)))

  const name =
    (typeof flat.full_name === 'string' && flat.full_name) ||
    (typeof flat.fullName === 'string' && flat.fullName) ||
    (typeof flat.name === 'string' && flat.name) ||
    (typeof flat.responder === 'string' && !normEmail(flat.responder) ? flat.responder : null) ||
    pick({ ...flat, ...flatRoot }, /(name|responder|employee|staff)/i, (v) =>
      v.length > 2 && v.length < 80 && !v.includes('@') && /[a-zA-Z]/.test(v)
    )

  const timeRaw =
    flat.submitted_at ?? flat.submittedAt ?? flat.submitDate ?? flat.completionTime ??
    flat.completion_time ?? flat.timestamp ?? flat.createdDateTime ?? flat.created_at ?? null
  const time =
    parseDate(timeRaw as string) ||
    parseDate(pick({ ...flat, ...flatRoot }, /(time|date|submitted|completed|timestamp)/i, (v) => !!parseDate(v)) as string) ||
    new Date().toISOString()

  const idRaw =
    flat.response_id ?? flat.responseId ?? flat.id ?? flat.responderId ?? null

  return {
    email,
    full_name: name ? String(name).trim() : null,
    submitted_at: time,
    response_id: idRaw ? String(idRaw) : null,
    notes: null,
    training_programme: (typeof flat.training_programme === 'string' && flat.training_programme) || (typeof flat.trainingProgramme === 'string' && flat.trainingProgramme) || (typeof flat.programme === 'string' && flat.programme) || (typeof flat.course === 'string' && flat.course) || pick({ ...flat, ...flatRoot }, /(training programme|programme attended|course title|course name|training title|programme name)/i, (v) => v.trim().length > 1),
    training_start_date: parseDate(flat.training_start_date ?? flat.trainingStartDate ?? flat.course_start_date ?? flat.courseStartDate ?? pick({ ...flat, ...flatRoot }, /(training start date|course start date|programme start date)/i, (v) => !!parseDate(v))),
    duration_days: (() => { const v = flat.duration_days ?? flat.durationDays ?? flat.training_duration_days ?? flat.trainingDurationDays ?? pick({ ...flat, ...flatRoot }, /(training duration|course duration|duration days)/i, (x) => Number(x) > 0); const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null })(),
    raw: body,
  }
}
