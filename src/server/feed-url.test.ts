import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRssUrl } from "./feed-url.ts";

const OMNY_PATH =
  "/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/E5F91208-CC7E-4726-A312-AE280140AD11/D64F756D-6D5E-4FAE-B24F-AE280140AD36/podcast.rss";

test("both real Omny URL forms resolve to the same allowlisted URL", () => {
  const expected = `https://traffic.omny.fm${OMNY_PATH}`;
  assert.equal(normalizeRssUrl(`https://traffic.omny.fm${OMNY_PATH}`), expected);
  assert.equal(normalizeRssUrl(`https://omnycontent.com${OMNY_PATH}`), expected);
});

test("the www Omny alias still normalizes", () => {
  assert.equal(
    normalizeRssUrl(`https://www.omnycontent.com${OMNY_PATH}`),
    `https://traffic.omny.fm${OMNY_PATH}`,
  );
});

test("host matching is case-insensitive and the query is preserved", () => {
  assert.equal(
    normalizeRssUrl("HTTPS://WWW.OmnyContent.com/d/playlist/abc/podcast.rss?x=1"),
    "HTTPS://traffic.omny.fm/d/playlist/abc/podcast.rss?x=1",
  );
});

test("http is upgraded to https, since Devvit only fetches https", () => {
  assert.equal(
    normalizeRssUrl("http://feeds.megaphone.fm/ADL1234567890"),
    "https://feeds.megaphone.fm/ADL1234567890",
  );
  assert.equal(
    normalizeRssUrl("HTTP://WWW.OmnyContent.com/d/playlist/abc/podcast.rss?x=1"),
    "https://traffic.omny.fm/d/playlist/abc/podcast.rss?x=1",
  );
});

test("the Buzzsprout alias normalizes to rss.buzzsprout.com, with and without www", () => {
  // feeds.buzzsprout.com now 301s to rss.buzzsprout.com, so rss. is canonical.
  assert.equal(
    normalizeRssUrl("https://feeds.buzzsprout.com/123456.rss"),
    "https://rss.buzzsprout.com/123456.rss",
  );
  assert.equal(
    normalizeRssUrl("https://www.feeds.buzzsprout.com/123456.rss"),
    "https://rss.buzzsprout.com/123456.rss",
  );
  assert.equal(
    normalizeRssUrl("https://rss.buzzsprout.com/123456.rss"),
    "https://rss.buzzsprout.com/123456.rss",
  );
});

test("a Podtrac rss.pdrl.fm wrapper is unwrapped to the real feed", () => {
  assert.equal(
    normalizeRssUrl("https://rss.pdrl.fm/3d28ed/feeds.megaphone.fm/ADL1234567890"),
    "https://feeds.megaphone.fm/ADL1234567890",
  );
  assert.equal(
    normalizeRssUrl("http://RSS.PDRL.FM/abc123/feeds.simplecast.com/54nAGcIl?x=1"),
    "https://feeds.simplecast.com/54nAGcIl?x=1",
  );
});

test("an unwrapped Podtrac feed still gets its host alias rewritten", () => {
  assert.equal(
    normalizeRssUrl(`https://rss.pdrl.fm/3d28ed/www.omnycontent.com${OMNY_PATH}`),
    `https://traffic.omny.fm${OMNY_PATH}`,
  );
  assert.equal(
    normalizeRssUrl("rss.pdrl.fm/3d28ed/https://feeds.buzzsprout.com/1.rss"),
    "https://rss.buzzsprout.com/1.rss",
  );
});

test("a Podtrac URL with nothing after the tracking id is left alone", () => {
  assert.equal(normalizeRssUrl("https://rss.pdrl.fm/3d28ed"), "https://rss.pdrl.fm/3d28ed");
  assert.equal(normalizeRssUrl("https://rss.pdrl.fm/3d28ed/"), "https://rss.pdrl.fm/3d28ed/");
});

test("a scheme-less paste gains https and still normalizes", () => {
  assert.equal(
    normalizeRssUrl(`omnycontent.com${OMNY_PATH}`),
    `https://traffic.omny.fm${OMNY_PATH}`,
  );
  assert.equal(
    normalizeRssUrl("feeds.megaphone.fm/show.rss"),
    "https://feeds.megaphone.fm/show.rss",
  );
});

test("unrelated hosts are left alone", () => {
  const url = "https://feeds.megaphone.fm/ADL1234567890";
  assert.equal(normalizeRssUrl(url), url);
});

test("empty and whitespace-only input stays empty", () => {
  assert.equal(normalizeRssUrl(""), "");
  assert.equal(normalizeRssUrl("   "), "");
});
