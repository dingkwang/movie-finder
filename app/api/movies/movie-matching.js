export const CHINESE_LANGS = new Set(['zh', 'cmn', 'yue', 'cn', 'zh-hans', 'zh-hant', 'nan', 'hak', 'wuu', 'cdo', 'cjy', 'gan', 'hsn']);
export const CHINESE_COUNTRIES = new Set(['CN', 'HK', 'MO', 'SG', 'TW']);
export const CHINESE_LANGUAGE_NAME_RE = /\b(cantonese|mandarin|chinese|putonghua|guangdonghua|teochew|hokkien|min nan|minnan|chaoshan|chaozhou|hakka|shanghainese|wu)\b/i;
export const CHINESE_SHOWTIME_RE = CHINESE_LANGUAGE_NAME_RE;
export const CJK_RE = /[\u3400-\u9fff]/;
export const AUDIO_LABELS = {
  mandarin: '普通话',
  cantonese: '粤语',
  otherChinese: '其他中文',
  english: '英语',
  multi: '多语',
  unknown: '未知',
};

export function normalizeTitle(title) {
  return (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizePerson(name) {
  return normalizeTitle(name);
}

function personKeys(name) {
  const normalized = normalizePerson(name);
  if (!normalized) return [];
  const sorted = normalized.split(' ').filter(Boolean).sort().join(' ');
  return Array.from(new Set([normalized, sorted]));
}

export function parseYear(value) {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

export function isChineseLanguage(language) {
  return CHINESE_LANGS.has(language?.toLowerCase());
}

function audioCategoryFromLanguage(language) {
  const normalized = language?.toLowerCase();
  if (!normalized) return null;
  if (['zh', 'cmn', 'zh-hans', 'zh-hant'].includes(normalized)) return 'mandarin';
  if (['yue', 'cn'].includes(normalized)) return 'cantonese';
  if (['nan', 'hak', 'wuu', 'cdo', 'cjy', 'gan', 'hsn'].includes(normalized)) return 'otherChinese';
  if (normalized === 'en') return 'english';
  return null;
}

function audioCategoryFromName(name) {
  if (/mandarin|putonghua/i.test(name ?? '')) return 'mandarin';
  if (/cantonese|guangdonghua/i.test(name ?? '')) return 'cantonese';
  if (/teochew|hokkien|min nan|minnan|chaoshan|chaozhou|hakka|shanghainese|\bwu\b/i.test(name ?? '')) return 'otherChinese';
  if (/\benglish\b/i.test(name ?? '')) return 'english';
  return null;
}

function addAudioCategory(categories, category) {
  if (category) categories.add(category);
}

export function inferOriginalAudio(movie, tmdb) {
  const categories = new Set();

  for (const language of tmdb?.spoken_languages ?? []) {
    addAudioCategory(categories, audioCategoryFromLanguage(language.iso_639_1));
    addAudioCategory(categories, audioCategoryFromName(language.english_name));
    addAudioCategory(categories, audioCategoryFromName(language.name));
  }

  addAudioCategory(categories, audioCategoryFromLanguage(tmdb?.original_language));

  for (const showtime of movie?.showtimes ?? []) {
    addAudioCategory(categories, audioCategoryFromName(showtime.quals));
  }

  if (categories.size > 1) return AUDIO_LABELS.multi;
  const [category] = categories;
  return AUDIO_LABELS[category] ?? AUDIO_LABELS.unknown;
}

export function isLikelyChineseFromTms(movie) {
  if (isChineseLanguage(movie.titleLang) || isChineseLanguage(movie.descriptionLang)) return true;
  return (movie.showtimes ?? []).some(st => CHINESE_SHOWTIME_RE.test(st.quals ?? ''));
}

export function tmdbTitleCandidates(tmdb) {
  const titles = [
    tmdb?.title,
    tmdb?.original_title,
    ...(tmdb?.alternative_titles?.titles ?? []).map(title => title.title),
  ];
  return Array.from(new Set(titles.map(normalizeTitle).filter(Boolean)));
}

export function hasMatchingTitle(movie, tmdb) {
  const movieTitle = normalizeTitle(movie.title);
  if (!movieTitle) return false;
  return tmdbTitleCandidates(tmdb).some(title => title === movieTitle);
}

export function hasContainingTitle(movie, tmdb) {
  const movieTitle = normalizeTitle(movie.title);
  if (movieTitle.length <= 3) return false;
  return tmdbTitleCandidates(tmdb).some(title => {
    return title.includes(movieTitle) || movieTitle.includes(title);
  });
}

export function releaseYearDistance(movie, tmdb) {
  const movieYear = parseYear(movie.releaseYear) ?? parseYear(movie.releaseDate);
  const tmdbYear = parseYear(tmdb?.release_date);
  if (!movieYear || !tmdbYear) return null;
  return Math.abs(movieYear - tmdbYear);
}

export function hasCompatibleReleaseYear(movie, tmdb) {
  const distance = releaseYearDistance(movie, tmdb);
  return distance === null || distance <= 1;
}

export function hasTmsPeople(movie) {
  return Boolean((movie.directors ?? []).length || (movie.topCast ?? []).length);
}

export function hasTmsCreditOverlap(movie, tmdb) {
  const tmsDirectors = new Set((movie.directors ?? []).flatMap(personKeys));
  const tmsCast = new Set((movie.topCast ?? []).flatMap(personKeys));
  if (!tmsDirectors.size && !tmsCast.size) return false;

  const tmdbDirectors = new Set(
    (tmdb?.credits?.crew ?? [])
      .filter(person => person.job === 'Director')
      .flatMap(person => personKeys(person.name))
  );
  const tmdbCast = new Set(
    (tmdb?.credits?.cast ?? [])
      .slice(0, 12)
      .flatMap(person => personKeys(person.name))
  );

  for (const director of tmsDirectors) {
    if (tmdbDirectors.has(director)) return true;
  }
  for (const actor of tmsCast) {
    if (tmdbCast.has(actor)) return true;
  }
  return false;
}

export function hasChineseSpokenLanguage(tmdb) {
  return (tmdb?.spoken_languages ?? []).some(language => {
    return isChineseLanguage(language.iso_639_1)
      || CHINESE_LANGUAGE_NAME_RE.test(language.english_name ?? '')
      || CHINESE_LANGUAGE_NAME_RE.test(language.name ?? '');
  });
}

export function hasChineseProductionCountry(tmdb) {
  return (tmdb?.production_countries ?? []).some(country => CHINESE_COUNTRIES.has(country.iso_3166_1));
}

export function chineseSignals(movie, tmdb) {
  return {
    tms: isLikelyChineseFromTms(movie),
    originalLanguage: isChineseLanguage(tmdb?.original_language),
    originalTitle: CJK_RE.test(tmdb?.original_title ?? ''),
    spokenLanguage: hasChineseSpokenLanguage(tmdb),
    productionCountry: hasChineseProductionCountry(tmdb),
  };
}

export function hasTmdbChineseSignals(tmdb) {
  const originalLanguage = isChineseLanguage(tmdb?.original_language);
  const originalTitle = CJK_RE.test(tmdb?.original_title ?? '');
  const spokenLanguage = hasChineseSpokenLanguage(tmdb);
  const productionCountry = hasChineseProductionCountry(tmdb);

  if (originalLanguage) return true;
  return productionCountry && (spokenLanguage || originalTitle);
}

export function isLikelyChineseMovie(movie, tmdb) {
  return isLikelyChineseFromTms(movie) || hasTmdbChineseSignals(tmdb);
}

export function isAcceptedChineseMovie(movie, tmdb) {
  if (isLikelyChineseFromTms(movie)) return true;
  if (!hasTmdbChineseSignals(tmdb)) return false;
  if (!hasCompatibleReleaseYear(movie, tmdb)) return false;
  if (!hasMatchingTitle(movie, tmdb) && !hasContainingTitle(movie, tmdb)) return false;
  return !hasTmsPeople(movie) || hasTmsCreditOverlap(movie, tmdb);
}

export function scoreTmdbResult(movie, tmdb) {
  let score = 0;
  const movieYear = parseYear(movie.releaseYear) ?? parseYear(movie.releaseDate);
  const tmdbYear = parseYear(tmdb.release_date);
  const exactTitle = hasMatchingTitle(movie, tmdb);
  const titleContains = hasContainingTitle(movie, tmdb);
  const signals = chineseSignals(movie, tmdb);
  const tmdbChinese = hasTmdbChineseSignals(tmdb);

  if (exactTitle) score += 90;
  else if (titleContains) score += 20;

  if (movieYear && tmdbYear) {
    const distance = Math.abs(movieYear - tmdbYear);
    if (distance === 0) score += 35;
    else if (distance === 1) score += 12;
    else score -= Math.min(distance, 12);
  }

  if (signals.tms && tmdbChinese) score += 120;
  if (signals.tms && !tmdbChinese) score -= 60;
  if (!signals.tms && tmdbChinese) score += 35;
  if (signals.spokenLanguage && signals.productionCountry) score += 25;
  if (signals.originalTitle && signals.productionCountry) score += 20;
  if (signals.originalLanguage) score += 15;

  if (!tmdbChinese && !exactTitle && !titleContains) score -= 50;

  score += Math.min(tmdb.vote_count ?? 0, 1000) / 1000;
  score += Math.min(tmdb.popularity ?? 0, 50) / 50;

  return score;
}

export function pickBestTmdbResult(movie, results = []) {
  return results
    .filter(Boolean)
    .sort((a, b) => scoreTmdbResult(movie, b) - scoreTmdbResult(movie, a))[0] ?? null;
}

export function candidatePreScore(movie, tmdb) {
  let score = 0;
  const movieTitle = normalizeTitle(movie.title);
  const tmdbTitle = normalizeTitle(tmdb.title);
  const tmdbOriginalTitle = normalizeTitle(tmdb.original_title);
  const movieYear = parseYear(movie.releaseYear) ?? parseYear(movie.releaseDate);
  const tmdbYear = parseYear(tmdb.release_date);

  if (tmdbTitle === movieTitle || tmdbOriginalTitle === movieTitle) score += 90;
  else if (movieTitle.length > 3 && (tmdbTitle.includes(movieTitle) || tmdbOriginalTitle.includes(movieTitle))) score += 20;

  if (movieYear && tmdbYear) {
    const distance = Math.abs(movieYear - tmdbYear);
    if (distance === 0) score += 35;
    else if (distance === 1) score += 12;
    else score -= Math.min(distance, 12);
  }

  if (isChineseLanguage(tmdb.original_language)) score += 15;
  if (CJK_RE.test(tmdb.original_title ?? '')) score += 10;
  score += Math.min(tmdb.vote_count ?? 0, 1000) / 1000;
  score += Math.min(tmdb.popularity ?? 0, 50) / 50;

  return score;
}

export function isLikelyChineseSearchCandidate(tmdb) {
  return isChineseLanguage(tmdb?.original_language) || CJK_RE.test(tmdb?.original_title ?? '');
}
