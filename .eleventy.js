module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/photo": "photo" });

  eleventyConfig.addWatchTarget("src/assets/css/styles.css");
  eleventyConfig.addWatchTarget("src/assets/js/main.js");

  eleventyConfig.addCollection("enPosts", (collection) => {
    return collection
      .getFilteredByGlob("src/en/blog/posts/**/*.{md,njk}")
      .filter((item) => !item.data.draft)
      .sort((a, b) => b.date - a.date);
  });

  eleventyConfig.addCollection("jaPosts", (collection) => {
    return collection
      .getFilteredByGlob("src/ja/blog/posts/**/*.{md,njk}")
      .filter((item) => !item.data.draft)
      .sort((a, b) => b.date - a.date);
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"]
  };
};
