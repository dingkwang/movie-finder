import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  inferOriginalAudio,
  isAcceptedChineseMovie,
  isLikelyChineseMovie,
  pickBestTmdbResult,
} from '../app/api/movies/movie-matching.js';

describe('Chinese movie matching', () => {
  it('keeps Happy Together through its US alternative title', () => {
    const movie = {
      title: 'Happy Together',
      releaseYear: 1997,
      topCast: ['Leslie Cheung', 'Tony Leung Chiu Wai', 'Chen Chang'],
      directors: ['Kar Wai Wong'],
      showtimes: [],
    };
    const wrong = {
      id: 55059,
      title: 'Happy Together',
      original_title: 'Happy Together',
      original_language: 'en',
      release_date: '1989-05-04',
      production_countries: [{ iso_3166_1: 'US' }],
      spoken_languages: [{ iso_639_1: 'en', english_name: 'English' }],
      alternative_titles: { titles: [] },
    };
    const correct = {
      id: 18329,
      title: '春光乍泄',
      original_title: '春光乍洩',
      original_language: 'cn',
      release_date: '1997-05-30',
      production_countries: [{ iso_3166_1: 'HK' }],
      spoken_languages: [{ iso_639_1: 'cn', english_name: 'Cantonese' }],
      alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'Happy Together' }] },
      credits: {
        cast: [{ name: 'Leslie Cheung' }, { name: 'Tony Leung Chiu Wai' }],
        crew: [{ job: 'Director', name: 'Kar Wai Wong' }],
      },
    };

    assert.equal(pickBestTmdbResult(movie, [wrong, correct]), correct);
    assert.equal(isAcceptedChineseMovie(movie, correct), true);
  });

  it('keeps Chungking Express through its US alternative title', () => {
    const movie = {
      title: 'Chungking Express',
      releaseYear: 1994,
      topCast: ['Brigitte Lin', 'Takeshi Kaneshiro', 'Tony Leung Chiu Wai'],
      directors: ['Kar Wai Wong'],
      showtimes: [],
    };
    const wrong = {
      id: 1152699,
      title: 'Moving Pictures: Chungking Express',
      original_title: 'Moving Pictures: Chungking Express',
      original_language: 'en',
      release_date: '',
      production_countries: [{ iso_3166_1: 'US' }],
      spoken_languages: [{ iso_639_1: 'en', english_name: 'English' }],
      alternative_titles: { titles: [] },
    };
    const correct = {
      id: 11104,
      title: '重庆森林',
      original_title: '重慶森林',
      original_language: 'cn',
      release_date: '1994-07-14',
      production_countries: [{ iso_3166_1: 'HK' }],
      spoken_languages: [{ iso_639_1: 'zh', english_name: 'Mandarin' }],
      alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'Chungking Express' }] },
      credits: {
        cast: [{ name: 'Brigitte Lin' }, { name: 'Takeshi Kaneshiro' }],
        crew: [{ job: 'Director', name: 'Kar Wai Wong' }],
      },
    };

    assert.equal(pickBestTmdbResult(movie, [wrong, correct]), correct);
    assert.equal(isAcceptedChineseMovie(movie, correct), true);
  });

  it('keeps The Furious even when TMDB original language is English', () => {
    const movie = {
      title: 'The Furious',
      releaseYear: 2025,
      topCast: ['Xie Miao', 'Joe Taslim', 'Yang Enyou'],
      directors: ['Kenji Tanigaki'],
      showtimes: [],
    };
    const tmdb = {
      id: 1280738,
      title: '火遮眼',
      original_title: '火遮眼',
      original_language: 'en',
      release_date: '2026-06-10',
      production_countries: [{ iso_3166_1: 'HK' }, { iso_3166_1: 'CN' }],
      spoken_languages: [{ iso_639_1: 'zh', english_name: 'Mandarin' }],
      alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'The Furious' }] },
      credits: {
        cast: [{ name: 'Xie Miao' }, { name: 'Joe Taslim' }],
        crew: [{ job: 'Director', name: 'Kenji Tanigaki' }],
      },
    };

    assert.equal(isAcceptedChineseMovie(movie, tmdb), true);
  });

  it('does not keep a non-Chinese movie because of localized Chinese metadata', () => {
    const movie = { title: 'Clueless', releaseYear: 1995, showtimes: [] };
    const tmdb = {
      id: 9603,
      title: '独领风骚',
      original_title: 'Clueless',
      original_language: 'en',
      release_date: '1995-07-19',
      production_countries: [{ iso_3166_1: 'US' }],
      spoken_languages: [{ iso_639_1: 'en', english_name: 'English' }],
      alternative_titles: { titles: [{ iso_3166_1: 'CN', title: '独领风骚' }] },
    };

    assert.equal(isLikelyChineseMovie(movie, tmdb), false);
    assert.equal(isAcceptedChineseMovie(movie, tmdb), false);
  });

  it('rejects unrelated Chinese candidates when the release year is far off', () => {
    const movie = { title: 'Clueless', releaseYear: 1995, showtimes: [] };
    const tmdb = {
      id: 137732,
      title: '青春期',
      original_title: '青春期',
      original_language: 'zh',
      release_date: '2007-10-08',
      production_countries: [{ iso_3166_1: 'CN' }],
      spoken_languages: [{ iso_639_1: 'zh', english_name: 'Mandarin' }],
      alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'Clueless' }] },
    };

    assert.equal(isLikelyChineseMovie(movie, tmdb), true);
    assert.equal(isAcceptedChineseMovie(movie, tmdb), false);
  });

  it('rejects same-title Chinese candidates when TMS credits disagree', () => {
    const movie = {
      title: 'Blow Out',
      releaseYear: 1981,
      topCast: ['John Travolta', 'Nancy Allen', 'John Lithgow'],
      directors: ['Brian De Palma'],
      showtimes: [],
    };
    const tmdb = {
      id: 123,
      title: '怒火風雲',
      original_title: '怒火風雲',
      original_language: 'cn',
      release_date: '1982-01-01',
      production_countries: [{ iso_3166_1: 'HK' }],
      spoken_languages: [{ iso_639_1: 'cn', english_name: 'Cantonese' }],
      alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'Blow Out' }] },
      credits: {
        cast: [{ name: 'Not John Travolta' }],
        crew: [{ job: 'Director', name: 'Not Brian De Palma' }],
      },
    };

    assert.equal(isLikelyChineseMovie(movie, tmdb), true);
    assert.equal(isAcceptedChineseMovie(movie, tmdb), false);
  });

  it('labels original audio from TMDB spoken languages', () => {
    assert.equal(
      inferOriginalAudio({}, {
        original_language: 'zh',
        spoken_languages: [{ iso_639_1: 'zh', english_name: 'Mandarin' }],
      }),
      '普通话'
    );
    assert.equal(
      inferOriginalAudio({}, {
        original_language: 'cn',
        spoken_languages: [{ iso_639_1: 'cn', english_name: 'Cantonese' }],
      }),
      '粤语'
    );
    assert.equal(
      inferOriginalAudio({}, {
        original_language: 'en',
        spoken_languages: [{ iso_639_1: 'en', english_name: 'English' }],
      }),
      '英语'
    );
    assert.equal(
      inferOriginalAudio({}, {
        original_language: 'nan',
        spoken_languages: [{ iso_639_1: 'nan', english_name: 'Teochew' }],
      }),
      '其他中文'
    );
  });

  it('labels multi-language and unknown original audio conservatively', () => {
    assert.equal(
      inferOriginalAudio({}, {
        original_language: 'zh',
        spoken_languages: [
          { iso_639_1: 'zh', english_name: 'Mandarin' },
          { iso_639_1: 'en', english_name: 'English' },
        ],
      }),
      '多语'
    );
    assert.equal(
      inferOriginalAudio({}, {
        original_language: 'ja',
        spoken_languages: [{ iso_639_1: 'ja', english_name: 'Japanese' }],
      }),
      '未知'
    );
  });

  it('uses TMS showtime qualifiers when TMDB language is missing', () => {
    assert.equal(
      inferOriginalAudio({
        showtimes: [{ quals: 'Cantonese with English subtitles' }],
      }, null),
      '粤语'
    );
    assert.equal(
      inferOriginalAudio({
        showtimes: [{ quals: 'Teochew with English subtitles' }],
      }, null),
      '其他中文'
    );
    assert.equal(
      isAcceptedChineseMovie({
        title: 'Dear You',
        releaseYear: 2026,
        showtimes: [{ quals: 'Teochew with English subtitles' }],
      }, null),
      true
    );
  });
});
