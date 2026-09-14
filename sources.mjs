export const sources = [
  { id: 'sogang-academic', site: null, board: 2, host: 'www' },
  { id: 'computing-notices', site: 'computing', board: 7332, host: 'computing', pageSize: 15 },
  { id: 'computing-news', site: 'computing', board: 7333, host: 'computing', pageSize: 15 },
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
  { id: 'eng-academic', site: 'eng', board: 1628, host: 'eng' },
  { id: 'eng-research', site: 'eng', board: 1627, host: 'eng' },
  { id: 'eng-general', site: 'eng', board: 1624, host: 'eng' },
  { id: 'eng-careers', site: 'eng', board: 8290, host: 'eng', pageSize: 12 },
  { id: 'eng-newsletter', site: 'eng', board: 1621, host: 'eng', pageSize: 12, gallery: true },
  { id: 'ee-news', kind: 'community', host: 'ee', path: '/kor/community/notice01.php', code: 'news', label: '학과소식', pageSize: 12, gallery: true },
  { id: 'ee-general', kind: 'community', host: 'ee', path: '/kor/community/notice02.php', code: 'general', label: '일반공지' },
  { id: 'ee-academic', kind: 'community', host: 'ee', path: '/kor/community/notice03.php', code: 'academic', label: '학사공지' },
  { id: 'ee-seminars', kind: 'community', host: 'ee', path: '/kor/community/seminar.php', code: 'seminar', label: '세미나' },
  { id: 'ee-employment', kind: 'community', host: 'ee', path: '/kor/community/employment.php', code: 'jobs', label: '취업정보' },
  { id: 'ee-recruit', kind: 'community', host: 'ee', path: '/kor/recruit/recruit.php', code: 'recruit', label: '채용공고' },
  { id: 'me-general', kind: 'mechanical', host: 'me', board: 'notice', label: '일반공지', pageSize: 15 },
  { id: 'me-academic', kind: 'mechanical', host: 'me', board: 'academic', label: '학사공지', pageSize: 15 },
  { id: 'me-research', kind: 'mechanical', host: 'me', board: 'research', label: '연구성과', pageSize: 15 },
  { id: 'me-awards', kind: 'mechanical', host: 'me', board: 'award', label: '수상', pageSize: 15 },
  { id: 'me-careers', kind: 'mechanical', host: 'me', board: 'scholarship', label: '장학·취업정보', pageSize: 15 },
  { id: 'me-events', kind: 'mechanical', host: 'me', board: 'events', label: '외부 행사', pageSize: 15 },
  { id: 'me-alumni', kind: 'mechanical', host: 'me', board: 'alumni_news', label: '기계공학과 동문 소식', pageSize: 15 },
  { id: 'sse-notices', kind: 'community', host: 'sse', path: '/kor/community/notice.php', label: '공지사항' },
  { id: 'sse-news', kind: 'community', host: 'sse', path: '/kor/community/news.php', label: '학과소식', pageSize: 9, gallery: true },
  { id: 'sse-seminars', kind: 'community', host: 'sse', path: '/kor/community/seminar.php', label: '세미나' },
  { id: 'se-notices', kind: 'semiconductor', host: 'se', board: 'notice', label: '학과 공지사항' },
  { id: 'se-graduate', kind: 'semiconductor', host: 'se', board: 'notice_master', label: '대학원 공지사항' },
  { id: 'se-news', kind: 'semiconductor', host: 'se', board: 'news', label: '학과소식' },
  { id: 'se-careers', kind: 'semiconductor', host: 'se', board: 'recruit', label: '채용/홍보' },
  { id: 'se-industry', kind: 'semiconductor', host: 'se', board: 'notice_industry', label: '산학연 공지사항' },
]

export const feedOrigin = 'https://hiyabye.github.io/sogang-notices/'
export const feedUrl = source => `${feedOrigin}feeds/${source.id}.json`
export function boardUrl(source, page = 1) {
  if (source.kind) {
    const path = source.kind === 'mechanical' ? `/ko/board/${source.board}`
      : source.kind === 'semiconductor' ? '/board/board_list.php' : source.path
    const url = new URL(path, `https://${source.host}.sogang.ac.kr`)
    if (source.kind === 'semiconductor') url.searchParams.set('board_id', source.board)
    url.searchParams.set(source.kind === 'community' ? 'pNo' : 'page', String(page))
    return url.href
  }
  const url = new URL(`https://${source.host}.sogang.ac.kr/front/cmsboardlist.do`)
  url.search = new URLSearchParams({ bbsConfigFK: String(source.board), siteId: source.site, currentPage: String(page) })
  return url.href
}
