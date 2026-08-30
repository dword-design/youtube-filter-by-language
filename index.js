import { Innertube } from 'youtubei.js'

const query = process.argv.slice(2).join(' ').trim()
const maxResults = Number(process.env.MAX_RESULTS ?? 50)

if (!query) {
  console.error('Usage: node index.js <search query>')
  process.exit(1)
}

const youtube = await Innertube.create({
  lang: 'de',
  location: 'DE',
})

function suppressYoutubeJsLogs() {
  const originalWarn = console.warn
  const originalError = console.error

  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('[YOUTUBEJS]')) return
    originalWarn(...args)
  }

  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('[YOUTUBEJS]')) return
    originalError(...args)
  }

  return () => {
    console.warn = originalWarn
    console.error = originalError
  }
}

function isGermanLanguageCode(code) {
  return typeof code === 'string' && code.toLowerCase().startsWith('de')
}

function videoLooksGerman(info) {
  const language = info.basic_info?.language
  if (isGermanLanguageCode(language)) return true

  const captionTracks = info.captions?.caption_tracks ?? []
  return captionTracks.some((track) => isGermanLanguageCode(track.language_code))
}

async function getSearchVideos(youtubeClient, searchQuery, limit) {
  const collected = []
  const seenIds = new Set()

  let page = await youtubeClient.search(searchQuery)

  while (page && collected.length < limit) {
    for (const video of page.videos ?? []) {
      if (!video?.id || seenIds.has(video.id)) continue
      seenIds.add(video.id)
      collected.push(video)
      if (collected.length >= limit) break
    }

    if (collected.length >= limit) break
    if (typeof page.getContinuation !== 'function') break

    try {
      page = await page.getContinuation()
    } catch {
      break
    }
  }

  return collected
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let index = 0

  async function worker() {
    while (true) {
      const current = index
      index += 1
      if (current >= items.length) return
      results[current] = await mapper(items[current], current)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

const restoreConsole = suppressYoutubeJsLogs()

try {
  const videos = await getSearchVideos(youtube, query, maxResults)

  const videoChecks = await mapWithConcurrency(videos, 5, async (video) => {
    try {
      const info = await youtube.getInfo(video.id)
      if (!videoLooksGerman(info)) return null

      return {
        title: video.title?.toString() ?? null,
        url: `https://www.youtube.com/watch?v=${video.id}`,
      }
    } catch {
      return null
    }
  })

  const germanVideos = videoChecks.filter(Boolean)

  for (const video of germanVideos) {
    console.log(`${video.title} | ${video.url}`)
  }
} finally {
  restoreConsole()
}