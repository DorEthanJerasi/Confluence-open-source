// Stage 2b video links (docs/done-checks/02-editor.md): a YouTube or Vimeo URL
// gives the embed URL (YouTube on youtube-nocookie.com); every other site gives null.
import { describe, expect, it } from 'vitest';
import { videoEmbedUrl } from '@stillwater/shared';

const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';

describe('videoEmbedUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', YT],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&list=abc', YT],
    ['http://m.youtube.com/watch?v=dQw4w9WgXcQ', YT],
    ['https://youtu.be/dQw4w9WgXcQ', YT],
    ['https://youtu.be/dQw4w9WgXcQ?si=xyz', YT],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', YT],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', YT],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', YT],
    ['  https://youtu.be/dQw4w9WgXcQ  ', YT],
    ['https://youtu.be/dQw4w9WgXcQ?t=90', `${YT}?start=90`],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', `${YT}?start=90`],
  ])('YouTube %s', (input, expected) => {
    expect(videoEmbedUrl(input)).toBe(expected);
  });

  it.each([
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
    ['https://www.vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
    ['https://vimeo.com/channels/staffpicks/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
    ['https://player.vimeo.com/video/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
    ['https://vimeo.com/76979871/abc123def0', 'https://player.vimeo.com/video/76979871?dnt=1&h=abc123def0'],
  ])('Vimeo %s', (input, expected) => {
    expect(videoEmbedUrl(input)).toBe(expected);
  });

  it.each([
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be.evil.example/dQw4w9WgXcQ',
    'https://vimeo.com.evil.example/76979871',
    'https://dailymotion.com/video/x7tgad0',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
    'https://www.youtube.com/',
    'https://www.youtube.com/channel/UC123',
    'https://vimeo.com/about',
    'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'https://user:pw@youtu.be/dQw4w9WgXcQ',
    'https://youtu.be:8080/dQw4w9WgXcQ',
    'not a url',
    '',
  ])('other or malformed: %s gives null', (input) => {
    expect(videoEmbedUrl(input)).toBeNull();
  });
});
