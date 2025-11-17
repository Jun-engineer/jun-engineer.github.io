module.exports = {
  layout: "layouts/post.njk",
  lang: "en",
  eleventyComputed: {
    permalink: (data) => data.permalink || `/en/blog/${data.page.fileSlug}/`,
    cta: (data) => data.cta || "Read article",
    category: (data) => data.category || "General"
  }
};
