module.exports = {
  layout: "layouts/post.njk",
  lang: "ja",
  eleventyComputed: {
    permalink: (data) => data.permalink || `/ja/blog/${data.page.fileSlug}/`,
    cta: (data) => data.cta || "記事を読む",
    category: (data) => data.category || "General"
  }
};
