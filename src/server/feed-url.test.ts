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

test("host matching is case-insensitive and the scheme is preserved", () => {
  assert.equal(
    normalizeRssUrl("HTTP://WWW.OmnyContent.com/d/playlist/abc/podcast.rss?x=1"),
    "HTTP://traffic.omny.fm/d/playlist/abc/podcast.rss?x=1",
  );
});

test("the Buzzsprout alias normalizes with and without www", () => {
  assert.equal(
    normalizeRssUrl("https://rss.buzzsprout.com/123456.rss"),
    "https://feeds.buzzsprout.com/123456.rss",
  );
  assert.equal(
    normalizeRssUrl("https://www.rss.buzzsprout.com/123456.rss"),
    "https://feeds.buzzsprout.com/123456.rss",
  );
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
