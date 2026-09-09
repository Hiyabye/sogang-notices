export const sources = [
  { id: 'sogang-academic', site: null, board: 2, host: 'www' },
  { id: 'cs-main', site: 'cs', board: 1905, host: 'cs' },
  { id: 'cs-undergraduate', site: 'cs', board: 1745, host: 'cs' },
  { id: 'cs-graduate', site: 'cs', board: 1747, host: 'cs' },
  { id: 'cs-general', site: 'cs', board: 1746, host: 'cs' },
  { id: 'cs-careers', site: 'cs', board: 1748, host: 'cs' },
  { id: 'cs-news', site: 'cs', board: 1749, host: 'cs' },
  { id: 'ai-academic', site: 'ai', board: 5110, host: 'ai' },
  { id: 'ai-news', site: 'ai', board: 5130, host: 'ai' },
  { id: 'ai-general', site: 'ai', board: 6330, host: 'ai' },
  { id: 'ai-careers', site: 'ai', board: 5131, host: 'ai' },
  { id: 'aibased-notices', site: 'aibased', board: 7510, host: 'scc' },
  { id: 'aibased-news', site: 'aibased', board: 7530, host: 'scc' },
]

export const feedOrigin = 'https://hiyabye.github.io/sogang-notices/'
export const feedUrl = source => `${feedOrigin}feeds/${source.id}.json`
export function boardUrl(source, page = 1) {
  const url = new URL(`https://${source.host}.sogang.ac.kr/front/cmsboardlist.do`)
  url.search = new URLSearchParams({ bbsConfigFK: String(source.board), siteId: source.site, currentPage: String(page) })
  return url.href
}
