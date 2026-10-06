export const sources = [
  { id: 'sogang-academic', site: null, board: 2, host: 'www' },
  { id: 'computing-academic', kind: 'computing', board: 'academicNotice', host: 'computing', path: '/ko/community/academicNotice/list', label: '학사 공지' },
  { id: 'computing-graduate', kind: 'computing', board: 'graduateNotice', host: 'computing', path: '/ko/community/graduateNotice/list', label: '대학원 공지' },
  { id: 'computing-external', kind: 'computing', board: 'externalInfo', host: 'computing', path: '/ko/community/externalInfo/list', label: '대외정보' },
  { id: 'computing-updates', kind: 'computing', board: 'news', host: 'computing', path: '/ko/community/news/list', label: '소식' },
  { id: 'computing-career', kind: 'computing', board: 'career', host: 'computing', path: '/ko/community/career/list', label: '취업·인턴십' },
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
  { id: 'sse-notices', kind: 'community', host: 'sse', path: '/kor/community/notice.php', label: '학과공지' },
  { id: 'sse-news', kind: 'community', host: 'sse', path: '/kor/community/news.php', label: '학과소식', pageSize: 9, gallery: true },
  { id: 'sse-seminars', kind: 'community', host: 'sse', path: '/kor/community/seminar.php', label: '일반공지(세미나,홍보 등)' },
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
    url.searchParams.set(source.kind === 'computing' ? 'num' : source.kind === 'community' ? 'pNo' : 'page', String(page))
    return url.href
  }
  const url = new URL(`https://${source.host}.sogang.ac.kr/front/cmsboardlist.do`)
  url.search = new URLSearchParams({ bbsConfigFK: String(source.board), siteId: source.site, currentPage: String(page) })
  return url.href
}
