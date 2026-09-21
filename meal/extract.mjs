import { readFile, writeFile, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  maxMealBytes,
  addMealDays,
  parseMealWeek,
} from './schema.mjs'

export const DEFAULT_MODEL = 'inclusionai/ling-3.0-flash-vl:free'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function imageMimeType(bytes) {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  ) {
    return 'image/jpeg'
  }
  throw new Error('Unsupported image format; expected PNG or JPEG.')
}

export function buildPrompt(weekStart, weekEnd) {
  return `당신은 서강대학교 벨라르민 기숙사 식단표 이미지에서 식단 정보를 추출하여 정해진 JSON 형식으로 출력하는 시스템입니다.
제공된 이미지는 ${weekStart}(월요일)부터 ${weekEnd}(일요일)까지의 주간 식단표입니다.

식단표 구성:
- 열(Columns): 월요일부터 일요일까지 7개 열 (순서대로 월, 화, 수, 목, 금, 토, 일)
- 행(Rows):
  1. 조식 한식 (Breakfast Korean)
  2. 조식 일품/양식 (Breakfast Western)
  3. 조식 공통 (Breakfast Common - 표 전체에 걸쳐 1개 행으로 공통 제공 항목이 기재됨. 예: "그린샐러드 & 드레싱 & 셀프계란후라이")
  4. 컵밥 (Cup Rice - 제공 시간(예: 11:40)과 메뉴명. 해당 요일에 운영하지 않으면 비어있음)
  5. 석식 (Dinner - 저녁 메뉴 목록. 토요일 등 미운영 시 "토요일석식미운영" 또는 "미운영")
  6. 음료 (Drink - 석식에 공통 제공되는 음료. 예: "디톡스워터")

추출 규칙:
1. 메뉴 항목은 음식명만 추출하고, 칼로리(kcal), 원산지, 홍보 문구, 영양사 연락처 등은 제외하세요.
2. 텍스트는 원본 한글 표기를 그대로 유지하세요.
3. 컵밥의 경우 제공 시간이 명시되어 있다면 "time" 필드에 "HH:mm" 형태로 추출하고, 메뉴는 "menu" 배열에 넣으세요. 운영하지 않는 요일은 cupRice를 null로 설정하세요.
4. 석식이 미운영("토요일석식미운영", "미운영" 등)인 경우 "closed": true로 설정하고 "menu"는 []로 하세요. 운영되는 경우 "closed": false로 설정하세요.
5. 조식 공통과 음료는 표에 적힌 문자열 그대로 추출하세요. 만약 표에 없다면 빈 배열 []로 하세요.

반드시 마크다운 코드블록이나 추가 설명 없이 다음 JSON 형식으로만 순수하게 출력하세요:
{
  "commonBreakfast": ["공통조식항목"],
  "commonDrink": ["공통음료"],
  "days": [
    {
      "dayOfWeek": "월",
      "korean": ["메뉴1", "메뉴2"],
      "western": ["메뉴1", "메뉴2"],
      "cupRice": { "time": "11:40", "menu": ["메뉴1"] },
      "dinner": { "closed": false, "menu": ["메뉴1", "메뉴2"] }
    }
  ]
}`
}

export function parseModelJson(raw) {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed)
  if (match) {
    try {
      return JSON.parse(match[1].trim())
    } catch {}
  }
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1))
    } catch {}
  }
  throw new Error('Failed to parse JSON from model output')
}

export function normalizeMenuDays(parsed, weekStart) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.days)) {
    throw new Error('Invalid model output structure; missing days array.')
  }
  if (parsed.days.length !== 7) {
    throw new Error(`Expected 7 days, got ${parsed.days.length}.`)
  }

  const cleanItems = (items) => {
    if (!Array.isArray(items)) return []
    return items
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0 && !/\p{Cc}/u.test(item))
      .map((item) => (item.length > 120 ? item.slice(0, 120) : item))
      .slice(0, 12)
  }

  const cleanTime = (time) => {
    if (typeof time !== 'string') return null
    const match = /(?:^|\s)([01]\d|2[0-3]):([0-5]\d)(?:\s|$)/.exec(time)
    return match ? `${match[1]}:${match[2]}` : null
  }

  const commonBreakfastItems = cleanItems(parsed.commonBreakfast)
  const commonDrinkItems = cleanItems(parsed.commonDrink)

  const result = []
  for (let i = 0; i < 7; i++) {
    const day = parsed.days[i] || {}
    const date = addMealDays(weekStart, i)

    const koreanItems = cleanItems(day.korean)
    const westernItems = cleanItems(day.western)

    const korean =
      koreanItems.length > 0
        ? { status: 'available', items: koreanItems, serviceTime: null }
        : { status: 'unlisted', items: [], serviceTime: null }

    const western =
      westernItems.length > 0
        ? { status: 'available', items: westernItems, serviceTime: null }
        : { status: 'unlisted', items: [], serviceTime: null }

    const common =
      (korean.status === 'available' || western.status === 'available') &&
      commonBreakfastItems.length > 0
        ? { status: 'available', items: commonBreakfastItems, serviceTime: null }
        : { status: 'unlisted', items: [], serviceTime: null }

    let cupRice
    if (day.cupRice && typeof day.cupRice === 'object') {
      const cupRiceItems = cleanItems(day.cupRice.menu ?? day.cupRice.items)
      const serviceTime = cleanTime(day.cupRice.time ?? day.cupRice.serviceTime)
      cupRice =
        cupRiceItems.length > 0
          ? { status: 'available', items: cupRiceItems, serviceTime }
          : { status: 'unlisted', items: [], serviceTime: null }
    } else {
      cupRice = { status: 'unlisted', items: [], serviceTime: null }
    }

    let dinner
    const dinnerObj = day.dinner || {}
    const isDinnerClosed =
      Boolean(dinnerObj.closed) ||
      (Array.isArray(dinnerObj.menu) &&
        dinnerObj.menu.some(
          (m) => typeof m === 'string' && m.replace(/\s+/g, '').includes('미운영'),
        ))
    if (isDinnerClosed) {
      dinner = { status: 'closed', items: [], serviceTime: null }
    } else {
      const dinnerItems = cleanItems(dinnerObj.menu ?? dinnerObj.items)
      dinner =
        dinnerItems.length > 0
          ? { status: 'available', items: dinnerItems, serviceTime: null }
          : { status: 'unlisted', items: [], serviceTime: null }
    }

    const drink =
      dinner.status === 'available' && commonDrinkItems.length > 0
        ? { status: 'available', items: commonDrinkItems, serviceTime: null }
        : { status: 'unlisted', items: [], serviceTime: null }

    result.push({
      date,
      breakfast: { korean, western, common },
      cupRice,
      dinner,
      drink,
    })
  }

  return result
}

export async function callOpenRouter({
  imageBytes,
  mimeType,
  weekStart,
  weekEnd,
  apiKey,
  model = DEFAULT_MODEL,
  fetcher = fetch,
  retries = 2,
}) {
  const prompt = buildPrompt(weekStart, weekEnd)
  const base64 = imageBytes.toString('base64')
  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await delay(2000 * Math.pow(2, attempt - 1))
    }
    try {
      const res = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/Hiyabye/sogang-notices',
          'X-Title': 'Sogang Notices Meal Extractor',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })

      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(
          `OpenRouter API error ${res.status}: ${errorText.slice(0, 200)}`,
        )
      }

      const json = await res.json()
      const content = json.choices?.[0]?.message?.content
      if (!content || typeof content !== 'string') {
        throw new Error('OpenRouter response has no content')
      }
      return content
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

async function loadEnv() {
  if (process.env.OPENROUTER_API || process.env.OPENROUTER_API_KEY) return
  try {
    const envFile = await readFile('.env', 'utf8')
    for (const line of envFile.split('\n')) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (match && !process.env[match[1]]) {
        let val = match[2]
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        process.env[match[1]] = val
      }
    }
  } catch {
    // .env not present, ignore
  }
}

async function boundedJson(path, max = maxMealBytes * 3) {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(max + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
      )
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > max) throw new Error('Artifact exceeds byte limit.')
    return JSON.parse(buffer.subarray(0, length).toString('utf8'))
  } finally {
    await file.close()
  }
}

export async function extractMeals(
  work,
  {
    apiKey = process.env.OPENROUTER_API || process.env.OPENROUTER_API_KEY,
    model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    fetcher = fetch,
  } = {},
) {
  const manifest = await boundedJson(join(work, 'prepared.json'))
  const pipeline = manifest.pipelineId
  const candidates = manifest.candidates
  if (!Array.isArray(candidates) || !/^[a-f0-9]{64}$/.test(pipeline)) {
    throw new Error('Invalid prepared meal artifact.')
  }

  const needsExtraction = candidates.some((c) => !c.reused)
  if (needsExtraction && !apiKey) {
    throw new Error(
      'Missing OPENROUTER_API_KEY (or OPENROUTER_API) environment variable.',
    )
  }

  const results = []
  for (const candidate of candidates) {
    if (candidate.reused !== null) continue
    const postId = candidate.source?.postId
    if (
      !/^[1-9]\d{0,15}$/.test(postId) ||
      candidate.image !== `${postId}.image`
    ) {
      throw new Error('Invalid image identity.')
    }

    const imagePath = join(work, candidate.image)
    const imageBytes = await readFile(imagePath)
    if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
      throw new Error('Image size out of bounds.')
    }

    const digest = createHash('sha256').update(imageBytes).digest('hex')
    if (digest !== candidate.source?.imageSha256) {
      throw new Error('Image artifact hash mismatch.')
    }

    const base = { postId, imageSha256: digest, pipelineId: pipeline }

    try {
      const mimeType = imageMimeType(imageBytes)
      const rawOutput = await callOpenRouter({
        imageBytes,
        mimeType,
        weekStart: candidate.weekStart,
        weekEnd: candidate.weekEnd,
        apiKey,
        model,
        fetcher,
      })

      const parsed = parseModelJson(rawOutput)
      const days = normalizeMenuDays(parsed, candidate.weekStart)
      const extractedAt = new Date().toISOString()

      // Validate entire constructed week against Schema-1 contract
      parseMealWeek(
        {
          weekStart: candidate.weekStart,
          weekEnd: candidate.weekEnd,
          source: candidate.source,
          pipelineId: pipeline,
          extractedAt,
          verifiedAt: extractedAt,
          days,
        },
        Date.now(),
      )

      results.push({
        ...base,
        status: 'ok',
        errorCode: null,
        extractedAt,
        days,
      })
    } catch (error) {
      console.error(
        `Meal extraction rejected for post ${postId}:`,
        error.message,
      )
      results.push({
        ...base,
        status: 'rejected',
        errorCode: 'ocr-quality',
      })
    }
  }

  const encoded = JSON.stringify(results)
  if (Buffer.byteLength(encoded) > maxMealBytes) {
    throw new Error('Extraction results exceed byte limit.')
  }
  await writeFile(join(work, 'ocr-results.json'), encoded)
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await loadEnv()
  let work = 'work'
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--work=')) {
      work = arg.slice('--work='.length)
    } else if (arg === '--work') {
      const next = process.argv[process.argv.indexOf(arg) + 1]
      if (next && !next.startsWith('--')) work = next
    }
  }
  await extractMeals(work)
}
